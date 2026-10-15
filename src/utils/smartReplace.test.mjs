import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSmartReplacePlan, getSmartReplaceSourceMetadata } from './smartReplace.mjs'
import { getClipPlaybackTimingAtTimeline } from './clipPlaybackTiming.js'

const video = patch => ({ id: 'clip', assetId: 'old', name: 'Authored shot label', type: 'video', trackId: 'v1',
  startTime: 10, duration: 4, trimStart: 2, trimEnd: 6, sourceDuration: 20,
  sourceFps: 24, timelineFps: 24, sourceTimeScale: 1, speed: 1, reverse: false,
  transform: { scaleX: 120, positionX: 80 }, adjustments: { saturation: 0.7 },
  effects: [{ id: 'blur', type: 'blur', enabled: false, amount: 4 }],
  keyframes: { positionX: [{ time: 0, value: 0 }, { time: 4, value: 80 }] },
  metadata: { custom: 'keep me' }, ...patch })
const asset = patch => ({ id: 'new', name: 'New source', type: 'video', url: 'blob:new', duration: 20, settings: { fps: 24 }, ...patch })
const tracks = [{ id: 'v1', type: 'video' }, { id: 'a1', type: 'audio' }]
const plan = (clip = video(), replacement = asset(), extra = {}) => buildSmartReplacePlan({
  clips: [clip], tracks, transitions: [], clipId: clip.id, asset: replacement, timelineFps: 24, ...extra,
})
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`)
const freeze = value => {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze) }
  return value
}

test('same-kind replacement changes only the source binding and caches, not authored edits', () => {
  const original = freeze(video())
  const replacement = freeze(asset({ settings: { fps: 60, defaultTransform: { scaleX: 300 } } }))
  const result = plan(original, replacement)
  assert.equal(result.ok, true, result.reason)
  assert.equal(result.changed, true)
  const next = { ...original, ...result.updates }
  assert.equal(next.assetId, 'new')
  assert.equal(next.sourceFps, 60)
  for (const key of ['id', 'name', 'startTime', 'duration', 'trackId', 'transform', 'adjustments', 'effects', 'keyframes', 'metadata', 'speed', 'reverse']) {
    assert.equal(next[key], original[key], key)
  }
  assert.equal(result.summary.requiredSourceEnd, 6)
})

test('same source and same In are no-op; an explicit new In shifts both trim endpoints', () => {
  const original = video()
  assert.equal(plan(original, asset({ id: 'old' })).changed, false)
  assert.equal(plan(original, asset({ id: 'old' }), { sourceInSeconds: 2 }).changed, false)
  const result = plan(original, asset(), { sourceInSeconds: 0 })
  assert.equal(result.ok, true)
  assert.equal(result.updates.trimStart, 0)
  assert.equal(result.updates.trimEnd, 4)
  assert.equal(plan(original, asset({ id: 'old' }), { sourceInSeconds: 0 }).changed, true)
})

test('replacement needs the complete nominal trim span, not merely the visible duration', () => {
  const original = video({ trimEnd: 12 })
  const result = plan(original, asset({ duration: 8 }))
  assert.equal(result.ok, false)
  assert.match(result.reason, /12\.000/)
  assert.equal(result.summary.requiredSourceEnd, 12)
  assert.equal(plan(original, asset({ duration: 12 })).ok, true)
  assert.equal(plan(video(), asset({ duration: 5.999 })).ok, false)
  assert.equal(plan(video(), asset({ duration: 6 })).ok, true)
})

test('measured duration wins over requested generation duration in both directions', () => {
  const longFile = asset({ duration: 20, settings: { fps: 24, duration: 5 } })
  assert.equal(getSmartReplaceSourceMetadata(longFile).sourceDuration, 20)
  const accepted = plan(video(), longFile)
  assert.equal(accepted.ok, true, accepted.reason)
  assert.equal(accepted.updates.sourceDuration, 20)
  assert.equal(accepted.summary.requiredSourceEnd, 6)
  const shortFile = asset({ duration: 5, settings: { fps: 24, duration: 20 } })
  assert.equal(getSmartReplaceSourceMetadata(shortFile).sourceDuration, 5)
  const refused = plan(video(), shortFile)
  assert.equal(refused.ok, false)
  assert.match(refused.reason, /only 5\.000 seconds/)
})

test('measured FPS has priority and source metadata uses validated settings only as fallback', () => {
  const measured = asset({ fps: 60, settings: { fps: 24, duration: 5 } })
  assert.deepEqual(getSmartReplaceSourceMetadata(measured), { sourceDuration: 20, sourceFps: 60 })
  const result = plan(video(), measured)
  assert.equal(result.updates.sourceFps, 60)
  assert.equal(result.updates.sourceTimeScale, 1)
  for (const invalid of [undefined, null, 0, -1, NaN, Infinity, '', 'bad', true]) {
    assert.deepEqual(getSmartReplaceSourceMetadata(asset({ duration: invalid, fps: invalid, settings: { duration: 12, fps: 30 } })),
      { sourceDuration: 12, sourceFps: 30 })
  }
  assert.deepEqual(getSmartReplaceSourceMetadata(asset({ duration: '20', fps: '60' })), { sourceDuration: 20, sourceFps: 60 })
  assert.deepEqual(getSmartReplaceSourceMetadata(asset({ duration: undefined, settings: {} })), { sourceDuration: null, sourceFps: null })
  assert.deepEqual(getSmartReplaceSourceMetadata(asset({ type: 'image', duration: undefined, settings: {} })), { sourceDuration: Infinity, sourceFps: null })
  assert.deepEqual(getSmartReplaceSourceMetadata(asset({ type: 'audio', fps: 60 })), { sourceDuration: 20, sourceFps: null })
})

test('constant speed/reverse/source scales preserve actual playback mapping across a deterministic grid', () => {
  for (const speed of [0.25, 1, 2, 4]) for (const reverse of [false, true]) for (const base of [0.5, 1, 2]) {
    const original = video({ speed, reverse, sourceTimeScale: base, trimEnd: 2 + 4 * base * speed, sourceDuration: 100 })
    for (const sourceInSeconds of [0, 2, 7]) {
      const result = plan(original, asset({ duration: 100, settings: { fps: 60 } }), { sourceInSeconds })
      assert.equal(result.ok, true, result.reason)
      const next = { ...original, ...result.updates }
      for (let local = 0; local <= 4; local += 0.125) {
        const options = { useFrameSampling: false }
        const before = getClipPlaybackTimingAtTimeline(original, original.startTime + local, 0, options)
        const after = getClipPlaybackTimingAtTimeline(next, next.startTime + local, 0, options)
        near(after.time, before.time + sourceInSeconds - original.trimStart)
        near(after.rawTime, before.rawTime + sourceInSeconds - original.trimStart)
      }
    }
  }
})

test('legacy implicit FPS ratio is frozen before updating replacement source FPS', () => {
  const original = video({ sourceTimeScale: undefined, sourceFps: 60, timelineFps: 24, trimEnd: 3.6 })
  const result = plan(original, asset({ settings: { fps: 30 } }))
  assert.equal(result.ok, true)
  assert.equal(result.updates.sourceTimeScale, 0.4)
  assert.equal(result.updates.sourceFps, 30)
  const next = { ...original, ...result.updates }
  near(getClipPlaybackTimingAtTimeline(next, 12, 0, { useFrameSampling: false }).time, 2.8)
})

test('speed ramps use the real integral and retain intentional trim freezes', () => {
  for (const trimEnd of [5, 18]) {
    const original = video({ trimEnd, keyframes: { speed: [{ time: 0, value: 0.5 }, { time: 4, value: 3 }] } })
    const result = plan(original, asset({ duration: 20 }), { sourceInSeconds: 1 })
    assert.equal(result.ok, true, result.reason)
    const next = { ...original, ...result.updates }
    for (let local = 0; local <= 4; local += 0.25) {
      const before = getClipPlaybackTimingAtTimeline(original, 10 + local, 0, { useFrameSampling: false })
      const after = getClipPlaybackTimingAtTimeline(next, 10 + local, 0, { useFrameSampling: false })
      near(after.time, before.time - 1)
      assert.equal(after.clamped, before.clamped)
    }
    near(result.summary.playbackSourceEnd, getClipPlaybackTimingAtTimeline(next, 14, 0, { useFrameSampling: false }).time)
  }
  const frozen = video({ trimEnd: 5, keyframes: { speed: [{ time: 0, value: 4 }] } })
  assert.equal(plan(frozen, asset({ duration: 5 })).ok, true)
})

test('reverse ignores speed-ramp keyframes exactly as the playback helper does', () => {
  const original = video({ reverse: true, keyframes: { speed: [{ time: 0, value: 8 }] } })
  const result = plan(original, asset({ duration: 6 }))
  assert.equal(result.ok, true)
  assert.equal(result.summary.playbackSourceStart, 6)
  assert.equal(result.summary.playbackSourceEnd, 2)
})

test('image replacement preserves static editing with no duration or FPS requirement', () => {
  const original = video({ type: 'image', sourceDuration: Infinity, trimEnd: 4, duration: 100 })
  const result = plan(original, asset({ type: 'image', duration: undefined, settings: {} }))
  assert.equal(result.ok, true, result.reason)
  assert.equal(result.updates.sourceDuration, Infinity)
  assert.equal(result.updates.trimEnd, 4)
  assert.equal(result.summary.duration, 100)
  assert.equal(plan(original, asset({ type: 'image' }), { sourceInSeconds: 0 }).ok, false)
})

test('audio and legacy video-backed audio preserve EQ, envelope, fades and gain', () => {
  for (const type of ['audio', 'video']) {
    const original = video({ type, trackId: 'a1', audioEq: { enabled: false, bassDb: 6 }, gainDb: -3,
      volumeEnvelope: { version: 1, offsetSeconds: 2, points: [] }, fadeIn: 0.5, fadeOut: 1 })
    const result = plan(original, asset({ type: 'audio', settings: {} }))
    assert.equal(result.ok, true, result.reason)
    const next = { ...original, ...result.updates }
    assert.equal(next.type, 'audio')
    for (const key of ['audioEq', 'volumeEnvelope', 'fadeIn', 'fadeOut', 'gainDb']) assert.equal(next[key], original[key])
  }
})

test('linked companions and other instances of the old asset are not replacements', () => {
  const original = video({ linkGroupId: 'av' })
  const mate = video({ id: 'audio', type: 'audio', trackId: 'a1', linkGroupId: 'av' })
  const other = video({ id: 'instance-2', startTime: 20 })
  const clips = freeze([original, mate, other])
  const result = plan(original, asset(), { clips })
  assert.equal(result.ok, true)
  assert.deepEqual(result.summary.linkedCompanionsUnchanged, ['audio'])
  assert.match(result.warnings.join(' '), /Only this clip instance/)
  assert.equal(result.updates.linkGroupId, undefined)
  assert.equal(mate.assetId, 'old')
  assert.equal(other.assetId, 'old')
})

test('all raster masks, disabled effects, shape masks and tracking edits are retained with review warnings', () => {
  const original = freeze(video({ shapeMask: { type: 'ellipse' }, effects: [{ id: 'mask', type: 'mask', enabled: false, maskAssetId: 'old-mask' }],
    metadata: { trackingData: { sourceAssetId: 'old' }, custom: 'keep' } }))
  const result = plan(original)
  assert.equal(result.ok, true)
  const next = { ...original, ...result.updates }
  assert.equal(next.effects, original.effects)
  assert.equal(next.shapeMask, original.shapeMask)
  assert.equal(next.metadata, original.metadata)
  assert.equal(result.summary.requiresMaskReview, true)
  assert.equal(result.summary.requiresTrackingReview, true)
  assert.match(result.warnings.join(' '), /Masks retained.*Tracking edits retained/)
})

test('old source render and Optical Flow caches are completely detached without deleting files', () => {
  const original = freeze(video({ frameSampling: 'optical-flow', cacheStatus: 'cached', cacheUrl: 'blob:old-cache', cachePath: 'cache/old.webm',
    cacheKind: 'full', cacheSignature: 'old-signature', cacheProgress: 100,
    opticalFlowCache: { status: 'ready', path: 'cache/old-rife.mp4', url: 'blob:old-rife' } }))
  const result = plan(original)
  assert.equal(result.ok, true)
  for (const key of ['cacheUrl', 'cachePath', 'cacheKind', 'cacheSignature']) assert.equal(result.updates[key], null)
  assert.equal(result.updates.cacheStatus, 'none')
  assert.equal(result.updates.cacheProgress, 0)
  assert.equal(result.updates.opticalFlowCache, undefined)
  assert.equal(original.opticalFlowCache.path, 'cache/old-rife.mp4')
  assert.equal(({ ...original, ...result.updates }).frameSampling, 'optical-flow')
  assert.match(result.warnings.join(' '), /Rebuild/)
})

test('active source cache jobs, clip locks and track locks fail closed', () => {
  for (const patch of [{ locked: true }, { syncLocked: true }, { lockMode: 'sync' }, { syncLock: { mode: 'sync' } }]) {
    assert.equal(plan(video(patch)).ok, false)
    assert.equal(plan(video(), asset(), { tracks: [{ ...tracks[0], ...patch }] }).ok, false)
  }
  for (const status of ['rendering', 'building', 'queued', 'processing', 'generating', 'running']) {
    assert.equal(plan(video({ cacheStatus: status })).ok, false)
    assert.equal(plan(video({ opticalFlowCache: { status } })).ok, false)
  }
  assert.equal(plan(video({ opticalFlowCache: { status: 'ready', jobId: 'still-running' } })).ok, false)
})

test('wrong media kinds, captions, unavailable assets and sync-timed source assets reject', () => {
  for (const replacement of [asset({ type: 'image' }), asset({ type: 'audio' }), asset({ url: '' }), asset({ id: null }),
    asset({ overlayKind: 'captions' }), asset({ settings: { fps: 24, overlayKind: 'captions' } }),
    asset({ settings: { fps: 24, captionScope: 'timeline' } }),
    asset({ yolo: { mode: 'music', stage: 'video', shotType: 'performance' } })]) {
    assert.equal(plan(video(), replacement).ok, false)
  }
  assert.equal(plan(video({ type: 'captions' })).ok, false)
  assert.equal(plan(video(), asset(), { tracks: [{ ...tracks[0], role: 'captions' }] }).ok, false)
})

test('unknown duration/FPS and malformed authoring timing never get fallback guesses', () => {
  for (const replacement of [asset({ duration: undefined }), asset({ duration: 0 }), asset({ duration: NaN }),
    asset({ settings: {} }), asset({ settings: { fps: 0 } }), asset({ settings: { fps: 'bad' } })]) {
    assert.equal(plan(video(), replacement).ok, false)
  }
  for (const patch of [{ duration: NaN }, { duration: 0 }, { startTime: -1 }, { trimStart: -1 }, { trimEnd: NaN },
    { sourceTimeScale: 0 }, { speed: -1 }, { sourceFps: 0 }]) assert.equal(plan(video(patch)).ok, false)
  for (const sourceInSeconds of [null, -1, NaN, Infinity, '0']) assert.equal(plan(video(), asset(), { sourceInSeconds }).ok, false)
  assert.equal(plan(video(), asset(), { timelineFps: 0 }).ok, false)
  assert.equal(plan(video(), asset({ duration: undefined, settings: { fps: '24', duration: '20' } })).ok, true)
})

test('missing or duplicated target/track identities reject without mutation', () => {
  assert.equal(plan(video(), asset(), { clipId: 'missing' }).ok, false)
  assert.equal(plan(video(), asset(), { clips: [video(), video()] }).ok, false)
  assert.equal(plan(video(), asset(), { tracks: [] }).ok, false)
  assert.equal(plan(video(), asset(), { tracks: [tracks[0], tracks[0]] }).ok, false)
})

const between = patch => ({ id: 'transition', kind: 'between', clipAId: 'clip', clipBId: 'next', editPoint: 14,
  duration: 2, settings: { split: { clipA: 0.5, clipB: 0.5 } }, ...patch })

test('between transitions require real outgoing media handles and remain unmodified', () => {
  const original = video()
  const clips = [original, video({ id: 'next', startTime: 14 })]
  const transitions = freeze([between()])
  assert.equal(plan(original, asset({ duration: 6 }), { clips, transitions }).ok, false)
  const result = plan(original, asset({ duration: 7 }), { clips, transitions })
  assert.equal(result.ok, true, result.reason)
  assert.equal(result.summary.requiredSourceEnd, 7)
  assert.equal(transitions[0].editPoint, 14)
  assert.equal(Object.hasOwn(result, 'transitions'), false)
})

test('incoming transition handles fail if choosing a new In leaves no head media', () => {
  const original = video()
  const clips = [video({ id: 'previous', startTime: 6 }), original]
  const transitions = [between({ clipAId: 'previous', clipBId: 'clip', editPoint: 10 })]
  assert.equal(plan(original, asset(), { clips, transitions }).ok, true)
  const result = plan(original, asset(), { clips, transitions, sourceInSeconds: 0 })
  assert.equal(result.ok, false)
  assert.match(result.reason, /not enough media before/)
})

test('reverse and ramped transition handle bounds use real edge playback semantics', () => {
  for (const original of [video({ reverse: true }), video({ keyframes: { speed: [{ time: 0, value: 4 }] } })]) {
    const clips = [original, video({ id: 'next', startTime: 14 })]
    const transitions = [between()]
    const result = plan(original, asset(), { clips, transitions })
    assert.equal(result.ok, true, result.reason)
    const next = { ...original, ...result.updates }
    const timing = getClipPlaybackTimingAtTimeline(next, 15, 0, { useFrameSampling: false, allowHandles: true })
    assert.ok(timing.rawTime >= result.summary.requiredSourceStart - 1e-7)
    assert.ok(timing.rawTime <= result.summary.requiredSourceEnd + 1e-7)
    if (!original.reverse) assert.equal(result.summary.requiredSourceEnd, 10, 'frozen nominal end 6 plus ramp edge speed 4')
  }
})

test('legacy transition saved trims permit the current In but reject changing it', () => {
  const original = video()
  const clips = [original, video({ id: 'next', startTime: 14 })]
  const transitions = [between({ originalClipATrimEnd: 6, originalClipBTrimStart: 2 })]
  assert.equal(plan(original, asset(), { clips, transitions }).ok, true)
  const result = plan(original, asset(), { clips, transitions, sourceInSeconds: 0 })
  assert.equal(result.ok, false)
  assert.match(result.reason, /Keep the current source In/)
})

test('edge fades remain valid and unsupported transition relationships reject', () => {
  assert.equal(plan(video(), asset({ duration: 6 }), { transitions: [{ id: 'fade', kind: 'edge', clipId: 'clip', edge: 'out', duration: 1 }] }).ok, true)
  const clips = [video(), video({ id: 'next', startTime: 14 })]
  for (const transition of [between({ clipBId: 'missing' }), between({ duration: NaN }), between({ editPoint: 20 }),
    between({ settings: { split: { clipA: -1, clipB: 2 } } }), { clipId: 'clip', duration: 1 }]) {
    assert.equal(plan(clips[0], asset(), { clips, transitions: [transition] }).ok, false)
  }
})
