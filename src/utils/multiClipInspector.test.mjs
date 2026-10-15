import test from 'node:test'
import assert from 'node:assert/strict'
import { getMultiClipSelection, getMultiClipFieldState, planMultiClipInspectorEdit, planMultiClipInspectorUpdates } from './multiClipInspector.js'

const makeState = () => ({
  tracks: [{ id: 'v', type: 'video' }, { id: 'a', type: 'audio' }, { id: 'locked', type: 'video', locked: true }],
  clips: [
    { id: 'one', type: 'video', trackId: 'v', startTime: 1, duration: 2, assetId: 'media', trimStart: 3, linkGroupId: 'linked', transform: { positionX: 20, scaleX: 100, scaleY: 100, scaleLinked: true, opacity: 80 }, keyframes: { rotation: [{ time: 0, value: 15, easing: 'linear' }] }, effects: [{ id: 'fx' }] },
    { id: 'two', type: 'image', trackId: 'v', startTime: 5, duration: 3, transform: { positionX: -10, scaleX: 150, scaleY: 90, scaleLinked: false, opacity: 50 } },
    { id: 'sound', type: 'audio', trackId: 'a', gainDb: 2, fadeIn: 0.5, fadeOut: 0.2 },
    { id: 'sound2', type: 'audio', trackId: 'a', gainDb: -4 },
    { id: 'locked', type: 'video', trackId: 'locked', transform: { positionX: 99 } },
    { id: 'orphan', type: 'image', trackId: 'missing' },
  ],
})
const plan = (state, request = {}) => planMultiClipInspectorEdit(state, { clipIds: state.clips.map(c => c.id), property: 'positionX', value: 50, ...request })

test('selection separates visual/audio targets and excludes locked/missing tracks', () => {
  const state = makeState()
  const selection = getMultiClipSelection(state.clips, state.tracks, [...state.clips.map(c => c.id), 'one', 'missing'])
  assert.equal(selection.selected.length, 6)
  assert.deepEqual(selection.visual.map(c => c.id), ['one', 'two'])
  assert.equal(selection.audio.length, 2)
  assert.equal(selection.lockedCount, 1)
  assert.equal(selection.unsupportedCount, 1)
})

test('shared values use legacy defaults and show mixed values without choosing a primary clip', () => {
  const state = makeState()
  const selection = getMultiClipSelection(state.clips, state.tracks, ['one', 'two'])
  assert.equal(getMultiClipFieldState(selection, 'positionX').mixed, true)
  assert.equal(getMultiClipFieldState(selection, 'positionX').value, null)
  assert.equal(getMultiClipFieldState(selection, 'positionY').value, 0)
  assert.equal(getMultiClipFieldState(selection, 'positionY').mixed, false)
})

test('sets only the requested visual property; keeps timing, links, effects, and animation intact', () => {
  const state = makeState()
  const before = structuredClone(state)
  const result = plan(state)
  assert.equal(result.ok, true)
  assert.equal(result.changedCount, 2)
  assert.deepEqual(state, before)
  assert.deepEqual(result.clips.slice(0, 2).map(c => c.transform.positionX), [50, 50])
  for (const original of state.clips.slice(0, 2)) {
    const updated = result.clips.find(c => c.id === original.id)
    assert.deepEqual({ ...updated, transform: original.transform }, original)
  }
  for (let i = 2; i < state.clips.length; i++) assert.equal(result.clips[i], state.clips[i])
})

test('offsets preserve per-clip differences, including negative and fractional values', () => {
  const result = plan(makeState(), { value: '-3.5', mode: 'offset' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.clips.slice(0, 2).map(c => c.transform.positionX), [16.5, -13.5])
})

test('setting scale respects each clip’s own scale link', () => {
  const result = plan(makeState(), { property: 'scaleX', value: 110 })
  assert.equal(result.ok, true)
  assert.deepEqual(result.clips.slice(0, 2).map(c => [c.transform.scaleX, c.transform.scaleY]), [[110, 110], [110, 90]])
})

test('scale offsets are percentage points on each affected axis, not multipliers', () => {
  const result = plan(makeState(), { property: 'scaleY', value: 10, mode: 'offset' })
  assert.deepEqual(result.clips.slice(0, 2).map(c => [c.transform.scaleX, c.transform.scaleY]), [[110, 110], [150, 100]])
})

test('legacy clips without transforms default to linked 100% scale', () => {
  const state = makeState()
  delete state.clips[0].transform
  const result = plan(state, { property: 'scaleX', value: 10, mode: 'offset' })
  assert.deepEqual(result.clips[0].transform, { scaleX: 110, scaleY: 110 })
})

test('animated fields block the whole field edit, including the other linked scale axis', () => {
  const state = makeState()
  let result = plan(state, { property: 'rotation', value: 45 })
  assert.equal(result.ok, false)
  assert.match(result.error, /Animated/)
  assert.equal(result.clips, state.clips)
  state.clips[0].keyframes.scaleY = [{ time: 0, value: 100 }]
  result = plan(state, { property: 'scaleX', value: 120 })
  assert.equal(result.ok, false)
  assert.equal(plan(state, { property: 'positionY', value: 10 }).ok, true)
})

test('animation on excluded tracks does not block eligible clips', () => {
  const state = makeState()
  state.clips[4].keyframes = { positionX: [{ time: 0, value: 1 }] }
  assert.equal(plan(state).ok, true)
})

test('audio gain supports set and relative offsets without changing video or fades', () => {
  const state = makeState()
  const result = plan(state, { property: 'gainDb', value: -3, mode: 'offset' })
  assert.equal(result.changedCount, 2)
  assert.deepEqual(result.clips.slice(2, 4).map(c => c.gainDb), [-1, -7])
  assert.equal(result.clips[0], state.clips[0])
  assert.equal(result.clips[2].fadeIn, 0.5)
  assert.equal(result.clips[2].fadeOut, 0.2)
  assert.deepEqual(plan(state, { property: 'gainDb', value: 0 }).clips.slice(2, 4).map(c => c.gainDb), [0, 0])
})

test('rejects out-of-range results atomically instead of clamping different clips', () => {
  const state = makeState()
  for (const request of [
    { property: 'opacity', value: 30, mode: 'offset' },
    { property: 'opacity', value: -1 },
    { property: 'scaleX', value: -1 },
    { property: 'gainDb', value: 23, mode: 'offset' },
    { property: 'gainDb', value: -25 },
  ]) {
    const result = plan(state, request)
    assert.equal(result.ok, false)
    assert.equal(result.clips, state.clips)
    assert.equal(result.changedCount, 0)
  }
})

test('rejects invalid inputs and unsupported operations without changing source data', () => {
  const state = makeState()
  for (const value of ['', '   ', null, undefined, true, [], {}, NaN, Infinity, 'Infinity', '12px']) {
    assert.equal(plan(state, { value }).ok, false, String(value))
  }
  assert.equal(plan(state, { property: 'startTime' }).ok, false)
  assert.equal(plan(state, { mode: 'multiply' }).ok, false)
  assert.equal(plan(state, { clipIds: ['sound'] }).ok, false)
  assert.equal(plan(state, { clipIds: [] }).ok, false)
  assert.equal(plan(state, { clipIds: ['locked'] }).ok, false)
})

test('no-op edits retain the original array so callers can avoid dirty and undo entries', () => {
  const state = makeState()
  for (const request of [{ value: 0, mode: 'offset' }, { property: 'positionY', value: 0 }]) {
    const result = plan(state, request)
    assert.equal(result.ok, true)
    assert.equal(result.changedCount, 0)
    assert.equal(result.clips, state.clips)
  }
})

test('text, shape, and adjustment clips expose the same basic transforms', () => {
  const state = makeState()
  state.clips = ['text', 'shape', 'adjustment'].map(type => ({ id: type, type, trackId: 'v' }))
  const result = plan(state, { property: 'opacity', value: 60 })
  assert.equal(result.changedCount, 3)
  assert.ok(result.clips.every(c => c.transform.opacity === 60))
})

test('compound updates are absolute, atomic, and preserve explicit unlinked scale axes', () => {
  const state = makeState()
  const clipIds = ['one', 'two']
  const result = planMultiClipInspectorUpdates(state, { clipIds, updates: { anchorX: 0, anchorY: 100, scaleX: 120, scaleY: 80 } })
  assert.equal(result.ok, true)
  assert.deepEqual(result.clips.slice(0, 2).map(c => [c.transform.anchorX, c.transform.anchorY, c.transform.scaleX, c.transform.scaleY]), [[0, 100, 120, 80], [0, 100, 120, 80]])
  const rejected = planMultiClipInspectorUpdates(state, { clipIds, updates: { positionX: 100, rotation: 0 } })
  assert.equal(rejected.ok, false, 'animated second property rejects the entire operation')
  assert.equal(rejected.clips, state.clips)
})

test('booleans and blend modes are allowlisted and keep mixed values meaningful', () => {
  const state = makeState()
  const selection = getMultiClipSelection(state.clips, state.tracks, ['one', 'two'])
  assert.equal(getMultiClipFieldState(selection, 'scaleLinked').mixed, true)
  assert.equal(getMultiClipFieldState(selection, 'flipH').mixed, false)
  assert.equal(plan(state, { property: 'flipH', value: true }).clips[1].transform.flipH, true)
  assert.equal(plan(state, { property: 'flipH', value: 'true' }).ok, false)
  assert.equal(plan(state, { property: 'blendMode', value: 'multiply' }).clips[0].transform.blendMode, 'multiply')
  assert.equal(plan(state, { property: 'blendMode', value: 'invalid' }).ok, false)
  assert.equal(plan(state, { property: 'scaleLinked', value: true, mode: 'offset' }).ok, false)
})

test('audio fades fit every selected clip and do not change timing or gain', () => {
  const state = makeState()
  state.clips[2].duration = 3
  state.clips[3].duration = 1
  const result = plan(state, { property: 'fadeIn', value: 0.75 })
  assert.equal(result.ok, true)
  assert.deepEqual(result.clips.slice(2, 4).map(c => c.fadeIn), [0.75, 0.75])
  assert.equal(result.clips[2].gainDb, 2)
  assert.equal(plan(state, { property: 'fadeOut', value: 2 }).ok, false)
})

test('crop and 3D properties share validation and animation protection', () => {
  const state = makeState()
  assert.equal(plan(state, { property: 'cropLeft', value: 10 }).ok, true)
  assert.equal(plan(state, { property: 'cropLeft', value: 101 }).ok, false)
  assert.equal(plan(state, { property: 'perspective', value: 0 }).ok, false)
  state.clips[1].keyframes = { rotationX: [{ time: 0, value: 10 }] }
  assert.equal(plan(state, { property: 'rotationX', value: 0 }).ok, false)
})
