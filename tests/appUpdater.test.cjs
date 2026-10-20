'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const {
  RELEASES_PAGE_URL,
  compareVersions,
  createAppUpdater,
  errorCode,
  friendlyError,
  resolveUpdateMode,
  safeReleasePageUrl,
} = require('../electron/appUpdater.cjs')

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ds-updater-'))
const fakeApp = (version = '0.6.6') => ({ getVersion: () => version })
const noTimers = { setTimer: () => null, setRepeat: () => null }

function fakeAutoUpdater({ onCheck, onDownload } = {}) {
  const updater = new EventEmitter()
  updater.checkForUpdates = async () => { updater.emit('checking-for-update'); await onCheck?.(updater) }
  updater.downloadUpdate = async () => { await onDownload?.(updater) }
  updater.quitAndInstall = (...args) => { updater.installedWith = args }
  return updater
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

test('update mode follows how the app was installed', () => {
  assert.equal(resolveUpdateMode({ isPackaged: false, platform: 'win32' }), 'off')
  assert.equal(resolveUpdateMode({ isPackaged: true, platform: 'win32', env: {} }), 'auto')
  assert.equal(resolveUpdateMode({ isPackaged: true, platform: 'win32', env: { PORTABLE_EXECUTABLE_DIR: 'D:\\apps' } }), 'notify')
  assert.equal(resolveUpdateMode({ isPackaged: true, platform: 'win32', env: {}, windowsStore: true }), 'off')
  assert.equal(resolveUpdateMode({ isPackaged: true, platform: 'linux', env: { APPIMAGE: '/opt/ds.AppImage' } }), 'auto')
  assert.equal(resolveUpdateMode({ isPackaged: true, platform: 'linux', env: {} }), 'notify')
  assert.equal(resolveUpdateMode({ isPackaged: true, platform: 'darwin', env: {} }), 'notify')
  assert.equal(resolveUpdateMode({ isPackaged: true, platform: 'win32', env: { DS_DISABLE_AUTO_UPDATE: '1' } }), 'off')
})

test('versions compare numerically, and a release beats its prerelease', () => {
  assert.equal(compareVersions('0.6.10', '0.6.9'), 1)
  assert.equal(compareVersions('v0.7.0', '0.6.99'), 1)
  assert.equal(compareVersions('0.6.6', 'v0.6.6'), 0)
  assert.equal(compareVersions('0.6.5', '0.6.6'), -1)
  assert.equal(compareVersions('0.7.0', '0.7.0-beta.1'), 1)
  assert.equal(compareVersions('nonsense', '0.6.6'), 0)
})

test('only this repository\'s release pages are opened', () => {
  const tag = 'https://github.com/jeffreycayao/Drama-Studio/releases/tag/v0.6.7'
  assert.equal(safeReleasePageUrl(tag), tag)
  assert.equal(safeReleasePageUrl('https://evil.example/releases/'), RELEASES_PAGE_URL)
  assert.equal(safeReleasePageUrl('https://github.com/someone-else/Drama-Studio/releases/tag/v9'), RELEASES_PAGE_URL)
  assert.equal(safeReleasePageUrl(undefined), RELEASES_PAGE_URL)
})

test('errors are explained in plain words', () => {
  assert.match(friendlyError(new Error('net::ERR_INTERNET_DISCONNECTED')), /internet connection/)
  assert.match(friendlyError(new Error('sha512 checksum mismatch')), /safety check/)
  assert.match(friendlyError(new Error('New version is not signed by the application owner: publisherName')), /not signed/)
  assert.match(friendlyError(new Error('something odd')), /did not work/)
  assert.equal(errorCode(new Error('getaddrinfo ENOTFOUND github.com')), 'offline')
  assert.equal(errorCode(new Error('Cannot find latest.yml in the latest release artifacts')), 'no-info')
  assert.equal(errorCode(new Error('something odd')), 'unknown')
})

test('notify mode asks the releases API and opens only the release page', async () => {
  const opened = []
  const updater = createAppUpdater({
    app: fakeApp('0.6.6'),
    shell: { openExternal: async (url) => { opened.push(url) } },
    fetch: async (url) => {
      assert.equal(url, 'https://api.github.com/repos/jeffreycayao/Drama-Studio/releases/latest')
      return jsonResponse({ tag_name: 'v0.6.7', html_url: 'https://github.com/jeffreycayao/Drama-Studio/releases/tag/v0.6.7' })
    },
    mode: 'notify',
    settingsDir: tempDir(),
    ...noTimers,
  })
  const state = await updater.check()
  assert.equal(state.status, 'available')
  assert.equal(state.latestVersion, '0.6.7')
  await updater.download()
  assert.deepEqual(opened, ['https://github.com/jeffreycayao/Drama-Studio/releases/tag/v0.6.7'])
})

test('notify mode reports up to date, and a failed request as an error', async () => {
  const base = { app: fakeApp('0.6.7'), shell: { openExternal: async () => {} }, mode: 'notify', settingsDir: tempDir(), ...noTimers }
  const same = createAppUpdater({ ...base, fetch: async () => jsonResponse({ tag_name: 'v0.6.7' }) })
  assert.equal((await same.check()).status, 'up-to-date')
  const down = createAppUpdater({ ...base, fetch: async () => jsonResponse({}, 503) })
  const state = await down.check()
  assert.equal(state.status, 'error')
  assert.ok(state.error)
  assert.equal(state.errorCode, 'unknown')
})

test('auto mode downloads in the background and installs only when ready', async () => {
  const broadcasts = []
  const auto = fakeAutoUpdater({
    onCheck: (u) => {
      u.emit('update-available', { version: '0.6.7' })
      u.emit('download-progress', { percent: 42.4 })
      u.emit('update-downloaded', { version: '0.6.7' })
    },
  })
  const updater = createAppUpdater({
    app: fakeApp('0.6.6'),
    shell: {},
    fetch: async () => { throw new Error('auto mode must not call the releases API') },
    mode: 'auto',
    settingsDir: tempDir(),
    broadcast: (state) => broadcasts.push(state.status),
    loadAutoUpdater: () => auto,
    ...noTimers,
  })
  assert.deepEqual(updater.install(), { success: false, error: 'No update is ready to install.' })
  const state = await updater.check()
  assert.equal(auto.autoDownload, true)
  assert.equal(auto.autoInstallOnAppQuit, true)
  assert.equal(auto.allowPrerelease, false)
  assert.equal(state.status, 'ready')
  assert.ok(broadcasts.includes('downloading'))
  assert.deepEqual(updater.install(), { success: true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(auto.installedWith, [true, true])
})

test('turning off automatic downloads is saved and waits for Download', async () => {
  const dir = tempDir()
  let downloads = 0
  const auto = fakeAutoUpdater({
    onCheck: (u) => u.emit('update-available', { version: '0.6.7' }),
    onDownload: (u) => { downloads += 1; u.emit('update-downloaded', { version: '0.6.7' }) },
  })
  const make = () => createAppUpdater({ app: fakeApp(), shell: {}, fetch: async () => {}, mode: 'auto', settingsDir: dir, loadAutoUpdater: () => auto, ...noTimers })
  const updater = make()
  updater.setAutoDownload(false)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'update-settings.json'), 'utf8')).autoDownload, false)
  assert.equal(make().getState().autoDownload, false)
  const state = await updater.check()
  assert.equal(state.status, 'available')
  assert.equal(downloads, 0)
  assert.equal((await updater.download()).status, 'ready')
  assert.equal(downloads, 1)
})

test('off mode never checks or schedules', async () => {
  let scheduled = 0
  const updater = createAppUpdater({
    app: fakeApp(), shell: {}, fetch: async () => { throw new Error('no') }, mode: 'off', settingsDir: tempDir(),
    loadAutoUpdater: () => { throw new Error('no') }, setTimer: () => { scheduled += 1 }, setRepeat: () => { scheduled += 1 },
  })
  updater.start()
  assert.equal(scheduled, 0)
  assert.equal((await updater.check()).status, 'off')
})

test('the update notice picks the right message', async () => {
  const { updateNoticeKind } = await import('../src/utils/updateNotice.mjs')
  assert.equal(updateNoticeKind({ status: 'ready', mode: 'auto', latestVersion: '0.6.7' }), 'ready')
  assert.equal(updateNoticeKind({ status: 'available', mode: 'auto', latestVersion: '0.6.7' }), 'fetch')
  assert.equal(updateNoticeKind({ status: 'available', mode: 'notify', latestVersion: '0.6.7' }), 'download')
  assert.equal(updateNoticeKind({ status: 'ready', mode: 'auto', latestVersion: '0.6.7' }, '0.6.7'), null)
  assert.equal(updateNoticeKind({ status: 'downloading', mode: 'auto', latestVersion: '0.6.7' }), null)
  assert.equal(updateNoticeKind(null), null)
})
