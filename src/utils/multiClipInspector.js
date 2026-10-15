import { normalizeAudioClipGainDb, MIN_AUDIO_CLIP_GAIN_DB, MAX_AUDIO_CLIP_GAIN_DB } from './audioClipGain.js'
import { COLOR_ADJUSTMENT_KEYS, TONAL_ADJUSTMENT_GROUP_KEYS, getAdjustmentValue, normalizeAdjustmentSettings } from './adjustments.js'

export const MULTI_CLIP_COLOR_FIELDS = ['', ...TONAL_ADJUSTMENT_GROUP_KEYS].flatMap(group => (
  COLOR_ADJUSTMENT_KEYS.map(key => {
    const path = group ? `${group}.${key}` : key
    return { id: `color.${path}`, path, label: `${group || 'Global'} ${key}`, group: 'color', initial: 0, min: key === 'hue' ? -180 : -100, max: key === 'hue' ? 180 : 100, unit: key === 'hue' ? '°' : '%' }
  })
))

// A deliberately small, shared UI/store contract for the first batch-edit pass.
// Timing, keyframes, effects, and project-owned media are never replaced here.
export const MULTI_CLIP_FIELDS = [
  { id: 'positionX', label: 'Position X', group: 'transform', unit: 'px', initial: 0 },
  { id: 'positionY', label: 'Position Y', group: 'transform', unit: 'px', initial: 0 },
  { id: 'positionZ', label: 'Position Z', group: 'transform', unit: 'px', initial: 0 },
  { id: 'scaleX', label: 'Scale X', group: 'transform', unit: '%', initial: 100, min: 0 },
  { id: 'scaleY', label: 'Scale Y', group: 'transform', unit: '%', initial: 100, min: 0 },
  { id: 'rotation', label: 'Rotation', group: 'transform', unit: '°', initial: 0 },
  ...['rotationX', 'rotationY'].map(id => ({ id, label: `Rotation ${id.slice(-1)}`, group: 'transform', unit: '°', initial: 0 })),
  { id: 'perspective', label: 'Perspective', group: 'transform', unit: 'px', initial: 1200, min: 1 },
  ...['anchorX', 'anchorY'].map(id => ({ id, label: `Anchor ${id.slice(-1)}`, group: 'transform', unit: '%', initial: 50, min: 0, max: 100 })),
  ...['cropTop', 'cropBottom', 'cropLeft', 'cropRight'].map(id => ({ id, label: `Crop ${id.slice(4)}`, group: 'transform', unit: '%', initial: 0, min: 0, max: 100 })),
  ...['scaleLinked', 'flipH', 'flipV', 'cornerPinEnabled'].map(id => ({ id, label: id === 'scaleLinked' ? 'Link X/Y Scale' : id, group: 'transform', type: 'boolean', initial: id === 'scaleLinked' })),
  ...['TL', 'TR', 'BL', 'BR'].flatMap(corner => ['X', 'Y'].map(axis => ({ id: `cornerPin${corner}${axis}`, label: `Corner ${corner} ${axis}`, group: 'transform', unit: 'px', initial: 0 }))),
  { id: 'blendMode', label: 'Blend Mode', group: 'transform', initial: 'normal', options: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'] },
  { id: 'opacity', label: 'Opacity', group: 'transform', unit: '%', initial: 100, min: 0, max: 100 },
  { id: 'gainDb', label: 'Audio gain', group: 'audio', unit: 'dB', initial: 0, min: MIN_AUDIO_CLIP_GAIN_DB, max: MAX_AUDIO_CLIP_GAIN_DB },
  ...['fadeIn', 'fadeOut'].map(id => ({ id, label: id === 'fadeIn' ? 'Fade In' : 'Fade Out', group: 'audio', unit: 's', initial: 0, min: 0 })),
  ...MULTI_CLIP_COLOR_FIELDS,
  { id: 'effects.blur', path: 'blur', label: 'Blur', group: 'color', initial: 0, min: 0, max: 50, unit: 'px' },
  ...['color', 'effects'].map(key => ({ id: `${key}Bypass`, bypassGroup: key, label: `Bypass ${key}`, group: 'bypass', type: 'boolean', initial: false })),
]

const visualTypes = new Set(['video', 'image', 'text', 'shape', 'adjustment'])
const fieldById = new Map(MULTI_CLIP_FIELDS.map(field => [field.id, field]))
const equal = (a, b) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-7 : a === b

export function getMultiClipSelection(clips, tracks, clipIds) {
  const ids = new Set(clipIds || [])
  const clipsById = new Map((clips || []).map(clip => [clip.id, clip]))
  const trackById = new Map((tracks || []).map(track => [track.id, track]))
  const selected = [...ids].map(id => clipsById.get(id)).filter(Boolean)
  const visual = []
  const audio = []
  let lockedCount = 0
  let unsupportedCount = 0
  for (const clip of selected) {
    const track = trackById.get(clip.trackId)
    if (track?.locked === true) lockedCount += 1
    else if (track?.type === 'video' && visualTypes.has(clip.type)) visual.push(clip)
    else if (track?.type === 'audio' && clip.type === 'audio') audio.push(clip)
    else unsupportedCount += 1
  }
  return { selected, visual, audio, lockedCount, unsupportedCount }
}

function fieldValue(clip, field) {
  if (field.id === 'gainDb') return normalizeAudioClipGainDb(clip.gainDb)
  if (field.group === 'color') return getAdjustmentValue(normalizeAdjustmentSettings(clip.adjustments), field.path)
  if (field.group === 'bypass') return clip.bypass?.[field.bypassGroup] === true
  const value = field.group === 'audio' ? clip[field.id] : clip.transform?.[field.id]
  if (field.type === 'boolean') return typeof value === 'boolean' ? value : field.initial
  if (field.options) return field.options.includes(value) ? value : field.initial
  return value != null && Number.isFinite(Number(value)) ? Number(value) : field.initial
}

function affectedProperties(clip, property, explicitKeys = []) {
  if ((property === 'scaleX' || property === 'scaleY') && clip.transform?.scaleLinked !== false) {
    return explicitKeys.includes(property === 'scaleX' ? 'scaleY' : 'scaleX') ? [property] : ['scaleX', 'scaleY']
  }
  return [property]
}

const keyframeProperty = property => fieldById.get(property)?.path || property

// Sparse writes preserve every target's own grade, including LUTs, blur and
// forward-compatible settings. Normalization is only used to read defaults.
function applyColorUpdates(clip, updates) {
  const adjustments = { ...clip.adjustments }
  for (const [property, value] of Object.entries(updates)) {
    const [key, nested] = fieldById.get(property).path.split('.')
    if (nested) adjustments[key] = { ...adjustments[key], [nested]: value }
    else adjustments[key] = value
  }
  return { ...clip, adjustments }
}

export function getMultiClipFieldState(selection, property) {
  const field = fieldById.get(property)
  if (!field) return { targets: [], blockedReason: 'Unsupported property.' }
  const targets = field.group === 'audio' ? selection.audio : selection.visual
  const values = targets.map(clip => fieldValue(clip, field))
  const mixed = values.some(value => !equal(value, values[0]))
  const animatedCount = targets.filter(clip => affectedProperties(clip, property).some(key => (
    Array.isArray(clip.keyframes?.[keyframeProperty(key)]) && clip.keyframes[keyframeProperty(key)].length > 0
  ))).length
  const blockedReason = targets.length === 0
    ? `No editable ${field.group === 'audio' ? 'audio' : 'visual'} clips selected.`
    : animatedCount > 0
      ? 'Animated property — select one clip to edit its keyframes.'
      : ''
  return { field, targets, values, mixed, value: mixed ? null : values[0], animatedCount, blockedReason }
}

// Pure plan, used by both the UI and the store. Reject the whole field edit if
// any resulting value is invalid: silently clamping just one clip would break
// the requested offset relationship. Excluded tracks/types remain untouched.
export function planMultiClipInspectorEdit(state, { clipIds, property, value, mode = 'set', explicitKeys = [] } = {}) {
  const fail = error => ({ ok: false, error, changedCount: 0, clips: state.clips })
  const field = fieldById.get(property)
  if (!field) return fail('Unsupported property.')
  if (mode !== 'set' && mode !== 'offset') return fail('Choose Set values or Add offsets.')
  const numeric = !field.type && !field.options
  if (!numeric && (mode !== 'set' || (field.type === 'boolean' ? typeof value !== 'boolean' : !field.options.includes(value)))) return fail('Invalid property value.')
  if (numeric && ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value)))) {
    return fail('Enter a finite number.')
  }
  const number = numeric ? Number(value) : value
  const selection = getMultiClipSelection(state.clips, state.tracks, clipIds)
  const status = getMultiClipFieldState(selection, property)
  if (status.blockedReason) return fail(status.blockedReason)
  const changes = new Map()
  for (const clip of status.targets) {
    const updates = {}
    for (const key of affectedProperties(clip, property, explicitKeys)) {
      const targetField = fieldById.get(key)
      const previous = fieldValue(clip, targetField)
      const next = mode === 'offset' ? previous + number : number
      if (numeric && (!Number.isFinite(next) || (targetField.min != null && next < targetField.min) || (targetField.max != null && next > targetField.max))) {
        const limits = targetField.max == null ? `at least ${targetField.min}` : `${targetField.min} to ${targetField.max}`
        return fail(Number.isFinite(next)
          ? `${targetField.label} must stay ${limits} ${targetField.unit} for every affected clip.`
          : 'The result is too large. Enter a smaller value.')
      }
      if ((key === 'fadeIn' || key === 'fadeOut') && next > Number(clip.duration)) return fail('Fade duration must fit every selected audio clip.')
      if (!equal(previous, next)) updates[key] = next
    }
    if (Object.keys(updates).length) {
      changes.set(clip.id, field.group === 'audio'
        ? { ...clip, ...updates }
        : field.group === 'color'
          ? applyColorUpdates(clip, updates)
          : field.group === 'bypass'
            ? { ...clip, bypass: { ...clip.bypass, [field.bypassGroup]: updates[field.id] } }
            : { ...clip, transform: { ...clip.transform, ...updates } })
    }
  }
  return {
    ok: true,
    changedCount: changes.size,
    targetCount: status.targets.length,
    clips: changes.size ? state.clips.map(clip => changes.get(clip.id) || clip) : state.clips,
  }
}

// Compound controls (anchor presets, reset) validate all fields before writing.
export function planMultiClipInspectorUpdates(state, { clipIds, updates } = {}) {
  const fail = error => ({ ok: false, error, changedCount: 0, clips: state.clips })
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return fail('Invalid property updates.')
  let next = state
  const keys = Object.keys(updates)
  for (const property of keys) {
    const plan = planMultiClipInspectorEdit(next, { clipIds, property, value: updates[property], explicitKeys: keys })
    if (!plan.ok) return fail(plan.error)
    next = { ...next, clips: plan.clips }
  }
  const changedCount = state.clips.filter((clip, i) => clip !== next.clips[i]).length
  return { ok: true, clips: next.clips, changedCount }
}
