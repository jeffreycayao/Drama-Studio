'use strict'
// Desktop side of protocol 2 for the Drama Studio Companion link: browser
// jobs with reference files and captures sent back from the browser
// (docs/PLAN_AI_BROWSER_WORKSPACE.md, step 1). The shared fixture is also
// read by the Companion's own tests, so the two sides cannot drift apart.
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const protocol = require('../electron/companionLink/protocol.cjs')
const { createJobStore, JOB_SITES, JOB_TOKEN_TTL_MS, JOB_TTL_MS } = require('../electron/companionLink/jobs.cjs')
const { createCaptureStore, safeBaseName } = require('../electron/companionLink/captures.cjs')
const { createHandoffStore, CompanionLinkError } = require('../electron/companionLink/handoffs.cjs')
const { createCompanionLinkService } = require('../electron/companionLink/linkService.cjs')
const pairing = require('../electron/companionLink/pairing.cjs')

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extensions', 'companion', 'tests', 'fixtures', 'desktop-link-v2.json'), 'utf8'))
const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/'
const OTHER_ORIGIN = 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/'

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ds-companion-jobs-'))
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')
const writeFile = (dir, name, bytes) => {
  const file = path.join(dir, name)
  fs.writeFileSync(file, bytes)
  return file
}
const bytesOf = (length) => Buffer.from(Array.from({ length }, (_, index) => (index * 7) % 256))

// --- Shared fixture -----------------------------------------------------------

test('fixture: protocol 2 on both sides', () => {
  assert.equal(FIXTURE.protocol, protocol.PROTOCOL_VERSION)
})

test('fixture: every valid Companion request is accepted', () => {
  for (const message of FIXTURE.requests.valid) {
    const parsed = protocol.parseCompanionRequest(message)
    assert.equal(parsed.ok, true, `${message.type} ${message.id}`)
    assert.equal(parsed.request.type, message.type)
    assert.equal(parsed.request.id, message.id)
  }
})

test('fixture: every invalid Companion request is refused as protocol', () => {
  for (const { why, message } of FIXTURE.requests.invalid) {
    const parsed = protocol.parseCompanionRequest(message)
    assert.equal(parsed.ok, false, why)
    assert.equal(parsed.code, 'protocol', why)
  }
})

test('fixture: the reply builders produce exactly the shapes the Companion parses', () => {
  for (const entry of FIXTURE.replies.valid) {
    const build = protocol[entry.builder]
    assert.equal(typeof build, 'function', entry.builder)
    const built = entry.builder === 'errorReply'
      ? build(entry.id, entry.args.code)
      : entry.builder === 'ackReply' ? build(entry.id) : build(entry.id, entry.args)
    assert.deepEqual(built, entry.message, entry.builder)
    assert.equal(protocol.isDesktopReplyFor(built, entry.id), true)
    // Everything the desktop sends must fit Chrome's 1 MB host -> extension cap.
    assert.ok(protocol.encodeNativeMessage(built).length <= protocol.MAX_NATIVE_MESSAGE_BYTES + 4)
  }
})

test('fixture: every desktop error code in the fixture is one the desktop knows', () => {
  for (const entry of FIXTURE.replies.valid.filter((item) => item.builder === 'errorReply')) {
    assert.ok(protocol.DESKTOP_ERROR_CODES.includes(entry.args.code), entry.args.code)
  }
})

test('protocol 1 still works for hello and hand-offs only', () => {
  assert.equal(protocol.parseCompanionRequest({ type: 'hello', id: 'req-00000001', protocol: 1, extVersion: '0.1.0', browser: 'Chrome' }).ok, true)
  assert.equal(protocol.parseCompanionRequest({ type: 'handoff.fetch', id: 'req-00000002', protocol: 1, token: 'A'.repeat(16) }).ok, true)
  assert.equal(protocol.parseCompanionRequest({ type: 'capture.end', id: 'req-00000003', protocol: 1, captureId: 'cap_01234567' }).ok, false)
})

test('a full asset chunk stays under the 1 MB reply limit', () => {
  const data = Buffer.alloc(protocol.ASSET_CHUNK_BYTES, 0xff).toString('base64')
  const reply = protocol.assetChunkReply('req-00000001', { jobId: 'job_01234567', refId: 'ref_01234567', offset: 0, data, done: false, bytes: protocol.MAX_REFERENCE_BYTES })
  assert.ok(protocol.encodeNativeMessage(reply).length < protocol.MAX_NATIVE_MESSAGE_BYTES)
})

test('a full capture chunk is accepted and fits the inbound limit', () => {
  const data = Buffer.alloc(protocol.CAPTURE_CHUNK_BYTES, 0xff).toString('base64')
  const message = { type: 'capture.chunk', id: 'req-00000001', protocol: 2, captureId: 'cap_01234567', index: 0, data }
  assert.equal(protocol.parseCompanionRequest(message).ok, true)
  assert.ok(Buffer.byteLength(JSON.stringify(message)) < protocol.MAX_INBOUND_MESSAGE_BYTES)
  const tooBig = { ...message, data: Buffer.alloc(protocol.CAPTURE_CHUNK_BYTES + 3, 0xff).toString('base64') }
  assert.equal(protocol.parseCompanionRequest(tooBig).ok, false)
})

test('the native decoder takes capture-sized messages only when asked to', () => {
  const big = { data: 'x'.repeat(2 * 1024 * 1024) }
  const body = Buffer.from(JSON.stringify(big))
  const frame = Buffer.concat([Buffer.alloc(4), body])
  frame.writeUInt32LE(body.length, 0)
  let error = null
  protocol.createNativeMessageDecoder({ onMessage: () => {}, onError: (e) => { error = e } }).push(frame)
  assert.ok(error, 'the default limit stays 1 MB')
  const received = []
  protocol.createNativeMessageDecoder({ maxBytes: protocol.MAX_INBOUND_MESSAGE_BYTES, onMessage: (m) => received.push(m), onError: assert.fail }).push(frame)
  assert.equal(received.length, 1)
})

// --- Job store ----------------------------------------------------------------

function jobFixture(options = {}) {
  let clock = 1_000_000
  const updates = []
  const jobs = createJobStore({ now: () => clock, onUpdate: (job) => updates.push(job), ...options })
  return { jobs, updates, advance: (ms) => { clock += ms } }
}

test('job sites start with Grok Imagine on https', () => {
  assert.equal(JOB_SITES[0].id, 'grok-imagine')
  for (const site of JOB_SITES) assert.match(site.url, /^https:\/\//)
})

test('a job opens the site with a one-time #dsjob token and never puts the prompt in the URL', () => {
  const { jobs, updates } = jobFixture()
  const created = jobs.create({ siteId: 'grok-imagine', kind: 'video', prompt: 'A secret lantern', params: { aspect: '16:9', durationSeconds: 6 } })
  assert.match(created.url, /^https:\/\/grok\.com\/imagine#dsjob=[A-Za-z0-9_-]{16,128}$/)
  assert.ok(!created.url.includes('lantern'))
  assert.equal(updates.at(-1).state, 'queued')

  const taken = jobs.take(created.url.split('#dsjob=')[1], ORIGIN)
  assert.equal(taken.job.prompt, 'A secret lantern')
  assert.deepEqual(taken.job.params, { aspect: '16:9', durationSeconds: 6 })
  assert.equal(taken.job.state, 'sent')
  assert.deepEqual(jobs.take(created.token, ORIGIN), { code: 'job-expired' }, 'second use')
})

test('job tokens expire after 5 minutes; jobs after an hour', () => {
  const { jobs, advance } = jobFixture()
  const late = jobs.create({ siteId: 'grok-imagine', kind: 'image', prompt: 'x' })
  advance(JOB_TOKEN_TTL_MS + 1)
  assert.deepEqual(jobs.take(late.token, ORIGIN), { code: 'job-expired' })

  const kept = jobs.create({ siteId: 'grok-imagine', kind: 'image', prompt: 'y' })
  jobs.take(kept.token, ORIGIN)
  assert.equal(jobs.isJobFor(kept.jobId, ORIGIN), true)
  advance(JOB_TTL_MS + 1)
  assert.equal(jobs.isJobFor(kept.jobId, ORIGIN), false)
  assert.deepEqual(jobs.update(kept.jobId, 'done', '', ORIGIN), { code: 'job-expired' })
})

test('a job belongs to the browser that fetched it', () => {
  const { jobs } = jobFixture()
  const created = jobs.create({ siteId: 'grok-imagine', kind: 'image', prompt: 'x' })
  assert.deepEqual(jobs.update(created.jobId, 'filling', '', ORIGIN), { code: 'job-not-found' }, 'not fetched yet')
  jobs.take(created.token, ORIGIN)
  assert.deepEqual(jobs.update(created.jobId, 'filling', '', OTHER_ORIGIN), { code: 'job-not-found' })
  assert.equal(jobs.update(created.jobId, 'waiting-user', 'x'.repeat(300), ORIGIN).job.reason.length, 200)
  assert.equal(jobs.isJobFor(created.jobId, OTHER_ORIGIN), false)
})

test('jobs refuse unknown sites and kinds, empty prompts, bad settings and too many files', () => {
  const { jobs } = jobFixture()
  const refuses = (request, pattern) => assert.throws(() => jobs.create(request), (error) => error instanceof CompanionLinkError && pattern.test(error.message))
  refuses({ siteId: 'nowhere', kind: 'image', prompt: 'x' }, /listed sites/)
  refuses({ siteId: 'grok-imagine', kind: 'audio', prompt: 'x' }, /cannot make/)
  refuses({ siteId: 'grok-imagine', kind: 'image', prompt: '   ' }, /no prompt/)
  refuses({ siteId: 'grok-imagine', kind: 'image', prompt: 'x', params: { aspect: '21:9' } }, /aspect/)
  refuses({ siteId: 'grok-imagine', kind: 'video', prompt: 'x', params: { durationSeconds: 61 } }, /1 to 60/)
  refuses({ siteId: 'grok-imagine', kind: 'image', prompt: 'x', references: Array.from({ length: 9 }, () => ({ path: 'C:/a.png' })) }, /at most/)
})

test('references must be absolute image or video files of 50 MB or less', () => {
  const dir = tempDir()
  const { jobs } = jobFixture()
  const refuses = (references, pattern) => assert.throws(
    () => jobs.create({ siteId: 'grok-imagine', kind: 'image', prompt: 'x', references }),
    (error) => error instanceof CompanionLinkError && pattern.test(error.message),
  )
  refuses([{ path: 'relative.png' }], /could not be found/)
  refuses([{ path: writeFile(dir, 'notes.txt', 'hi') }], /PNG, JPEG/)
  refuses([{ path: path.join(dir, 'missing.png') }], /could not be found/)
  refuses([{ path: writeFile(dir, 'empty.png', '') }], /50 MB/)
  const big = path.join(dir, 'big.mp4')
  fs.writeFileSync(big, '')
  fs.truncateSync(big, protocol.MAX_REFERENCE_BYTES + 1)
  refuses([{ path: big }], /50 MB/)
  fs.mkdirSync(path.join(dir, 'folder.png'))
  refuses([{ path: path.join(dir, 'folder.png') }], /could not be found/)
})

test('a reference is read in 512 KB pieces, by the browser that owns the job only', () => {
  const dir = tempDir()
  const file = bytesOf(protocol.ASSET_CHUNK_BYTES * 2 + 1000)
  const filePath = writeFile(dir, 'still.png', file)
  const { jobs } = jobFixture()
  const created = jobs.create({ siteId: 'grok-imagine', kind: 'image', prompt: 'x', references: [{ path: filePath, name: 'My still.png' }] })
  const { job } = jobs.take(created.token, ORIGIN)
  assert.deepEqual(job.references.map(({ name, mime, bytes }) => ({ name, mime, bytes })), [{ name: 'My still.png', mime: 'image/png', bytes: file.length }])
  assert.equal('path' in job.references[0], false, 'the path never leaves the app')
  const { refId } = job.references[0]

  const pieces = []
  let offset = 0
  for (;;) {
    const read = jobs.readReference(created.jobId, refId, offset, ORIGIN)
    assert.ok(read.chunk, JSON.stringify(read))
    assert.equal(read.chunk.offset, offset)
    const piece = Buffer.from(read.chunk.data, 'base64')
    assert.ok(piece.length <= protocol.ASSET_CHUNK_BYTES)
    pieces.push(piece)
    offset += piece.length
    if (read.chunk.done) break
  }
  assert.equal(pieces.length, 3)
  assert.deepEqual(Buffer.concat(pieces), file)

  assert.deepEqual(jobs.readReference(created.jobId, refId, 0, OTHER_ORIGIN), { code: 'job-not-found' })
  assert.deepEqual(jobs.readReference(created.jobId, 'ref_unknown1', 0, ORIGIN), { code: 'job-not-found' })
  assert.deepEqual(jobs.readReference(created.jobId, refId, file.length + 1, ORIGIN), { code: 'protocol' })

  // A file that changed after the job was made is not sent half old, half new.
  fs.appendFileSync(filePath, 'more')
  assert.deepEqual(jobs.readReference(created.jobId, refId, 0, ORIGIN), { code: 'job-not-found' })
})

// --- Capture store --------------------------------------------------------------

function captureFixture(options = {}) {
  let clock = Date.parse('2026-10-17T12:00:00Z')
  const inboxDir = path.join(tempDir(), 'inbox')
  const captured = []
  const captures = createCaptureStore({ inboxDir, now: () => clock, onCapture: (record) => captured.push(record), ...options })
  return { captures, captured, inboxDir, advance: (ms) => { clock += ms } }
}

const beginFor = (file, extra = {}) => ({
  jobId: null, site: 'grok', prompt: null, mime: 'video/mp4', bytes: file.length, sha256: sha(file), name: 'clip.mp4', origin: ORIGIN, ...extra,
})

function sendAll(captures, captureId, file, chunkBytes = 64 * 1024, origin = ORIGIN) {
  for (let index = 0, offset = 0; offset < file.length; index += 1, offset += chunkBytes) {
    const result = captures.chunk({ captureId, index, data: file.subarray(offset, offset + chunkBytes).toString('base64'), origin })
    assert.deepEqual(result, { ok: true })
  }
}

test('a capture arrives in order, is checked, renamed and recorded beside the file', () => {
  const { captures, captured, inboxDir } = captureFixture()
  const file = bytesOf(200_000)
  const { captureId } = captures.begin(beginFor(file, { jobId: 'job_01234567', site: 'grok-imagine', prompt: 'A lantern', name: 'Lantern: take 1.mp4' }))
  assert.ok(protocol.isObjectId(captureId))
  assert.equal(captures.activeCount(), 1)
  sendAll(captures, captureId, file)
  const { record } = captures.end({ captureId, origin: ORIGIN })

  assert.equal(record.fileName, `${captureId}-Lantern take 1.mp4`)
  assert.deepEqual(fs.readFileSync(record.filePath), file)
  const sidecar = JSON.parse(fs.readFileSync(path.join(inboxDir, `${captureId}.json`), 'utf8'))
  const { filePath: _filePath, ...recorded } = record
  assert.deepEqual(sidecar, recorded)
  assert.equal(sidecar.prompt, 'A lantern')
  assert.equal(sidecar.jobId, 'job_01234567')
  assert.equal(sidecar.capturedAt, '2026-10-17T12:00:00.000Z')
  assert.equal(captured.length, 1)
  assert.equal(captures.activeCount(), 0)
  assert.deepEqual(fs.readdirSync(inboxDir).filter((name) => name.startsWith('.partial-')), [])

  assert.deepEqual(captures.listInbox().map((item) => item.captureId), [captureId])
  assert.equal(captures.remove(captureId), true)
  assert.deepEqual(captures.listInbox(), [])
  assert.deepEqual(fs.readdirSync(inboxDir), [])
})

test('a chunk out of order discards the capture', () => {
  const { captures, inboxDir } = captureFixture()
  const file = bytesOf(200_000)
  const { captureId } = captures.begin(beginFor(file))
  assert.deepEqual(captures.chunk({ captureId, index: 1, data: file.subarray(0, 1000).toString('base64'), origin: ORIGIN }), { code: 'capture-corrupt' })
  assert.deepEqual(captures.end({ captureId, origin: ORIGIN }), { code: 'capture-refused' }, 'it is gone')
  assert.deepEqual(fs.readdirSync(inboxDir), [])
})

test('a wrong hash or a short file is not kept', () => {
  const { captures, captured, inboxDir } = captureFixture()
  const file = bytesOf(100_000)
  const wrong = captures.begin(beginFor(file, { sha256: sha(Buffer.from('other')) }))
  sendAll(captures, wrong.captureId, file)
  assert.deepEqual(captures.end({ captureId: wrong.captureId, origin: ORIGIN }), { code: 'capture-corrupt' })

  const short = captures.begin(beginFor(file))
  sendAll(captures, short.captureId, file.subarray(0, 50_000))
  assert.deepEqual(captures.end({ captureId: short.captureId, origin: ORIGIN }), { code: 'capture-corrupt' })
  assert.equal(captured.length, 0)
  assert.deepEqual(fs.readdirSync(inboxDir), [])
})

test('more bytes than declared are refused as too large', () => {
  const { captures } = captureFixture()
  const file = bytesOf(1000)
  const { captureId } = captures.begin(beginFor(file, { bytes: 500 }))
  assert.deepEqual(captures.chunk({ captureId, index: 0, data: file.toString('base64'), origin: ORIGIN }), { code: 'too-large' })
})

test('only allowed media types and sizes may begin', () => {
  const { captures } = captureFixture()
  const file = bytesOf(10)
  assert.deepEqual(captures.begin(beginFor(file, { mime: 'text/html' })), { code: 'capture-refused' })
  assert.deepEqual(captures.begin(beginFor(file, { bytes: 0 })), { code: 'capture-refused' })
  assert.deepEqual(captures.begin(beginFor(file, { bytes: protocol.MAX_CAPTURE_BYTES + 1 })), { code: 'too-large' })
})

test('at most four captures at a time, each tied to its browser', () => {
  const { captures } = captureFixture()
  const file = bytesOf(10)
  const ids = Array.from({ length: 4 }, () => captures.begin(beginFor(file)).captureId)
  assert.deepEqual(captures.begin(beginFor(file)), { code: 'capture-refused' })
  assert.deepEqual(captures.chunk({ captureId: ids[0], index: 0, data: file.toString('base64'), origin: OTHER_ORIGIN }), { code: 'capture-refused' })
  assert.deepEqual(captures.end({ captureId: ids[0], origin: OTHER_ORIGIN }), { code: 'capture-refused' })
  assert.deepEqual(captures.chunk({ captureId: ids[0], index: 0, data: file.toString('base64'), origin: ORIGIN }), { ok: true }, 'the owner still can')
})

test('half-sent captures are swept after 10 idle minutes, including ones from an earlier run', () => {
  const { captures, inboxDir, advance } = captureFixture()
  const file = bytesOf(10)
  const { captureId } = captures.begin(beginFor(file))
  const stale = path.join(inboxDir, '.partial-OLDRUN012345')
  fs.writeFileSync(stale, 'x')
  const old = (Date.parse('2026-10-17T12:00:00Z') - 11 * 60 * 1000) / 1000
  fs.utimesSync(stale, old, old)
  captures.sweep()
  assert.equal(fs.existsSync(stale), false)
  assert.equal(captures.activeCount(), 1, 'the fresh one stays')
  advance(10 * 60 * 1000)
  captures.sweep()
  assert.equal(captures.activeCount(), 0)
  assert.deepEqual(captures.chunk({ captureId, index: 0, data: file.toString('base64'), origin: ORIGIN }), { code: 'capture-refused' })
  assert.deepEqual(fs.readdirSync(inboxDir), [])
})

test('inbox names are safe on every platform', () => {
  assert.equal(safeBaseName('..\\..\\Windows\\win.ini'), 'Windows win')
  assert.equal(safeBaseName('a/b:c*d?.png'), 'a b c d')
  assert.equal(safeBaseName(''), 'capture')
  assert.equal(safeBaseName('...'), 'capture')
  assert.ok(safeBaseName('x'.repeat(500)).length <= 80)
})

test('a removed or broken inbox record is ignored', () => {
  const { captures, inboxDir } = captureFixture()
  fs.mkdirSync(inboxDir, { recursive: true })
  fs.writeFileSync(path.join(inboxDir, 'broken.json'), '{nope')
  fs.writeFileSync(path.join(inboxDir, 'gone.json'), JSON.stringify({ captureId: 'gone', fileName: 'gone-file.png' }))
  assert.deepEqual(captures.listInbox(), [])
  assert.equal(captures.remove('../escape'), false)
})

// --- Service ----------------------------------------------------------------------

function serviceFixture() {
  let clock = 1_000_000
  const store = pairing.createPairedBrowserStore({ userDataDir: tempDir() })
  const jobs = createJobStore({ now: () => clock })
  const captured = []
  const captures = createCaptureStore({ inboxDir: path.join(tempDir(), 'inbox'), onCapture: (record) => captured.push(record) })
  const service = createCompanionLinkService({
    store, handoffs: createHandoffStore({ now: () => clock }), jobs, captures, appVersion: '0.1.26', now: () => clock, requestApproval: async () => false,
  })
  let counter = 0
  const ask = (message, origin = ORIGIN) => service.handleRequest({ id: `req-${String((counter += 1)).padStart(8, '0')}`, protocol: 2, ...message }, { origin })
  return { service, store, jobs, captures, captured, ask }
}

test('jobs and captures need a paired browser', async () => {
  const { jobs, ask } = serviceFixture()
  const created = jobs.create({ siteId: 'grok-imagine', kind: 'image', prompt: 'x' })
  for (const message of [
    { type: 'job.fetch', token: created.token },
    { type: 'asset.read', jobId: created.jobId, refId: 'ref_01234567', offset: 0 },
    { type: 'job.update', jobId: created.jobId, state: 'filling' },
    { type: 'capture.begin', jobId: null, site: 'grok', prompt: null, mime: 'image/png', bytes: 1, sha256: sha(Buffer.from('x')), name: 'x' },
    { type: 'capture.chunk', captureId: 'cap_01234567', index: 0, data: 'eA==' },
    { type: 'capture.end', captureId: 'cap_01234567' },
  ]) {
    assert.equal((await ask(message)).code, 'not-paired', message.type)
  }
  assert.equal(jobs.take(created.token, ORIGIN).job.prompt, 'x', 'the refused fetch did not use the token')
})

test('end to end in the service: fetch a job, report, capture, job done', async () => {
  const { store, jobs, captured, ask } = serviceFixture()
  store.add({ origin: ORIGIN, browser: 'Chrome 141', extVersion: '0.2.0' })
  const created = jobs.create({ siteId: 'grok-imagine', kind: 'video', prompt: 'A lantern', params: { aspect: '9:16' } })

  const reply = await ask({ type: 'job.fetch', token: created.token })
  assert.equal(reply.type, 'job.reply')
  assert.deepEqual({ site: reply.site, kind: reply.kind, prompt: reply.prompt, params: reply.params }, { site: 'grok-imagine', kind: 'video', prompt: 'A lantern', params: { aspect: '9:16' } })
  assert.equal((await ask({ type: 'job.update', jobId: reply.jobId, state: 'waiting-user' })).type, 'ack')
  assert.equal((await ask({ type: 'job.update', jobId: reply.jobId, state: 'waiting-user' }, OTHER_ORIGIN)).code, 'not-paired')

  const file = bytesOf(70_000)
  const ready = await ask({ type: 'capture.begin', jobId: reply.jobId, site: 'grok-imagine', prompt: 'A lantern', mime: 'video/mp4', bytes: file.length, sha256: sha(file), name: 'clip.mp4' })
  assert.equal(ready.type, 'capture.ready')
  assert.equal(ready.chunkBytes, protocol.CAPTURE_CHUNK_BYTES)
  assert.equal((await ask({ type: 'capture.chunk', captureId: ready.captureId, index: 0, data: file.toString('base64') })).type, 'ack')
  const done = await ask({ type: 'capture.end', captureId: ready.captureId })
  assert.deepEqual(done, { type: 'capture.done', id: done.id, captureId: ready.captureId })

  assert.equal(captured[0].jobId, reply.jobId)
  assert.equal(jobs.list()[0].state, 'done')
})

test('a capture naming someone else\'s job is kept as a plain capture', async () => {
  const { store, jobs, captured, ask } = serviceFixture()
  store.add({ origin: ORIGIN, browser: 'Chrome', extVersion: '0.2.0' })
  store.add({ origin: OTHER_ORIGIN, browser: 'Edge', extVersion: '0.2.0' })
  const created = jobs.create({ siteId: 'grok-imagine', kind: 'image', prompt: 'x' })
  jobs.take(created.token, ORIGIN)
  const file = Buffer.from('png bytes')
  const ready = await ask({ type: 'capture.begin', jobId: created.jobId, site: 'grok', prompt: null, mime: 'image/png', bytes: file.length, sha256: sha(file), name: 'a.png' }, OTHER_ORIGIN)
  await ask({ type: 'capture.chunk', captureId: ready.captureId, index: 0, data: file.toString('base64') }, OTHER_ORIGIN)
  await ask({ type: 'capture.end', captureId: ready.captureId }, OTHER_ORIGIN)
  assert.equal(captured[0].jobId, null)
  assert.notEqual(jobs.list()[0].state, 'done')
})

test('a disk error during a capture is answered, not thrown', async () => {
  const { store } = serviceFixture()
  store.add({ origin: ORIGIN, browser: 'Chrome', extVersion: '0.2.0' })
  const failing = createCompanionLinkService({
    store,
    handoffs: createHandoffStore(),
    jobs: createJobStore(),
    captures: { begin: () => { throw new Error('EACCES') } },
    appVersion: '0.1.26',
    requestApproval: async () => false,
  })
  const reply = await failing.handleRequest({ type: 'capture.begin', id: 'req-00000099', protocol: 2, jobId: null, site: 'grok', prompt: null, mime: 'image/png', bytes: 1, sha256: sha(Buffer.from('x')), name: 'x' }, { origin: ORIGIN })
  assert.deepEqual(reply, { type: 'error', id: 'req-00000099', code: 'capture-refused' })
})
