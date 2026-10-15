import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// Execute the actual renderer service with isolated window/fetch boundaries.
// This never starts Electron, reads user media, or opens an audio device.
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('./audioAnalysis.js', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'browser',
})
const code = compiled.outputFiles[0].text
const analysis = () => ({ duration: 12, sampleRate: 24000, channels: 1,
  loudness: { peakDb: -1, rmsDb: -18, integratedLufsApprox: -19 },
  bpm: 120, beatConfidence: 0.9, beats: [0.1, 0.6, 1.1], beatsTruncated: false,
  onsets: [0.1, 0.6], onsetsTruncated: false, silences: [], loudnessCurve: [] })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
function harness({ api = { isElectron: true }, userAgent = 'Electron/28.3.3', browser = false, fetch, AudioContext } = {}) {
  const forbidden = { audioContext: 0, fetch: 0, readFile: 0 }
  const window = {
    navigator: { userAgent },
    AudioContext: AudioContext || class { constructor() { forbidden.audioContext++; throw new Error('Unexpected renderer decoder') } },
    ...(browser ? {} : { electronAPI: { ...api, readFileAsBuffer() { forbidden.readFile++; throw new Error('Unexpected full file read') } } }),
  }
  const module = { exports: {} }
  Function('module', 'exports', 'window', 'fetch', code)(module, module.exports, window,
    fetch || (() => { forbidden.fetch++; throw new Error('Unexpected renderer fetch') }))
  return { ...module.exports, forbidden, window }
}
const assertNoRendererIo = h => assert.deepEqual(h.forbidden, { audioContext: 0, fetch: 0, readFile: 0 })

test('desktop forwards portable sources and options, returning pretrimmed analysis without a second trim', async () => {
  const requests = [], result = analysis()
  const h = harness({ api: { isElectron: true, analyzeAudio: async request => { requests.push(request); return { success: true, analysis: result } } } })
  const source = Object.freeze({ absolutePath: '/old-project/audio.wav', path: 'assets/audio.wav', url: 'blob:stale-url', projectPath: '/moved-project' })
  const options = Object.freeze({ startSeconds: 25, endSeconds: 37, includeLoudnessCurve: false, maxCurvePoints: 50, silenceThresholdDb: -42, minSilenceSeconds: 0.5 })
  assert.equal(await h.analyzeAudioSource(source, options), result)
  assert.deepEqual(requests, [{ source, options }])
  assert.deepEqual(result.beats, [0.1, 0.6, 1.1], 'Times remain relative to native-selected trim-in')
  assertNoRendererIo(h)
})

test('native bridge failures and rejections never fall back to renderer decoding or file loading', async () => {
  for (const behavior of [
    async () => ({ success: false, error: 'No audio track', code: 'AUDIO_ANALYSIS_NO_AUDIO' }),
    async () => { throw new Error('IPC unavailable') },
    async () => ({ success: true }),
    async () => ({ success: true, analysis: [] }),
  ]) {
    const h = harness({ api: { isElectron: true, analyzeAudio: behavior } })
    await assert.rejects(h.analyzeAudioSource({ absolutePath: '/source.wav', url: 'file:///source.wav' }))
    assertNoRendererIo(h)
  }
  const h = harness({ api: { analyzeAudio: async () => ({ success: false, error: 'Analysis is busy', code: 'AUDIO_ANALYSIS_BUSY' }) } })
  await assert.rejects(h.analyzeAudioSource({ path: '/source.wav' }), error => error.message === 'Analysis is busy' && error.code === 'AUDIO_ANALYSIS_BUSY')
  assertNoRendererIo(h)
})

test('missing and old desktop bridges fail closed, including a completely missing Electron preload', async () => {
  for (const setup of [{}, { api: {} }, { browser: true }, { api: {}, userAgent: '' }]) {
    const h = harness(setup)
    await assert.rejects(h.analyzeAudioSource({ url: 'file:///source.wav' }), /Native audio analysis is unavailable/)
    assertNoRendererIo(h)
  }
})

test('only identical in-flight jobs deduplicate; subsequent requests re-read potentially replaced media', async () => {
  const jobs = [], requests = []
  const h = harness({ api: { analyzeAudio: request => {
    const job = deferred(); jobs.push(job); requests.push(request); return job.promise
  } } })
  const source = { path: 'assets/audio.wav', projectPath: '/project' }
  const first = h.analyzeAudioSource(source)
  const second = h.analyzeAudioSource({ ...source }, { startSeconds: 0, maxCurvePoints: 400 })
  await flush()
  assert.equal(jobs.length, 1)
  const initial = analysis()
  jobs[0].resolve({ success: true, analysis: initial })
  assert.deepEqual(await Promise.all([first, second]), [initial, initial])
  const fresh = h.analyzeAudioSource(source)
  await flush()
  assert.equal(jobs.length, 2, 'Completed results must not survive same-path replacement')
  jobs[1].resolve({ success: true, analysis: { ...analysis(), bpm: 96 } })
  assert.equal((await fresh).bpm, 96)
  assertNoRendererIo(h)
})

test('different source/range/options requests are never mistaken for the same active job', async () => {
  const jobs = []
  const h = harness({ api: { analyzeAudio: () => { const job = deferred(); jobs.push(job); return job.promise } } })
  const source = { path: 'assets/audio.wav', projectPath: '/project' }
  const pending = [
    h.analyzeAudioSource(source),
    h.analyzeAudioSource({ ...source, projectPath: '/other-project' }),
    h.analyzeAudioSource(source, { startSeconds: 1, endSeconds: 10 }),
    h.analyzeAudioSource(source, { includeLoudnessCurve: false }),
    h.analyzeAudioSource({ ...source, absolutePath: '/relinked/source.wav' }),
  ]
  await flush()
  assert.equal(jobs.length, pending.length)
  for (const job of jobs) job.resolve({ success: true, analysis: analysis() })
  await Promise.all(pending)
  assertNoRendererIo(h)
})

test('failed shared requests are removed so a retry can recover', async () => {
  const failed = deferred()
  let calls = 0
  const h = harness({ api: { analyzeAudio: () => ++calls === 1 ? failed.promise : Promise.resolve({ success: true, analysis: analysis() }) } })
  const first = h.analyzeAudioSource({ path: '/source.wav' })
  const second = h.analyzeAudioSource({ path: '/source.wav' })
  const rejected = Promise.all([assert.rejects(first, /temporary/), assert.rejects(second, /temporary/)])
  await flush()
  failed.reject(new Error('temporary'))
  await rejected
  assert.equal((await h.analyzeAudioSource({ path: '/source.wav' })).bpm, 120)
  assert.equal(calls, 2)
})

test('invalid range/options are rejected before native invocation or renderer I/O', async () => {
  let calls = 0
  const h = harness({ api: { analyzeAudio: async () => { calls++; return { success: true, analysis: analysis() } } } })
  for (const options of [null, [], { startSeconds: -1 }, { startSeconds: '1' }, { startSeconds: NaN },
    { endSeconds: Infinity }, { startSeconds: 3, endSeconds: 2 }, { endSeconds: 0 }, { endSeconds: 600.01 },
    { startSeconds: 100, endSeconds: 701 }, { maxCurvePoints: 19 }, { maxCurvePoints: 1001 },
    { silenceThresholdDb: 1 }, { silenceThresholdDb: -161 }, { minSilenceSeconds: -1 },
    { minSilenceSeconds: 601 }, { includeLoudnessCurve: 'false' }, { endSeconds: null }]) {
    await assert.rejects(h.analyzeAudioSource({ path: '/source.wav' }, options), /Audio analysis/)
  }
  assert.equal(calls, 0)
  assertNoRendererIo(h)
})

test('invalid sources are rejected and successful requests receive bounded explicit defaults', async () => {
  const calls = []
  const h = harness({ api: { analyzeAudio: async request => { calls.push(request); return { success: true, analysis: analysis() } } } })
  for (const source of [null, [], {}, { projectPath: '/project' }, { path: 42 }, { url: '  ' }, { path: '/source\0.wav' }]) {
    await assert.rejects(h.analyzeAudioSource(source), /source/)
  }
  assert.equal(calls.length, 0)
  await h.analyzeAudioSource({ path: '/source.wav' }, { startSeconds: 100, endSeconds: 700 })
  assert.deepEqual(calls[0].options, { startSeconds: 100, endSeconds: 700, includeLoudnessCurve: true,
    maxCurvePoints: 400, silenceThresholdDb: -45, minSilenceSeconds: 0.35 })
  assertNoRendererIo(h)
})

test('buffer-level API is retained without requiring a bridge or AudioContext', () => {
  const h = harness()
  const samples = new Float32Array(24000)
  const result = h.analyzeAudioBuffer({ sampleRate: 24000, length: samples.length, numberOfChannels: 1, getChannelData: () => samples }, { includeLoudnessCurve: false })
  assert.equal(result.duration, 1)
  assert.equal(result.bpm, null)
  assertNoRendererIo(h)
})

test('browser-only fallback streams bounded bytes and closes its decoder after range analysis', async () => {
  let closed = 0, decoded = 0
  const samples = new Float32Array(24000 * 2).fill(0.5)
  const h = harness({ browser: true, userAgent: 'Chrome/154', fetch: async () => new Response(new Uint8Array([1, 2, 3])),
    AudioContext: class {
      constructor(options) { assert.deepEqual(options, { sampleRate: 24000 }) }
      async decodeAudioData(bytes) { decoded++; assert.equal(bytes.byteLength, 3); return { duration: 2, sampleRate: 24000, length: samples.length, numberOfChannels: 1, getChannelData: () => samples } }
      async close() { closed++ }
    } })
  const result = await h.analyzeAudioSource({ url: 'blob:synthetic' }, { startSeconds: 0.5, endSeconds: 1.5 })
  assert.equal(result.duration, 1)
  assert.equal(decoded, 1)
  assert.equal(closed, 1)
})

test('oversized browser streams are rejected before creating a decoder even when declared sizes lie', async () => {
  for (const declared of ['33554433', '1', undefined]) {
    let canceled = 0
    const stream = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(32 * 1024 * 1024 + 1)) },
      cancel() { canceled++ },
    })
    const response = new Response(stream, declared === undefined ? {} : { headers: { 'content-length': declared } })
    const h = harness({ browser: true, userAgent: 'Chrome/154', fetch: async () => response })
    await assert.rejects(h.analyzeAudioSource({ url: 'blob:oversize' }), /32 MiB/)
    assert.equal(h.forbidden.audioContext, 0)
    assert.equal(canceled, 1)
  }
})
