'use strict'

// Every desktop-API method the export code calls must exist in the real
// preload bridge. Catches a new call (like moveFile) before the slower hidden
// export check runs it, and a preload method renamed out from under export.
// When this test fails because export uses a new method, also add it to the
// fake API in tests/fixtures/export-scheduler.js if the export check reaches it.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

function methodsCalled(source) {
  const names = new Set()
  for (const match of source.matchAll(/electronAPI\??\.(\w+)/g)) names.add(match[1])
  return names
}

function preloadMethods() {
  const preload = read('electron/preload.js')
  const start = preload.indexOf("contextBridge.exposeInMainWorld('electronAPI'")
  assert.ok(start >= 0, 'preload exposes electronAPI')
  const names = new Set()
  for (const match of preload.slice(start).matchAll(/^ {2}(\w+)\s*:/gm)) names.add(match[1])
  return names
}

test('the export code only calls desktop-API methods the preload provides', () => {
  const provided = preloadMethods()
  const missing = []
  for (const file of ['src/services/exporter.js', 'src/components/ExportWorker.jsx']) {
    for (const name of methodsCalled(read(file))) {
      if (!provided.has(name)) missing.push(`${file}: electronAPI.${name}`)
    }
  }
  assert.deepEqual(missing, [])
})

test('the hidden export check fakes every method the frame-pipe export path needs', () => {
  const fixture = read('tests/fixtures/export-scheduler.js')
  for (const name of ['pathJoin', 'createDirectory', 'deleteDirectory', 'moveFile', 'startFramePipe', 'writeFrameToPipe', 'finishFramePipe', 'abortFramePipe']) {
    assert.match(fixture, new RegExp(`\\b${name}: async`), `fixture is missing ${name}`)
  }
})
