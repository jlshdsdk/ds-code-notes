import { signal } from '@preact/signals';
import { lazy, Suspense } from 'preact/compat';
import { currentDocId, nodes } from '../state';

const NoteEditor = lazy(() => import('./NoteEditor'));
const CodeEditor = lazy(() => import('./CodeEditor'));

export const activeTab = signal<'note' | 'code'>('note');

export function DocPane() {
  const id = currentDocId.value;
  const node = id ? nodes.value.get(id) : undefined;
  if (!node) {
    return (
      <div class="welcome">
        <div class="welcome-card">
          <h2>数据结构代码笔记</h2>
          <p>在左侧选择一个笔记节点打开「笔记 + 代码」，或新建目录开始整理。</p>
        </div>
      </div>
    );
  }
  const tab = activeTab.value;
  return (
    <div class="doc-pane">
      <div class="doc-head">
        <span class="doc-title" title={node.name}>
          {node.name}
        </span>
        <div class="doc-tabs">
          <button
            class={tab === 'note' ? 'tab on' : 'tab'}
            onClick={() => (activeTab.value = 'note')}
          >
            笔记
          </button>
          <button
            class={tab === 'code' ? 'tab on' : 'tab'}
            onClick={() => (activeTab.value = 'code')}
          >
            代码
          </button>
        </div>
      </div>
      <div class="doc-body">
        <Suspense fallback={<div class="pane-loading">编辑器加载中…</div>}>
          {tab === 'note' ? (
            <NoteEditor key={`n-${node.id}`} docId={node.id} />
          ) : (
            <CodeEditor key={`c-${node.id}`} docId={node.id} />
          )}
        </Suspense>
      </div>
    </div>
  );
}
