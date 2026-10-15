import assert from 'node:assert/strict'
import test from 'node:test'
import { scheduleAudioVolumeEnvelope, updatePreviewVolumeEnvelope } from './audioVolumeAutomation.mjs'

const clip = {
  startTime: 10, duration: 6,
  volumeEnvelope: { version: 1, offsetSeconds: 0, points: [
    { id: 'a', time: 0, db: 0 }, { id: 'b', time: 2, db: -20 }, { id: 'c', time: 4, db: 0 },
  ] },
}
const parameter = () => ({
  events: [],
  cancelScheduledValues(time) { this.events.push(['cancel', time]) },
  setValueAtTime(value, time) { this.events.push(['set', value, time]) },
  exponentialRampToValueAtTime(value, time) { this.events.push(['ramp', value, time]) },
})

test('audio-clock exponential ramps match linear dB interpolation', () => {
  const param = parameter()
  scheduleAudioVolumeEnvelope(param, clip, { contextTime: 3 })
  assert.deepEqual(param.events, [['cancel', 3], ['set', 1, 3], ['ramp', 0.1, 5], ['ramp', 1, 7], ['ramp', 1, 9]])
})

test('range export starts inside the envelope and stops at its visible end', () => {
  const param = parameter()
  scheduleAudioVolumeEnvelope(param, clip, { localTime: 1, contextTime: 0.5, endLocalTime: 3 })
  assert.deepEqual(param.events, [['cancel', 0.5], ['set', 10 ** -0.5, 0.5], ['ramp', 0.1, 1.5], ['ramp', 10 ** -0.5, 2.5]])
})

test('head-trim offsets and shuttle rate use timeline seconds once', () => {
  const param = parameter()
  scheduleAudioVolumeEnvelope(param, { ...clip, duration: 4, volumeEnvelope: { ...clip.volumeEnvelope, offsetSeconds: 2 } }, { contextTime: 1, playbackRate: 2 })
  assert.deepEqual(param.events, [['cancel', 1], ['set', 0.1, 1], ['ramp', 1, 2], ['ramp', 1, 3]])
})

test('pause and reverse transport cancel future ramps without scheduling new ones', () => {
  for (const options of [{ playing: false }, { playbackRate: -1 }, { playbackRate: 0 }]) {
    const param = parameter()
    scheduleAudioVolumeEnvelope(param, clip, { localTime: 2, contextTime: 3, ...options })
    assert.deepEqual(param.events, [['cancel', 3], ['set', 0.1, 3]])
  }
})

test('legacy clips are neutral and malformed values cannot reach an AudioParam', () => {
  for (const value of [undefined, { points: [{ db: NaN }] }]) {
    const param = parameter()
    scheduleAudioVolumeEnvelope(param, { duration: 2, volumeEnvelope: value })
    assert.deepEqual(param.events, [['cancel', 0], ['set', 1, 0]])
  }
})

test('ordinary preview ticks retain schedule; seek, rate, pause, envelope and context changes re-anchor', () => {
  const param = parameter()
  const entry = { envelopeGainNode: { gain: param } }
  const options = { localTime: 0, contextTime: 0, playing: true, playbackRate: 1, contextState: 'running' }
  updatePreviewVolumeEnvelope(entry, clip, options)
  const count = param.events.length
  updatePreviewVolumeEnvelope(entry, clip, { ...options, localTime: 0.02, contextTime: 0.02 })
  assert.equal(param.events.length, count)
  for (const change of [{ discontinuity: true }, { playbackRate: 2 }, { playing: false }, { contextState: 'suspended' }]) {
    const before = param.events.length
    updatePreviewVolumeEnvelope(entry, clip, { ...options, ...change })
    assert.ok(param.events.length > before)
  }
  const before = param.events.length
  updatePreviewVolumeEnvelope(entry, { ...clip, volumeEnvelope: structuredClone(clip.volumeEnvelope) }, options)
  assert.ok(param.events.length > before)
})

test('held playhead ticks and recovered clock drift re-anchor cumulatively', () => {
  const param = parameter()
  const entry = { envelopeGainNode: { gain: param } }
  const options = { localTime: 0, contextTime: 0, playing: true, playbackRate: 1, contextState: 'running' }
  updatePreviewVolumeEnvelope(entry, clip, options)
  const initial = param.events.length
  for (let tick = 1; tick <= 100; tick++) {
    updatePreviewVolumeEnvelope(entry, clip, { ...options, contextTime: tick / 100 })
  }
  assert.ok(param.events.length > initial, 'clock cannot advance the whole envelope while playhead stays behind')
  assert.ok(entry.volumeEnvelopeSchedule.anchorContextTime >= 0.9)
  const before = param.events.length
  updatePreviewVolumeEnvelope(entry, clip, { ...options, contextTime: 1, localTime: 0.5 })
  assert.ok(param.events.length > before, 'resumed timeline corrects the schedule phase')
})
