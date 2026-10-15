import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRollEditPreviewFeedback, resolveRollEditFrameDelta } from './rollEditPreview.mjs'
import { getClipPlaybackTimingAtTimeline } from './clipPlaybackTiming.js'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const makePair = (fps = 24, deltaFrames = 0) => [
  { id: 'out', type: 'video', trackId: 'v1', startTime: 24 / fps, duration: (48 + deltaFrames) / fps,
    trimStart: 2, trimEnd: 2 + (48 + deltaFrames) / fps, sourceDuration: 20, speed: 1, sourceTimeScale: 1 },
  { id: 'in', type: 'video', trackId: 'v1', startTime: (72 + deltaFrames) / fps, duration: (48 - deltaFrames) / fps,
    trimStart: 4 + deltaFrames / fps, trimEnd: 4 + 48 / fps, sourceDuration: 20, speed: 1, sourceTimeScale: 1 },
]
const makeSession = (fps = 24) => ({ clipAId: 'out', clipBId: 'in', originalEditPoint: 72 / fps,
  clipAOriginalDuration: 48 / fps, clipBOriginalStart: 72 / fps, clipBOriginalDuration: 48 / fps })
const feedback = (patch = {}) => buildRollEditPreviewFeedback({ session: makeSession(), clips: makePair(), ...patch })

test('describes actual post-store clips, last outgoing frame, first incoming frame and signed delta', () => {
  const clips = makePair(24, 5)
  const result = feedback({ clips, requestedDelta: 20 })
  assert.equal(result.outgoing.clip, clips[0])
  assert.equal(result.incoming.clip, clips[1])
  assert.equal(result.outgoing.timelineTime, 76 / 24)
  assert.equal(result.incoming.timelineTime, 77 / 24)
  assert.equal(result.cutTime, 77 / 24)
  assert.equal(result.deltaFrames, 5)
  assert.equal(result.outgoing.duration, 53 / 24)
  assert.equal(result.incoming.duration, 43 / 24)
  assert.equal(result.limit, null)
  assert.equal(feedback({ clips: makePair(24, -3), requestedDelta: 20 }).deltaFrames, -3)
})

test('keeps exact frame rate precision at 24, 30, 23.976 and 29.97 fps', () => {
  for (const fps of [24, 30, 24000 / 1001, 30000 / 1001]) {
    for (const deltaFrames of [-47, -1, 0, 1, 47]) {
      const result = feedback({ fps, session: makeSession(fps), clips: makePair(fps, deltaFrames) })
      assert.ok(result)
      assert.equal(result.deltaFrames, deltaFrames)
      assert.equal(result.cutTime, (72 + deltaFrames) / fps)
      assert.ok(Math.abs(result.outgoing.timelineTime - (71 + deltaFrames) / fps) < 1e-12)
      assert.ok(result.outgoing.timelineTime < result.cutTime)
      assert.equal(result.incoming.timelineTime, result.cutTime)
    }
  }
})

test('one-frame outgoing and incoming clips each preview their only retained frame', () => {
  for (const fps of [24, 30, 30000 / 1001]) {
    const outgoingOne = feedback({ fps, session: makeSession(fps), clips: makePair(fps, -47) })
    assert.equal(outgoingOne.outgoing.timelineTime, outgoingOne.outgoing.clip.startTime)
    const incomingOne = feedback({ fps, session: makeSession(fps), clips: makePair(fps, 47) })
    assert.equal(incomingOne.incoming.timelineTime, incomingOne.incoming.clip.startTime)
  }
})

test('same URL and source asset never collapse the two distinct clip clocks', () => {
  const clips = makePair().map(clip => ({ ...clip, assetId: 'shared', url: 'blob:shared', speed: 2 }))
  clips[0] = { ...clips[0], reverse: true, trimStart: 1, trimEnd: 5 }
  clips[1] = { ...clips[1], trimStart: 7, trimEnd: 11 }
  const result = feedback({ clips })
  assert.equal(result.outgoing.clipId, 'out')
  assert.equal(result.incoming.clipId, 'in')
  const outgoingSource = getClipPlaybackTimingAtTimeline(result.outgoing.clip, result.outgoing.timelineTime).time
  const incomingSource = getClipPlaybackTimingAtTimeline(result.incoming.clip, result.incoming.timelineTime).time
  assert.notEqual(outgoingSource, incomingSource)
  assert.equal(incomingSource, 7)
})

test('missing, duplicate, same-ID, cross-track and malformed actual pair data reject', () => {
  const clips = makePair()
  for (const candidate of [[], [clips[0]], [...clips, clips[0]], [clips[0], { ...clips[1], trackId: 'v2' }],
    [{ ...clips[0], startTime: NaN }, clips[1]], [clips[0], { ...clips[1], duration: 0 }],
    [{ ...clips[0], startTime: '1' }, clips[1]], [clips[0], { ...clips[1], duration: Infinity }]]) {
    assert.equal(feedback({ clips: candidate }), null)
  }
  assert.equal(feedback({ session: { ...makeSession(), clipBId: 'out' } }), null)
  assert.equal(feedback({ session: { ...makeSession(), originalEditPoint: NaN } }), null)
  for (const fps of [null, 0, -1, NaN, Infinity, '24']) assert.equal(feedback({ fps }), null)
})

test('off-grid, gapped, overlapping and sequential intermediate post-store pairs reject', () => {
  const clips = makePair()
  for (const delta of [0.001, 1 / 24, -1 / 24]) {
    assert.equal(feedback({ clips: [clips[0], { ...clips[1], startTime: clips[1].startTime + delta }] }), null)
  }
  const bothOffGrid = clips.map(clip => ({ ...clip, startTime: clip.startTime + 0.001 }))
  assert.equal(feedback({ clips: bothOffGrid }), null)
  assert.equal(feedback({ clips: [makePair(24, 1)[0], clips[1]] }), null)
  assert.equal(feedback({ clips: [clips[0], makePair(24, 1)[1]] }), null)
})

test('existing session outer-edge snapshots reject stale moves or changed total span', () => {
  const clips = makePair()
  assert.equal(feedback({ clips: clips.map(clip => ({ ...clip, startTime: clip.startTime + 1 })) }), null)
  assert.equal(feedback({ clips: [clips[0], { ...clips[1], duration: 3 }] }), null)
  assert.equal(feedback({ session: { ...makeSession(), clipBOriginalStart: 2 } }), null)
  assert.equal(feedback({ session: { ...makeSession(), clipAOriginalDuration: 0 } }), null)
  assert.ok(feedback({ session: { clipAId: 'out', clipBId: 'in', originalEditPoint: 3 } }))
})

test('bound feedback uses supplied label and owning clip only after actual stop is reached', () => {
  const bounds = { minimumDelta: -1, maximumDelta: 1,
    minimumLimit: { label: 'Incoming source start reached', clipId: 'in' },
    maximumLimit: { label: 'Outgoing source end reached', clipId: 'out' } }
  assert.deepEqual(feedback({ clips: makePair(24, 24), requestedDelta: 3, bounds }).limit,
    { label: 'Outgoing source end reached', clipId: 'out' })
  assert.deepEqual(feedback({ clips: makePair(24, -24), requestedDelta: -3, bounds }).limit,
    { label: 'Incoming source start reached', clipId: 'in' })
  assert.equal(feedback({ clips: makePair(24, 12), requestedDelta: 3, bounds }).limit, null)
  assert.equal(feedback({ clips: makePair(24, 24), requestedDelta: 0.9, bounds }).limit, null)
})

test('quantized source-end floors annotate the accepted frame without changing cut or preview clocks', () => {
  const bounds = { maximumDelta: 1.03, maximumLimit: { label: 'Source end reached', clipId: 'out' } }
  const result = feedback({ clips: makePair(24, 24), requestedDelta: 2, bounds })
  assert.deepEqual(result.limit, bounds.maximumLimit)
  assert.equal(result.deltaFrames, 24)
  assert.equal(result.cutTime, 4)
  assert.equal(result.outgoing.timelineTime, 95 / 24)
})

test('fractional minimum bounds label the inward-ceiled frame symmetrically without changing actual feedback', () => {
  for (const fps of [10, 24, 30, 30000 / 1001]) {
    const bounds = { minimumDelta: -2.9 / fps, minimumLimit: { label: 'Incoming source start', clipId: 'in' } }
    const clips = makePair(fps, -2), session = makeSession(fps)
    const result = feedback({ fps, session, clips, requestedDelta: -9 / fps, bounds })
    assert.deepEqual(result.limit, bounds.minimumLimit)
    assert.equal(result.cutTime, 70 / fps)
    assert.equal(result.deltaFrames, -2)
    assert.equal(result.outgoing.clip, clips[0])
    assert.equal(result.incoming.clip, clips[1])
    assert.equal(result.outgoing.timelineTime, 69 / fps)
    assert.equal(result.incoming.timelineTime, 70 / fps)
    assert.equal(feedback({ fps, session, clips, requestedDelta: -2 / fps, bounds }).limit, null)
    assert.equal(feedback({ fps, session, clips: makePair(fps, -1), requestedDelta: -9 / fps, bounds }).limit, null)
    assert.equal(feedback({ fps, session, clips: makePair(fps, -4), requestedDelta: -9 / fps, bounds }).limit, null)
  }
})

test('no-movement clicks and malformed or unrelated bounds never manufacture a limit', () => {
  for (const bounds of [undefined, { minimumDelta: 0, minimumLimit: { label: 'Stop', clipId: 'out' } },
    { maximumDelta: 0, maximumLimit: { label: 'Stop', clipId: 'missing' } },
    { maximumDelta: Infinity, maximumLimit: { label: 'Stop', clipId: 'out' } },
    { maximumDelta: 0, maximumLimit: { label: '', clipId: 'out' } },
    { minimumDelta: 1, maximumDelta: 0, maximumLimit: { label: 'Stop', clipId: 'out' } }]) {
    assert.equal(feedback({ requestedDelta: 0, bounds }).limit, null)
  }
  assert.equal(feedback({ requestedDelta: NaN, bounds: { maximumDelta: 0, maximumLimit: { label: 'Stop', clipId: 'out' } } }).limit, null)
  assert.equal(Object.is(feedback().deltaFrames, -0), false)
})

test('deep-frozen inputs stay unchanged and returned limit does not alias caller metadata', () => {
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
  const input = freeze({ session: makeSession(), clips: makePair(24, 24), fps: 24, requestedDelta: 2,
    bounds: { maximumDelta: 1, maximumLimit: { label: 'Source end reached', clipId: 'out' } } })
  const before = structuredClone(input), result = buildRollEditPreviewFeedback(input)
  assert.ok(result)
  assert.deepEqual(input, before)
  assert.notEqual(result.limit, input.bounds.maximumLimit)
  assert.equal(result.outgoing.clip, input.clips[0])
})

test('common roll delta rounds positive and negative half-frame ties once with existing timeline convention', () => {
  for (const fps of [24, 30, 24000 / 1001, 30000 / 1001]) {
    for (const [requestedFrame, expectedFrame] of [[-2.5, -2], [-1.5, -1], [-0.5, 0], [0.5, 1], [1.5, 2], [2.5, 3]]) {
      const delta = resolveRollEditFrameDelta({ requestedDelta: requestedFrame / fps, minimumDelta: -10 / fps, maximumDelta: 10 / fps, fps })
      assert.equal(delta, expectedFrame / fps)
      assert.equal(Object.is(delta, -0), false)
    }
  }
})

test('fractional source bounds round inward on either side and tolerate only frame-edge numerical noise', () => {
  for (const fps of [24, 30, 24000 / 1001, 30000 / 1001]) {
    const bounds = { minimumDelta: -2.53 / fps, maximumDelta: 3.53 / fps, fps }
    assert.equal(resolveRollEditFrameDelta({ ...bounds, requestedDelta: -1 }), -2 / fps)
    assert.equal(resolveRollEditFrameDelta({ ...bounds, requestedDelta: 1 }), 3 / fps)
    assert.equal(resolveRollEditFrameDelta({ minimumDelta: (2 + 1e-9) / fps, maximumDelta: 4 / fps, requestedDelta: 0, fps }), 2 / fps)
    assert.equal(resolveRollEditFrameDelta({ minimumDelta: 0, maximumDelta: (2 - 1e-9) / fps, requestedDelta: 1, fps }), 2 / fps)
    assert.equal(resolveRollEditFrameDelta({ minimumDelta: 0.2 / fps, maximumDelta: 0.8 / fps, requestedDelta: 0.5 / fps, fps }), null)
    assert.equal(resolveRollEditFrameDelta({ minimumDelta: -0.8 / fps, maximumDelta: -0.2 / fps, requestedDelta: -0.5 / fps, fps }), null)
  }
})

test('common-frame resolver preserves legal integer movement and repeated pixel positions without accumulating drift', () => {
  const fps = 30000 / 1001
  for (const frame of [-24, -3, 0, 1, 24]) {
    const input = Object.freeze({ requestedDelta: frame / fps, minimumDelta: -1, maximumDelta: 1, fps })
    for (let repeat = 0; repeat < 20; repeat++) assert.equal(resolveRollEditFrameDelta(input), frame / fps)
  }
  for (const pixel of [-25, -5, 0, 5, 25]) {
    const input = { requestedDelta: pixel / 100, minimumDelta: -1, maximumDelta: 1, fps: 10 }
    const expected = resolveRollEditFrameDelta(input)
    for (let repeat = 0; repeat < 20; repeat++) assert.equal(resolveRollEditFrameDelta(input), expected)
  }
})

test('common-frame resolver rejects invalid or contradictory ranges and supports explicitly unbounded sides', () => {
  const input = { requestedDelta: 0, minimumDelta: -1, maximumDelta: 1, fps: 24 }
  for (const patch of [{ requestedDelta: NaN }, { requestedDelta: Infinity }, { requestedDelta: '0' },
    { minimumDelta: undefined }, { maximumDelta: null }, { minimumDelta: 2 }, { maximumDelta: -2 },
    { minimumDelta: Infinity }, { maximumDelta: -Infinity }, { fps: 0 }, { fps: NaN }, { fps: '24' }]) {
    assert.equal(resolveRollEditFrameDelta({ ...input, ...patch }), null)
  }
  assert.equal(resolveRollEditFrameDelta({ ...input, minimumDelta: -Infinity, maximumDelta: Infinity, requestedDelta: 1 }), 1)
  assert.equal(resolveRollEditFrameDelta({ ...input, minimumDelta: 0, maximumDelta: 0, requestedDelta: 0.5 }), 0)
})

test('one common frame delta preserves both outer edges through real existing per-clip store normalization', () => {
  const require = createRequire(import.meta.url)
  const code = buildSync({ entryPoints: [fileURLToPath(new URL('../stores/timelineStore.js', import.meta.url))],
    bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'zustand', 'zustand/*'],
  }).outputFiles[0].text
  const module = { exports: {} }
  Function('require', 'module', 'exports', 'localStorage', code)(require, module, module.exports,
    { getItem: () => null, setItem() {}, removeItem() {} })
  const store = module.exports.useTimelineStore, initial = store.getState()
  try {
    for (const fps of [24, 30, 24000 / 1001, 30000 / 1001]) {
      for (const speed of [0.5, 1, 2]) {
        for (const requestedFrames of [-2.5, -0.5, 0.5, 1.5, 3]) {
          const original = makePair(fps).map(clip => ({ ...clip, speed, trimEnd: clip.trimStart + clip.duration * speed }))
          const session = makeSession(fps)
          store.setState({ ...initial, timelineFps: fps, clips: original, tracks: [{ id: 'v1', type: 'video' }], transitions: [], markers: [] })
          const delta = resolveRollEditFrameDelta({ requestedDelta: requestedFrames / fps, minimumDelta: -1, maximumDelta: 1, fps })
          assert.notEqual(delta, null)
          // Same two updates used by the rolling-edit gesture, still in the
          // existing order. Repeating a pointer position must be idempotent.
          for (let repeat = 0; repeat < 3; repeat++) {
            store.getState().updateClipTrim('out', { duration: original[0].duration + delta, trimStart: original[0].trimStart })
            store.getState().updateClipTrim('in', { startTime: original[1].startTime + delta,
              trimStart: original[1].trimStart + delta * speed, trimEnd: original[1].trimEnd })
            const [outgoing, incoming] = store.getState().clips
            assert.ok(Math.abs(outgoing.startTime - original[0].startTime) < 1e-10)
            assert.ok(Math.abs(outgoing.startTime + outgoing.duration - incoming.startTime) < 1e-10)
            assert.ok(Math.abs(incoming.startTime + incoming.duration - original[1].startTime - original[1].duration) < 1e-10)
            const result = buildRollEditPreviewFeedback({ session, clips: store.getState().clips, fps, requestedDelta: requestedFrames / fps })
            assert.ok(result)
            assert.equal(result.deltaFrames, Math.round(requestedFrames) || 0)
          }
        }
      }
    }
  } finally { store.setState({ ...initial, clips: [], tracks: [] }) }
})
