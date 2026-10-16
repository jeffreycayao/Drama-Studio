const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { resolveUserDataDir } = require('../electron/userDataMigration')

function tempAppData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ds-appdata-'))
}

test('moves the legacy folder with its contents on first launch', () => {
  const appData = tempAppData()
  try {
    fs.mkdirSync(path.join(appData, 'Velorn', 'logs'), { recursive: true })
    fs.writeFileSync(path.join(appData, 'Velorn', 'settings.json'), '{"a":1}')
    const result = resolveUserDataDir(appData)
    assert.equal(result.moved, true)
    assert.equal(result.userDataDir, path.join(appData, 'Drama Studio'))
    assert.equal(fs.readFileSync(path.join(appData, 'Drama Studio', 'settings.json'), 'utf8'), '{"a":1}')
    assert.equal(fs.existsSync(path.join(appData, 'Drama Studio', 'logs')), true)
    assert.equal(fs.existsSync(path.join(appData, 'Velorn')), false)
  } finally {
    fs.rmSync(appData, { recursive: true, force: true })
  }
})

test('an existing Drama Studio folder with settings wins and nothing moves', () => {
  const appData = tempAppData()
  try {
    fs.mkdirSync(path.join(appData, 'Velorn'))
    fs.mkdirSync(path.join(appData, 'Drama Studio'))
    fs.writeFileSync(path.join(appData, 'Drama Studio', 'settings.json'), '{}')
    const result = resolveUserDataDir(appData)
    assert.deepEqual(result, { userDataDir: path.join(appData, 'Drama Studio'), moved: false, error: null })
    assert.equal(fs.existsSync(path.join(appData, 'Velorn')), true)
  } finally {
    fs.rmSync(appData, { recursive: true, force: true })
  }
})

test('a Drama Studio folder without settings is set aside, then the legacy folder moves in', () => {
  const appData = tempAppData()
  try {
    fs.mkdirSync(path.join(appData, 'Velorn'))
    fs.writeFileSync(path.join(appData, 'Velorn', 'settings.json'), '{"keep":true}')
    fs.mkdirSync(path.join(appData, 'Drama Studio', 'GPUCache'), { recursive: true })
    const result = resolveUserDataDir(appData, { now: () => 42 })
    assert.equal(result.moved, true)
    assert.equal(fs.readFileSync(path.join(appData, 'Drama Studio', 'settings.json'), 'utf8'), '{"keep":true}')
    assert.equal(fs.existsSync(path.join(appData, 'Drama Studio.empty-42', 'GPUCache')), true)
  } finally {
    fs.rmSync(appData, { recursive: true, force: true })
  }
})

test('a failed move keeps using the legacy folder', () => {
  const appData = '/virtual/appdata'
  const exists = new Set([path.join(appData, 'Velorn')])
  const result = resolveUserDataDir(appData, {
    existsSync: (candidate) => exists.has(candidate),
    renameSync: () => { throw new Error('EBUSY: resource busy or locked') },
  })
  assert.equal(result.userDataDir, path.join(appData, 'Velorn'))
  assert.equal(result.moved, false)
  assert.match(result.error, /EBUSY/)
})

test('fresh installs use the Drama Studio folder', () => {
  const appData = tempAppData()
  try {
    assert.deepEqual(resolveUserDataDir(appData), { userDataDir: path.join(appData, 'Drama Studio'), moved: false, error: null })
  } finally {
    fs.rmSync(appData, { recursive: true, force: true })
  }
})
