'use strict'

const PREFIX = 'chatApiKey.'

/** OS-backed keys; serialized writes are supplied by the main settings queue. */
function createAssistantKeyStore({ safeStorage, readSettings, writeSettings }) {
  function requireEncryption() {
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
      throw new Error('Unlock your OS keychain to save or use Assistant API keys.')
    }
  }
  function encrypt(key) {
    requireEncryption()
    return { version: 1, encrypted: safeStorage.encryptString(key).toString('base64') }
  }
  async function migrate() {
    const current = await readSettings()
    if (!Object.entries(current).some(([name, value]) => name.startsWith(PREFIX) && typeof value === 'string' && value)) return
    await writeSettings(settings => {
      const next = { ...settings }
      for (const [name, value] of Object.entries(settings)) {
        if (name.startsWith(PREFIX) && typeof value === 'string' && value) next[name] = encrypt(value)
      }
      return next
    })
  }
  async function get(provider) {
    let value = (await readSettings())[PREFIX + provider]
    if (typeof value === 'string' && value) {
      await migrate()
      value = (await readSettings())[PREFIX + provider]
    }
    if (!value) return ''
    requireEncryption()
    if (value.version !== 1 || typeof value.encrypted !== 'string') throw new Error('Saved Assistant key has an unsupported format.')
    return safeStorage.decryptString(Buffer.from(value.encrypted, 'base64'))
  }
  async function set(provider, key) {
    const value = key ? encrypt(key) : null
    await writeSettings(settings => {
      const next = { ...settings }
      if (value) next[PREFIX + provider] = value
      else delete next[PREFIX + provider]
      return next
    })
  }
  return { get, set, migrate }
}
module.exports = { createAssistantKeyStore }
