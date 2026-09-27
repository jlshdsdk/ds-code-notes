import { useEffect, useState } from 'preact/hooks';
import { Sidebar, initExpanded } from './components/Sidebar';
import { DocPane } from './components/DocPane';
import { TopBar } from './components/TopBar';
import { SettingsPanel } from './components/SettingsPanel';
import { ConfirmHost, Toast } from './components/Modal';
import { currentDocId, enableUiPersist, restoreUiState, setNodeMap } from './state';
import { loadNodes } from './lib/db';
import { loadSettings } from './lib/settings';
import { initAuth } from './lib/sync';

export function App() {
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        await loadSettings();
        await initAuth();
        setNodeMap(await loadNodes());
        // 恢复上次打开的笔记与目录展开状态，恢复完成后再允许持久化写入
        restoreUiState();
        initExpanded(currentDocId.value);
        enableUiPersist();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
      setReady(true);
    })();
  }, []);

  if (err) return <div class="boot">初始化失败：{err}</div>;
  if (!ready) return <div class="boot">加载中…</div>;

  return (
    <div class="app">
      <TopBar />
      <div class="main">
        <Sidebar />
        <DocPane />
      </div>
      <ConfirmHost />
      <SettingsPanel />
      <Toast />
    </div>
  );
}
