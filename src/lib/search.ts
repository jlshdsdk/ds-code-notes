import { getDB } from './db';
import type { NodeRow } from '../types';

export interface SearchHit {
  nodeId: string;
  isDoc: boolean;
  path: string;
  where: '标题' | '笔记' | '代码';
  snippet: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** 本地全文搜索：标题 + 笔记正文 + 代码内容（个人数据量小，线性扫足够快） */
export async function searchAll(query: string): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const d = await getDB();
  const nodeRows = await d.getAll('nodes');
  const byId = new Map(nodeRows.map(n => [n.id, n]));
  const pathOf = (n: NodeRow): string => {
    const parts = [n.name];
    let cur = n.parentId ? byId.get(n.parentId) : undefined;
    let guard = 0;
    while (cur && guard++ < 4) {
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.join(' / ');
  };
  const hits: SearchHit[] = [];
  for (const n of nodeRows) {
    if (n.name.toLowerCase().includes(q)) {
      hits.push({
        nodeId: n.id,
        isDoc: n.kind === 'doc',
        path: pathOf(n),
        where: '标题',
        snippet: n.name,
      });
    }
  }
  const notes = await d.getAll('notes');
  for (const r of notes) {
    const text = stripHtml(r.html);
    const i = text.toLowerCase().indexOf(q);
    if (i >= 0) {
      const node = byId.get(r.docId);
      hits.push({
        nodeId: r.docId,
        isDoc: true,
        path: node ? pathOf(node) : '（未知路径）',
        where: '笔记',
        snippet: text.slice(Math.max(0, i - 20), i + 50),
      });
    }
  }
  const codes = await d.getAll('code');
  for (const r of codes) {
    const i = r.code.toLowerCase().indexOf(q);
    if (i >= 0) {
      const node = byId.get(r.docId);
      hits.push({
        nodeId: r.docId,
        isDoc: true,
        path: node ? pathOf(node) : '（未知路径）',
        where: '代码',
        snippet: r.code.slice(Math.max(0, i - 20), i + 50).replace(/\n/g, ' '),
      });
    }
  }
  return hits.slice(0, 50);
}
