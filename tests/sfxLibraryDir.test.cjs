'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { SFX_LIBRARY_FOLDER_NAME, isDirectoryWritable, resolveDefaultSfxLibraryDir } = require('../electron/sfxLibraryDir.cjs')

const USER_DATA = path.join(os.tmpdir(), 'ds-user-data')
const EXE = path.join(os.tmpdir(), 'ds-install', 'Drama Studio.exe')
const INSTALL_SFX = path.join(path.dirname(EXE), SFX_LIBRARY_FOLDER_NAME)
const USER_SFX = path.join(USER_DATA, SFX_LIBRARY_FOLDER_NAME)

test('portable builds keep the SFX pack beside the portable exe', () => {
  const portableExecutableDir = path.join(os.tmpdir(), 'ds-portable')
  const dir = resolveDefaultSfxLibraryDir({
    portableExecutableDir, isPackaged: true, exePath: EXE, userDataDir: USER_DATA, probeWritable: () => true,
  })
  assert.equal(dir, path.join(portableExecutableDir, SFX_LIBRARY_FOLDER_NAME))
})

test('packaged installs use the install folder only when a real write succeeds', () => {
  const probed = []
  const probe = result => dir => { probed.push(dir); return result }
  assert.equal(resolveDefaultSfxLibraryDir({ isPackaged: true, exePath: EXE, userDataDir: USER_DATA, probeWritable: probe(true) }), INSTALL_SFX)
  assert.equal(resolveDefaultSfxLibraryDir({ isPackaged: true, exePath: EXE, userDataDir: USER_DATA, probeWritable: probe(false) }), USER_SFX)
  assert.deepEqual(probed, [path.dirname(EXE), path.dirname(EXE)])
})

test('Store packages and development runs use userData without probing', () => {
  const probeWritable = () => assert.fail('must not probe')
  assert.equal(resolveDefaultSfxLibraryDir({ isPackaged: true, windowsStore: true, exePath: EXE, userDataDir: USER_DATA, probeWritable }), USER_SFX)
  assert.equal(resolveDefaultSfxLibraryDir({ isPackaged: false, exePath: EXE, userDataDir: USER_DATA, probeWritable }), USER_SFX)
})

test('write probe creates and removes a real file, and fails for a missing folder', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-sfx-probe-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  assert.equal(isDirectoryWritable(dir), true)
  assert.deepEqual(fs.readdirSync(dir), [])
  assert.equal(isDirectoryWritable(path.join(dir, 'missing')), false)
})

test('write probe reports a folder that denies file creation as read-only', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-sfx-readonly-'))
  t.after(() => { fs.chmodSync(dir, 0o700); fs.rmSync(dir, { recursive: true, force: true }) })
  fs.chmodSync(dir, 0o500)
  assert.equal(isDirectoryWritable(dir), false)
})
