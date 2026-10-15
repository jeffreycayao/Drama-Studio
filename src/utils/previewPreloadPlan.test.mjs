import assert from 'node:assert/strict'
import test from 'node:test'
import { getClipPreviewPreloadPlan } from './previewPreloadPlan.mjs'
import { getClipPlaybackTimeAtTimeline, getClipPlaybackTimingAtTimeline } from './clipPlaybackTiming.js'
import { OPTICAL_FLOW_CACHE_ENGINE, OPTICAL_FLOW_CACHE_MODEL, OPTICAL_FLOW_CACHE_VERSION,
  getOpticalFlowCacheUsability, getRequiredOpticalFlowHandleSeconds } from './frameSampling.js'

const first = (patch = {}) => ({ id: 'a', type: 'video', trackId: 'v', startTime: 0, duration: 10,
  trimStart: 2, trimEnd: 12, sourceDuration: 20, speed: 1, sourceTimeScale: 1, ...patch })
const second = (patch = {}) => ({ id: 'b', type: 'video', trackId: 'v', startTime: 10, duration: 5,
  trimStart: 3, trimEnd: 8, sourceDuration: 20, speed: 1, sourceTimeScale: 1, ...patch })
const transition = (patch = {}) => ({ id: 't', kind: 'between', clipAId: 'a', clipBId: 'b',
  duration: 2, editPoint: 10, settings: { alignment: 'center' }, ...patch })
const plan = (clip, time, patch = {}) => getClipPreviewPreloadPlan({ clip, time,
  clips: [first(), second()], transitions: [transition()], ...patch })
const active = { active: true, targetTimelineTime: null, allowHandles: false }
const upcoming = (targetTimelineTime, allowHandles = false) => ({ active: false, targetTimelineTime, allowHandles })
const sourceTime = (clip, candidate) => getClipPlaybackTimeAtTimeline(clip, candidate.targetTimelineTime, 0.01,
  { allowHandles: candidate.allowHandles })

test('active incoming handles stay compositor-owned before the nominal start', () => {
  for (const time of [9, 9.25, 9.5, 9.75, 10, 10.5]) {
    assert.deepEqual(plan(second(), time), active, `time ${time}`)
  }
})

test('forward prewarm parks at the transition entry using earlier source handles', () => {
  const clip = second()
  const candidate = plan(clip, 8)
  assert.deepEqual(candidate, upcoming(9, true))
  assert.equal(sourceTime(clip, candidate), 2)
  assert.equal(plan(clip, 6), null, 'outside lookahead')
  assert.deepEqual(plan(clip, 6.5), upcoming(9, true), 'lookahead includes its boundary')
})

test('reverse prewarm uses the outgoing transition tail and never parks active handles', () => {
  const clip = first()
  const candidate = plan(clip, 12, { playbackRate: -1 })
  assert.deepEqual(candidate, upcoming(11, true))
  assert.equal(sourceTime(clip, candidate), 13)
  for (const time of [10.75, 10.5, 10.25, 10]) {
    assert.deepEqual(plan(clip, time, { playbackRate: -1 }), active)
  }
  const exactEnd = plan(clip, 11, { playbackRate: -1 })
  assert.deepEqual(exactEnd, upcoming(11, true), 'exact reverse entry must not fall back to the nominal clip end')
  assert.equal(sourceTime(clip, exactEnd), 13)
})

test('ordinary cuts preserve nominal targets, source end epsilon and half-open windows', () => {
  const clip = second()
  assert.deepEqual(plan(clip, 9, { transitions: [] }), upcoming(10))
  assert.deepEqual(plan(clip, 10, { transitions: [] }), active)
  assert.equal(plan(clip, 15, { transitions: [] }), null)
  const candidate = plan(clip, 16, { transitions: [], playbackRate: -1 })
  assert.deepEqual(candidate, upcoming(15))
  assert.equal(sourceTime(clip, candidate), 7.99)
  assert.deepEqual(plan(clip, 15, { transitions: [], playbackRate: -1 }), upcoming(15))
})

test('alignment and normalized custom splits match the authored transition clock', () => {
  assert.deepEqual(plan(second(), 7, { transitions: [transition({ settings: { alignment: 'start' } })] }), upcoming(8, true))
  assert.deepEqual(plan(first(), 13, { playbackRate: -1,
    transitions: [transition({ settings: { alignment: 'end' } })] }), upcoming(12, true))
  assert.deepEqual(plan(second(), 7, { transitions: [transition({ settings: {
    alignment: 'end', split: { clipA: 3, clipB: 1 },
  } })] }), upcoming(8.5, true))
  assert.deepEqual(plan(second(), 7, { transitions: [transition({ settings: {
    alignment: 'start', split: { clipA: -3, clipB: 0 },
  } })] }), upcoming(8, true), 'zero clamped split falls back to alignment')
  assert.deepEqual(plan(second(), 8, { transitions: [transition({ editPoint: undefined })] }), upcoming(9, true))
})

test('unavailable handles retain the existing edge-frame clamp', () => {
  const clip = second({ trimStart: 0, trimEnd: 5, sourceDuration: 5 })
  const candidate = plan(clip, 8, { clips: [first(), clip] })
  assert.deepEqual(candidate, upcoming(9, true))
  assert.equal(sourceTime(clip, candidate), 0)
  assert.deepEqual(plan(clip, 9.25, { clips: [first(), clip] }), active)
  const unknownDuration = second({ sourceDuration: undefined })
  assert.equal(sourceTime(unknownDuration, plan(unknownDuration, 8)), 3)
})

test('retimed/reversed clips keep the same authoritative source-time mapper', () => {
  const fast = second({ speed: 2, trimStart: 5, trimEnd: 15 })
  assert.equal(sourceTime(fast, plan(fast, 8, { clips: [first(), fast] })), 3)
  const reversed = second({ reverse: true })
  assert.equal(sourceTime(reversed, plan(reversed, 8, { clips: [first(), reversed] })), 9)
})

test('long transition prewarm maps fractional-FPS RIFE handles to the cache-local clock', () => {
  const clip = second({ duration: 4, trimStart: 10, trimEnd: 12, sourceDuration: 30,
    speed: 0.5, sourceFps: 23.976, timelineFps: 24, frameSampling: 'optical-flow',
    opticalFlowCache: { version: OPTICAL_FLOW_CACHE_VERSION, engine: OPTICAL_FLOW_CACHE_ENGINE,
      modelName: OPTICAL_FLOW_CACHE_MODEL, status: 'ready', path: 'cache/optical_flow_b.mp4',
      url: 'file:///project/cache/optical_flow_b.mp4', sourceStart: 8, sourceEnd: 14,
      targetFps: 48, requestedTargetFps: 48 } })
  const clips = [first(), clip], transitions = [transition({ duration: 6 })]
  const candidate = plan(clip, 6, { clips, transitions })
  assert.deepEqual(candidate, upcoming(7, true))
  const options = { allowHandles: candidate.allowHandles,
    handleSeconds: getRequiredOpticalFlowHandleSeconds(clip, transitions, clips) }
  assert.equal(options.handleSeconds, 1.5)
  assert.equal(getOpticalFlowCacheUsability(clip, options).usable, true)
  const timing = getClipPlaybackTimingAtTimeline(clip, candidate.targetTimelineTime, 0.01, options)
  assert.equal(timing.usingOpticalFlow, true)
  assert.equal(timing.time, 0.5, 'source 8.5s is 0.5s into the cache, not nominal trim 10s')

  const shortCache = { ...clip, opticalFlowCache: { ...clip.opticalFlowCache, sourceStart: 9, sourceEnd: 13 } }
  assert.equal(getOpticalFlowCacheUsability(shortCache, options).usable, false)
  const fallback = getClipPlaybackTimingAtTimeline(shortCache, candidate.targetTimelineTime, 0.01, options)
  assert.equal(fallback.usingOpticalFlow, false)
  assert.equal(fallback.time, 8.5, 'insufficient cached handles preserve the original-source clock')
})

test('compound visibility clips nominal windows and transition handles without changing clocks', () => {
  const clip = second({ playbackWindowStart: 9.5, playbackWindowEnd: 12 })
  assert.deepEqual(plan(clip, 8.5, { clips: [first(), clip] }), upcoming(9.5, true))
  assert.equal(sourceTime(clip, plan(clip, 8.5, { clips: [first(), clip] })), 2.5)
  assert.deepEqual(plan(clip, 9.5, { clips: [first(), clip] }), active)
  assert.equal(plan(clip, 12, { clips: [first(), clip] }), null)
  assert.deepEqual(plan(clip, 13, { playbackRate: -1, clips: [first(), clip] }), upcoming(12))
  const hidden = second({ playbackWindowStart: 16, playbackWindowEnd: 17 })
  assert.equal(plan(hidden, 14, { clips: [first(), hidden] }), null)
})

test('disjoint intervals do not make the gap active or prepare an already-passed range', () => {
  const clip = second({ startTime: 20 })
  const clips = [first(), clip]
  assert.equal(plan(clip, 15, { clips, lookahead: 2.5 }), null)
  assert.deepEqual(plan(clip, 15, { clips, lookahead: 6 }), upcoming(20))
  assert.deepEqual(plan(clip, 15, { clips, playbackRate: -1, lookahead: 6 }), upcoming(11, true))
})

test('invalid, edge, cross-track, missing, and disabled-participant transitions add no handle interval', () => {
  for (const entry of [transition({ duration: 0 }), transition({ duration: Infinity }),
    transition({ kind: 'edge', clipId: 'b', edge: 'in' }), transition({ clipAId: 'missing' })]) {
    assert.deepEqual(plan(second(), 8, { transitions: [entry] }), upcoming(10))
  }
  assert.deepEqual(plan(second(), 8, { clips: [first({ trackId: 'other' }), second()] }), upcoming(10))
  assert.deepEqual(plan(second(), 8, { clips: [first({ enabled: false }), second()] }), upcoming(10))
  assert.equal(plan(second({ enabled: false }), 8), null)
})

test('optional track visibility honors hidden/muted and video-solo rules', () => {
  const tracks = [{ id: 'v', type: 'video' }]
  assert.deepEqual(plan(second(), 8, { tracks }), upcoming(9, true))
  for (const patch of [{ visible: false }, { muted: true }]) {
    assert.equal(plan(second(), 8, { tracks: [{ ...tracks[0], ...patch }] }), null)
  }
  assert.equal(plan(second(), 8, { tracks: [...tracks, { id: 'other', type: 'video', solo: true }] }), null)
  assert.equal(plan(second(), 8, { tracks: [] }), null)
})

test('fresh plans reflect later direction, edits, and entry into an active interval', () => {
  assert.deepEqual(plan(second(), 8), upcoming(9, true))
  assert.equal(plan(second(), 8, { playbackRate: -1 }), null)
  assert.deepEqual(plan(second(), 9.25), active)
  assert.deepEqual(plan(second(), 8, { transitions: [] }), upcoming(10))
  assert.equal(getClipPreviewPreloadPlan(), null)
  assert.equal(plan(second(), NaN), null)
})
