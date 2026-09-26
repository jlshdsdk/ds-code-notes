import { useEffect, useRef, useState } from 'preact/hooks';
import type { EditorView } from '@codemirror/view';
import { getCode, putCode } from '../lib/db';
import { makeEditorView } from '../lib/cm';
import { runCpp, type RunResult } from '../lib/compile';
import { nodes } from '../state';

type RunState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; result: RunResult };

function ResultView({ result }: { result: RunResult }) {
  switch (result.kind) {
    case 'network':
      return <span class="net-warn">{result.message}</span>;
    case 'compile':
      return (
        <>
          <span class="out-label err">编译失败：</span>
          <span class="stderr">{result.message}</span>
        </>
      );
    case 'runtime':
      return (
        <>
          {result.stdout && <span class="stdout">{result.stdout}</span>}
          {result.stderr && <span class="stderr">{result.stderr}</span>}
          <span class="rt-info">{result.detail}</span>
        </>
      );
    case 'ok':
      return (
        <>
          {result.stdout && <span class="stdout">{result.stdout}</span>}
          {result.stderr && <span class="stderr">{result.stderr}</span>}
          {!result.stdout && !result.stderr && <span class="rt-info">（程序无输出）</span>}
          {result.compilerInfo && (
            <span class="cc-info">GCC 输出：
{result.compilerInfo}
            </span>
          )}
        </>
      );
  }
}

export default function CodeEditor({ docId }: { docId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initialRef = useRef('');
  const dirtyRef = useRef(false);
  const [stdin, setStdin] = useState('');
  const [run, setRun] = useState<RunState>({ phase: 'idle' });
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // 卸载/隐藏时立即落盘；节点已删除则不写（防删除后把行"复活"成孤儿）
    const flushNow = () => {
      const v = viewRef.current;
      if (!v || !dirtyRef.current) return;
      if (!nodes.value.has(docId)) return;
      dirtyRef.current = false;
      void putCode({ docId, code: v.state.doc.toString(), updatedAt: Date.now() }).catch(
        () => {}
      );
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };
    document.addEventListener('visibilitychange', onVis);
    (async () => {
      const row = await getCode(docId);
      if (cancelled || !hostRef.current) return;
      initialRef.current = row?.code ?? '';
      viewRef.current = makeEditorView(hostRef.current, initialRef.current, code => {
        dirtyRef.current = true;
        if (!nodes.value.has(docId)) return;
        void putCode({ docId, code, updatedAt: Date.now() }).catch(() => {});
      });
    })();
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      const v = viewRef.current;
      if (v) {
        flushNow();
        v.destroy();
        viewRef.current = null;
      }
    };
  }, [docId]);

  async function doRun(): Promise<void> {
    const v = viewRef.current;
    if (!v || run.phase === 'running') return;
    // 运行前确保最新代码已保存
    const code = v.state.doc.toString();
    if (code !== initialRef.current) {
      initialRef.current = code;
      void putCode({ docId, code, updatedAt: Date.now() }).catch(() => {});
    }
    setRun({ phase: 'running' });
    const result = await runCpp(code, stdin);
    setRun({ phase: 'done', result });
  }

  const running = run.phase === 'running';
  const canRun = online && !running;

  return (
    <div class="code-editor">
      <div class="code-host" ref={hostRef} />
      <div class="run-panel">
        <div class="run-head">
          <button class="primary" disabled={!canRun} title={online ? '编译运行' : '离线状态，无法编译运行'} onClick={() => void doRun()}>
            {running ? '运行中…' : '▶ 运行'}
          </button>
          <span class="run-hint">
            {!online
              ? '当前离线——编译运行需要联网调用在线 GCC'
              : running
                ? '正在提交到在线 GCC（Wandbox）…'
                : '在线编译：GCC 13.2.0（-Wall -Wextra -std=gnu++17）'}
          </span>
        </div>
        <textarea
          class="stdin"
          placeholder="程序 stdin 输入（运行前一次性填入，如 scanf 要读的数据）"
          spellcheck={false}
          value={stdin}
          onInput={e => setStdin((e.target as HTMLTextAreaElement).value)}
        />
        <pre class="run-out">
          {run.phase === 'idle' && '输出区（运行后显示 stdout / stderr）'}
          {run.phase === 'running' && '运行中，请稍候…'}
          {run.phase === 'done' && <ResultView result={run.result} />}
        </pre>
      </div>
    </div>
  );
}
