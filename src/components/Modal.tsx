import { confirmState, toastMsg } from '../state';

export function ConfirmHost() {
  const c = confirmState.value;
  if (!c) return null;
  return (
    <div class="modal-mask" onClick={() => (confirmState.value = null)}>
      <div class="modal narrow" onClick={e => e.stopPropagation()}>
        <div class="modal-title">{c.title}</div>
        <div class="modal-body">{c.body}</div>
        <div class="modal-actions">
          <button class="ghost-btn" onClick={() => (confirmState.value = null)}>
            取消
          </button>
          <button
            class={c.danger ? 'danger' : 'primary'}
            onClick={() => {
              confirmState.value = null;
              void c.onOk();
            }}
          >
            {c.okText ?? '确定'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Toast() {
  const t = toastMsg.value;
  return t ? <div class="toast">{t}</div> : null;
}
