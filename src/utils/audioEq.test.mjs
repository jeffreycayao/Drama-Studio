import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_AUDIO_EQ, AUDIO_EQ_MIN_DB, AUDIO_EQ_MAX_DB,
  normalizeAudioEq, validateAudioEq, getAudioEqBands, getAudioEqCoefficients,
} from './audioEq.mjs'
import { buildAudioClipSplitState } from './audioClipSplit.js'
import { planSourceTimelineEdit } from './sourceTimelineEdit.mjs'
import { planPasteAttributes } from './pasteAttributes.js'

const eq = patch => ({ ...DEFAULT_AUDIO_EQ, ...patch })
const near = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`)
const gainAt = (coefficient, frequency, rate = 48000) => {
  const { b0, b1, b2, a0, a1, a2 } = coefficient
  const w = 2 * Math.PI * frequency / rate
  const numeratorReal = b0 + b1 * Math.cos(w) + b2 * Math.cos(2 * w)
  const numeratorImaginary = -b1 * Math.sin(w) - b2 * Math.sin(2 * w)
  const denominatorReal = a0 + a1 * Math.cos(w) + a2 * Math.cos(2 * w)
  const denominatorImaginary = -a1 * Math.sin(w) - a2 * Math.sin(2 * w)
  return Math.hypot(numeratorReal, numeratorImaginary) / Math.hypot(denominatorReal, denominatorImaginary)
}
const dbAt = (coefficient, frequency, rate) => 20 * Math.log10(gainAt(coefficient, frequency, rate))
const audio = (id = 'audio', patch = {}) => ({
  id, name: id, trackId: 'a1', type: 'audio', assetId: 'tone', startTime: 0, duration: 8,
  trimStart: 0, trimEnd: 8, sourceDuration: 20, gainDb: -4, fadeIn: 0, fadeOut: 0,
  ...patch,
})

test('absent and malformed read data are flat; canonical defaults are independent', () => {
  for (const value of [undefined, null, {}, [], 'bad', { version: 2 }]) {
    assert.deepEqual(normalizeAudioEq(value), DEFAULT_AUDIO_EQ)
    assert.deepEqual(getAudioEqBands(value), [])
    assert.deepEqual(getAudioEqCoefficients(value), [])
  }
  const normalized = normalizeAudioEq(null)
  normalized.bassDb = 6
  assert.equal(DEFAULT_AUDIO_EQ.bassDb, 0)
  assert.equal(normalizeAudioEq(null).bassDb, 0)
})

test('strict authoring validates all booleans, version, finite gain ranges without coercion', () => {
  for (const patch of [
    { version: '1' }, { version: 2 }, { enabled: 1 }, { enabled: null }, { lowCut: 'false' },
    { bassDb: -12.01 }, { midDb: 12.01 }, { trebleDb: NaN }, { bassDb: Infinity },
    { midDb: '-3' }, { trebleDb: undefined },
  ]) {
    const input = eq(patch)
    const result = validateAudioEq(input)
    assert.equal(result.ok, false)
    assert.ok(result.reason)
    assert.deepEqual(normalizeAudioEq(input), DEFAULT_AUDIO_EQ)
  }
  assert.equal(validateAudioEq(eq({ bassDb: AUDIO_EQ_MIN_DB, midDb: AUDIO_EQ_MAX_DB, trebleDb: -2.25 })).ok, true)
})

test('normalization preserves bypassed settings without mutating or aliasing input', () => {
  const original = Object.freeze(eq({ enabled: false, lowCut: true, bassDb: 6, midDb: -3, trebleDb: 9 }))
  const normalized = normalizeAudioEq(original)
  assert.deepEqual(normalized, original)
  assert.notEqual(normalized, original)
  assert.deepEqual(getAudioEqBands(normalized), [])
  assert.deepEqual(getAudioEqCoefficients(normalized), [])
})

test('active bands are fixed and ordered with correct Web Audio Q units', () => {
  const bands = getAudioEqBands(eq({ lowCut: true, bassDb: 6, midDb: -3, trebleDb: 9 }))
  assert.deepEqual(bands.map(({ id, type, frequency, gain }) => ({ id, type, frequency, gain })), [
    { id: 'lowCut', type: 'highpass', frequency: 80, gain: 0 },
    { id: 'bass', type: 'lowshelf', frequency: 120, gain: 6 },
    { id: 'mid', type: 'peaking', frequency: 1000, gain: -3 },
    { id: 'treble', type: 'highshelf', frequency: 5000, gain: 9 },
  ])
  near(bands[0].Q, -3.010299956639812)
  near(10 ** (bands[0].Q / 20), Math.SQRT1_2)
  assert.equal(bands[2].Q, 1)
  assert.deepEqual(getAudioEqBands(eq({ midDb: 4 })).map(band => band.id), ['mid'])
})

test('low sample rates cap fixed frequencies below Nyquist and invalid rates fall back safely', () => {
  const settings = eq({ lowCut: true, bassDb: 1, midDb: 1, trebleDb: 1 })
  assert.equal(getAudioEqBands(settings, 8000).find(band => band.id === 'treble').frequency, 3600)
  for (const rate of [1000, 4000, 8000, 16000, 44100, 48000, 96000, 192000, 768000]) {
    assert.ok(getAudioEqBands(settings, rate).every(band => band.frequency > 0 && band.frequency < rate / 2))
  }
  for (const rate of [undefined, null, 0, -1, NaN, Infinity, '48000', Number.MAX_VALUE]) {
    assert.deepEqual(getAudioEqBands(settings, rate), getAudioEqBands(settings, 48000))
  }
})

test('all coefficient cases are finite, normalized, and strictly stable', () => {
  for (const rate of [1000, 8000, 16000, 44100, 48000, 96000, 192000, 768000]) {
    for (const gain of [-12, -6, -0.1, 0.1, 6, 12]) {
      const coefficients = getAudioEqCoefficients(eq({ lowCut: true, bassDb: gain, midDb: gain, trebleDb: gain }), rate)
      assert.equal(coefficients.length, 4)
      for (const filter of coefficients) {
        for (const key of ['a0', 'a1', 'a2', 'b0', 'b1', 'b2']) assert.ok(Number.isFinite(filter[key]), `${key}: ${JSON.stringify(filter)}`)
        assert.equal(filter.a0, 1)
        // Second-order Jury stability criterion: both poles strictly inside
        // the unit circle, including near-Nyquist clamped low-rate bands.
        assert.ok(1 + filter.a1 + filter.a2 > 0)
        assert.ok(1 - filter.a1 + filter.a2 > 0)
        assert.ok(1 - filter.a2 > 0)
      }
    }
  }
})

test('Butterworth highpass has -3.0103 dB at 80 Hz, rejects DC, and tends to unity above cutoff', () => {
  for (const rate of [8000, 16000, 44100, 48000, 96000]) {
    const [filter] = getAudioEqCoefficients(eq({ lowCut: true }), rate)
    near(gainAt(filter, 0, rate), 0)
    near(dbAt(filter, 80, rate), 20 * Math.log10(Math.SQRT1_2), 1e-7)
    near(gainAt(filter, rate / 2, rate), 1)
    assert.ok(dbAt(filter, 8, rate) < -39.9)
    assert.ok(Math.abs(dbAt(filter, 1000, rate)) < 0.01)
  }
})

test('peaking EQ matches the requested gain at 1 kHz and unity at DC/Nyquist', () => {
  for (const rate of [8000, 16000, 44100, 48000, 96000]) for (const gain of [-12, -6, 0.25, 6, 12]) {
    const [filter] = getAudioEqCoefficients(eq({ midDb: gain }), rate)
    near(dbAt(filter, 1000, rate), gain)
    near(gainAt(filter, 0, rate), 1)
    near(gainAt(filter, rate / 2, rate), 1)
  }
})

test('S=1 shelves have endpoint gains and half the selected dB at their midpoint frequency', () => {
  for (const rate of [8000, 16000, 44100, 48000, 96000]) for (const gain of [-12, -6, 0.25, 6, 12]) {
    for (const field of ['bassDb', 'trebleDb']) {
      const settings = eq({ [field]: gain })
      const [filter] = getAudioEqCoefficients(settings, rate)
      const [band] = getAudioEqBands(settings, rate)
      const dcGain = field === 'bassDb' ? gain : 0
      const nyquistGain = field === 'bassDb' ? 0 : gain
      near(dbAt(filter, 0, rate), dcGain, 1e-6)
      near(dbAt(filter, rate / 2, rate), nyquistGain, 1e-6)
      near(dbAt(filter, band.frequency, rate), gain / 2, 1e-6)
    }
  }
})

test('boost and matching cut cancel across the spectrum for each shelf and peak', () => {
  for (const rate of [8000, 48000, 96000]) for (const field of ['bassDb', 'midDb', 'trebleDb']) {
    const [boost] = getAudioEqCoefficients(eq({ [field]: 9 }), rate)
    const [cut] = getAudioEqCoefficients(eq({ [field]: -9 }), rate)
    for (const fraction of [0, 0.0001, 0.001, 0.01, 0.05, 0.1, 0.2, 0.4, 0.4999, 0.5]) {
      near(gainAt(boost, rate * fraction, rate) * gainAt(cut, rate * fraction, rate), 1, 1e-7)
    }
  }
})

test('EQ coefficients and normalization never alter the source object', () => {
  const settings = Object.freeze(eq({ lowCut: true, bassDb: 12, midDb: -12, trebleDb: 6 }))
  const before = { ...settings }
  getAudioEqBands(settings)
  getAudioEqCoefficients(settings)
  assert.deepEqual(settings, before)
})

test('audio razor split copies EQ independently to both pieces without disturbing envelope/gain/fades', () => {
  const original = audio('a', { audioEq: Object.freeze(eq({ enabled: false, lowCut: true, bassDb: 3 })),
    volumeEnvelope: { version: 1, offsetSeconds: 2, points: [{ id: 'p', time: 0, db: -6 }] }, fadeIn: 1, fadeOut: 1 })
  const result = buildAudioClipSplitState(original, { type: 'audio' }, { type: 'audio' }, { left: 3, right: 5 })
  assert.deepEqual(result.leftClipUpdates.audioEq, original.audioEq)
  assert.deepEqual(result.rightClipOptions.audioEq, original.audioEq)
  assert.notEqual(result.leftClipUpdates.audioEq, original.audioEq)
  assert.notEqual(result.rightClipOptions.audioEq, original.audioEq)
  assert.notEqual(result.leftClipUpdates.audioEq, result.rightClipOptions.audioEq)
  assert.equal(result.rightClipOptions.volumeEnvelope.offsetSeconds, 5)
  assert.equal(result.rightClipOptions.gainDb, -4)
  assert.equal(result.leftClipUpdates.fadeIn, 1)
  assert.equal(result.rightClipOptions.fadeOut, 1)
  assert.equal(Object.hasOwn(buildAudioClipSplitState(audio(), { type: 'audio' }, {}, { left: 3, right: 5 }).rightClipOptions, 'audioEq'), false)
})

test('source insert and overwrite keep EQ on all retained pieces without treating it as animation', () => {
  for (const mode of ['insert', 'overwrite']) {
    const original = audio('a', { audioEq: eq({ lowCut: true, midDb: -3 }) })
    const result = planSourceTimelineEdit({ mode, clips: [original], tracks: [{ id: 'a1', type: 'audio' }],
      fps: 24, startTime: 3, duration: 2, newClips: [audio('new', { startTime: 3, duration: 2, trimEnd: 2 })] })
    assert.equal(result.ok, true, result.reason)
    for (const retained of result.clips.filter(clip => clip.id !== 'new')) assert.deepEqual(retained.audioEq, original.audioEq)
  }
})

test('static Audio Paste Attributes keeps destination EQ and envelope untouched', () => {
  const source = audio('source', { gainDb: -8, audioEq: eq({ bassDb: 12 }) })
  const target = audio('target', { audioEq: eq({ enabled: false, midDb: -6 }), volumeEnvelope: { version: 1, offsetSeconds: 0, points: [] } })
  const state = { clips: [source, target], tracks: [{ id: 'a1', type: 'audio' }], selectedClipIds: ['target'] }
  const result = planPasteAttributes(state, { source, clipIds: ['target'], groups: ['audio'] })
  assert.equal(result.ok, true, result.error)
  const updated = result.clips.find(clip => clip.id === 'target')
  assert.equal(updated.gainDb, source.gainDb)
  assert.deepEqual(updated.audioEq, target.audioEq)
  assert.equal(updated.volumeEnvelope, target.volumeEnvelope)
})
