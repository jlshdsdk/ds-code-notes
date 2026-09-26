import { signal } from '@preact/signals';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import {
  getDB,
  getMeta,
  getScope,
  loadNodes,
  putMeta,
  setDirtyHook,
  setScope,
  type DirtyKind,
} from './db';
import { setNodeMap } from '../state';
import type { NodeRow } from '../types';

export type SyncStatus = 'local' | 'pending' | 'syncing' | 'synced' | 'offline';
export const syncStatus = signal<SyncStatus>('local');
export const sessionSig = signal<Session | null>(null);
export const profileSig = signal<{ email: string; isAdmin: boolean } | null>(null);

// ---------------- 脏集合与推送 ----------------

interface DirtySets {
  nodes: Set<string>;
  notes: Set<string>;
  code: Set<string>;
  images: Set<string>;
  deletedNodes: string[][];
}
let dirty: DirtySets = freshDirty();
function freshDirty(): DirtySets {
  return { nodes: new Set(), notes: new Set(), code: new Set(), images: new Set(), deletedNodes: [] };
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pullBusy = false;

function onDirty(kind: DirtyKind, id: string): void {
  if (getScope() === 'local' || !sessionSig.value) return;
  switch (kind) {
    case 'node':
      dirty.nodes.add(id);
      break;
    case 'note':
      dirty.notes.add(id);
      break;
    case 'code':
      dirty.code.add(id);
      break;
    case 'image':
      dirty.images.add(id);
      break;
    case 'nodes-deleted':
      dirty.deletedNodes.push(JSON.parse(id) as string[]);
      break;
  }
  syncStatus.value = 'pending';
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void pushNow(), 1500);
}

interface RemoteNode {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  kind: string;
  sort_order: number;
  updated_at: string;
}

function toRemoteNode(r: NodeRow, uid: string): RemoteNode {
  return {
    id: r.id,
    user_id: uid,
    parent_id: r.parentId,
    name: r.name,
    kind: r.kind,
    sort_order: r.order,
    updated_at: new Date(r.updatedAt).toISOString(),
  };
}

function fromRemoteNode(r: RemoteNode): NodeRow {
  return {
    id: r.id,
    parentId: r.parent_id,
    name: r.name,
    kind: r.kind === 'doc' ? 'doc' : 'dir',
    order: r.sort_order,
    updatedAt: Date.parse(r.updated_at),
  };
}

function throwIf(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function pushNow(): Promise<void> {
  const s = sessionSig.value;
  if (!s || getScope() === 'local') return;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  const snap = dirty;
  dirty = freshDirty();
  const uid = s.user.id;
  syncStatus.value = 'syncing';
  try {
    const d = await getDB();
    if (snap.nodes.size) {
      const rows = (await d.getAll('nodes'))
        .filter(r => snap.nodes.has(r.id))
        .map(r => toRemoteNode(r, uid));
      if (rows.length) throwIf((await supabase.from('ds_nodes').upsert(rows)).error);
    }
    if (snap.notes.size) {
      const rows = (await d.getAll('notes'))
        .filter(r => snap.notes.has(r.docId))
        .map(r => ({
          doc_id: r.docId,
          user_id: uid,
          html: r.html,
          updated_at: new Date(r.updatedAt).toISOString(),
        }));
      if (rows.length) throwIf((await supabase.from('ds_notes').upsert(rows)).error);
    }
    if (snap.code.size) {
      const rows = (await d.getAll('code'))
        .filter(r => snap.code.has(r.docId))
        .map(r => ({
          doc_id: r.docId,
          user_id: uid,
          code: r.code,
          updated_at: new Date(r.updatedAt).toISOString(),
        }));
      if (rows.length) throwIf((await supabase.from('ds_code').upsert(rows)).error);
    }
    for (const imgId of snap.images) {
      const row = await d.get('images', imgId);
      if (!row) continue;
      const path = `${uid}/${row.docId}/${imgId}`;
      throwIf(
        (
          await supabase.storage
            .from('ds-images')
            .upload(path, row.blob, { upsert: true, contentType: row.blob.type || 'image/jpeg' })
        ).error
      );
    }
    if (snap.deletedNodes.length) {
      const ids = [...new Set(snap.deletedNodes.flat())];
      throwIf((await supabase.from('ds_nodes').delete().in('id', ids)).error);
      throwIf(
        (
          await supabase
            .from('ds_tombstones')
            .upsert(ids.map(id => ({ id, user_id: uid })))
        ).error
      );
    }
    syncStatus.value = 'synced';
  } catch {
    // 失败回灌脏集合，稍后自动重试
    snap.nodes.forEach(id => dirty.nodes.add(id));
    snap.notes.forEach(id => dirty.notes.add(id));
    snap.code.forEach(id => dirty.code.add(id));
    snap.images.forEach(id => dirty.images.add(id));
    dirty.deletedNodes.push(...snap.deletedNodes);
    syncStatus.value = 'pending';
    pushTimer = setTimeout(() => void pushNow(), 5000);
  }
}

// ---------------- 拉取与合并 ----------------

async function syncImagesFromCloud(d: Awaited<ReturnType<typeof getDB>>, uid: string): Promise<void> {
  const bucket = supabase.storage.from('ds-images');
  const { data: folders, error } = await bucket.list(uid, { limit: 1000 });
  throwIf(error);
  for (const folder of folders ?? []) {
    if (folder.id !== null) continue; // 顶层只应有 docId 目录占位
    const docId = folder.name;
    const { data: files, error: e2 } = await bucket.list(`${uid}/${docId}`, { limit: 1000 });
    if (e2) continue;
    for (const f of files ?? []) {
      const imgId = f.name;
      if (await d.get('images', imgId)) continue;
      const { data: blob, error: e3 } = await bucket.download(`${uid}/${docId}/${imgId}`);
      if (e3 || !blob) continue;
      await d.put('images', { id: imgId, docId, blob, updatedAt: Date.now() });
    }
  }
}

export async function pullNow(): Promise<void> {
  const s = sessionSig.value;
  if (!s || pullBusy || getScope() === 'local') return;
  pullBusy = true;
  syncStatus.value = 'syncing';
  try {
    const d = await getDB();
    const lastMs = (await getMeta<number>('lastPullAt')) ?? 0;
    const since = new Date(Math.max(0, lastMs - 5000)).toISOString();
    const [nR, noR, cR, tR] = await Promise.all([
      supabase.from('ds_nodes').select('*').gte('updated_at', since),
      supabase.from('ds_notes').select('*').gte('updated_at', since),
      supabase.from('ds_code').select('*').gte('updated_at', since),
      supabase.from('ds_tombstones').select('*').gte('deleted_at', since),
    ]);
    throwIf(nR.error);
    throwIf(noR.error);
    throwIf(cR.error);
    throwIf(tR.error);

    // 墓碑先行：远端已删除的节点本地跟着删
    const tombs = new Set(((tR.data ?? []) as Array<{ id: string }>).map(t => t.id));
    for (const id of tombs) {
      await d.delete('nodes', id).catch(() => {});
      await d.delete('notes', id).catch(() => {});
      await d.delete('code', id).catch(() => {});
      const imgKeys = await d.getAllKeysFromIndex('images', 'by-doc', id).catch(() => [] as string[]);
      for (const k of imgKeys) await d.delete('images', k).catch(() => {});
    }

    // LWW 合并（远端较新才覆盖本地）
    for (const rn of (nR.data ?? []) as unknown as RemoteNode[]) {
      if (tombs.has(rn.id)) continue;
      const local = await d.get('nodes', rn.id);
      const rMs = Date.parse(rn.updated_at);
      if (!local || local.updatedAt < rMs) await d.put('nodes', fromRemoteNode(rn));
    }
    for (const rn of (noR.data ?? []) as unknown as Array<{ doc_id: string; html: string; updated_at: string }>) {
      if (tombs.has(rn.doc_id)) continue;
      const local = await d.get('notes', rn.doc_id);
      const rMs = Date.parse(rn.updated_at);
      if (!local || local.updatedAt < rMs) {
        await d.put('notes', { docId: rn.doc_id, html: rn.html ?? '', updatedAt: rMs });
      }
    }
    for (const rn of (cR.data ?? []) as unknown as Array<{ doc_id: string; code: string; updated_at: string }>) {
      if (tombs.has(rn.doc_id)) continue;
      const local = await d.get('code', rn.doc_id);
      const rMs = Date.parse(rn.updated_at);
      if (!local || local.updatedAt < rMs) {
        await d.put('code', { docId: rn.doc_id, code: rn.code ?? '', updatedAt: rMs });
      }
    }

    await syncImagesFromCloud(d, s.user.id);
    await putMeta('lastPullAt', Date.now());
    setNodeMap(await loadNodes());
    syncStatus.value = 'synced';
  } catch {
    syncStatus.value = 'offline';
  } finally {
    pullBusy = false;
  }
}

// ---------------- 登录态与作用域切换 ----------------

async function adoptScope(userId: string): Promise<void> {
  // 首次登录：把未登录期的本地数据合并进用户库（LWW），只做一次
  const migrated = await getMeta<boolean>('migrated', 'local');
  const localNodes = await loadNodes('local');
  if (localNodes.length > 0 && !migrated) {
    const src = await getDB('local');
    const dst = await getDB(userId);
    const [localNotes, localCodes, localImages] = await Promise.all([
      src.getAll('notes'),
      src.getAll('code'),
      src.getAll('images'),
    ]);
    for (const n of localNodes) {
      const existing = await dst.get('nodes', n.id);
      if (!existing || existing.updatedAt < n.updatedAt) await dst.put('nodes', n);
    }
    for (const n of localNotes) {
      const existing = await dst.get('notes', n.docId);
      if (!existing || existing.updatedAt < n.updatedAt) await dst.put('notes', n);
    }
    for (const n of localCodes) {
      const existing = await dst.get('code', n.docId);
      if (!existing || existing.updatedAt < n.updatedAt) await dst.put('code', n);
    }
    for (const n of localImages) {
      if (!(await dst.get('images', n.id))) await dst.put('images', n);
    }
    await putMeta('migrated', true, 'local');
  }
  setScope(userId);
  setNodeMap(await loadNodes());
  // 迁移进来的数据要推上云
  void (async () => {
    const d = await getDB();
    (await d.getAll('nodes')).forEach(r => dirty.nodes.add(r.id));
    (await d.getAll('notes')).forEach(r => dirty.notes.add(r.docId));
    (await d.getAll('code')).forEach(r => dirty.code.add(r.docId));
    (await d.getAll('images')).forEach(r => dirty.images.add(r.id));
    syncStatus.value = 'pending';
    await pushNow();
  })();
}

async function refreshProfile(s: Session): Promise<void> {
  const { data, error } = await supabase
    .from('profiles')
    .select('email,is_admin,banned')
    .eq('id', s.user.id)
    .single();
  if (error || !data) {
    profileSig.value = { email: s.user.email ?? '', isAdmin: false };
    return;
  }
  if ((data as { banned?: boolean }).banned) {
    await supabase.auth.signOut();
    alert('该账号已被管理员禁用');
    return;
  }
  profileSig.value = {
    email: (data as { email?: string }).email ?? s.user.email ?? '',
    isAdmin: !!(data as { is_admin?: boolean }).is_admin,
  };
}

export async function initAuth(): Promise<void> {
  setDirtyHook(onDirty);
  window.addEventListener('online', () => {
    if (sessionSig.value) void pushNow();
  });
  window.addEventListener('focus', () => {
    if (sessionSig.value) void pullNow();
  });
  setInterval(() => {
    if (sessionSig.value) void pullNow();
  }, 90_000);

  const { data } = await supabase.auth.getSession();
  const s = data.session ?? null;
  sessionSig.value = s;
  if (s) {
    await adoptScope(s.user.id);
    await refreshProfile(s);
    void pullNow();
  } else {
    syncStatus.value = 'local';
  }
  supabase.auth.onAuthStateChange((ev, s2) => {
    if (ev === 'SIGNED_IN' && s2) {
      void (async () => {
        sessionSig.value = s2;
        await adoptScope(s2.user.id);
        location.reload();
      })();
    } else if (ev === 'SIGNED_OUT') {
      sessionSig.value = null;
      profileSig.value = null;
      setScope('local');
      location.reload();
    }
  });
}

// ---------------- 登录/注册 API（给 AuthModal 用） ----------------

function zhAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) return '邮箱或密码错误';
  if (m.includes('already registered')) return '该邮箱已注册，请直接登录';
  if (m.includes('password should be at least')) return '密码至少 6 位';
  if (m.includes('email not confirmed')) return '邮箱未验证，请先查收确认邮件';
  if (m.includes('rate limit')) return '操作过于频繁，请稍后再试';
  return msg;
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? zhAuthError(error.message) : null;
}

/** 返回 null=已登录；'confirm'=需要邮箱验证；其他字符串=错误信息 */
export async function signUp(email: string, password: string): Promise<string | null> {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return zhAuthError(error.message);
  if (!data.session) return 'confirm';
  return null;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

// ---------------- 管理员面板 API ----------------

export interface AdminUser {
  id: string;
  email: string | null;
  nickname: string | null;
  is_admin: boolean;
  banned: boolean;
  created_at: string;
}

export async function listUsers(): Promise<AdminUser[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data as AdminUser[];
}

export async function setBanned(id: string, banned: boolean): Promise<void> {
  const { error } = await supabase.from('profiles').update({ banned }).eq('id', id);
  if (error) throw error;
}
