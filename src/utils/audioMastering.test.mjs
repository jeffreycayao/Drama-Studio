import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_AUTO_DUCKING_SETTINGS, planAutoDuckingTargets, detectSpeechActivity, buildAutoDuckingEnvelope,
  getAutoDuckingBase, buildAutoDuckingRecord, planRemoveAutoDucking, getDuckingAttenuationDb, validateAutoDuckingSettings,
  getTrackMixRole, normalizeMixRole,
} from './audioMastering.mjs'
import { getAudioVolumeEnvelopeDb, AUDIO_VOLUME_ENVELOPE_MAX_POINTS } from './audioVolumeEnvelope.mjs'
import { buildAudioVolumeEnvelopeExpression } from './audioVolumeEnvelope.mjs'
import { analyzeAutoDucking, toAutoDuckingUpdates } from '../services/audioMastering.js'

const track = (id, mixRole, patch = {}) => ({ id, type: 'audio', volume: 100, visible: true, muted: false, ...(mixRole ? { mixRole } : {}), ...patch })
const clip = (id, trackId, patch = {}) => ({ id, assetId: id, type: 'audio', trackId, startTime: 0,
  duration: 10, trimStart: 0, trimEnd: 10, sourceDuration: 10, speed: 1, sourceTimeScale: 1, ...patch })
const approx = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`)
// RMS and peak lanes: speech spans [start, end, level].
const wave = (duration, spans, hop = 0.02, { rmsLevel } = {}) => {
  const count = Math.ceil(duration / hop)
  const at = index => {
    const time = (index + 0.5) * hop
    return spans.reduce((value, [start, end, level = 0.5]) => time >= start && time < end ? Math.max(value, level) : value, 0)
  }
  const peaks = Array.from({ length: count }, (_, index) => at(index))
  return { duration, hopSeconds: hop, peaks, rms: rmsLevel ? peaks.map(value => value * rmsLevel) : peaks.map(value => value * 0.5) }
}
function fixture() {
  const music = clip('music', 'bgm'), voice = clip('voice', 'dia')
  const tracks = [track('bgm', 'bgm'), track('dia', 'dialogue')]
  return { music, voice, tracks, state: { clips: [music, voice], tracks, transitions: [] },
    assets: [{ id: 'music', hasAudio: true, duration: 10 }, { id: 'voice', hasAudio: true, duration: 10, path: 'assets/voice.wav' }] }
}
const sources = f => [{ clip: f.voice, asset: f.assets[1], track: f.tracks[1] }]

test('mix roles normalize and only apply to audio tracks', () => {
  assert.equal(normalizeMixRole('bgm'), 'bgm')
  assert.equal(normalizeMixRole('music'), null)
  assert.equal(getTrackMixRole({ type: 'video', mixRole: 'bgm' }), null)
  assert.equal(getTrackMixRole({ type: 'audio', mixRole: 'dialogue' }), 'dialogue')
})

test('settings validation rejects out-of-range and non-numeric values without coercion', () => {
  assert.equal(validateAutoDuckingSettings(DEFAULT_AUTO_DUCKING_SETTINGS).ok, true)
  assert.equal(validateAutoDuckingSettings({ ...DEFAULT_AUTO_DUCKING_SETTINGS, attackMs: '60' }).ok, false)
  assert.equal(validateAutoDuckingSettings({ ...DEFAULT_AUTO_DUCKING_SETTINGS, reductionDb: 99 }).ok, false)
  assert.equal(validateAutoDuckingSettings({ ...DEFAULT_AUTO_DUCKING_SETTINGS, detector: 'ai' }).ok, false)
  assert.deepEqual(validateAutoDuckingSettings({}).settings, { ...DEFAULT_AUTO_DUCKING_SETTINGS })
})

test('targets need dialogue and BGM roles, and skip music with no overlapping dialogue', () => {
  const f = fixture()
  assert.match(planAutoDuckingTargets({ ...f.state, tracks: [track('bgm', 'bgm'), track('dia')] }, f.assets).reason, /Dialogue/)
  const plan = planAutoDuckingTargets(f.state, f.assets)
  assert.equal(plan.ok, true)
  assert.equal(plan.targets.length, 1)
  assert.equal(plan.targets[0].sources[0].clip, f.voice)
  const far = { ...f.state, clips: [f.music, { ...f.voice, startTime: 30 }] }
  const skipped = planAutoDuckingTargets(far, f.assets)
  assert.equal(skipped.targets.length, 0)
  assert.match(skipped.skipped[0].reason, /No dialogue overlaps/)
  const locked = planAutoDuckingTargets({ ...f.state, tracks: [track('bgm', 'bgm', { locked: true }), f.tracks[1]] }, f.assets)
  assert.match(locked.skipped[0].reason, /Unlock/)
})

test('RMS detector with hysteresis keeps one interval across a short dip between syllables', () => {
  const f = fixture()
  // Speech 2–4 s at -6 dBFS RMS with a 60 ms dip to -40 dBFS (above the
  // -44 dBFS close threshold), then silence.
  const waveform = wave(10, [[2, 3, 0.5], [3, 3.06, 0.02], [3.06, 4, 0.5]], 0.02, { rmsLevel: 1 })
  const activity = detectSpeechActivity(f.music, sources(f), new Map([['voice', waveform]]))
  assert.equal(activity.detector, 'rms')
  assert.equal(activity.length, 1)
  approx(activity[0].start, 2, 0.021)
  approx(activity[0].end, 4, 0.021)
})

test('peak fallback when RMS is unavailable, and minimum speech length drops clicks', () => {
  const f = fixture()
  const waveform = wave(10, [[1, 1.02, 0.9], [5, 6, 0.5]])
  delete waveform.rms
  const activity = detectSpeechActivity(f.music, sources(f), new Map([['voice', waveform]]))
  assert.equal(activity.detector, 'peak')
  assert.equal(activity.length, 1, '20 ms click is shorter than the 80 ms minimum')
  approx(activity[0].start, 5, 0.021)
})

test('attack completes at speech onset, hold keeps the duck, release ramps back up', () => {
  const f = fixture(), settings = { ...DEFAULT_AUTO_DUCKING_SETTINGS }
  const result = buildAutoDuckingEnvelope(f.music, [{ start: 2, end: 4 }], settings)
  assert.equal(result.ok, true)
  const music = { ...f.music, volumeEnvelope: result.envelope }
  approx(getAudioVolumeEnvelopeDb(music, 1.94), 0)
  approx(getAudioVolumeEnvelopeDb(music, 1.97), -7)
  approx(getAudioVolumeEnvelopeDb(music, 2), -14)
  approx(getAudioVolumeEnvelopeDb(music, 4.5), -14)
  approx(getAudioVolumeEnvelopeDb(music, 4.65), -7)
  approx(getAudioVolumeEnvelopeDb(music, 4.8), 0)
  assert.equal(result.pointCount, 6)
})

test('existing envelope points, ids and hidden trim points are kept and summed', () => {
  const f = fixture()
  const base = { version: 1, offsetSeconds: 1, points: [{ id: 'hidden', time: 0.5, db: -2 }, { id: 'a', time: 1, db: -3 }, { id: 'b', time: 11, db: -3 }] }
  const result = buildAutoDuckingEnvelope({ ...f.music, volumeEnvelope: base }, [{ start: 2, end: 3 }], DEFAULT_AUTO_DUCKING_SETTINGS, base)
  assert.equal(result.ok, true)
  const ids = result.envelope.points.map(point => point.id)
  for (const id of ['hidden', 'a', 'b']) assert.ok(ids.includes(id))
  assert.equal(result.envelope.points.find(point => point.id === 'hidden').db, -2)
  approx(getAudioVolumeEnvelopeDb({ volumeEnvelope: result.envelope }, 2.5), -17)
})

test('dips closer than attack+hold+release merge instead of pumping', () => {
  const f = fixture()
  const result = buildAutoDuckingEnvelope(f.music, [{ start: 1, end: 2 }, { start: 2.5, end: 3 }])
  assert.equal(result.dipCount, 1)
  approx(getAudioVolumeEnvelopeDb({ ...f.music, volumeEnvelope: result.envelope }, 2.6), -14)
})

test('too many dips are merged across the shortest gaps to fit the editable point cap', () => {
  const music = clip('music', 'bgm', { duration: 600, trimEnd: 600, sourceDuration: 600 })
  const activity = Array.from({ length: 60 }, (_, index) => ({ start: 5 + index * 9.5 + (index % 3) * 0.3, end: 6 + index * 9.5 }))
  const result = buildAutoDuckingEnvelope(music, activity, DEFAULT_AUTO_DUCKING_SETTINGS)
  assert.equal(result.ok, true)
  assert.ok(result.pointCount <= AUDIO_VOLUME_ENVELOPE_MAX_POINTS)
  assert.ok(result.mergedForLimit > 0)
  // Every detected speech moment is still fully ducked.
  for (const item of activity) approx(getAudioVolumeEnvelopeDb({ ...music, volumeEnvelope: result.envelope }, (item.start + item.end) / 2), -14)
})

test('re-running replaces the previous pass; manual edits after ducking become the new base', () => {
  const f = fixture()
  const first = buildAutoDuckingEnvelope(f.music, [{ start: 2, end: 3 }])
  const ducked = { ...f.music, volumeEnvelope: first.envelope, autoDucking: buildAutoDuckingRecord(f.music.volumeEnvelope, first.envelope, first.settings) }
  const base = getAutoDuckingBase(ducked)
  assert.equal(base.replacesPrevious, true)
  assert.deepEqual(base.envelope.points, [])
  // A head trim only shifts the offset: still the same pass.
  assert.equal(getAutoDuckingBase({ ...ducked, volumeEnvelope: { ...first.envelope, offsetSeconds: 1 } }).replacesPrevious, true)
  assert.equal(planRemoveAutoDucking(ducked).ok, true)
  const edited = { ...ducked, volumeEnvelope: { ...first.envelope, points: first.envelope.points.map((point, index) => index === 1 ? { ...point, db: -20 } : point) } }
  const editedBase = getAutoDuckingBase(edited)
  assert.equal(editedBase.replacesPrevious, false)
  assert.equal(editedBase.editedSinceDucking, true)
  assert.equal(planRemoveAutoDucking(edited).ok, false)
})

test('the FFmpeg dynamic-volume expression matches the planned attenuation sample by sample', () => {
  const f = fixture()
  const result = buildAutoDuckingEnvelope(f.music, [{ start: 2, end: 4 }, { start: 7, end: 7.5 }])
  const expression = buildAudioVolumeEnvelopeExpression({ volumeEnvelope: result.envelope }, 't')
  const evaluate = t => Function('pow', 'min', 'max', `return ${expression.replaceAll('t', `(${t})`)}`)(Math.pow, Math.min, Math.max)
  for (let t = 0; t <= 10; t += 0.013) {
    const expected = Math.pow(10, getDuckingAttenuationDb(t, result.dips, result.settings) / 20)
    approx(evaluate(t), expected, 1e-9)
  }
})

test('service analysis requests RMS once per unique source and returns undoable proposals', async () => {
  const f = fixture(), calls = []
  const api = { pathJoin: async (...parts) => parts.join('/'), getAudioWaveform: async (...args) => {
    calls.push(args)
    const levels = wave(10, [[2, 4, 0.5]], 0.02)
    return { success: true, duration: 10, peaks: levels.peaks, rms: levels.rms }
  } }
  f.state.clips.push({ ...f.voice, id: 'voice-2', startTime: 0 })
  const result = await analyzeAutoDucking({ state: f.state, assets: f.assets, projectHandle: '/p',
    settings: DEFAULT_AUTO_DUCKING_SETTINGS, api })
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1].includeRms, true)
  assert.equal(result.proposals.length, 1)
  const [update] = toAutoDuckingUpdates(result.proposals)
  assert.equal(update.expectedClip, f.music)
  assert.equal(update.autoDucking.version, 1)
})

test('service analysis honors cancellation before decoding', async () => {
  const f = fixture(), controller = new AbortController()
  controller.abort()
  await assert.rejects(analyzeAutoDucking({ state: f.state, assets: f.assets, projectHandle: '/p',
    settings: DEFAULT_AUTO_DUCKING_SETTINGS, signal: controller.signal, api: {} }), /canceled/)
})

test('the staleness signature changes when dialogue moves or track levels change, not for unrelated clips', async () => {
  const { getAutoDuckingInputSignature, pickAutoDuckingSettings } = await import('./audioMastering.mjs')
  const f = fixture()
  const base = getAutoDuckingInputSignature(f.state)
  const other = { ...f.state, clips: [...f.state.clips, { id: 'v', trackId: 'video-1', type: 'video', startTime: 0, duration: 1 }] }
  assert.equal(getAutoDuckingInputSignature(other), base, 'picture edits do not invalidate')
  const moved = { ...f.state, clips: [f.music, { ...f.voice, startTime: 3 }] }
  assert.notEqual(getAutoDuckingInputSignature(moved), base, 'moved dialogue invalidates')
  const louder = { ...f.state, tracks: [f.tracks[0], { ...f.tracks[1], volume: 50 }] }
  assert.notEqual(getAutoDuckingInputSignature(louder), base, 'dialogue track volume invalidates')
  const soloed = { ...f.state, tracks: [...f.tracks, { id: 'x', type: 'audio', solo: true }] }
  assert.notEqual(getAutoDuckingInputSignature(soloed), base, 'solo elsewhere invalidates')
  assert.deepEqual(pickAutoDuckingSettings({ ...DEFAULT_AUTO_DUCKING_SETTINGS, evil: { big: 'x' }, detector: 'ai' }),
    Object.fromEntries(Object.entries(DEFAULT_AUTO_DUCKING_SETTINGS).filter(([key]) => key !== 'detector')))
})
