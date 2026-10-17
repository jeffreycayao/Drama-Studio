'use strict'

// Registers the native messaging host with Chrome, Edge and Chromium for the
// current Windows user (HKCU). The installer registers the copy in
// resources/companion (build/companion, see build/installer.nsh); each app
// start then points the registry at a manifest in <userData>/companion that
// names this exact executable and the allowed extension IDs, which also
// covers development runs and extra development IDs.

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { NATIVE_HOST_NAME } = require('./protocol.cjs')
const { companionDir } = require('./pairing.cjs')

/**
 * Extension IDs the released host allows. Empty until the Chrome Web Store /
 * Edge Add-ons listings (or a manifest `key`) fix the Companion's ID; add each
 * store ID here and in build/companion/com.dramastudio.companion.json (a test
 * keeps the two equal). Development IDs come from Settings › Browser or
 * DS_COMPANION_EXTENSION_IDS.
 */
const RELEASE_EXTENSION_IDS = Object.freeze([])

const HOST_SWITCH = '--ds-companion-host'
const MANIFEST_FILE_NAME = `${NATIVE_HOST_NAME}.json`
const LAUNCHER_FILE_NAME = 'ds-companion-host.cmd'
const EXTENSION_IDS_FILE_NAME = 'extension-ids.json'
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/
const MAX_DEVELOPMENT_IDS = 8

const NATIVE_MESSAGING_REGISTRY_KEYS = Object.freeze([
  { browser: 'Chrome', key: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts' },
  { browser: 'Edge', key: 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts' },
  // Chromium builds (and the Companion's browser smoke test).
  { browser: 'Chromium', key: 'HKCU\\Software\\Chromium\\NativeMessagingHosts' },
].map((entry) => Object.freeze(entry)))

const isValidExtensionId = (value) => typeof value === 'string' && EXTENSION_ID_PATTERN.test(value)

function parseExtensionIdList(value) {
  return String(value || '').split(/[\s,;]+/).map((item) => item.trim().toLowerCase()).filter(isValidExtensionId)
}

/** Release IDs, then development IDs, without duplicates. */
function resolveAllowedExtensionIds({ release = RELEASE_EXTENSION_IDS, development = [], env = '' } = {}) {
  return [...new Set([...release, ...development, ...parseExtensionIdList(env)].filter(isValidExtensionId))]
}

function buildHostManifest({ hostPath, extensionIds }) {
  return {
    name: NATIVE_HOST_NAME,
    description: 'Drama Studio desktop link for Drama Studio Companion',
    path: hostPath,
    type: 'stdio',
    allowed_origins: extensionIds.map((id) => `chrome-extension://${id}/`),
  }
}

// Electron writes "\r\n" to stdout as it starts on Windows, before any app
// code runs, which would break the browser's length-prefixed framing. So the
// browser's pipe becomes the host's stderr (`2>&1`), stdout goes to NUL, and
// Chromium logs only fatal errors (hostMain.cjs keeps everything else off
// stderr). Chrome passes no stderr of its own worth keeping.
const LAUNCHER_HOST_FLAGS = `${HOST_SWITCH} --log-level=3 --disable-gpu`
const LAUNCHER_REDIRECTS = '2>&1 1>nul'

/**
 * The .cmd Chrome runs. Chrome starts hosts through cmd.exe, so `%` in a path
 * is doubled; Windows paths cannot contain `"`. userDataDir tells the host
 * which settings folder (and link secret) belongs to the app that wrote it.
 */
function buildWindowsLauncher({ execPath, appPath = null, userDataDir = null }) {
  const escape = (value) => {
    if (/["\r\n]/.test(value)) throw new Error('Path cannot be used in a launcher.')
    return value.replace(/%/g, '%%')
  }
  const parts = [`"${escape(execPath)}"`]
  if (appPath) parts.push(`"${escape(appPath)}"`)
  parts.push(LAUNCHER_HOST_FLAGS)
  // No trailing backslash: it would escape the closing quote.
  if (userDataDir) parts.push(`"--ds-companion-user-data=${escape(userDataDir).replace(/\\+$/, '')}"`)
  return `@echo off\r\n${parts.join(' ')} %* ${LAUNCHER_REDIRECTS}\r\n`
}

// --- Development extension IDs (Settings › Browser) -------------------------

function extensionIdsFile(userDataDir) {
  return path.join(companionDir(userDataDir), EXTENSION_IDS_FILE_NAME)
}

function readDevelopmentExtensionIds(userDataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(extensionIdsFile(userDataDir), 'utf8'))
    return (Array.isArray(parsed?.ids) ? parsed.ids : []).filter(isValidExtensionId).slice(0, MAX_DEVELOPMENT_IDS)
  } catch {
    return []
  }
}

function writeDevelopmentExtensionIds(userDataDir, ids) {
  const clean = [...new Set(ids.filter(isValidExtensionId))].slice(0, MAX_DEVELOPMENT_IDS)
  fs.mkdirSync(companionDir(userDataDir), { recursive: true })
  fs.writeFileSync(extensionIdsFile(userDataDir), JSON.stringify({ ids: clean }, null, 2), 'utf8')
  return clean
}

// --- Registry -----------------------------------------------------------------

function defaultRunReg(args) {
  return new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true, timeout: 10_000 }, (error, stdout) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || '') })
    })
  })
}

/** Reads a key's default value; the "(Default)" label is localized, so match the type. */
async function readDefaultValue(runReg, key) {
  const result = await runReg(['query', key, '/ve'])
  if (result.code !== 0) return null
  const match = /REG_SZ\s+(.+?)\s*$/m.exec(result.stdout)
  return match ? match[1] : null
}

function writeIfChanged(filePath, content) {
  try {
    if (fs.readFileSync(filePath, 'utf8') === content) return false
  } catch { /* missing */ }
  fs.writeFileSync(filePath, content, 'utf8')
  return true
}

/**
 * Writes <userData>/companion/{launcher,manifest} and points the browsers'
 * HKCU NativeMessagingHosts keys at the manifest. Windows only; idempotent.
 * @returns {Promise<{ registered: boolean, manifestPath?: string, extensionIds?: string[], browsers?: string[], errors?: string[], reason?: string }>}
 */
async function registerNativeHost({
  userDataDir,
  execPath,
  appPath = null,
  extensionIds,
  platform = process.platform,
  runReg = defaultRunReg,
}) {
  if (platform !== 'win32') return { registered: false, reason: 'unsupported-platform' }
  const dir = companionDir(userDataDir)
  fs.mkdirSync(dir, { recursive: true })
  const launcherPath = path.join(dir, LAUNCHER_FILE_NAME)
  const manifestPath = path.join(dir, MANIFEST_FILE_NAME)
  writeIfChanged(launcherPath, buildWindowsLauncher({ execPath, appPath, userDataDir }))
  writeIfChanged(manifestPath, `${JSON.stringify(buildHostManifest({ hostPath: launcherPath, extensionIds }), null, 2)}\n`)

  const browsers = []
  const errors = []
  for (const { browser, key: parent } of NATIVE_MESSAGING_REGISTRY_KEYS) {
    const key = `${parent}\\${NATIVE_HOST_NAME}`
    if (await readDefaultValue(runReg, key) !== manifestPath) {
      const result = await runReg(['add', key, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'])
      if (result.code !== 0) {
        errors.push(key)
        continue
      }
    }
    browsers.push(browser)
  }
  return { registered: errors.length === 0, manifestPath, extensionIds, browsers, errors }
}

module.exports = {
  RELEASE_EXTENSION_IDS,
  HOST_SWITCH,
  LAUNCHER_HOST_FLAGS,
  LAUNCHER_REDIRECTS,
  MANIFEST_FILE_NAME,
  LAUNCHER_FILE_NAME,
  NATIVE_MESSAGING_REGISTRY_KEYS,
  isValidExtensionId,
  parseExtensionIdList,
  resolveAllowedExtensionIds,
  buildHostManifest,
  buildWindowsLauncher,
  readDevelopmentExtensionIds,
  writeDevelopmentExtensionIds,
  registerNativeHost,
}
