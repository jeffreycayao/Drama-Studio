'use strict'

/**
 * App updates from this repository's published GitHub releases (main process).
 *
 * Two modes, picked from how the app was installed:
 *  - "auto": the Windows installer build and the Linux AppImage. electron-updater
 *    reads latest.yml / latest-linux.yml from the newest published release,
 *    downloads in the background (checked against the sha512 in that file) and
 *    installs when the app quits or the user picks Restart.
 *  - "notify": the Windows portable exe, the Linux .deb and macOS, which cannot
 *    replace themselves. The GitHub releases API is asked for the newest
 *    version, and Download opens the release page in the browser.
 * Dev runs, Microsoft Store installs and DS_DISABLE_AUTO_UPDATE=1 are "off".
 *
 * Drafts are invisible to both paths, so publishing a draft release is what
 * ships an update. Only one preference is kept: whether to download updates
 * on their own (update-settings.json in userData).
 */

const fs = require('fs')
const path = require('path')

const UPDATE_OWNER = 'jeffreycayao'
const UPDATE_REPO = 'Drama-Studio'
const RELEASES_PAGE_URL = `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`
const RELEASE_PAGE_PREFIX = `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases/`
const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases/latest`
const FIRST_CHECK_DELAY_MS = 20 * 1000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const SETTINGS_FILE = 'update-settings.json'

function resolveUpdateMode({ isPackaged, platform, env = {}, windowsStore = false } = {}) {
  if (!isPackaged || env.DS_DISABLE_AUTO_UPDATE === '1' || windowsStore) return 'off'
  if (platform === 'win32') return env.PORTABLE_EXECUTABLE_DIR ? 'notify' : 'auto'
  if (platform === 'linux') return env.APPIMAGE ? 'auto' : 'notify'
  if (platform === 'darwin') return 'notify'
  return 'off'
}

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(value || '').trim())
  return match ? { parts: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] || '' } : null
}

/** 1 when a is newer than b, -1 when older, 0 when equal or unreadable. */
function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return 0
  for (let index = 0; index < 3; index += 1) {
    if (left.parts[index] !== right.parts[index]) return left.parts[index] > right.parts[index] ? 1 : -1
  }
  if (left.prerelease === right.prerelease) return 0
  if (!left.prerelease) return 1
  if (!right.prerelease) return -1
  return left.prerelease > right.prerelease ? 1 : -1
}

/** Only this repository's release pages are opened; anything else falls back to the latest-release page. */
function safeReleasePageUrl(value) {
  const url = String(value || '')
  return url.startsWith(RELEASE_PAGE_PREFIX) ? url : RELEASES_PAGE_URL
}

const ERROR_MESSAGES = {
  offline: 'Could not reach GitHub. Check your internet connection and try again.',
  checksum: 'The downloaded update did not pass its safety check, so it was not installed. Try again later.',
  unsigned: 'The update is not signed by Drama Studio, so it was not installed.',
  'no-info': 'No update information was found for this version yet.',
  unknown: 'The update check did not work. Try again later.',
}

/** A short code for an updater error; the renderer translates it. */
function errorCode(error) {
  const text = String(error?.message || error || '')
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|net::ERR_/i.test(text)) return 'offline'
  if (/sha512|checksum/i.test(text)) return 'checksum'
  if (/not signed|publisherName|signature/i.test(text)) return 'unsigned'
  if (/404|latest.*\.yml|No published versions/i.test(text)) return 'no-info'
  return 'unknown'
}

function friendlyError(error) {
  return ERROR_MESSAGES[errorCode(error)]
}

const errorPatch = (error) => ({ status: 'error', error: friendlyError(error), errorCode: errorCode(error), percent: null })

function readSettings(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { autoDownload: parsed?.autoDownload !== false }
  } catch {
    return { autoDownload: true }
  }
}

function writeSettings(file, settings) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(settings, null, 2))
  } catch (error) {
    console.warn('[updates] settings were not saved:', error?.message || error)
  }
}

function createAppUpdater({
  app,
  shell,
  fetch,
  mode,
  settingsDir,
  broadcast = () => {},
  loadAutoUpdater = () => require('electron-updater').autoUpdater,
  setTimer = setTimeout,
  setRepeat = setInterval,
} = {}) {
  const settingsFile = path.join(settingsDir, SETTINGS_FILE)
  const settings = readSettings(settingsFile)
  let state = {
    mode,
    status: mode === 'off' ? 'off' : 'idle',
    currentVersion: app.getVersion(),
    latestVersion: null,
    percent: null,
    error: null,
    errorCode: null,
    checkedAt: null,
    autoDownload: settings.autoDownload,
    releaseUrl: RELEASES_PAGE_URL,
  }
  let updater = null
  let checking = null
  let started = false

  const setState = (patch) => {
    state = { ...state, ...(patch.error === null ? { errorCode: null } : {}), ...patch }
    broadcast({ ...state })
  }

  const getUpdater = () => {
    if (updater) return updater
    updater = loadAutoUpdater()
    updater.autoDownload = settings.autoDownload
    updater.autoInstallOnAppQuit = true
    updater.allowPrerelease = false
    updater.allowDowngrade = false
    updater.logger = null
    updater.on('checking-for-update', () => setState({ status: 'checking', error: null }))
    updater.on('update-not-available', () => setState({ status: 'up-to-date', latestVersion: state.currentVersion, checkedAt: Date.now() }))
    updater.on('update-available', (info) => setState({
      status: settings.autoDownload ? 'downloading' : 'available',
      latestVersion: info?.version || null,
      percent: settings.autoDownload ? 0 : null,
      releaseUrl: info?.version ? `${RELEASE_PAGE_PREFIX}tag/v${info.version}` : RELEASES_PAGE_URL,
      checkedAt: Date.now(),
    }))
    updater.on('download-progress', (progress) => setState({ status: 'downloading', percent: Math.round(Number(progress?.percent) || 0) }))
    updater.on('update-downloaded', (info) => setState({ status: 'ready', percent: 100, latestVersion: info?.version || state.latestVersion }))
    updater.on('error', (error) => {
      console.warn('[updates] auto-update error:', error?.message || error)
      setState(errorPatch(error))
    })
    return updater
  }

  const checkLatestRelease = async () => {
    setState({ status: 'checking', error: null })
    const response = await fetch(LATEST_RELEASE_API_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `DramaStudio/${state.currentVersion}` },
    })
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
    const release = await response.json()
    const latestVersion = parseVersion(release?.tag_name) ? String(release.tag_name).replace(/^v/, '') : null
    if (!latestVersion) throw new Error('No published versions')
    const newer = compareVersions(latestVersion, state.currentVersion) > 0
    setState({
      status: newer ? 'available' : 'up-to-date',
      latestVersion,
      releaseUrl: safeReleasePageUrl(release?.html_url),
      checkedAt: Date.now(),
    })
  }

  const check = async () => {
    if (mode === 'off') return { ...state }
    if (state.status === 'ready' || state.status === 'downloading') return { ...state }
    if (!checking) {
      checking = (async () => {
        try {
          if (mode === 'auto') await getUpdater().checkForUpdates()
          else await checkLatestRelease()
        } catch (error) {
          console.warn('[updates] check failed:', error?.message || error)
          setState(errorPatch(error))
        } finally {
          checking = null
        }
      })()
    }
    await checking
    return { ...state }
  }

  /** auto: fetch the update now (when automatic downloads are off). notify: open the release page. */
  const download = async () => {
    if (mode === 'notify') {
      await shell.openExternal(safeReleasePageUrl(state.releaseUrl))
      return { ...state }
    }
    if (mode !== 'auto' || state.status !== 'available') return { ...state }
    setState({ status: 'downloading', percent: 0, error: null })
    try {
      await getUpdater().downloadUpdate()
    } catch (error) {
      setState(errorPatch(error))
    }
    return { ...state }
  }

  /** Quits and runs the downloaded installer, then starts the new version. */
  const install = () => {
    if (mode !== 'auto' || state.status !== 'ready') return { success: false, error: 'No update is ready to install.' }
    setImmediate(() => getUpdater().quitAndInstall(true, true))
    return { success: true }
  }

  const setAutoDownload = (value) => {
    settings.autoDownload = value === true
    writeSettings(settingsFile, settings)
    if (updater) updater.autoDownload = settings.autoDownload
    setState({ autoDownload: settings.autoDownload })
    if (settings.autoDownload && state.status === 'available' && mode === 'auto') download()
    return { ...state }
  }

  const start = () => {
    if (started || mode === 'off') return
    started = true
    const first = setTimer(() => { check() }, FIRST_CHECK_DELAY_MS)
    const repeat = setRepeat(() => { check() }, CHECK_INTERVAL_MS)
    first?.unref?.()
    repeat?.unref?.()
  }

  return { getState: () => ({ ...state }), check, download, install, setAutoDownload, start }
}

function registerAppUpdaterIpc(ipcMain, updater) {
  ipcMain.handle('updates:getState', () => updater.getState())
  ipcMain.handle('updates:check', () => updater.check())
  ipcMain.handle('updates:download', () => updater.download())
  ipcMain.handle('updates:install', () => updater.install())
  ipcMain.handle('updates:setAutoDownload', (_event, value) => updater.setAutoDownload(value === true))
}

module.exports = {
  RELEASES_PAGE_URL,
  LATEST_RELEASE_API_URL,
  compareVersions,
  createAppUpdater,
  errorCode,
  friendlyError,
  registerAppUpdaterIpc,
  resolveUpdateMode,
  safeReleasePageUrl,
}
