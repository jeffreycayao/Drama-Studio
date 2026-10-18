'use strict'

// The browser connector of a portable build (plan §4).
//
// The portable .exe is a self-extractor: each start unpacks the whole app to
// a temporary folder and deletes it on exit. Registered as the native host,
// Chrome would start that .exe, which unpacks about 180 MB before it can
// answer (the Companion waits 5 s), and the temporary folder is gone once
// the app closes. So a portable app keeps a connector of its own: the files
// its executable needs in host mode, copied once per version into
// <userData>/companion/host/<version>-<fingerprint>/, started once to check
// it answers, and registered in place of the .exe.
//
// Nothing about the link's security changes. It is the same executable and
// app.asar (the fuses tie the two together), it still proves itself to the
// app over the per-user pipe with the link secret, and the manifest still
// lists only the allowed extension IDs. The folder is as writable by the user
// as the portable .exe itself.

const crypto = require('crypto')
// Electron's fs treats app.asar as a folder; copying and sizing it needs the
// plain file system. Outside Electron (tests) there is only fs.
const fs = (() => {
  try {
    return require('original-fs')
  } catch {
    return require('fs')
  }
})()
const os = require('os')
const path = require('path')
const { spawn: defaultSpawn } = require('child_process')
const { companionDir } = require('./pairing.cjs')
const { buildWindowsLauncher } = require('./registration.cjs')
const { createNativeMessageDecoder, encodeNativeMessage } = require('./protocol.cjs')

const CONNECTOR_DIR_NAME = 'host'
const MARKER_FILE_NAME = 'connector.json'
// Host mode loads one locale; the launcher asks for it with --lang.
const CONNECTOR_LOCALE = 'en-US'
// GPU libraries: host mode never draws (hardware acceleration is off and no
// window opens), and Chromium loads these only when it does.
const OPTIONAL_RUNTIME_FILES = new Set([
  'd3dcompiler_47.dll',
  'dxcompiler.dll',
  'dxil.dll',
  'libegl.dll',
  'libglesv2.dll',
  'vk_swiftshader.dll',
  'vk_swiftshader_icd.json',
  'vulkan-1.dll',
])
const SELF_TEST_TIMEOUT_MS = 20_000
// Any well-formed ID: with no link secret the host answers before it looks.
const SELF_TEST_ORIGIN = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'

/**
 * Paths, relative to the unpacked app folder, that make up the connector:
 * the executable and the runtime files beside it (no GPU libraries, no other
 * programs), one locale, and the app archive the executable is tied to.
 * Folders such as resources/bin (ffmpeg) are not needed to relay messages.
 */
function listConnectorFiles(sourceDir, { exeName, readdirSync = fs.readdirSync, existsSync = fs.existsSync } = {}) {
  const files = []
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const lower = entry.name.toLowerCase()
    if (OPTIONAL_RUNTIME_FILES.has(lower)) continue
    if (lower.endsWith('.exe') && entry.name !== exeName) continue
    files.push(entry.name)
  }
  if (!files.includes(exeName)) throw new Error(`${exeName} is not in the app folder.`)
  const required = [path.join('locales', `${CONNECTOR_LOCALE}.pak`), path.join('resources', 'app.asar')]
  for (const relative of required) {
    if (!existsSync(path.join(sourceDir, relative))) throw new Error(`${relative} is not in the app folder.`)
    files.push(relative)
  }
  const unpacked = path.join('resources', 'app.asar.unpacked')
  const walk = (relative) => {
    for (const entry of readdirSync(path.join(sourceDir, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name)
      if (entry.isDirectory()) walk(child)
      else if (entry.isFile()) files.push(child)
    }
  }
  if (existsSync(path.join(sourceDir, unpacked))) walk(unpacked)
  return files
}

/** Changes whenever the executable or the app archive does, even within a version. */
function connectorFingerprint({ sourceDir, exeName, version, statSync = fs.statSync }) {
  const parts = [version]
  for (const relative of [exeName, path.join('resources', 'app.asar')]) {
    const stat = statSync(path.join(sourceDir, relative))
    parts.push(relative, stat.size, Math.floor(stat.mtimeMs))
  }
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 12)
}

function connectorFolderName(version, fingerprint) {
  return `${String(version || '0').replace(/[^0-9A-Za-z.-]/g, '_')}-${fingerprint}`
}

const connectorRoot = (userDataDir) => path.join(companionDir(userDataDir), CONNECTOR_DIR_NAME)

/** True when <dir> holds a checked connector made from these exact source files. */
function isConnectorComplete({ dir, sourceDir, files, fingerprint, statSync = fs.statSync, readFileSync = fs.readFileSync }) {
  try {
    const marker = JSON.parse(readFileSync(path.join(dir, MARKER_FILE_NAME), 'utf8'))
    if (marker?.fingerprint !== fingerprint || marker?.files !== files.length) return false
    return files.every((relative) => statSync(path.join(dir, relative)).size === statSync(path.join(sourceDir, relative)).size)
  } catch {
    return false
  }
}

/**
 * Starts a connector the way the browser does, with a settings folder that
 * has no link secret, so a working host answers app-not-running at once
 * without touching the running app or asking anyone to allow a browser.
 * @returns {Promise<{ ok: boolean, ms: number, error?: string }>}
 */
async function selfTestConnector({
  exePath,
  timeoutMs = SELF_TEST_TIMEOUT_MS,
  spawn = defaultSpawn,
  tmpDir = os.tmpdir(),
  comSpec = process.env.ComSpec || 'cmd.exe',
}) {
  const scratch = fs.mkdtempSync(path.join(tmpDir, 'ds-companion-check-'))
  const launcherPath = path.join(scratch, 'check.cmd')
  fs.writeFileSync(launcherPath, buildWindowsLauncher({ execPath: exePath, userDataDir: scratch, lang: CONNECTOR_LOCALE }), 'utf8')
  const started = Date.now()
  const child = spawn(comSpec, ['/d', '/s', '/c', `""${launcherPath}" ${SELF_TEST_ORIGIN}"`], {
    windowsVerbatimArguments: true,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  const result = await new Promise((resolve) => {
    let settled = false
    const settle = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ...value, ms: Date.now() - started })
    }
    const timer = setTimeout(() => settle({ ok: false, error: `no answer within ${Math.round(timeoutMs / 1000)} s` }), timeoutMs)
    const decoder = createNativeMessageDecoder({
      onMessage: (message) => settle(message?.type === 'error' && message?.id === 'connector-check' && message?.code === 'app-not-running'
        ? { ok: true }
        : { ok: false, error: `unexpected answer ${JSON.stringify(message).slice(0, 120)}` }),
      onError: (error) => settle({ ok: false, error: `bad answer: ${error?.message || error}` }),
    })
    child.stdout.on('data', (chunk) => decoder.push(chunk))
    child.on('error', (error) => settle({ ok: false, error: error?.message || String(error) }))
    // 'close' comes after the last output, so an answer is never cut off.
    child.on('close', (code) => settle({ ok: false, error: `stopped with code ${code} before answering` }))
    child.stdin.on('error', () => {})
    child.stdin.write(encodeNativeMessage({ type: 'hello', id: 'connector-check', protocol: 1, extVersion: '0.0.0', browser: 'Drama Studio check' }))
  })
  // A working host stops when its input closes; make sure it is gone before
  // the scratch folder (its Chromium profile) is removed.
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve()
    const timer = setTimeout(() => { try { child.kill() } catch { /* gone */ } resolve() }, 5000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    try { child.stdin.end() } catch { /* closed */ }
  })
  fs.rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }, () => {})
  return result
}

/** Removes connectors of other versions. One in use stays until a later start. */
async function removeOtherConnectors(root, keepName, fsp = fs.promises) {
  let entries = []
  try { entries = await fsp.readdir(root) } catch { return }
  await Promise.all(entries.filter((name) => name !== keepName).map((name) =>
    fsp.rm(path.join(root, name), { recursive: true, force: true }).catch(() => {})))
}

/**
 * Makes sure this portable build has a checked connector and returns its
 * executable. Copies only when the version or build changed.
 * @returns {Promise<{ ok: true, exePath: string, dir: string, installed: boolean, bytes: number } | { ok: false, error: string }>}
 */
async function ensurePortableConnector({
  userDataDir,
  sourceDir,
  exeName,
  version,
  selfTest = selfTestConnector,
  fsp = fs.promises,
  log = () => {},
}) {
  try {
    const files = listConnectorFiles(sourceDir, { exeName })
    const fingerprint = connectorFingerprint({ sourceDir, exeName, version })
    const name = connectorFolderName(version, fingerprint)
    const root = connectorRoot(userDataDir)
    const dir = path.join(root, name)
    const exePath = path.join(dir, exeName)
    const bytes = files.reduce((sum, relative) => sum + fs.statSync(path.join(sourceDir, relative)).size, 0)

    if (isConnectorComplete({ dir, sourceDir, files, fingerprint })) {
      await removeOtherConnectors(root, name, fsp)
      return { ok: true, exePath, dir, installed: false, bytes }
    }

    log(`copying the browser connector (${Math.round(bytes / 1048576)} MB) to ${dir}`)
    const staging = `${dir}.partial`
    await fsp.rm(staging, { recursive: true, force: true })
    for (const relative of files) {
      await fsp.mkdir(path.dirname(path.join(staging, relative)), { recursive: true })
      await fsp.copyFile(path.join(sourceDir, relative), path.join(staging, relative))
    }
    await fsp.rm(dir, { recursive: true, force: true })
    await fsp.rename(staging, dir)

    const check = await selfTest({ exePath })
    if (!check.ok) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, error: `the copied connector did not start (${check.error})` }
    }
    await fsp.writeFile(path.join(dir, MARKER_FILE_NAME), `${JSON.stringify({
      version, fingerprint, files: files.length, bytes, checkedInMs: check.ms, installedAt: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8')
    log(`browser connector ready in ${dir} (answered in ${check.ms} ms)`)
    await removeOtherConnectors(root, name, fsp)
    return { ok: true, exePath, dir, installed: true, bytes }
  } catch (error) {
    return { ok: false, error: error?.code === 'ENOSPC' ? 'not enough disk space' : (error?.message || String(error)) }
  }
}

module.exports = {
  CONNECTOR_DIR_NAME,
  CONNECTOR_LOCALE,
  MARKER_FILE_NAME,
  OPTIONAL_RUNTIME_FILES,
  listConnectorFiles,
  connectorFingerprint,
  connectorFolderName,
  connectorRoot,
  isConnectorComplete,
  selfTestConnector,
  ensurePortableConnector,
}
