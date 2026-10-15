import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { buildAudioEqFilters } from '../electron/audioEq.mjs'
import { DEFAULT_AUDIO_EQ, getAudioEqCoefficients, normalizeAudioEq } from '../src/utils/audioEq.mjs'
import { buildAudioVolumeEnvelopeFilter } from '../electron/audioVolumeEnvelope.mjs'
import { getAudioVolumeEnvelopeGain, normalizeAudioVolumeEnvelope } from '../src/utils/audioVolumeEnvelope.mjs'
import * as eligibility from '../electron/audioMixEligibility.mjs'

const require = createRequire(import.meta.url)
const ffmpegPath = require('ffmpeg-static')
const root = path.resolve(import.meta.dirname, '..')
function run(args, input) {
  const result = spawnSync(ffmpegPath, ['-v', 'error', ...args], { input, maxBuffer: 32 * 1024 * 1024, timeout: 30000 })
  assert.equal(result.status, 0, result.stderr?.toString() || String(result.error))
  return result.stdout
}
function applyBiquads(samples, coefficients) {
  let output = samples
  for (const c of coefficients) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    output = Float64Array.from(output, x => {
      const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
      x2 = x1; x1 = x; y2 = y1; y1 = y
      return y
    })
  }
  return output
}

test('native EQ has no filter for flat/bypassed/invalid data, emits numeric coefficients only', () => {
  for (const eq of [undefined, DEFAULT_AUDIO_EQ, { ...DEFAULT_AUDIO_EQ, enabled: false, bassDb: 12 },
    { ...DEFAULT_AUDIO_EQ, bassDb: "';movie=/secret" }, { ...DEFAULT_AUDIO_EQ, lowCut: 'yes' }]) {
    assert.deepEqual(buildAudioEqFilters(eq), [])
  }
  const filters = buildAudioEqFilters({ ...DEFAULT_AUDIO_EQ, bassDb: 12, trebleDb: -12, lowCut: true })
  assert.equal(filters[0], 'aresample=48000')
  assert.equal(filters.length, 4)
  assert.ok(filters.slice(1).every(filter => /^biquad=b0=[\d.e+\-]+:b1=/.test(filter) && filter.endsWith('precision=f64')))
  assert.equal(buildAudioEqFilters({ ...DEFAULT_AUDIO_EQ, midDb: 3 }, NaN)[0], 'aresample=48000')
})

test('real FFmpeg mono/stereo EQ matches sample-by-sample reference at 8/44.1/48kHz', () => {
  for (const rate of [8000, 44100, 48000]) for (const channels of [1, 2]) {
    const count = Math.round(rate / 4)
    const eq = { ...DEFAULT_AUDIO_EQ, bassDb: 12, midDb: -12, trebleDb: 9, lowCut: true }
    const source = Array.from({ length: channels }, (_, ch) => Float32Array.from({ length: count }, (_, i) =>
      (i === 0 ? 0.1 : 0) + 0.02 * Math.sin(2 * Math.PI * (ch ? 700 : 40) * i / rate)
        + 0.01 * Math.sin(2 * Math.PI * rate * 0.3 * i / rate)))
    const input = Buffer.alloc(count * channels * 4)
    for (let i = 0; i < count; i++) for (let ch = 0; ch < channels; ch++) input.writeFloatLE(source[ch][i], (i * channels + ch) * 4)
    const output = run(['-f', 'f32le', '-ar', String(rate), '-ac', String(channels), '-i', 'pipe:0',
      '-af', buildAudioEqFilters(eq, rate).join(','), '-f', 'f32le', 'pipe:1'], input)
    assert.equal(output.length, input.length)
    for (let ch = 0; ch < channels; ch++) {
      const expected = applyBiquads(source[ch], getAudioEqCoefficients(eq, rate))
      for (let i = 0; i < count; i += 17) assert.ok(Math.abs(output.readFloatLE((i * channels + ch) * 4) - expected[i]) < 2e-7,
        `rate=${rate} channel=${ch} frame=${i}`)
    }
  }
})

function loadNativeMixHandler() {
  const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8')
  const helpers = main.slice(main.indexOf('const formatFilterNumber ='), main.indexOf('// Ask the running export worker'))
  let handler = main.slice(main.indexOf("ipcMain.handle('export:mixAudio'"), main.indexOf('// Encode a mixed WAV'))
  handler = handler.replace("await import('./audioMixEligibility.mjs')", 'dependencies.eligibility')
    .replace("await import('./audioVolumeEnvelope.mjs')", 'dependencies.envelope')
    .replace("await import('./audioEq.mjs')", 'dependencies.eq')
  let callback
  vm.runInNewContext(helpers + handler, {
    ipcMain: { handle(name, fn) { assert.equal(name, 'export:mixAudio'); callback = fn } },
    dependencies: { eligibility, envelope: { buildAudioVolumeEnvelopeFilter }, eq: { buildAudioEqFilters } },
    getFfmpegUnavailableError: () => null, fs: fsp, fsSync: fs, path, spawn, ffmpegPath, setTimeout, clearTimeout,
    resolveMediaInputPath: value => value, probeAudioDurationSeconds: async () => null,
  })
  return callback
}

test('actual native export handler combines EQ, partial range, clip gain, envelope and track gain', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-eq-mix-'))
  try {
    run(['-f', 'lavfi', '-i', 'aevalsrc=0.05*sin(2*PI*1000*t):s=8000:d=8', '-c:a', 'pcm_f32le', path.join(temp, 'tone.wav')])
    const envelope = { version: 1, offsetSeconds: 0, points: [{ id: 'a', time: 0, db: 0 }, { id: 'b', time: 4, db: -12 }] }
    const clip = { id: 'a', type: 'audio', trackId: 'a1', assetId: 'tone', startTime: 1, duration: 4, trimStart: 2,
      gainDb: -6, audioEq: { ...DEFAULT_AUDIO_EQ, midDb: 6 }, volumeEnvelope: envelope }
    const options = { projectPath: temp, outputPath: path.join(temp, 'mix.wav'), sampleRate: 8000, channels: 1,
      rangeStart: 2, rangeEnd: 4, clips: [clip], tracks: [{ id: 'a1', type: 'audio', volume: 50 }],
      assets: [{ id: 'tone', path: 'tone.wav' }] }
    const handler = loadNativeMixHandler()
    assert.equal((await handler({}, { ...options, validateOnly: true })).success, true)
    assert.equal(fs.existsSync(options.outputPath), false)
    const result = await handler({}, options)
    assert.equal(result.success, true, result.error)
    const data = run(['-i', options.outputPath, '-f', 'f32le', 'pipe:1'])
    assert.equal(data.length, 16000 * 4)
    for (let frame = 1001; frame < 15900; frame += 137) {
      // At the peak centre the +6 dB EQ and -6 dB clip gain cancel exactly.
      const expected = 0.05 * Math.sin(2 * Math.PI * 1000 * frame / 8000) * 0.5
        * getAudioVolumeEnvelopeGain(clip, 1 + frame / 8000)
      assert.ok(Math.abs(data.readFloatLE(frame * 4) - expected) < 4e-5, `range sample ${frame}`)
    }
  } finally { await fsp.rm(temp, { recursive: true, force: true }) }
})

test('export payload owns EQ data; package ships native dependency; captions and cache carry it', () => {
  const source = fs.readFileSync(path.join(root, 'src/services/exporter.js'), 'utf8')
  const snippet = source.slice(source.indexOf('const serializeAudioClipForMix ='), source.indexOf('const serializeAudioAssetsForMix ='))
  const serialize = vm.runInNewContext(snippet + '\nserializeAudioClipForMix', {
    normalizeAudioVolumeEnvelope, normalizeAudioEq, normalizeAudioClipGainDb: value => value ?? 0,
  })
  const clip = { audioEq: { ...DEFAULT_AUDIO_EQ, bassDb: 5 } }
  const payload = serialize(clip)
  assert.deepEqual(payload.audioEq, clip.audioEq)
  payload.audioEq.bassDb = 0
  assert.equal(clip.audioEq.bassDb, 5)
  const config = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.ok(config.build.files.includes('src/utils/audioEq.mjs'))
  assert.ok(config.build.files.includes('electron/**/*'))
  assert.match(fs.readFileSync(path.join(root, 'src/services/timelineAudioMix.js'), 'utf8'), /audioEq: normalizeAudioEq\(clip.audioEq\)/)
  assert.match(fs.readFileSync(path.join(root, 'src/services/previewCache.js'), 'utf8'), /audioEq: clip.audioEq \|\| null/)
})
