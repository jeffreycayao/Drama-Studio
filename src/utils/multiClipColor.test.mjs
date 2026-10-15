import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getMultiClipSelection,
  getMultiClipFieldState,
  planMultiClipInspectorEdit,
  planMultiClipInspectorUpdates,
} from './multiClipInspector.js'
import { getAdjustmentValue, normalizeAdjustmentSettings } from './adjustments.js'

const COLOR_KEYS = ['brightness', 'contrast', 'saturation', 'gain', 'gamma', 'offset', 'hue']
const TONAL_GROUPS = ['shadows', 'midtones', 'highlights']
const COLOR_PATHS = [...COLOR_KEYS, ...TONAL_GROUPS.flatMap(group => COLOR_KEYS.map(key => `${group}.${key}`))]
const colorReset = paths => Object.fromEntries(paths.map(path => [`color.${path}`, 0]))

const makeState = () => ({
  tracks: [
    { id: 'visual', type: 'video' },
    { id: 'audio', type: 'audio' },
    { id: 'locked', type: 'video', locked: true },
  ],
  clips: [
    {
      id: 'one', type: 'video', trackId: 'visual', assetId: 'source-one',
      startTime: 1, duration: 2, trimStart: 3, linkGroupId: 'linked',
      transform: { positionX: 20, scaleX: 110 }, effects: [{ id: 'effect-one' }],
      keyframes: { rotation: [{ time: 0, value: 15, easing: 'linear' }] },
      bypass: { color: false, effects: true },
      adjustments: normalizeAdjustmentSettings({
        brightness: 20, contrast: -8, saturation: -15, hue: 32, blur: 4,
        shadows: { hue: -80, saturation: 24, offset: 9 },
        midtones: { gamma: 12 }, highlights: { gain: -6 },
        lut: { lutId: 'warm-look', amount: 37 },
      }),
    },
    {
      id: 'two', type: 'image', trackId: 'visual', assetId: 'source-two',
      startTime: 5, duration: 3, transform: { positionX: -10 },
      bypass: { color: true, mask: true },
      adjustments: normalizeAdjustmentSettings({
        brightness: -10, contrast: 18, saturation: 11, hue: -65, blur: 12,
        shadows: { hue: 40, saturation: -12, offset: -4 },
        midtones: { gamma: -20 }, highlights: { gain: 16 },
        lut: { lutId: 'cool-look', amount: 83 },
      }),
    },
    { id: 'audio', type: 'audio', trackId: 'audio', gainDb: 2, adjustments: { brightness: 81 } },
    { id: 'locked', type: 'video', trackId: 'locked', adjustments: { brightness: 72 } },
    { id: 'orphan', type: 'image', trackId: 'missing', adjustments: { brightness: 61 } },
    { id: 'unsupported', type: 'captions', trackId: 'visual', adjustments: { brightness: 50 } },
  ],
})

const allIds = state => state.clips.map(clip => clip.id)
const selectionFor = state => getMultiClipSelection(state.clips, state.tracks, allIds(state))
const plan = (state, request = {}) => planMultiClipInspectorEdit(state, {
  clipIds: allIds(state), property: 'color.brightness', value: 35, ...request,
})
const planUpdates = (state, updates) => planMultiClipInspectorUpdates(state, { clipIds: allIds(state), updates })

const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

test('all global and tonal color fields expose shared values without including blur or LUT', () => {
  const state = makeState()
  for (const path of COLOR_PATHS) {
    const status = getMultiClipFieldState(selectionFor(state), `color.${path}`)
    assert.equal(status.blockedReason, '', path)
    assert.deepEqual(status.targets.map(clip => clip.id), ['one', 'two'], path)
    assert.deepEqual(status.values, state.clips.slice(0, 2).map(clip => getAdjustmentValue(clip.adjustments, path)), path)
  }
  for (const property of ['color.blur', 'color.lut', 'color.lut.amount', 'color.lut.lutId', 'color.shadows.unknown']) {
    const result = plan(state, { property, value: 0 })
    assert.equal(result.ok, false, property)
    assert.equal(result.clips, state.clips)
  }
})

test('mixed color values remain mixed while missing legacy groups read as neutral defaults', () => {
  const state = makeState()
  const mixed = getMultiClipFieldState(selectionFor(state), 'color.brightness')
  assert.equal(mixed.mixed, true)
  assert.equal(mixed.value, null)
  delete state.clips[0].adjustments
  state.clips[1].adjustments = { brightness: 0 }
  for (const path of COLOR_PATHS) {
    const status = getMultiClipFieldState(selectionFor(state), `color.${path}`)
    assert.equal(status.value, 0, path)
    assert.equal(status.mixed, false, path)
  }
})

test('a scalar color edit preserves each clip’s other grade, LUT, blur and unrelated data', () => {
  const state = deepFreeze(makeState())
  const before = structuredClone(state)
  const result = plan(state)
  assert.equal(result.ok, true)
  assert.equal(result.changedCount, 2)
  for (let index = 0; index < 2; index += 1) {
    const original = state.clips[index]
    const updated = result.clips[index]
    assert.deepEqual(updated.adjustments, { ...original.adjustments, brightness: 35 })
    assert.deepEqual({ ...updated, adjustments: original.adjustments }, original)
    assert.equal(updated.transform, original.transform)
    assert.equal(updated.keyframes, original.keyframes)
    assert.equal(updated.bypass, original.bypass)
  }
  for (let index = 2; index < state.clips.length; index += 1) assert.equal(result.clips[index], state.clips[index])
  assert.deepEqual(state, before)
})

test('a tonal wheel applies hue and saturation together without copying its other controls', () => {
  const state = deepFreeze(makeState())
  const result = planUpdates(state, { 'color.shadows.hue': 135, 'color.shadows.saturation': 48 })
  assert.equal(result.ok, true)
  assert.equal(result.changedCount, 2)
  for (let index = 0; index < 2; index += 1) {
    const original = state.clips[index]
    assert.deepEqual(result.clips[index].adjustments, {
      ...original.adjustments,
      shadows: { ...original.adjustments.shadows, hue: 135, saturation: 48 },
    })
  }
})

test('sparse color writes retain raw legacy values and forward-compatible grade metadata', () => {
  const state = makeState()
  state.clips[0].adjustments = {
    brightness: '20', contrast: '8.5', blur: 7,
    shadows: { hue: '-40', saturation: 12, futureTonalSetting: { amount: 3 } },
    lut: { lutId: 'look-one', amount: 60, futureLutSetting: 'keep' },
    futureGradeSetting: { space: 'scene-linear' },
  }
  deepFreeze(state)
  const result = planUpdates(state, { 'color.shadows.saturation': 45 })
  assert.equal(result.ok, true)
  assert.deepEqual(result.clips[0].adjustments, {
    ...state.clips[0].adjustments,
    shadows: { ...state.clips[0].adjustments.shadows, saturation: 45 },
  })
  assert.equal(Object.hasOwn(result.clips[0].adjustments, 'midtones'), false)
})

test('color offsets retain per-clip differences and accept finite numeric strings', () => {
  const state = makeState()
  const result = plan(state, { value: '-3.5', mode: 'offset' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.clips.slice(0, 2).map(clip => clip.adjustments.brightness), [16.5, -13.5])
  assert.equal(plan(state, { property: 'color.midtones.gamma', value: '12.5' }).clips[1].adjustments.midtones.gamma, 12.5)
})

test('numeric color bounds are enforced for every global and tonal path, without clamping', () => {
  const state = deepFreeze(makeState())
  for (const path of COLOR_PATHS) {
    const limit = path === 'hue' || path.endsWith('.hue') ? 180 : 100
    for (const value of [-limit, limit]) {
      const result = plan(state, { property: `color.${path}`, value })
      assert.equal(result.ok, true, `${path}: ${value}`)
      assert.ok(result.clips.slice(0, 2).every(clip => getAdjustmentValue(clip.adjustments, path) === value))
    }
    for (const value of [-limit - 1, limit + 1]) {
      const result = plan(state, { property: `color.${path}`, value })
      assert.equal(result.ok, false, `${path}: ${value}`)
      assert.equal(result.changedCount, 0)
      assert.equal(result.clips, state.clips)
    }
  }
  const offset = plan(state, { value: 90, mode: 'offset' })
  assert.equal(offset.ok, false, 'one out-of-range target rejects the entire offset')
  assert.equal(offset.clips, state.clips)
})

test('invalid scalar or compound color edits return the original clips without partial writes', () => {
  const state = deepFreeze(makeState())
  for (const value of ['', ' ', null, undefined, true, [], {}, NaN, Infinity, 'Infinity', '12px']) {
    const result = plan(state, { value })
    assert.equal(result.ok, false, String(value))
    assert.equal(result.clips, state.clips)
  }
  for (const updates of [
    { 'color.brightness': 9, 'color.shadows.hue': 181 },
    { 'color.brightness': 9, 'color.lut.amount': 50 },
    { 'color.brightness': 9, 'color.contrast': null },
  ]) {
    const result = planUpdates(state, updates)
    assert.equal(result.ok, false)
    assert.equal(result.changedCount, 0)
    assert.equal(result.clips, state.clips)
  }
})

test('animation checks map color namespaced fields to bare adjustment keyframe paths', () => {
  const state = makeState()
  for (const path of COLOR_PATHS) {
    state.clips[1].keyframes = { [path]: [{ time: 0, value: 12 }] }
    const status = getMultiClipFieldState(selectionFor(state), `color.${path}`)
    assert.equal(status.animatedCount, 1, path)
    assert.match(status.blockedReason, /Animated/, path)
    const result = plan(state, { property: `color.${path}`, value: 0 })
    assert.equal(result.ok, false, path)
    assert.equal(result.clips, state.clips)
  }
})

test('animation of either wheel path blocks the whole pair, including a preceding valid write', () => {
  for (const animatedPath of ['shadows.hue', 'shadows.saturation']) {
    const state = makeState()
    state.clips[1].keyframes = { [animatedPath]: [{ time: 0, value: 15 }] }
    const result = planUpdates(state, { 'color.shadows.hue': 90, 'color.shadows.saturation': 65 })
    assert.equal(result.ok, false, animatedPath)
    assert.equal(result.changedCount, 0)
    assert.equal(result.clips, state.clips)
    assert.deepEqual(state.clips[1].keyframes[animatedPath], [{ time: 0, value: 15 }])
  }
})

test('unrelated animation and animation on excluded clips do not block a color edit', () => {
  const state = makeState()
  state.clips[1].keyframes = { 'midtones.gamma': [{ time: 0, value: 20 }] }
  for (const clip of state.clips.slice(2)) clip.keyframes = { brightness: [{ time: 0, value: 0 }] }
  const result = plan(state)
  assert.equal(result.ok, true)
  assert.equal(result.changedCount, 2)
  assert.equal(result.clips[1].keyframes, state.clips[1].keyframes)
  for (let index = 2; index < state.clips.length; index += 1) assert.equal(result.clips[index], state.clips[index])
})

test('global and tonal resets preserve other color groups, blur, LUT and bypass', () => {
  for (const paths of [COLOR_KEYS, COLOR_KEYS.map(key => `shadows.${key}`)]) {
    const state = deepFreeze(makeState())
    const result = planUpdates(state, colorReset(paths))
    assert.equal(result.ok, true)
    for (let index = 0; index < 2; index += 1) {
      const original = state.clips[index]
      const updated = result.clips[index]
      for (const path of COLOR_PATHS) {
        assert.equal(getAdjustmentValue(updated.adjustments, path), paths.includes(path) ? 0 : getAdjustmentValue(original.adjustments, path), path)
      }
      assert.equal(updated.adjustments.blur, original.adjustments.blur)
      assert.deepEqual(updated.adjustments.lut, original.adjustments.lut)
      assert.equal(updated.bypass, original.bypass)
    }
  }
})

test('all-color reset excludes blur and LUT, and rejects atomically when a reset path is animated', () => {
  const state = makeState()
  const result = planUpdates(state, colorReset(COLOR_PATHS))
  assert.equal(result.ok, true)
  for (let index = 0; index < 2; index += 1) {
    assert.ok(COLOR_PATHS.every(path => getAdjustmentValue(result.clips[index].adjustments, path) === 0))
    assert.equal(result.clips[index].adjustments.blur, state.clips[index].adjustments.blur)
    assert.deepEqual(result.clips[index].adjustments.lut, state.clips[index].adjustments.lut)
  }
  state.clips[1].keyframes = { 'highlights.hue': [{ time: 0, value: 0 }] }
  const rejected = planUpdates(state, colorReset(COLOR_PATHS))
  assert.equal(rejected.ok, false)
  assert.equal(rejected.changedCount, 0)
  assert.equal(rejected.clips, state.clips)
  assert.equal(planUpdates(state, colorReset(COLOR_KEYS)).ok, true, 'a smaller reset ignores unrelated tonal animation')
})

test('color no-ops preserve array identity and leave legacy clips without newly materialized settings', () => {
  const state = makeState()
  assert.equal(plan(state, { value: 0, mode: 'offset' }).clips, state.clips)
  delete state.clips[0].adjustments
  delete state.clips[1].adjustments
  for (const result of [plan(state, { value: 0 }), planUpdates(state, colorReset(COLOR_PATHS))]) {
    assert.equal(result.ok, true)
    assert.equal(result.changedCount, 0)
    assert.equal(result.clips, state.clips)
    assert.equal(Object.hasOwn(result.clips[0], 'adjustments'), false)
  }
})

test('color bypass has meaningful mixed/default state and preserves grades and other bypass groups', () => {
  const state = makeState()
  const status = getMultiClipFieldState(selectionFor(state), 'colorBypass')
  assert.equal(status.mixed, true)
  assert.equal(status.value, null)
  state.clips[0].keyframes.brightness = [{ time: 0, value: 20 }]
  const result = plan(state, { property: 'colorBypass', value: true })
  assert.equal(result.ok, true, 'bypassing does not edit the animated grade')
  assert.equal(result.changedCount, 1)
  assert.deepEqual(result.clips[0].bypass, { color: true, effects: true })
  assert.equal(result.clips[1], state.clips[1])
  for (let index = 0; index < 2; index += 1) assert.equal(result.clips[index].adjustments, state.clips[index].adjustments)
  for (let index = 2; index < state.clips.length; index += 1) assert.equal(result.clips[index], state.clips[index])
  delete state.clips[0].bypass
  delete state.clips[1].bypass
  assert.equal(getMultiClipFieldState(selectionFor(state), 'colorBypass').value, false)
  const noop = plan(state, { property: 'colorBypass', value: false })
  assert.equal(noop.clips, state.clips)
  assert.equal(noop.changedCount, 0)
  assert.equal(Object.hasOwn(noop.clips[0], 'bypass'), false)
})

test('color bypass only accepts booleans and compound grade-plus-bypass edits stay atomic', () => {
  const state = deepFreeze(makeState())
  for (const request of [
    { value: 'true' }, { value: 1 }, { value: null }, { value: false, mode: 'offset' },
  ]) {
    const result = plan(state, { property: 'colorBypass', ...request })
    assert.equal(result.ok, false)
    assert.equal(result.clips, state.clips)
  }
  const result = planUpdates(state, { colorBypass: true, 'color.brightness': 101 })
  assert.equal(result.ok, false)
  assert.equal(result.clips, state.clips)
  assert.equal(state.clips[0].bypass.color, false)
})

test('color works across visual types and rejects selections containing no editable visual targets', () => {
  const state = makeState()
  state.clips = ['video', 'image', 'text', 'shape', 'adjustment'].map(type => ({ id: type, type, trackId: 'visual' }))
  const result = plan(state, { property: 'color.midtones.gamma', value: 22 })
  assert.equal(result.ok, true)
  assert.equal(result.changedCount, 5)
  assert.ok(result.clips.every(clip => clip.adjustments.midtones.gamma === 22))
  const fullState = makeState()
  for (const clipIds of [[], ['audio'], ['locked'], ['orphan'], ['unsupported'], ['missing']]) {
    const rejected = plan(fullState, { clipIds })
    assert.equal(rejected.ok, false)
    assert.equal(rejected.clips, fullState.clips)
  }
})
