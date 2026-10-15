import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_DUCKING_SETTINGS, getDuckingSources, findDuckingActivity, buildDuckingEnvelope } from './audioDucking.mjs'
import { getAudioVolumeEnvelopeDb, validateAudioVolumeEnvelope } from './audioVolumeEnvelope.mjs'

const track = (id, patch = {}) => ({ id, type: 'audio', volume: 100, visible: true, muted: false, ...patch })
const clip = (id, trackId, patch = {}) => ({ id, assetId: id, type: 'audio', trackId, startTime: 10,
  duration: 5, trimStart: 0, trimEnd: 5, sourceDuration: 5, speed: 1, sourceTimeScale: 1, ...patch })
function fixture() {
  const music = clip('music', 'music-track'), voice = clip('voice', 'voice-track')
  const tracks = [track('music-track'), track('voice-track')]
  return { music, voice, tracks, state: { clips: [music, voice], tracks, transitions: [] },
    assets: [{ id: 'music', hasAudio: true, duration: 5 }, { id: 'voice', hasAudio: true, duration: 5 }] }
}
const levels = (duration, spans = [], hop = 0.02) => ({ duration, hopSeconds: hop,
  peaks: Array.from({ length: Math.ceil(duration / hop) }, (_, index) => {
    const time = (index + 0.5) * hop
    return spans.reduce((value, span) => time >= span[0] && time < span[1] ? Math.max(value, span[2] ?? 1) : value, 0)
  }) })
const approx = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`)
function activity(f, waveform, settings = DEFAULT_DUCKING_SETTINGS) {
  return findDuckingActivity(f.music, [{ clip: f.voice, asset: f.assets[1], track: f.tracks[1] }], new Map([['voice', waveform]]), settings)
}

test('source selection is read-only and requires separate audible unlocked music/dialogue tracks', () => {
  const f = fixture(), before = JSON.stringify(f)
  const plan = getDuckingSources(f.state, f.assets, 'music', 'voice-track')
  assert.equal(plan.ok, true)
  assert.equal(plan.music, f.music)
  assert.equal(plan.sources[0].clip, f.voice)
  assert.equal(JSON.stringify(f), before)
  for (const patch of [{ locked: true }, { syncLocked: true }, { lockMode: 'sync' }, { enabled: false }, { audioEnabled: false }, { reverse: true }, { duration: 601 }]) {
    const next = { ...f.state, clips: [{ ...f.music, ...patch }, f.voice] }
    assert.equal(getDuckingSources(next, f.assets, 'music', 'voice-track').ok, false, JSON.stringify(patch))
  }
  for (const patch of [{ muted: true }, { visible: false }, { volume: 0 }, { locked: true }]) {
    const next = { ...f.state, tracks: [{ ...f.tracks[0], ...patch }, f.tracks[1]] }
    assert.equal(getDuckingSources(next, f.assets, 'music', 'voice-track').ok, false)
  }
  assert.equal(getDuckingSources(f.state, f.assets, 'music', 'music-track').ok, false)
  assert.equal(getDuckingSources(f.state, [f.assets[1]], 'music', 'voice-track').ok, false)
  assert.equal(getDuckingSources(f.state, [f.assets[0]], 'music', 'voice-track').ok, false)
})

test('solo, disabled/reversed dialogue, missing/empty overlap and source count are respected', () => {
  const f = fixture()
  const solo = { ...f.state, tracks: [f.tracks[0], { ...f.tracks[1], solo: true }] }
  assert.equal(getDuckingSources(solo, f.assets, 'music', 'voice-track').ok, false)
  solo.tracks[0] = { ...f.tracks[0], solo: true }
  assert.equal(getDuckingSources(solo, f.assets, 'music', 'voice-track').ok, true)
  for (const patch of [{ enabled: false }, { reverse: true }, { audioEnabled: false }, { startTime: 50 }]) {
    assert.equal(getDuckingSources({ ...f.state, clips: [f.music, { ...f.voice, ...patch }] }, f.assets, 'music', 'voice-track').ok, false)
  }
  const voices = Array.from({ length: 33 }, (_, i) => clip(`voice-${i}`, 'voice-track'))
  assert.equal(getDuckingSources({ ...f.state, clips: [f.music, ...voices] },
    [f.assets[0], ...voices.map(v => ({ id: v.id, hasAudio: true }))], 'music', 'voice-track').ok, false)
})

test('silence stays unchanged; tiny clicks are ignored; brief gaps merge without per-file normalization', () => {
  const f = fixture()
  assert.deepEqual(activity(f, levels(5)), [])
  assert.deepEqual(activity(f, levels(5, [[1, 1.04]])), [])
  const found = activity(f, levels(5, [[1, 1.2], [1.3, 1.5], [3, 3.2]]))
  assert.equal(found.length, 2)
  approx(found[0].start, 1); approx(found[0].end, 1.5)
  assert.deepEqual(activity(f, levels(5, [[0, 5, 0.001]])), [])
})

test('source trims, constant retiming and compound playback windows use timeline-local activity', () => {
  const f = fixture()
  f.voice = { ...f.voice, trimStart: 4, trimEnd: 8, speed: 2 }
  const found = activity(f, levels(10, [[5, 6]]))
  assert.equal(found.length, 1)
  approx(found[0].start, 0.5); approx(found[0].end, 1)
  const tail = activity(f, levels(10, [[0, 10]]))
  approx(tail[0].end, 2)
  f.voice = { ...f.voice, playbackWindowStart: 10.6, playbackWindowEnd: 10.8 }
  const limited = activity(f, levels(10, [[0, 10]]))
  approx(limited[0].start, 0.6); approx(limited[0].end, 0.8)
})

test('dialogue static gain, existing envelope, track volume and edge fades affect detection', () => {
  const f = fixture(), waveform = levels(5, [[0, 5, 0.2]])
  const settings = { ...DEFAULT_DUCKING_SETTINGS, thresholdDb: -20 }
  assert.equal(activity(f, waveform, settings).length, 1)
  for (const voice of [{ ...f.voice, gainDb: -12 }, { ...f.voice,
    volumeEnvelope: { version: 1, offsetSeconds: 0, points: [{ id: 'low', time: 0, db: -12 }] } }]) {
    assert.deepEqual(activity({ ...f, voice }, waveform, settings), [])
  }
  assert.deepEqual(activity({ ...f, tracks: [f.tracks[0], { ...f.tracks[1], volume: 10 }] }, waveform, settings), [])
  const fades = activity({ ...f, voice: { ...f.voice, fadeIn: 1, fadeOut: 1 } }, waveform, settings)
  approx(fades[0].start, 0.5, 0.02); approx(fades[0].end, 4.5, 0.02)
})

test('invalid waveform values/timing fail explicitly instead of manufacturing silence', () => {
  const f = fixture()
  for (const waveform of [null, { duration: 1, peaks: [] }, { duration: 0, peaks: [1] },
    { duration: 1, peaks: [NaN] }, { duration: 1, peaks: [-1] }, { duration: 1, peaks: [1.1] },
    { duration: 1, peaks: [1], hopSeconds: 0 }]) assert.throws(() => activity(f, waveform), /audio levels|timing/)
})

test('ducking builds an additive dB attack, hold and release envelope without touching other properties', () => {
  const f = fixture(), before = JSON.stringify(f.music)
  const result = buildDuckingEnvelope(f.music, [{ start: 1, end: 2 }])
  assert.equal(result.ok, true)
  assert.equal(result.dipCount, 1)
  const ducked = { ...f.music, volumeEnvelope: result.envelope }
  for (const [time, db] of [[0, 0], [0.75, 0], [0.875, -6], [1, -12], [2.2, -12], [2.325, -6], [2.45, 0], [5, 0]]) approx(getAudioVolumeEnvelopeDb(ducked, time), db)
  assert.equal(JSON.stringify(f.music), before)
  assert.equal(validateAudioVolumeEnvelope(result.envelope).ok, true)
})

test('existing point IDs, trim offset and hidden point values survive the additive proposal', () => {
  const f = fixture()
  f.music.volumeEnvelope = { version: 1, offsetSeconds: 2, points: [
    { id: 'hidden-before', time: 1, db: -5 }, { id: 'duck-1', time: 2.5, db: -2 },
    { id: 'inside', time: 4, db: -4 }, { id: 'hidden-after', time: 8, db: -8 },
  ] }
  const before = structuredClone(f.music.volumeEnvelope)
  const result = buildDuckingEnvelope(f.music, [{ start: 1, end: 2 }])
  assert.equal(result.ok, true)
  assert.equal(result.envelope.offsetSeconds, 2)
  for (const point of before.points) {
    const next = result.envelope.points.find(candidate => candidate.id === point.id)
    assert.equal(next.time, point.time)
    if (point.id.startsWith('hidden')) assert.deepEqual(next, point)
  }
  approx(result.envelope.points.find(point => point.id === 'inside').db, -16)
  assert.equal(new Set(result.envelope.points.map(point => point.id)).size, result.pointCount)
  assert.deepEqual(f.music.volumeEnvelope, before)
})

test('attenuation clips at -60 dB with exact saturation knees, not flattened ramps', () => {
  const music = clip('music', 'music-track', { volumeEnvelope: { version: 1, offsetSeconds: 0,
    points: [{ id: 'base', time: 0, db: -55 }] } })
  const result = buildDuckingEnvelope(music, [{ start: 1, end: 2 }])
  assert.equal(result.ok, true)
  assert.ok(result.envelope.points.every(point => point.db >= -60))
  const knee = 0.75 + 0.25 * 5 / 12
  assert.ok(result.envelope.points.some(point => Math.abs(point.time - knee) < 1e-9 && point.db === -60))
  approx(getAudioVolumeEnvelopeDb({ ...music, volumeEnvelope: result.envelope }, 0.8), -57.4)
})

test('invalid settings/activity/envelopes, no overlap, and the 128-point cap refuse a proposal', () => {
  const music = clip('music', 'music-track'), spans = [{ start: 1, end: 2 }]
  for (const patch of [{ reductionDb: 0 }, { reductionDb: Infinity }, { fadeSeconds: 0 }, { fadeSeconds: 2 }, { thresholdDb: -100 }]) {
    assert.equal(buildDuckingEnvelope(music, spans, { ...DEFAULT_DUCKING_SETTINGS, ...patch }).ok, false)
  }
  for (const spans of [[], [{ start: 1, end: 0 }], [{ start: NaN, end: 1 }], [{ start: 30, end: 31 }]]) assert.equal(buildDuckingEnvelope(music, spans).ok, false)
  assert.equal(buildDuckingEnvelope({ ...music, volumeEnvelope: { version: 2 } }, spans).ok, false)
  const full = { ...music, duration: 600, volumeEnvelope: { version: 1, offsetSeconds: 0,
    points: Array.from({ length: 128 }, (_, i) => ({ id: `existing-${i}`, time: i * 600 / 127, db: 0 })) } }
  const before = JSON.stringify(full)
  assert.match(buildDuckingEnvelope(full, spans).reason, /limit 128/)
  assert.equal(JSON.stringify(full), before)
})

test('null or malformed activity/configuration is rejected without an uncaught exception', () => {
  const music = clip('music', 'music-track')
  for (const malformed of [null, {}, 'invalid', [null]]) assert.equal(buildDuckingEnvelope(music, malformed).ok, false)
  assert.equal(buildDuckingEnvelope(music, [{ start: 1, end: 2 }], null).ok, false)
})
