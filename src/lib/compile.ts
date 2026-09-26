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
  | { kind: 'ok'; stdout: string; stderr: string; compilerInfo: string }
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

const TIMEOUT_MS = 30_000;

export async function runCpp(code: string, stdin: string): Promise<RunResult> {
  const backend = getActiveBackend();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
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
    clearTimeout(timer);
    return { kind: 'network', message: '无法连接编译服务——网络问题，请重试' };
  }
  clearTimeout(timer);
  if (!resp.ok) {
    return {
      kind: 'network',
      message: `编译服务暂时不可用（HTTP ${resp.status}）——网络问题，请重试`,
    };
  }
  let data: WandboxResp;
  try {
    data = (await resp.json()) as WandboxResp;
  } catch {
    return { kind: 'network', message: '编译服务响应异常——网络问题，请重试' };
  }

  const status = String(data.status ?? '0');
  const compilerErr = (data.compiler_error ?? '').trim();

  // 真实编译错误：GCC 诊断非空且退出状态非 0
  if (status !== '0' && compilerErr) {
    return { kind: 'compile', message: data.compiler_message || compilerErr };
  }
  // 编译通过但程序非零退出/被信号终止
  if (status !== '0') {
    const sig = (data.signal ?? '').trim();
    const detail = sig ? `程序异常终止（信号 ${sig}）` : `程序退出码 ${status}`;
    return {
      kind: 'runtime',
      stdout: data.program_output ?? '',
      stderr: data.program_error ?? '',
      detail,
    };
  }
  return {
    kind: 'ok',
    stdout: data.program_output ?? '',
    stderr: data.program_error ?? '',
    compilerInfo: [data.compiler_output, data.compiler_error]
      .filter(Boolean)
      .join('\n')
      .trim(),
  };
}
