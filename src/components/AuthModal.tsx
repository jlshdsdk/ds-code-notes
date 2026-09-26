import { useState } from 'preact/hooks';
import { sessionSig, signIn, signUp } from '../lib/sync';

export function AuthModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (busy) return;
    setMsg('');
    setBusy(true);
    try {
      if (mode === 'login') {
        const err = await signIn(email.trim(), pwd);
        if (err) setMsg(err);
        // 成功由 onAuthStateChange 处理（刷新页面）
      } else {
        const res = await signUp(email.trim(), pwd);
        if (res === null) {
          setMsg('注册成功，正在进入…');
        } else if (res === 'confirm') {
          setMsg('注册成功！请先到邮箱点击确认链接，再回来登录。');
          setMode('login');
        } else {
          setMsg(res);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  if (sessionSig.value) return null;

  return (
    <div class="modal-mask" onClick={onClose}>
      <div class="modal narrow" onClick={e => e.stopPropagation()}>
        <div class="modal-title">{mode === 'login' ? '登录' : '注册新账号'}</div>
        <div class="auth-form">
          <input
            type="email"
            placeholder="邮箱"
            value={email}
            onInput={e => setEmail((e.target as HTMLInputElement).value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void submit();
            }}
          />
          <input
            type="password"
            placeholder="密码（至少 6 位）"
            value={pwd}
            onInput={e => setPwd((e.target as HTMLInputElement).value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void submit();
            }}
          />
          {msg && <div class="auth-msg">{msg}</div>}
          <button class="primary" disabled={busy || !email || !pwd} onClick={() => void submit()}>
            {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册'}
          </button>
          <button
            class="ghost-btn"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setMsg('');
            }}
          >
            {mode === 'login' ? '没有账号？去注册' : '已有账号？去登录'}
          </button>
        </div>
      </div>
    </div>
  );
}
