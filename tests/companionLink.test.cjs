'use strict'
// Desktop side of the Drama Studio Companion link: wire format, hand-off
// tokens, pairing, the request service, the real pipe between the native
// host and the app, and host registration. No Electron app starts.
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { PassThrough } = require('node:stream')

const protocol = require('../electron/companionLink/protocol.cjs')
const { createHandoffStore, buildHandoffUrl, HANDOFF_SITES, HANDOFF_TTL_MS } = require('../electron/companionLink/handoffs.cjs')
const pairing = require('../electron/companionLink/pairing.cjs')
const { createCompanionLinkService } = require('../electron/companionLink/linkService.cjs')
const { createCompanionLinkServer } = require('../electron/companionLink/linkServer.cjs')
const { runCompanionHost, findExtensionOrigin } = require('../electron/companionLink/host.cjs')
const registration = require('../electron/companionLink/registration.cjs')

const ROOT = path.join(__dirname, '..')
const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop'
const ORIGIN = `chrome-extension://${EXT_ID}/`
const OTHER_ORIGIN = 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/'

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ds-companion-test-'))
const hello = (extra = {}) => ({ type: 'hello', id: 'req-00000001', protocol: 1, extVersion: '0.1.0', browser: 'Chrome 141', ...extra })
const fetchRequest = (token, extra = {}) => ({ type: 'handoff.fetch', id: 'req-00000002', protocol: 1, token, ...extra })

// --- Wire format --------------------------------------------------------------

test('requests are validated as strictly as the Companion schemas', () => {
  assert.equal(protocol.parseCompanionRequest(hello()).ok, true)
  assert.equal(protocol.parseCompanionRequest(fetchRequest('A'.repeat(16))).ok, true)
  const refused = [
    hello({ extra: 1 }),
    hello({ protocol: 3 }),
    hello({ browser: 'x'.repeat(65) }),
    hello({ extVersion: 'x'.repeat(33) }),
    hello({ id: 'short' }),
    fetchRequest('A'.repeat(15)),
    fetchRequest('bad token with spaces!'),
    fetchRequest('A'.repeat(129)),
    { type: 'batch.progress', id: 'req-00000003', protocol: 1, batchId: 'b', done: 0, total: 1 },
    null,
    [],
  ]
  for (const value of refused) {
    const result = protocol.parseCompanionRequest(value)
    assert.equal(result.ok, false, JSON.stringify(value))
    assert.equal(result.code, 'protocol')
  }
  assert.equal(protocol.parseCompanionRequest(hello({ extra: 1 })).id, 'req-00000001')
  assert.equal(protocol.parseCompanionRequest({ type: 'hello' }).id, protocol.UNKNOWN_REQUEST_ID)
})

test('replies match the Companion reply shapes', () => {
  assert.deepEqual(protocol.helloReply('req-00000001', { appVersion: '0.1.23', paired: true }), { type: 'hello.reply', id: 'req-00000001', appVersion: '0.1.23', paired: true })
  assert.equal(protocol.helloReply('req-00000001', { appVersion: 'x'.repeat(40) }).appVersion.length, 32)
  assert.deepEqual(protocol.errorReply('req-00000001', 'nonsense'), { type: 'error', id: 'req-00000001', code: 'protocol' })
  assert.equal(protocol.errorReply(undefined, 'timeout').id, protocol.UNKNOWN_REQUEST_ID)
  // The error codes are the Companion's desktopErrorCodeSchema, in order.
  const contracts = fs.readFileSync(path.join(ROOT, 'extensions/companion/src/desktop/contracts.ts'), 'utf8')
  const enumBody = /desktopErrorCodeSchema = z\.enum\(\[([\s\S]*?)\]\)/.exec(contracts)[1]
  assert.deepEqual([...enumBody.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]), [...protocol.DESKTOP_ERROR_CODES])
  assert.match(contracts, new RegExp(`NATIVE_HOST_NAME = '${protocol.NATIVE_HOST_NAME}'`))
  assert.match(contracts, new RegExp(`PROTOCOL_VERSION = ${protocol.PROTOCOL_VERSION}`))
})

test('native framing round-trips split chunks and refuses oversized frames', () => {
  const received = []
  const decoder = protocol.createNativeMessageDecoder({ onMessage: (value) => received.push(value), onError: assert.fail })
  const bytes = Buffer.concat([protocol.encodeNativeMessage({ a: 1 }), protocol.encodeNativeMessage({ b: 'ü'.repeat(10) })])
  for (const byte of bytes) decoder.push(Buffer.from([byte]))
  assert.deepEqual(received, [{ a: 1 }, { b: 'ü'.repeat(10) }])

  let error = null
  const big = protocol.createNativeMessageDecoder({ onMessage: assert.fail, onError: (value) => { error = value } })
  const header = Buffer.alloc(4)
  header.writeUInt32LE(protocol.MAX_NATIVE_MESSAGE_BYTES + 1)
  big.push(header)
  assert.ok(error)
  assert.throws(() => protocol.encodeNativeMessage({ text: 'x'.repeat(protocol.MAX_NATIVE_MESSAGE_BYTES) }))
})

test('extension origins are recognised only in the exact form Chrome passes', () => {
  assert.equal(protocol.extensionIdFromOrigin(ORIGIN), EXT_ID)
  for (const value of ['chrome-extension://ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP/', `chrome-extension://${EXT_ID}`, `https://${EXT_ID}/`, `chrome-extension://${EXT_ID}/x`, null]) {
    assert.equal(protocol.extensionIdFromOrigin(value), null)
  }
  assert.equal(findExtensionOrigin(['Drama Studio.exe', '--ds-companion-host', ORIGIN, '--parent-window=0']), ORIGIN)
  assert.equal(findExtensionOrigin(['Drama Studio.exe', '--ds-companion-host']), null)
})

// --- Hand-off tokens ------------------------------------------------------------

test('hand-off tokens are one-time, expire after 5 minutes and match the token format', () => {
  let clock = 1_000
  const store = createHandoffStore({ now: () => clock })
  const created = store.create({ siteId: 'chatgpt', prompt: 'A neon city at dusk' })
  assert.match(created.token, /^[A-Za-z0-9_-]{16,128}$/)
  assert.equal(created.url, `https://chatgpt.com/#ds=${created.token}`)
  assert.equal(created.expiresAt, 1_000 + HANDOFF_TTL_MS)
  assert.deepEqual(store.take(created.token), { siteId: 'chatgpt', prompt: 'A neon city at dusk' })
  assert.equal(store.take(created.token), null, 'second fetch')

  const late = store.create({ siteId: 'grok', prompt: 'x' })
  clock += HANDOFF_TTL_MS
  assert.equal(store.take(late.token), null, 'expired')
  assert.equal(store.take('not a token'), null)

  const tokens = new Set(Array.from({ length: 20 }, () => store.create({ siteId: 'claude', prompt: 'p' }).token))
  assert.equal(tokens.size, 20)
})

test('hand-offs refuse unknown sites, empty prompts and prompts that cannot fit one message', () => {
  const store = createHandoffStore()
  assert.throws(() => store.create({ siteId: 'evil.example', prompt: 'x' }), /listed sites/)
  assert.throws(() => store.create({ siteId: 'chatgpt', prompt: '   ' }), /no prompt/)
  assert.throws(() => store.create({ siteId: 'chatgpt', prompt: 'x'.repeat(protocol.MAX_PROMPT_CHARS + 1) }), /too long/)
  assert.throws(() => store.create({ siteId: 'chatgpt', prompt: '\u0001'.repeat(protocol.MAX_PROMPT_CHARS) }), /too large/)
  assert.ok(store.create({ siteId: 'chatgpt', prompt: 'é'.repeat(protocol.MAX_PROMPT_CHARS) }).token)
  assert.throws(() => buildHandoffUrl('chatgpt', 'short'))
})

test('hand-off sites are the Companion prompt sites, on https', () => {
  const sites = fs.readFileSync(path.join(ROOT, 'extensions/companion/src/sites/prompt-sites.ts'), 'utf8')
  const companionIds = /PromptSiteId =([\s\S]*?);/.exec(sites)[1].match(/'([a-z]+)'/g).map((value) => value.slice(1, -1))
  assert.deepEqual(HANDOFF_SITES.map((site) => site.id).sort(), companionIds.sort())
  for (const site of HANDOFF_SITES) {
    const url = new URL(site.url)
    assert.equal(url.protocol, 'https:')
    assert.equal(url.hash, '')
    assert.ok(sites.includes(`'${url.hostname}'`), `${url.hostname} is a Companion hostname`)
  }
})

// --- Pairing ------------------------------------------------------------------

test('the link secret is created once and reused', () => {
  const dir = tempDir()
  assert.equal(pairing.readPairingSecret(dir), null)
  const secret = pairing.ensurePairingSecret(dir)
  assert.match(secret, /^[0-9a-f]{64}$/)
  assert.equal(pairing.ensurePairingSecret(dir), secret)
  assert.equal(pairing.readPairingSecret(dir), secret)
})

test('handshake proofs bind role and both nonces', () => {
  const secret = 'a'.repeat(64)
  const proof = pairing.handshakeProof(secret, 'app', 'n1', 'n2')
  assert.equal(pairing.verifyHandshakeProof(secret, 'app', 'n1', 'n2', proof), true)
  assert.equal(pairing.verifyHandshakeProof(secret, 'host', 'n1', 'n2', proof), false)
  assert.equal(pairing.verifyHandshakeProof(secret, 'app', 'n2', 'n1', proof), false)
  assert.equal(pairing.verifyHandshakeProof('b'.repeat(64), 'app', 'n1', 'n2', proof), false)
  assert.equal(pairing.verifyHandshakeProof(secret, 'app', 'n1', 'n2', 'zz'), false)
})

test('the pipe is per user on Windows and inside userData elsewhere', () => {
  assert.equal(pairing.companionPipePath({ platform: 'win32', username: 'Jeff C.' }), '\\\\.\\pipe\\drama-studio-companion-Jeff_C.')
  assert.equal(pairing.companionPipePath({ platform: 'win32', username: '' }), '\\\\.\\pipe\\drama-studio-companion-user')
  assert.equal(pairing.companionPipePath({ platform: 'linux', userDataDir: '/home/a/.config/Drama Studio' }), path.join('/home/a/.config/Drama Studio', 'companion', 'link.sock'))
})

test('paired browsers persist, can be removed, and labels are cleaned', () => {
  const dir = tempDir()
  const store = pairing.createPairedBrowserStore({ userDataDir: dir, now: () => Date.parse('2026-10-17T10:00:00Z') })
  assert.equal(store.isPaired(ORIGIN), false)
  const record = store.add({ origin: ORIGIN, browser: 'Chrome\u0007 141', extVersion: '0.1.0' })
  assert.equal(record.extensionId, EXT_ID)
  assert.equal(record.browser, 'Chrome  141')
  assert.equal(store.add({ origin: ORIGIN, browser: 'Chrome 142' }).id, record.id, 'one record per origin')
  assert.throws(() => store.add({ origin: 'https://example.com/' }))

  const reloaded = pairing.createPairedBrowserStore({ userDataDir: dir })
  assert.equal(reloaded.isPaired(ORIGIN), true)
  assert.equal(reloaded.list().length, 1)
  assert.equal(reloaded.remove('nope'), false)
  assert.equal(reloaded.remove(record.id), true)
  assert.equal(pairing.createPairedBrowserStore({ userDataDir: dir }).isPaired(ORIGIN), false)
})

// --- Request service ------------------------------------------------------------

function serviceFixture({ approve = true } = {}) {
  let clock = 0
  const prompts = []
  const store = pairing.createPairedBrowserStore({ userDataDir: tempDir() })
  const handoffs = createHandoffStore({ now: () => clock })
  const service = createCompanionLinkService({
    store,
    handoffs,
    appVersion: '0.1.23',
    now: () => clock,
    requestApproval: async (details) => { prompts.push(details); return typeof approve === 'function' ? approve(details) : approve },
  })
  return { service, store, handoffs, prompts, advance: (ms) => { clock += ms } }
}
const settle = () => new Promise((resolve) => setImmediate(resolve))

test('an unpaired browser gets paired:false at once and one approval prompt', async () => {
  const { service, prompts } = serviceFixture()
  const first = await service.handleRequest(hello(), { origin: ORIGIN })
  assert.deepEqual(first, { type: 'hello.reply', id: 'req-00000001', appVersion: '0.1.23', paired: false })
  await service.handleRequest(hello(), { origin: ORIGIN })
  await settle()
  assert.equal(prompts.length, 1, 'no second prompt while the first is open')
  assert.deepEqual(prompts[0], { origin: ORIGIN, extensionId: EXT_ID, browser: 'Chrome 141', extVersion: '0.1.0' })
  const after = await service.handleRequest(hello(), { origin: ORIGIN })
  assert.equal(after.paired, true)
  assert.equal(service.listPaired().length, 1)
})

test('"Don\'t allow" is remembered for a while', async () => {
  const { service, prompts, advance } = serviceFixture({ approve: false })
  await service.handleRequest(hello(), { origin: ORIGIN })
  await settle()
  await service.handleRequest(hello(), { origin: ORIGIN })
  await settle()
  assert.equal(prompts.length, 1)
  advance(11 * 60 * 1000)
  await service.handleRequest(hello(), { origin: ORIGIN })
  await settle()
  assert.equal(prompts.length, 2)
})

test('hand-offs go to paired browsers only, once', async () => {
  const { service, handoffs, store } = serviceFixture({ approve: false })
  const { token } = handoffs.create({ siteId: 'gemini', prompt: 'Storyboard a heist' })
  assert.deepEqual(await service.handleRequest(fetchRequest(token), { origin: ORIGIN }), { type: 'error', id: 'req-00000002', code: 'not-paired' })

  store.add({ origin: ORIGIN, browser: 'Edge 141', extVersion: '0.1.0' })
  assert.deepEqual(await service.handleRequest(fetchRequest(token), { origin: ORIGIN }), { type: 'handoff.reply', id: 'req-00000002', prompt: 'Storyboard a heist', site: 'gemini' })
  assert.deepEqual(await service.handleRequest(fetchRequest(token), { origin: ORIGIN }), { type: 'error', id: 'req-00000002', code: 'handoff-expired' })
  assert.equal((await service.handleRequest(fetchRequest('Z'.repeat(32)), { origin: OTHER_ORIGIN })).code, 'not-paired')
})

test('requests without a valid extension origin or shape are refused', async () => {
  const { service, prompts } = serviceFixture()
  assert.equal((await service.handleRequest(hello(), { origin: 'https://evil.example/' })).code, 'protocol')
  assert.equal((await service.handleRequest(hello({ protocol: 9 }), { origin: ORIGIN })).code, 'protocol')
  await settle()
  assert.equal(prompts.length, 0)
})

// --- Native host <-> app over a real pipe ---------------------------------------

const testPipePath = () => (process.platform === 'win32'
  ? `\\\\.\\pipe\\ds-companion-test-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
  : path.join(tempDir(), 'link.sock'))

function startHost({ pipePath, secret, origin = ORIGIN }) {
  const input = new PassThrough()
  const replies = []
  let notify = () => {}
  const decoder = protocol.createNativeMessageDecoder({ onMessage: (value) => { replies.push(value); notify() }, onError: assert.fail })
  const done = runCompanionHost({
    input,
    writeOutput: (buffer) => decoder.push(buffer),
    origin,
    connect: () => net.connect(pipePath),
    readSecret: () => secret,
  })
  const send = (message) => input.write(protocol.encodeNativeMessage(message))
  const nextReply = () => new Promise((resolve) => {
    if (replies.length) return resolve(replies.shift())
    notify = () => { notify = () => {}; resolve(replies.shift()) }
  })
  return { send, nextReply, close: () => { input.end(); return done } }
}

async function startApp({ secret, approve = true } = {}) {
  const pipePath = testPipePath()
  const fixture = serviceFixture({ approve })
  const server = createCompanionLinkServer({ pipePath, getSecret: () => secret, handleRequest: fixture.service.handleRequest })
  const state = await server.start()
  assert.equal(state.listening, true)
  return { ...fixture, server, pipePath }
}

test('end to end: hello, approval, then a one-time hand-off through host and pipe', async () => {
  const secret = crypto.randomBytes(32).toString('hex')
  const app = await startApp({ secret })
  try {
    const host = startHost({ pipePath: app.pipePath, secret })
    host.send(hello())
    assert.deepEqual(await host.nextReply(), { type: 'hello.reply', id: 'req-00000001', appVersion: '0.1.23', paired: false })
    await settle()
    host.send(hello({ id: 'req-00000009' }))
    assert.equal((await host.nextReply()).paired, true, 'paired after "Allow"')

    const { token } = app.handoffs.create({ siteId: 'claude', prompt: 'Write a cold open' })
    host.send(fetchRequest(token))
    assert.deepEqual(await host.nextReply(), { type: 'handoff.reply', id: 'req-00000002', prompt: 'Write a cold open', site: 'claude' })
    host.send(fetchRequest(token, { id: 'req-00000003' }))
    assert.deepEqual(await host.nextReply(), { type: 'error', id: 'req-00000003', code: 'handoff-expired' })
    assert.equal(await host.close(), 0)
  } finally {
    await app.server.stop()
  }
})

test('the host answers app-not-running when the app is closed or has no secret yet', async () => {
  const closed = startHost({ pipePath: testPipePath(), secret: 'a'.repeat(64) })
  closed.send(hello())
  assert.deepEqual(await closed.nextReply(), { type: 'error', id: 'req-00000001', code: 'app-not-running' })
  await closed.close()

  const neverStarted = startHost({ pipePath: testPipePath(), secret: null })
  neverStarted.send(hello())
  assert.equal((await neverStarted.nextReply()).code, 'app-not-running')
  await neverStarted.close()
})

test('a pipe with another secret is not trusted, in either direction', async () => {
  const app = await startApp({ secret: crypto.randomBytes(32).toString('hex') })
  try {
    const host = startHost({ pipePath: app.pipePath, secret: crypto.randomBytes(32).toString('hex') })
    host.send(hello())
    assert.equal((await host.nextReply()).code, 'app-not-running')
    await host.close()
    assert.equal(app.prompts.length, 0, 'the app never saw the request')
  } finally {
    await app.server.stop()
  }
})

test('the app drops connections that skip or stall the handshake', async () => {
  const secret = crypto.randomBytes(32).toString('hex')
  const app = await startApp({ secret })
  try {
    const raw = net.connect(app.pipePath)
    await new Promise((resolve) => raw.once('connect', resolve))
    raw.write(protocol.encodeLine({ t: 'request', message: hello() }))
    const lines = []
    raw.on('data', (chunk) => lines.push(chunk.toString()))
    await new Promise((resolve) => raw.once('close', resolve))
    assert.match(lines.join(''), /"denied"/)
    assert.doesNotMatch(lines.join(''), /hello\.reply/)
  } finally {
    await app.server.stop()
  }
})

test('a request without an extension origin is refused by the host', async () => {
  const secret = crypto.randomBytes(32).toString('hex')
  const app = await startApp({ secret })
  try {
    const host = startHost({ pipePath: app.pipePath, secret, origin: null })
    host.send(hello())
    assert.equal((await host.nextReply()).code, 'protocol')
    await host.close()
  } finally {
    await app.server.stop()
  }
})

// --- Registration ---------------------------------------------------------------

test('host manifest, launcher and extension IDs', () => {
  const manifest = registration.buildHostManifest({ hostPath: 'C:\\x\\ds-companion-host.cmd', extensionIds: [EXT_ID] })
  assert.deepEqual(manifest, {
    name: 'com.dramastudio.companion',
    description: 'Drama Studio desktop link for Drama Studio Companion',
    path: 'C:\\x\\ds-companion-host.cmd',
    type: 'stdio',
    allowed_origins: [ORIGIN],
  })
  assert.equal(
    registration.buildWindowsLauncher({ execPath: 'C:\\Program Files\\Drama Studio\\Drama Studio.exe' }),
    '@echo off\r\n"C:\\Program Files\\Drama Studio\\Drama Studio.exe" --ds-companion-host --log-level=3 --disable-gpu %* 2>&1 1>nul\r\n',
  )
  assert.equal(
    registration.buildWindowsLauncher({ execPath: 'C:\\e\\electron.exe', appPath: 'D:\\100% dev' }),
    '@echo off\r\n"C:\\e\\electron.exe" "D:\\100%% dev" --ds-companion-host --log-level=3 --disable-gpu %* 2>&1 1>nul\r\n',
  )
  assert.equal(
    registration.buildWindowsLauncher({ execPath: 'C:\\DS\\Drama Studio.exe', userDataDir: 'C:\\Users\\a\\AppData\\Roaming\\Drama Studio\\' }),
    '@echo off\r\n"C:\\DS\\Drama Studio.exe" --ds-companion-host --log-level=3 --disable-gpu "--ds-companion-user-data=C:\\Users\\a\\AppData\\Roaming\\Drama Studio" %* 2>&1 1>nul\r\n',
  )
  assert.throws(() => registration.buildWindowsLauncher({ execPath: 'C:\\bad"path.exe' }))
  assert.equal(
    registration.buildWindowsLauncher({ execPath: 'C:\\DS\\Drama Studio.exe', lang: 'en-US' }),
    '@echo off\r\n"C:\\DS\\Drama Studio.exe" --ds-companion-host --log-level=3 --disable-gpu --lang=en-US %* 2>&1 1>nul\r\n',
  )
  assert.throws(() => registration.buildWindowsLauncher({ execPath: 'C:\\DS\\Drama Studio.exe', lang: 'en & calc' }))
  assert.deepEqual(
    registration.resolveAllowedExtensionIds({ release: [EXT_ID], development: [EXT_ID, 'not-an-id'], env: 'PONMLKJIHGFEDCBAPONMLKJIHGFEDCBA, junk' }),
    [EXT_ID, 'ponmlkjihgfedcbaponmlkjihgfedcba'],
  )
})

test('registration writes the files and only touches registry keys that differ', async () => {
  const dir = tempDir()
  const registry = new Map()
  const calls = []
  const runReg = async (args) => {
    calls.push(args[0])
    if (args[0] === 'query') {
      return registry.has(args[1]) ? { code: 0, stdout: `\r\n${args[1]}\r\n    (Standard)    REG_SZ    ${registry.get(args[1])}\r\n` } : { code: 1, stdout: '' }
    }
    registry.set(args[1], args[args.indexOf('/d') + 1])
    return { code: 0, stdout: '' }
  }
  const first = await registration.registerNativeHost({ userDataDir: dir, execPath: 'C:\\DS\\Drama Studio.exe', extensionIds: [EXT_ID], platform: 'win32', runReg })
  assert.equal(first.registered, true)
  assert.deepEqual(first.browsers, ['Chrome', 'Edge', 'Chromium'])
  assert.equal(registry.size, 3)
  for (const value of registry.values()) assert.equal(value, first.manifestPath)
  const manifest = JSON.parse(fs.readFileSync(first.manifestPath, 'utf8'))
  assert.deepEqual(manifest.allowed_origins, [ORIGIN])
  assert.equal(fs.readFileSync(manifest.path, 'utf8'), `@echo off\r\n"C:\\DS\\Drama Studio.exe" --ds-companion-host --log-level=3 --disable-gpu "--ds-companion-user-data=${dir}" %* 2>&1 1>nul\r\n`)
  assert.ok([...registry.keys()].every((key) => key.startsWith('HKCU\\') && key.endsWith('\\com.dramastudio.companion')))

  calls.length = 0
  await registration.registerNativeHost({ userDataDir: dir, execPath: 'C:\\DS\\Drama Studio.exe', extensionIds: [EXT_ID], platform: 'win32', runReg })
  assert.deepEqual(calls, ['query', 'query', 'query'], 'nothing rewritten when already registered')

  assert.deepEqual(await registration.registerNativeHost({ userDataDir: dir, execPath: 'x', extensionIds: [], platform: 'darwin', runReg }), { registered: false, reason: 'unsupported-platform' })
})

test('development extension IDs are stored main-side and validated', () => {
  const dir = tempDir()
  assert.deepEqual(registration.readDevelopmentExtensionIds(dir), [])
  assert.deepEqual(registration.writeDevelopmentExtensionIds(dir, [EXT_ID, EXT_ID, 'nope']), [EXT_ID])
  assert.deepEqual(registration.readDevelopmentExtensionIds(dir), [EXT_ID])
})

test('the installer copy of the host matches the release IDs and the packaged exe', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/companion/com.dramastudio.companion.json'), 'utf8'))
  assert.deepEqual(manifest, registration.buildHostManifest({ hostPath: registration.LAUNCHER_FILE_NAME, extensionIds: [...registration.RELEASE_EXTENSION_IDS] }))
  const launcher = fs.readFileSync(path.join(ROOT, 'build/companion', registration.LAUNCHER_FILE_NAME), 'utf8')
  assert.ok(launcher.includes(`"%~dp0..\\..\\${pkg.build.productName}.exe" --ds-companion-host --log-level=3 --disable-gpu %* 2>&1 1>nul`))
  assert.deepEqual(pkg.build.win.extraResources, [{ from: 'build/companion', to: 'companion' }])

  const nsis = fs.readFileSync(path.join(ROOT, 'build/installer.nsh'), 'utf8')
  for (const key of ['Software\\Google\\Chrome\\NativeMessagingHosts', 'Software\\Microsoft\\Edge\\NativeMessagingHosts']) {
    assert.ok(nsis.includes(`WriteRegStr HKCU "${key}\\\${DS_COMPANION_HOST}"`), key)
    assert.ok(nsis.includes(`DeleteRegKey HKCU "${key}\\\${DS_COMPANION_HOST}"`), key)
  }
  assert.match(nsis, /\$INSTDIR\\resources\\companion\\\$\{DS_COMPANION_HOST\}\.json/)
  assert.match(nsis, /\$\{ifNot\} \$\{isUpdated\}/, 'updates keep the registration')
})

test('main.js enters host mode before any app setup', () => {
  const main = fs.readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8')
  const hostMode = main.indexOf("process.argv.includes('--ds-companion-host')")
  assert.ok(hostMode > 0)
  assert.ok(hostMode < main.indexOf("require('./mcpServer')"))
  assert.ok(hostMode < main.indexOf("require('./userDataMigration')"), 'a host never moves the settings folder')
  assert.ok(hostMode < main.indexOf('app.whenReady()'))
  assert.match(main.slice(hostMode, hostMode + 400), /runCompanionHostMode\(app\)\s+return/)
})
