import test from 'node:test'
import assert from 'node:assert/strict'
import { createSlideEditSession, planSlideEdit, buildSlideEditPreviewFeedback } from './slideEdit.mjs'
import { getClipPlaybackTimingAtTimeline } from './clipPlaybackTiming.js'

const track = { id: 'v', type: 'video' }
const clip = (id, startTime, duration, trimStart, patch = {}) => ({ id, type: 'video', trackId: 'v',
  startTime, duration, trimStart, trimEnd: trimStart + duration, sourceDuration: 20,
  speed: 1, reverse: false, sourceTimeScale: 1, sourceFps: 10, timelineFps: 10, ...patch })
const trio = () => [clip('previous', 2, 3, 1), clip('middle', 5, 2, 2), clip('next', 7, 3, 2)]
const create = (clips = trio(), overrides = {}) => createSlideEditSession({ clips, tracks: [track], clipId: 'middle', fps: 10, ...overrides })
const plan = (session, delta) => {
  const result = planSlideEdit({ session, requestedDelta: delta })
  assert.equal(result.ok, true, result.reason)
  return result
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`)
const raw = (clip, timelineTime) => getClipPlaybackTimingAtTimeline(clip, timelineTime, { useFrameSampling: false, endOffset: 0 }).rawTime

test('Slide changes exactly three placements/edges while keeping the middle source and local metadata untouched', () => {
  const clips = trio().map(clip => ({ ...clip, url: 'shared.mp4', effects: [{ id: clip.id, type: 'filmGrain' }],
    keyframes: { opacity: [{ time: 0, value: 1 }, { time: 3, value: .2 }] }, masks: [{ shape: 'ellipse' }],
    opticalFlowCache: { status: 'ready', path: '/cache/source.mp4' }, cacheStatus: 'ready', cacheUrl: 'cache://bake' }))
  clips.push(clip('outside', 20, 2, 0), { ...clip('overlay', 0, 20, 0), trackId: 'overlay' })
  const frozen = structuredClone(clips)
  const result = create(clips); assert.equal(result.ok, true)
  const edited = plan(result.session, .4)
  assert.deepEqual(edited.clips.slice(0, 3).map(c => [c.startTime, c.duration, c.trimStart, c.trimEnd]),
    [[2, 3.4, 1, 4.4], [5.4, 2, 2, 4], [7.4, 2.6, 2.4, 5]])
  assert.deepEqual({ ...edited.clips[1], startTime: clips[1].startTime }, clips[1])
  for (let index = 0; index < 3; index++) for (const key of ['effects', 'keyframes', 'masks', 'opticalFlowCache', 'cacheUrl']) assert.equal(edited.clips[index][key], clips[index][key])
  assert.equal(edited.clips[3], clips[3]); assert.equal(edited.clips[4], clips[4]); assert.deepEqual(clips, frozen)
  assert.equal(edited.feedback.outgoing.clip, edited.clips[0]); assert.equal(edited.feedback.incoming.clip, edited.clips[2])
  near(edited.feedback.outgoing.timelineTime, 5.3); near(edited.feedback.incoming.timelineTime, 7.4)
  assert.equal(edited.feedback.middle.clip, edited.clips[1]); assert.equal(edited.feedback.deltaFrames, 4)
  assert.equal(plan(result.session, 0).clips, clips)
})

test('constant speed/reverse source clocks preserve the shot and retained neighbor source samples', () => {
  for (const speedPrevious of [.5, 2]) for (const speedNext of [.5, 2]) for (let orientation = 0; orientation < 8; orientation++) {
    const clips = trio().map((clip, index) => {
      const speed = index === 0 ? speedPrevious : index === 2 ? speedNext : 2
      return { ...clip, speed, trimStart: 5.017, trimEnd: 5.017 + clip.duration * speed, reverse: Boolean(orientation & 1 << index) }
    })
    const result = create(clips); assert.equal(result.ok, true, result.reason)
    for (const delta of [-.4, .4]) {
      const { clips: updated } = plan(result.session, delta)
      near(raw(updated[0], 3), raw(clips[0], 3))
      near(raw(updated[1], updated[1].startTime + .8), raw(clips[1], clips[1].startTime + .8))
      near(raw(updated[2], 8), raw(clips[2], 8))
      assert.equal(updated[1].trimStart, clips[1].trimStart); assert.equal(updated[1].trimEnd, clips[1].trimEnd)
    }
  }
})

test('source bounds use each neighbor playback orientation and inward timeline-frame limits', () => {
  for (const reverse of [false, true]) {
    const clips = trio()
    clips[0] = { ...clips[0], reverse, trimStart: reverse ? .26 : 16.74, trimEnd: reverse ? 3.26 : 19.74 }
    clips[2] = { ...clips[2], reverse, trimStart: reverse ? 16.74 : .26, trimEnd: reverse ? 19.74 : 3.26 }
    const result = create(clips); assert.equal(result.ok, true)
    near(result.bounds.minimumDelta, -.26); near(result.bounds.maximumDelta, .26)
    const min = plan(result.session, -1), max = plan(result.session, 1)
    assert.equal(min.delta, -.2); assert.equal(max.delta, .2)
    assert.match(min.feedback.limit.label, reverse ? /Next source end/ : /Next source start/)
    assert.match(max.feedback.limit.label, reverse ? /Previous source start/ : /Previous source end/)
    assert.equal(plan(result.session, -.24).feedback.limit, null)
    assert.equal(plan(result.session, .24).feedback.limit, null)
  }
})

test('one common frame delta handles half ties and fractional FPS without shifting outer edges', () => {
  for (const fps of [10, 24, 30, 24000 / 1001, 30000 / 1001]) {
    const clips = ['previous', 'middle', 'next'].map((id, index) => clip(id, [20, 50, 70][index] / fps, [30, 20, 30][index] / fps, 2))
    const result = create(clips, { fps }); assert.equal(result.ok, true)
    for (const [frames, accepted] of [[.5, 1], [-.5, 0], [3.2, 3], [-3.2, -3]]) {
      const edited = plan(result.session, frames / fps)
      assert.equal(edited.feedback.deltaFrames, accepted)
      near(edited.clips[0].startTime, clips[0].startTime)
      near(edited.clips[2].startTime + edited.clips[2].duration, clips[2].startTime + clips[2].duration)
      for (const c of edited.clips) near(c.startTime * fps, Math.round(c.startTime * fps))
    }
  }
})

test('generators with null/undefined/Infinity source duration are unlimited in both directions including reverse', () => {
  for (const type of ['image', 'text', 'shape', 'adjustment']) for (const sourceDuration of [null, undefined, Infinity]) for (const reverse of [false, true]) {
    const clips = trio().map(c => ({ ...c, type, sourceDuration, trimStart: 0, trimEnd: .1, reverse }))
    const result = create(clips); assert.equal(result.ok, true, result.reason)
    for (const [delta, expected] of [[-99, -2.9], [99, 2.9]]) {
      const edited = plan(result.session, delta)
      assert.equal(edited.delta, expected)
      for (const index of [0, 2]) {
        assert.equal(edited.clips[index].trimStart, 0); near(edited.clips[index].trimEnd, edited.clips[index].duration)
      }
      assert.equal(edited.clips[1].trimEnd, .1, 'moving middle does not normalize even stale generator trims')
    }
  }
})

test('next head advances the original volume envelope once; middle and previous fades/EQ/envelopes stay exact', () => {
  const volumeEnvelope = { version: 1, offsetSeconds: .25, points: [{ id: 'a', time: -1, db: -12 }, { id: 'b', time: 3, db: 0 }] }
  const clips = trio().map(c => ({ ...c, type: 'audio', trackId: 'a', volumeEnvelope, fadeIn: 9, fadeOut: 9,
    audioEq: { version: 1, enabled: true, lowCut: true, bassDb: 2, midDb: 0, trebleDb: 0 } }))
  const result = create(clips, { tracks: [{ id: 'a', type: 'audio' }] }); assert.equal(result.ok, true)
  for (const delta of [.4, -.3, .4]) {
    const edited = plan(result.session, delta)
    assert.equal(edited.clips[0].volumeEnvelope, volumeEnvelope); assert.equal(edited.clips[1].volumeEnvelope, volumeEnvelope)
    near(edited.clips[2].volumeEnvelope.offsetSeconds, .25 + delta)
    assert.deepEqual(edited.clips[2].volumeEnvelope.points, volumeEnvelope.points)
    for (let i = 0; i < 3; i++) for (const key of ['fadeIn', 'fadeOut', 'audioEq']) assert.equal(edited.clips[i][key], clips[i][key])
  }
  clips[2] = { ...clips[2], volumeEnvelope: { ...volumeEnvelope, points: [{ id: 'a', time: 0, db: 100 }] } }
  assert.equal(create(clips, { tracks: [{ id: 'a', type: 'audio' }] }).ok, false)
})

test('missing, gapped, overlapping, duplicate and malformed triplets fail closed', () => {
  const cases = [[], trio().slice(1), [...trio(), { ...trio()[0], id: 'ambiguous' }], [...trio(), { ...trio()[1] }],
    trio().map((c, i) => i === 0 ? { ...c, duration: 2.9 } : c), trio().map((c, i) => i === 2 ? { ...c, startTime: 6.9 } : c),
    [...trio(), clip('overlap', 3, 1, 0)], trio().map((c, i) => i === 1 ? { ...c, duration: 2.01 } : c),
    trio().map((c, i) => i === 1 ? { ...c, trackId: undefined } : c), [null, { id: 'middle' }],
    [...trio(), clip('broken', NaN, 1, 0)]]
  for (const clips of cases) assert.equal(create(clips).ok, false, JSON.stringify(clips))
  assert.equal(create([null, { id: 'middle' }], { tracks: [{}] }).ok, false)
  assert.equal(create(trio(), { tracks: [track, track] }).ok, false)
})

test('unsupported clocks, ramps, captions, compounds, locks and jobs on any affected clip refuse', () => {
  const patches = [{ speed: 0 }, { reverse: 'yes' }, { sourceTimeScale: .5 }, { sourceDuration: null }, { trimStart: -1 }, { trimEnd: 19 },
    { keyframes: { speed: [{ time: 0, value: 1 }] } }, { speedRamp: [{ time: 0, value: 1 }] }, { timeRemap: { points: [1] } },
    { type: 'compound' }, { compound: {} }, { metadata: { captionScope: 'timeline' } }, { settings: { overlayKind: 'captions' } },
    { locked: true }, { syncLocked: true }, { syncLock: { mode: 'sync' } }, { lockMode: 'sync' },
    { cacheStatus: 'rendering' }, { opticalFlowCache: { status: 'processing' } }]
  for (let index = 0; index < 3; index++) for (const patch of patches) {
    const clips = trio(); clips[index] = { ...clips[index], ...patch }
    assert.equal(create(clips).ok, false, `${index} ${JSON.stringify(patch)}`)
  }
  for (const patch of [{ locked: true }, { syncLocked: true }, { type: 'captions' }]) assert.equal(create(trio(), { tracks: [{ ...track, ...patch }] }).ok, false)
})

test('active links and all related transition shapes refuse; orphan links and unrelated relationships stay intact', () => {
  for (let index = 0; index < 3; index++) {
    const clips = trio(); clips[index] = { ...clips[index], linkGroupId: 'link' }
    assert.equal(create(clips).ok, true, 'orphan label is not an active relationship')
    assert.equal(create([...clips, { ...clip('mate', 0, 1, 0), trackId: 'other', linkGroupId: 'link' }]).ok, false)
    for (const key of ['clipId', 'clipAId', 'clipBId']) assert.equal(create(trio(), { transitions: [{ id: 't', [key]: clips[index].id }] }).ok, false)
  }
  assert.equal(create(trio(), { transitions: [{ id: 'other', clipId: 'elsewhere' }] }).ok, true)
})

test('outside-track data is untouched and unrelated offgrid timing does not prevent a fractional-FPS Slide', () => {
  const fps = 24000 / 1001
  const clips = ['previous', 'middle', 'next'].map((id, index) => clip(id, [20, 50, 70][index] / fps, [30, 20, 30][index] / fps, 2))
  clips.push(clip('downstream', 20, 2, 0), { ...clip('outside', 0, 1, 0), trackId: 'other', locked: true, speedRamp: [1] })
  const result = create(clips, { fps }); assert.equal(result.ok, true)
  const edited = plan(result.session, 5 / fps)
  assert.equal(edited.clips[3], clips[3]); assert.equal(edited.clips[4], clips[4])
})

test('invalid deltas and unsafe frame coordinates refuse without changing inputs', () => {
  const result = create(); assert.equal(result.ok, true)
  for (const delta of [null, undefined, NaN, Infinity, '1', {}]) assert.equal(planSlideEdit({ session: result.session, requestedDelta: delta }).ok, false)
  const huge = trio().map(c => ({ ...c, startTime: c.startTime + Number.MAX_SAFE_INTEGER }))
  assert.equal(create(huge).ok, false)
  assert.equal(create(trio(), { fps: Infinity }).ok, false)
  assert.equal(create(trio(), { fps: 0 }).ok, false)
})

test('feedback rejects uncommitted, missing, duplicate, offgrid, source-changed or nonadjacent actual clips', () => {
  const result = create(); const edited = plan(result.session, .4)
  const feedback = clips => buildSlideEditPreviewFeedback({ session: result.session, clips, requestedDelta: .4 })
  assert.equal(feedback(edited.clips).middle.clip, edited.clips[1])
  for (const clips of [edited.clips.slice(1), [...edited.clips, edited.clips[1]],
    edited.clips.map((c, i) => i === 1 ? { ...c, trimStart: 3 } : c),
    edited.clips.map((c, i) => i === 1 ? { ...c, startTime: 5.41 } : c),
    edited.clips.map((c, i) => i === 2 ? { ...c, duration: 2.5 } : c)]) assert.equal(feedback(clips), null)
})
