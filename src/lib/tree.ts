import { childrenByParent, depthOf, nodes } from '../state';
import type { NodeKind, NodeRow } from '../types';


/**
 * 嵌套合法性（唯一的结构规则）：
 * 根下只能放一级目录；一级目录下只能放二级目录；二级目录下只能放文档（三级节点）。
 * 该规则天然禁止把目录拖进自己的后代（L2 目录的孩子只能是文档）。
 */
export function canNestUnder(parentId: string | null, kind: NodeKind): boolean {
  if (!parentId) return kind === 'dir';
  const p = nodes.value.get(parentId);
  if (!p || p.kind !== 'dir') return false;
  const pd = depthOf(parentId);
  return kind === 'doc' ? pd === 2 : pd === 1;
}

export function nextOrder(parentId: string | null): number {
  const list = childrenByParent.value.get(parentId);
  if (!list || list.length === 0) return 1024;
  return list[list.length - 1].order + 1024;
}

/**
 * 计划一次"插到 target 前面/后面"的移动。
 * 返回落点序号；若中点精度耗尽（间隙 <1e-6），附带整组兄弟的重排方案。
 */
export function planAdjacentMove(
  draggedId: string,
  target: NodeRow,
  mode: 'before' | 'after'
): { parentId: string | null; order: number; renumber: NodeRow[] } {
  const list = (childrenByParent.value.get(target.parentId) ?? []).filter(
    n => n.id !== draggedId
  );
  const i = list.findIndex(n => n.id === target.id);
  const idx = i < 0 ? list.length : mode === 'before' ? i : i + 1;
  const prev = list[idx - 1];
  const next = list[idx];
  if (!prev && !next) {
    return { parentId: target.parentId, order: 1024, renumber: [] };
  }
  if (!prev) return { parentId: target.parentId, order: next!.order - 1024, renumber: [] };
  if (!next) return { parentId: target.parentId, order: prev.order + 1024, renumber: [] };
  const mid = (prev.order + next.order) / 2;
  if (Math.abs(mid - prev.order) < 1e-6 || Math.abs(mid - next.order) < 1e-6) {
    const withDragged = [...list];
    withDragged.splice(idx, 0, target);
    return {
      parentId: target.parentId,
      order: (idx + 1) * 1024,
      renumber: withDragged.map((n, k) => ({ ...n, order: (k + 1) * 1024 })),
    };
  }
  return { parentId: target.parentId, order: mid, renumber: [] };
}

export interface SubtreeStats {
  dirs: number;
  docs: number;
}

export function subtreeStats(id: string): SubtreeStats {
  let dirs = 0;
  let docs = 0;
  const walk = (pid: string) => {
    for (const c of childrenByParent.value.get(pid) ?? []) {
      if (c.kind === 'dir') {
        dirs++;
        walk(c.id);
      } else {
        docs++;
      }
    }
  };
  walk(id);
  return { dirs, docs };
}

export function collectSubtreeIds(id: string): string[] {
  const ids = [id];
  const walk = (pid: string) => {
    for (const c of childrenByParent.value.get(pid) ?? []) {
      ids.push(c.id);
      if (c.kind === 'dir') walk(c.id);
    }
  };
  walk(id);
  return ids;
}

export function collectDocIds(id: string): string[] {
  const self = nodes.value.get(id);
  const docs = self && self.kind === 'doc' ? [id] : [];
  const walk = (pid: string) => {
    for (const c of childrenByParent.value.get(pid) ?? []) {
      if (c.kind === 'doc') docs.push(c.id);
      else walk(c.id);
    }
  };
  walk(id);
  return docs;
}

export function hasSiblingName(parentId: string | null, name: string, exceptId?: string): boolean {
  return (childrenByParent.value.get(parentId) ?? []).some(
    n => n.id !== exceptId && n.name === name
  );
}
