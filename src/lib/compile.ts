/**
 * C++ 编译运行适配层。
 *
 * 后端选用结论（2026-09-26 实测）：
 *  - Piston 公共 API（emkc.org）已改为白名单制，401 不可用
 *  - Wandbox gcc-13.2.0 可用，stdin/输出正确 → 主后端
 *  - Coliru 的 stdin 不进程序，弃用
 * 适配层保持可切换：新增后端在 BACKENDS 里加一项并在 switchBackend 里登记。
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
  wandbox: {
    label: 'Wandbox (GCC 13.2.0)',
    endpoint: 'https://wandbox.org/api/compile.json',
    compiler: 'gcc-13.2.0',
    options: 'warning,gnu++17',
  },
} as const;

export type BackendId = keyof typeof BACKENDS;
let activeBackend: BackendId = 'wandbox';

export function switchBackend(id: BackendId): void {
  activeBackend = id;
}

export function getActiveBackend(): (typeof BACKENDS)[BackendId] {
  return BACKENDS[activeBackend];
}

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

/** Wandbox 杀死死循环程序约需 30s，客户端超时必须大于它 */
const TIMEOUT_MS = 45_000;
/** Wandbox 对超长输出硬截断到 131072 字节，此时 status 是空串 */
const WANDOX_MAX_OUTPUT = 131072;

export async function runCpp(code: string, stdin: string): Promise<RunResult> {
  const backend = getActiveBackend();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let resp: Response;
    try {
      resp = await fetch(backend.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          compiler: backend.compiler,
          code,
          stdin,
          options: backend.options,
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

    // 真实编译/链接错误的标志是诊断里含 "error:"；只有 warning 不能算编译失败
    const hasError = /\berror:/i.test(compilerErr);
    if (status !== '0' && hasError) {
      return { kind: 'compile', message: data.compiler_message || compilerErr };
    }
    // 编译通过但程序非零退出/被信号终止（Wandbox 把信号编码为 128+n，signal 字段实测恒空）
    if (status !== '0') {
      const n = Number(status);
      const detail =
        n === 137
          ? '程序被强制终止（疑似死循环超时）'
          : n === 139
            ? '段错误（SIGSEGV）——检查空指针 / 数组越界'
            : n === 134
              ? 'abort() 异常终止'
              : `程序退出码 ${status}`;
      return {
        kind: 'runtime',
        stdout: data.program_output ?? '',
        stderr: data.program_error ?? '',
        detail,
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
