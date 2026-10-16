'use strict'

// One-time move of the settings folder used before the rename (Velorn) to
// the Drama Studio folder. Pure apart from the injected fs calls, so it can
// be tested against temporary directories.

const fs = require('fs')
const path = require('path')

const CURRENT_FOLDER_NAME = 'Drama Studio'
const LEGACY_FOLDER_NAME = 'Velorn'

/**
 * @returns {{ userDataDir: string, moved: boolean, error: string|null }}
 *   userDataDir is the folder the app should use.
 */
function resolveUserDataDir(appDataDir, { existsSync = fs.existsSync, renameSync = fs.renameSync, now = Date.now } = {}) {
  const currentDir = path.join(appDataDir, CURRENT_FOLDER_NAME)
  const legacyDir = path.join(appDataDir, LEGACY_FOLDER_NAME)
  if (!existsSync(legacyDir) || existsSync(path.join(currentDir, 'settings.json'))) {
    return { userDataDir: currentDir, moved: false, error: null }
  }
  try {
    // A Drama Studio folder without settings holds nothing worth keeping
    // (e.g. a cache Chromium created); set it aside rather than merge.
    if (existsSync(currentDir)) renameSync(currentDir, `${currentDir}.empty-${now()}`)
    renameSync(legacyDir, currentDir)
    return { userDataDir: currentDir, moved: true, error: null }
  } catch (error) {
    // An older build still running, or permissions: keep the old folder so nothing is lost.
    return { userDataDir: legacyDir, moved: false, error: error?.message || String(error) }
  }
}

module.exports = { resolveUserDataDir, CURRENT_FOLDER_NAME, LEGACY_FOLDER_NAME }
