'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createAssistantKeyStore } = require('../electron/assistantKeyStore.cjs')

function fixture(initial = {}, { available = true, backend = 'keychain', broken = false } = {}) {
  let settings = structuredClone(initial)
  const safeStorage = {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: value => { if (broken) throw new Error('keychain locked'); return Buffer.from(`sealed:${value}`) },
    decryptString: value => { const text = value.toString(); if (!text.startsWith('sealed:')) throw new Error('bad ciphertext'); return text.slice(7) },
  }
  const store = createAssistantKeyStore({ safeStorage, readSettings: async () => structuredClone(settings),
    writeSettings: async mutate => { settings = mutate(structuredClone(settings)); return settings } })
  return { store, read: () => settings }
}

test('legacy keys migrate atomically and unrelated settings survive', async () => {
  const { store, read } = fixture({ 'chatApiKey.openai': 'test-key', theme: 'dark', sfxR2: { secretEnc: 'keep' } })
  await store.migrate()
  assert.equal(typeof read()['chatApiKey.openai'], 'object')
  assert.equal(JSON.stringify(read()).includes('test-key'), false)
  assert.equal(await store.get('openai'), 'test-key')
  assert.equal(read().theme, 'dark')
  assert.deepEqual(read().sfxR2, { secretEnc: 'keep' })
  const before = structuredClone(read()); await store.migrate(); assert.deepEqual(read(), before)
})

test('new keys are encrypted, replaced and removable without a keychain', async () => {
  const { store, read } = fixture()
  await store.set('openai', 'first'); await store.set('openai', 'second')
  assert.equal(await store.get('openai'), 'second')
  assert.equal(read()['chatApiKey.openai'].version, 1)
  const locked = fixture(read(), { available: false })
  await locked.store.set('openai', '')
  assert.equal(await locked.store.get('openai'), '')
})

for (const options of [{ available: false }, { backend: 'basic_text' }, { broken: true }]) {
  test(`unavailable or insecure encryption refuses plaintext fallback: ${JSON.stringify(options)}`, async () => {
    const initial = { 'chatApiKey.openai': 'legacy', theme: 'dark' }
    const { store, read } = fixture(initial, options)
    await assert.rejects(store.migrate())
    await assert.rejects(store.get('openai'))
    await assert.rejects(store.set('anthropic', 'new'))
    assert.deepEqual(read(), initial, 'failed migration must preserve existing data')
  })
}

test('corrupt encrypted keys fail closed', async () => {
  const { store } = fixture({ 'chatApiKey.openai': { version: 1, encrypted: 'YmFk' } })
  await assert.rejects(store.get('openai'))
})
