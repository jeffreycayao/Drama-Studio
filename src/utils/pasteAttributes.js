import { MULTI_CLIP_FIELDS, MULTI_CLIP_COLOR_FIELDS, getMultiClipSelection } from './multiClipInspector.js'
import { getAdjustmentValue, normalizeAdjustmentSettings, TONAL_ADJUSTMENT_GROUP_KEYS } from './adjustments.js'
import { normalizeAudioClipGainDb } from './audioClipGain.js'

export const PASTE_ATTRIBUTE_GROUPS = Object.freeze([
  { id: 'transform', label: 'Transform', description: 'Replace position, scale, rotation, crop, corner pin, opacity and blend mode.' },
  { id: 'color', label: 'Color', description: 'Replace the grade, LUT and Color bypass. Leave blur unchanged.' },
  { id: 'effects', label: 'Effects', description: 'Replace all built-in effects, blur and Effects bypass. Keep masks and motion blur.' },
  { id: 'audio', label: 'Audio', description: 'Replace gain and fade durations on audio clips. Fades must fit every target.' },
].map(Object.freeze))

const visualTypes = new Set(['video', 'image', 'text', 'shape', 'adjustment'])
const transformFields = MULTI_CLIP_FIELDS.filter(field => field.group === 'transform')
const audioFields = MULTI_CLIP_FIELDS.filter(field => field.group === 'audio')
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isPlain = value => isObject(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
const validId = value => typeof value === 'string' && value.trim().length > 0
const stackOf = clip => clip.effects || []
const same = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-7
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => hasOwn(b, key) && same(a[key], b[key]))
}
const clone = value => Array.isArray(value) ? value.map(clone)
  : isObject(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value

// Only copied attribute data is checked. A clip may contain unrelated legacy
// fields, which this operation must neither reinterpret nor remove.
function isCopyable(value, seen = new Set()) {
  if (value == null || ['string', 'boolean', 'undefined'].includes(typeof value)) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if ((!Array.isArray(value) && !isPlain(value)) || seen.has(value)) return false
  seen.add(value)
  const result = Object.values(value).every(item => isCopyable(item, seen))
  seen.delete(value)
  return result
}

function resolveRequest(state, request) {
  if (!isObject(state) || !Array.isArray(state.clips) || !Array.isArray(state.tracks) || !isObject(request)) return { error: 'Invalid paste request.' }
  const { source, clipIds } = request
  if (!isPlain(source) || !validId(source.id) || (!visualTypes.has(source.type) && source.type !== 'audio')) return { error: 'Copy one visual or audio clip first.' }
  if (!Array.isArray(clipIds) || !clipIds.length || clipIds.some(id => !validId(id)) || new Set(clipIds).size !== clipIds.length) return { error: 'Select distinct destination clips.' }
  const ids = new Set(clipIds)
  const current = state.selectedClipIds
  if (!Array.isArray(current) || current.length !== ids.size || new Set(current).size !== current.length || current.some(id => !ids.has(id))) return { error: 'The selection changed. Open Paste Attributes again.' }
  if (state.clips.filter(clip => clip && ids.has(clip.id)).length !== ids.size || [...ids].some(id => !state.clips.some(clip => clip?.id === id))) return { error: 'The destination clips changed. Open Paste Attributes again.' }
  // Ambiguous tracks could turn a locked clip into an editable target.
  const trackIds = state.clips.filter(clip => clip && ids.has(clip.id)).map(clip => clip.trackId)
  if (trackIds.some(id => state.tracks.filter(track => track?.id === id).length > 1)) return { error: 'The destination tracks are ambiguous.' }
  if (state.clips.some(clip => !isObject(clip)) || state.tracks.some(track => !isObject(track))) return { error: 'Invalid timeline data.' }
  return { source, selection: getMultiClipSelection(state.clips, state.tracks, clipIds) }
}

function fieldValue(clip, field) {
  if (field.id === 'gainDb') return normalizeAudioClipGainDb(clip.gainDb)
  const value = field.group === 'audio' ? clip[field.id] : clip.transform?.[field.id]
  if (field.type === 'boolean') return typeof value === 'boolean' ? value : field.initial
  if (field.options) return field.options.includes(value) ? value : field.initial
  return value != null && Number.isFinite(Number(value)) ? Number(value) : field.initial
}

function fieldsSourceError(source, fields) {
  for (const field of fields) {
    const raw = field.group === 'audio' ? source[field.id] : source.transform?.[field.id]
    if (raw == null) continue
    if (field.type === 'boolean') { if (typeof raw !== 'boolean') return 'The copied clip has an invalid setting.' }
    else if (field.options) { if (!field.options.includes(raw)) return 'The copied clip has an unsupported setting.' }
    else if (!['number', 'string'].includes(typeof raw) || String(raw).trim() === '' || !Number.isFinite(Number(raw)) || (field.min != null && Number(raw) < field.min) || (field.max != null && Number(raw) > field.max)) return 'The copied clip has an out-of-range or invalid setting.'
  }
  return ''
}

function affectsAnimation(group, key) {
  if (group === 'transform') return transformFields.some(field => key === field.id || key === `transform.${field.id}`)
  if (group === 'color') return MULTI_CLIP_COLOR_FIELDS.some(field => [field.path, field.id, `adjustments.${field.path}`].includes(key)) || ['lut', 'lut.amount', 'lut.lutId', 'adjustments.lut', 'adjustments.lut.amount', 'colorBypass', 'bypass.color'].includes(key)
  if (group === 'effects') return key.startsWith('effect.') || ['blur', 'effects.blur', 'adjustments.blur', 'effectsBypass', 'bypass.effects'].includes(key)
  return ['gainDb', 'gain', 'fadeIn', 'fadeOut', 'audio.gainDb', 'audio.fadeIn', 'audio.fadeOut'].includes(key)
}

function animationError(clips, group) {
  for (const clip of clips) {
    if (clip.keyframes != null && !isPlain(clip.keyframes)) return 'Invalid animation data — select one clip to inspect it.'
    if (Object.entries(clip.keyframes || {}).some(([key, frames]) => affectsAnimation(group, key) && frames != null && (!Array.isArray(frames) || frames.length > 0))) return 'Animated attributes are protected. Remove this group from the paste; keyframes are not transferred.'
  }
  return ''
}

function normalizedStack(clip, getDefinition) {
  if (clip.effects != null && !Array.isArray(clip.effects)) return { error: 'An effect stack is invalid. Select one clip to inspect it.' }
  const ids = new Set()
  const effects = []
  for (const effect of stackOf(clip)) {
    if (!isPlain(effect) || !validId(effect.id) || ids.has(effect.id) || !validId(effect.type) || !isCopyable(effect) || (effect.settings != null && !isPlain(effect.settings)) || (effect.enabled != null && typeof effect.enabled !== 'boolean')) return { error: 'An effect stack is malformed. Select one clip to inspect it.' }
    ids.add(effect.id)
    let definition
    try { definition = typeof getDefinition === 'function' ? getDefinition(effect.type) : null } catch { /* Treat an unavailable registry entry as unsupported. */ }
    if (definition?.id !== effect.type || !Array.isArray(definition.params) || !isPlain(definition.defaults)) return { error: 'A clip contains custom or unsupported effects. Those effects cannot be replaced here.' }
    const settings = { ...effect.settings }
    const keys = new Set()
    for (const param of definition.params) {
      if (!validId(param?.key) || ['__proto__', 'constructor', 'prototype'].includes(param.key) || keys.has(param.key)) return { error: 'An effect definition is invalid.' }
      keys.add(param.key)
      const incoming = hasOwn(settings, param.key) ? settings[param.key] : definition.defaults[param.key]
      if (param.type === 'toggle') {
        if (![true, false, 0, 1, '0', '1'].includes(incoming)) return { error: 'An effect setting is invalid.' }
        // Match the renderer’s truthy toggle interpretation, including strings.
        settings[param.key] = incoming ? 1 : 0
      } else {
        if (param.type != null || !['number', 'string'].includes(typeof incoming) || String(incoming).trim() === '' || !Number.isFinite(Number(incoming))) return { error: 'An effect setting is invalid.' }
        settings[param.key] = Math.max(param.min ?? -Infinity, Math.min(param.max ?? Infinity, Number(incoming)))
        if (!Number.isFinite(settings[param.key])) return { error: 'An effect setting is invalid.' }
      }
    }
    const { id, ...metadata } = effect
    effects.push({ ...metadata, enabled: effect.enabled !== false, settings })
  }
  return { effects }
}

function groupStatus(group, source, selection, getDefinition) {
  const compatible = group.id === 'audio' ? source.type === 'audio' : visualTypes.has(source.type)
  const targets = compatible ? (group.id === 'audio' ? selection.audio : selection.visual) : []
  let blockedReason = !compatible ? `The copied ${source.type === 'audio' ? 'audio' : 'visual'} clip has no ${group.label.toLowerCase()} attributes to paste.`
    : !targets.length ? `No editable ${group.id === 'audio' ? 'audio' : 'visual'} destination clips selected.` : ''
  const clips = [source, ...targets]
  if (!blockedReason) blockedReason = animationError(clips, group.id)
  if (!blockedReason && group.id === 'transform') {
    if (clips.some(clip => clip.transform != null && !isPlain(clip.transform))) blockedReason = 'A clip has invalid transform data.'
    else blockedReason = fieldsSourceError(source, transformFields)
  }
  if (!blockedReason && ['color', 'effects'].includes(group.id)) {
    if (clips.some(clip => (clip.adjustments != null && !isPlain(clip.adjustments)) || (clip.bypass != null && !isPlain(clip.bypass)))) blockedReason = 'A clip has invalid adjustment data.'
    else if (group.id === 'color' && clips.some(clip => TONAL_ADJUSTMENT_GROUP_KEYS.some(key => clip.adjustments?.[key] != null && !isPlain(clip.adjustments[key])))) blockedReason = 'A clip has invalid tonal adjustment data.'
    else if (group.id === 'color' && !isCopyable(source.adjustments?.lut)) blockedReason = 'The copied LUT reference is invalid.'
  }
  if (!blockedReason && group.id === 'effects') {
    for (const clip of clips) {
      const result = normalizedStack(clip, getDefinition)
      if (result.error) { blockedReason = result.error; break }
    }
  }
  if (!blockedReason && group.id === 'audio') {
    blockedReason = fieldsSourceError(source, audioFields)
    const fade = Math.max(fieldValue(source, audioFields.find(field => field.id === 'fadeIn')), fieldValue(source, audioFields.find(field => field.id === 'fadeOut')))
    if (!blockedReason && clips.some(clip => !Number.isFinite(Number(clip.duration)) || Number(clip.duration) < 0 || fade > Number(clip.duration))) blockedReason = 'Fade duration must fit the copied clip and every destination audio clip. Fades are not shortened automatically.'
  }
  return { ...group, targetCount: targets.length, blockedReason, targets }
}

/** Availability and execution share validation; a dialog preview is never authority to bypass current state. */
export function getPasteAttributesAvailability(state, request = {}, { getDefinition } = {}) {
  const resolved = resolveRequest(state, request)
  if (resolved.error) return { ok: false, error: resolved.error, groups: [], lockedCount: 0, unsupportedCount: 0 }
  const { source, selection } = resolved
  return {
    ok: true,
    groups: PASTE_ATTRIBUTE_GROUPS.map(group => {
      const { targets, ...status } = groupStatus(group, source, selection, getDefinition)
      return status
    }),
    lockedCount: selection.lockedCount,
    unsupportedCount: selection.unsupportedCount,
  }
}

function applyFields(clip, source, fields) {
  const changes = Object.fromEntries(fields.filter(field => !same(fieldValue(clip, field), fieldValue(source, field))).map(field => [field.id, fieldValue(source, field)]))
  if (!Object.keys(changes).length) return clip
  return fields[0].group === 'audio' ? { ...clip, ...changes } : { ...clip, transform: { ...clip.transform, ...changes } }
}

function applyColor(clip, source) {
  const from = normalizeAdjustmentSettings(source.adjustments)
  const to = normalizeAdjustmentSettings(clip.adjustments)
  let adjustments = clip.adjustments
  for (const field of MULTI_CLIP_COLOR_FIELDS) {
    const value = getAdjustmentValue(from, field.path)
    if (same(value, getAdjustmentValue(to, field.path))) continue
    const [key, nested] = field.path.split('.')
    adjustments = nested ? { ...adjustments, [key]: { ...adjustments?.[key], [nested]: value } } : { ...adjustments, [key]: value }
  }
  if (!same(from.lut, to.lut)) adjustments = { ...adjustments, lut: clone(from.lut) }
  let next = adjustments === clip.adjustments ? clip : { ...clip, adjustments }
  if ((source.bypass?.color === true) !== (clip.bypass?.color === true)) next = { ...next, bypass: { ...clip.bypass, color: source.bypass?.color === true } }
  return next
}

/** Atomic immutable plan; the caller owns the copied snapshot, undo and dirty tracking. */
export function planPasteAttributes(state, request = {}, { getDefinition, makeId } = {}) {
  const fail = error => ({ ok: false, error, clips: state?.clips, changedCount: 0, targetCount: 0 })
  const resolved = resolveRequest(state, request)
  if (resolved.error) return fail(resolved.error)
  const { groups } = request
  if (!Array.isArray(groups) || !groups.length || new Set(groups).size !== groups.length || groups.some(id => !PASTE_ATTRIBUTE_GROUPS.some(group => group.id === id))) return fail('Choose at least one supported attribute group, without duplicates.')
  const { source, selection } = resolved
  const statuses = groups.map(id => groupStatus(PASTE_ATTRIBUTE_GROUPS.find(group => group.id === id), source, selection, getDefinition))
  const blocked = statuses.find(status => status.blockedReason)
  if (blocked) return fail(`${blocked.label}: ${blocked.blockedReason}`)
  const changes = new Map()
  const targetIds = new Set()
  const pendingStacks = new Map()
  const removedLastEffect = new Set()
  for (const status of statuses) {
    const sourceStack = status.id === 'effects' ? normalizedStack(source, getDefinition).effects : null
    for (const original of status.targets) {
      targetIds.add(original.id)
      let clip = changes.get(original.id) || original
      if (status.id === 'transform') clip = applyFields(clip, source, transformFields)
      else if (status.id === 'audio') clip = applyFields(clip, source, audioFields)
      else if (status.id === 'color') clip = applyColor(clip, source)
      else {
        if (!same(sourceStack, normalizedStack(original, getDefinition).effects)) {
          pendingStacks.set(original.id, sourceStack)
          if (!sourceStack.length && stackOf(original).length) removedLastEffect.add(original.id)
        }
        const blur = normalizeAdjustmentSettings(source.adjustments).blur
        if (!same(blur, normalizeAdjustmentSettings(clip.adjustments).blur)) clip = { ...clip, adjustments: { ...clip.adjustments, blur } }
        if ((source.bypass?.effects === true) !== (clip.bypass?.effects === true)) clip = { ...clip, bypass: { ...clip.bypass, effects: source.bypass?.effects === true } }
      }
      if (clip !== original) changes.set(original.id, clip)
    }
  }
  // No IDs are requested until every requested group and target has validated.
  const existingIds = new Set([...state.clips, source].flatMap(clip => Array.isArray(clip.effects) ? clip.effects.map(effect => effect?.id) : []))
  for (const [clipId, stack] of pendingStacks) {
    const effects = []
    for (const effect of stack) {
      let id
      try { id = typeof makeId === 'function' ? makeId() : null } catch { return fail('Could not create a new effect ID. Try again.') }
      if (!validId(id) || existingIds.has(id)) return fail('Could not create a unique effect ID. Try again.')
      existingIds.add(id)
      effects.push({ ...clone(effect), id })
    }
    changes.set(clipId, { ...(changes.get(clipId) || state.clips.find(clip => clip.id === clipId)), effects })
  }
  return {
    ok: true,
    targetCount: targetIds.size,
    changedCount: changes.size,
    clips: changes.size ? state.clips.map(clip => {
      const changed = changes.get(clip.id)
      if (!changed) return clip
      if (removedLastEffect.has(clip.id)) return { ...changed, cacheStatus: 'none', cacheUrl: null }
      return visualTypes.has(clip.type) && clip.cacheStatus === 'cached' ? { ...changed, cacheStatus: 'invalid' } : changed
    }) : state.clips,
  }
}
