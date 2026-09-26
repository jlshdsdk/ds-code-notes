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

/** P1/P2 未登录阶段用 'local'；P3 登录后按用户切独立库名，首次登录做一次迁移 */
const dbCache = new Map<string, Promise<IDBPDatabase<DsSchema>>>();

export function getDB(scope = 'local'): Promise<IDBPDatabase<DsSchema>> {
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

export async function loadNodes(scope = 'local'): Promise<NodeRow[]> {
  return (await getDB(scope)).getAll('nodes');
}

export async function putNode(row: NodeRow, scope = 'local'): Promise<void> {
  await (await getDB(scope)).put('nodes', row);
}

export async function putNodes(rows: NodeRow[], scope = 'local'): Promise<void> {
  const d = await getDB(scope);
  const tx = d.transaction('nodes', 'readwrite');
  for (const r of rows) tx.store.put(r);
  await tx.done;
}

export async function deleteNodes(ids: string[], scope = 'local'): Promise<void> {
  const d = await getDB(scope);
  const tx = d.transaction('nodes', 'readwrite');
  for (const id of ids) tx.store.delete(id);
  await tx.done;
}

// ---------------- notes / code ----------------

export async function getNote(docId: string, scope = 'local'): Promise<NoteRow | undefined> {
  return (await getDB(scope)).get('notes', docId);
}

export async function putNote(row: NoteRow, scope = 'local'): Promise<void> {
  await (await getDB(scope)).put('notes', row);
}

export async function getCode(docId: string, scope = 'local'): Promise<CodeRow | undefined> {
  return (await getDB(scope)).get('code', docId);
}

export async function putCode(row: CodeRow, scope = 'local'): Promise<void> {
  await (await getDB(scope)).put('code', row);
}

// ---------------- images ----------------

export async function putImage(row: ImageRow, scope = 'local'): Promise<void> {
  await (await getDB(scope)).put('images', row);
}

export async function getImage(id: string, scope = 'local'): Promise<ImageRow | undefined> {
  return (await getDB(scope)).get('images', id);
}

export interface DeletedImages {
  count: number;
  /** 供调用方 revoke objectURL */
  ids: string[];
}

/** 删除一批文档的笔记、代码、图片（不含目录节点本身） */
export async function deleteDocsData(docIds: string[], scope = 'local'): Promise<DeletedImages> {
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

export async function getSetting<T>(key: string, scope = 'local'): Promise<T | undefined> {
  const row = await (await getDB(scope)).get('settings', key);
  return row?.value as T | undefined;
}

export async function putSetting(key: string, value: unknown, scope = 'local'): Promise<void> {
  await (await getDB(scope)).put('settings', { key, value });
}

export async function getMeta<T>(key: string, scope = 'local'): Promise<T | undefined> {
  const row = await (await getDB(scope)).get('meta', key);
  return row?.value as T | undefined;
}

export async function putMeta(key: string, value: unknown, scope = 'local'): Promise<void> {
  await (await getDB(scope)).put('meta', { key, value });
}
