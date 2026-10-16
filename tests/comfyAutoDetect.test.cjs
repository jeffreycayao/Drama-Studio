'use strict'
// electron/comfyAutoDetect.cjs: find ComfyUI wherever the user installed it.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const {
  findComfyInstallations,
  isComfySourceRoot,
  probeComfyServer,
  resolveComfyRootAt,
  scanForComfyRoots,
} = require('../electron/comfyAutoDetect.cjs')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-comfy-detect-'))
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))

function makeComfy(dir) {
  fs.mkdirSync(path.join(dir, 'comfy'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'main.py'), '')
  fs.writeFileSync(path.join(dir, 'nodes.py'), '')
  return path.resolve(dir)
}

test('a ComfyUI folder needs main.py, nodes.py and comfy/', async () => {
  const real = makeComfy(path.join(tmp, 'real'))
  const fake = path.join(tmp, 'fake')
  fs.mkdirSync(fake, { recursive: true })
  fs.writeFileSync(path.join(fake, 'main.py'), '')
  assert.equal(await isComfySourceRoot(real), true)
  assert.equal(await isComfySourceRoot(fake), false)
})

test('portable layout resolves to the inner ComfyUI folder', async () => {
  const inner = makeComfy(path.join(tmp, 'ComfyUI_windows_portable', 'ComfyUI'))
  assert.equal(await resolveComfyRootAt(path.join(tmp, 'ComfyUI_windows_portable')), inner)
  assert.equal(await resolveComfyRootAt(path.join(tmp, 'nowhere')), '')
})

test('scan finds renamed folders, skips system/package folders and respects depth', async () => {
  const base = path.join(tmp, 'drive')
  const renamed = makeComfy(path.join(base, '.TOOLS', 'My AI Stuff', 'engine'))
  makeComfy(path.join(base, 'node_modules', 'pkg')) // skipped folder
  makeComfy(path.join(base, 'a', 'b', 'c', 'd', 'too-deep'))
  const { roots } = await scanForComfyRoots([base], { maxDepth: 3, homedir: path.join(tmp, 'home') })
  assert.deepEqual(roots.map((entry) => entry.root), [renamed])
})

test('dot folders in the home folder are skipped (app config)', async () => {
  const home = path.join(tmp, 'home2')
  makeComfy(path.join(home, '.config', 'comfy'))
  const visible = makeComfy(path.join(home, 'Apps', 'ComfyUI'))
  const { roots } = await scanForComfyRoots([home], { homedir: home })
  assert.deepEqual(roots.map((entry) => entry.root), [visible])
})

test('the scan stops at its time budget', async () => {
  let clock = 0
  const result = await scanForComfyRoots([tmp], { budgetMs: 5, now: () => (clock += 10) })
  assert.equal(result.truncated, true)
})

test('Comfy Desktop installations and running servers are found without a scan', async () => {
  const appData = path.join(tmp, 'appdata')
  const installPath = path.join(tmp, 'ComfyDesktopInstalls', 'JAY')
  const desktopRoot = makeComfy(path.join(installPath, 'ComfyUI'))
  fs.mkdirSync(path.join(appData, 'Comfy Desktop'), { recursive: true })
  fs.writeFileSync(path.join(appData, 'Comfy Desktop', 'installations.json'), JSON.stringify([
    { id: 'a1', name: 'JAY', installPath },
    { id: 'c1', name: 'Comfy Cloud', remoteUrl: 'https://cloud.comfy.org' },
  ]))
  const runningRoot = makeComfy(path.join(tmp, 'running', 'ComfyUI'))
  const probe = async (port) => (port === 8188
    ? { port, httpBase: 'http://127.0.0.1:8188', version: '0.41.0', rootFromArgv: runningRoot }
    : null)
  const result = await findComfyInstallations({ appDataDir: appData, probe, scan: false })
  assert.deepEqual(result.installs.map((entry) => [entry.root, entry.source]), [
    [runningRoot, 'running'],
    [desktopRoot, 'comfy-desktop'],
  ])
  assert.equal(result.servers.length, 1)
})

test('probe reads the ComfyUI folder from /system_stats argv', async (t) => {
  const mainPy = path.join(tmp, 'running', 'ComfyUI', 'main.py')
  const server = http.createServer((req, res) => {
    if (req.url !== '/system_stats') { res.statusCode = 404; res.end(); return }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ system: { comfyui_version: '0.41.0', argv: [mainPy, '--port', '1'] }, devices: [] }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const { port } = server.address()
  const found = await probeComfyServer(port)
  assert.equal(found.version, '0.41.0')
  assert.equal(found.rootFromArgv, path.dirname(mainPy))
  assert.equal(await probeComfyServer(1, { timeoutMs: 200 }), null)
})
