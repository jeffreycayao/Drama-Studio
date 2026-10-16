'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { validateCatalog, cachePathFor, isAllowedUrl, getAllowedOrigins, isAllowedProtocol, isPrivateHost } = require('../electron/sfxCatalog.cjs')
const { createSfxLibrary } = require('../electron/sfxLibrary.cjs')

const sha = buffer => crypto.createHash('sha256').update(buffer).digest('hex')
const bytes = (size, seed = 1) => Buffer.from(Array.from({ length: size }, (_, index) => (index * 31 + seed) & 255))

// Synthetic loopback server. `files` maps path -> Buffer. Supports Range
// unless `ignoreRange`; `/slow/*` streams in small delayed chunks.
async function startServer(files, { ignoreRange = false } = {}) {
  const log = []
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    log.push({ path: url.pathname, range: req.headers.range || null })
    if (url.pathname === '/redirect-out') { res.writeHead(302, { Location: 'http://localhost:9/evil.wav' }); res.end(); return }
    if (url.pathname === '/wrong-range.wav' && req.headers.range) {
      // Claims a partial response but sends the file from byte 0.
      const body = files['/wrong-range.wav']
      res.writeHead(206, { 'Content-Length': body.length, 'Content-Range': `bytes 0-${body.length - 1}/${body.length}` })
      res.end(body)
      return
    }
    if (url.pathname.startsWith('/redirect-in/')) { res.writeHead(302, { Location: url.pathname.replace('/redirect-in', '') }); res.end(); return }
    const key = url.pathname.replace(/^\/slow/, '')
    const body = files[key]
    if (!body) { res.writeHead(404); res.end(); return }
    let start = 0
    const match = !ignoreRange && /^bytes=(\d+)-$/.exec(req.headers.range || '')
    if (match) {
      start = Number(match[1])
      if (start >= body.length) { res.writeHead(416); res.end(); return }
      res.writeHead(206, { 'Content-Length': body.length - start, 'Content-Range': `bytes ${start}-${body.length - 1}/${body.length}` })
    } else res.writeHead(200, { 'Content-Length': body.length, 'Accept-Ranges': ignoreRange ? 'none' : 'bytes' })
    if (!url.pathname.startsWith('/slow/')) { res.end(body.subarray(start)); return }
    for (let offset = start; offset < body.length; offset += 4096) {
      if (res.destroyed) return
      res.write(body.subarray(offset, offset + 4096))
      await new Promise(resolve => setTimeout(resolve, 15))
    }
    res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, log, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) }
}

async function setup(files, catalogEntries, serverOptions) {
  const srv = await startServer(files, serverOptions)
  files['/catalog.json'] = Buffer.from(JSON.stringify({ version: 1, name: 'Test', entries: catalogEntries(srv.base) }))
  const cacheDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ds-sfx-'))
  const events = []
  const library = createSfxLibrary({ cacheDir, allowLoopback: true, emit: (channel, payload) => events.push(payload),
    readSettings: async () => ({ sfxLibrary: { catalogUrl: `${srv.base}/catalog.json` } }) })
  return { srv, cacheDir, library, events, cleanup: async () => { await srv.close(); await fsp.rm(cacheDir, { recursive: true, force: true }) } }
}

const entry = (base, id, body, patch = {}) => ({ id, name: id, category: 'Impacts', tags: ['Hit', 'hit', 'boom'], duration: 1,
  fileSize: body.length, remoteUrl: `${base}/${id}.wav`, sha256: sha(body), ...patch })

test('catalog validation drops traversal ids, foreign URLs, bad sizes and duplicates; derives paths', () => {
  const base = 'https://sfx.example.com/pack/'
  const catalog = validateCatalog({ version: 1, entries: [
    { id: 'ok-1', name: 'Ok', category: '../../etc', duration: 1, fileSize: 10, remoteUrl: 'a/ok.wav', localPath: '../../../../x' },
    { id: '../evil', name: 'x', category: 'a', duration: 1, fileSize: 10, remoteUrl: 'x.wav' },
    { id: 'foreign', name: 'x', category: 'a', duration: 1, fileSize: 10, remoteUrl: 'https://evil.example.net/x.wav' },
    { id: 'http', name: 'x', category: 'a', duration: 1, fileSize: 10, remoteUrl: 'http://sfx.example.com/x.wav' },
    { id: 'huge', name: 'x', category: 'a', duration: 1, fileSize: 1e12, remoteUrl: 'x.wav' },
    { id: 'exe', name: 'x', category: 'a', duration: 1, fileSize: 10, remoteUrl: 'x.exe' },
    { id: 'ok-1', name: 'dup', category: 'a', duration: 1, fileSize: 10, remoteUrl: 'y.wav' },
  ] }, `${base}catalog.json`)
  assert.deepEqual(catalog.entries.map(item => item.id), ['ok-1'])
  assert.equal(catalog.dropped, 6)
  assert.equal(catalog.entries[0].remoteUrl, 'https://sfx.example.com/pack/a/ok.wav')
  const file = cachePathFor('/cache', catalog.entries[0])
  assert.ok(path.resolve(file).startsWith(path.resolve('/cache') + path.sep))
  assert.ok(!file.split(path.sep).includes('..'), 'no parent-directory segment')
  assert.throws(() => validateCatalog({ version: 1, entries: [] }, 'http://sfx.example.com/c.json'), /https/)
  assert.equal(isAllowedUrl('https://user:pw@sfx.example.com/x', getAllowedOrigins(`${base}c.json`)), false)
})

test('a catalog cannot widen the download allowlist with its own baseUrl', () => {
  const catalog = validateCatalog({ version: 1, baseUrl: 'https://attacker.example/', entries: [
    { id: 'rel', name: 'Rel', category: 'a', duration: 1, fileSize: 10, remoteUrl: 'x.wav' },
    { id: 'abs', name: 'Abs', category: 'a', duration: 1, fileSize: 10, remoteUrl: 'https://attacker.example/y.wav' },
  ] }, 'https://sfx.example.com/pack/catalog.json')
  assert.deepEqual(catalog.allowedOrigins, ['https://sfx.example.com'])
  assert.equal(catalog.baseUrl, 'https://sfx.example.com/pack/catalog.json', 'foreign baseUrl ignored')
  assert.deepEqual(catalog.entries.map(item => [item.id, item.remoteUrl]), [['rel', 'https://sfx.example.com/pack/x.wav']])
  const samePath = validateCatalog({ version: 1, baseUrl: '/files/', entries: [{ id: 'p', name: 'P', category: 'a', duration: 1, fileSize: 10, remoteUrl: 'z.wav' }] }, 'https://sfx.example.com/c.json')
  assert.equal(samePath.entries[0].remoteUrl, 'https://sfx.example.com/files/z.wav', 'same-origin base path still works')
})

test('private, loopback and link-local hosts are refused outside tests', () => {
  for (const host of ['127.0.0.1', 'localhost', '10.0.0.5', '172.20.1.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '[::1]', '[fd00::1]', '[fe80::1]', '[::ffff:192.168.0.1]', 'printer.local']) {
    assert.equal(isAllowedProtocol(new URL(`https://${host}/c.json`)), false, host)
  }
  assert.equal(isAllowedProtocol(new URL('https://pub-123.r2.dev/c.json')), true)
  assert.equal(isAllowedProtocol(new URL('https://172.32.0.1/c.json')), true, 'outside 172.16/12')
  assert.equal(isPrivateHost('huggingface.co'), false)
  assert.throws(() => validateCatalog({ version: 1, entries: [] }, 'https://192.168.1.10/c.json'), /public host/)
  // Tests opt in to loopback explicitly; other private ranges stay blocked.
  assert.equal(isAllowedProtocol(new URL('http://127.0.0.1:9/c.json'), { allowLoopback: true }), true)
  assert.equal(isAllowedProtocol(new URL('https://10.0.0.1/c.json'), { allowLoopback: true }), false)
})

test('resolve downloads once, verifies SHA-256 and reuses the cache; concurrent resolves share one transfer', async () => {
  const body = bytes(50000)
  const t = await setup({ '/boom.wav': body }, base => [entry(base, 'boom', body)])
  try {
    const catalog = await t.library.getCatalog()
    assert.equal(catalog.entries.length, 1)
    const [a, b] = await Promise.all([t.library.resolve('boom'), t.library.resolve('boom')])
    assert.equal(a.path, b.path)
    assert.deepEqual(await fsp.readFile(a.path), body)
    assert.equal(t.srv.log.filter(item => item.path === '/boom.wav').length, 1)
    assert.equal((await t.library.resolve('boom')).cached, true)
    assert.deepEqual(await t.library.status(['boom', 'nope']), { boom: 'cached', nope: 'unknown' })
    await assert.rejects(t.library.resolve('nope'), /not in the catalog/)
  } finally { await t.cleanup() }
})

test('a hash mismatch deletes the file; a wrong size is refused', async () => {
  const body = bytes(20000)
  const t = await setup({ '/bad.wav': body, '/short.wav': body.subarray(0, 100) }, base => [
    entry(base, 'bad', body, { sha256: 'a'.repeat(64) }), entry(base, 'short', body)])
  try {
    await assert.rejects(t.library.resolve('bad'), /SHA-256/)
    assert.equal(fs.existsSync(path.join(t.cacheDir, 'Impacts', 'bad.wav')), false)
    assert.equal(fs.existsSync(path.join(t.cacheDir, 'Impacts', 'bad.wav.part')), false)
    await assert.rejects(t.library.resolve('short'), /Downloaded 100 of 20000/)
  } finally { await t.cleanup() }
})

test('a partial file resumes with a Range request', async () => {
  const body = bytes(30000)
  const t = await setup({ '/res.wav': body }, base => [entry(base, 'res', body)])
  try {
    await t.library.getCatalog()
    await fsp.mkdir(path.join(t.cacheDir, 'Impacts'), { recursive: true })
    await fsp.writeFile(path.join(t.cacheDir, 'Impacts', 'res.wav.part'), body.subarray(0, 12345))
    const result = await t.library.resolve('res')
    assert.deepEqual(await fsp.readFile(result.path), body)
    assert.deepEqual(t.srv.log.filter(item => item.path === '/res.wav').map(item => item.range), ['bytes=12345-'])
  } finally { await t.cleanup() }
})

test('a 206 that does not start at the requested offset is never appended', async () => {
  const body = bytes(20000, 5)
  const t = await setup({ '/wrong-range.wav': body }, base => [entry(base, 'wrong-range', body, { sha256: undefined })])
  try {
    await t.library.getCatalog()
    await fsp.mkdir(path.join(t.cacheDir, 'Impacts'), { recursive: true })
    await fsp.writeFile(path.join(t.cacheDir, 'Impacts', 'wrong-range.wav.part'), body.subarray(0, 7000))
    const result = await t.library.resolve('wrong-range')
    assert.deepEqual(await fsp.readFile(result.path), body, 'restarted cleanly instead of appending 20000 bytes to 7000')
  } finally { await t.cleanup() }
})

test('a server that ignores Range restarts the file from zero', async () => {
  const body = bytes(30000, 7)
  const t = await setup({ '/nr.wav': body }, base => [entry(base, 'nr', body)], { ignoreRange: true })
  try {
    await t.library.getCatalog()
    await fsp.mkdir(path.join(t.cacheDir, 'Impacts'), { recursive: true })
    await fsp.writeFile(path.join(t.cacheDir, 'Impacts', 'nr.wav.part'), Buffer.alloc(5000, 9))
    const result = await t.library.resolve('nr')
    assert.deepEqual(await fsp.readFile(result.path), body)
  } finally { await t.cleanup() }
})

test('off-origin redirects are refused without a hash; same-origin redirects work', async () => {
  const body = bytes(1000)
  const t = await setup({ '/in.wav': body }, base => [
    entry(base, 'out', body, { remoteUrl: `${base}/redirect-out`, sha256: undefined, format: 'wav' }),
    entry(base, 'in', body, { remoteUrl: `${base}/redirect-in/in.wav` })])
  try {
    await assert.rejects(t.library.resolve('out'), /redirected/)
    assert.deepEqual(await fsp.readFile((await t.library.resolve('in')).path), body)
  } finally { await t.cleanup() }
})

test('offline pack downloads everything with progress, and pause/resume keeps partial files', async () => {
  const files = {}, bodies = {}
  for (let index = 0; index < 5; index += 1) { bodies[`p${index}`] = bytes(60000, index); files[`/p${index}.wav`] = bodies[`p${index}`] }
  const t = await setup(files, base => Object.keys(bodies).map(id => entry(base, id, bodies[id], { remoteUrl: `${base}/slow/${id}.wav` })))
  try {
    const started = await t.library.packStart()
    assert.equal(started.state, 'running')
    assert.equal(started.total, 5)
    await new Promise(resolve => setTimeout(resolve, 120))
    const paused = t.library.packPause()
    assert.equal(paused.state, 'paused')
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.equal(t.library.packStatus().failed, 0, 'pausing is not a failure')
    const partials = (await fsp.readdir(path.join(t.cacheDir, 'Impacts'))).filter(name => name.endsWith('.part'))
    assert.ok(partials.length > 0, 'partial files are kept while paused')
    t.library.packResume()
    for (let i = 0; i < 200 && !['done', 'done-with-errors'].includes(t.library.packStatus().state); i++) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    const done = t.library.packStatus()
    assert.equal(done.state, 'done')
    assert.equal(done.completed, 5)
    assert.equal(done.bytesDone, done.bytesTotal)
    for (const id of Object.keys(bodies)) assert.deepEqual(await fsp.readFile(path.join(t.cacheDir, 'Impacts', `${id}.wav`)), bodies[id])
    assert.ok(t.srv.log.some(item => item.range), 'resume used Range')
    assert.ok(t.events.length > 0)
  } finally { await t.cleanup() }
})

test('canceling the pack removes partial files; a drag resolve survives a pack pause', async () => {
  const body = bytes(80000, 3)
  const t = await setup({ '/c.wav': body }, base => [entry(base, 'c', body, { remoteUrl: `${base}/slow/c.wav` })])
  try {
    await t.library.packStart()
    await new Promise(resolve => setTimeout(resolve, 60))
    const dragging = t.library.resolve('c') // joins the pack transfer
    t.library.packPause()
    assert.deepEqual(await fsp.readFile((await dragging).path), body)
    await fsp.rm(path.join(t.cacheDir, 'Impacts', 'c.wav'))
    await t.library.packStart()
    await new Promise(resolve => setTimeout(resolve, 60))
    const canceled = await t.library.packCancel()
    assert.equal(canceled.state, 'canceled')
    assert.equal(fs.existsSync(path.join(t.cacheDir, 'Impacts', 'c.wav.part')), false)
  } finally { await t.cleanup() }
})

test('unconfigured library reports configured:false; a failed refresh falls back to the saved catalog', async () => {
  const cacheDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ds-sfx-'))
  try {
    const empty = createSfxLibrary({ cacheDir, readSettings: async () => ({}) })
    assert.equal((await empty.getCatalog()).configured, false)
  } finally { await fsp.rm(cacheDir, { recursive: true, force: true }) }
  const body = bytes(100)
  const t = await setup({ '/x.wav': body }, base => [entry(base, 'x', body)])
  try {
    await t.library.getCatalog()
    delete t.srv.server.listeners('request')
    await t.srv.close()
    const offline = await t.library.getCatalog({ refresh: true })
    assert.equal(offline.entries.length, 1)
    assert.match(offline.warning, /saved catalog/)
  } finally { await fsp.rm(t.cacheDir, { recursive: true, force: true }) }
})

test('the catalog builder output round-trips through validation and download (generated WAVs)', async () => {
  const { spawnSync } = require('node:child_process')
  const ffmpeg = require('ffmpeg-static')
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'ds-sfx-build-'))
  try {
    await fsp.mkdir(path.join(work, 'pack', 'Impacts', 'Heavy'), { recursive: true })
    for (const [name, freq] of [['big_boom', 60], ['door slam', 300]]) {
      const made = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=0.5`, path.join(work, 'pack', 'Impacts', 'Heavy', `${name}.wav`)])
      assert.equal(made.status, 0, String(made.stderr))
    }
    const out = path.join(work, 'catalog.json')
    const built = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-sfx-catalog.mjs'), path.join(work, 'pack'), '--base-url', 'https://sfx.invalid/pack/', '--out', out], { encoding: 'utf8' })
    assert.equal(built.status, 0, built.stderr)
    const catalog = JSON.parse(await fsp.readFile(out, 'utf8'))
    assert.equal(catalog.entries.length, 2)
    assert.ok(catalog.entries.every(item => item.duration > 0.4 && item.sha256.length === 64 && item.subCategory === 'Heavy'))
    const files = {}
    for (const item of catalog.entries) files[`/pack/${item.remoteUrl}`] = await fsp.readFile(path.join(work, 'pack', ...item.remoteUrl.split('/').map(decodeURIComponent)))
    const t = await setup(files, base => catalog.entries.map(item => ({ ...item, remoteUrl: `${base}/pack/${item.remoteUrl}` })))
    try {
      const loaded = await t.library.getCatalog()
      assert.equal(loaded.entries.length, 2)
      const result = await t.library.resolve(catalog.entries.find(item => item.name === 'door slam').id)
      assert.equal(path.extname(result.path), '.wav')
    } finally { await t.cleanup() }
  } finally { await fsp.rm(work, { recursive: true, force: true }) }
})
