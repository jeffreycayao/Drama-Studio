'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const { installSaveBeforeClose } = require('../electron/saveBeforeClose.cjs')

function fakeWindow() {
  const window = new EventEmitter()
  window.destroyed = false
  window.sent = []
  window.webContents = { isDestroyed: () => false, isCrashed: () => false, send: (channel) => window.sent.push(channel) }
  window.isDestroyed = () => window.destroyed
  window.closes = 0
  // Like BrowserWindow.close(): emits 'close' and closes unless prevented.
  window.close = () => {
    let prevented = false
    window.emit('close', { preventDefault: () => { prevented = true } })
    if (!prevented) { window.closes += 1; window.destroyed = true }
  }
  return window
}

test('the first close waits for the page to save, then the window closes', async () => {
  const ipcMain = new EventEmitter()
  const window = fakeWindow()
  const guard = installSaveBeforeClose(window, ipcMain, { timeoutMs: 1000 })
  window.close()
  assert.equal(window.closes, 0, 'held while saving')
  assert.deepEqual(window.sent, ['app:saveBeforeClose'])
  assert.equal(guard.isSaving(), true)
  window.close()
  assert.deepEqual(window.sent, ['app:saveBeforeClose'], 'a second click does not ask twice')
  ipcMain.emit('app:savedBeforeClose', { sender: { other: true } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(window.closes, 0, 'another page cannot release it')
  ipcMain.emit('app:savedBeforeClose', { sender: window.webContents })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(window.closes, 1)
  assert.equal(guard.isSaving(), false)
})

test('a page that never answers does not block closing', async () => {
  const window = fakeWindow()
  const logs = []
  installSaveBeforeClose(window, new EventEmitter(), { timeoutMs: 20, log: (m) => logs.push(m) })
  window.close()
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.equal(window.closes, 1)
  assert.equal(logs.length, 1)
})

test('a quit in progress (Cmd+Q) still quits after the save', async () => {
  const ipcMain = new EventEmitter()
  const window = fakeWindow()
  const app = new EventEmitter()
  app.quits = 0
  app.quit = () => { app.quits += 1; app.emit('before-quit'); window.close() }
  installSaveBeforeClose(window, ipcMain, { app, timeoutMs: 1000 })
  app.quit()
  assert.equal(window.closes, 0, 'the first close is held for the save')
  ipcMain.emit('app:savedBeforeClose', { sender: window.webContents })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(app.quits, 2, 'the save finished the quit instead of only closing the window')
  assert.equal(window.closes, 1)
  window.emit('closed')
  assert.equal(app.listenerCount('before-quit'), 0, 'no listener left behind')
})

test('if another handler cancels the real close, the next close saves again', async () => {
  const ipcMain = new EventEmitter()
  const window = fakeWindow()
  const guard = installSaveBeforeClose(window, ipcMain, { timeoutMs: 1000 })
  let cancelOnce = true
  // Like the ComfyUI prompt in main.js: it waits for the real close.
  window.on('close', (event) => {
    if (guard.isSaving()) return
    if (cancelOnce) { cancelOnce = false; event.preventDefault() }
  })
  window.close()
  ipcMain.emit('app:savedBeforeClose', { sender: window.webContents })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(window.closes, 0, 'the other handler (e.g. ComfyUI Cancel) kept it open')
  window.close()
  assert.deepEqual(window.sent, ['app:saveBeforeClose', 'app:saveBeforeClose'])
})
