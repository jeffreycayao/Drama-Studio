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
import { buildAudioVolumeEnvelopeFilter } from '../electron/audioVolumeEnvelope.mjs'
import * as eligibility from '../electron/audioMixEligibility.mjs'
import { getCompoundRenderState } from '../src/utils/compoundPlayback.mjs'
import { buildUncompoundPlan } from '../src/utils/uncompoundDocument.mjs'

const require = createRequire(import.meta.url)
const ffmpegPath = require('ffmpeg-static')
const root = path.resolve(import.meta.dirname, '..')
function run(args) {
  const result = spawnSync(ffmpegPath, ['-v', 'error', ...args], { maxBuffer: 32 * 1024 * 1024, timeout: 30000 })
  assert.equal(result.status, 0, result.stderr?.toString() || String(result.error))
  return result.stdout
}
// Execute the production IPC handler, including its real FFmpeg process.
function loadHandler() {
  const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8')
  const helpers = main.slice(main.indexOf('const formatFilterNumber ='), main.indexOf('// Ask the running export worker'))
  const handler = main.slice(main.indexOf("ipcMain.handle('export:mixAudio'"), main.indexOf('// Encode a mixed WAV'))
    .replace("await import('./audioMixEligibility.mjs')", 'dependencies.eligibility')
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

test('native compound window preserves child source, fade, EQ and envelope clocks with silent outer handles', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-compound-audio-'))
  try {
    run(['-f', 'lavfi', '-i', 'aevalsrc=0.08*sin(2*PI*(331*t+19*t*t)):s=8000:d=12',
      '-c:a', 'pcm_f32le', path.join(temp, 'tone.wav')])
    const clip = { id: 'child', type: 'audio', trackId: 'a', assetId: 'tone', startTime: 0, duration: 6,
      trimStart: 1.25, speed: 1, gainDb: -2, fadeIn: 3, fadeOut: 2,
      audioEq: { enabled: true, midDb: 5, bassDb: -3, trebleDb: 2, lowCut: true },
      volumeEnvelope: { version: 1, offsetSeconds: 0, points: [{ id: 'a', time: 0, db: 0 }, { id: 'b', time: 6, db: -10 }] } }
    const handler = loadHandler()
    const options = { projectPath: temp, sampleRate: 8000, channels: 1,
      tracks: [{ id: 'a', type: 'audio', volume: 70 }], assets: [{ id: 'tone', path: 'tone.wav' }] }
    for (const range of [[0, 6], [1.25, 3.75], [3, 6]]) {
      const referencePath = path.join(temp, 'reference.wav'), boundedPath = path.join(temp, 'bounded.wav')
      const start = Math.max(range[0], 2), end = Math.min(range[1], 4)
      assert.equal((await handler({}, { ...options, clips: [clip], rangeStart: start, rangeEnd: end,
        outputPath: referencePath })).success, true)
      const result = await handler({}, { ...options,
        clips: [{ ...clip, playbackWindowStart: 2, playbackWindowEnd: 4 }],
        rangeStart: range[0], rangeEnd: range[1], outputPath: boundedPath })
      assert.equal(result.success, true, result.error)
      const reference = run(['-i', referencePath, '-f', 'f32le', 'pipe:1'])
      const bounded = run(['-i', boundedPath, '-f', 'f32le', 'pipe:1'])
      assert.equal(bounded.length, (range[1] - range[0]) * 8000 * 4)
      const offset = (start - range[0]) * 8000 * 4
      assert.deepEqual(bounded.subarray(offset, offset + reference.length), reference)
      for (const silence of [bounded.subarray(0, offset), bounded.subarray(offset + reference.length)]) {
        assert.ok(silence.every(byte => byte === 0), 'hidden handles must be silent')
      }
    }
  } finally { await fsp.rm(temp, { recursive: true, force: true }) }
})

test('native preflight ignores unavailable media entirely outside a compound window without creating output', async () => {
  const clip = { id: 'hidden', type: 'audio', trackId: 'a', assetId: 'missing', startTime: 0, duration: 1,
    playbackWindowStart: 3, playbackWindowEnd: 4 }
  const result = await loadHandler()({}, { clips: [clip], tracks: [{ id: 'a', type: 'audio' }], assets: [],
    projectPath: '/not-a-project', outputPath: '/not-an-output.wav', rangeStart: 0, rangeEnd: 5, validateOnly: true })
  assert.equal(result.success, true)
  assert.equal(result.clipCount, 0)
  assert.equal(result.skipped[0].reason, 'outside-range')
  assert.equal(result.skipped[0].problem, false)
})

test('Uncompound preserves real native audio through moves, safe edge crops, fades, envelope, EQ and track/master gain', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-uncompound-audio-'))
  try {
    run(['-f', 'lavfi', '-i', 'aevalsrc=0.08*sin(2*PI*(331*t+19*t*t)):s=8000:d=12',
      '-ac', '2', '-c:a', 'pcm_f32le', path.join(temp, 'tone.wav')])
    const audio = { id: 'sound', assetId: 'tone', type: 'audio', trackId: 'a', startTime: 0, duration: 4,
      trimStart: 1, trimEnd: 5, sourceDuration: 12, speed: 1, sourceTimeScale: 1, sourceFps: 24, timelineFps: 24,
      gainDb: -2, fadeIn: 0.5, fadeOut: 0.5, audioEq: { enabled: true, midDb: 5, bassDb: -3, trebleDb: 2, lowCut: true },
      volumeEnvelope: { version: 1, offsetSeconds: 0.25, points: [{ id: 'p0', time: 0, db: 0 }, { id: 'p1', time: 4, db: -10 }] } }
    const handler = loadHandler()
    for (const [trimStart, trimEnd, startTime] of [[0, 4, 2], [1, 3, 3], [0, 3, 1], [1, 4, 0]]) {
      const compound = { id: 'container', type: 'compound', name: 'Sound and picture', trackId: 'root-v',
        startTime, duration: trimEnd - trimStart, trimStart, trimEnd, sourceDuration: 4, speed: 1, sourceTimeScale: 1,
        compound: { version: 1, document: { fps: 24, width: 1920, height: 1080, duration: 4,
          tracks: [{ id: 'a', type: 'audio', volume: 70, pan: 35, channels: 'stereo' }], clips: [structuredClone(audio)],
          transitions: [], markers: [], masterAudioVolume: 100, masterAudioInserts: [] } } }
      const state = { clips: [compound], tracks: [{ id: 'root-v', type: 'video' }, { id: 'root-a', type: 'audio' }],
        transitions: [], markers: [], clipCounter: 1, markerCounter: 1, fps: 24 }
      const before = getCompoundRenderState(state)
      assert.deepEqual(before.compoundRenderErrors, [])
      const after = buildUncompoundPlan({ ...state, clipId: compound.id })
      assert.equal(after.ok, true, after.reason)
      for (const [rangeStart, rangeEnd] of [[0, 8], [startTime + 0.5, startTime + compound.duration]]) {
        const payload = { projectPath: temp, sampleRate: 8000, channels: 2, masterVolume: 80,
          rangeStart, rangeEnd, assets: [{ id: 'tone', path: 'tone.wav' }] }
        const paths = ['before', 'after'].map(name => path.join(temp, `${name}.wav`))
        for (const [index, snapshot] of [before, after].entries()) {
          const result = await handler({}, { ...payload, clips: snapshot.clips, tracks: snapshot.tracks, outputPath: paths[index] })
          assert.equal(result.success, true, `[${trimStart},${trimEnd}] range ${rangeStart} ${index === 0 ? 'original compound' : 'uncompounded'}: ${result.error}`)
        }
        const original = run(['-i', paths[0], '-f', 'f32le', 'pipe:1'])
        const expanded = run(['-i', paths[1], '-f', 'f32le', 'pipe:1'])
        assert.deepEqual(expanded, original, `native sample parity at source [${trimStart}, ${trimEnd}], timeline ${startTime}, range ${rangeStart}`)
      }
    }
  } finally { await fsp.rm(temp, { recursive: true, force: true }) }
})
