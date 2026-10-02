/**
 * C++ 编译运行适配层。
 *
 * 后端选用结论（2026-09-28 实测更新）：
 *  - Godbolt（compiler explorer）gcc 13.2 + 执行器：约 1s，stdin/stdout/警告/退出码全对 → 主后端
 *  - Wandbox gcc-13.2.0：3–6s，高峰排队可达十几秒 → 备后端（主后端失败/超 12s 自动切换）
 *  - Piston 公共 API：白名单制 401，不可用；Coliru：stdin 不进程序，弃用
 *  两后端同为真 GCC 13.2、同 flags（-Wall -Wextra -std=c++17），诊断文本一致。
 */

export type RunResult =
  | {
      kind: 'ok';
      stdout: string;
      stderr: string;
      compilerInfo: string;
      /** 例如输出超长被截断的提示 */
      note?: string;
    }
  | { kind: 'compile'; message: string }
  | { kind: 'runtime'; stdout: string; stderr: string; detail: string }
  /** 网络失败/超时：绝不允许显示成"编译失败" */
  | { kind: 'network'; message: string };

export const BACKENDS = {
  godbolt: {
    label: 'Godbolt (GCC 13.2.0)',
    endpoint: 'https://godbolt.org/api/compiler/g132/compile',
  },
  wandbox: {
    label: 'Wandbox (GCC 13.2.0)',
    endpoint: 'https://wandbox.org/api/compile.json',
    compiler: 'gcc-13.2.0',
    options: 'warning,gnu++17',
  },
} as const;

export type BackendId = keyof typeof BACKENDS;
/** 主后端；备后端在主后端网络失败/超时时自动接管 */
let activeBackend: BackendId = 'godbolt';

export function switchBackend(id: BackendId): void {
  activeBackend = id;
}

export function getActiveBackend(): BackendId {
  return activeBackend;
}

/** Wandbox 杀死死循环程序约需 30s，客户端总超时必须大于它 */
const TIMEOUT_MS = 45_000;
/** Wandbox 对超长输出硬截断到 131072 字节，此时 status 是空串 */
const WANDOX_MAX_OUTPUT = 131072;

// ---------------- 结果缓存：相同（后端+代码+stdin）重复运行秒出 ----------------

const resultCache = new Map<string, RunResult>();
const CACHE_MAX = 30;

/**
 * 编译运行。相同代码与输入的重复运行直接返回缓存结果（网络错误不缓存）。
 * 输出确定性：同一程序同一 stdin 输出必然相同，缓存安全。
 */
export async function runCpp(code: string, stdin: string): Promise<RunResult> {
  const cacheKey = `${activeBackend}\0${code}\0${stdin}`;
  const hit = resultCache.get(cacheKey);
  if (hit) {
    // LRU：命中后移到队尾
    resultCache.delete(cacheKey);
    resultCache.set(cacheKey, hit);
    return hit;
  }
  const result =
    activeBackend === 'godbolt' ? await raceGodboltWandbox(code, stdin) : await runWandbox(code, stdin, TIMEOUT_MS);
  if (result.kind !== 'network') {
    if (resultCache.size >= CACHE_MAX) {
      const oldest = resultCache.keys().next().value;
      if (oldest !== undefined) resultCache.delete(oldest);
    }
    resultCache.set(cacheKey, result);
  }
  return result;
}

// ---------------- 错峰竞速：Godbolt 主，Wandbox 延迟加入 ----------------

/**
 * 平时只打 Godbolt（约 1–2s）；超过 STAGGER_MS 未回再让 Wandbox 加入，
 * 谁先给出有效结果用谁——任一服务排队都不会拖慢用户。
 * 两个后端同为真 GCC 13.2 + 相同 flags，结果语义一致。
 */
const STAGGER_MS = 3_500;

function raceGodboltWandbox(code: string, stdin: string): Promise<RunResult> {
  return new Promise<RunResult>(resolve => {
    let settled = false;
    let networkFailures = 0;
    let secondary: Promise<void> | null = null;

    const finish = (r: RunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(stagger);
      resolve(r);
    };
    const noteNetworkFailure = (msg: string): void => {
      // 主备都网络级失败才向用户报网络错误
      if (++networkFailures >= 2) finish({ kind: 'network', message: msg });
    };

    const stagger = setTimeout(() => {
      void startSecondary();
    }, STAGGER_MS);

    function startSecondary(): Promise<void> {
      if (secondary) return secondary;
      secondary = runWandbox(code, stdin, TIMEOUT_MS).then(r => {
        if (r.kind !== 'network') finish(r);
        else noteNetworkFailure(r.message);
      });
      return secondary;
    }

    void runGodbolt(code, stdin, TIMEOUT_MS).then(r => {
      if (r.kind !== 'network') {
        finish(r);
        return;
      }
      // 主后端网络级失败：立即拉起备后端（不等 stagger）
      noteNetworkFailure(r.message);
      void startSecondary();
    });
  });
}

/** 信号/退出码 → 学生可读的说明（两后端共用，文案唯一） */
function exitDetail(code: number, timedOut: boolean): string {
  if (timedOut) return '程序被强制终止（疑似死循环超时）';
  if (code === 137) return '程序被强制终止（疑似死循环超时）';
  if (code === 139) return '段错误（SIGSEGV）——检查空指针 / 数组越界';
  if (code === 134) return 'abort() 异常终止';
  if (code === 132) return '非法指令（SIGILL）——常见原因：声明了返回值的函数漏写 return 语句';
  return `程序退出码 ${code}`;
}

// ---------------- Godbolt（主） ----------------

interface GbLine {
  text: string;
}
interface GbResult {
  /** 执行结果嵌套在 execResult 里（编译成功执行后才有；顶层同名字段实测为空壳） */
  execResult?: {
    code?: number;
    timedOut?: boolean;
    truncated?: boolean;
    stdout?: GbLine[];
    stderr?: GbLine[];
    buildResult?: { code?: number; stderr?: GbLine[] };
  };
  /** 编译失败（未执行）时的顶层字段 */
  code?: number;
  stderr?: GbLine[];
}

/** Godbolt 的诊断带 ANSI 颜色码，剥掉后与 Wandbox 文本一致 */
const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

async function runGodbolt(code: string, stdin: string, deadlineMs: number): Promise<RunResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deadlineMs);
  try {
    let resp: Response;
    try {
      resp = await fetch(BACKENDS.godbolt.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          source: code,
          options: {
            userArguments: '-std=c++17 -Wall -Wextra',
            executeParameters: { stdin, args: [] },
            filters: { execute: true },
          },
        }),
        signal: ctrl.signal,
      });
    } catch {
      return { kind: 'network', message: '无法连接编译服务——网络问题，请重试' };
    }
    if (!resp.ok) {
      const message =
        resp.status === 429
          ? '编译服务限流中，请稍等几秒再试'
          : `编译服务暂时不可用（HTTP ${resp.status}）——网络问题，请重试`;
      return { kind: 'network', message };
    }
    let data: GbResult;
    try {
      data = (await resp.json()) as GbResult;
    } catch {
      return { kind: 'network', message: '编译服务响应异常——网络问题，请重试' };
    }

    const exec = data.execResult;
    if (!exec) {
      // 编译失败、未产生执行结果：诊断在顶层 stderr，编译退出码在顶层 code
      const topDiag = (data.stderr ?? []).map(l => stripAnsi(l.text)).join('\n').trim();
      if ((data.code ?? 0) !== 0) {
        return { kind: 'compile', message: topDiag || `编译失败（退出码 ${data.code}）` };
      }
      // 结构不符合预期（接口变更保护）：走备后端
      return { kind: 'network', message: '编译服务响应异常——网络问题，请重试' };
    }
    const build = exec.buildResult;
    const diagnostics = (build?.stderr ?? []).map(l => stripAnsi(l.text)).join('\n').trim();
    const hasError = /\berror:/i.test(diagnostics);

    // 真实编译/链接错误的标志是诊断里含 "error:"；只有 warning 不能算编译失败
    if ((build?.code ?? 0) !== 0 && hasError) {
      return { kind: 'compile', message: diagnostics };
    }
    // 执行结果（编译成功或纯警告）
    const execCode = exec.code ?? 0;
    const stdout = (exec.stdout ?? []).map(l => l.text).join('\n');
    const stderr = (exec.stderr ?? []).map(l => l.text).join('\n');
    if (execCode !== 0 || exec.timedOut) {
      return {
        kind: 'runtime',
        stdout,
        stderr,
        detail: exitDetail(execCode, !!exec.timedOut),
      };
    }
    return {
      kind: 'ok',
      stdout,
      stderr,
      compilerInfo: diagnostics,
      note: exec.truncated ? '输出过长，已被编译服务截断' : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------- Wandbox（备） ----------------

interface WandboxResp {
  status?: string | number;
  signal?: string;
  compiler_output?: string;
  compiler_error?: string;
  compiler_message?: string;
  program_output?: string;
  program_error?: string;
  program_message?: string;
}

async function runWandbox(code: string, stdin: string, timeoutMs: number): Promise<RunResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let resp: Response;
    try {
      resp = await fetch(BACKENDS.wandbox.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          compiler: BACKENDS.wandbox.compiler,
          code,
          stdin,
          options: BACKENDS.wandbox.options,
        }),
        signal: ctrl.signal,
      });
    } catch {
      return { kind: 'network', message: '无法连接编译服务——网络问题，请重试' };
    }
    if (!resp.ok) {
      const message =
        resp.status === 429
          ? '编译服务限流中，请稍等几秒再试'
          : `编译服务暂时不可用（HTTP ${resp.status}）——网络问题，请重试`;
      return { kind: 'network', message };
    }
    let data: WandboxResp;
    try {
      data = (await resp.json()) as WandboxResp;
    } catch {
      return { kind: 'network', message: '编译服务响应异常——网络问题，请重试' };
    }

    // 空串 status（超长输出场景）视为正常退出
    const raw = String(data.status ?? '').trim();
    const status = raw === '' ? '0' : raw;
    const compilerErr = (data.compiler_error ?? '').trim();

    const hasError = /\berror:/i.test(compilerErr);
    if (status !== '0' && hasError) {
      return { kind: 'compile', message: data.compiler_message || compilerErr };
    }
    if (status !== '0') {
      return {
        kind: 'runtime',
        stdout: data.program_output ?? '',
        stderr: data.program_error ?? '',
        detail: exitDetail(Number(status), false),
      };
    }
    const truncated =
      (data.program_output?.length ?? 0) >= WANDOX_MAX_OUTPUT
        ? '输出超过 128KB，已被编译服务截断'
        : undefined;
    return {
      kind: 'ok',
      stdout: data.program_output ?? '',
      stderr: data.program_error ?? '',
      compilerInfo: [data.compiler_output, data.compiler_error]
        .filter(Boolean)
        .join('\n')
        .trim(),
      note: truncated,
    };
  } finally {
    clearTimeout(timer);
  }
}
