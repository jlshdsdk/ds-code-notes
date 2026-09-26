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

/** 插到 target 前面/后面，取中点序号 */
export function orderNear(target: NodeRow, mode: 'before' | 'after'): number {
  const list = childrenByParent.value.get(target.parentId) ?? [];
  const i = list.findIndex(n => n.id === target.id);
  if (i < 0) return target.order;
  if (mode === 'before') {
    const prev = list[i - 1];
    return prev ? (prev.order + target.order) / 2 : target.order - 1024;
  }
  const next = list[i + 1];
  return next ? (target.order + next.order) / 2 : target.order + 1024;
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
