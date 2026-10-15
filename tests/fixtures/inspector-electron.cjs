// Hidden renderer test host, deliberately NOT electron/main.js. It has no IPC,
// project-folder access, preload bridge, MCP connection, or shared app profile.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-inspector-test-')))
app.whenReady().then(() => {
  const window = new BrowserWindow({ show: false, width: 1440, height: 1000,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } })
  window.loadURL((process.env.VELORN_TEST_URL || 'http://127.0.0.1:5184') + '/tests/fixtures/multi-clip-inspector.html')
})
app.on('window-all-closed', () => app.quit())
