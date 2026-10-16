import test from 'node:test'
import assert from 'node:assert/strict'
import { migrateLegacyStorageKeys } from './legacyStorageMigration.js'

function memoryStorage(entries = {}) {
  const map = new Map(Object.entries(entries))
  return {
    get length() { return map.size },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    dump: () => Object.fromEntries(map),
  }
}

test('legacy keys move to the new prefixes and old entries are removed', () => {
  const storage = memoryStorage({
    'velorn-language': 'ja',
    'velorn_tool_state': '{"a":1}',
    'comfystudio-theme': 'drama-studio',
  })
  assert.deepEqual(migrateLegacyStorageKeys(storage), { moved: 2, dropped: 0 })
  assert.deepEqual(storage.dump(), {
    'comfystudio-theme': 'drama-studio',
    'drama-studio-language': 'ja',
    'drama_studio_tool_state': '{"a":1}',
  })
})

test('an existing new key wins over the legacy value', () => {
  const storage = memoryStorage({ 'velorn-language': 'ja', 'drama-studio-language': 'en' })
  assert.deepEqual(migrateLegacyStorageKeys(storage), { moved: 0, dropped: 1 })
  assert.deepEqual(storage.dump(), { 'drama-studio-language': 'en' })
})

test('running twice is a no-op', () => {
  const storage = memoryStorage({ 'velorn-language': 'ja' })
  migrateLegacyStorageKeys(storage)
  assert.deepEqual(migrateLegacyStorageKeys(storage), { moved: 0, dropped: 0 })
  assert.equal(migrateLegacyStorageKeys(null).moved, 0)
})
