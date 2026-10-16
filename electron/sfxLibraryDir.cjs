'use strict'
// Default folder for the SFX pack. Node's fs.access(W_OK) only checks the
// read-only attribute on Windows, not ACLs, so Program Files and the MSIX
// WindowsApps folder look writable. Probe by creating a real file instead.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const SFX_LIBRARY_FOLDER_NAME = 'Drama Studio SFX'

/** True when a file can actually be created (and removed) in `dir`. */
function isDirectoryWritable(dir) {
  const probe = path.join(dir, `.drama-studio-write-test-${process.pid}-${crypto.randomBytes(6).toString('hex')}`)
  let fd = null
  try {
    fd = fs.openSync(probe, 'wx')
    return true
  } catch {
    return false
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd) } catch { /* already closed */ }
      try { fs.unlinkSync(probe) } catch { /* best effort */ }
    }
  }
}

/**
 * Beside the portable exe (the exe itself runs from a temp copy); in the
 * install folder when files can really be written there; else userData. A
 * Store/MSIX package folder is always read-only, so it goes to userData
 * without probing.
 */
function resolveDefaultSfxLibraryDir({
  portableExecutableDir = '',
  isPackaged = false,
  windowsStore = false,
  exePath = '',
  userDataDir,
  probeWritable = isDirectoryWritable,
} = {}) {
  if (portableExecutableDir) return path.join(portableExecutableDir, SFX_LIBRARY_FOLDER_NAME)
  if (isPackaged && !windowsStore && exePath) {
    const installDir = path.dirname(exePath)
    if (probeWritable(installDir)) return path.join(installDir, SFX_LIBRARY_FOLDER_NAME)
  }
  return path.join(userDataDir, SFX_LIBRARY_FOLDER_NAME)
}

module.exports = { SFX_LIBRARY_FOLDER_NAME, isDirectoryWritable, resolveDefaultSfxLibraryDir }
