'use strict'
// scripts/organize-licenses.cjs: the packaged app keeps its licenses in one
// licenses/ folder instead of loose files next to Drama Studio.exe.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { organizeLicenses } = require('../scripts/organize-licenses.cjs')

const ROOT = path.resolve(__dirname, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-licenses-'))
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))

test('moves Electron/Chromium licenses and copies the FFmpeg notices', () => {
  const appOutDir = path.join(tmp, 'win-unpacked')
  const resourcesDir = path.join(appOutDir, 'resources')
  fs.mkdirSync(path.join(resourcesDir, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(appOutDir, 'LICENSE.electron.txt'), 'electron')
  fs.writeFileSync(path.join(appOutDir, 'LICENSES.chromium.html'), '<html>chromium</html>')
  fs.writeFileSync(path.join(resourcesDir, 'bin', 'ffmpeg.exe.LICENSE'), 'gpl')
  fs.writeFileSync(path.join(resourcesDir, 'bin', 'ffmpeg.exe.README'), 'build notes')

  const result = organizeLicenses({ appOutDir, resourcesDir, projectDir: ROOT, log: () => {} })
  const root = path.join(appOutDir, 'licenses')
  assert.equal(result.root, root)

  // Nothing loose next to the executable any more.
  assert.equal(fs.existsSync(path.join(appOutDir, 'LICENSE.electron.txt')), false)
  assert.equal(fs.existsSync(path.join(appOutDir, 'LICENSES.chromium.html')), false)
  assert.equal(fs.readFileSync(path.join(root, 'electron', 'LICENSE.txt'), 'utf8'), 'electron')
  assert.ok(fs.existsSync(path.join(root, 'chromium', 'LICENSES.chromium.html')))
  assert.ok(fs.existsSync(path.join(root, 'README.txt')))

  // FFmpeg notices are copied; the originals stay next to the binaries.
  assert.equal(fs.readFileSync(path.join(root, 'ffmpeg', 'ffmpeg.exe.LICENSE'), 'utf8'), 'gpl')
  assert.ok(fs.existsSync(path.join(resourcesDir, 'bin', 'ffmpeg.exe.LICENSE')))

  // Third-party notices cover the bundled renderer libs and main-process deps.
  const notices = fs.readFileSync(path.join(root, 'third-party', 'THIRD-PARTY-NOTICES.txt'), 'utf8')
  assert.ok(result.packages > 10)
  for (const name of ['react@', 'zustand@', 'yauzl@', 'js-yaml@']) assert.match(notices, new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'))
})

test('is safe to run twice (nothing left to move)', () => {
  const appOutDir = path.join(tmp, 'win-unpacked')
  assert.doesNotThrow(() => organizeLicenses({ appOutDir, resourcesDir: path.join(appOutDir, 'resources'), projectDir: ROOT, log: () => {} }))
  assert.ok(fs.existsSync(path.join(appOutDir, 'licenses', 'electron', 'LICENSE.txt')))
})
