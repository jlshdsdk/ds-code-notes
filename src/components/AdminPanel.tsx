import { useEffect, useState } from 'preact/hooks';
import { listUsers, setBanned, type AdminUser } from '../lib/sync';
import { showToast } from '../state';

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function reload(): Promise<void> {
    try {
      setUsers(await listUsers());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function toggleBan(u: AdminUser): Promise<void> {
    if (u.is_admin) {
      showToast('不能禁用管理员账号');
      return;
    }
    setBusy(true);
    try {
      await setBanned(u.id, !u.banned);
      await reload();
      showToast(u.banned ? '已解禁' : '已禁用');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="modal-mask" onClick={onClose}>
      <div class="modal" onClick={e => e.stopPropagation()}>
        <div class="modal-title">用户管理（管理员）</div>
        {err && <div class="auth-msg">{err}</div>}
        <div class="admin-list">
          {users.map(u => (
            <div class="admin-row" key={u.id}>
              <div class="admin-info">
                <span class="admin-email">{u.email ?? u.id.slice(0, 8)}</span>
                <span class="admin-tags">
                  {u.is_admin && <em class="tag-admin">管理员</em>}
                  {u.banned && <em class="tag-banned">已禁用</em>}
                </span>
              </div>
              <button
                class="ghost-btn"
                disabled={busy || u.is_admin}
                onClick={() => void toggleBan(u)}
              >
                {u.banned ? '解禁' : '禁用'}
              </button>
            </div>
          ))}
          {users.length === 0 && !err && <div class="tree-empty">加载中…</div>}
        </div>
        <div class="modal-actions">
          <button class="primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
