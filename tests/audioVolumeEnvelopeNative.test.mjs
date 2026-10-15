import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { buildAudioVolumeEnvelopeFilter } from '../electron/audioVolumeEnvelope.mjs'
import { getAudioVolumeEnvelopeGain, normalizeAudioVolumeEnvelope } from '../src/utils/audioVolumeEnvelope.mjs'
import { normalizeAudioEq } from '../src/utils/audioEq.mjs'
import { buildAudioEqFilters } from '../electron/audioEq.mjs'
import * as eligibility from '../electron/audioMixEligibility.mjs'

const require = createRequire(import.meta.url)
const ffmpegPath = require('ffmpeg-static')
const root = path.resolve(import.meta.dirname, '..')
const envelope = { version: 1, offsetSeconds: 0, points: [
  { id: 'start', time: 0, db: 0 }, { id: 'low', time: 2, db: -20 }, { id: 'end', time: 4, db: 0 },
] }
const run = args => {
  const result = spawnSync(ffmpegPath, ['-v', 'error', ...args], { maxBuffer: 32 * 1024 * 1024, timeout: 30000 })
  assert.equal(result.status, 0, result.stderr?.toString() || String(result.error))
  return result.stdout
}

test('native filter preserves channel layout, uses sample time and excludes user text', () => {
  assert.equal(buildAudioVolumeEnvelopeFilter({}), null)
  assert.equal(buildAudioVolumeEnvelopeFilter({ volumeEnvelope: { points: [{ db: 'bad' }] } }), null)
  const filter = buildAudioVolumeEnvelopeFilter({ volumeEnvelope: { ...envelope, points: envelope.points.map(p => ({ ...p, id: "evil';movie=/secret" })) } })
  assert.equal(filter, null, 'duplicate IDs are rejected neutral on read')
  const valid = buildAudioVolumeEnvelopeFilter({ volumeEnvelope: envelope }, 1)
  assert.match(valid, /^aeval=/); assert.match(valid, /:c=same$/); assert.match(valid, /t\+\(1\)/)
  assert.doesNotMatch(valid, /start|low|end/)
})

test('real FFmpeg mono/stereo samples follow the same envelope, including trim/range offsets', () => {
  for (const channels of [1, 2]) for (const offsetSeconds of [0, -1, 1]) {
    const clip = { volumeEnvelope: { ...envelope, offsetSeconds } }
    const rangeOffset = 0.375
    const data = run(['-f', 'lavfi', '-i', `aevalsrc=${channels === 1 ? '0.1' : '0.1|0.2'}:s=8000:d=4`,
      '-af', buildAudioVolumeEnvelopeFilter(clip, rangeOffset), '-f', 'f32le', 'pipe:1'])
    for (let frame = 0; frame < 32000; frame += 137) for (let channel = 0; channel < channels; channel++) {
      const expected = (channel + 1) * 0.1 * getAudioVolumeEnvelopeGain(clip, frame / 8000 + rangeOffset)
      assert.ok(Math.abs(data.readFloatLE((frame * channels + channel) * 4) - expected) < 1e-7)
    }
  }
})

// Load ONLY the actual handler and its pure audio helpers. No Electron app,
// preload, user preferences or real project is started. Dependency injection
// replaces the static dynamic-import statements, not the mix logic.
function loadNativeMixHandler() {
  const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8')
  const helpers = main.slice(main.indexOf('const formatFilterNumber ='), main.indexOf('// Ask the running export worker'))
  let handler = main.slice(main.indexOf("ipcMain.handle('export:mixAudio'"), main.indexOf('// Encode a mixed WAV'))
  handler = handler.replace("await import('./audioMixEligibility.mjs')", 'dependencies.eligibility')
    .replace("await import('./audioVolumeEnvelope.mjs')", 'dependencies.envelope')
    .replace("await import('./audioEq.mjs')", 'dependencies.eq')
  let runHandler
  vm.runInNewContext(helpers + handler, {
    ipcMain: { handle(name, callback) { assert.equal(name, 'export:mixAudio'); runHandler = callback } },
    dependencies: { eligibility, envelope: { buildAudioVolumeEnvelopeFilter }, eq: { buildAudioEqFilters } },
    getFfmpegUnavailableError: () => null,
    fs: fsp, fsSync: fs, path, spawn, ffmpegPath, setTimeout, clearTimeout,
    resolveMediaInputPath: value => value,
    probeAudioDurationSeconds: async () => null,
  })
  return runHandler
}

test('actual export IPC mix: validation, range offset, gain and envelope reach rendered PCM', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-volume-mix-'))
  try {
    run(['-f', 'lavfi', '-i', 'aevalsrc=0.1:s=8000:d=8', '-c:a', 'pcm_f32le', path.join(temp, 'tone.wav')])
    const handler = loadNativeMixHandler()
    const clip = { id: 'a', assetId: 'tone', trackId: 'a1', type: 'audio', startTime: 1, duration: 4,
      trimStart: 2, gainDb: -6, volumeEnvelope: envelope }
    const options = { projectPath: temp, outputPath: path.join(temp, 'mix.wav'), rangeStart: 2, rangeEnd: 4,
      sampleRate: 8000, channels: 1, clips: [clip], tracks: [{ id: 'a1', type: 'audio', volume: 50 }],
      assets: [{ id: 'tone', path: 'tone.wav' }] }
    const validation = await handler({}, { ...options, validateOnly: true })
    assert.equal(validation.success, true); assert.equal(validation.clipCount, 1)
    assert.equal(fs.existsSync(options.outputPath), false, 'validation does not create an output')
    const result = await handler({}, options)
    assert.equal(result.success, true, result.error); assert.equal(result.clipCount, 1)
    const pcm = run(['-i', options.outputPath, '-f', 'f32le', 'pipe:1'])
    assert.equal(pcm.length, 16000 * 4)
    for (let frame = 10; frame < 15990; frame += 137) {
      const expected = 0.1 * 10 ** (-6 / 20) * 0.5 * getAudioVolumeEnvelopeGain(clip, 1 + frame / 8000)
      assert.ok(Math.abs(pcm.readFloatLE(frame * 4) - expected) < 4e-5, `range sample ${frame}`)
    }
  } finally {
    await fsp.rm(temp, { recursive: true, force: true })
  }
})

test('shared renderer payload and packaged file list carry the portable envelope', () => {
  const source = fs.readFileSync(path.join(root, 'src/services/exporter.js'), 'utf8')
  const snippet = source.slice(source.indexOf('const serializeAudioClipForMix ='), source.indexOf('const serializeAudioAssetsForMix ='))
  const serialize = vm.runInNewContext(snippet + '\nserializeAudioClipForMix', {
    normalizeAudioVolumeEnvelope, normalizeAudioEq, normalizeAudioClipGainDb: value => value ?? 0,
  })
  const clip = { id: 'one', type: 'audio', volumeEnvelope: envelope }
  const payload = serialize(clip)
  assert.deepEqual(payload.volumeEnvelope, envelope)
  payload.volumeEnvelope.points[0].db = -10
  assert.equal(envelope.points[0].db, 0, 'payload owns independent point data')
  const config = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.ok(config.build.files.includes('src/utils/audioVolumeEnvelope.mjs'))
  assert.ok(config.build.files.includes('electron/**/*'))
})
