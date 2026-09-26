import { effect } from '@preact/signals';
import { settings } from '../state';
import { getSetting, putSetting } from './db';
import { DEFAULT_SETTINGS, type AppSettings } from '../types';

function applyCss(): void {
  const s = settings.value;
  const r = document.documentElement.style;
  r.setProperty('--ds-comment-color', s.commentColor);
  r.setProperty('--ds-editor-bg', s.editorBg);
}

export async function loadSettings(): Promise<void> {
  const saved = await getSetting<Partial<AppSettings>>('appearance');
  if (saved) settings.value = { ...DEFAULT_SETTINGS, ...saved };
  applyCss();
  effect(applyCss);
}

export async function saveSettings(next: AppSettings): Promise<void> {
  settings.value = next;
  await putSetting('appearance', next);
}
