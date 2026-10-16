/**
 * One-time migration of renderer storage keys written before the rename.
 *
 * Earlier releases stored UI preferences (language, panel widths, chat
 * history, export presets, ...) under the upstream project's `velorn-` /
 * `velorn_` prefixes. Copy each one to its `drama-studio-` / `drama_studio_`
 * key unless that key already exists, then drop the old entry.
 *
 * Imported first in main.jsx (side effect only): several stores read
 * localStorage at import time, so this must run before them.
 */

const LEGACY_PREFIXES = [
  ['velorn-', 'drama-studio-'],
  ['velorn_', 'drama_studio_'],
]

export function migrateLegacyStorageKeys(storage) {
  if (!storage) return { moved: 0, dropped: 0 }
  let moved = 0
  let dropped = 0
  const keys = []
  for (let index = 0; index < storage.length; index += 1) keys.push(storage.key(index))
  for (const key of keys) {
    const rule = LEGACY_PREFIXES.find(([prefix]) => key?.startsWith(prefix))
    if (!rule) continue
    const nextKey = rule[1] + key.slice(rule[0].length)
    if (storage.getItem(nextKey) === null) {
      storage.setItem(nextKey, storage.getItem(key))
      moved += 1
    } else {
      dropped += 1
    }
    storage.removeItem(key)
  }
  return { moved, dropped }
}

try {
  if (typeof window !== 'undefined' && window.localStorage) migrateLegacyStorageKeys(window.localStorage)
} catch {
  // Storage unavailable (private mode, blocked): nothing to migrate.
}
