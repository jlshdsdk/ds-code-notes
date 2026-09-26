import { signal } from '@preact/signals';
import { showSettings } from '../state';

export const searchQuery = signal('');

export function TopBar() {
  return (
    <header class="topbar">
      <span class="brand">数据结构代码笔记</span>
      <input
        class="search-box"
        placeholder="搜索（云同步阶段接入）"
        value={searchQuery.value}
        disabled
      />
      <div class="topbar-right">
        <button class="ghost-btn" onClick={() => (showSettings.value = true)} title="代码外观设置">
          ⚙ 设置
        </button>
      </div>
    </header>
  );
}
