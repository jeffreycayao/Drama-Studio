'use strict'
// Extract only the real settings IPC handlers from electron/main.js and run
// them against an in-memory settings object. No Electron app starts.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadHandlers(initial) {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8')
  const start = main.indexOf('const isMainOnlySettingKey')
  const end = main.indexOf("ipcMain.handle('settings:delete'", start)
  const close = main.indexOf('\n})', end) + 3
  assert.ok(start > 0 && end > start && close > end)
  let settings = { ...initial }
  const handlers = {}
  vm.runInNewContext(main.slice(start, close), {
    ipcMain: { handle: (name, fn) => { handlers[name] = fn } },
    readSettingsRaw: async () => ({ ...settings }),
    writeSettingsRaw: async (mutator) => { settings = mutator({ ...settings }); return settings },
    refreshSettingsDependentCaches: async () => {},
    Object,
  })
  return { handlers, current: () => settings }
}

test('generic settings IPC never returns, replaces or deletes assistant API keys', async () => {
  const { handlers, current } = loadHandlers({ theme: 'dark', 'chatApiKey.anthropic': 'sk-secret', sfxLibrary: { catalogUrl: 'https://x' } })
  const all = await handlers['settings:get']({}, undefined)
  assert.deepEqual(Object.keys(all).sort(), ['sfxLibrary', 'theme'])
  assert.equal(await handlers['settings:get']({}, 'chatApiKey.anthropic'), null)
  assert.equal(await handlers['settings:get']({}, 'theme'), 'dark')
  assert.equal((await handlers['settings:set']({}, 'chatApiKey.anthropic', 'sk-evil')).success, false)
  assert.equal((await handlers['settings:delete']({}, 'chatApiKey.anthropic')).success, false)
  assert.equal(current()['chatApiKey.anthropic'], 'sk-secret')
  assert.equal((await handlers['settings:set']({}, 'theme', 'light')).success, true)
  assert.equal(current().theme, 'light')
})
