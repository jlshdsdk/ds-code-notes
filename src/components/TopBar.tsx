import { signal } from '@preact/signals';
import { useRef, useState } from 'preact/hooks';
import { currentDocId, showSettings } from '../state';
import { searchAll, type SearchHit } from '../lib/search';
import { profileSig, sessionSig, syncStatus, pullNow, signOut } from '../lib/sync';
import { AuthModal } from './AuthModal';
import { AdminPanel } from './AdminPanel';

export const showAuth = signal(false);
export const showAdmin = signal(false);

const SYNC_ICON: Record<string, string> = {
  local: '⛓️ 未登录',
  pending: '⏳ 待同步',
  syncing: '🔄 同步中',
  synced: '☁️ 已同步',
  offline: '⚠️ 离线',
  uninit: '🗄️ 云未初始化',
};

const SYNC_TITLE: Record<string, string> = {
  local: '点击登录 / 注册',
  pending: '有改动待推送到云端，点击立即同步',
  syncing: '正在与云端同步…',
  synced: '已与云端同步，点击立即拉取',
  offline: '刚才的同步请求失败（网络问题），稍后会自动重试',
  uninit: '云端数据表还没建：请先在 Supabase SQL Editor 执行仓库里的 supabase_setup_ds.sql，执行完刷新本页即可',
};

export function TopBar() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onInput(v: string): void {
    setQ(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!v.trim()) {
      setHits(null);
      setSearchOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const h = await searchAll(v);
      setHits(h);
      setSearchOpen(true);
    }, 250);
  }

  function openHit(h: SearchHit): void {
    if (!h.isDoc) return;
    currentDocId.value = h.nodeId;
    setSearchOpen(false);
    setQ('');
    setHits(null);
  }

  const sess = sessionSig.value;
  const st = syncStatus.value;

  return (
    <header class="topbar">
      <span class="brand">数据结构代码笔记</span>
      <div class="search-wrap">
        <input
          class="search-box"
          placeholder="搜索标题 / 笔记 / 代码…"
          value={q}
          onInput={e => onInput((e.target as HTMLInputElement).value)}
          onKeyDown={e => {
            if (e.key === 'Escape') setSearchOpen(false);
          }}
        />
        {searchOpen && hits && (
          <div class="search-panel">
            {hits.length === 0 && <div class="search-empty">无结果</div>}
            {hits.map((h, i) => (
              <div
                class={`search-hit${h.isDoc ? '' : ' hit-dir'}`}
                key={`${h.nodeId}-${i}`}
                onClick={() => openHit(h)}
              >
                <span class="search-where">{h.where}</span>
                <span class="search-path" title={h.path}>
                  {h.path}
                </span>
                <span class="search-snippet">{h.snippet}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div class="topbar-right">
        <button
          class="ghost-btn sync-btn"
          title={SYNC_TITLE[st] ?? ''}
          onClick={() => (sess ? void pullNow() : (showAuth.value = true))}
        >
          {SYNC_ICON[st] ?? ''}
        </button>
        {sess && profileSig.value?.isAdmin && (
          <button class="ghost-btn" onClick={() => (showAdmin.value = true)}>
            👥 用户
          </button>
        )}
        {sess && <span class="user-email">{profileSig.value?.email}</span>}
        {sess && (
          <button class="ghost-btn" onClick={() => void signOut()}>
            退出
          </button>
        )}
        <button class="ghost-btn" onClick={() => (showSettings.value = true)} title="代码外观设置">
          ⚙ 设置
        </button>
      </div>
      {showAuth.value && <AuthModal onClose={() => (showAuth.value = false)} />}
      {showAdmin.value && <AdminPanel onClose={() => (showAdmin.value = false)} />}
    </header>
  );
}
