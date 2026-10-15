import test from 'node:test'
import assert from 'node:assert/strict'
import { PASTE_ATTRIBUTE_GROUPS, getPasteAttributesAvailability, planPasteAttributes } from './pasteAttributes.js'
import { MULTI_CLIP_FIELDS, MULTI_CLIP_COLOR_FIELDS } from './multiClipInspector.js'

const definitions = [
  { id: 'grain', params: [{ key: 'amount', min: 0, max: 100 }, { key: 'size', min: 0.5, max: 10 }, { key: 'mono', type: 'toggle' }], defaults: { amount: 10, size: 1, mono: 0 } },
  { id: 'blur', params: [{ key: 'amount', min: 0, max: 50 }], defaults: { amount: 5 } },
]
const getDefinition = type => definitions.find(definition => definition.id === type)
const fx = (id = 'source-grain', type = 'grain', settings = { amount: 25 }, rest = {}) => ({ id, type, settings, enabled: true, ...rest })
const makeSource = () => ({
  id: 'source', type: 'video', trackId: 'video', duration: 10, trimStart: 1, startTime: 0, assetId: 'source-media',
  transform: { positionX: 45, scaleX: 150, scaleY: 80, scaleLinked: false, opacity: 65, blendMode: 'screen', cornerPinEnabled: true, cornerPinTLX: 12, unknown: 'do not copy' },
  adjustments: { brightness: 25, contrast: 12, shadows: { hue: 45, saturation: 20, unknown: 'do not copy' }, blur: 6, lut: { lutId: 'teal', amount: 45 }, future: 'do not copy' },
  bypass: { color: true, effects: true, transform: true },
  effects: [fx('source-grain', 'grain', { amount: 25, future: { samples: [1, 2] } }, { name: 'Custom grain', metadata: { tag: 'copied' } }), fx('source-blur', 'blur', { amount: 7 }, { enabled: false })],
  motionBlur: { enabled: true }, masks: [{ id: 'source-mask' }], keyframes: { speed: [{ time: 0, value: 1 }] },
})
const makeState = () => ({
  selectedClipIds: ['one', 'two'],
  tracks: [{ id: 'video', type: 'video' }, { id: 'audio', type: 'audio' }, { id: 'locked', type: 'video', locked: true }],
  clips: [
    { id: 'one', type: 'video', trackId: 'video', duration: 5, trimStart: 2, startTime: 4, sourceDuration: 20, assetId: 'one-media', linkGroupId: 'av', transform: { positionX: 4, future: { keep: 1 } }, adjustments: { brightness: 1, blur: 2, future: { keep: 2 }, shadows: { unknown: 'preserve' }, lut: { lutId: 'old', amount: 20 } }, bypass: { color: false, transform: true }, effects: [fx('one-blur', 'blur')], masks: [{ id: 'one-mask' }], shapeMask: { centerX: 0.5 }, motionBlur: { enabled: false }, keyframes: { speed: [{ time: 0, value: 0.5 }], 'shapeMask.centerX': [{ time: 0, value: 0.5 }] }, cacheStatus: 'cached', cacheUrl: '/cache/one.mp4', cacheMetadata: { signature: 'old' } },
    { id: 'two', type: 'shape', trackId: 'video', duration: 3, startTime: 9, effects: [], adjustments: { contrast: -3 }, cacheStatus: 'rendering', cacheUrl: '/cache/two.mp4', shape: { fill: '#fff' } },
    { id: 'audio-one', type: 'audio', trackId: 'audio', duration: 8, startTime: 1, gainDb: -4, fadeIn: 0.5, fadeOut: 0.25, assetId: 'audio', linkGroupId: 'av' },
    { id: 'audio-two', type: 'audio', trackId: 'audio', duration: 2, startTime: 10, gainDb: 2, fadeIn: 0, fadeOut: 0 },
    { id: 'locked-one', type: 'image', trackId: 'locked', duration: 5, effects: [{ type: 'unknown' }] },
    { id: 'orphan', type: 'image', trackId: 'gone', duration: 5 },
  ],
})
const audioSource = () => ({ id: 'audio-source', type: 'audio', duration: 6, gainDb: -9, fadeIn: 1.5, fadeOut: 1, effects: [{ type: 'ignored' }] })
const request = (state, source = makeSource(), groups = ['transform', 'color', 'effects']) => ({ source, clipIds: state.selectedClipIds, groups })
const plan = (state, data = request(state), options = {}) => {
  let counter = 0
  return planPasteAttributes(state, data, { getDefinition, makeId: () => `new-${++counter}`, ...options })
}
const availability = (state, source = makeSource()) => getPasteAttributesAvailability(state, { source, clipIds: state.selectedClipIds }, { getDefinition })
const status = (state, group, source = makeSource()) => availability(state, source).groups.find(item => item.id === group)
const reject = (state, data, pattern, options) => {
  const result = plan(state, data, options)
  assert.equal(result.ok, false)
  assert.equal(result.changedCount, 0)
  assert.equal(result.clips, state.clips)
  if (pattern) assert.match(result.error, pattern)
  return result
}
const freeze = object => {
  if (object && typeof object === 'object') { Object.values(object).forEach(freeze); Object.freeze(object) }
  return object
}

test('availability gives stable four-group UI metadata and type-specific destinations', () => {
  const state = makeState()
  assert.deepEqual(PASTE_ATTRIBUTE_GROUPS.map(group => group.id), ['transform', 'color', 'effects', 'audio'])
  const available = availability(state)
  assert.equal(available.ok, true)
  assert.equal(available.groups.length, 4)
  for (const group of available.groups.slice(0, 3)) { assert.equal(group.targetCount, 2); assert.equal(group.blockedReason, '') }
  assert.match(available.groups[3].blockedReason, /visual/)
  assert.equal(available.groups[3].targetCount, 0)
})

test('atomic visual paste preserves timing, media, links, masks, motion blur and unknown target fields', () => {
  const state = freeze(makeState())
  const source = freeze(makeSource())
  const result = plan(state, request(state, source))
  assert.equal(result.ok, true)
  assert.equal(result.changedCount, 2)
  assert.equal(result.targetCount, 2)
  const updated = result.clips[0]
  for (const key of ['duration', 'trimStart', 'startTime', 'sourceDuration', 'assetId', 'linkGroupId', 'masks', 'shapeMask', 'motionBlur', 'keyframes', 'cacheUrl', 'cacheMetadata']) assert.equal(updated[key], state.clips[0][key])
  assert.equal(updated.transform.future, state.clips[0].transform.future)
  assert.equal(updated.adjustments.future, state.clips[0].adjustments.future)
  assert.equal(updated.adjustments.shadows.unknown, 'preserve')
  assert.equal(updated.transform.unknown, undefined)
  assert.equal(updated.bypass.transform, true)
  assert.equal(updated.cacheStatus, 'invalid')
  assert.equal(result.clips[1].cacheStatus, 'rendering')
  state.clips.slice(2).forEach((clip, index) => assert.equal(result.clips[index + 2], clip))
})

test('transform covers all supported field types with independent X/Y scale and source defaults', () => {
  const state = makeState()
  const source = makeSource()
  source.transform.rotation = -35
  source.transform.flipH = true
  const result = plan(state, request(state, source, ['transform']))
  assert.equal(result.ok, true)
  for (const clip of result.clips.slice(0, 2)) {
    for (const field of MULTI_CLIP_FIELDS.filter(item => item.group === 'transform')) assert.equal(clip.transform?.[field.id] ?? field.initial, source.transform[field.id] ?? field.initial, field.id)
    assert.equal(clip.transform.scaleX, 150)
    assert.equal(clip.transform.scaleY, 80)
    assert.equal(clip.transform.scaleLinked, false)
    assert.equal(clip.transform.cornerPinTLX, 12)
  }
  assert.equal(result.clips[0].effects, state.clips[0].effects)
  assert.equal(result.clips[0].adjustments, state.clips[0].adjustments)
})

test('color copies normalized grade, tonal controls, LUT and bypass without blur or other attributes', () => {
  const state = makeState()
  const source = makeSource()
  source.adjustments.brightness = 200
  source.adjustments.shadows.hue = -999
  const result = plan(state, request(state, source, ['color']))
  const target = result.clips[0]
  assert.equal(result.ok, true)
  assert.equal(target.adjustments.brightness, 100)
  assert.equal(target.adjustments.shadows.hue, -180)
  assert.equal(target.adjustments.blur, 2)
  assert.equal(target.adjustments.future, state.clips[0].adjustments.future)
  assert.equal(target.adjustments.shadows.unknown, 'preserve')
  assert.deepEqual(target.adjustments.lut, { lutId: 'teal', amount: 45 })
  assert.notEqual(target.adjustments.lut, source.adjustments.lut)
  assert.notEqual(target.adjustments.lut, result.clips[1].adjustments.lut)
  assert.equal(target.bypass.color, true)
  assert.equal(target.bypass.effects, undefined)
  assert.equal(target.effects, state.clips[0].effects)
  assert.equal(target.transform, state.clips[0].transform)
})

test('color source defaults clear existing grades and LUT, preserving unrelated adjustment keys', () => {
  const state = makeState()
  const source = { id: 'plain', type: 'image' }
  const result = plan(state, request(state, source, ['color']))
  assert.equal(result.ok, true)
  assert.equal(result.clips[0].adjustments.brightness, 0)
  assert.equal(result.clips[0].adjustments.lut, null)
  assert.equal(result.clips[0].adjustments.blur, 2)
  assert.equal(result.clips[0].adjustments.future, state.clips[0].adjustments.future)
})

test('effects replacement copies order, disabled state, metadata and settings with independent unique IDs', () => {
  const state = makeState()
  const source = makeSource()
  const result = plan(state, request(state, source, ['effects']))
  assert.equal(result.ok, true)
  const all = result.clips.slice(0, 2).flatMap(clip => clip.effects)
  assert.deepEqual(all.map(effect => effect.id), ['new-1', 'new-2', 'new-3', 'new-4'])
  for (const clip of result.clips.slice(0, 2)) {
    assert.deepEqual(clip.effects.map(effect => effect.type), ['grain', 'blur'])
    assert.equal(clip.effects[1].enabled, false)
    assert.equal(clip.effects[0].settings.size, 1)
    assert.deepEqual(clip.effects[0].settings.future, { samples: [1, 2] })
    assert.deepEqual(clip.effects[0].metadata, { tag: 'copied' })
    assert.equal(clip.adjustments.blur, 6)
    assert.equal(clip.bypass.effects, true)
  }
  assert.notEqual(all[0].settings.future, all[2].settings.future)
  assert.notEqual(all[0].settings.future, source.effects[0].settings.future)
  assert.notEqual(all[0].metadata, all[2].metadata)
  assert.equal(result.clips[0].adjustments.brightness, 1)
  assert.equal(result.clips[0].bypass.color, false)
  assert.equal(result.clips[0].masks, state.clips[0].masks)
})

test('empty source effects remove the stack and clear only last-effect cache metadata', () => {
  const state = makeState()
  const source = { id: 'plain', type: 'image' }
  const result = plan(state, request(state, source, ['effects']))
  assert.equal(result.ok, true)
  assert.deepEqual(result.clips[0].effects, [])
  assert.equal(result.clips[0].cacheStatus, 'none')
  assert.equal(result.clips[0].cacheUrl, null)
  assert.equal(result.clips[0].cacheMetadata, state.clips[0].cacheMetadata)
  assert.equal(result.clips[0].adjustments.blur, 0)
  assert.equal(result.clips[1], state.clips[1])
})

test('blur-only changes do not clear a cache merely because both managed stacks are empty', () => {
  const state = makeState()
  state.clips[0].effects = []
  const result = plan(state, request(state, { id: 'plain', type: 'image' }, ['effects']))
  assert.equal(result.clips[0].cacheStatus, 'invalid')
  assert.equal(result.clips[0].cacheUrl, '/cache/one.mp4')
})

test('audio gain/fades use absolute values on audio tracks only and retain AV linkage/timing', () => {
  const state = makeState()
  state.selectedClipIds = ['one', 'audio-one', 'audio-two', 'locked-one', 'orphan']
  const result = plan(state, request(state, audioSource(), ['audio']))
  assert.equal(result.ok, true)
  assert.equal(result.targetCount, 2)
  assert.equal(result.changedCount, 2)
  for (const clip of result.clips.slice(2, 4)) { assert.equal(clip.gainDb, -9); assert.equal(clip.fadeIn, 1.5); assert.equal(clip.fadeOut, 1) }
  assert.equal(result.clips[2].linkGroupId, 'av')
  assert.equal(result.clips[2].duration, 8)
  assert.equal(result.clips[2].startTime, 1)
  assert.equal(result.clips[0], state.clips[0])
  assert.equal(result.clips[4], state.clips[4])
})

test('video never supplies audio attributes even if it has legacy gain fields', () => {
  const state = makeState()
  state.selectedClipIds = ['audio-one']
  const source = { ...makeSource(), gainDb: -3, fadeIn: 1 }
  reject(state, request(state, source, ['audio']), /visual/)
  assert.equal(status(state, 'audio', source).targetCount, 0)
})

test('fade too long for one destination rejects all audio edits without clamping', () => {
  const state = makeState()
  state.selectedClipIds = ['audio-one', 'audio-two']
  const source = { ...audioSource(), fadeOut: 2.1 }
  assert.match(status(state, 'audio', source).blockedReason, /fit/)
  reject(state, request(state, source, ['audio']), /fit/)
  state.clips[3].duration = 2.1
  assert.equal(plan(state, request(state, source, ['audio'])).ok, true)
})

test('invalid source gain/fade and invalid destination durations reject safely', () => {
  for (const fields of [{ gainDb: 25 }, { gainDb: 'bad' }, { fadeIn: -1 }, { fadeOut: Infinity }, { duration: 1 }]) {
    const state = makeState()
    state.selectedClipIds = ['audio-one']
    reject(state, request(state, { ...audioSource(), ...fields }, ['audio']), /invalid|range|fit/)
  }
  const state = makeState()
  state.selectedClipIds = ['audio-one']
  state.clips[2].duration = undefined
  reject(state, request(state, audioSource(), ['audio']), /fit/)
})

test('locked and unsupported destinations are counted and skipped, including their invalid effects', () => {
  const state = makeState()
  state.selectedClipIds = state.clips.map(clip => clip.id)
  const result = availability(state)
  assert.equal(result.lockedCount, 1)
  assert.equal(result.unsupportedCount, 1)
  assert.equal(result.groups[2].blockedReason, '')
  assert.equal(plan(state).changedCount, 2)
  state.selectedClipIds = ['locked-one', 'orphan', 'audio-one']
  reject(state, request(state), /No editable visual/)
})

test('all five visual types accept attributes without transferring type-specific content', () => {
  for (const type of ['video', 'image', 'shape', 'text', 'adjustment']) {
    const state = makeState()
    state.selectedClipIds = ['two']
    state.clips[1].type = type
    const result = plan(state)
    assert.equal(result.ok, true, type)
    assert.equal(result.clips[1].type, type)
    assert.equal(result.clips[1].shape, state.clips[1].shape)
  }
})

test('source snapshot remains usable after its original clip is changed or removed', () => {
  const state = makeState()
  const source = freeze(makeSource())
  state.clips.push({ ...makeSource(), transform: { positionX: 999 } })
  let result = plan(state, request(state, source, ['transform']))
  assert.equal(result.clips[0].transform.positionX, 45)
  assert.equal(result.clips.at(-1), state.clips.at(-1))
  state.clips.pop()
  result = plan(state, request(state, source, ['transform']))
  assert.equal(result.clips[0].transform.positionX, 45)
})

test('exact selection is revalidated but current selection order is immaterial', () => {
  const state = makeState()
  const data = request(state)
  assert.equal(plan(state, { ...data, clipIds: ['two', 'one'] }).ok, true)
  state.selectedClipIds = ['two']
  reject(state, data, /selection changed/)
  assert.equal(getPasteAttributesAvailability(state, data, { getDefinition }).ok, false)
})

test('duplicate/missing IDs, clip records, and ambiguous tracks are rejected', () => {
  for (const update of [
    state => { state.selectedClipIds = ['one', 'one'] },
    state => { state.selectedClipIds = ['one', 'missing'] },
    state => { state.selectedClipIds = [] },
    state => { state.selectedClipIds = [1] },
    state => { state.clips.push({ ...state.clips[0] }) },
    state => { state.tracks.push({ id: 'video', type: 'video', locked: true }) },
  ]) {
    const state = makeState()
    update(state)
    reject(state, request(state))
  }
})

test('groups must be explicit, known and nonempty without duplicates', () => {
  const state = makeState()
  for (const groups of [undefined, [], ['transform', 'transform'], ['masks'], 'color', null, [null]]) reject(state, { ...request(state), groups }, /supported attribute group/)
})

test('source must be one valid clip snapshot, not a list or unsupported timeline object', () => {
  const state = makeState()
  for (const source of [null, [], [makeSource()], {}, { id: 'x', type: 'transition' }, { id: '', type: 'video' }]) reject(state, request(state, source), /Copy one/)
})

test('every supported transform animation path blocks the group on source or target', () => {
  for (const field of MULTI_CLIP_FIELDS.filter(item => item.group === 'transform')) {
    for (const owner of ['source', 'target']) {
      const state = makeState()
      const source = makeSource()
      const clip = owner === 'source' ? source : state.clips[1]
      clip.keyframes = { [field.id]: [{ time: 0, value: 1 }] }
      assert.match(status(state, 'transform', source).blockedReason, /Animated/, `${owner} ${field.id}`)
      reject(state, request(state, source, ['transform']), /Animated/)
    }
  }
})

test('all known color/tonal and LUT animation paths protect color but not other groups', () => {
  for (const key of [...MULTI_CLIP_COLOR_FIELDS.map(field => field.path), 'lut.amount', 'adjustments.lut.amount', 'colorBypass']) {
    for (const owner of ['source', 'target']) {
      const state = makeState()
      const source = makeSource()
      const clip = owner === 'source' ? source : state.clips[1]
      clip.keyframes = { [key]: [{ time: 0, value: 1 }] }
      reject(state, request(state, source, ['color']), /Animated/)
      assert.equal(plan(state, request(state, source, ['effects'])).ok, true)
    }
  }
})

test('effects replacement protects all own and orphaned effect keyframes plus blur', () => {
  for (const key of ['effect.source-grain.amount', 'effect.orphan.unknown', 'effect.weird.id.new', 'blur', 'adjustments.blur', 'effectsBypass']) {
    for (const owner of ['source', 'target']) {
      const state = makeState()
      const source = makeSource()
      const clip = owner === 'source' ? source : state.clips[1]
      clip.keyframes = { [key]: [{ time: 0, value: 1 }] }
      reject(state, request(state, source, ['effects']), /Animated/)
      assert.equal(plan(state, request(state, source, ['color'])).ok, true)
    }
  }
})

test('audio animation on either side blocks audio; unrelated keyframes and empty lists remain untouched', () => {
  for (const key of ['gainDb', 'fadeIn', 'fadeOut']) {
    for (const owner of ['source', 'target']) {
      const state = makeState()
      state.selectedClipIds = ['audio-one', 'audio-two']
      const source = audioSource()
      const clip = owner === 'source' ? source : state.clips[2]
      clip.keyframes = { [key]: [{ time: 0, value: 1 }] }
      reject(state, request(state, source, ['audio']), /Animated/)
    }
  }
  const state = makeState()
  const source = makeSource()
  source.keyframes = { positionX: [], 'effect.source-grain.amount': [], speed: [{ time: 0, value: 2 }] }
  const result = plan(state, request(state, source))
  assert.equal(result.ok, true)
  assert.equal(result.clips[0].keyframes, state.clips[0].keyframes)
  assert.equal(result.clips[1].keyframes, undefined)
})

test('one blocked group rejects the complete paste before any ID allocation', () => {
  const state = makeState()
  state.clips[1].keyframes = { brightness: [{ time: 0, value: 1 }] }
  let allocations = 0
  reject(state, request(state, makeSource(), ['effects', 'transform', 'color']), /Color:.*Animated/, { makeId: () => { allocations++; return 'x' } })
  assert.equal(allocations, 0)
})

test('unknown/nonmanaged or malformed effects on source or eligible target block stack replacement only', () => {
  const invalidStacks = [
    {}, [fx('id', 'mask')], [fx('id', 'future')], [null], [{ type: 'grain', settings: {} }],
    [fx('id'), fx('id')], [fx('id', 'grain', [])], [fx('id', 'grain', { amount: 'bad' })],
    [fx('id', 'grain', { amount: Infinity })], [fx('id', 'grain', {}, { enabled: 'false' })],
  ]
  for (const effects of invalidStacks) {
    for (const owner of ['source', 'target']) {
      const state = makeState()
      const source = makeSource()
      ;(owner === 'source' ? source : state.clips[1]).effects = effects
      reject(state, request(state, source, ['effects']), /effect|stack/i)
      assert.equal(plan(state, request(state, source, ['transform'])).ok, true)
    }
  }
})

test('registry failures are safe, while absent stacks require no registry or ID maker', () => {
  const state = makeState()
  reject(state, request(state, makeSource(), ['effects']), /unsupported|non-managed/, { getDefinition: undefined })
  reject(state, request(state, makeSource(), ['effects']), /unsupported|non-managed/, { getDefinition: () => { throw Error('registry') } })
  state.clips[0].effects = []
  const result = plan(state, request(state, { id: 'x', type: 'image' }, ['effects']), { getDefinition: undefined, makeId: undefined })
  assert.equal(result.ok, true)
})

test('effect ID collisions against any timeline clip, source or another new copy reject all changes', () => {
  const state = makeState()
  for (const id of ['one-blur', 'source-grain', '', null, 1]) reject(state, request(state), /unique effect ID/, { makeId: () => id })
  reject(state, request(state), /unique effect ID/, { makeId: () => 'repeated-new-id' })
  reject(state, request(state), /new effect ID/, { makeId: () => { throw Error('id') } })
})

test('effect copies with only IDs/default representation differences are true no-ops', () => {
  const state = makeState()
  state.selectedClipIds = ['one', 'two']
  const source = { id: 'plain', type: 'image', effects: [{ id: 'src', type: 'grain', settings: {} }] }
  for (const clip of state.clips.slice(0, 2)) {
    clip.effects = [{ id: `${clip.id}-grain`, type: 'grain', enabled: true, settings: { amount: 10, size: 1, mono: 0 } }]
    clip.adjustments = { blur: 0 }
    clip.bypass = { effects: false }
  }
  const result = plan(state, request(state, source, ['effects']), { makeId: () => { throw Error('must not allocate') } })
  assert.equal(result.ok, true)
  assert.equal(result.changedCount, 0)
  assert.equal(result.clips, state.clips)
  assert.equal(result.clips[0].cacheStatus, 'cached')
})

test('effect stack order, unknown settings and metadata differences are meaningful replacement changes', () => {
  for (const change of [
    clip => clip.effects.reverse(),
    clip => { clip.effects[0].settings.future = 'different' },
    clip => { clip.effects[0].metadata.tag = 'different' },
    clip => { clip.effects[1].enabled = true },
  ]) {
    const state = makeState()
    const source = makeSource()
    state.selectedClipIds = ['one']
    state.clips[0].effects = structuredClone(source.effects)
    state.clips[0].adjustments.blur = 6
    state.clips[0].bypass.effects = true
    change(state.clips[0])
    assert.equal(plan(state, request(state, source, ['effects'])).changedCount, 1)
  }
})

test('default-equivalent transform/color/audio copies do not densify objects or add fake history', () => {
  const state = makeState()
  state.selectedClipIds = ['two']
  delete state.clips[1].adjustments
  const plain = { id: 'plain', type: 'shape' }
  const visualResult = plan(state, request(state, plain, ['transform', 'color', 'effects']))
  assert.equal(visualResult.ok, true)
  assert.equal(visualResult.clips, state.clips)
  assert.equal(visualResult.changedCount, 0)
  state.selectedClipIds = ['audio-two']
  delete state.clips[3].gainDb
  const audioResult = plan(state, request(state, { id: 'plain-audio', type: 'audio', duration: 5 }, ['audio']))
  assert.equal(audioResult.clips, state.clips)
  assert.equal(audioResult.changedCount, 0)
})

test('only actually changed targets get fresh objects/effect IDs/cache invalidation', () => {
  const state = makeState()
  const source = makeSource()
  state.clips[1].effects = structuredClone(source.effects).map((effect, i) => ({ ...effect, id: `same-${i}` }))
  state.clips[1].adjustments.blur = source.adjustments.blur
  state.clips[1].bypass = { effects: true }
  let ids = 0
  const result = plan(state, request(state, source, ['effects']), { makeId: () => `fresh-${++ids}` })
  assert.equal(result.changedCount, 1)
  assert.equal(result.targetCount, 2)
  assert.equal(ids, 2)
  assert.equal(result.clips[1], state.clips[1])
})

test('malformed scoped containers/settings and animation data fail without mutation', () => {
  for (const [group, patch] of [
    ['transform', { transform: [] }], ['transform', { transform: { scaleX: -1 } }],
    ['color', { adjustments: [] }], ['color', { adjustments: { shadows: [] } }],
    ['effects', { bypass: [] }], ['color', { keyframes: [] }],
    ['effects', { keyframes: { blur: { malformed: true } } }],
  ]) {
    const state = makeState()
    reject(state, request(state, { ...makeSource(), ...patch }, [group]), /invalid|range|protected/i)
  }
})

test('cyclic/uncloneable effect metadata is rejected rather than shared or partially copied', () => {
  const state = makeState()
  for (const metadata of [{ callback: () => 1 }, new Date(), { value: Symbol('x') }]) {
    const source = makeSource()
    source.effects[0].metadata = metadata
    reject(state, request(state, source, ['effects']), /malformed/)
  }
  const source = makeSource()
  source.effects[0].metadata.loop = source.effects[0]
  reject(state, request(state, source, ['effects']), /malformed/)
})

test('complete group ordering does not change result or lose separate bypass/adjustment fields', () => {
  const state = makeState()
  const a = plan(state, request(state, makeSource(), ['color', 'effects', 'transform']))
  const b = plan(state, request(state, makeSource(), ['effects', 'transform', 'color']))
  assert.deepEqual(a, b)
  assert.equal(a.clips[0].bypass.color, true)
  assert.equal(a.clips[0].bypass.effects, true)
  assert.equal(a.clips[0].adjustments.blur, 6)
  assert.equal(a.clips[0].adjustments.contrast, 12)
})
