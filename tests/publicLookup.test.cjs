'use strict'

// Downloads that must stay on the public internet resolve every hop through
// createPublicLookup, so a public name that points at 127.0.0.1 or a LAN
// address (DNS rebinding, *.nip.io) is refused before any socket opens.

const test = require('node:test')
const assert = require('node:assert/strict')
const dns = require('dns')
const net = require('net')
const os = require('os')
const path = require('path')
const fsp = require('fs/promises')
const { PassThrough } = require('stream')
const { createPublicLookup, isPublicAddress } = require('../electron/publicLookup.cjs')
const { downloadStockFile } = require('../electron/stockDownload.cjs')
const { createSfxLibrary } = require('../electron/sfxLibrary.cjs')

const fakeResolve = (map) => {
  const calls = []
  const resolve = (hostname, options, callback) => {
    calls.push({ hostname, options })
    const addresses = map[hostname]
    if (!addresses) { const error = new Error('not found'); error.code = 'ENOTFOUND'; callback(error); return }
    callback(null, addresses.map(address => ({ address, family: net.isIP(address) })))
  }
  return { resolve, calls }
}

const runLookup = (lookup, hostname, options) => new Promise((resolve) => {
  lookup(hostname, options, (error, address, family) => resolve({ error, address, family }))
})

/** A plain TCP listener that only counts connections. */
async function connectionCounter() {
  let connections = 0
  const server = net.createServer((socket) => { connections += 1; socket.destroy() })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { port: server.address().port, count: () => connections, close: () => new Promise(resolve => server.close(resolve)) }
}

test('private, loopback, link-local, CGNAT and multicast addresses are not public', () => {
  for (const address of ['127.0.0.1', '127.8.8.8', '10.1.2.3', '172.16.0.1', '192.168.1.10', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fd00::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1', '::ffff:10.0.0.1',
    '::ffff:7f00:1', '0:0:0:0:0:0:0:1', 'not-an-ip', '']) {
    assert.equal(isPublicAddress(address), false, address)
  }
  for (const address of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPublicAddress(address), true, address)
  }
  assert.equal(isPublicAddress('127.0.0.1', { allowLoopback: true }), true)
  assert.equal(isPublicAddress('::1', { allowLoopback: true }), true)
  assert.equal(isPublicAddress('10.0.0.1', { allowLoopback: true }), false, 'allowLoopback does not open the LAN')
})

test('the lookup refuses a name when any resolved address is private', async () => {
  const { resolve, calls } = fakeResolve({
    '127.0.0.1.nip.io': ['127.0.0.1'],
    'mixed.example': ['93.184.216.34', '192.168.0.5'],
    'v6-local.example': ['2606:4700::1111', 'fe80::1'],
  })
  const lookup = createPublicLookup({ resolve })
  for (const host of ['127.0.0.1.nip.io', 'mixed.example', 'v6-local.example']) {
    const { error } = await runLookup(lookup, host, {})
    assert.equal(error?.code, 'PRIVATE_ADDRESS', host)
  }
  assert.ok(calls.every(call => call.options.all === true), 'every lookup asks for all addresses')
  assert.equal((await runLookup(lookup, 'missing.example', {})).error?.code, 'ENOTFOUND')
})

test('the lookup answers in the shape Node asks for', async () => {
  const { resolve, calls } = fakeResolve({ 'cdn.example': ['93.184.216.34', '2606:4700::1111'] })
  const lookup = createPublicLookup({ resolve })
  const single = await runLookup(lookup, 'cdn.example', { family: 4 })
  assert.equal(single.error, null)
  assert.equal(single.address, '93.184.216.34')
  assert.equal(single.family, 4)
  assert.equal(calls[0].options.family, 4)
  const all = await runLookup(lookup, 'cdn.example', { all: true })
  assert.deepEqual(all.address, [{ address: '93.184.216.34', family: 4 }, { address: '2606:4700::1111', family: 6 }])
})

test('a request connects to the address the lookup checked', async (t) => {
  const http = require('http')
  const server = http.createServer((_req, res) => res.end('ok'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  // alias.example does not exist; the socket can only open via the lookup's answer.
  const lookup = createPublicLookup({ allowLoopback: true, resolve: fakeResolve({ 'alias.example': ['127.0.0.1'] }).resolve })
  const body = await new Promise((resolve, reject) => {
    http.get(`http://alias.example:${server.address().port}/`, { lookup, agent: false }, (res) => {
      let text = ''
      res.on('data', chunk => { text += chunk })
      res.on('end', () => resolve(text))
    }).on('error', reject)
  })
  assert.equal(body, 'ok')
})

test('a stock download to a public name that resolves to loopback never connects', async () => {
  const listener = await connectionCounter()
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ds-stock-'))
  try {
    const { resolve, calls } = fakeResolve({ 'rebind.example': ['127.0.0.1'] })
    await assert.rejects(
      downloadStockFile({ url: `https://rebind.example:${listener.port}/photo.jpg`, provider: 'openverse', id: '1', mediaType: 'photo' },
        { tempDir, lookup: createPublicLookup({ resolve }) }),
      error => error.code === 'BAD_URL',
    )
    assert.equal(calls.length, 1, 'the name was resolved')
    assert.equal(listener.count(), 0, 'no socket reached the local service')
  } finally {
    await listener.close()
    await fsp.rm(tempDir, { recursive: true, force: true })
  }
})

test('stock downloads pin every redirect hop to the checked lookup', async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ds-stock-'))
  const seen = []
  const lookup = createPublicLookup({ resolve: fakeResolve({}).resolve })
  const request = (target, options, onResponse) => {
    seen.push({ href: target.href, lookup: options.lookup, agent: options.agent })
    const res = new PassThrough()
    if (seen.length === 1) {
      Object.assign(res, { statusCode: 302, headers: { location: 'https://files.example/real.jpg' } })
    } else {
      Object.assign(res, { statusCode: 200, headers: { 'content-type': 'image/jpeg' } })
    }
    const req = { setTimeout() {}, on() {}, destroy() {} }
    process.nextTick(() => { onResponse(res); if (seen.length > 1) res.end(Buffer.from('jpeg')) })
    return req
  }
  try {
    const result = await downloadStockFile({ url: 'https://search.example/photo', provider: 'openverse', id: '2', mediaType: 'photo' },
      { tempDir, request, lookup })
    assert.equal(result.bytes, 4)
    assert.deepEqual(seen.map(hop => hop.href), ['https://search.example/photo', 'https://files.example/real.jpg'])
    assert.ok(seen.every(hop => hop.lookup === lookup), 'each hop uses the checking lookup')
    assert.ok(seen.every(hop => hop.agent === false), 'no pooled socket is reused')
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true })
  }
})

test('an SFX catalog on a public name that resolves to loopback is refused', async (t) => {
  const listener = await connectionCounter()
  const cacheDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ds-sfx-'))
  const original = dns.lookup
  const { resolve, calls } = fakeResolve({ 'sfx-rebind.example': ['127.0.0.1'] })
  dns.lookup = resolve
  t.after(async () => {
    dns.lookup = original
    await listener.close()
    await fsp.rm(cacheDir, { recursive: true, force: true })
  })
  const library = createSfxLibrary({ cacheDir,
    readSettings: async () => ({ sfxLibrary: { catalogUrl: `https://sfx-rebind.example:${listener.port}/catalog.json` } }) })
  await assert.rejects(library.getCatalog({ refresh: true }), error => error.code === 'PRIVATE_ADDRESS')
  assert.equal(calls.length, 1)
  assert.equal(listener.count(), 0, 'no socket reached the local service')
})
