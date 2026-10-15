import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AUDIO_VOLUME_ENVELOPE_MAX_POINTS,
  normalizeAudioVolumeEnvelope, validateAudioVolumeEnvelope,
  getAudioVolumeEnvelopeDb, getAudioVolumeEnvelopeGain,
  shiftAudioVolumeEnvelope, buildAudioVolumeEnvelopeExpression,
} from './audioVolumeEnvelope.mjs'
import { buildAudioClipSplitState } from './audioClipSplit.js'
import { planSourceTimelineEdit } from './sourceTimelineEdit.mjs'

const envelope = (points = [[0, 0], [4, -12], [8, 6]], offsetSeconds = 0) => ({
  version: 1, offsetSeconds, points: points.map(([time, db], index) => ({ id: `p-${index}`, time, db })),
})
const clip = (extra = {}) => ({
  id: 'audio', trackId: 'a1', type: 'audio', startTime: 2, duration: 10,
  sourceDuration: 100, trimStart: 0, trimEnd: 10,
  volumeEnvelope: envelope(), ...extra,
})
const close = (a, b, epsilon = 1e-10) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`)
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    Object.values(value).forEach(freeze)
  }
  return value
}

test('absent and empty envelopes are neutral and do not add a legacy field during a shift', () => {
  for (const volumeEnvelope of [undefined, null, envelope([])]) {
    assert.deepEqual(normalizeAudioVolumeEnvelope(volumeEnvelope), envelope([]))
    assert.equal(getAudioVolumeEnvelopeDb({ volumeEnvelope }, 40), 0)
    assert.equal(getAudioVolumeEnvelopeGain({ volumeEnvelope }, 40), 1)
    assert.equal(buildAudioVolumeEnvelopeExpression({ volumeEnvelope }), '1')
  }
  assert.equal(shiftAudioVolumeEnvelope({}, 2), undefined)
})

test('normalization sorts and independently clones points without mutating the input', () => {
  const input = freeze(envelope([[8, 6], [-2, -6], [4, 0]], -1))
  const normalized = normalizeAudioVolumeEnvelope(input)
  assert.deepEqual(normalized.points.map(p => p.time), [-2, 4, 8])
  assert.equal(normalized.offsetSeconds, -1)
  assert.notEqual(normalized, input)
  assert.notEqual(normalized.points[0], input.points[1])
})

test('interpolates linearly in dB, not linear gain, and holds both endpoints', () => {
  const audio = clip({ volumeEnvelope: envelope([[2, -12], [6, 0]]) })
  assert.equal(getAudioVolumeEnvelopeDb(audio, -50), -12)
  assert.equal(getAudioVolumeEnvelopeDb(audio, 2), -12)
  assert.equal(getAudioVolumeEnvelopeDb(audio, 4), -6)
  assert.equal(getAudioVolumeEnvelopeDb(audio, 6), 0)
  assert.equal(getAudioVolumeEnvelopeDb(audio, 50), 0)
  close(getAudioVolumeEnvelopeGain(audio, 4), Math.pow(10, -6 / 20))
  assert.notEqual(getAudioVolumeEnvelopeGain(audio, 4), (1 + Math.pow(10, -12 / 20)) / 2)
})

test('a single point is a constant trim-independent level; -60 dB is attenuation, not mute', () => {
  const audio = clip({ volumeEnvelope: envelope([[8, -60]], 20) })
  for (const time of [-100, 0, 8, 100]) {
    assert.equal(getAudioVolumeEnvelopeDb(audio, time), -60)
    assert.equal(getAudioVolumeEnvelopeGain(audio, time), 0.001)
  }
})

test('offset is added in timeline seconds, independent of speed, reverse, FPS, or source trims', () => {
  for (const speed of [0.5, 1, 2]) for (const reverse of [false, true]) {
    const audio = clip({ speed, reverse, sourceTimeScale: 0.5, sourceFps: 48, timelineFps: 24, trimStart: 30, trimEnd: 40, volumeEnvelope: envelope([[0, 0], [8, -24]], 2) })
    assert.equal(getAudioVolumeEnvelopeDb(audio, 2), -12)
  }
})

test('head trim and reversible extension shift origin while preserving offscreen points', () => {
  const audio = freeze(clip())
  const trimmed = { ...audio, startTime: 5, duration: 7, volumeEnvelope: shiftAudioVolumeEnvelope(audio, 3) }
  assert.equal(trimmed.volumeEnvelope.offsetSeconds, 3)
  assert.deepEqual(trimmed.volumeEnvelope.points, audio.volumeEnvelope.points)
  for (const time of [0, 1, 3, 6]) close(getAudioVolumeEnvelopeDb(trimmed, time), getAudioVolumeEnvelopeDb(audio, time + 3))
  const extended = { ...trimmed, volumeEnvelope: shiftAudioVolumeEnvelope(trimmed, -3) }
  assert.deepEqual(extended.volumeEnvelope, audio.volumeEnvelope)
  const beforeOriginal = shiftAudioVolumeEnvelope(audio, -4)
  assert.equal(beforeOriginal.offsetSeconds, -4)
  assert.deepEqual(beforeOriginal.points, audio.volumeEnvelope.points)
})

test('move and source slip do not change the envelope coordinate or level', () => {
  const audio = clip()
  const moved = { ...audio, startTime: 20 }
  const slipped = { ...audio, trimStart: 5, trimEnd: 15 }
  for (const time of [0, 2, 6]) {
    assert.equal(getAudioVolumeEnvelopeDb(moved, time), getAudioVolumeEnvelopeDb(audio, time))
    assert.equal(getAudioVolumeEnvelopeDb(slipped, time), getAudioVolumeEnvelopeDb(audio, time))
  }
})

test('audio razor split carries independent envelope values, shifting only the right origin', () => {
  const audio = freeze(clip({ gainDb: -6, fadeIn: 1, fadeOut: 1, volumeEnvelope: envelope(undefined, 1) }))
  const split = buildAudioClipSplitState(audio, { type: 'audio' }, { type: 'audio' }, { left: 4, right: 6 })
  assert.equal(split.leftClipUpdates.volumeEnvelope.offsetSeconds, 1)
  assert.equal(split.rightClipOptions.volumeEnvelope.offsetSeconds, 5)
  assert.notEqual(split.leftClipUpdates.volumeEnvelope, audio.volumeEnvelope)
  const right = { ...audio, ...split.rightClipOptions }
  for (const time of [0, 1, 4]) close(getAudioVolumeEnvelopeDb(right, time), getAudioVolumeEnvelopeDb(audio, time + 4))
  assert.equal(split.rightClipOptions.gainDb, -6)
  assert.equal(split.leftClipUpdates.fadeIn, 1)
  assert.equal(split.rightClipOptions.fadeOut, 1)
})

for (const mode of ['insert', 'overwrite']) {
  test(`source ${mode} preserves retained envelope segments and does not discard hidden points`, () => {
    const audio = clip({ startTime: 0 })
    const added = { ...clip(), id: 'new', startTime: 4, duration: 2, trimEnd: 2, volumeEnvelope: undefined }
    const result = planSourceTimelineEdit({ clips: [audio], tracks: [{ id: 'a1', type: 'audio' }], fps: 24, mode, startTime: 4, duration: 2, newClips: [added] })
    assert.equal(result.ok, true, result.reason)
    const left = result.clips.find(c => c.id === audio.id)
    const right = result.clips.find(c => c.id === result.splitClipIds[0])
    assert.equal(left.volumeEnvelope.offsetSeconds, 0)
    assert.equal(right.volumeEnvelope.offsetSeconds, mode === 'insert' ? 4 : 6)
    assert.deepEqual(right.volumeEnvelope.points, audio.volumeEnvelope.points)
    for (const time of [0, 0.5, 1]) close(getAudioVolumeEnvelopeDb(right, time), getAudioVolumeEnvelopeDb(audio, time + right.volumeEnvelope.offsetSeconds))
  })
}

test('strict validation rejects malformed envelopes while read evaluation fails neutral', () => {
  const bad = [
    {}, [], 'bad', { ...envelope(), version: 2 }, { ...envelope(), offsetSeconds: NaN },
    { ...envelope(), offsetSeconds: Infinity }, { ...envelope(), offsetSeconds: '0' },
    { ...envelope(), points: null }, envelope([[0, -61]]), envelope([[0, 13]]),
    envelope([[0, NaN]]), envelope([[Infinity, 0]]), envelope([[0, 0], [0, 3]]),
    { ...envelope(), points: [{ id: 'p', time: '0', db: 0 }] },
    { ...envelope(), points: [{ id: 'p', time: 0, db: '0' }] },
    { ...envelope(), points: [{ id: ' ', time: 0, db: 0 }] },
    { ...envelope(), points: [{ id: 'p', time: 0, db: 0 }, { id: 'p', time: 1, db: 0 }] },
    envelope([[-Number.MAX_VALUE, 0], [Number.MAX_VALUE, 0]]),
  ]
  for (const volumeEnvelope of bad) {
    assert.equal(validateAudioVolumeEnvelope(volumeEnvelope).ok, false, JSON.stringify(volumeEnvelope))
    assert.deepEqual(normalizeAudioVolumeEnvelope(volumeEnvelope), envelope([]))
    assert.equal(getAudioVolumeEnvelopeGain({ volumeEnvelope }, 1), 1)
    assert.equal(buildAudioVolumeEnvelopeExpression({ volumeEnvelope }), '1')
  }
})

test('the 128-point limit is enforced without discarding or truncating authored points', () => {
  const max = envelope(Array.from({ length: AUDIO_VOLUME_ENVELOPE_MAX_POINTS }, (_, i) => [i, i % 2 ? -6 : 0]))
  assert.equal(validateAudioVolumeEnvelope(max).ok, true)
  const extra = { ...max, points: [...max.points, { id: 'extra', time: 1000, db: 1 }] }
  const result = validateAudioVolumeEnvelope(extra)
  assert.equal(result.ok, false)
  assert.match(result.reason, /128 points/)
  assert.equal(extra.points.length, 129)
})

function expressionGain(audio, time, localTimeExpression = 't') {
  const expression = buildAudioVolumeEnvelopeExpression(audio, localTimeExpression)
  return Function('t', 'pow', 'min', 'max', `return ${expression}`)(time, Math.pow, Math.min, Math.max)
}

test('FFmpeg numeric expression agrees with the JS evaluator across points, offsets, and endpoint holds', () => {
  for (const offset of [-3, 0, 2.5, 11]) {
    const audio = clip({ volumeEnvelope: envelope([[-1, -3], [0.5, 12], [2, -60], [4, -6], [8, 0]], offset) })
    for (let time = -5; time <= 16; time += 0.125) close(expressionGain(audio, time), getAudioVolumeEnvelopeGain(audio, time), 1e-9)
    for (let time = 0; time < 5; time += 0.25) close(expressionGain(audio, time, 't+2.25'), getAudioVolumeEnvelopeGain(audio, time + 2.25), 1e-9)
  }
})

test('maximum-size expression has bounded nesting and preserves evaluation agreement', () => {
  const audio = clip({ volumeEnvelope: envelope(Array.from({ length: 128 }, (_, i) => [i / 10, (i * 7) % 72 - 60])) })
  const expression = buildAudioVolumeEnvelopeExpression(audio)
  let depth = 0
  let maximum = 0
  for (const char of expression) {
    if (char === '(') maximum = Math.max(maximum, ++depth)
    if (char === ')') depth--
  }
  assert.equal(depth, 0)
  assert.ok(maximum < 12, `expression nesting ${maximum}`)
  assert.equal(expression.includes('if('), false)
  for (let time = -1; time < 14; time += 0.037) close(expressionGain(audio, time), getAudioVolumeEnvelopeGain(audio, time), 1e-9)
})

test('point IDs are never injected into the expression and caller time expressions are restricted', () => {
  const audio = clip({ volumeEnvelope: { version: 1, offsetSeconds: 0, points: [{ id: "evil');[0:a]", time: 0, db: -6 }] } })
  assert.equal(buildAudioVolumeEnvelopeExpression(audio).includes('evil'), false)
  for (const expression of ["t');evil(", 'random(1)', 't;[0:a]', 'n', 't,1']) assert.throws(() => buildAudioVolumeEnvelopeExpression(audio, expression), /Invalid/)
})

test('volume envelope remains a multiplicative layer, leaving static gain and fades untouched', () => {
  const audio = freeze(clip({ gainDb: -6, fadeIn: 2, fadeOut: 3 }))
  const before = structuredClone(audio)
  const envelopeGain = getAudioVolumeEnvelopeGain(audio, 2)
  close(envelopeGain, Math.pow(10, -6 / 20))
  assert.deepEqual(audio, before)
})
