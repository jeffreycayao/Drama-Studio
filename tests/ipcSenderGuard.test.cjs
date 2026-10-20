'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const {
  createTrustedPageCheck,
  installIpcSenderGuard,
  restrictNavigation,
} = require('../electron/ipcSenderGuard.cjs')

const WIN_INDEX = 'C:\\Program Files\\Drama Studio\\resources\\app.asar\\dist\\index.html'
const POSIX_INDEX = '/opt/Drama Studio/resources/app.asar/dist/index.html'

test('installed builds trust only their own dist/index.html', () => {
  const win = createTrustedPageCheck({ distIndexPath: WIN_INDEX, platform: 'win32' })
  assert.equal(win('file:///C:/Program%20Files/Drama%20Studio/resources/app.asar/dist/index.html'), true)
  assert.equal(win('file:///c:/program%20files/drama%20studio/resources/app.asar/dist/index.html?export=worker#x'), true)
  assert.equal(win('file:///C:/Users/me/Downloads/evil.html'), false)
  assert.equal(win('file:///C:/Program%20Files/Drama%20Studio/resources/app.asar/dist/other.html'), false)
  assert.equal(win('file://server/share/dist/index.html'), false)
  assert.equal(win('http://127.0.0.1:5173/'), false, 'no dev server in installed builds')
  assert.equal(win('https://example.com/'), false)
  assert.equal(win('about:blank'), false)
  assert.equal(win('comfystudio://C%3A%2Fclip.mp4'), false)
  assert.equal(win('javascript:alert(1)'), false)
  assert.equal(win(''), false)

  const posix = createTrustedPageCheck({ distIndexPath: POSIX_INDEX, platform: 'linux' })
  assert.equal(posix('file:///opt/Drama%20Studio/resources/app.asar/dist/index.html'), true)
  assert.equal(posix('file:///opt/drama%20studio/resources/app.asar/dist/index.html'), false, 'paths are case-sensitive off Windows')
})

test('development trusts only the Vite dev server ports', () => {
  const dev = createTrustedPageCheck({ distIndexPath: POSIX_INDEX, isDev: true, platform: 'linux' })
  assert.equal(dev('http://127.0.0.1:5173/'), true)
  assert.equal(dev('http://localhost:5176/?export=worker'), true)
  assert.equal(dev('http://127.0.0.1:8188/'), false, 'ComfyUI is not the app')
  assert.equal(dev('https://127.0.0.1:5173/'), false)
  assert.equal(dev('http://user:pw@127.0.0.1:5173/'), false)
})

function fakeIpcMain() {
  const ipc = new EventEmitter()
  ipc.handlers = new Map()
  ipc.handle = (channel, fn) => ipc.handlers.set(channel, fn)
  ipc.handleOnce = (channel, fn) => ipc.handlers.set(channel, fn)
  return ipc
}
const APP = 'file:///opt/app/dist/index.html'
const eventFrom = (url, { parent = null } = {}) => ({ sender: {}, senderFrame: { url, parent }, reply() {} })

test('invoke handlers run only for the app\'s top frame', async () => {
  const ipc = fakeIpcMain()
  const blocked = []
  installIpcSenderGuard(ipc, createTrustedPageCheck({ distIndexPath: '/opt/app/dist/index.html', platform: 'linux' }), { onBlocked: (channel) => blocked.push(channel) })
  ipc.handle('fs:readFile', (_event, filePath) => `read ${filePath}`)
  const handler = ipc.handlers.get('fs:readFile')
  assert.equal(await handler(eventFrom(APP), '/tmp/a'), 'read /tmp/a')
  assert.throws(() => handler(eventFrom('https://evil.example/'), '/etc/passwd'), /blocked/)
  assert.throws(() => handler(eventFrom(APP, { parent: {} }), '/etc/passwd'), /blocked/, 'subframes are refused')
  assert.throws(() => handler({ sender: {}, senderFrame: null }, '/etc/passwd'), /blocked/, 'a destroyed frame is refused')
  assert.deepEqual(blocked, ['fs:readFile', 'fs:readFile', 'fs:readFile'])
})

test('send listeners are skipped for other pages, and removeListener still works', () => {
  const ipc = fakeIpcMain()
  installIpcSenderGuard(ipc, createTrustedPageCheck({ distIndexPath: '/opt/app/dist/index.html', platform: 'linux' }))
  const seen = []
  const listener = (_event, value) => seen.push(value)
  ipc.on('export:progress', listener)
  ipc.emit('export:progress', eventFrom(`${APP}?export=worker`), 1)
  ipc.emit('export:progress', eventFrom('https://evil.example/'), 2)
  ipc.emit('export:progress', eventFrom('about:blank'), 3)
  assert.deepEqual(seen, [1])
  ipc.removeListener('export:progress', listener)
  ipc.emit('export:progress', eventFrom(APP), 4)
  assert.deepEqual(seen, [1])
  // Non-IPC events on the emitter are untouched.
  let internal = 0
  ipc.on('custom', () => { internal += 1 })
  ipc.emit('custom', 'plain value')
  assert.equal(internal, 1)
})

test('installing twice does not double-wrap', async () => {
  const ipc = fakeIpcMain()
  const check = createTrustedPageCheck({ distIndexPath: '/opt/app/dist/index.html', platform: 'linux' })
  installIpcSenderGuard(ipc, check)
  installIpcSenderGuard(ipc, check)
  ipc.handle('x', () => 'ok')
  assert.equal(await ipc.handlers.get('x')(eventFrom(APP)), 'ok')
})

test('navigation stays on the app page; web links open outside; other schemes are refused', () => {
  const contents = new EventEmitter()
  const opened = []
  const intercepted = []
  restrictNavigation(contents, createTrustedPageCheck({ distIndexPath: '/opt/app/dist/index.html', platform: 'linux' }), {
    openExternal: (url) => opened.push(url),
    intercept: (url) => { if (url.endsWith('.safetensors')) { intercepted.push(url); return true } return false },
  })
  const navigate = (url) => {
    let prevented = false
    contents.emit('will-navigate', { preventDefault: () => { prevented = true } }, url)
    return prevented
  }
  assert.equal(navigate(`${APP}#/editor`), false)
  assert.equal(navigate('https://example.com/docs'), true)
  assert.equal(navigate('mailto:hi@jepoy.dev'), true)
  assert.equal(navigate('file:///etc/passwd'), true)
  assert.equal(navigate('javascript:alert(1)'), true)
  assert.equal(navigate('comfystudio://C%3A%2Fclip.mp4'), true)
  assert.equal(navigate('https://huggingface.co/x/resolve/main/model.safetensors'), true)
  assert.deepEqual(opened, ['https://example.com/docs', 'mailto:hi@jepoy.dev'])
  assert.deepEqual(intercepted, ['https://huggingface.co/x/resolve/main/model.safetensors'])
  let webviewBlocked = false
  contents.emit('will-attach-webview', { preventDefault: () => { webviewBlocked = true } })
  assert.equal(webviewBlocked, true)
})
