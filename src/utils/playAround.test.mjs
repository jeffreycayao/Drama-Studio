import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlayAround, getCurrentPlayAround, stopPlayAroundPatch, PLAY_AROUND_SECONDS } from './playAround.mjs'

const state = (patch = {}) => ({
  timelineSessionId: 5, timelineFps: 24, compoundEditContext: null,
  clips: [{ id: 'shot', startTime: 0, duration: 10 }], tracks: [{ id: 'v1' }], transitions: [],
  playheadPosition: 5, isPlaying: false, playbackRate: -4, shuttleMode: true,
  loopMode: 'loop-in-out', inPoint: 4, outPoint: 6, selectedClipIds: ['shot'],
  getTimelineEndTime: () => 10, ...patch,
})
const playing = (patch = {}, centerTime = null) => {
  const value = state(patch)
  const playAround = createPlayAround(value, centerTime, 3)
  return { ...value, playAround, playheadPosition: playAround.startTime,
    isPlaying: true, playbackRate: 1, shuttleMode: false }
}

test('audition uses two seconds on each side without changing the prior transport or editorial state', () => {
  const before = state(), session = createPlayAround(before, null, 3)
  assert.equal(PLAY_AROUND_SECONDS, 2)
  assert.equal(session.token, '5:around:3')
  assert.deepEqual([session.centerTime, session.startTime, session.endTime, session.returnTime], [5, 3, 7, 5])
  assert.equal(session.previousRate, -4)
  assert.equal(session.previousShuttleMode, true)
  assert.equal(session.clips, before.clips)
  assert.equal(session.tracks, before.tracks)
  assert.equal(session.transitions, before.transitions)
  assert.equal(before.isPlaying, false)
  assert.equal(before.playheadPosition, 5)
  assert.equal(before.loopMode, 'loop-in-out')
  assert.deepEqual([before.inPoint, before.outPoint, before.selectedClipIds], [4, 6, ['shot']])
})

test('range clamps at both timeline edges and supports short timelines', () => {
  for (const [centerTime, end, range] of [[0, 10, [0, 2]], [1, 10, [0, 3]],
    [9, 10, [7, 10]], [10, 10, [8, 10]], [0.25, 0.5, [0, 0.5]]]) {
    const session = createPlayAround(state({ getTimelineEndTime: () => end }), centerTime, 1)
    assert.ok(session)
    assert.deepEqual([session.startTime, session.endTime], range)
  }
})

test('fractional-rate boundaries align to frames while the original return position remains exact', () => {
  const fps = 30000 / 1001, original = 5.0123456789
  const session = createPlayAround(state({ timelineFps: fps, playheadPosition: original }), null, 1)
  assert.equal(session.centerTime, original)
  assert.equal(session.returnTime, original)
  for (const boundary of [session.startTime, session.endTime]) {
    assert.ok(Math.abs(boundary * fps - Math.round(boundary * fps)) < 1e-9)
  }
  assert.ok(Math.abs(session.startTime - (original - 2)) <= 0.5 / fps)
  assert.ok(Math.abs(session.endTime - (original + 2)) <= 0.5 / fps)
})

test('default retrigger retains the active center and original return/rate instead of following its moving playhead', () => {
  const current = playing()
  current.playheadPosition = 6
  const next = createPlayAround(current, null, 4)
  assert.notEqual(next.token, current.playAround.token)
  assert.deepEqual([next.centerTime, next.startTime, next.endTime, next.returnTime], [5, 3, 7, 5])
  assert.equal(next.previousRate, -4)
  assert.equal(next.previousShuttleMode, true)
  const recentered = createPlayAround(current, 8, 5)
  assert.deepEqual([recentered.centerTime, recentered.startTime, recentered.endTime, recentered.returnTime], [8, 6, 10, 5])
})

test('empty, invalid and sub-frame ranges fail closed', () => {
  for (const patch of [{ clips: [] }, { getTimelineEndTime: () => 0 }, { getTimelineEndTime: () => NaN },
    { getTimelineEndTime: () => Infinity }, { getTimelineEndTime: () => 0.01 },
    { timelineFps: 0 }, { timelineFps: NaN }, { timelineFps: Infinity }, { playheadPosition: NaN }]) {
    assert.equal(createPlayAround(state(patch), 0, 1), null)
  }
  for (const centerTime of [-1, 11, NaN, Infinity, 'invalid']) {
    assert.equal(createPlayAround(state(), centerTime, 1), null)
  }
})

test('only the current source, timeline, FPS, and transport context can complete an audition', () => {
  const value = playing()
  assert.equal(getCurrentPlayAround(value), value.playAround)
  for (const patch of [{ timelineSessionId: 6 }, { compoundEditContext: {} }, { timelineFps: 30 },
    { clips: [...value.clips] }, { tracks: [...value.tracks] }, { transitions: [...value.transitions] },
    { isPlaying: false }, { playbackRate: -1 }, { playbackRate: 0.5 }, { shuttleMode: true },
    { loopMode: 'normal' }, { inPoint: 2 }, { outPoint: 9 },
    { playheadPosition: 2 }, { playheadPosition: 8 }, { playheadPosition: NaN }]) {
    assert.equal(getCurrentPlayAround({ ...value, ...patch }), null, JSON.stringify(patch))
  }
  assert.equal(getCurrentPlayAround({ ...value, playheadPosition: value.playAround.endTime }), value.playAround)
  assert.equal(getCurrentPlayAround({ ...value, selectedClipIds: [], unrelatedUi: true }), value.playAround)
  assert.equal(getCurrentPlayAround(), null)
  assert.equal(getCurrentPlayAround(state()), null)
})

test('a stale audition does not provide the center or return point of a new session', () => {
  const stale = { ...playing(), timelineSessionId: 6, playheadPosition: 8 }
  const replacement = createPlayAround(stale, null, 4)
  assert.deepEqual([replacement.centerTime, replacement.returnTime], [8, 8])
  assert.equal(replacement.previousRate, 1)
  assert.equal(replacement.previousShuttleMode, false)
  assert.notEqual(replacement.token, stale.playAround.token)
})

test('cancellation restores owned transport settings without seeking or changing a replacement transport', () => {
  const value = playing()
  assert.deepEqual(stopPlayAroundPatch(value), { playAround: null, isPlaying: false,
    playbackRate: -4, shuttleMode: true, playbackJump: null })
  for (const patch of [{ timelineSessionId: 6 }, { compoundEditContext: {} },
    { playbackRate: -1 }, { shuttleMode: true }]) {
    assert.deepEqual(stopPlayAroundPatch({ ...value, ...patch }), { playAround: null })
  }
  assert.deepEqual(stopPlayAroundPatch(state()), {})
})
