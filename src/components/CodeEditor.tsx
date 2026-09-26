import { useEffect, useRef } from 'preact/hooks';
import type { EditorView } from '@codemirror/view';
import { getCode, putCode } from '../lib/db';
import { makeEditorView } from '../lib/cm';
import { nodes } from '../state';

export default function CodeEditor({ docId }: { docId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initialRef = useRef('');
  const dirtyRef = useRef(false);

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

  return (
    <div class="code-editor">
      <div class="code-host" ref={hostRef} />
      <div class="run-panel">
        <div class="run-head">
          <button class="primary" disabled title="编译运行">
            ▶ 运行
          </button>
          <span class="run-hint">编译后端接入中（P2）</span>
        </div>
        <textarea class="stdin" placeholder="程序 stdin 输入（运行前一次性填入）" spellcheck={false} />
        <pre class="run-out">输出区（运行后显示 stdout / stderr）</pre>
      </div>
    </div>
  );
}
