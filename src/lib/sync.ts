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
import { setNodeMap, restoreUiState, currentDocId } from '../state';
import { initExpanded } from '../components/Sidebar';
import type { NodeRow } from '../types';

export type SyncStatus = 'local' | 'pending' | 'syncing' | 'synced' | 'offline' | 'uninit';
export const syncStatus = signal<SyncStatus>('local');
export const sessionSig = signal<Session | null>(null);
export const profileSig = signal<{ email: string; isAdmin: boolean } | null>(null);

/** 云端表还没建（用户未执行 supabase_setup_ds.sql）——与网络故障区分开 */
function isUninitError(e: unknown): boolean {
  const m = String((e as { message?: string })?.message ?? e ?? '').toLowerCase();
  return (
    m.includes('does not exist') ||
    m.includes('schema cache') ||
    m.includes('pgrst205') ||
    m.includes('42p01')
  );
}

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
  return {
    nodes: new Set(),
    notes: new Set(),
    code: new Set(),
    images: new Set(),
    deletedNodes: [],
  };
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushBusy = false;
let pullBusy = false;

function onDirty(kind: DirtyKind, id: string | string[]): void {
  if (getScope() === 'local' || !sessionSig.value) return;
  switch (kind) {
    case 'node':
      dirty.nodes.add(id as string);
      break;
    case 'note':
      dirty.notes.add(id as string);
      break;
    case 'code':
      dirty.code.add(id as string);
      break;
    case 'image':
      dirty.images.add(id as string);
      break;
    case 'nodes-deleted':
      dirty.deletedNodes.push(id as string[]);
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

function toRemoteNode(r: NodeRow): RemoteNode {
  return {
    id: r.id,
    user_id: '',
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

const PAGE = 1000;

/** 分页拉全量（Supabase 默认单请求最多 1000 行） */
async function selectSince(
  table: 'ds_nodes' | 'ds_notes' | 'ds_code' | 'ds_tombstones',
  column: 'updated_at' | 'deleted_at',
  sinceIso: string
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (let p = 0; ; p++) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .gte(column, sinceIso)
      .order(column, { ascending: true })
      .range(p * PAGE, (p + 1) * PAGE - 1);
    throwIf(error);
    all.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

export async function pushNow(): Promise<void> {
  const s = sessionSig.value;
  if (!s || getScope() === 'local' || pushBusy) return;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  pushBusy = true;
  const snap = dirty;
  dirty = freshDirty();
  const uid = s.user.id;
  syncStatus.value = 'syncing';
  let didWork = false;
  try {
    const d = await getDB();
    if (snap.nodes.size) {
      const rows = (await d.getAll('nodes'))
        .filter(r => snap.nodes.has(r.id))
        .map(toRemoteNode);
      // updated_at 由服务器 trigger 统一改写（唯一时钟源）
      if (rows.length) {
        throwIf(
          (
            await supabase
              .from('ds_nodes')
              .upsert(rows.map(r => ({ ...r, user_id: uid })))
          ).error
        );
        didWork = true;
      }
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
      if (rows.length) {
        throwIf((await supabase.from('ds_notes').upsert(rows)).error);
        didWork = true;
      }
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
      if (rows.length) {
        throwIf((await supabase.from('ds_code').upsert(rows)).error);
        didWork = true;
      }
    }
    if (snap.images.size) {
      await Promise.all(
        [...snap.images].map(async imgId => {
          const row = await d.get('images', imgId);
          if (!row) return;
          const path = `${uid}/${row.docId}/${imgId}`;
          throwIf(
            (
              await supabase.storage
                .from('ds-images')
                .upload(path, row.blob, {
                  upsert: true,
                  contentType: row.blob.type || 'image/jpeg',
                })
            ).error
          );
        })
      );
      didWork = true;
    }
    if (snap.deletedNodes.length) {
      const ids = [...new Set(snap.deletedNodes.flat())];
      throwIf((await supabase.from('ds_nodes').delete().in('id', ids)).error);
      throwIf(
        (await supabase.from('ds_tombstones').upsert(ids.map(id => ({ id, user_id: uid })))).error
      );
      // 远端级联删了 ds_notes/ds_code；存储桶里的图片目录做尽力清理
      const bucket = supabase.storage.from('ds-images');
      for (const id of ids) {
        const { data: files } = await bucket.list(`${uid}/${id}`, { limit: 1000 });
        if (files && files.length > 0) {
          await bucket
            .remove(files.map(f => `${uid}/${id}/${f.name}`))
            .catch(() => {});
        }
      }
      didWork = true;
    }
    syncStatus.value = 'synced';
    // 推送成功后拉一次，让本地 updated_at 收敛到服务器时钟（有脏保护不会覆盖未推送修改）
    if (didWork) setTimeout(() => void pullNow(), 800);
  } catch (e) {
    snap.nodes.forEach(id => dirty.nodes.add(id));
    snap.notes.forEach(id => dirty.notes.add(id));
    snap.code.forEach(id => dirty.code.add(id));
    snap.images.forEach(id => dirty.images.add(id));
    dirty.deletedNodes.push(...snap.deletedNodes);
    if (isUninitError(e)) {
      // 云表未建：保留脏集合但不空转重试，等下次触发（编辑/聚焦/上线）
      syncStatus.value = 'uninit';
    } else {
      syncStatus.value = 'pending';
      pushTimer = setTimeout(() => void pushNow(), 5000);
    }
  } finally {
    pushBusy = false;
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
    const missing = [] as string[];
    for (const f of files ?? []) {
      if (!(await d.get('images', f.name))) missing.push(f.name);
    }
    await Promise.all(
      missing.map(async imgId => {
        const { data: blob, error: e3 } = await bucket.download(`${uid}/${docId}/${imgId}`);
        if (e3 || !blob) return;
        await d.put('images', { id: imgId, docId, blob, updatedAt: Date.now() });
      })
    );
  }
}

export async function pullNow(): Promise<void> {
  const s = sessionSig.value;
  if (!s || pullBusy || pushBusy || getScope() === 'local') return;
  pullBusy = true;
  syncStatus.value = 'syncing';
  try {
    const d = await getDB();
    const lastMs = (await getMeta<number>('lastPullAt')) ?? 0;
    const since = new Date(Math.max(0, lastMs - 5000)).toISOString();
    const [nR, noR, cR, tR] = await Promise.all([
      selectSince('ds_nodes', 'updated_at', since),
      selectSince('ds_notes', 'updated_at', since),
      selectSince('ds_code', 'updated_at', since),
      selectSince('ds_tombstones', 'deleted_at', since),
    ]);

    // 本地有未推送修改的行不被远端覆盖（时间基准不同，内容优先）
    const dirtyNode = new Set(dirty.nodes);

    // 墓碑先行：远端已删除的节点本地跟着删（失败即抛，不推进 lastPullAt）
    const tombs = new Set(tR.map(t => t.id as string));
    for (const id of tombs) {
      await d.delete('nodes', id);
      await d.delete('notes', id);
      await d.delete('code', id);
      const imgKeys = await d.getAllKeysFromIndex('images', 'by-doc', id);
      for (const k of imgKeys) await d.delete('images', k);
    }

    let maxServerMs = Date.parse(since);
    const bump = (v: unknown) => {
      const ms = Date.parse(String(v));
      if (Number.isFinite(ms) && ms > maxServerMs) maxServerMs = ms;
    };

    // LWW 合并（远端较新才覆盖本地；本地脏行跳过）
    for (const raw of nR) {
      const rn = raw as unknown as RemoteNode;
      bump(rn.updated_at);
      if (tombs.has(rn.id) || dirtyNode.has(rn.id)) continue;
      const local = await d.get('nodes', rn.id);
      if (!local || local.updatedAt < Date.parse(rn.updated_at)) {
        await d.put('nodes', fromRemoteNode(rn));
      }
    }
    for (const raw of noR) {
      const rn = raw as unknown as { doc_id: string; html: string; updated_at: string };
      bump(rn.updated_at);
      if (tombs.has(rn.doc_id) || dirty.notes.has(rn.doc_id)) continue;
      const local = await d.get('notes', rn.doc_id);
      if (!local || local.updatedAt < Date.parse(rn.updated_at)) {
        await d.put('notes', { docId: rn.doc_id, html: rn.html ?? '', updatedAt: Date.parse(rn.updated_at) });
      }
    }
    for (const raw of cR) {
      const rn = raw as unknown as { doc_id: string; code: string; updated_at: string };
      bump(rn.updated_at);
      if (tombs.has(rn.doc_id) || dirty.code.has(rn.doc_id)) continue;
      const local = await d.get('code', rn.doc_id);
      if (!local || local.updatedAt < Date.parse(rn.updated_at)) {
        await d.put('code', { docId: rn.doc_id, code: rn.code ?? '', updatedAt: Date.parse(rn.updated_at) });
      }
    }

    await syncImagesFromCloud(d, s.user.id);
    // lastPullAt 用服务器时钟（远端行时间），避免客户端快钟漏拉
    await putMeta('lastPullAt', maxServerMs);
    setNodeMap(await loadNodes());
    syncStatus.value = 'synced';
  } catch (e) {
    syncStatus.value = isUninitError(e) ? 'uninit' : 'offline';
  } finally {
    pullBusy = false;
  }
}

// ---------------- 登录态与作用域切换 ----------------

async function adoptScope(userId: string): Promise<void> {
  setScope(userId);
  setNodeMap(await loadNodes());
  // 新设备/空树场景强制全量拉取（清掉增量游标），杜绝"登录后一片空白"
  if ((await loadNodes()).length === 0) await putMeta('lastPullAt', 0);
  // 先拉平云端，再合并未登录期的本地数据，避免本机旧数据回滚云端
  await pullNow();
  const guestNodes = await loadNodes('local');
  if (guestNodes.length > 0) {
    const src = await getDB('local');
    const dst = await getDB(userId);
    const [gNotes, gCodes, gImages] = await Promise.all([
      src.getAll('notes'),
      src.getAll('code'),
      src.getAll('images'),
    ]);
    const pushNodes: string[] = [];
    const pushNotes: string[] = [];
    const pushCodes: string[] = [];
    const pushImages: string[] = [];
    for (const n of guestNodes) {
      const ex = await dst.get('nodes', n.id);
      if (!ex) {
        await dst.put('nodes', n);
        pushNodes.push(n.id);
      } else if (n.updatedAt > ex.updatedAt + 2000) {
        // 云端行是服务器时钟、本地是客户端时钟，加 2s 容差偏保守合并
        await dst.put('nodes', n);
        pushNodes.push(n.id);
      }
    }
    for (const n of gNotes) {
      const ex = await dst.get('notes', n.docId);
      if (!ex) {
        await dst.put('notes', n);
        pushNotes.push(n.docId);
      } else if (n.updatedAt > ex.updatedAt + 2000) {
        await dst.put('notes', n);
        pushNotes.push(n.docId);
      }
    }
    for (const n of gCodes) {
      const ex = await dst.get('code', n.docId);
      if (!ex) {
        await dst.put('code', n);
        pushCodes.push(n.docId);
      } else if (n.updatedAt > ex.updatedAt + 2000) {
        await dst.put('code', n);
        pushCodes.push(n.docId);
      }
    }
    for (const n of gImages) {
      if (!(await dst.get('images', n.id))) {
        await dst.put('images', n);
        pushImages.push(n.id);
      }
    }
    await putMeta('migrated', true, 'local');
    if (
      pushNodes.length + pushNotes.length + pushCodes.length + pushImages.length > 0
    ) {
      pushNodes.forEach(id => dirty.nodes.add(id));
      pushNotes.forEach(id => dirty.notes.add(id));
      pushCodes.forEach(id => dirty.code.add(id));
      pushImages.forEach(id => dirty.images.add(id));
      setNodeMap(await loadNodes());
      await pushNow();
    }
  }
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
  // 关页/切走前把待推送的改动立即上云（不等待 1.5s 防抖）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && sessionSig.value) void pushNow();
  });
  // 页面回焦：空树且已登录 → 强制全量拉取（兜底"别的设备看不到数据"）
  window.addEventListener('focus', () => {
    if (!sessionSig.value || getScope() === 'local') return;
    void (async () => {
      if ((await loadNodes()).length === 0) await putMeta('lastPullAt', 0);
      void pullNow();
    })();
  });
  setInterval(() => {
    if (!sessionSig.value) return;
    void pullNow();
    void refreshProfile(sessionSig.value!); // 禁用状态周期性生效
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
        // 同一用户重复触发（令牌刷新/网络抖动/页面回焦）时忽略，绝不整页刷新
        const prev = sessionSig.value;
        if (prev?.user.id === s2.user.id && getScope() === s2.user.id) return;
        sessionSig.value = s2;
        await adoptScope(s2.user.id);
        restoreUiState();
        initExpanded(currentDocId.value);
      })();
    } else if (ev === 'SIGNED_OUT') {
      void (async () => {
        // 网络抖动可能产生假登出事件：核实会话真没了才切换
        const { data } = await supabase.auth.getSession();
        if (data.session) return;
        sessionSig.value = null;
        profileSig.value = null;
        dirty = freshDirty();
        setScope('local');
        setNodeMap(await loadNodes());
        restoreUiState();
        initExpanded(currentDocId.value);
        syncStatus.value = 'local';
      })();
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
