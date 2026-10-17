import { storage } from '#imports';
import {
  DEFAULT_SETTINGS,
  migrateSettings,
  normalizeSettings,
} from './settings';
import type { Settings } from './types';

const settingsItem = storage.defineItem<unknown>('local:grok-batch-settings', {
  fallback: DEFAULT_SETTINGS,
});
export async function loadSettings(): Promise<Settings> {
  const stored = await settingsItem.getValue();
  const migrated = migrateSettings(stored);
  await settingsItem.setValue(migrated);
  return migrated;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await settingsItem.setValue(normalizeSettings(settings));
}

export function watchSettings(
  onChange: (settings: Settings) => void,
  onError: (error: unknown) => void,
): () => void {
  return settingsItem.watch((value) => {
    try {
      onChange(migrateSettings(value));
    } catch (error) {
      onError(error);
    }
  });
}

export async function resetSettings(): Promise<Settings> {
  const reset = { ...DEFAULT_SETTINGS };
  await settingsItem.setValue(reset);
  return reset;
}
