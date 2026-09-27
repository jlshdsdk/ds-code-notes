import { useEffect, useState } from 'preact/hooks';
import { Sidebar, initExpanded } from './components/Sidebar';
import { DocPane } from './components/DocPane';
import { TopBar } from './components/TopBar';
import { SettingsPanel } from './components/SettingsPanel';
import { ConfirmHost, Toast } from './components/Modal';
import { currentDocId, enableUiPersist, restoreUiState, setNodeMap, showToast } from './state';
import { loadNodes } from './lib/db';
import { loadSettings } from './lib/settings';
import { initAuth, syncStatus } from './lib/sync';

export function App() {
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      // 先用本地数据渲染（不等云端），避免每次进入白屏等待
      try {
        await loadSettings();
        setNodeMap(await loadNodes());
        restoreUiState();
        initExpanded(currentDocId.value);
        enableUiPersist();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setReady(true);
        return;
      }
      setReady(true);
      // 云端接管放后台：失败不影响本地使用
      try {
        await initAuth();
      } catch (e) {
        showToast('云端连接失败，当前仅本地模式');
        syncStatus.value = 'offline';
      }
      setNodeMap(await loadNodes());
      restoreUiState();
      initExpanded(currentDocId.value);
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
