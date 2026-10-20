'use strict'

/**
 * Save the open project before the main window closes (main process).
 *
 * The page's own unload handler cannot do it: its save awaits IPC replies a
 * closing page never receives, so the write is never sent. Instead the first
 * close is held, the page is asked to save ('app:saveBeforeClose'), and the
 * window closes once it answers ('app:savedBeforeClose') or after a timeout,
 * so a stuck or crashed page never blocks quitting.
 *
 * isSaving() lets other close handlers (the ComfyUI quit prompt) wait for
 * the second, real close.
 *
 * A held close also cancels a quit in progress (Cmd+Q, an update install),
 * so when one was under way the save finishes with app.quit(); on macOS just
 * closing the window would leave the app running.
 */

const TIMEOUT_MS = 15000

function askPageToSave(ipcMain, contents, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (!contents || contents.isDestroyed() || contents.isCrashed?.()) { resolve('skipped'); return }
    let timer = null
    const finish = (result) => {
      clearTimeout(timer)
      ipcMain.removeListener('app:savedBeforeClose', onSaved)
      resolve(result)
    }
    const onSaved = (event) => { if (event.sender === contents) finish('saved') }
    timer = setTimeout(() => finish('timeout'), timeoutMs)
    ipcMain.on('app:savedBeforeClose', onSaved)
    contents.send('app:saveBeforeClose')
  })
}

function installSaveBeforeClose(window, ipcMain, { app = null, timeoutMs = TIMEOUT_MS, log = () => {} } = {}) {
  let saving = false
  let allowNextClose = false
  let quitting = false
  const onQuit = () => { quitting = true }
  app?.on('before-quit', onQuit)
  window.on('closed', () => app?.removeListener('before-quit', onQuit))
  window.on('close', (event) => {
    if (allowNextClose) { allowNextClose = false; return }
    event.preventDefault()
    if (saving) return
    saving = true
    askPageToSave(ipcMain, window.webContents, timeoutMs).then((result) => {
      if (result === 'timeout') log('The project did not finish saving before close.')
      saving = false
      allowNextClose = true
      if (quitting) { quitting = false; app.quit() } else if (!window.isDestroyed()) window.close()
    })
  })
  return { isSaving: () => saving }
}

module.exports = { askPageToSave, installSaveBeforeClose }
