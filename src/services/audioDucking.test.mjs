import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeAudioDucking, resolveDuckingSource, duckingWaveformSamples } from './audioDucking.mjs'

function fixture(duration = 1) {
  const music = { id: 'music', assetId: 'music', type: 'audio', trackId: 'music-track', startTime: 0, duration,
    trimStart: 0, trimEnd: duration, speed: 1, sourceTimeScale: 1 }
  const voice = { ...music, id: 'voice', assetId: 'voice', trackId: 'voice-track' }
  return { state: { clips: [music, voice], transitions: [],
    tracks: [{ id: 'music-track', type: 'audio', volume: 100 }, { id: 'voice-track', type: 'audio', volume: 100 }] },
    assets: [{ id: 'music', duration, hasAudio: true }, { id: 'voice', duration, hasAudio: true, path: 'assets/voice.wav' }],
    projectHandle: '/portable/project', musicId: 'music', dialogueTrackId: 'voice-track' }
}
function nativeWave(duration = 1, level = 1, sampleCount = duckingWaveformSamples(duration)) {
  const frames = Math.round(duration * 8000), bucket = Math.max(1, Math.floor(frames / sampleCount))
  return { success: true, duration, peaks: Array.from({ length: sampleCount }, (_, index) => index * bucket < frames ? level : 0) }
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function flush() { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)) }
const api = (getAudioWaveform = async () => nativeWave()) => ({ pathJoin: async (...parts) => parts.join('/'), getAudioWaveform })

test('portable project-relative paths take precedence over stale absolute fallbacks', async () => {
  const joins = []
  const bridge = { pathJoin: async (...parts) => { joins.push(parts); return parts.join('/') } }
  const result = await resolveDuckingSource({ id: 'voice', path: 'assets\\speech.wav', absolutePath: '/old/project/speech.wav' }, '/new/project', bridge)
  assert.equal(result, '/new/project/assets/speech.wav')
  assert.deepEqual(joins, [['/new/project', 'assets/speech.wav']])
})

test('absolute POSIX, Windows, UNC and native protocol paths are not joined under a project', async () => {
  for (const path of ['/media/speech.wav', 'C:\\Media\\speech.wav', '\\\\server\\share\\speech.wav',
    'file:///media/speech.wav', 'comfystudio:///media/speech.wav']) {
    assert.equal(await resolveDuckingSource({ path }, '/project', { pathJoin() { throw new Error('Must not join') } }), path)
  }
  assert.equal(await resolveDuckingSource({ absolutePath: '\\\\server\\share\\speech.wav' }, null, null), '\\\\server\\share\\speech.wav')
  assert.equal(await resolveDuckingSource({ absolutePath: '/fallback/speech.wav' }, null, null), '/fallback/speech.wav')
})

test('blob/data browser sources work, while unresolved or remote sources require relinking', async () => {
  for (const url of ['blob:local-audio', 'data:audio/wav;base64,AAAA']) assert.equal(await resolveDuckingSource({ url }, {}, null), url)
  for (const asset of [{ id: 'missing' }, { path: 'assets/voice.wav' }, { url: 'https://example.invalid/speech.wav' }]) {
    await assert.rejects(resolveDuckingSource(asset, null, null), /Open or relink/)
  }
})

test('native analysis deduplicates shared assets and requests duration-adaptive buckets', async () => {
  const f = fixture(), calls = [], progress = []
  f.state.clips.push({ ...f.state.clips[1], id: 'another-voice-use' })
  const before = JSON.stringify(f)
  const result = await analyzeAudioDucking({ ...f, api: api(async (...args) => { calls.push(args); return nativeWave() }), onProgress: value => progress.push(value) })
  assert.equal(result.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], '/portable/project/assets/voice.wav')
  assert.deepEqual(calls[0][1], { sampleCount: 128, sampleRate: 8000 })
  assert.equal(progress.length, 1)
  assert.equal(result.activity.length, 1)
  assert.ok(result.activity[0].end > 0.98, 'One second of activity retains its original timing')
  assert.equal(JSON.stringify(f), before)
})

test('native terminal bucket is sampled at its real source timing without smearing seconds of audio', async () => {
  const f = fixture(0.12)
  f.assets[1].duration = 10
  f.state.clips[1] = { ...f.state.clips[1], trimStart: 9.88, trimEnd: 10 }
  const wave = nativeWave(10, 0)
  wave.peaks.fill(1, wave.peaks.length - 6)
  const result = await analyzeAudioDucking({ ...f, api: api(async () => wave) })
  assert.equal(result.activity.length, 1)
  assert.ok(result.activity[0].end > 0.1)
})

test('adaptive counts bound normal buckets and terminal remainders through the30-minute limit', () => {
  assert.equal(duckingWaveformSamples(6), 300)
  assert.equal(duckingWaveformSamples(1), 128)
  for (const duration of [0.05, 0.25, 1.234, 4.097, 6.017, 60, 600, 1800]) {
    const frames = Math.round(duration * 8000), count = duckingWaveformSamples(duration)
    assert.ok(count >= 128 && count <= 32768)
    const bucket = Math.max(1, Math.floor(frames / count))
    const remainder = Math.max(0, frames - (count - 1) * bucket)
    assert.ok(bucket / 8000 <= 0.055, `normal bucket at ${duration}s`)
    assert.ok(remainder / 8000 <= Math.max(0.04, 2 * bucket / 8000), `terminal remainder at ${duration}s`)
  }
})

test('source duration limits and native failures refuse analysis without authored mutations', async () => {
  for (const duration of [0, NaN, 1801, undefined]) {
    const f = fixture(); f.assets[1].duration = duration
    let calls = 0
    await assert.rejects(analyzeAudioDucking({ ...f, api: api(async () => { calls++; return nativeWave() }) }), /known source duration/)
    assert.equal(calls, 0)
  }
  const f = fixture(), before = JSON.stringify(f)
  await assert.rejects(analyzeAudioDucking({ ...f, api: api(async () => ({ success: false, error: 'Source missing' })) }), /Source missing/)
  await assert.rejects(analyzeAudioDucking({ ...f, api: api(async () => { throw new Error('Decoder failed') }) }), /Decoder failed/)
  await assert.rejects(analyzeAudioDucking({ ...f, api: { pathJoin: async (...parts) => parts.join('/') } }), /desktop app/)
  await assert.rejects(analyzeAudioDucking({ ...f, api: api(async () => nativeWave(1801)) }), /exceeds 30 minutes/)
  assert.equal(JSON.stringify(f), before)
})

test('silence and malformed successful waveforms never produce an applied proposal', async () => {
  for (const waveform of [nativeWave(1, 0), { success: true, duration: 1, peaks: [] },
    { success: true, duration: 1, peaks: [NaN] }, { success: true, duration: -1, peaks: [1] }]) {
    await assert.rejects(analyzeAudioDucking({ ...fixture(), api: api(async () => waveform) }), /No dialogue|valid audio levels|timing/)
  }
})

test('abort and stale context discard a pending decode and prevent later source jobs', async () => {
  for (const mode of ['abort', 'stale']) {
    const f = fixture(), first = deferred(), controller = new AbortController()
    let current = true, calls = 0
    f.assets.push({ ...f.assets[1], id: 'second-source', path: 'assets/second.wav' })
    f.state.clips.push({ ...f.state.clips[1], id: 'second-voice', assetId: 'second-source' })
    const pending = analyzeAudioDucking({ ...f, signal: controller.signal, isCurrent: () => current,
      api: api(() => { calls++; return first.promise }) })
    const rejection = assert.rejects(pending, /canceled/)
    await flush(); assert.equal(calls, 1)
    if (mode === 'abort') controller.abort(); else current = false
    first.resolve(nativeWave())
    await rejection
    assert.equal(calls, 1)
  }
})

test('already canceled analysis starts no decode, and cancellation during path resolution is checked', async () => {
  const controller = new AbortController(); controller.abort()
  let calls = 0
  await assert.rejects(analyzeAudioDucking({ ...fixture(), signal: controller.signal, api: api(() => { calls++ }) }), /canceled/)
  assert.equal(calls, 0)
  const path = deferred(), second = new AbortController()
  const pending = analyzeAudioDucking({ ...fixture(), signal: second.signal,
    api: { pathJoin: () => path.promise, getAudioWaveform: () => { calls++ } } })
  const rejection = assert.rejects(pending, /canceled/)
  second.abort(); path.resolve('/portable/project/assets/voice.wav')
  await rejection
  assert.equal(calls, 0)
})

test('three concurrent callers serialize native decodes, including multiple waiters on one job', async () => {
  const jobs = [], calls = []
  const bridge = api(source => { const job = deferred(); jobs.push(job); calls.push(source); return job.promise })
  const running = [1, 2, 3].map(() => analyzeAudioDucking({ ...fixture(), api: bridge }))
  const settled = Promise.all(running)
  try {
    await flush(); assert.equal(calls.length, 1)
    jobs[0].resolve(nativeWave())
    await flush(); assert.equal(calls.length, 2, 'Only one waiter may acquire the native decoder')
    jobs[1].resolve(nativeWave())
    await flush(); assert.equal(calls.length, 3)
    jobs[2].resolve(nativeWave())
    const results = await settled
    assert.ok(results.every(result => result.ok))
  } finally {
    // Resolve all started work even on a regression so no hanging promise
    // leaks into subsequent tests.
    for (const job of jobs) job.resolve(nativeWave())
    await flush()
    for (const job of jobs) job.resolve(nativeWave())
    await settled
  }
})

test('browser decode failures/cancellation propagate and never fall back to native files', async () => {
  const f = fixture(); f.assets[1] = { ...f.assets[1], path: undefined, url: 'blob:ducking-test-failure' }
  await assert.rejects(analyzeAudioDucking({ ...f, api: {}, browserWaveform: async () => { throw new Error('Browser decode failed') } }), /Browser decode failed/)
  const job = deferred(), controller = new AbortController()
  const pending = analyzeAudioDucking({ ...f, signal: controller.signal, api: {}, browserWaveform: () => job.promise })
  const rejection = assert.rejects(pending, /canceled/)
  await flush(); controller.abort(); job.resolve({ duration: 1, peaks: [1], hopSeconds: 1 })
  await rejection
})

test('actual browser waveform builder preserves short-file bucket timing through ducking analysis', async () => {
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch
  const duration = 0.25, sampleRate = 44100, samples = new Float32Array(duration * sampleRate).fill(0.5)
  globalThis.window = { AudioContext: class {
    async decodeAudioData() { return { duration, sampleRate, length: samples.length, numberOfChannels: 1, getChannelData: () => samples } }
  } }
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) })
  try {
    const f = fixture(duration)
    f.assets[1] = { ...f.assets[1], path: undefined, url: 'blob:ducking-short-real-builder' }
    const result = await analyzeAudioDucking({ ...f, api: {} })
    assert.equal(result.activity.length, 1)
    assert.ok(result.activity[0].end > 0.24, 'Short-file browser activity retains the full decoded duration')
  } finally { globalThis.window = previousWindow; globalThis.fetch = previousFetch }
})
