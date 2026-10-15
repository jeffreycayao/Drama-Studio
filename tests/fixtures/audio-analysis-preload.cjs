const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('audioAnalysisFixture', {
  sandboxed: process.sandboxed === true,
  config: () => ipcRenderer.invoke('audio-fixture:config'),
  status: () => ipcRenderer.invoke('audio-fixture:status'),
  holdNext: () => ipcRenderer.invoke('audio-fixture:hold-next'),
  release: () => ipcRenderer.invoke('audio-fixture:release'),
  nativeChecks: () => ipcRenderer.invoke('audio-fixture:native-checks'),
  report: result => ipcRenderer.send('audio-fixture:result', result),
})
