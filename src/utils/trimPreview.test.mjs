import assert from 'node:assert/strict'
import test from 'node:test'

import { createMultiClipTrimSession, resolveMultiClipTrim } from './multiClipTrim.mjs'
import { buildTrimPreviewFeedback, getTrimPreviewTimelineTime } from './trimPreview.mjs'

const makeClip = (overrides = {}) => ({
  id: 'a', type: 'video', trackId: 'v1', startTime: 5, duration: 10,
  trimStart: 2, trimEnd: 12, sourceDuration: 20, sourceTimeScale: 1, speed: 1,
  ...overrides,
})

const makeSession = (clips, edge = 'right', options = {}) => createMultiClipTrimSession({
  clips, edge, targetClipIds: [clips[0].id], primaryClipId: clips[0].id, fps: 24, ...options,
})

const feedbackFor = (clips, session, requestedDelta, { fps = 24, quantize = true } = {}) => {
  const resolution = resolveMultiClipTrim(session, requestedDelta)
  const current = clips.map((clip) => {
    const update = resolution.updates.find((entry) => entry.id === clip.id)
    if (!update) return clip
    const next = { ...clip, ...update.updates }
    if (quantize) {
      next.startTime = Math.round(next.startTime * fps) / fps
      next.duration = Math.max(1, Math.round(next.duration * fps)) / fps
    }
    return next
  })
  return buildTrimPreviewFeedback({ session, clips: current, requestedDelta, fps })
}

test('head feedback shows actual first retained frame and opposite duration delta', () => {
  const clips = [makeClip()]
  const feedback = feedbackFor(clips, makeSession(clips, 'left'), 2)
  assert.equal(feedback.edge, 'left')
  assert.equal(feedback.edgeTime, 7)
  assert.equal(feedback.timelineTime, 7)
  assert.equal(feedback.duration, 8)
  assert.equal(feedback.deltaFrames, 48)
  assert.equal(feedback.durationDeltaFrames, -48)
  assert.equal(feedback.affectedCount, 1)
  assert.equal(feedback.limit, null)
})

test('tail timecode is end boundary while preview is last retained timeline frame', () => {
  const clips = [makeClip()]
  const feedback = feedbackFor(clips, makeSession(clips), -2)
  assert.equal(feedback.edgeTime, 13)
  assert.equal(feedback.timelineTime, 13 - (1 / 24))
  assert.equal(feedback.deltaFrames, -48)
  assert.equal(feedback.durationDeltaFrames, -48)
  assert.equal(feedback.limit, null)
})

test('reads the updated store clip rather than calculating time from pointer delta', () => {
  const clips = [makeClip()]
  const session = makeSession(clips)
  const current = { ...clips[0], duration: 11 }
  const feedback = buildTrimPreviewFeedback({ session, clips: [current], requestedDelta: 1.013, fps: 24 })
  assert.equal(feedback.clip, current)
  assert.equal(feedback.edgeTime, 16)
  assert.equal(feedback.deltaFrames, 24)
  assert.equal(feedback.durationDeltaFrames, 24)
})

test('preview keeps fractional project frame rate precision at exact frame boundaries', () => {
  const fps = 30000 / 1001
  const clip = makeClip({ startTime: 30 / fps, duration: 91 / fps })
  assert.equal(getTrimPreviewTimelineTime(clip, 'left', fps), 30 / fps)
  assert.equal(getTrimPreviewTimelineTime(clip, 'right', fps), 120 / fps)
  const session = makeSession([clip], 'right', { fps })
  const feedback = feedbackFor([clip], session, 3 / fps, { fps })
  assert.equal(feedback.deltaFrames, 3)
  assert.equal(feedback.durationDeltaFrames, 3)
  assert.equal(feedback.timelineTime, 123 / fps)
})

test('tail preview uses last timeline grid frame for sub-frame legacy boundaries', () => {
  const clip = makeClip({ startTime: 2.003, duration: 1.01 })
  assert.equal(getTrimPreviewTimelineTime(clip, 'left', 24), 2.003)
  assert.equal(getTrimPreviewTimelineTime(clip, 'right', 24), 3)
  const underOneFrame = makeClip({ startTime: 2.003, duration: 0.003 })
  assert.equal(getTrimPreviewTimelineTime(underOneFrame, 'right', 24), 2.003)
})

test('exact one-frame tail previews that one frame, never the excluded next frame', () => {
  for (const fps of [24, 25, 30000 / 1001, 60000 / 1001]) {
    const clip = makeClip({ startTime: 49 / fps, duration: 1 / fps })
    assert.equal(getTrimPreviewTimelineTime(clip, 'right', fps), clip.startTime)
  }
})

test('source end limit identifies the stricter other selected clip', () => {
  const clips = [makeClip(), makeClip({ id: 'b', trackId: 'v2', sourceDuration: 12.5 })]
  const session = makeSession(clips, 'right', { targetClipIds: ['a', 'b'] })
  const feedback = feedbackFor(clips, session, 4)
  assert.equal(feedback.deltaFrames, 12)
  assert.equal(feedback.affectedCount, 2)
  assert.deepEqual(feedback.limit, { kind: 'source-end', label: 'Source end reached', clipId: 'b' })
})

test('source start limit follows source time scale and other selected clip', () => {
  const clips = [makeClip(), makeClip({ id: 'b', trackId: 'v2', trimStart: 0.5, sourceTimeScale: 2 })]
  const session = makeSession(clips, 'left', { targetClipIds: ['a', 'b'] })
  const feedback = feedbackFor(clips, session, -2)
  assert.equal(feedback.deltaFrames, -6)
  assert.equal(feedback.durationDeltaFrames, 6)
  assert.equal(feedback.limit.kind, 'source-start')
  assert.equal(feedback.limit.clipId, 'b')
})

test('right neighbor limit is not mislabeled as exhausted media', () => {
  const clips = [makeClip(), makeClip({ id: 'next', startTime: 16, duration: 2 })]
  const feedback = feedbackFor(clips, makeSession(clips), 4)
  assert.equal(feedback.deltaFrames, 24)
  assert.equal(feedback.limit.kind, 'neighbor')
  assert.equal(feedback.limit.clipId, 'a')
})

test('left neighbor on another selected track owns the shared limit', () => {
  const clips = [
    makeClip(), makeClip({ id: 'b', trackId: 'v2' }),
    makeClip({ id: 'previous', trackId: 'v2', startTime: 0, duration: 4 }),
  ]
  const session = makeSession(clips, 'left', { targetClipIds: ['a', 'b'] })
  const feedback = feedbackFor(clips, session, -2)
  assert.equal(feedback.deltaFrames, -24)
  assert.equal(feedback.limit.kind, 'neighbor')
  assert.equal(feedback.limit.clipId, 'b')
})

test('coincident neighbor and source end stops prefer the neighbor explanation', () => {
  const clips = [makeClip({ sourceDuration: 13 }), makeClip({ id: 'next', startTime: 16, duration: 2 })]
  const feedback = feedbackFor(clips, makeSession(clips), 4)
  assert.equal(feedback.limit.kind, 'neighbor')
})

test('head and tail shortening identify minimum one-frame duration', () => {
  const clips = [makeClip({ duration: 1, trimEnd: 3 })]
  for (const edge of ['left', 'right']) {
    const feedback = feedbackFor(clips, makeSession(clips, edge), edge === 'left' ? 10 : -10)
    assert.equal(feedback.duration, 1 / 24)
    assert.equal(feedback.durationDeltaFrames, -23)
    assert.equal(feedback.limit.kind, 'minimum-duration')
  }
})

test('generators extend without source bounds and report timeline start correctly', () => {
  for (const type of ['image', 'text', 'shape', 'adjustment', 'captions']) {
    const clips = [makeClip({ type, sourceDuration: 1, trimStart: 0 })]
    const tailSession = makeSession(clips)
    assert.equal(tailSession.maximumDelta, Infinity)
    assert.equal(feedbackFor(clips, tailSession, 100).limit, null)
    const headFeedback = feedbackFor(clips, makeSession(clips, 'left'), -100)
    assert.equal(headFeedback.edgeTime, 0)
    assert.equal(headFeedback.limit.kind, 'timeline-start')
  }
})

test('unknown media extent fallback is not presented as a known source end', () => {
  const clips = [makeClip({ sourceDuration: undefined })]
  const feedback = feedbackFor(clips, makeSession(clips), 1)
  assert.equal(feedback.limit.kind, 'source-limit')
  assert.equal(feedback.deltaFrames, 0)
  for (const sourceDuration of [Infinity, 'Infinity']) {
    const infiniteClips = [makeClip({ sourceDuration })]
    assert.equal(feedbackFor(infiniteClips, makeSession(infiniteClips), 100).limit, null)
  }
})

test('snapped pointer exactly at a source limit displays the limit', () => {
  const clips = [makeClip({ sourceDuration: 12.5 })]
  assert.equal(feedbackFor(clips, makeSession(clips), 0.5).limit.kind, 'source-end')
})

test('frame quantization near a bound needs a real pointer attempt to display limit', () => {
  const clips = [makeClip({ sourceDuration: 12.51 })]
  const session = makeSession(clips)
  assert.equal(feedbackFor(clips, session, 0.49).limit, null)
  assert.equal(feedbackFor(clips, session, 0.6).limit.kind, 'source-end')
  const unchanged = buildTrimPreviewFeedback({ session, clips, requestedDelta: 0.6, fps: 24 })
  assert.equal(unchanged.limit, null, 'a stale/non-updated edge cannot claim it reached the requested bound')
})

test('zero movement at an existing source limit stays a neutral zero-frame preview', () => {
  const clips = [makeClip({ sourceDuration: 12, trimStart: 0, trimEnd: 10 })]
  const session = makeSession(clips, 'left')
  const feedback = feedbackFor(clips, session, 0)
  assert.equal(feedback.deltaFrames, 0)
  assert.equal(Object.is(feedback.deltaFrames, -0), false)
  assert.equal(feedback.durationDeltaFrames, 0)
  assert.equal(feedback.limit, null)
  assert.equal(feedbackFor(clips, session, -0.01).limit.kind, 'source-start')
})

test('source-floor normalization at 24fps reports the final legal .5-second extension of a .53 handle', () => {
  const clips = [makeClip({ sourceDuration: 12.53 })]
  const session = makeSession(clips)
  const current = [{ ...clips[0], duration: 10.5, trimEnd: 12.5 }]
  const feedback = buildTrimPreviewFeedback({ session, clips: current, requestedDelta: 0.6, fps: 24 })
  assert.equal(feedback.deltaFrames, 12)
  assert.equal(feedback.limit.kind, 'source-end')
  assert.equal(buildTrimPreviewFeedback({ session, clips: current, requestedDelta: 0.51, fps: 24 }).limit, null)
  const overshot = [{ ...current[0], duration: 10.56 }]
  assert.equal(buildTrimPreviewFeedback({ session, clips: overshot, requestedDelta: 0.6, fps: 24 }).limit, null)
})

test('source-floor proximity exception covers unknown extent but not neighboring clip limits', () => {
  const clips = [makeClip({ sourceDuration: undefined, trimEnd: 12.53 })]
  const current = [{ ...clips[0], duration: 10.5, trimEnd: 12.5 }]
  const feedback = buildTrimPreviewFeedback({ session: makeSession(clips), clips: current, requestedDelta: 0.6, fps: 24 })
  assert.equal(feedback.limit.kind, 'source-limit')
  const withNeighbor = [makeClip(), makeClip({ id: 'next', startTime: 15.53, duration: 2 })]
  const currentWithNeighbor = [{ ...withNeighbor[0], duration: 10.5 }, withNeighbor[1]]
  const neighborFeedback = buildTrimPreviewFeedback({ session: makeSession(withNeighbor), clips: currentWithNeighbor, requestedDelta: 0.6, fps: 24 })
  assert.equal(neighborFeedback.limit, null)
})

test('defensively rejects missing/duplicate targets and invalid primary timing', () => {
  const clips = [makeClip()]
  const session = makeSession(clips)
  assert.equal(buildTrimPreviewFeedback(), null)
  assert.equal(buildTrimPreviewFeedback({ session, clips: [] }), null)
  assert.equal(buildTrimPreviewFeedback({ session, clips: [...clips, ...clips] }), null)
  assert.equal(buildTrimPreviewFeedback({ session: { ...session, edge: 'center' }, clips }), null)
  assert.equal(buildTrimPreviewFeedback({ session: { ...session, snapshots: [null] }, clips }), null)
  assert.equal(buildTrimPreviewFeedback({ session: { ...session, targetClipIds: ['a', 'a'] }, clips }), null)
  assert.equal(buildTrimPreviewFeedback({ session, clips: [makeClip({ duration: NaN })] }), null)
  assert.equal(buildTrimPreviewFeedback({ session, clips: [makeClip({ startTime: -1 })] }), null)
  assert.equal(getTrimPreviewTimelineTime(makeClip({ duration: 0 }), 'right'), null)
})

test('metadata-free legacy sessions still produce neutral timing feedback', () => {
  const clips = [makeClip({ sourceDuration: 12.5 })]
  const session = makeSession(clips)
  delete session.limitConstraints
  const feedback = feedbackFor(clips, session, 2)
  assert.equal(feedback.deltaFrames, 12)
  assert.equal(feedback.limit, null)
})

test('feedback and metadata never mutate clips, snapshots, or constraint ordering', () => {
  const clips = [makeClip({ sourceDuration: 13 }), makeClip({ id: 'next', startTime: 16, duration: 2 })]
  const session = makeSession(clips)
  const clipsBefore = structuredClone(clips)
  const sessionBefore = structuredClone(session)
  feedbackFor(clips, session, 10)
  feedbackFor(clips, session, -10)
  assert.deepEqual(clips, clipsBefore)
  assert.deepEqual(session, sessionBefore)
})
