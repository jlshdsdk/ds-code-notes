import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_SETTINGS, type AppSettings } from '../types';
import { settings, showSettings } from '../state';
import { saveSettings } from '../lib/settings';

const PREVIEW = '// 这是注释（颜色可调）\n#include <vector>\nint main() {\n    std::vector<int> v{3, 1, 2};\n    return v.size(); // 行尾注释\n}';

export function SettingsPanel() {
  if (!showSettings.value) return null;
  return <SettingsModal />;
}

function SettingsModal() {
  const s = settings.value;
  const [previewHtml, setPreviewHtml] = useState('');
  useEffect(() => {
    void import('../lib/highlight').then(m => setPreviewHtml(m.highlightCpp(PREVIEW)));
  }, []);
  const set = (patch: Partial<AppSettings>) => void saveSettings({ ...s, ...patch });
  return (
    <div class="modal-mask" onClick={() => (showSettings.value = false)}>
      <div class="modal" onClick={e => e.stopPropagation()}>
        <div class="modal-title">代码外观设置</div>
        <div class="set-row">
          <label>
            注释颜色
            <input
              type="color"
              value={s.commentColor}
              onInput={e => set({ commentColor: (e.target as HTMLInputElement).value })}
            />
          </label>
          <button class="ghost-btn" onClick={() => set({ commentColor: DEFAULT_SETTINGS.commentColor })}>
            恢复默认
          </button>
        </div>
        <div class="set-row">
          <label>
            编辑器背景
            <input
              type="color"
              value={s.editorBg}
              onInput={e => set({ editorBg: (e.target as HTMLInputElement).value })}
            />
          </label>
          <button class="ghost-btn" onClick={() => set({ editorBg: DEFAULT_SETTINGS.editorBg })}>
            恢复默认
          </button>
        </div>
        <div class="set-preview">
          <pre class="ds-snippet">
            <code dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </pre>
        </div>
        <div class="modal-actions">
          <button class="primary" onClick={() => (showSettings.value = false)}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
