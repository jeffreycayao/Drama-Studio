'use strict'

// Reclaiming a ComfyUI left running by an earlier session: never adopt a
// recorded PID that no longer serves the port (Windows reuses PIDs), since
// Stop would then force-close an unrelated program.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { ComfyLauncher } = require('../electron/comfyLauncher.js')

async function fakeComfy(t) {
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === '/system_stats' ? 200 : 404, { 'Content-Type': 'application/json' })
    res.end('{}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  return `http://127.0.0.1:${server.address().port}`
}

async function reclaim(t, { record, listenerPid }) {
  const httpBase = await fakeComfy(t)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-studio-reclaim-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const stateFilePath = path.join(dir, 'comfy-launcher.state.json')
  fs.writeFileSync(stateFilePath, JSON.stringify({ httpBase, startedAt: 1, ...record }))
  const launcher = new ComfyLauncher({ stateFilePath, getHttpBase: () => httpBase, getConfig: () => ({}) })
  launcher._findOwningPidFor = async () => listenerPid
  const reclaimed = await launcher._tryReclaimFromStateFile()
  return { reclaimed, launcher, stateFileKept: fs.existsSync(stateFilePath) }
}

// process.pid stands in for a recorded PID that is alive.
test('a recorded PID that no longer serves the port is not reclaimed', async (t) => {
  const result = await reclaim(t, { record: { pid: process.pid }, listenerPid: process.pid + 4 })
  assert.equal(result.reclaimed, false)
  assert.equal(result.launcher._pid, null, 'nothing to force-close later')
  assert.equal(result.stateFileKept, false)
})

test('the listener recorded at launch (behind a .bat wrapper) is reclaimed', async (t) => {
  const result = await reclaim(t, { record: { pid: process.pid, listenerPid: 4242 }, listenerPid: 4242 })
  assert.equal(result.reclaimed, true)
  assert.equal(result.launcher._pid, process.pid)
})

test('without a listener lookup the earlier checks still decide', async (t) => {
  const result = await reclaim(t, { record: { pid: process.pid }, listenerPid: null })
  assert.equal(result.reclaimed, true)
})
