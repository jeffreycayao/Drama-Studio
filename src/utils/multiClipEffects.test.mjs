import test from 'node:test'
import assert from 'node:assert/strict'
import { getMultiClipSelection, getMultiClipFieldState, planMultiClipInspectorEdit } from './multiClipInspector.js'
import {
  getMultiClipEffectGroups,
  getMultiClipEffectFieldState,
  getMultiClipEffectOperationBlock,
  planMultiClipEffectsEdit,
} from './multiClipEffects.js'

const definitions = [
  { id: 'grain', label: 'Film Grain', params: [{ key: 'amount', min: 0, max: 100 }, { key: 'size', min: 0.5, max: 10 }, { key: 'monochrome', type: 'toggle' }], defaults: { amount: 10, size: 1, monochrome: 0 } },
  { id: 'glslGrain', label: 'Film Grain', params: [{ key: 'amount', min: 0, max: 100 }], defaults: { amount: 20 } },
  { id: 'blur', label: 'Blur', params: [{ key: 'amount', min: 0, max: 80 }], defaults: { amount: 8 } },
]
const getDefinition = type => definitions.find(definition => definition.id === type)
const ids = ['one', 'two']
const fx = (id, type, settings = {}, other = {}) => ({ id, type, enabled: true, settings, ...other })
const makeState = () => ({
  selectedClipIds: [...ids],
  tracks: [{ id: 'v', type: 'video' }, { id: 'a', type: 'audio' }, { id: 'locked', type: 'video', locked: true }],
  clips: [
    {
      id: 'one', type: 'video', trackId: 'v', startTime: 1, duration: 5, trimStart: 3, assetId: 'media', linkGroupId: 'linked',
      transform: { positionX: 25 }, adjustments: { contrast: 8 }, keyframes: { rotation: [{ time: 0, value: 10 }] },
      cacheStatus: 'cached', cacheUrl: '/cache/one.mp4', cacheSignature: 'signature-one', cacheMetadata: { fps: 30 },
      effects: [fx('one-grain', 'grain', { amount: 10, size: 2, future: 'keep-one' }), fx('one-blur', 'blur', { amount: 2 }), fx('one-mask', 'mask', { inverted: true }), fx('one-grain-2', 'grain', { amount: 30 })],
    },
    {
      id: 'two', type: 'image', trackId: 'v', startTime: 8, duration: 3, sourceDuration: 99,
      cacheStatus: 'rendering', cacheUrl: '/cache/two.mp4',
      effects: [fx('two-blur', 'blur', { amount: 9 }), fx('two-grain', 'grain', { amount: 20, size: 4, future: 'keep-two' }, { enabled: false }), fx('two-grain-2', 'grain', { amount: 40 })],
    },
    { id: 'sound', type: 'audio', trackId: 'a', effects: [fx('sound-grain', 'grain')] },
    { id: 'locked', type: 'shape', trackId: 'locked', effects: [fx('locked-grain', 'grain')] },
    { id: 'orphan', type: 'image', trackId: 'missing', effects: [] },
  ],
})
const selection = state => getMultiClipSelection(state.clips, state.tracks, state.selectedClipIds)
const groups = state => getMultiClipEffectGroups(selection(state), getDefinition)
const group = (state, key = 'grain:0') => groups(state).find(item => item.key === key)
const field = (state, property, key) => getMultiClipEffectFieldState(selection(state), group(state, key), property, getDefinition)
const plan = (state, request = {}, options = {}) => {
  let sequence = 0
  return planMultiClipEffectsEdit(state, { clipIds: state.selectedClipIds, action: 'update', group: group(state), settings: { amount: 50 }, ...request }, { getDefinition, makeId: () => `created-${++sequence}`, ...options })
}
const effect = (result, clipId, effectId) => result.clips.find(clip => clip.id === clipId).effects.find(item => item.id === effectId)
const rejected = (state, request, pattern, options) => {
  const result = plan(state, request, options)
  assert.equal(result.ok, false)
  assert.equal(result.changedCount, 0)
  assert.equal(result.clips, state.clips)
  if (pattern) assert.match(result.error, pattern)
}

test('groups exact types in first eligible stack order with numbered repeated occurrences', () => {
  const state = makeState()
  const shared = groups(state)
  assert.deepEqual(shared.map(item => item.key), ['grain:0', 'blur:0', 'grain:1'])
  assert.equal(shared[0].repeated, true)
  assert.equal(shared[1].repeated, false)
  assert.equal(shared[0].effect, state.clips[0].effects[0])
  assert.deepEqual(shared[2].members, [{ clipId: 'one', effectId: 'one-grain-2' }, { clipId: 'two', effectId: 'two-grain-2' }])
})

test('uneven counts and missing types stay unshared; matching labels do not conflate CPU and GPU effects', () => {
  const state = makeState()
  state.clips[1].effects.pop()
  assert.deepEqual(groups(state).map(item => item.type), ['blur'])
  state.clips[0].effects = [fx('one-grain', 'grain')]
  state.clips[1].effects = [fx('two-grain', 'glslGrain')]
  assert.deepEqual(groups(state), [])
  state.clips[0].effects.push(fx('one-gpu', 'glslGrain'))
  assert.deepEqual(groups(state).map(item => item.type), ['glslGrain'])
})

test('ambiguous and malformed IDs exclude their whole type without retargeting later occurrences', () => {
  for (const change of [
    state => { state.clips[1].effects[1].id = '' },
    state => { state.clips[1].effects[1].id = undefined },
    state => { state.clips[1].effects[1].id = 42 },
    state => { state.clips[1].effects[1].id = 'two-grain-2' },
    state => { state.clips[1].effects.push(fx('two-grain', 'mask')) },
  ]) {
    const state = makeState()
    change(state)
    assert.deepEqual(groups(state).map(item => item.type), ['blur'])
  }
})

test('grouping excludes locked/audio/unsupported clips and needs an editable visual target', () => {
  const state = makeState()
  state.selectedClipIds = state.clips.map(clip => clip.id)
  assert.equal(groups(state)[0].members.length, 2)
  state.selectedClipIds = ['sound', 'locked']
  assert.deepEqual(groups(state), [])
  rejected(state, { action: 'add', type: 'grain' }, /No editable/)
})

test('field states use normalized defaults and show mixed parameter and enabled values', () => {
  const state = makeState()
  assert.deepEqual(field(state, 'amount').values, [10, 20])
  assert.equal(field(state, 'amount').mixed, true)
  assert.equal(field(state, 'amount').value, null)
  assert.deepEqual(field(state, 'enabled').values, [true, false])
  assert.equal(field(state, 'monochrome').value, 0)
  state.clips[0].effects[0].settings = { amount: 500, size: 'bad', monochrome: true }
  state.clips[1].effects[1].settings = { amount: '100', size: 1, monochrome: 1 }
  assert.equal(field(state, 'amount').value, 100)
  assert.equal(field(state, 'size').value, 1)
  assert.equal(field(state, 'monochrome').value, 1)
  assert.match(field(state, 'not-real').blockedReason, /Unsupported/)
})

test('sparse updates apply absolute values while preserving each target’s settings and whole project shape', () => {
  const state = makeState()
  const before = structuredClone(state)
  const result = plan(state)
  assert.equal(result.ok, true)
  assert.equal(result.changedCount, 2)
  assert.equal(result.targetCount, 2)
  assert.deepEqual(state, before)
  assert.deepEqual(effect(result, 'one', 'one-grain').settings, { amount: 50, size: 2, future: 'keep-one' })
  assert.deepEqual(effect(result, 'two', 'two-grain').settings, { amount: 50, size: 4, future: 'keep-two' })
  assert.equal(effect(result, 'two', 'two-grain').enabled, false)
  for (let i = 0; i < state.clips.length; i++) {
    const original = state.clips[i]
    const updated = result.clips[i]
    if (i > 1) assert.equal(updated, original)
    else {
      assert.deepEqual({ ...updated, effects: original.effects, cacheStatus: original.cacheStatus }, original)
      assert.deepEqual(updated.effects.map(item => item.id), original.effects.map(item => item.id))
      for (const item of original.effects.filter(item => !['one-grain', 'two-grain'].includes(item.id))) assert.equal(effect(result, original.id, item.id), item)
    }
  }
})

test('cache invalidation retains URLs, signatures and metadata, and ignores noncached statuses', () => {
  const state = makeState()
  const result = plan(state)
  assert.equal(result.clips[0].cacheStatus, 'invalid')
  assert.equal(result.clips[0].cacheUrl, state.clips[0].cacheUrl)
  assert.equal(result.clips[0].cacheSignature, state.clips[0].cacheSignature)
  assert.equal(result.clips[0].cacheMetadata, state.clips[0].cacheMetadata)
  assert.equal(result.clips[1].cacheStatus, 'rendering')
})

test('numeric strings and exact toggle0/1 values are accepted; arbitrary values/ranges/keys are rejected atomically', () => {
  const state = makeState()
  const result = plan(state, { settings: { amount: '25.5', monochrome: '1' } })
  assert.equal(result.ok, true)
  assert.equal(effect(result, 'one', 'one-grain').settings.amount, 25.5)
  assert.equal(effect(result, 'two', 'two-grain').settings.monochrome, 1)
  for (const value of ['', ' ', null, undefined, true, [], {}, NaN, Infinity, 'NaN', '12px', -1, 101]) rejected(state, { settings: { amount: value } })
  for (const value of [true, false, 0.5, 2, -1, 'yes']) rejected(state, { settings: { monochrome: value } })
  for (const settings of [null, [], 'amount', { amount: 50, future: 1 }, { amount: 50, size: 11 }, JSON.parse('{"__proto__":1}')]) rejected(state, { settings })
})

test('animated affected parameters block the complete operation; unrelated keyframes remain editable', () => {
  const state = makeState()
  state.clips[1].keyframes = { 'effect.two-grain.amount': [{ time: 1, value: 45 }], 'effect.two-blur.amount': [{ time: 0, value: 2 }] }
  assert.match(field(state, 'amount').blockedReason, /Animated/)
  assert.equal(field(state, 'size').blockedReason, '')
  rejected(state, { settings: { size: 2, amount: 50 } }, /Animated/)
  const allowed = plan(state, { settings: { size: 3 } })
  assert.equal(allowed.ok, true)
  assert.equal(allowed.clips[1].keyframes, state.clips[1].keyframes)
  assert.equal(getMultiClipEffectOperationBlock(selection(state), group(state), ['size'], getDefinition), '')
})

test('empty keyframe arrays do not block and animation on excluded clips does not block', () => {
  const state = makeState()
  state.selectedClipIds = state.clips.map(clip => clip.id)
  state.clips[0].keyframes['effect.one-grain.amount'] = []
  state.clips[3].keyframes = { 'effect.locked-grain.amount': [{ time: 0, value: 5 }] }
  assert.equal(plan(state).ok, true)
})

test('enabled updates support mixed and animated effects without altering settings or animation', () => {
  const state = makeState()
  state.clips[1].keyframes = { 'effect.two-grain.amount': [{ time: 0, value: 5 }] }
  assert.equal(field(state, 'enabled').blockedReason, '')
  const result = plan(state, { action: 'enabled', enabled: true })
  assert.equal(result.ok, true)
  assert.equal(result.changedCount, 1)
  assert.equal(result.clips[0], state.clips[0])
  assert.equal(effect(result, 'two', 'two-grain').enabled, true)
  assert.equal(effect(result, 'two', 'two-grain').settings, state.clips[1].effects[1].settings)
  assert.equal(result.clips[1].keyframes, state.clips[1].keyframes)
  for (const enabled of [undefined, null, 0, 1, 'true']) rejected(state, { action: 'enabled', enabled })
})

test('reset sets declared parameters to defaults while retaining per-clip unknown settings and enabled state', () => {
  const state = makeState()
  const result = plan(state, { action: 'reset' })
  assert.equal(result.ok, true)
  assert.deepEqual(effect(result, 'one', 'one-grain').settings, { amount: 10, size: 1, future: 'keep-one' })
  assert.deepEqual(effect(result, 'two', 'two-grain').settings, { amount: 10, size: 1, future: 'keep-two' })
  assert.equal(effect(result, 'two', 'two-grain').enabled, false)
  state.clips[1].keyframes = { 'effect.two-grain.size': [{ time: 0, value: 1 }] }
  rejected(state, { action: 'reset' }, /Animated/)
})

test('reset ignores unknown parameter animation but removal protects all own unknown or future keyframes', () => {
  const state = makeState()
  state.clips[0].keyframes['effect.one-grain.future'] = [{ time: 0, value: 10 }]
  assert.equal(plan(state, { action: 'reset' }).ok, true)
  rejected(state, { action: 'remove' }, /Animated/)
  assert.match(getMultiClipEffectOperationBlock(selection(state), group(state), null, getDefinition), /Animated/)
  assert.equal(getMultiClipEffectOperationBlock(selection(state), group(state), [], getDefinition), '')
  assert.match(getMultiClipEffectOperationBlock(selection(state), group(state), ['future'], getDefinition), /Unsupported/)
})

test('removal deletes just the exact numbered shared instance and does not orphan or delete unrelated keyframes', () => {
  const state = makeState()
  state.clips[0].keyframes['effect.one-grain-2.amount'] = [{ time: 0, value: 30 }]
  const result = plan(state, { action: 'remove' })
  assert.equal(result.ok, true)
  assert.equal(result.changedCount, 2)
  assert.deepEqual(result.clips[0].effects.map(item => item.id), ['one-blur', 'one-mask', 'one-grain-2'])
  assert.deepEqual(result.clips[1].effects.map(item => item.id), ['two-blur', 'two-grain-2'])
  assert.equal(result.clips[0].keyframes, state.clips[0].keyframes)
  assert.equal(result.clips[0].cacheUrl, state.clips[0].cacheUrl)
})

test('removing the last effect clears its cache reference consistently with existing single-clip removal', () => {
  const state = makeState()
  state.clips[0].effects = [state.clips[0].effects[0]]
  state.clips[1].effects = [state.clips[1].effects[1]]
  const result = plan(state, { action: 'remove' })
  assert.equal(result.ok, true)
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(result.clips[i].effects, [])
    assert.equal(result.clips[i].cacheStatus, 'none')
    assert.equal(result.clips[i].cacheUrl, null)
    assert.equal(result.clips[i].cacheSignature, state.clips[i].cacheSignature)
    assert.equal(result.clips[i].cacheMetadata, state.clips[i].cacheMetadata)
    assert.ok(state.clips[i].cacheUrl, 'original references are preserved for undo')
  }
})

test('stale ordinal snapshots cannot retarget after same-type reorder, replacement, removal or count change', () => {
  for (const mutate of [
    state => { [state.clips[1].effects[1], state.clips[1].effects[2]] = [state.clips[1].effects[2], state.clips[1].effects[1]] },
    state => { state.clips[1].effects[1] = fx('replacement', 'grain') },
    state => { state.clips[1].effects.splice(1, 1) },
    state => { state.clips[1].effects.push(fx('new-grain', 'grain')) },
  ]) {
    const state = makeState()
    const snapshot = structuredClone(group(state))
    mutate(state)
    for (const action of ['update', 'remove', 'reset', 'enabled']) rejected(state, { group: snapshot, action, enabled: true }, /changed/)
    assert.match(getMultiClipEffectFieldState(selection(state), snapshot, 'amount', getDefinition).blockedReason, /changed/)
  }
})

test('snapshot remains valid across unrelated stack reorder and parameter edits, with exact identity sets', () => {
  const state = makeState()
  const snapshot = structuredClone(group(state))
  state.clips[0].effects.unshift(state.clips[0].effects.splice(2, 1)[0])
  state.clips[1].effects[1].settings.amount = 33
  snapshot.members.reverse()
  const result = plan(state, { group: snapshot })
  assert.equal(result.ok, true)
  assert.equal(effect(result, 'two', 'two-grain').settings.amount, 50)
  for (const broken of [
    { ...snapshot, key: 'grain:1' },
    { ...snapshot, ordinal: 1 },
    { ...snapshot, type: 'glslGrain' },
    { ...snapshot, members: snapshot.members.slice(1) },
    { ...snapshot, members: [snapshot.members[0], snapshot.members[0]] },
    { ...snapshot, members: [{ clipId: 'one', effectId: 'wrong' }, snapshot.members[0]] },
    null,
  ]) rejected(state, { group: broken }, /changed/)
})

test('changed selection and newly locked targets reject old snapshots instead of silently narrowing writes', () => {
  const state = makeState()
  const snapshot = group(state)
  rejected(state, { clipIds: ['one', 'locked'], group: snapshot }, /selection changed/)
  state.clips[1].trackId = 'locked'
  rejected(state, { group: snapshot }, /changed/)
  const fresh = group(state)
  assert.equal(fresh.members.length, 1)
  assert.equal(plan(state, { group: fresh }).changedCount, 1)
})

test('selection validation rejects missing, duplicate and single IDs, unsupported actions and malformed stacks', () => {
  const state = makeState()
  for (const clipIds of [[], ['one'], ['one', 'one'], ['one', 'missing'], null, 'one', ['one', 2]]) rejected(state, { clipIds })
  rejected(state, { action: 'replaceAll' })
  state.clips.push({ ...state.clips[0] })
  rejected(state, {}, /selection changed/)
  state.clips.pop()
  state.clips[0].effects = { opaque: 'future-stack' }
  rejected(state, { action: 'add', type: 'grain' }, /stack is invalid/)
})

test('add appends independent default instances, preserves all existing settings and excludes other targets', () => {
  const state = makeState()
  state.selectedClipIds = state.clips.map(clip => clip.id)
  const result = plan(state, { action: 'add', type: 'glslGrain', settings: undefined })
  assert.equal(result.ok, true)
  assert.equal(result.changedCount, 2)
  assert.deepEqual(result.clips[0].effects.at(-1), fx('created-1', 'glslGrain', { amount: 20 }))
  assert.deepEqual(result.clips[1].effects.at(-1), fx('created-2', 'glslGrain', { amount: 20 }))
  assert.notEqual(result.clips[0].effects.at(-1).settings, result.clips[1].effects.at(-1).settings)
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(result.clips[i].effects.slice(0, -1), state.clips[i].effects)
    assert.deepEqual({ ...result.clips[i], effects: state.clips[i].effects, cacheStatus: state.clips[i].cacheStatus }, state.clips[i])
  }
  for (let i = 2; i < state.clips.length; i++) assert.equal(result.clips[i], state.clips[i])
})

test('add handles empty legacy stacks and every supported visual clip type without timing changes', () => {
  const state = makeState()
  state.clips = ['video', 'image', 'text', 'shape', 'adjustment'].map(type => ({ id: type, type, trackId: 'v', startTime: 2, duration: 4, sourceDuration: 15 }))
  state.selectedClipIds = state.clips.map(clip => clip.id)
  const result = plan(state, { action: 'add', type: 'grain', settings: undefined })
  assert.equal(result.changedCount, 5)
  for (const clip of result.clips) {
    assert.equal(clip.effects.length, 1)
    assert.equal(clip.sourceDuration, 15)
    assert.equal(clip.startTime, 2)
    assert.equal(clip.duration, 4)
  }
})

test('add supports validated sparse presets but rejects unknown types, parameters and unsafe values', () => {
  const state = makeState()
  const result = plan(state, { action: 'add', type: 'grain', settings: { amount: 75, monochrome: 1 } })
  assert.deepEqual(result.clips[0].effects.at(-1).settings, { amount: 75, size: 1, monochrome: 1 })
  for (const request of [
    { type: 'mask' }, { type: 'unknown' }, { type: null },
    { type: 'grain', settings: { amount: 200 } }, { type: 'grain', settings: { future: 1 } },
    { type: 'grain', settings: null }, { type: 'grain', settings: { monochrome: true } },
  ]) rejected(state, { action: 'add', ...request })
})

test('add fails atomically if any generated ID is invalid or collides with old or newly created effects', () => {
  const state = makeState()
  for (const makeId of [() => '', () => 5, () => 'one-grain', () => 'sound-grain', () => 'same-id', () => { throw new Error('no entropy') }]) {
    rejected(state, { action: 'add', type: 'grain' }, /effect ID/, { makeId })
    assert.equal(state.clips[0].effects.length, 4)
    assert.equal(state.clips[1].effects.length, 3)
  }
})

test('adding to uneven repeated stacks preserves counts and does not manufacture a misleading shared group', () => {
  const state = makeState()
  state.clips[1].effects.pop()
  const result = plan(state, { action: 'add', type: 'grain', settings: undefined })
  assert.equal(result.ok, true)
  assert.deepEqual(groups({ ...state, clips: result.clips }).map(item => item.type), ['blur'])
  assert.deepEqual(result.clips.slice(0, 2).map(clip => clip.effects.filter(item => item.type === 'grain').length), [3, 2])
})

test('semantic no-ops preserve clips/arrays/settings/cache references and report zero changes', () => {
  const state = makeState()
  for (const request of [{ settings: {} }, { settings: { monochrome: 0 } }]) {
    const result = plan(state, request)
    assert.equal(result.ok, true)
    assert.equal(result.changedCount, 0)
    assert.equal(result.clips, state.clips)
  }
  const enabled = plan(state, { action: 'enabled', group: group(state, 'grain:1'), enabled: true })
  assert.equal(enabled.clips, state.clips)
  const partial = plan(state, { settings: { amount: 10 } })
  assert.equal(partial.changedCount, 1)
  assert.equal(partial.clips[0], state.clips[0])
})

test('planners never mutate deeply frozen source data for add/update/reset/enabled/remove', () => {
  const freeze = value => {
    if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze) }
    return value
  }
  const state = freeze(makeState())
  for (const request of [{}, { action: 'add', type: 'grain' }, { action: 'reset' }, { action: 'enabled', enabled: true }, { action: 'remove' }]) assert.equal(plan(state, request).ok, true)
})

test('shared legacy blur is a sparse visual-only adjustment preserving color, LUTs, unknown settings and effects', () => {
  const state = makeState()
  state.selectedClipIds = state.clips.map(clip => clip.id)
  state.clips[0].adjustments = { contrast: 20, blur: 3, shadows: { hue: 20 }, lut: { lutId: 'one', amount: 80 }, future: 3 }
  state.clips[1].adjustments = { contrast: -20, blur: 5, highlights: { gain: 10 }, lut: { lutId: 'two', amount: 25 }, future: 4 }
  assert.equal(getMultiClipFieldState(selection(state), 'effects.blur').mixed, true)
  const result = planMultiClipInspectorEdit(state, { clipIds: state.selectedClipIds, property: 'effects.blur', value: 12 })
  assert.equal(result.ok, true)
  assert.equal(result.changedCount, 2)
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(result.clips[i].adjustments, { ...state.clips[i].adjustments, blur: 12 })
    assert.equal(result.clips[i].effects, state.clips[i].effects)
  }
  for (let i = 2; i < state.clips.length; i++) assert.equal(result.clips[i], state.clips[i])
})

test('legacy blur uses the bare blur animation ID, validates 0..50 bounds, and preserves no-op identities', () => {
  const state = makeState()
  const edit = value => planMultiClipInspectorEdit(state, { clipIds: ids, property: 'effects.blur', value })
  assert.equal(edit(0).clips, state.clips)
  assert.equal(edit(50).ok, true)
  for (const value of [-1, 50.01, '', NaN]) {
    assert.equal(edit(value).ok, false)
    assert.equal(edit(value).clips, state.clips)
  }
  state.clips[1].keyframes = { blur: [{ time: 0, value: 0 }] }
  assert.match(getMultiClipFieldState(selection(state), 'effects.blur').blockedReason, /Animated/)
  assert.equal(edit(2).ok, false)
  delete state.clips[1].keyframes.blur
  state.clips[1].keyframes.brightness = [{ time: 0, value: 0 }]
  assert.equal(edit(2).ok, true)
})

test('shared effects bypass changes only the effects flag and safely supports mixed/animated clips', () => {
  const state = makeState()
  state.selectedClipIds = state.clips.map(clip => clip.id)
  state.clips[0].bypass = { effects: false, color: true, masks: true }
  state.clips[1].bypass = { effects: true, color: false, transform: true }
  state.clips[1].keyframes = { 'effect.two-grain.amount': [{ time: 0, value: 10 }] }
  assert.equal(getMultiClipFieldState(selection(state), 'effectsBypass').mixed, true)
  const edit = value => planMultiClipInspectorEdit(state, { clipIds: state.selectedClipIds, property: 'effectsBypass', value })
  const result = edit(true)
  assert.equal(result.ok, true)
  assert.equal(result.changedCount, 1)
  assert.deepEqual(result.clips[0].bypass, { effects: true, color: true, masks: true })
  assert.equal(result.clips[1], state.clips[1])
  assert.equal(result.clips[0].effects, state.clips[0].effects)
  for (let i = 2; i < state.clips.length; i++) assert.equal(result.clips[i], state.clips[i])
  assert.equal(planMultiClipInspectorEdit({ ...state, clips: result.clips }, { clipIds: state.selectedClipIds, property: 'effectsBypass', value: true }).clips, result.clips)
  assert.equal(edit('true').ok, false)
})
