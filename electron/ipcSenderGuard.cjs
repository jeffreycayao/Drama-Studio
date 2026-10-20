'use strict'

/**
 * Only Drama Studio's own page may use the preload bridge (main process).
 *
 * The IPC handlers read and write files, start processes and change settings,
 * so every message is checked before it reaches one: it must come from the top
 * frame of the app's own page, which is dist/index.html (with any query or
 * hash, e.g. the export worker's ?export=worker) in installed builds, or the
 * Vite dev server in development. Anything else (a page a window was navigated
 * to, an iframe, a blank popup) is refused. The same rule decides which
 * navigations stay inside a window.
 *
 * installIpcSenderGuard wraps ipcMain.handle / handleOnce (invoke) and
 * ipcMain.emit (send), so it must run before any handler is registered.
 */

const path = require('path')
const { fileURLToPath } = require('url')

const DEV_PORTS = [5173, 5174, 5175, 5176]
const DEV_HOSTS = ['127.0.0.1', 'localhost']

function samePath(a, b, platform = process.platform) {
  const left = path.resolve(a)
  const right = path.resolve(b)
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

/** Returns url => true for the app's own page. */
function createTrustedPageCheck({ distIndexPath, isDev = false, platform = process.platform } = {}) {
  const devOrigins = new Set(isDev ? DEV_HOSTS.flatMap((host) => DEV_PORTS.map((port) => `http://${host}:${port}`)) : [])
  return (value) => {
    let url
    try { url = new URL(String(value || '')) } catch { return false }
    if (url.protocol === 'file:') {
      if (!distIndexPath || url.host) return false
      try { return samePath(fileURLToPath(url, { windows: platform === 'win32' }), distIndexPath, platform) } catch { return false }
    }
    if (url.protocol === 'http:') return devOrigins.has(url.origin) && !url.username && !url.password
    return false
  }
}

function looksLikeIpcEvent(event) {
  return Boolean(event) && typeof event === 'object' && 'sender' in event && 'senderFrame' in event
}

function isTrustedIpcEvent(event, isTrustedPage) {
  let frame
  try { frame = event?.senderFrame } catch { return false }
  if (!frame || frame.parent) return false
  return isTrustedPage(frame.url)
}

function installIpcSenderGuard(ipcMain, isTrustedPage, { onBlocked = () => {} } = {}) {
  if (ipcMain.__dsSenderGuard) return
  Object.defineProperty(ipcMain, '__dsSenderGuard', { value: true })

  const wrapInvoke = (channel, listener) => (event, ...args) => {
    if (!isTrustedIpcEvent(event, isTrustedPage)) {
      onBlocked(channel, event)
      throw new Error('This request was blocked: it did not come from Drama Studio.')
    }
    return listener(event, ...args)
  }
  const handle = ipcMain.handle.bind(ipcMain)
  const handleOnce = ipcMain.handleOnce.bind(ipcMain)
  ipcMain.handle = (channel, listener) => handle(channel, wrapInvoke(channel, listener))
  ipcMain.handleOnce = (channel, listener) => handleOnce(channel, wrapInvoke(channel, listener))

  const emit = ipcMain.emit.bind(ipcMain)
  ipcMain.emit = (channel, event, ...args) => {
    if (looksLikeIpcEvent(event) && !isTrustedIpcEvent(event, isTrustedPage)) {
      onBlocked(channel, event)
      return false
    }
    return emit(channel, event, ...args)
  }
}

/**
 * Keeps a window on the app's own page: other http(s) and mailto links open in
 * the user's browser, every other scheme (file:, javascript:, custom
 * protocols) is refused. `intercept(url)` may claim a navigation first
 * (in-app downloads) by returning true.
 */
function restrictNavigation(contents, isTrustedPage, { openExternal, intercept = () => false } = {}) {
  contents.on('will-navigate', (event, url) => {
    if (intercept(url)) { event.preventDefault(); return }
    if (isTrustedPage(url)) return
    event.preventDefault()
    if (/^(https?:|mailto:)/i.test(String(url || '')) && openExternal) openExternal(url)
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
}

module.exports = {
  createTrustedPageCheck,
  installIpcSenderGuard,
  isTrustedIpcEvent,
  looksLikeIpcEvent,
  restrictNavigation,
}
