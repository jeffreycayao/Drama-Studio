import test from 'node:test'
import assert from 'node:assert/strict'
import { createRollEditSession, planRollEdit } from './rollEdit.mjs'
import { getClipPlaybackTimingAtTimeline } from './clipPlaybackTiming.js'
import { getAudioVolumeEnvelopeDb } from './audioVolumeEnvelope.mjs'

const media = patch => ({ id: 'a', type: 'video', trackId: 'v', startTime: 2, duration: 3,
  trimStart: 2, trimEnd: 5, sourceDuration: 12, speed: 1, sourceTimeScale: 1,
  sourceFps: 24, timelineFps: 24, reverse: false, ...patch })
const input = patch => ({ clips: [media(), media({ id: 'b', startTime: 5, duration: 2, trimStart: 4, trimEnd: 6 })],
  tracks: [{ id: 'v', type: 'video' }], clipAId: 'a', clipBId: 'b', fps: 10, ...patch })
const begin = options => {
  const result = createRollEditSession(options || input())
  assert.equal(result.ok, true, result.reason)
  return result.session
}
const roll = (session, requestedDelta) => {
  const result = planRollEdit({ session, requestedDelta })
  assert.equal(result.ok, true, result.reason)
  return result
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`)
const freeze = value => {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child) }
  return value
}

test('pure sessions retain exact immutable outer union and unrelated references', () => {
  const other = media({ id: 'other', startTime: 20 }), original = input()
  original.clips.push(other)
  freeze(original)
  const session = begin(original), result = roll(session, .35)
  assert.equal(result.delta, .4)
  assert.equal(result.clips[0].startTime, 2)
  assert.equal(result.clips[0].duration, 3.4)
  assert.equal(result.clips[1].startTime, 5.4)
  close(result.clips[1].startTime + result.clips[1].duration, 7)
  assert.equal(result.clips[2], other)
  assert.equal(result.feedback.outgoing.clip, result.clips[0])
  assert.equal(result.feedback.incoming.clip, result.clips[1])
  assert.equal(result.feedback.deltaFrames, 4)
  assert.equal(roll(session, 0).clips, original.clips)
})

test('all constant forward/reverse speed/timebase combinations retain the original raw source mapping', () => {
  for (const fps of [24, 30, 30000 / 1001]) for (const speed of [.5, 1, 2]) for (const scale of [.5, 1, 1.25]) {
    for (const reverseA of [false, true]) for (const reverseB of [false, true]) for (const direction of [-1, 1]) {
      const effective = speed * scale, aDuration = 72 / fps, bDuration = 60 / fps
      const type = scale === 1 ? 'video' : 'audio'
      const clips = [media({ type, startTime: 24 / fps, duration: aDuration, trimStart: 10, trimEnd: 10 + aDuration * effective,
        sourceDuration: 100, speed, sourceTimeScale: scale, reverse: reverseA }),
      media({ type, id: 'b', startTime: 96 / fps, duration: bDuration, trimStart: 20, trimEnd: 20 + bDuration * effective,
        sourceDuration: 100, speed, sourceTimeScale: scale, reverse: reverseB })]
      const result = roll(begin(input({ clips, fps, tracks: [{ id: 'v', type: type === 'audio' ? 'audio' : 'video' }] })), direction * 12 / fps)
      for (let index = 0; index < 2; index++) {
        const before = clips[index], after = result.clips[index]
        const start = Math.max(before.startTime, after.startTime), end = Math.min(before.startTime + before.duration, after.startTime + after.duration)
        for (let frame = 0; start + frame / fps < end - 1e-7; frame++) {
          const time = start + frame / fps
          // Raw time excludes the existing endOffset safety clamp on the first
          // reverse frame; the renderer continues to own that edge convention.
          close(getClipPlaybackTimingAtTimeline(after, time, 0, { useFrameSampling: false }).rawTime,
            getClipPlaybackTimingAtTimeline(before, time, 0, { useFrameSampling: false }).rawTime)
        }
      }
      close(result.clips[1].startTime + result.clips[1].duration, 156 / fps)
    }
  }
})

test('audio implicit constant FPS ratio is respected without rewriting authored metadata', () => {
  const clips = [media({ type: 'audio', sourceTimeScale: undefined, timelineFps: 24, sourceFps: 48, trimEnd: 3.5 }),
    media({ type: 'audio', id: 'b', startTime: 5, duration: 2, trimStart: 4, trimEnd: 5, sourceTimeScale: undefined, timelineFps: 24, sourceFps: 48 })]
  const result = roll(begin(input({ clips, tracks: [{ id: 'v', type: 'audio' }] })), .5)
  assert.equal(result.clips[0].trimEnd, 3.75)
  assert.equal(result.clips[1].trimStart, 4.25)
  assert.equal(result.clips[0].sourceTimeScale, undefined)
})

test('reverse outgoing source-start and incoming source-end are the correct stopping handles', () => {
  const clips = [media({ trimStart: .2, trimEnd: 3.2, reverse: true }),
    media({ id: 'b', startTime: 5, duration: 2, trimStart: 5.8, trimEnd: 7.8, sourceDuration: 8, reverse: true })]
  const session = begin(input({ clips }))
  const right = roll(session, 1), left = roll(session, -1)
  close(right.delta, .2); close(left.delta, -.2)
  close(right.clips[0].trimStart, 0); assert.equal(right.clips[0].trimEnd, 3.2)
  close(left.clips[1].trimEnd, 8); assert.equal(left.clips[1].trimStart, 5.8)
  assert.deepEqual(right.feedback.limit, { clipId: 'a', label: 'Outgoing source start' })
  assert.deepEqual(left.feedback.limit, { clipId: 'b', label: 'Incoming source end' })
})

test('audio unknown source length uses the nominal end conservatively, never null-to-zero', () => {
  for (const sourceDuration of [null, undefined]) {
    const clips = [media({ type: 'audio', sourceDuration }), media({ type: 'audio', id: 'b', startTime: 5, duration: 2, trimStart: 4, trimEnd: 6, sourceDuration })]
    const session = begin(input({ clips, tracks: [{ id: 'v', type: 'audio' }] }))
    assert.equal(roll(session, 1).delta, 0)
    assert.equal(roll(session, -1).delta, -1)
    clips[0] = { ...clips[0], trimEnd: undefined }
    assert.equal(createRollEditSession(input({ clips, tracks: [{ id: 'v', type: 'audio' }] })).ok, false)
  }
})

test('all generator types are unbounded at both edges with safe nonnegative nominal trims', () => {
  for (const type of ['image', 'text', 'shape', 'adjustment']) for (const sourceDuration of [Infinity, null, undefined, 1]) for (const reverse of [false, true]) {
    const clips = [media({ type, sourceDuration, reverse, trimStart: 0, trimEnd: 1 }),
      media({ id: 'b', type, startTime: 5, duration: 2, sourceDuration, reverse, trimStart: 0, trimEnd: null })]
    const session = begin(input({ clips }))
    for (const [delta, expected] of [[99, 1.9], [-99, -2.9]]) {
      const result = roll(session, delta)
      assert.equal(result.delta, expected)
      for (const clip of result.clips) {
        assert.equal(clip.trimStart, 0)
        close(clip.trimEnd, clip.duration)
        assert.equal(clip.sourceDuration, sourceDuration)
      }
    }
  }
})

test('one common frame quantization handles half ties and inward source bounds without drift', () => {
  const session = begin()
  for (let repeat = 0; repeat < 3; repeat++) for (const [requested, expected] of [[.05, .1], [-.05, 0], [-.15, -.1], [.15, .2]]) {
    const result = roll(session, requested)
    assert.equal(result.delta, expected)
    close(result.clips[0].startTime + result.clips[0].duration, result.clips[1].startTime)
    close(result.clips[1].startTime + result.clips[1].duration, 7)
  }
  const options = input(); options.clips[0].sourceDuration = 5.251
  const limited = roll(begin(options), 10)
  assert.equal(limited.delta, .2)
  assert.equal(limited.feedback.limit?.label, 'Outgoing source end')
})

test('one-frame pair accepts only a no-op, with no fabricated midpoint', () => {
  const clips = [media({ startTime: 0, duration: .1, trimStart: 0, trimEnd: .1 }),
    media({ id: 'b', startTime: .1, duration: .1, trimStart: 0, trimEnd: .1 })]
  const session = begin(input({ clips }))
  for (const delta of [-10, 0, 10]) assert.equal(roll(session, delta).clips, clips)
})

test('envelope head offset uses original absolute delta while ordinary keyframes/effects and caches stay authored', () => {
  const envelope = { version: 1, offsetSeconds: 2, points: [{ id: 'p1', time: -1, db: -10 }, { id: 'p2', time: 8, db: 2 }] }
  const metadata = { keyframes: { opacity: [{ time: .5, value: .3 }] }, effects: [{ id: 'film-grain', type: 'filmGrain' }],
    audioEq: { version: 1, enabled: true, bassDb: 3, midDb: 0, trebleDb: 0, lowCut: false },
    volumeEnvelope: envelope, audioFadeIn: .5, audioFadeOut: .8, cachePath: 'cache/b.mp4', cacheSignature: 'old',
    opticalFlowCache: { status: 'ready', path: 'cache/rife.mp4' } }
  const options = input({ tracks: [{ id: 'v', type: 'audio' }] })
  options.clips = options.clips.map(clip => ({ ...clip, type: 'audio', ...metadata }))
  const session = begin(options)
  for (const delta of [.4, .7, -.3, .4]) {
    const result = roll(session, delta), after = result.clips[1], before = options.clips[1]
    close(after.volumeEnvelope.offsetSeconds, 2 + delta)
    close(getAudioVolumeEnvelopeDb(after, .5), getAudioVolumeEnvelopeDb(before, .5 + delta))
    for (const key of ['keyframes', 'effects', 'audioEq', 'audioFadeIn', 'audioFadeOut', 'cachePath', 'cacheSignature', 'opticalFlowCache']) assert.equal(after[key], before[key])
    assert.equal(result.clips[0].volumeEnvelope, envelope)
  }
})

test('invalid pair identity, timing, track roles, overlap and missing clocks reject without mutation', () => {
  const cases = [
    data => { data.clipBId = 'a' }, data => { data.clips.pop() }, data => { data.clips.push(data.clips[0]) },
    data => { data.tracks.push(data.tracks[0]) }, data => { data.clips[1].trackId = 'elsewhere' },
    data => { data.clips[1].startTime += .1 }, data => { data.clips[1].startTime -= .1 },
    data => { data.clips[0].startTime += .01 }, data => { data.clips[0].duration = 0 },
    data => { data.clips[0].duration = Infinity }, data => { data.fps = '24' },
    data => { data.clips[0].speed = 0 }, data => { data.clips[0].speed = '1' },
    data => { data.clips[0].sourceTimeScale = -1 }, data => { data.clips[0].sourceFps = NaN },
    data => { data.clips[0].reverse = 'false' }, data => { data.clips[0].trimStart = -1 },
    data => { data.clips[0].trimEnd = 20 }, data => { data.clips[0].trimEnd = 4 },
    data => { data.clips[0].sourceDuration = Infinity }, data => { data.clips[0].sourceDuration = '12' },
    data => { data.clips[0].sourceDuration = null }, data => { data.clips[0].sourceDuration = undefined },
    data => { data.clips[0].sourceTimeScale = .5; data.clips[0].trimEnd = 3.5 },
    data => { data.clips[0].sourceTimeScale = undefined; data.clips[0].sourceFps = 48; data.clips[0].trimEnd = 3.5 },
    data => { data.clips[0].type = 'compound' }, data => { data.clips[0].settings = { overlayKind: 'captions' } },
    data => { data.tracks[0].role = 'captions' }, data => { data.clips[0].type = 'audio' },
    data => { data.clips[0].metadata = { captionScope: 'timeline' } },
    data => { data.clips.push(media({ id: 'overlap', startTime: 4 })) },
  ]
  for (const modify of cases) {
    const data = input(); modify(data); const original = structuredClone(data)
    assert.equal(createRollEditSession(data).ok, false, modify.toString())
    assert.deepEqual(data, original)
  }
})

test('locks, linked mates, transitions, active cache jobs, ramps and malformed envelopes reject atomically', () => {
  for (const patch of [{ locked: true }, { syncLocked: true }, { lockMode: 'sync' }, { syncLock: { mode: 'sync' } },
    { cacheStatus: 'rendering' }, { opticalFlowCache: { status: 'building' } }, { opticalFlowCache: { jobId: 'job' } },
    { keyframes: { speed: [{ time: 0, value: 1 }] } }, { speedRamp: { enabled: true } }, { timeRemap: [1] },
    { reverse: true, keyframes: { speed: [{ time: 0, value: 1 }] } }, { volumeEnvelope: { version: 9 } }]) {
    const data = input(); data.clips[1] = { ...data.clips[1], ...patch }
    assert.equal(createRollEditSession(data).ok, false, JSON.stringify(patch))
  }
  const lockedTrack = input(); lockedTrack.tracks[0].syncLock = { mode: 'sync' }
  assert.equal(createRollEditSession(lockedTrack).ok, false)
  for (const field of ['clipId', 'clipAId', 'clipBId']) assert.equal(createRollEditSession(input({ transitions: [{ [field]: 'a' }] })).ok, false)
  const linked = input(); linked.clips[0].linkGroupId = 'link'; linked.clips.push(media({ id: 'mate', trackId: 'elsewhere', linkGroupId: 'link' }))
  assert.equal(createRollEditSession(linked).ok, false)
  linked.clips.pop(); assert.equal(createRollEditSession(linked).ok, true)
})

test('invalid pointer delta never constructs an edit', () => {
  const session = begin()
  for (const requestedDelta of [null, undefined, NaN, Infinity, '1']) assert.equal(planRollEdit({ session, requestedDelta }).ok, false)
})
