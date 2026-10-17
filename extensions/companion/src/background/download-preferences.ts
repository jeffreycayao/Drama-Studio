import { storage } from '#imports';
import { z } from 'zod/mini';

export const downloadPreferencesSchema = z.object({
  folderName: z.string(),
  prefix: z.string(),
  autoChangeFileName: z.boolean(),
});

export type DownloadPreferences = z.infer<typeof downloadPreferencesSchema>;

export const defaultDownloadPreferences: DownloadPreferences = {
  folderName: '',
  prefix: '',
  autoChangeFileName: true,
};

const downloadPreferencesItem = storage.defineItem<unknown>(
  'local:grok_download_preferences',
  { fallback: defaultDownloadPreferences },
);

export async function loadDownloadPreferences(): Promise<DownloadPreferences> {
  const stored = await downloadPreferencesItem.getValue();
  const parsed = downloadPreferencesSchema.safeParse(stored);
  if (parsed.success) return parsed.data;

  await downloadPreferencesItem.setValue(defaultDownloadPreferences);
  return defaultDownloadPreferences;
}

export async function saveDownloadPreferences(
  preferences: DownloadPreferences,
): Promise<void> {
  const validated = downloadPreferencesSchema.parse(preferences);
  await downloadPreferencesItem.setValue(validated);
}
