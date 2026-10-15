import test from 'node:test'
import assert from 'node:assert/strict'
import { holdAudioPreviewEntry } from './audioPlaybackHold.mjs'
import { updatePreviewVolumeEnvelope } from './audioVolumeAutomation.mjs'

function fixture(patch = {}) {
  const calls = []
  const clip = { startTime: 2, duration: 8, trimStart: 1, trimEnd: 9, sourceDuration: 12,
    sourceTimeScale: 1, speed: 1,
    volumeEnvelope: { version: 1, offsetSeconds: 0,
      points: [{ id: 'a', time: 0, db: -12 }, { id: 'b', time: 8, db: 0 }] } }
  const param = {
    cancelScheduledValues(time) { calls.push(['cancel', time]) },
    setValueAtTime(value, time) { calls.push(['set', value, time]) },
    exponentialRampToValueAtTime(value, time) { calls.push(['ramp', value, time]) },
  }
  const entry = {
    clip, disposed: false, desiredPlaying: true, generation: 7,
    element: { paused: false, src: 'blob:synthetic-audio', pause() { this.paused = true; calls.push(['pause']) } },
    positionPrepared: true, startAlignmentAttempts: 1, pendingSeekTarget: null,
    seekInFlight: false, seekTarget: null,
    playPromise: Promise.resolve(), removeSourceListeners() {},
    envelopeGainNode: { gain: param }, ...patch,
  }
  return { entry, calls, clip }
}

test('a playback-jump hold pauses immediately without invalidating the media source or pending play promise', () => {
  const { entry, calls } = fixture()
  const { playPromise, removeSourceListeners } = entry
  holdAudioPreviewEntry(entry, { timelineTime: 5, contextTime: 20, playbackRate: 1, resetPosition: true })
  assert.equal(entry.desiredPlaying, false)
  assert.equal(entry.element.paused, true)
  assert.equal(entry.pendingSeekTarget, 4)
  assert.equal(entry.positionPrepared, false)
  assert.equal(entry.startAlignmentAttempts, 0)
  assert.equal(entry.generation, 7)
  assert.equal(entry.playPromise, playPromise)
  assert.equal(entry.removeSourceListeners, removeSourceListeners)
  assert.equal(entry.element.src, 'blob:synthetic-audio')
  assert.equal(calls.filter(call => call[0] === 'pause').length, 1)
  assert.deepEqual(calls.filter(call => call[0] === 'cancel'), [['cancel', 20]])
  assert.equal(calls.some(call => call[0] === 'ramp'), false)
})

test('a newer jump replaces the queued target without starting a second in-flight seek', () => {
  const { entry, calls } = fixture({ seekInFlight: true, seekTarget: 6 })
  holdAudioPreviewEntry(entry, { timelineTime: 5, contextTime: 20, resetPosition: true })
  holdAudioPreviewEntry(entry, { timelineTime: 3, contextTime: 20.1, resetPosition: true })
  assert.equal(entry.pendingSeekTarget, 2)
  assert.equal(entry.seekInFlight, true)
  assert.equal(entry.seekTarget, 6)
  assert.equal(entry.positionPrepared, false)
  assert.equal(entry.desiredPlaying, false)
  assert.equal(calls.filter(call => call[0] === 'pause').length, 1)
})

test('pause cancels future audio automation without inventing another source seek', () => {
  const { entry, calls } = fixture({ pendingSeekTarget: 4 })
  holdAudioPreviewEntry(entry, { timelineTime: 5, contextTime: 20, resetPosition: false })
  assert.equal(entry.desiredPlaying, false)
  assert.equal(entry.pendingSeekTarget, 4)
  assert.equal(entry.positionPrepared, true)
  assert.equal(entry.volumeEnvelopeSchedule.playing, false)
  assert.equal(entry.volumeEnvelopeSchedule.anchorLocalTime, 3)
  assert.deepEqual(calls.filter(call => call[0] === 'cancel'), [['cancel', 20]])
})

test('releasing a long hold schedules from the newest target and current audio clock', () => {
  const { entry, clip, calls } = fixture()
  updatePreviewVolumeEnvelope(entry, clip, {
    localTime: 6, contextTime: 10, playbackRate: 1, playing: true, contextState: 'running',
  })
  holdAudioPreviewEntry(entry, { timelineTime: 5, contextTime: 11, playbackRate: 1,
    contextState: 'running', resetPosition: true })
  holdAudioPreviewEntry(entry, { timelineTime: 3, contextTime: 11.1, playbackRate: 1,
    contextState: 'running', resetPosition: true })
  const beforeRelease = calls.length
  updatePreviewVolumeEnvelope(entry, clip, {
    localTime: 1, contextTime: 14, playbackRate: 1, playing: true, contextState: 'running',
  })
  assert.deepEqual(calls.slice(beforeRelease).filter(call => call[0] === 'cancel'), [['cancel', 14]])
  assert.equal(entry.volumeEnvelopeSchedule.anchorLocalTime, 1)
  assert.equal(entry.volumeEnvelopeSchedule.anchorContextTime, 14)
  assert.equal(entry.volumeEnvelopeSchedule.playing, true)
  assert.equal(calls.slice(beforeRelease).filter(call => call[0] === 'ramp').at(-1)[2], 21)
})

test('an already disposed entry cannot be revived or scheduled by a transport hold', () => {
  const { entry, calls } = fixture({ disposed: true })
  holdAudioPreviewEntry(entry, { timelineTime: 5, contextTime: 20, resetPosition: true })
  assert.deepEqual(calls, [])
  assert.equal(entry.pendingSeekTarget, null)
})
