import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CodeRow, ImageRow, NodeRow, NoteRow } from '../types';

interface DsSchema extends DBSchema {
  nodes: { key: string; value: NodeRow };
  notes: { key: string; value: NoteRow };
  code: { key: string; value: CodeRow };
  images: { key: string; value: ImageRow; indexes: { 'by-doc': string } };
  settings: { key: string; value: { key: string; value: unknown } };
  meta: { key: string; value: { key: string; value: unknown } };
}

/**
 * local = 未登录的本地库；登录后 activeScope 切到 userId（首次登录做一次迁移）。
 * 所有读写默认落在当前活动库。
 */
let activeScope = 'local';

export function getScope(): string {
  return activeScope;
}

export function setScope(scope: string): void {
  activeScope = scope;
}

// ---------------- 同步脏标记挂点（sync.ts 注册） ----------------

export type DirtyKind = 'node' | 'note' | 'code' | 'image' | 'nodes-deleted';
type DirtyHook = (kind: DirtyKind, id: string) => void;
let dirtyHook: DirtyHook | null = null;

export function setDirtyHook(h: DirtyHook | null): void {
  dirtyHook = h;
}

function markDirty(kind: DirtyKind, id: string): void {
  if (activeScope !== 'local') dirtyHook?.(kind, id);
}

const dbCache = new Map<string, Promise<IDBPDatabase<DsSchema>>>();

export function getDB(scope: string = activeScope): Promise<IDBPDatabase<DsSchema>> {
  let p = dbCache.get(scope);
  if (!p) {
    p = openDB<DsSchema>(`ds-notes--${scope}`, 1, {
      upgrade(db) {
        db.createObjectStore('nodes', { keyPath: 'id' });
        db.createObjectStore('notes', { keyPath: 'docId' });
        db.createObjectStore('code', { keyPath: 'docId' });
        const images = db.createObjectStore('images', { keyPath: 'id' });
        images.createIndex('by-doc', 'docId');
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('meta', { keyPath: 'key' });
      },
    });
    dbCache.set(scope, p);
  }
  return p;
}

// ---------------- nodes ----------------

export async function loadNodes(scope: string = activeScope): Promise<NodeRow[]> {
  return (await getDB(scope)).getAll('nodes');
}

export async function putNode(row: NodeRow, scope: string = activeScope): Promise<void> {
  await (await getDB(scope)).put('nodes', row);
  markDirty('node', row.id);
}

export async function putNodes(rows: NodeRow[], scope: string = activeScope): Promise<void> {
  const d = await getDB(scope);
  const tx = d.transaction('nodes', 'readwrite');
  for (const r of rows) tx.store.put(r);
  await tx.done;
  if (scope === activeScope) for (const r of rows) markDirty('node', r.id);
}

export async function deleteNodes(ids: string[], scope: string = activeScope): Promise<void> {
  const d = await getDB(scope);
  const tx = d.transaction('nodes', 'readwrite');
  for (const id of ids) tx.store.delete(id);
  await tx.done;
  if (scope === activeScope) markDirty('nodes-deleted', JSON.stringify(ids));
}

// ---------------- notes / code ----------------

export async function getNote(docId: string, scope: string = activeScope): Promise<NoteRow | undefined> {
  return (await getDB(scope)).get('notes', docId);
}

export async function putNote(row: NoteRow, scope: string = activeScope): Promise<void> {
  await (await getDB(scope)).put('notes', row);
  markDirty('note', row.docId);
}

export async function getCode(docId: string, scope: string = activeScope): Promise<CodeRow | undefined> {
  return (await getDB(scope)).get('code', docId);
}

export async function putCode(row: CodeRow, scope: string = activeScope): Promise<void> {
  await (await getDB(scope)).put('code', row);
  markDirty('code', row.docId);
}

// ---------------- images ----------------

export async function putImage(row: ImageRow, scope: string = activeScope): Promise<void> {
  await (await getDB(scope)).put('images', row);
  markDirty('image', row.id);
}

export async function getImage(id: string, scope: string = activeScope): Promise<ImageRow | undefined> {
  return (await getDB(scope)).get('images', id);
}

export interface DeletedImages {
  count: number;
  /** 供调用方 revoke objectURL */
  ids: string[];
}

/** 删除一批文档的笔记、代码、图片（不含目录节点本身） */
export async function deleteDocsData(docIds: string[], scope: string = activeScope): Promise<DeletedImages> {
  const d = await getDB(scope);
  const imgIds: string[] = [];
  const tx = d.transaction(['notes', 'code', 'images'], 'readwrite');
  const images = tx.objectStore('images');
  for (const docId of docIds) {
    tx.objectStore('notes').delete(docId);
    tx.objectStore('code').delete(docId);
    const keys = await images.index('by-doc').getAllKeys(docId);
    for (const k of keys) {
      imgIds.push(k);
      images.delete(k);
    }
  }
  await tx.done;
  return { count: imgIds.length, ids: imgIds };
}

// ---------------- settings / meta ----------------

export async function getSetting<T>(key: string, scope: string = activeScope): Promise<T | undefined> {
  const row = await (await getDB(scope)).get('settings', key);
  return row?.value as T | undefined;
}

export async function putSetting(key: string, value: unknown, scope: string = activeScope): Promise<void> {
  await (await getDB(scope)).put('settings', { key, value });
}

export async function getMeta<T>(key: string, scope: string = activeScope): Promise<T | undefined> {
  const row = await (await getDB(scope)).get('meta', key);
  return row?.value as T | undefined;
}

export async function putMeta(key: string, value: unknown, scope: string = activeScope): Promise<void> {
  await (await getDB(scope)).put('meta', { key, value });
}
