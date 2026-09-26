import { signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import {
  childrenByParent,
  confirmState,
  currentDocId,
  depthOf,
  nodes,
  removeNodes,
  showToast,
  upsertNode,
} from '../state';
import {
  canNestUnder,
  collectDocIds,
  collectSubtreeIds,
  hasSiblingName,
  nextOrder,
  orderNear,
  subtreeStats,
} from '../lib/tree';
import { deleteDocsData, deleteNodes, putNode } from '../lib/db';
import { revokeImageUrl } from '../lib/images';
import { MAX_NAME_LEN, type NodeKind, type NodeRow } from '../types';

type Hint = 'into' | 'before' | 'after';

const expanded = signal<Set<string>>(new Set());
const creating = signal<{ parentId: string | null; kind: NodeKind } | null>(null);
const renaming = signal<string | null>(null);
const dropHint = signal<{ id: string; mode: Hint } | null>(null);

let dragId: string | null = null;

export function expandAllDirs(): void {
  const s = new Set<string>();
  for (const n of nodes.value.values()) if (n.kind === 'dir') s.add(n.id);
  expanded.value = s;
}

function toggleExpand(id: string): void {
  const s = new Set(expanded.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  expanded.value = s;
}

function NameInput(props: {
  initial: string;
  placeholder: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => {
    const v = ref.current?.value.trim() ?? '';
    if (!v) props.onCancel();
    else props.onCommit(v);
  };
  return (
    <input
      ref={ref}
      class="name-input"
      placeholder={props.placeholder}
      defaultValue={props.initial}
      maxLength={MAX_NAME_LEN}
      onClick={e => e.stopPropagation()}
      onDblClick={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') props.onCancel();
      }}
      onBlur={commit}
    />
  );
}

function commitCreate(parentId: string | null, kind: NodeKind, name: string): void {
  creating.value = null;
  if (hasSiblingName(parentId, name)) {
    showToast('同级已有同名项');
    return;
  }
  const row: NodeRow = {
    id: crypto.randomUUID(),
    parentId,
    name,
    kind,
    order: nextOrder(parentId),
    updatedAt: Date.now(),
  };
  upsertNode(row);
  void putNode(row);
  if (parentId) expanded.value = new Set(expanded.value).add(parentId);
  if (kind === 'doc') currentDocId.value = row.id;
}

function commitRename(node: NodeRow, name: string): void {
  renaming.value = null;
  if (name === node.name) return;
  if (hasSiblingName(node.parentId, name, node.id)) {
    showToast('同级已有同名项');
    return;
  }
  const row: NodeRow = { ...node, name, updatedAt: Date.now() };
  upsertNode(row);
  void putNode(row);
}

async function moveNode(dragged: NodeRow, parentId: string | null, order: number): Promise<void> {
  if (!canNestUnder(parentId, dragged.kind)) {
    showToast('不能移动到这个位置');
    return;
  }
  if (dragged.parentId === parentId && dragged.order === order) return;
  if (hasSiblingName(parentId, dragged.name, dragged.id)) {
    showToast('目标位置已有同名项');
    return;
  }
  const row: NodeRow = { ...dragged, parentId, order, updatedAt: Date.now() };
  upsertNode(row);
  await putNode(row);
}

function requestDelete(node: NodeRow): void {
  const isDoc = node.kind === 'doc';
  const stats = isDoc ? null : subtreeStats(node.id);
  const ids = collectSubtreeIds(node.id);
  const docIds = isDoc ? [node.id] : collectDocIds(node.id);
  const body = isDoc
    ? '将删除该节点的笔记内容、代码和图片，不可恢复。'
    : `将删除其下 ${stats!.dirs} 个子目录、${stats!.docs} 个笔记节点（含全部笔记、代码和图片），不可恢复。`;
  confirmState.value = {
    title: `删除「${node.name}」？`,
    body,
    danger: true,
    okText: '删除',
    onOk: async () => {
      const del = await deleteDocsData(docIds);
      for (const imgId of del.ids) revokeImageUrl(imgId);
      await deleteNodes(ids);
      removeNodes(ids);
      if (currentDocId.value && ids.includes(currentDocId.value)) currentDocId.value = null;
        showToast('已删除');
      },
  };
}

/** 拖拽悬停时判定落点：目录上 25% 插前、下 25% 插后、中间为放入；文档行上下半插前插后 */
function modeFor(e: DragEvent, node: NodeRow, dragged: NodeRow): Hint | null {
  const el = e.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const h = Math.max(rect.height, 1);
  const canAdj = canNestUnder(node.parentId, dragged.kind);
  if (node.kind === 'dir') {
    const canInto = canNestUnder(node.id, dragged.kind);
    if (y < h * 0.25) return canAdj ? 'before' : canInto ? 'into' : null;
    if (y > h * 0.75) return canAdj ? 'after' : canInto ? 'into' : null;
    return canInto ? 'into' : canAdj ? (y < h / 2 ? 'before' : 'after') : null;
  }
  return canAdj ? (y < h / 2 ? 'before' : 'after') : null;
}

function TreeNode({ node }: { node: NodeRow }) {
  const isDoc = node.kind === 'doc';
  const depth = depthOf(node.id);
  const kids = isDoc ? [] : (childrenByParent.value.get(node.id) ?? []);
  const open = expanded.value.has(node.id);
  const hint = dropHint.value;
  const hintCls = hint && hint.id === node.id ? ` drop-${hint.mode}` : '';
  const isCurrent = isDoc && currentDocId.value === node.id;
  const childDepthPadding = depth * 16 + 6;

  return (
    <div>
      <div
        class={`tree-row${isCurrent ? ' current' : ''}${hintCls}`}
        style={{ paddingLeft: `${(depth - 1) * 16 + 6}px` }}
        draggable={renaming.value !== node.id}
        onClick={() => {
          if (isDoc) currentDocId.value = node.id;
          else toggleExpand(node.id);
        }}
        onDblClick={() => (renaming.value = node.id)}
        onDragStart={e => {
          dragId = node.id;
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => {
          dragId = null;
          dropHint.value = null;
        }}
        onDragOver={e => {
          const dragged = dragId && dragId !== node.id ? nodes.value.get(dragId) : null;
          if (!dragged) return;
          const mode = modeFor(e, node, dragged);
          if (!mode) return;
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
          const h = dropHint.value;
          if (!h || h.id !== node.id || h.mode !== mode) dropHint.value = { id: node.id, mode };
        }}
        onDragLeave={() => {
          if (dropHint.value?.id === node.id) dropHint.value = null;
        }}
        onDrop={e => {
          e.preventDefault();
          e.stopPropagation();
          const dragged = dragId ? nodes.value.get(dragId) : null;
          const mode =
            dropHint.value?.id === node.id
              ? dropHint.value.mode
              : dragged
                ? modeFor(e, node, dragged)
                : null;
          if (dragged && mode) {
            if (mode === 'into') {
              expanded.value = new Set(expanded.value).add(node.id);
              void moveNode(dragged, node.id, nextOrder(node.id));
            } else {
              void moveNode(dragged, node.parentId, orderNear(node, mode));
            }
          }
          dragId = null;
          dropHint.value = null;
        }}
      >
        <span class="twisty">{isDoc ? '' : open ? '▾' : '▸'}</span>
        <span class="nicon">{isDoc ? '📄' : open ? '📂' : '📁'}</span>
        {renaming.value === node.id ? (
          <NameInput
            initial={node.name}
            placeholder="名称"
            onCommit={name => commitRename(node, name)}
            onCancel={() => (renaming.value = null)}
          />
        ) : (
          <span class="nname" title={node.name}>
            {node.name}
          </span>
        )}
        <span class="row-actions">
          {!isDoc && depth < 3 && (
            <button
              class="icon-btn"
              title={depth === 1 ? '新建二级目录' : '新建笔记节点'}
              onClick={e => {
                e.stopPropagation();
                creating.value = { parentId: node.id, kind: depth === 1 ? 'dir' : 'doc' };
                expanded.value = new Set(expanded.value).add(node.id);
              }}
            >
              ＋
            </button>
          )}
          <button
            class="icon-btn"
            title="重命名"
            onClick={e => {
              e.stopPropagation();
              renaming.value = node.id;
            }}
          >
            ✎
          </button>
          <button
            class="icon-btn"
            title="删除"
            onClick={e => {
              e.stopPropagation();
              requestDelete(node);
            }}
          >
            🗑
          </button>
        </span>
      </div>
      {!isDoc && open && (
        <div>
          {kids.map(k => (
            <TreeNode key={k.id} node={k} />
          ))}
          {creating.value?.parentId === node.id && (
            <div class="tree-row creating" style={{ paddingLeft: `${childDepthPadding}px` }}>
              <NameInput
                initial=""
                placeholder={creating.value.kind === 'doc' ? '笔记节点名' : '二级目录名'}
                onCommit={name => commitCreate(node.id, creating.value!.kind, name)}
                onCancel={() => (creating.value = null)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const roots = childrenByParent.value.get(null) ?? [];
  return (
    <aside class="sidebar">
      <div class="sb-head">
        <span class="sb-title">目录</span>
        <button
          class="icon-btn"
          title="新建一级目录"
          onClick={() => (creating.value = { parentId: null, kind: 'dir' })}
        >
          ＋
        </button>
      </div>
      <div
        class="tree"
        onDragOver={e => {
          const dragged = dragId ? nodes.value.get(dragId) : null;
          if (dragged && canNestUnder(null, dragged.kind)) e.preventDefault();
        }}
        onDrop={e => {
          e.preventDefault();
          const dragged = dragId ? nodes.value.get(dragId) : null;
          if (dragged) void moveNode(dragged, null, nextOrder(null));
          dragId = null;
          dropHint.value = null;
        }}
      >
        {roots.map(n => (
          <TreeNode key={n.id} node={n} />
        ))}
        {creating.value?.parentId === null && (
          <div class="tree-row creating">
            <NameInput
              initial=""
              placeholder="一级目录名"
              onCommit={name => commitCreate(null, creating.value!.kind, name)}
              onCancel={() => (creating.value = null)}
            />
          </div>
        )}
        {roots.length === 0 && creating.value === null && (
          <div class="tree-empty">点右上角 ＋ 建第一个目录</div>
        )}
      </div>
    </aside>
  );
}
