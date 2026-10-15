import test from 'node:test'
import assert from 'node:assert/strict'
import { createSlipEditSession, planSlipEdit, buildSlipEditPreviewFeedback } from './slipEdit.mjs'
import { getClipPlaybackTimingAtTimeline } from './clipPlaybackTiming.js'

const media = patch => ({ id: 'clip', type: 'video', trackId: 'v', startTime: 2, duration: 3,
  trimStart: 2, trimEnd: 5, sourceDuration: 10, speed: 1, sourceTimeScale: 1,
  sourceFps: 24, timelineFps: 24, reverse: false, ...patch })
const input = patch => ({ clips: [media(), media({ id: 'neighbor', startTime: 5 })],
  tracks: [{ id: 'v', type: 'video' }], clipId: 'clip', fps: 10, ...patch })
const begin = options => {
  const result = createSlipEditSession(options || input())
  assert.equal(result.ok, true, result.reason)
  return result.session
}
const slip = (session, requestedDelta) => {
  const result = planSlipEdit({ session, requestedDelta })
  assert.equal(result.ok, true, result.reason)
  return result
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`)

test('slips only the target source trims and never mutates frozen inputs or neighbor references', () => {
  const options = input()
  const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze) } return value }
  freeze(options)
  const session = begin(options), result = slip(session, .35)
  assert.equal(result.delta, .4)
  assert.equal(result.clips[0].trimStart, 2.4)
  assert.equal(result.clips[0].trimEnd, 5.4)
  assert.equal(result.clips[1], options.clips[1])
  for (const key of Object.keys(options.clips[0]).filter(key => !['trimStart', 'trimEnd'].includes(key))) assert.equal(result.clips[0][key], options.clips[0][key])
  assert.equal(slip(session, 0).clips, options.clips)
  assert.equal(result.feedback.first.clip, result.clips[0])
  assert.equal(result.feedback.last.clip, result.clips[0])
  assert.equal(result.feedback.first.timelineTime, 2)
  assert.equal(result.feedback.last.timelineTime, 4.9)
})

test('positive and negative Slip preserve direction and source offset at every retained frame, including reverse and fractional FPS', () => {
  for (const fps of [24, 30, 24000 / 1001, 30000 / 1001]) for (const speed of [.5, 1, 2]) for (const reverse of [false, true]) {
    for (const baseScale of [.5, 1, 1.25]) for (const direction of [-1, 1]) {
      const type = baseScale === 1 ? 'video' : 'audio', timeScale = speed * baseScale
      const clip = media({ type, startTime: 24 / fps, duration: 72 / fps, trimStart: 10,
        trimEnd: 10 + 72 / fps * timeScale, sourceDuration: 100, speed, reverse, sourceTimeScale: baseScale })
      const session = begin(input({ clips: [clip], fps, tracks: [{ id: 'v', type: type === 'audio' ? 'audio' : 'video' }] }))
      const result = slip(session, direction * 12 / fps), after = result.clips[0]
      const sourceDelta = direction * 12 / fps * timeScale
      close(after.trimStart - clip.trimStart, sourceDelta)
      close(after.trimEnd - clip.trimEnd, sourceDelta)
      for (let frame = 0; frame < 72; frame++) {
        const time = clip.startTime + frame / fps
        for (const endOffset of [0, .01]) {
          const beforeTiming = getClipPlaybackTimingAtTimeline(clip, time, endOffset, { useFrameSampling: false })
          const afterTiming = getClipPlaybackTimingAtTimeline(after, time, endOffset, { useFrameSampling: false })
          close(afterTiming.rawTime - beforeTiming.rawTime, sourceDelta)
          close(afterTiming.time - beforeTiming.time, sourceDelta)
        }
      }
      assert.equal(result.feedback.deltaFrames, direction * 12)
      close(result.feedback.sourceDelta, sourceDelta)
      assert.equal(after.startTime, clip.startTime); assert.equal(after.duration, clip.duration)
    }
  }
})

test('audio implicit FPS source ratio remains supported without materializing different metadata', () => {
  const clip = media({ type: 'audio', sourceTimeScale: undefined, sourceFps: 48, timelineFps: 24, trimEnd: 3.5 })
  const result = slip(begin(input({ clips: [clip], tracks: [{ id: 'v', type: 'audio' }] })), .4)
  close(result.clips[0].trimStart, 2.2); close(result.clips[0].trimEnd, 3.7)
  assert.equal(result.clips[0].sourceTimeScale, undefined)
})

test('first and last preview clocks are distinct retained frames of the actual clip, one-frame clips use the same frame', () => {
  for (const fps of [24, 30, 30000 / 1001]) {
    for (const frames of [1, 48]) {
      const clip = media({ startTime: 24 / fps, duration: frames / fps, trimEnd: 2 + frames / fps })
      const result = slip(begin(input({ clips: [clip], fps })), 5 / fps)
      assert.equal(result.feedback.first.clipId, 'clip'); assert.equal(result.feedback.last.clipId, 'clip')
      assert.equal(result.feedback.first.edge, 'left'); assert.equal(result.feedback.last.edge, 'right')
      close(result.feedback.first.timelineTime, 24 / fps)
      close(result.feedback.last.timelineTime, (24 + frames - 1) / fps)
    }
  }
})

test('half-frame rounding and fractional source bounds resolve once, inward in either direction', () => {
  const session = begin(input({ clips: [media({ trimStart: .26, trimEnd: 3.26, sourceDuration: 8 })] }))
  for (let repeat = 0; repeat < 3; repeat++) {
    for (const [requested, expected] of [[.05, .1], [-.05, 0], [.15, .2], [-.15, -.1], [-99, -.2], [99, 4.7]]) {
      const result = slip(session, requested)
      assert.equal(result.delta, expected)
      close(result.clips[0].trimStart, .26 + expected)
      close(result.clips[0].trimEnd, 3.26 + expected)
    }
  }
  assert.equal(slip(session, -.26).feedback.limit?.label, 'Source start')
  assert.equal(slip(session, 4.74).feedback.limit?.label, 'Source end')
  assert.equal(slip(session, -.2).feedback.limit, null)
  assert.equal(slip(session, 4.7).feedback.limit, null)
  assert.equal(slip(session, 0).feedback.limit, null)
})

test('a full source without handles stays an exact no-op for any pointer position', () => {
  const options = input({ clips: [media({ trimStart: 0, trimEnd: 3, sourceDuration: 3 })] }), session = begin(options)
  for (const requested of [-10, 0, 10]) {
    const result = slip(session, requested)
    assert.equal(result.changed, false); assert.equal(result.clips, options.clips)
    assert.equal(result.feedback.deltaFrames, 0)
  }
})

test('canonical sparse trims use playback fallbacks in read-only feedback and materialize only on movement', () => {
  for (const [patch, delta] of [[{ trimStart: undefined, trimEnd: 3 }, .5],
    [{ trimStart: 7, trimEnd: undefined }, -.5],
    [{ trimStart: undefined, trimEnd: undefined, sourceDuration: 3 }, 0]]) {
    const clip = media(patch), options = input({ clips: [clip] }), session = begin(options)
    const idle = slip(session, 0)
    assert.equal(idle.clips, options.clips)
    assert.equal(idle.feedback.first.clip, clip)
    assert.equal(idle.feedback.last.clip, clip)
    assert.equal(clip.trimStart, patch.trimStart)
    if (Object.hasOwn(patch, 'trimEnd')) assert.equal(clip.trimEnd, patch.trimEnd)
    const result = slip(session, delta)
    close(result.feedback.sourceDelta, delta)
    if (delta !== 0) {
      close(result.clips[0].trimStart, (clip.trimStart ?? 0) + delta)
      close(result.clips[0].trimEnd, (clip.trimEnd ?? clip.sourceDuration) + delta)
    }
  }
})

test('every authored attribute, audio envelope, EQ, keyframe, fade and cache descriptor keeps its original reference', () => {
  const patch = { keyframes: { opacity: [{ time: .5, value: .3 }] }, effects: [{ id: 'grain', type: 'filmGrain' }],
    volumeEnvelope: { version: 1, offsetSeconds: 7, points: [{ id: 'p', time: 0, db: -6 }] },
    audioEq: { version: 1, enabled: true, lowCut: true, bassDb: 3, midDb: 0, trebleDb: 0 },
    audioFadeIn: .5, audioFadeOut: .8, cachePath: 'cache/clip.mp4', cacheSignature: 'old', opticalFlowCache: { path: 'cache/rife.mp4', status: 'ready' },
    transform: { scaleX: 150 }, maskAssetId: 'mask', metadata: { authored: true } }
  const clip = media(patch), session = begin(input({ clips: [clip] }))
  for (const delta of [.4, -.3, .7, .4]) {
    const after = slip(session, delta).clips[0]
    for (const key of Object.keys(clip).filter(key => !['trimStart', 'trimEnd'].includes(key))) assert.equal(after[key], clip[key])
  }
})

test('invalid IDs, tracks, timing, source clocks and bounds refuse without touching caller data', () => {
  const cases = [
    data => { data.clipId = 'missing' }, data => { data.clips.push(data.clips[0]) }, data => { data.tracks = [] },
    data => { data.tracks.push(data.tracks[0]) }, data => { data.fps = '24' }, data => { data.fps = 0 },
    data => { data.clips[0].startTime = -.1 }, data => { data.clips[0].startTime += .01 },
    data => { data.clips[0].duration = 0 }, data => { data.clips[0].duration = Infinity },
    data => { data.clips[0].speed = 0 }, data => { data.clips[0].speed = '2' },
    data => { data.clips[0].reverse = 'false' }, data => { data.clips[0].sourceFps = NaN },
    data => { data.clips[0].sourceTimeScale = .5; data.clips[0].trimEnd = 3.5 },
    data => { data.clips[0].sourceTimeScale = undefined; data.clips[0].sourceFps = 48; data.clips[0].trimEnd = 3.5 },
    data => { data.clips[0].sourceDuration = null }, data => { data.clips[0].sourceDuration = undefined },
    data => { data.clips[0].sourceDuration = Infinity }, data => { data.clips[0].trimStart = -1 },
    data => { data.clips[0].trimEnd = 4 }, data => { data.clips[0].trimEnd = 12 },
    data => { data.clips[0].type = 'audio' }, data => { data.tracks[0].type = 'image' },
  ]
  for (const modify of cases) {
    const data = input(); modify(data); const before = structuredClone(data)
    assert.equal(createSlipEditSession(data).ok, false, modify.toString())
    assert.deepEqual(data, before)
  }
})

test('generators, compound parents, caption shapes, locks, jobs, linked mates, transitions and dormant ramps refuse', () => {
  for (const patch of [{ type: 'image' }, { type: 'text' }, { type: 'shape' }, { type: 'adjustment' }, { type: 'compound' },
    { compound: {} }, { settings: { overlayKind: 'captions' } }, { metadata: { captionScope: 'timeline' } },
    { locked: true }, { syncLocked: true }, { lockMode: 'sync' }, { syncLock: { mode: 'sync' } },
    { cacheStatus: 'rendering' }, { opticalFlowCache: { status: 'building' } }, { opticalFlowCache: { jobId: 'job' } },
    { keyframes: { speed: [{ time: 0, value: 1 }] } }, { reverse: true, keyframes: { speed: [{ time: 0, value: 1 }] } },
    { speedRamp: { enabled: true } }, { timeRemap: [1] }]) {
    assert.equal(createSlipEditSession(input({ clips: [media(patch)] })).ok, false, JSON.stringify(patch))
  }
  for (const patch of [{ locked: true }, { syncLocked: true }, { syncLock: { mode: 'sync' } }, { role: 'captions' }]) {
    assert.equal(createSlipEditSession(input({ tracks: [{ id: 'v', type: 'video', ...patch }] })).ok, false)
  }
  for (const key of ['clipId', 'clipAId', 'clipBId']) assert.equal(createSlipEditSession(input({ transitions: [{ [key]: 'clip' }] })).ok, false)
  const linked = input(); linked.clips.forEach(clip => { clip.linkGroupId = 'linked' })
  assert.equal(createSlipEditSession(linked).ok, false)
  linked.clips.pop(); assert.equal(createSlipEditSession(linked).ok, true)
})

test('feedback rejects missing, duplicate, moved, resized, off-grid and mismatched actual results', () => {
  const session = begin(), result = slip(session, .4)
  const feedback = clips => buildSlipEditPreviewFeedback({ session, clips, fps: 10 })
  assert.equal(feedback([]), null)
  assert.equal(feedback([result.clips[0], result.clips[0]]), null)
  for (const patch of [{ startTime: 3 }, { duration: 2 }, { trimStart: 2.41, trimEnd: 5.41 }, { trimEnd: 6 }, { trimStart: NaN }]) {
    assert.equal(feedback([{ ...result.clips[0], ...patch }]), null)
  }
  assert.equal(feedback(result.clips).first.clip, result.clips[0])
})

test('invalid pointer deltas do not create a plan or mutate the session', () => {
  const session = begin()
  for (const requestedDelta of [null, undefined, NaN, Infinity, '1']) assert.equal(planSlipEdit({ session, requestedDelta }).ok, false)
})
