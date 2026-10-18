'use strict'
// The browser connector of a portable build (electron/companionLink/connector.cjs)
// and how the link registers it. No Electron app starts and no registry key
// is touched: reg.exe and the connector check are replaced by fakes.
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { PassThrough } = require('node:stream')

const connector = require('../electron/companionLink/connector.cjs')
const registration = require('../electron/companionLink/registration.cjs')
const protocol = require('../electron/companionLink/protocol.cjs')
const { createCompanionLink } = require('../electron/companionLink/index.cjs')

const ROOT = path.join(__dirname, '..')
const EXE = 'Drama Studio.exe'
const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop'

const tempDirs = []
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-connector-test-'))
  tempDirs.push(dir)
  return dir
}
test.after(() => { for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true }) })

function writeFile(root, relative, content) {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
  fs.writeFileSync(path.join(root, relative), content)
}

/** A stand-in for the portable app's unpacked folder. */
function fakeUnpackedApp() {
  const dir = tempDir()
  const files = {
    [EXE]: 'exe',
    'ffmpeg.dll': 'ffmpeg',
    'icudtl.dat': 'icu',
    'resources.pak': 'pak',
    'snapshot_blob.bin': 'snap',
    'v8_context_snapshot.bin': 'v8',
    'dxcompiler.dll': 'gpu',
    'vk_swiftshader.dll': 'gpu',
    'vk_swiftshader_icd.json': '{}',
    'vulkan-1.dll': 'gpu',
    'd3dcompiler_47.dll': 'gpu',
    'elevate.exe': 'other program',
    'locales/en-US.pak': 'en',
    'locales/de.pak': 'de',
    'resources/app.asar': 'asar v1',
    'resources/app.asar.unpacked/node_modules/x/x.node': 'native',
    'resources/bin/ffmpeg.exe': 'big',
    'resources/workflows/a.json': '{}',
  }
  for (const [relative, content] of Object.entries(files)) writeFile(dir, relative, content)
  return dir
}

/** reg.exe stand-in that keeps keys in memory. */
function fakeRegistry() {
  const keys = new Map()
  const runReg = async (args) => {
    if (args[0] === 'query') {
      return keys.has(args[1]) ? { code: 0, stdout: `\r\n${args[1]}\r\n    (Default)    REG_SZ    ${keys.get(args[1])}\r\n` } : { code: 1, stdout: '' }
    }
    keys.set(args[1], args[args.indexOf('/d') + 1])
    return { code: 0, stdout: '' }
  }
  return { keys, runReg }
}

// --- What gets copied -----------------------------------------------------------

test('the connector is the executable, its runtime files, one locale and the app archive', () => {
  const source = fakeUnpackedApp()
  const files = connector.listConnectorFiles(source, { exeName: EXE }).map((item) => item.split(path.sep).join('/')).sort()
  assert.deepEqual(files, [
    EXE,
    'ffmpeg.dll',
    'icudtl.dat',
    'locales/en-US.pak',
    'resources.pak',
    'resources/app.asar',
    'resources/app.asar.unpacked/node_modules/x/x.node',
    'snapshot_blob.bin',
    'v8_context_snapshot.bin',
  ])
  fs.rmSync(path.join(source, 'resources', 'app.asar'))
  assert.throws(() => connector.listConnectorFiles(source, { exeName: EXE }), /app\.asar/)
  assert.throws(() => connector.listConnectorFiles(source, { exeName: 'Other.exe' }), /Other\.exe/)
})

test('the connector copies app.asar as a file, not through Electron\'s archive view', () => {
  // In the packaged app, plain fs sees app.asar as a folder and copyFile fails
  // (found on the portable build); only original-fs copies it whole.
  const source = fs.readFileSync(path.join(ROOT, 'electron/companionLink/connector.cjs'), 'utf8')
  assert.match(source, /require\('original-fs'\)/)
  assert.ok(!/^const fs = require\('fs'\)/m.test(source))
})

test('the fingerprint follows the version, the executable and the app archive', () => {
  const source = fakeUnpackedApp()
  const first = connector.connectorFingerprint({ sourceDir: source, exeName: EXE, version: '0.1.31' })
  assert.match(first, /^[0-9a-f]{12}$/)
  assert.equal(connector.connectorFingerprint({ sourceDir: source, exeName: EXE, version: '0.1.31' }), first)
  assert.notEqual(connector.connectorFingerprint({ sourceDir: source, exeName: EXE, version: '0.1.32' }), first)
  fs.writeFileSync(path.join(source, 'resources', 'app.asar'), 'asar v2, rebuilt')
  assert.notEqual(connector.connectorFingerprint({ sourceDir: source, exeName: EXE, version: '0.1.31' }), first)
  assert.equal(connector.connectorFolderName('0.1.31', 'abc'), '0.1.31-abc')
  assert.equal(connector.connectorFolderName('1.0.0+local/x', 'abc'), '1.0.0_local_x-abc')
})

// --- Install, reuse, replace ------------------------------------------------------

test('a connector is copied and checked once, reused, and replaced when the build changes', async () => {
  const source = fakeUnpackedApp()
  const userData = tempDir()
  const checks = []
  const selfTest = async ({ exePath }) => {
    checks.push(exePath)
    assert.equal(fs.readFileSync(exePath, 'utf8'), 'exe', 'the check runs the copied executable')
    return { ok: true, ms: 12 }
  }
  const first = await connector.ensurePortableConnector({ userDataDir: userData, sourceDir: source, exeName: EXE, version: '0.1.31', selfTest })
  assert.equal(first.ok, true)
  assert.equal(first.installed, true)
  assert.equal(path.dirname(first.dir), path.join(userData, 'companion', 'host'))
  assert.equal(first.exePath, path.join(first.dir, EXE))
  assert.deepEqual(checks, [first.exePath])
  assert.equal(fs.readFileSync(path.join(first.dir, 'resources', 'app.asar'), 'utf8'), 'asar v1')
  assert.equal(fs.existsSync(path.join(first.dir, 'resources', 'bin')), false, 'ffmpeg and other tools are not copied')
  assert.equal(fs.existsSync(path.join(first.dir, 'dxcompiler.dll')), false)
  assert.equal(fs.existsSync(`${first.dir}.partial`), false)
  const marker = JSON.parse(fs.readFileSync(path.join(first.dir, connector.MARKER_FILE_NAME), 'utf8'))
  assert.equal(marker.version, '0.1.31')
  assert.equal(marker.files, 9)
  assert.equal(first.bytes, marker.bytes)

  const again = await connector.ensurePortableConnector({ userDataDir: userData, sourceDir: source, exeName: EXE, version: '0.1.31', selfTest })
  assert.equal(again.installed, false, 'the next start reuses it')
  assert.equal(again.exePath, first.exePath)
  assert.equal(checks.length, 1)

  // A damaged copy (a file of the wrong size) is made again.
  fs.writeFileSync(path.join(first.dir, 'icudtl.dat'), '')
  const repaired = await connector.ensurePortableConnector({ userDataDir: userData, sourceDir: source, exeName: EXE, version: '0.1.31', selfTest })
  assert.equal(repaired.installed, true)
  assert.equal(fs.readFileSync(path.join(first.dir, 'icudtl.dat'), 'utf8'), 'icu')

  // A new version gets its own folder; the old one is removed.
  const next = await connector.ensurePortableConnector({ userDataDir: userData, sourceDir: source, exeName: EXE, version: '0.1.32', selfTest })
  assert.equal(next.installed, true)
  assert.notEqual(next.dir, first.dir)
  assert.deepEqual(fs.readdirSync(path.join(userData, 'companion', 'host')), [path.basename(next.dir)])
})

test('a connector that does not answer is removed and reported', async () => {
  const source = fakeUnpackedApp()
  const userData = tempDir()
  const result = await connector.ensurePortableConnector({
    userDataDir: userData, sourceDir: source, exeName: EXE, version: '0.1.31',
    selfTest: async () => ({ ok: false, ms: 20000, error: 'no answer within 20 s' }),
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /did not start \(no answer within 20 s\)/)
  assert.deepEqual(fs.readdirSync(path.join(userData, 'companion', 'host')), [])

  const missing = await connector.ensurePortableConnector({ userDataDir: userData, sourceDir: tempDir(), exeName: EXE, version: '0.1.31', selfTest: async () => ({ ok: true }) })
  assert.equal(missing.ok, false)
  assert.match(missing.error, /Drama Studio\.exe/)
})

// --- The check run ------------------------------------------------------------------

/** A spawn stand-in that answers like a host (or not). */
function fakeSpawn(answer) {
  const calls = []
  const spawn = (command, args, options) => {
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.exitCode = null
    child.signalCode = null
    child.kill = () => { child.exitCode = 1; child.emit('exit', 1); child.emit('close', 1) }
    calls.push({ command, args, options, launcher: fs.readFileSync(/""(.+?)" /.exec(args[3])[1], 'utf8') })
    const decoder = protocol.createNativeMessageDecoder({
      onMessage: (message) => answer(message, child),
      onError: () => {},
    })
    child.stdin.on('data', (chunk) => decoder.push(chunk))
    child.stdin.on('finish', () => { child.exitCode = 0; child.emit('exit', 0); child.emit('close', 0) })
    return child
  }
  return { spawn, calls }
}

test('the check starts the connector like the browser and expects app-not-running', async () => {
  const { spawn, calls } = fakeSpawn((message, child) => child.stdout.write(protocol.encodeNativeMessage(protocol.errorReply(message.id, 'app-not-running'))))
  const result = await connector.selfTestConnector({ exePath: 'C:\\Users\\a\\AppData\\Roaming\\Drama Studio\\companion\\host\\0.1.31-abc\\Drama Studio.exe', spawn, comSpec: 'cmd.exe' })
  assert.equal(result.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'cmd.exe')
  assert.deepEqual(calls[0].args.slice(0, 3), ['/d', '/s', '/c'])
  assert.match(calls[0].args[3], /chrome-extension:\/\/a{32}\/"$/)
  assert.equal(calls[0].options.windowsHide, true)
  assert.match(calls[0].launcher, /"C:\\Users\\a\\AppData\\Roaming\\Drama Studio\\companion\\host\\0\.1\.31-abc\\Drama Studio\.exe" --ds-companion-host --log-level=3 --disable-gpu --lang=en-US "--ds-companion-user-data=/)
  assert.ok(!calls[0].launcher.includes('Roaming\\Drama Studio"'), 'the check never uses the real settings folder and its link secret')
})

test('the check fails on a wrong answer, an early exit or silence', async () => {
  const wrong = fakeSpawn((message, child) => child.stdout.write(protocol.encodeNativeMessage({ type: 'hello.reply', id: message.id, appVersion: 'x', paired: true })))
  assert.match((await connector.selfTestConnector({ exePath: 'C:\\x\\Drama Studio.exe', spawn: wrong.spawn })).error, /unexpected answer/)

  const exits = fakeSpawn((_message, child) => { child.exitCode = 3; child.emit('exit', 3); child.emit('close', 3) })
  assert.match((await connector.selfTestConnector({ exePath: 'C:\\x\\Drama Studio.exe', spawn: exits.spawn })).error, /stopped with code 3/)

  const silent = fakeSpawn(() => {})
  const result = await connector.selfTestConnector({ exePath: 'C:\\x\\Drama Studio.exe', spawn: silent.spawn, timeoutMs: 50 })
  assert.equal(result.ok, false)
  assert.match(result.error, /no answer/)
})

// --- Registration from the running app ----------------------------------------------

// No Store ID by default, so each test controls exactly which IDs may connect.
function portableLink({ env = {}, ensureConnector, userData = tempDir(), releaseExtensionIds = [] } = {}) {
  const registry = fakeRegistry()
  const changes = []
  const link = createCompanionLink({
    userDataDir: userData,
    appVersion: '0.1.31',
    execPath: 'C:\\Users\\a\\AppData\\Local\\Temp\\2abc\\Drama Studio.exe',
    portableSourceDir: 'C:\\Users\\a\\AppData\\Local\\Temp\\2abc',
    ensureConnector,
    runReg: registry.runReg,
    requestApproval: async () => false,
    openExternal: async () => {},
    onChange: () => changes.push('changed'),
    env,
    platform: 'win32',
    releaseExtensionIds,
  })
  return { link, registry, userData, changes }
}

test('a portable app registers its connector, never the self-extracting .exe', async () => {
  const requests = []
  const userData = tempDir()
  const connectorExe = path.join(userData, 'companion', 'host', '0.1.31-abc', EXE)
  const { link, registry, changes } = portableLink({
    userData,
    ensureConnector: async (options) => { requests.push(options); return { ok: true, exePath: connectorExe, dir: path.dirname(connectorExe), installed: true, bytes: 330_000_000 } },
  })
  const status = await link.addDevelopmentExtensionId(EXT_ID)
  assert.equal(status.registered, true)
  assert.equal(status.portable, true)
  assert.equal(status.connectorBytes, 330_000_000)
  assert.equal(status.registrationReason, null)
  assert.deepEqual(requests.map(({ sourceDir, exeName, version }) => ({ sourceDir, exeName, version })), [
    { sourceDir: 'C:\\Users\\a\\AppData\\Local\\Temp\\2abc', exeName: EXE, version: '0.1.31' },
  ])
  const manifestPath = path.join(userData, 'companion', registration.MANIFEST_FILE_NAME)
  for (const value of registry.keys.values()) assert.equal(value, manifestPath)
  const launcher = fs.readFileSync(path.join(userData, 'companion', registration.LAUNCHER_FILE_NAME), 'utf8')
  assert.ok(launcher.startsWith(`@echo off\r\n"${connectorExe}" --ds-companion-host --log-level=3 --disable-gpu --lang=en-US "--ds-companion-user-data=${userData}"`), launcher)
  assert.ok(!launcher.includes('Temp\\2abc'))
  assert.ok(changes.length >= 1, 'Settings › Browser hears about "preparing"')

  // The connector is looked up once per run.
  await link.removeDevelopmentExtensionId('ponmlkjihgfedcbaponmlkjihgfedcba')
  assert.equal(requests.length, 1)

  const log = fs.readFileSync(path.join(userData, 'companion', 'link.log'), 'utf8')
  assert.match(log, /host registered for Chrome, Edge, Chromium; updated ds-companion-host\.cmd, com\.dramastudio\.companion\.json, Chrome, Edge, Chromium/)
  assert.match(log, /host registered for Chrome, Edge, Chromium; already up to date/)
})

test('a portable app copies nothing while no extension may connect, and says why it cannot link', async () => {
  let calls = 0
  const { link, registry, userData } = portableLink({ ensureConnector: async () => { calls += 1; return { ok: false, error: 'not enough disk space' } } })
  await link.removeDevelopmentExtensionId('x')
  assert.equal(link.status().registrationReason, 'no-extension-ids')
  assert.equal(calls, 0)
  assert.equal(registry.keys.size, 0)

  const status = await link.addDevelopmentExtensionId(EXT_ID)
  assert.equal(status.registered, false)
  assert.equal(status.registrationReason, 'connector-failed')
  assert.equal(registry.keys.size, 0, 'nothing points the browser at a connector that is not there')
  assert.match(fs.readFileSync(path.join(userData, 'companion', 'link.log'), 'utf8'), /host not registered \(connector-failed\): not enough disk space/)
})

test('taking the last extension ID away updates the manifest at once', async () => {
  const userData = tempDir()
  const connectorExe = path.join(userData, 'companion', 'host', '0.1.31-abc', EXE)
  const { link } = portableLink({ userData, ensureConnector: async () => ({ ok: true, exePath: connectorExe, bytes: 1 }) })
  await link.addDevelopmentExtensionId(EXT_ID)
  const manifestPath = path.join(userData, 'companion', registration.MANIFEST_FILE_NAME)
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).allowed_origins, [`chrome-extension://${EXT_ID}/`])
  const status = await link.removeDevelopmentExtensionId(EXT_ID)
  assert.equal(status.registrationReason, 'no-extension-ids')
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).allowed_origins, [])
})

test('a failed connector still takes removed extension IDs out of the manifest', async () => {
  const userData = tempDir()
  const other = 'ponmlkjihgfedcbaponmlkjihgfedcba'
  let healthy = true
  const connectorExe = path.join(userData, 'companion', 'host', '0.1.31-abc', EXE)
  const { link } = portableLink({ userData, ensureConnector: async () => (healthy ? { ok: true, exePath: connectorExe, bytes: 1 } : { ok: false, error: 'not enough disk space' }) })
  await link.addDevelopmentExtensionId(EXT_ID)
  await link.addDevelopmentExtensionId(other)
  const manifestPath = path.join(userData, 'companion', registration.MANIFEST_FILE_NAME)
  assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).allowed_origins.length, 2)
  // A later run whose connector cannot be set up (fresh link, same folder).
  healthy = false
  const { link: later } = portableLink({ userData, ensureConnector: async () => ({ ok: false, error: 'not enough disk space' }) })
  const status = await later.removeDevelopmentExtensionId(EXT_ID)
  assert.equal(status.registrationReason, 'connector-failed')
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).allowed_origins, [`chrome-extension://${other}/`])
})

test('test copies skip registration and say so', async () => {
  const { link, registry } = portableLink({ env: { DS_COMPANION_SKIP_REGISTRATION: '1', DS_COMPANION_EXTENSION_IDS: EXT_ID }, ensureConnector: async () => assert.fail('no connector for a test copy') })
  const status = await link.addDevelopmentExtensionId(EXT_ID)
  assert.equal(status.registrationReason, 'skipped')
  assert.equal(registry.keys.size, 0)
})

test('installed and unpacked builds still register their own executable', async () => {
  const registry = fakeRegistry()
  const userData = tempDir()
  const link = createCompanionLink({
    userDataDir: userData,
    appVersion: '0.1.31',
    execPath: 'C:\\Program Files\\Drama Studio\\Drama Studio.exe',
    ensureConnector: async () => assert.fail('only portable builds copy a connector'),
    runReg: registry.runReg,
    requestApproval: async () => false,
    openExternal: async () => {},
    env: {},
    platform: 'win32',
  })
  const status = await link.addDevelopmentExtensionId(EXT_ID)
  assert.equal(status.registered, true)
  assert.equal(status.portable, false)
  assert.equal(
    fs.readFileSync(path.join(userData, 'companion', registration.LAUNCHER_FILE_NAME), 'utf8'),
    `@echo off\r\n"C:\\Program Files\\Drama Studio\\Drama Studio.exe" --ds-companion-host --log-level=3 --disable-gpu "--ds-companion-user-data=${userData}" %* 2>&1 1>nul\r\n`,
  )
})

test('main.js registers the running executable and hands portable builds their unpacked folder', () => {
  const main = fs.readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8')
  const block = main.slice(main.indexOf('const companionLink = createCompanionLink({'), main.indexOf('registerCompanionLinkIpc(ipcMain, companionLink)'))
  assert.match(block, /execPath: process\.execPath,/)
  assert.ok(!/execPath: process\.env\.PORTABLE_EXECUTABLE_FILE/.test(block), 'the self-extracting .exe is never the host')
  assert.match(block, /portableSourceDir: process\.env\.PORTABLE_EXECUTABLE_FILE && app\.isPackaged \? path\.dirname\(process\.execPath\) : null,/)
})

test('an installed app allows the Companion Store ID with no setup', async () => {
  const userData = tempDir()
  const connectorExe = path.join(userData, 'companion', 'host', '0.1.31-abc', EXE)
  const { link } = portableLink({ userData, releaseExtensionIds: registration.RELEASE_EXTENSION_IDS, ensureConnector: async () => ({ ok: true, exePath: connectorExe, bytes: 1 }) })
  const status = await link.removeDevelopmentExtensionId('x')
  assert.equal(status.registered, true)
  assert.deepEqual(status.extensionIds, [{ id: registration.RELEASE_EXTENSION_IDS[0], source: 'release' }])
  const manifest = JSON.parse(fs.readFileSync(path.join(userData, 'companion', registration.MANIFEST_FILE_NAME), 'utf8'))
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${registration.RELEASE_EXTENSION_IDS[0]}/`])
})
