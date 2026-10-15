import test from 'node:test'
import assert from 'node:assert/strict'
import { planCloseTimelineGap } from './closeTimelineGap.mjs'

const clip = (id, trackId, startTime, duration, patch = {}) => ({ id, trackId, startTime, duration,
  type: trackId.startsWith('a') ? 'audio' : 'video', trimStart: 1, trimEnd: duration + 1, ...patch })
const input = (patch = {}) => ({ fps: 24, gap: { trackId: 'v', startTime: 2, endTime: 3.125 },
  tracks: [{ id: 'v', type: 'video', name: 'Picture' }, { id: 'a1', type: 'audio', name: 'Dialogue' },
    { id: 'a2', type: 'audio', name: 'Second recording', muted: true, visible: false }],
  clips: [clip('before', 'v', 0, 2), clip('picture', 'v', 3.125, 3, { linkGroupId: 'take' }),
    clip('dialogue', 'a1', 3.125, 3, { linkGroupId: 'take' }), clip('recording', 'a2', 10, 4, { enabled: false })],
  transitions: [], ...patch })
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze) }
  return value
}
const good = data => { const result = planCloseTimelineGap(freeze(data)); assert.equal(result.ok, true, result.reason); return result }
const rejected = (data, code) => {
  const original = structuredClone(data), result = planCloseTimelineGap(freeze(data))
  assert.equal(result.ok, false); assert.equal(result.changed, false); assert.equal(result.code, code)
  assert.equal('clips' in result, false); assert.deepEqual(data, original)
  return result
}
const byId = (plan, id) => plan.clips.find(clip => clip.id === id)

test('27-frame gap closes every track, including muted hidden independent audio, without changing source timing', () => {
  const data = input(), envelope = { version: 1, offsetSeconds: 2, points: [{ time: 0, db: -6 }] }
  Object.assign(data.clips[3], { speed: 1.5, reverse: true, volumeEnvelope: envelope, effects: [{ type: 'gain' }], keyframes: { opacity: [{ time: 1, value: 50 }] } })
  const result = good(data)
  assert.equal(result.deltaFrames, 27); assert.equal(result.deltaSeconds, 1.125)
  assert.deepEqual(result.shiftedClipIds, ['picture', 'dialogue', 'recording'])
  assert.deepEqual(result.affectedTrackIds, ['v', 'a1', 'a2'])
  assert.equal(byId(result, 'picture').startTime, 2); assert.equal(byId(result, 'dialogue').startTime, 2)
  assert.equal(byId(result, 'recording').startTime, 8.875)
  assert.equal(byId(result, 'before'), data.clips[0]); assert.equal(result.transitions, data.transitions)
  for (const item of data.clips) assert.deepEqual({ ...byId(result, item.id), startTime: item.startTime }, item)
  assert.equal(byId(result, 'recording').volumeEnvelope, envelope)
})

test('integer and fractional rates use integer frame subtraction without accumulated rounding', () => {
  for (const fps of [24, 25, 30, 60, 24000 / 1001, 30000 / 1001]) {
    const data = input({ fps, gap: { trackId: 'v', startTime: 48 / fps, endTime: 75 / fps },
      clips: [clip('before', 'v', 0, 48 / fps), clip('picture', 'v', 75 / fps, 25 / fps), clip('recording', 'a2', 300 / fps, 72 / fps)] })
    const result = good(data)
    assert.equal(byId(result, 'picture').startTime, 48 / fps)
    assert.equal(byId(result, 'recording').startTime, 273 / fps)
    assert.equal(result.deltaFrames, 27)
  }
})

test('leading gap is supported; empty tail and stale or partial selections are refused', () => {
  const leading = input({ gap: { trackId: 'v', startTime: 0, endTime: 3.125 } })
  leading.clips.shift()
  assert.equal(byId(good(leading), 'picture').startTime, 0)
  rejected(input({ gap: { trackId: 'v', startTime: 6.125, endTime: 10 } }), 'stale-gap')
  rejected(input({ gap: { trackId: 'v', startTime: 2.5, endTime: 3.125 } }), 'stale-gap')
  rejected(input({ gap: { trackId: 'v', startTime: 2, endTime: 3 } }), 'stale-gap')
  rejected(input({ gap: { trackId: 'missing', startTime: 2, endTime: 3.125 } }), 'stale-gap')
  const occupied = input(); occupied.clips.push(clip('new', 'v', 2, 1))
  rejected(occupied, 'stale-gap')
})

test('any media inside the interval refuses the whole edit, even if hidden, muted, disabled or locked', () => {
  for (const [start, duration] of [[0, 8], [2, 1], [1, 1.5], [3, 3]]) {
    for (const patch of [{}, { enabled: false }, { locked: true }, { type: 'text' }]) {
      const data = input(); data.clips.push(clip('music', 'a2', start, duration, { name: 'Music bed', ...patch }))
      const result = rejected(data, 'occupied-range')
      assert.match(result.reason, /Music bed/); assert.match(result.reason, /Second recording/)
    }
  }
  const boundaries = input(); boundaries.clips.push(clip('left-boundary', 'a2', 0, 2), clip('right-boundary', 'a2', 3.125, 1))
  assert.equal(byId(good(boundaries), 'right-boundary').startTime, 2)
})

test('every downstream track/clip lock representation refuses, but unrelated earlier locks do not', () => {
  for (const lock of [{ locked: true }, { syncLocked: true }, { lockMode: 'sync' }, { syncLock: { mode: 'sync' } }]) {
    const track = input(); Object.assign(track.tracks[2], lock); rejected(track, 'locked-participant')
    const audio = input(); Object.assign(audio.clips[3], lock); rejected(audio, 'locked-participant')
    const selected = input(); Object.assign(selected.tracks[0], lock); rejected(selected, 'locked-track')
    const earlier = input(); Object.assign(earlier.clips[0], lock); good(earlier)
  }
  const busy = input(); busy.clips[3].opticalFlowCache = { status: 'rendering' }; rejected(busy, 'busy-participant')
})

test('all linked members must move together; singleton and wholly downstream groups remain intact', () => {
  const data = input(); data.clips[0].linkGroupId = ' take '
  rejected(data, 'partial-link')
  const singleton = input(); singleton.clips[3].linkGroupId = 'independent'; good(singleton)
  const invalid = input(); invalid.clips[3].linkGroupId = 3; rejected(invalid, 'invalid-link')
})

test('attached edge and between transition absolute times move with clips; stationary transitions retain identity', () => {
  const data = input()
  data.clips.push(clip('next-picture', 'v', 6.125, 2))
  data.transitions = [
    { id: 'before-fade', kind: 'edge', clipId: 'before', edge: 'in', duration: .5, startTime: 0, endTime: .5 },
    { id: 'fade', kind: 'edge', clipId: 'recording', edge: 'in', duration: .5, startTime: 10, endTime: 10.5 },
    { id: 'between', kind: 'between', clipAId: 'picture', clipBId: 'next-picture', duration: 1, editPoint: 6.125,
      startTime: 5.625, endTime: 6.625, originalClipAStart: 3.125, originalClipAEnd: 6.125, originalClipBStart: 6.125, originalClipBEnd: 8.125 },
  ]
  const result = good(data)
  assert.equal(result.transitions[0], data.transitions[0])
  assert.equal(result.transitions[1].startTime, 8.875); assert.equal(result.transitions[1].endTime, 9.375)
  assert.equal(result.transitions[2].editPoint, 5); assert.equal(result.transitions[2].originalClipAStart, 2)
  assert.equal(result.transitions[2].originalClipBEnd, 7); assert.equal(result.transitions[2].duration, 1)
})

test('unsafe affected transitions fail without deleting or detaching their relationships', () => {
  const edge = { id: 'fade', kind: 'edge', clipId: 'recording', edge: 'in', duration: .5 }
  for (const patch of [{ clipId: undefined }, { kind: 'unknown' }, { duration: NaN }, { clipAId: 'picture' }, { edge: 'bad' }]) {
    rejected(input({ transitions: [{ ...edge, ...patch }] }), 'invalid-transition')
  }
  rejected(input({ transitions: [{ ...edge, startTime: 0 }] }), 'invalid-transition-time')
  rejected(input({ transitions: [{ id: 'bridge', kind: 'between', clipAId: 'before', clipBId: 'picture', duration: .5 }] }), 'partial-transition')
  rejected(input({ transitions: [edge, { ...edge }] }), 'invalid-transition')
  const stationaryDuplicate = { ...edge, clipId: 'before' }
  for (const transitions of [[edge, stationaryDuplicate], [stationaryDuplicate, edge]]) {
    rejected(input({ transitions }), 'invalid-transition')
  }
})

test('malformed input and frame timing cannot be silently coerced into an edit', () => {
  for (const patch of [{ clips: null }, { tracks: null }, { transitions: null }, { fps: 0 }, { fps: NaN }, { fps: '24' }, { gap: null }]) rejected(input(patch), 'invalid-gap')
  for (const gap of [{ trackId: 'v', startTime: -1, endTime: 3.125 }, { trackId: 'v', startTime: 2, endTime: 2 },
    { trackId: 'v', startTime: 2.01, endTime: 3.125 }, { trackId: 'v', startTime: 2, endTime: Infinity }]) rejected(input({ gap }), 'invalid-gap')
  const duplicateTrack = input(); duplicateTrack.tracks.push({ ...duplicateTrack.tracks[0] }); rejected(duplicateTrack, 'invalid-track')
  for (const patch of [{ startTime: NaN }, { duration: 0 }, { trackId: 'missing' }, { id: 'before' }]) {
    const data = input(); Object.assign(data.clips[3], patch); rejected(data, 'invalid-clip')
  }
  const offFrame = input(); offFrame.clips[3].startTime = 10.01; rejected(offFrame, 'invalid-timing')
})
