import { useEffect, useRef, useState } from 'preact/hooks';
import type { EditorView } from '@codemirror/view';
import { getCode, putCode } from '../lib/db';
import { makeEditorView } from '../lib/cm';

export default function CodeEditor({ docId }: { docId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initialRef = useRef('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const row = await getCode(docId);
      if (cancelled || !hostRef.current) return;
      initialRef.current = row?.code ?? '';
      viewRef.current = makeEditorView(hostRef.current, initialRef.current, code => {
        void putCode({ docId, code, updatedAt: Date.now() });
      });
      setReady(true);
    })();
    return () => {
      cancelled = true;
      const v = viewRef.current;
      if (v) {
        const cur = v.state.doc.toString();
        if (cur !== initialRef.current) {
          void putCode({ docId, code: cur, updatedAt: Date.now() });
        }
        v.destroy();
        viewRef.current = null;
      }
      setReady(false);
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
