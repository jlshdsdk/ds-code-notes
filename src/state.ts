import { computed, signal } from '@preact/signals';
import type { AppSettings, NodeRow } from './types';
import { DEFAULT_SETTINGS } from './types';

/** 全量节点表（内存 Map，写操作总是整表替换以触发 computed 更新） */
export const nodes = signal<Map<string, NodeRow>>(new Map());
export const currentDocId = signal<string | null>(null);
export const settings = signal<AppSettings>({ ...DEFAULT_SETTINGS });
export const showSettings = signal(false);

export interface ConfirmState {
  title: string;
  body: string;
  okText?: string;
  danger?: boolean;
  onOk: () => void;
}
export const confirmState = signal<ConfirmState | null>(null);

export const toastMsg = signal<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(msg: string): void {
  toastMsg.value = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastMsg.value = null), 2600);
}

export function setNodeMap(rows: NodeRow[]): void {
  nodes.value = new Map(rows.map(r => [r.id, r]));
}

export function upsertNode(row: NodeRow): void {
  const m = new Map(nodes.value);
  m.set(row.id, row);
  nodes.value = m;
}

export function removeNodes(ids: string[]): void {
  const m = new Map(nodes.value);
  for (const id of ids) m.delete(id);
  nodes.value = m;
}

export const childrenByParent = computed(() => {
  const byParent = new Map<string | null, NodeRow[]>();
  for (const n of nodes.value.values()) {
    const list = byParent.get(n.parentId);
    if (list) list.push(n);
    else byParent.set(n.parentId, [n]);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh'));
  }
  return byParent;
});

/** 层级深度：根下目录=1，其子目录=2，文档=3 */
export function depthOf(id: string): number {
  let d = 1;
  let p = nodes.value.get(id)?.parentId ?? null;
  while (p) {
    d++;
    p = nodes.value.get(p)?.parentId ?? null;
  }
  return d;
}
