import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import { analyzeAudioDucking, duckingWaveformSamples } from '../src/services/audioDucking.mjs'
import { buildAudioVolumeEnvelopeFilter } from '../electron/audioVolumeEnvelope.mjs'
import { getAudioVolumeEnvelopeGain } from '../src/utils/audioVolumeEnvelope.mjs'

const require = createRequire(import.meta.url)
const ffmpegPath = require('ffmpeg-static')
const root = path.resolve(import.meta.dirname, '..')
function run(args) {
  const result = spawnSync(ffmpegPath, ['-v', 'error', ...args], { maxBuffer: 32 * 1024 * 1024, timeout: 30000 })
  assert.equal(result.status, 0, result.stderr?.toString() || String(result.error))
  return result.stdout
}

// Extract only the actual waveform IPC callback. No Electron app, preload,
// preferences or project starts. All stat/spawn paths are constrained to this
// test's newly created temporary directory; decoding uses bundled FFmpeg.
function loadNativeWaveformHandler(temp) {
  const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8')
  const start = main.indexOf("ipcMain.handle('media:getAudioWaveform'")
  const end = main.indexOf("ipcMain.handle('media:trimAudioSegment'", start)
  assert.ok(start >= 0 && end > start)
  let handler, decodes = 0
  const scoped = value => {
    const absolute = path.resolve(value)
    assert.ok(absolute.startsWith(temp + path.sep), `Only synthetic temporary media may be read: ${absolute}`)
    return absolute
  }
  vm.runInNewContext(main.slice(start, end), {
    ipcMain: { handle(name, callback) { assert.equal(name, 'media:getAudioWaveform'); handler = callback } },
    ffmpegPath, Buffer, Float32Array, audioWaveformCache: new Map(),
    fs: { stat: value => fsp.stat(scoped(value)) }, resolveMediaInputPath: scoped,
    spawn(executable, args, options) {
      assert.equal(executable, ffmpegPath)
      scoped(args[args.indexOf('-i') + 1])
      assert.equal(args.at(-1), 'pipe:1', 'analysis must not write output files')
      decodes++
      return spawn(executable, args, options)
    },
  })
  return { handler, decodes: () => decodes }
}

function analysisOptions(temp, source, duration = 6) {
  const music = { id: 'music', assetId: 'music', type: 'audio', trackId: 'music-track', startTime: 0,
    duration, trimStart: 0, trimEnd: duration, sourceTimeScale: 1, speed: 1,
    volumeEnvelope: { version: 1, offsetSeconds: 2, points: [
      { id: 'base-start', time: 2, db: -3 }, { id: 'base-end', time: 2 + duration, db: -3 },
    ] } }
  const voice = { ...music, id: 'voice', assetId: 'voice', trackId: 'voice-track', volumeEnvelope: undefined }
  return { projectHandle: temp, musicId: 'music', dialogueTrackId: 'voice-track',
    state: { clips: [music, voice], transitions: [], tracks: [
      { id: 'music-track', type: 'audio', volume: 100 }, { id: 'voice-track', type: 'audio', volume: 100 },
    ] }, assets: [{ id: 'music', duration, hasAudio: true }, { id: 'voice', duration, hasAudio: true, path: source }] }
}

test('actual waveform IPC plus ducking analysis finds speech ends without a multi-second final-bucket smear', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-ducking-native-'))
  try {
    // Dialogue is deliberately in the right channel only. The actual native
    // max-channel peak extraction must detect both isolated level bursts.
    run(['-f', 'lavfi', '-i', "aevalsrc='0|if(between(t,1,2)+between(t,4,4.5),0.3,0)':s=8000:d=6",
      '-c:a', 'pcm_f32le', path.join(temp, 'dialogue.wav')])
    const native = loadNativeWaveformHandler(temp), requests = []
    const options = analysisOptions(temp, 'dialogue.wav')
    const before = JSON.stringify(options)
    const result = await analyzeAudioDucking({ ...options, api: {
      pathJoin: async (...parts) => path.join(...parts),
      getAudioWaveform: async (source, settings) => { requests.push(settings); return native.handler({}, source, settings) },
    } })
    assert.equal(result.ok, true)
    assert.equal(requests.length, 1)
    assert.deepEqual(requests[0], { sampleCount: 300, sampleRate: 8000 })
    assert.equal(result.activity.length, 2)
    for (const [actual, expected] of result.activity.map((span, index) => [span, [{ start: 1, end: 2 }, { start: 4, end: 4.5 }][index]])) {
      assert.ok(Math.abs(actual.start - expected.start) <= 0.041)
      assert.ok(Math.abs(actual.end - expected.end) <= 0.041, `${actual.end} must remain near ${expected.end}`)
    }
    assert.equal(JSON.stringify(options), before, 'analysis is not an authored edit')
    const ducked = { ...options.state.clips[0], volumeEnvelope: result.envelope }
    assert.ok(Math.abs(getAudioVolumeEnvelopeGain(ducked, 5.1) - 10 ** (-3 / 20)) < 1e-10,
      'music recovers after dialogue, before the6-second source end')
    const cached = await native.handler({}, path.join(temp, 'dialogue.wav'), requests[0])
    assert.equal(cached.success, true)
    assert.equal(native.decodes(), 1, 'same native request reuses the real handler cache')
  } finally { await fsp.rm(temp, { recursive: true, force: true }) }
})

test('analyzed envelope exports matching real PCM, including original curve, gain and partial-range offset', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-ducking-export-'))
  try {
    run(['-f', 'lavfi', '-i', "aevalsrc='if(between(t,1,2)+between(t,4,4.5),0.3,0)':s=8000:d=6",
      '-c:a', 'pcm_f32le', path.join(temp, 'dialogue.wav')])
    run(['-f', 'lavfi', '-i', 'aevalsrc=0.1:s=8000:d=8', '-c:a', 'pcm_f32le', path.join(temp, 'music.wav')])
    const native = loadNativeWaveformHandler(temp), options = analysisOptions(temp, 'dialogue.wav')
    const result = await analyzeAudioDucking({ ...options, api: { pathJoin: async (...parts) => path.join(...parts),
      getAudioWaveform: (source, settings) => native.handler({}, source, settings) } })
    const clip = { ...options.state.clips[0], volumeEnvelope: result.envelope }
    const rangeOffset = 0.5, staticGain = 10 ** (-6 / 20) * 0.5
    run(['-i', path.join(temp, 'music.wav'), '-af',
      `atrim=start=1:end=5,asetpts=PTS-STARTPTS,volume=${staticGain},${buildAudioVolumeEnvelopeFilter(clip, rangeOffset)}`,
      '-c:a', 'pcm_f32le', path.join(temp, 'ducked.wav')])
    const pcm = run(['-i', path.join(temp, 'ducked.wav'), '-f', 'f32le', 'pipe:1'])
    assert.equal(pcm.length, 4 * 8000 * 4)
    for (let frame = 0; frame < 32000; frame += 97) {
      const expected = 0.1 * staticGain * getAudioVolumeEnvelopeGain(clip, rangeOffset + frame / 8000)
      assert.ok(Math.abs(pcm.readFloatLE(frame * 4) - expected) < 1e-7, `sample ${frame}`)
    }
    const baseline = pcm.readFloatLE(Math.round((0.6 - rangeOffset) * 8000) * 4)
    const duringVoice = pcm.readFloatLE(Math.round((1.5 - rangeOffset) * 8000) * 4)
    assert.ok(Math.abs(20 * Math.log10(duringVoice / baseline) + 12) < 1e-4,
      'rendered music is12 dB lower while dialogue is active')
  } finally { await fsp.rm(temp, { recursive: true, force: true }) }
})

test('actual native silence is refused and missing synthetic media starts no decode', async () => {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'velorn-ducking-silence-'))
  try {
    run(['-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '1', '-c:a', 'pcm_f32le', path.join(temp, 'silence.wav')])
    const native = loadNativeWaveformHandler(temp)
    const missing = await native.handler({}, path.join(temp, 'missing.wav'), { sampleCount: duckingWaveformSamples(1), sampleRate: 8000 })
    assert.equal(missing.success, false)
    assert.equal(native.decodes(), 0)
    await assert.rejects(analyzeAudioDucking({ ...analysisOptions(temp, 'silence.wav', 1), api: {
      pathJoin: async (...parts) => path.join(...parts), getAudioWaveform: (source, settings) => native.handler({}, source, settings),
    } }), /No dialogue activity/)
    assert.equal(native.decodes(), 1)
  } finally { await fsp.rm(temp, { recursive: true, force: true }) }
})
