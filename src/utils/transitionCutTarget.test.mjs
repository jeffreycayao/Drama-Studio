import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TRANSITION_DRAG_TYPE,
  findTransitionCutTarget,
  isTransitionCutTargetCurrent,
  isTransitionDrag,
  parseTransitionDrag,
} from './transitionCutTarget.mjs'

const makeClip = (id, startTime, duration = 3, overrides = {}) => ({
  id, trackId: 'video-1', type: 'video', startTime, duration,
  assetId: `asset-${id}`, trimStart: 1, trimEnd: duration + 1, ...overrides,
})
const makeState = (overrides = {}) => ({
  timelineSessionId: 7,
  timelineFps: 24,
  compoundEditContext: null,
  tracks: [{ id: 'video-1', type: 'video', locked: false }],
  clips: [makeClip('a', 1), makeClip('b', 4)],
  transitions: [],
  selectedClipIds: ['unrelated'],
  ...overrides,
})
const find = (state, options = {}) => findTransitionCutTarget(state, {
  trackId: 'video-1', time: 4, pixelsPerSecond: 100, ...options,
})
const between = (overrides = {}) => ({
  id: 'transition-a-b', kind: 'between', clipAId: 'a', clipBId: 'b',
  type: 'dissolve', duration: 0.5, ...overrides,
})

test('finds the live consecutive pair without selecting or mutating the document', () => {
  const state = makeState()
  const original = structuredClone(state)
  state.clips.reverse()
  const reversed = [...state.clips]
  const target = find(state)
  assert.equal(target.clipA, state.clips[1])
  assert.equal(target.clipB, state.clips[0])
  assert.equal(target.editPoint, 4)
  assert.equal(target.distance, 0)
  assert.equal(target.timelineSessionId, 7)
  assert.equal(target.timelineFps, 24)
  assert.equal(target.transition, null)
  assert.deepEqual(state.clips, reversed, 'sorting must not reorder the store array')
  assert.deepEqual(state.selectedClipIds, original.selectedClipIds)
  assert.deepEqual({ ...state, clips: [...state.clips].reverse() }, original)
})

test('the same CSS-pixel radius works at low, normal and frame-level zoom', () => {
  const state = makeState()
  for (const pixelsPerSecond of [4, 25, 100, 1200]) {
    for (const direction of [-1, 1]) {
      assert.ok(find(state, { time: 4 + direction * 7.9 / pixelsPerSecond, pixelsPerSecond }), `${pixelsPerSecond}px/s inside`)
      assert.equal(find(state, { time: 4 + direction * 8.1 / pixelsPerSecond, pixelsPerSecond }), null, `${pixelsPerSecond}px/s outside`)
    }
  }
  assert.ok(find(state, { time: 4.5, pixelsPerSecond: 16 }), 'radius boundary is inclusive')
  assert.ok(find(state, { radiusPx: 0 }), 'exact cut works with zero radius')
  assert.equal(find(state, { time: 4.001, radiusPx: 0 }), null)
  assert.equal(find(state, { time: 4.04, radiusPx: 3 }), null, 'custom radius is respected')
})

test('rejects invalid pointer, zoom and radius inputs', () => {
  for (const options of [
    { time: NaN }, { time: Infinity }, { time: '4' },
    { pixelsPerSecond: 0 }, { pixelsPerSecond: -1 }, { pixelsPerSecond: Infinity }, { pixelsPerSecond: '100' },
    { radiusPx: -1 }, { radiusPx: NaN }, { radiusPx: Infinity },
  ]) assert.equal(find(makeState(), options), null, JSON.stringify(options))
  assert.equal(find(null), null)
  assert.equal(find(undefined), null)
  assert.equal(findTransitionCutTarget(makeState()), null)
})

test('accepts only numerical butt-cut tolerance, not a visible gap or overlap', () => {
  for (const offset of [-0.0005, 0, 0.0005]) {
    assert.ok(find(makeState({ clips: [makeClip('a', 1), makeClip('b', 4 + offset)] })), `rounding tolerance ${offset}`)
  }
  for (const offset of [-1, -0.01, -0.0011, 0.0011, 0.01, 0.25]) {
    assert.equal(find(makeState({ clips: [makeClip('a', 1), makeClip('b', 4 + offset)] })), null, `not a cut ${offset}`)
  }
  assert.equal(find(makeState({ timelineFps: 1000, clips: [makeClip('a', 1), makeClip('b', 4.0002)] })), null,
    'very high FPS tightens tolerance below 1ms')
})

test('nonconsecutive clips cannot become a cut merely because their endpoints meet', () => {
  const state = makeState({ clips: [makeClip('a', 1), makeClip('inserted', 3.75, 0.125), makeClip('b', 4)] })
  assert.equal(find(state), null)
})

test('a third clip crossing the cut on the same track makes it ambiguous', () => {
  assert.equal(find(makeState({ clips: [makeClip('cover', 0, 8), makeClip('a', 1), makeClip('b', 4)] })), null)
  assert.ok(find(makeState({ clips: [makeClip('cover', 0, 8, { trackId: 'video-2' }), makeClip('a', 1), makeClip('b', 4)] })),
    'layers on another track do not obstruct the target track')
})

test('chooses the nearest cut but refuses equal or subpixel-ambiguous candidates', () => {
  const state = makeState({ clips: [makeClip('a', 1), makeClip('b', 4, 0.08), makeClip('c', 4.08)] })
  assert.equal(find(state, { time: 4.01 }).clipA.id, 'a')
  assert.equal(find(state, { time: 4.07 }).clipA.id, 'b')
  assert.equal(find(state, { time: 4.04 }), null)
  assert.equal(find(state, { time: 4.0402 }), null, 'less than 0.1px difference remains ambiguous')
})

test('requires a present unlocked visual track outside the captions and compound contexts', () => {
  for (const overrides of [
    { tracks: [] },
    { tracks: [{ id: 'video-1', type: 'audio' }] },
    { tracks: [{ id: 'video-1', type: 'video', locked: true }] },
    { tracks: [{ id: 'video-1', type: 'video', role: 'captions' }] },
    { compoundEditContext: { compoundClipId: 'compound-1' } },
  ]) assert.equal(find(makeState(overrides)), null, JSON.stringify(overrides))
  assert.equal(find(makeState(), { trackId: 'missing-track' }), null)
})

test('accepts supported visual clips but rejects unsupported clip types at either side', () => {
  for (const type of ['video', 'image', 'text', 'shape']) {
    assert.ok(find(makeState({ clips: [makeClip('a', 1, 3, { type }), makeClip('b', 4, 3, { type })] })), type)
  }
  for (const type of ['compound', 'adjustment', 'audio', 'caption', 'unknown', undefined]) {
    for (const side of [0, 1]) {
      const state = makeState()
      state.clips[side] = { ...state.clips[side], type }
      assert.equal(find(state), null, `${String(type)} side ${side}`)
    }
  }
})

test('sync locks preserve transition eligibility because resolving does not change timing', () => {
  const state = makeState()
  state.clips[0] = { ...state.clips[0], lockMode: 'sync', syncLock: { mode: 'sync', startTime: 1, duration: 3 } }
  const before = structuredClone(state)
  assert.ok(find(state))
  assert.deepEqual(state, before)
})

test('rejects malformed clip timing and pairs spanning tracks', () => {
  for (const update of [
    { startTime: NaN }, { startTime: Infinity }, { startTime: '1' },
    { duration: 0 }, { duration: -1 }, { duration: NaN }, { duration: Infinity }, { duration: '3' },
    { trackId: 'video-2' },
  ]) {
    const state = makeState()
    state.clips[0] = { ...state.clips[0], ...update }
    assert.equal(find(state), null, JSON.stringify(update))
  }
})

test('existing between transitions require opt-in, including reverse and legacy pairs', () => {
  for (const transition of [between(), between({ clipAId: 'b', clipBId: 'a' }), between({ kind: undefined })]) {
    const state = makeState({ transitions: [transition] })
    assert.equal(find(state), null)
    assert.equal(find(state, { allowExisting: true }).transition, transition)
  }
})

test('edge transitions and unrelated transitions do not hide an available cut', () => {
  for (const transition of [
    { id: 'edge', kind: 'edge', clipId: 'a', edge: 'out' },
    between({ clipAId: 'other-a', clipBId: 'other-b' }),
  ]) assert.equal(find(makeState({ transitions: [transition] })).transition, null)
})

test('existing transition menu targets require opt-in and retain the exact transition snapshot', () => {
  const transition = between()
  const state = makeState({ transitions: [transition] })
  const target = find(state, { allowExisting: true })
  assert.equal(isTransitionCutTargetCurrent(state, target), false)
  assert.equal(isTransitionCutTargetCurrent(state, target, { allowExisting: true }), true)
  for (const transitions of [[], [{ ...transition }], [{ ...transition, duration: 2 }]]) {
    assert.equal(isTransitionCutTargetCurrent({ ...state, transitions }, target, { allowExisting: true }), false)
  }
  assert.equal(isTransitionCutTargetCurrent({ ...state, selectedClipIds: ['b'] }, target, { allowExisting: true }), true)
})

test('current-target validation accepts unchanged live references and unrelated selection changes', () => {
  const state = makeState(), target = find(state)
  assert.equal(isTransitionCutTargetCurrent(state, target), true)
  assert.equal(isTransitionCutTargetCurrent({ ...state, selectedClipIds: ['b'], playheadPosition: 99 }, target), true)
  assert.equal(isTransitionCutTargetCurrent({ ...state, tracks: state.tracks.map(track => ({ ...track, name: 'Renamed' })) }, target), true)
  assert.equal(isTransitionCutTargetCurrent(state, null), false)
  assert.equal(isTransitionCutTargetCurrent(null, target), false)
  assert.equal(isTransitionCutTargetCurrent(undefined, target), false)
})

test('a session, FPS or compound navigation change invalidates the captured menu', () => {
  const state = makeState(), target = find(state)
  for (const update of [
    { timelineSessionId: 8 }, { timelineFps: 30 },
    { compoundEditContext: { compoundClipId: 'compound-1' } },
  ]) assert.equal(isTransitionCutTargetCurrent({ ...state, ...update }, target), false, JSON.stringify(update))
})

test('either clip replacement invalidates the menu even with identical IDs and cut timing', () => {
  for (const side of [0, 1]) {
    const state = makeState(), target = find(state)
    const copiedClips = [...state.clips]
    copiedClips[side] = { ...copiedClips[side] }
    assert.equal(isTransitionCutTargetCurrent({ ...state, clips: copiedClips }, target), false, `same-value reference replacement ${side}`)
    copiedClips[side] = { ...copiedClips[side], assetId: 'replacement-source', url: 'blob:replacement' }
    assert.equal(isTransitionCutTargetCurrent({ ...state, clips: copiedClips }, target), false, `source replacement ${side}`)
  }
})

test('deletion, movement, track lock, competing layer or newly added transition invalidates the menu', () => {
  const state = makeState(), target = find(state)
  for (const update of [
    { clips: [state.clips[0]] },
    { clips: [state.clips[0], { ...state.clips[1], startTime: 4.25 }] },
    { tracks: [{ ...state.tracks[0], locked: true }] },
    { tracks: [] },
    { clips: [makeClip('cover', 0, 8), ...state.clips] },
    { transitions: [between()] },
  ]) assert.equal(isTransitionCutTargetCurrent({ ...state, ...update }, target), false, JSON.stringify(update))
})

test('detects native protected-mode transition drags from types without reading payload data', () => {
  let reads = 0
  const transfer = {
    types: ['text/plain', TRANSITION_DRAG_TYPE],
    getData() { reads += 1; throw new Error('protected drag data must not be read') },
  }
  assert.equal(isTransitionDrag(transfer), true)
  assert.equal(reads, 0)
  assert.equal(isTransitionDrag({ types: { 0: TRANSITION_DRAG_TYPE, length: 1 } }), true, 'array-like browser list')
  assert.equal(isTransitionDrag({ types: new Set([TRANSITION_DRAG_TYPE]) }), true, 'iterable browser list')
})

test('does not mistake effect, asset, text or file drags for transitions', () => {
  for (const types of [[], ['Files'], ['text/plain'], ['application/x-comfystudio-effect'],
    ['application/x-comfystudio-asset-ids'], [`${TRANSITION_DRAG_TYPE}-extra`]]) {
    assert.equal(isTransitionDrag({ types, getData() { throw new Error('must not inspect payload') } }), false, types.join(','))
  }
  assert.equal(isTransitionDrag(null), false)
  assert.equal(isTransitionDrag(undefined), false)
  assert.equal(isTransitionDrag({}), false)
})

test('parses only a recognized type and finite positive numeric duration at drop', () => {
  const source = { type: 'dissolve', duration: 0.75, ignored: 'not copied' }
  const transfer = { getData(type) { assert.equal(type, TRANSITION_DRAG_TYPE); return JSON.stringify(source) } }
  assert.deepEqual(parseTransitionDrag(transfer, ['dissolve', 'wipe']), { type: 'dissolve', duration: 0.75 })
  assert.equal(parseTransitionDrag(transfer, ['wipe']), null)
})

test('malformed, protected, unknown and nonnumeric drag payloads fail closed', () => {
  for (const raw of [
    '', '{', 'null', '[]', '42', '"dissolve"', '{}',
    '{"type":"unknown","duration":0.5}',
    '{"type":"dissolve"}', '{"duration":0.5}',
    '{"type":"dissolve","duration":"0.5"}', '{"type":"dissolve","duration":null}',
    '{"type":"dissolve","duration":0}', '{"type":"dissolve","duration":-0.5}',
    '{"type":"dissolve","duration":1e400}', '{"type":"dissolve","duration":true}',
  ]) assert.equal(parseTransitionDrag({ getData: () => raw }, ['dissolve']), null, raw)
  assert.equal(parseTransitionDrag({ getData() { throw new Error('protected data') } }, ['dissolve']), null)
  assert.equal(parseTransitionDrag(null, ['dissolve']), null)
  assert.equal(parseTransitionDrag({}, ['dissolve']), null)
})
