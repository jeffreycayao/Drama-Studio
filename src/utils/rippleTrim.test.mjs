import test from 'node:test'
import assert from 'node:assert/strict'
import { createRippleTrimSession, planRippleTrim, buildRippleTrimPreviewFeedback } from './rippleTrim.mjs'
import { getClipPlaybackTimingAtTimeline } from './clipPlaybackTiming.js'
import { getAudioVolumeEnvelopeDb } from './audioVolumeEnvelope.mjs'

const clip = patch => ({ id: 'target', type: 'video', trackId: 'v', startTime: 2, duration: 3,
  trimStart: 2, trimEnd: 5, sourceDuration: 10, speed: 1, sourceTimeScale: 1, sourceFps: 24, timelineFps: 24, reverse: false, ...patch })
const input = patch => ({ clips: [clip(), clip({ id: 'follower', startTime: 6, duration: 2, trimEnd: 4 }),
  clip({ id: 'later', startTime: 10, duration: 2, trimEnd: 4 }), clip({ id: 'overlay', trackId: 'other', startTime: 0 })],
  tracks: [{ id: 'v', type: 'video', name: 'Picture' }, { id: 'a', type: 'audio', name: 'Audio' },
    { id: 'other', type: 'video', name: 'Overlay' }, { id: 'foreign', type: 'audio', name: 'Linked sound' }],
  clipId: 'target', edge: 'right', fps: 10, ...patch })
const begin = data => { const result = createRippleTrimSession(data || input()); assert.equal(result.ok, true, result.reason); return result.session }
const apply = (session, requestedDelta) => { const result = planRippleTrim({ session, requestedDelta }); assert.equal(result.ok, true, result.reason); return result }
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`)
const byId = (result, id) => result.clips.find(clip => clip.id === id)

test('tail and fixed-start head ripple all later clips while preserving gaps, earlier clips and unrelated tracks', () => {
  for (const edge of ['left', 'right']) for (const pointer of [-.5, .5]) {
    const data = input({ edge }); data.clips.push(clip({ id: 'before', startTime: 0, duration: 2, trimEnd: 4 }))
    const original = structuredClone(data), session = begin(data), result = apply(session, pointer), change = edge === 'left' ? -pointer : pointer
    assert.equal(result.durationDelta, change)
    assert.equal(byId(result, 'target').startTime, 2); assert.equal(byId(result, 'target').duration, 3 + change)
    assert.equal(byId(result, 'follower').startTime, 6 + change); assert.equal(byId(result, 'later').startTime, 10 + change)
    assert.equal(byId(result, 'follower').startTime - byId(result, 'target').startTime - byId(result, 'target').duration, 1)
    assert.equal(byId(result, 'overlay'), data.clips[3]); assert.equal(byId(result, 'before'), data.clips[4])
    assert.equal(result.feedback.clip, byId(result, 'target'))
    assert.equal(result.feedback.durationDeltaFrames, change * 10)
    assert.equal(result.feedback.guideTime, (edge === 'left' ? 2 : 5) + pointer)
    assert.equal(result.feedback.edgeTime, edge === 'left' ? 2 : 5 + change)
    assert.deepEqual(result.feedback.affectedTrackNames, ['Picture'])
    assert.equal(result.feedback.shiftedClipCount, 2)
    assert.deepEqual(data, original)
    assert.equal(apply(session, 0).clips, data.clips)
  }
})

test('linked target groups expand fully and the tightest source clock limits all aligned clips together', () => {
  const data = input()
  data.clips[0].linkGroupId = 'take'
  data.clips.push(clip({ id: 'sound', type: 'audio', trackId: 'a', linkGroupId: 'take', sourceDuration: 5.26 }))
  const session = begin(data), result = apply(session, 1)
  assert.deepEqual(session.targetClipIds, ['target', 'sound'])
  assert.equal(result.delta, .2)
  assert.equal(byId(result, 'sound').duration, 3.2)
  assert.deepEqual(result.feedback.limit, { label: 'Source end reached', clipId: 'sound' })
  assert.equal(result.feedback.affectedCount, 2)
  assert.equal(result.feedback.linkedTargetCount, 1)
})

test('explicit aligned multi-target selection expands each group and rejects missing/nonaligned/same-track groups', () => {
  const data = input({ targetClipIds: ['target', 'overlay'] })
  data.clips[3] = clip({ id: 'overlay', trackId: 'other', linkGroupId: 'take' })
  data.clips.push(clip({ id: 'sound', type: 'audio', trackId: 'a', linkGroupId: 'take' }))
  assert.equal(begin(data).targetClipIds.length, 3)
  for (const patch of [{ startTime: 2.1 }, { duration: 2.9, trimEnd: 4.9 }, { trackId: 'v' }]) {
    const invalid = structuredClone(data); Object.assign(invalid.clips[3], patch)
    assert.equal(createRippleTrimSession(invalid).ok, false)
  }
  for (const targetClipIds of [[], ['missing'], ['target', 'target']]) assert.equal(createRippleTrimSession(input({ targetClipIds })).ok, false)
})

test('foreign linked followers move only their group; static foreign neighbors impose non-overwriting bounds', () => {
  for (const edge of ['left', 'right']) {
    const data = input({ edge }); data.clips[1].linkGroupId = 'following'
    data.clips.push(clip({ id: 'sound', type: 'audio', trackId: 'foreign', startTime: 5.5, duration: 2, trimEnd: 4, linkGroupId: 'following' }),
      clip({ id: 'musicBefore', type: 'audio', trackId: 'foreign', startTime: 2, duration: 3, trimEnd: 5 }),
      clip({ id: 'musicAfter', type: 'audio', trackId: 'foreign', startTime: 8.5, duration: 1, trimEnd: 3 }))
    const session = begin(data)
    const shrink = apply(session, edge === 'left' ? 99 : -99), grow = apply(session, edge === 'left' ? -99 : 99)
    assert.equal(shrink.durationDelta, -.5); assert.equal(grow.durationDelta, 1)
    assert.equal(byId(shrink, 'sound').startTime, 5)
    assert.equal(byId(grow, 'sound').startTime, 6.5)
    for (const id of ['musicBefore', 'musicAfter', 'overlay']) assert.equal(byId(grow, id), data.clips.find(clip => clip.id === id))
    assert.equal(grow.feedback.limit.label, 'Neighboring clip reached')
    assert.ok(session.snapExcludedClipIds.includes('sound'))
    assert.equal(session.snapExcludedClipIds.includes('musicAfter'), false)
  }
})

test('linked follower at timeline zero blocks earlier movement instead of clamping away sync', () => {
  const data = input(); data.clips[1].linkGroupId = 'following'
  data.clips.push(clip({ id: 'sound', type: 'audio', trackId: 'foreign', startTime: 0, duration: 2, trimEnd: 4, linkGroupId: 'following' }))
  const session = begin(data), result = apply(session, -1)
  assert.equal(result.delta, 0); assert.equal(result.clips, data.clips)
  assert.equal(result.feedback.limit.label, 'Timeline start reached')
})

test('downstream links reaching target/upstream target tracks and preexisting overlaps reject', () => {
  const data = input(); data.clips[1].linkGroupId = 'following'
  data.clips.push(clip({ id: 'before', startTime: 0, duration: 2, trimEnd: 4, linkGroupId: 'following' }))
  assert.equal(createRippleTrimSession(data).ok, false)
  const overlap = input(); overlap.clips[1].startTime = 4
  assert.equal(createRippleTrimSession(overlap).ok, false)
  const foreignOverlap = input(); foreignOverlap.clips[1].linkGroupId = 'following'
  foreignOverlap.clips.push(clip({ id: 'sound', type: 'audio', trackId: 'foreign', startTime: 0, linkGroupId: 'following' }),
    clip({ id: 'music', type: 'audio', trackId: 'foreign', startTime: 2 }))
  assert.equal(createRippleTrimSession(foreignOverlap).ok, false)
})

test('wholly moved edge/legacy-between transitions translate every absolute timeline field, preserving source metadata', () => {
  const data = input()
  data.clips[2].startTime = 8
  const edgeTransition = { id: 'edge', kind: 'edge', clipId: 'follower', edge: 'in', duration: .5, startTime: 6, endTime: 6.5 }
  const between = { id: 'between', clipAId: 'follower', clipBId: 'later', duration: 1,
    editPoint: 8, startTime: 7.5, endTime: 8.5, originalClipAStart: 6, originalClipAEnd: 8,
    originalClipBStart: 8, originalClipBEnd: 10, originalClipATrimEnd: 4, originalClipBTrimStart: 2, settings: { amount: 1 } }
  const unrelated = { id: 'elsewhere', kind: 'edge', clipId: 'overlay', edge: 'out', duration: .5 }
  data.transitions = [edgeTransition, between, unrelated]
  const result = apply(begin(data), .5)
  for (const field of ['startTime', 'endTime']) assert.equal(result.transitions[0][field], edgeTransition[field] + .5)
  for (const field of ['startTime', 'endTime', 'editPoint', 'originalClipAStart', 'originalClipAEnd', 'originalClipBStart', 'originalClipBEnd']) assert.equal(result.transitions[1][field], between[field] + .5)
  assert.equal(result.transitions[1].originalClipATrimEnd, 4); assert.equal(result.transitions[1].originalClipBTrimStart, 2)
  assert.equal(result.transitions[1].settings, between.settings); assert.equal(result.transitions[2], unrelated)
})

test('target, partially moving and malformed affected transition relations reject before mutation', () => {
  for (const transition of [{ kind: 'edge', clipId: 'target', edge: 'out', duration: .5 },
    { clipAId: 'follower', clipBId: 'overlay', duration: 1 }, { clipAId: 'follower', clipBId: 'missing', duration: 1 },
    { kind: 'edge', clipId: 'follower', edge: 'side', duration: 1 },
    { kind: 'edge', clipId: 'follower', edge: 'in', duration: 1, startTime: '6' }, {}]) {
    assert.equal(createRippleTrimSession(input({ transitions: [transition] })).ok, false, JSON.stringify(transition))
  }
})

test('all orientations, speeds and fractional FPS preserve correct raw head/tail source clocks', () => {
  for (const fps of [24, 30, 30000 / 1001]) for (const edge of ['left', 'right']) for (const reverse of [false, true]) for (const speed of [.5, 2]) {
    const original = clip({ startTime: 24 / fps, duration: 72 / fps, trimStart: 5, trimEnd: 5 + 72 / fps * speed, sourceDuration: 30, speed, reverse })
    const session = begin(input({ clips: [original], edge, fps }))
    for (const pointer of [-12 / fps, 12 / fps]) {
      const result = apply(session, pointer), changed = result.clips[0]
      for (let frame = 0; frame < Math.round(changed.duration * fps); frame++) {
        const local = frame / fps
        const after = getClipPlaybackTimingAtTimeline(changed, changed.startTime + local, 0, { useFrameSampling: false })
        const before = getClipPlaybackTimingAtTimeline(original, original.startTime + local + (edge === 'left' ? pointer : 0), 0, { useFrameSampling: false })
        near(after.rawTime, before.rawTime)
      }
      assert.equal(changed.startTime, original.startTime)
    }
  }
})

test('head envelopes advance once by consumed time; ordinary attributes and follower metadata retain references', () => {
  const envelope = { version: 1, offsetSeconds: 2, points: [{ id: 'a', time: 0, db: -12 }, { id: 'b', time: 8, db: 3 }] }
  const attrs = { volumeEnvelope: envelope, keyframes: { opacity: [{ time: 0, value: .5 }] }, effects: [{ type: 'filmGrain' }],
    audioEq: { version: 1 }, fadeIn: .5, fadeOut: .8, cacheSignature: 'cached', opticalFlowCache: { status: 'ready', path: 'rife.mp4' } }
  const data = input({ edge: 'left' }); Object.assign(data.clips[0], attrs); Object.assign(data.clips[1], attrs)
  const session = begin(data)
  for (const pointer of [.4, -.3, .8, .4]) {
    const result = apply(session, pointer), target = byId(result, 'target'), follower = byId(result, 'follower')
    near(target.volumeEnvelope.offsetSeconds, 2 + pointer)
    near(getAudioVolumeEnvelopeDb(target, .5), getAudioVolumeEnvelopeDb(data.clips[0], .5 + pointer))
    for (const key of Object.keys(attrs).filter(key => key !== 'volumeEnvelope')) assert.equal(target[key], attrs[key])
    for (const key of Object.keys(attrs)) assert.equal(follower[key], attrs[key])
  }
})

test('unlimited generators can grow at either edge; one common half-frame quantization remains stable', () => {
  for (const type of ['image', 'text', 'shape', 'adjustment']) for (const sourceDuration of [Infinity, null, undefined]) for (const edge of ['left', 'right']) {
    const data = input({ edge }); Object.assign(data.clips[0], { type, sourceDuration, trimStart: 0, trimEnd: 1 })
    const session = begin(data), result = apply(session, edge === 'left' ? -20 : 20)
    assert.equal(result.clips[0].duration, 23); assert.equal(result.clips[0].trimStart, 0); assert.equal(result.clips[0].trimEnd, 23)
  }
  const session = begin()
  for (let repeat = 0; repeat < 3; repeat++) for (const [requested, expected] of [[.05, .1], [-.05, 0], [-.15, -.1], [.15, .2]]) assert.equal(apply(session, requested).delta, expected)
})

test('malformed targets, unsafe source clocks and any affected locks/jobs/compound/captions refuse', () => {
  for (const patch of [{ locked: true }, { syncLocked: true }, { lockMode: 'sync' }, { syncLock: { mode: 'sync' } },
    { cacheStatus: 'rendering' }, { opticalFlowCache: { jobId: 'job' } }, { type: 'compound' }, { metadata: { captionScope: 'timeline' } }]) {
    for (const index of [0, 1]) { const data = input(); Object.assign(data.clips[index], patch); assert.equal(createRippleTrimSession(data).ok, false) }
  }
  for (const patch of [{ speed: 0 }, { reverse: 'false' }, { sourceDuration: null }, { trimEnd: 4 },
    { sourceTimeScale: .5, trimEnd: 3.5 }, { speedRamp: [1] }, { keyframes: { speed: [{ time: 0, value: 1 }] } },
    { reverse: true, keyframes: { speed: [{ time: 0, value: 1 }] } }, { volumeEnvelope: { version: 9 } }]) {
    const data = input(); Object.assign(data.clips[0], patch); assert.equal(createRippleTrimSession(data).ok, false)
  }
  const data = input(); data.tracks[0].locked = true; assert.equal(createRippleTrimSession(data).ok, false)
  const downstreamRamp = input(); downstreamRamp.clips[1].keyframes = { speed: [{ time: 0, value: 1 }] }; assert.equal(createRippleTrimSession(downstreamRamp).ok, true)
})

test('invalid pointer and mismatched actual feedback cannot create a misleading result', () => {
  const session = begin(), result = apply(session, .5)
  for (const requestedDelta of [null, undefined, NaN, Infinity, '1']) assert.equal(planRippleTrim({ session, requestedDelta }).ok, false)
  assert.equal(buildRippleTrimPreviewFeedback({ session, clips: [] }), null)
  assert.equal(buildRippleTrimPreviewFeedback({ session, clips: result.clips.map(clip => ({ ...clip, startTime: clip.startTime + 1 })) }), null)
})

test('extreme but finite pointer deltas cannot overflow target, follower or transition frame coordinates', () => {
  const data = input({ fps: 1 }); Object.assign(data.clips[0], { type: 'image', sourceDuration: Infinity })
  assert.equal(planRippleTrim({ session: begin(data), requestedDelta: Number.MAX_SAFE_INTEGER - 2 }).ok, false)
  const far = input({ fps: 1 }); Object.assign(far.clips[0], { type: 'image', sourceDuration: Infinity })
  far.clips[1].startTime = Number.MAX_SAFE_INTEGER - 4; far.clips = far.clips.slice(0, 2)
  assert.equal(planRippleTrim({ session: begin(far), requestedDelta: 5 }).ok, false)
  const transitionData = input({ fps: 1, transitions: [{ id: 'edge', kind: 'edge', clipId: 'follower', edge: 'in', duration: 1, editPoint: Number.MAX_SAFE_INTEGER }] })
  assert.equal(planRippleTrim({ session: begin(transitionData), requestedDelta: 1 }).ok, false)
})

test('affected transitions require unique IDs and supported unambiguous kinds and references', () => {
  const transition = { id: 'edge', kind: 'edge', clipId: 'follower', edge: 'in', duration: 1 }
  for (const patch of [{ id: undefined }, { id: '' }, { kind: 'unknown' }, { kind: null }, { clipAId: 'follower' }]) {
    assert.equal(createRippleTrimSession(input({ transitions: [{ ...transition, ...patch }] })).ok, false)
  }
  assert.equal(createRippleTrimSession(input({ transitions: [transition, { ...transition }] })).ok, false)
})
