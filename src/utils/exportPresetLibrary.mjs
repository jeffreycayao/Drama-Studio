import { normalizeTransparentExportSettings } from './alphaMedia.mjs'

export const EXPORT_PRESET_LIBRARY_KEY = 'velorn-custom-export-presets'
export const EXPORT_PRESET_LIBRARY_VERSION = 1
export const MAX_CUSTOM_EXPORT_PRESETS = 50
export const MAX_EXPORT_PRESET_NAME_LENGTH = 64
const MAX_STORAGE_LENGTH = 150000
const ID_PATTERN = /^user-export-[a-z0-9-]{8,80}$/i
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const fail = error => ({ ok: false, error })

// This allowlist is deliberately independent of project/export payloads.
// Never persist a filename, range, destination, media path, project snapshot,
// cache reference, or arbitrary future setting from the current workspace.
const DEFAULTS = Object.freeze({
  format: 'mp4', videoCodec: 'h264', audioCodec: 'aac', proresProfile: '3',
  useHardwareEncoder: false, nvencPreset: 'p5', preset: 'medium', qualityMode: 'crf',
  crf: 18, bitrateKbps: 8000, keyframeMode: 'auto', keyframeInterval: 48,
  resolution: 'project', customWidth: 1920, customHeight: 1080, fps: 'project',
  includeAudio: true, audioBitrateKbps: 192, audioSampleRate: 44100, audioChannels: 2,
  normalizeAudio: false, loudnessTarget: -14, useProxyMedia: false, useDirectFramePipe: true,
  postProcessUpscale: 'none', rtxUpscaleQuality: 'HIGH', transparent: false,
})
const ENUMS = {
  format: ['mp4', 'webm', 'prores', 'audio', 'png-seq', 'gif'],
  videoCodec: ['h264', 'h265', 'vp9', 'prores'], audioCodec: ['aac', 'opus', 'wav', 'mp3'],
  proresProfile: ['0', '1', '2', '3', '4'], nvencPreset: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],
  preset: ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'],
  qualityMode: ['crf', 'bitrate'], keyframeMode: ['auto', 'manual'],
  resolution: ['project', 'custom', 'youtube-hd', 'youtube-uhd', 'timeline-half', 'timeline-third', 'timeline-quarter',
    'HD 1080p', 'HD 720p', '4K UHD', 'Vertical 1080', 'Square', 'Instagram 4:5', 'Cinematic 21:9'],
  postProcessUpscale: ['none', 'rtx-4k'], rtxUpscaleQuality: ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'],
}
const NUMBERS = {
  crf: [0, 63], bitrateKbps: [100, 200000], keyframeInterval: [1, 100000],
  customWidth: [1, 32768], customHeight: [1, 32768], audioBitrateKbps: [32, 512],
  audioSampleRate: [44100, 48000], audioChannels: [1, 2], loudnessTarget: [-23, -14],
}

export function validateCustomExportPresetSettings(source) {
  if (!isRecord(source) || !Object.hasOwn(source, 'format')) return fail('Choose an export format before saving a preset.')
  const settings = {}
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    let value = Object.hasOwn(source, key) ? source[key] : fallback
    if (key === 'fps') {
      if (value !== 'project') {
        if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)) value = Number(value)
        if (![15, 23.976, 24, 25, 30, 60].includes(value)) return fail('Choose a supported export frame rate before saving this preset.')
      }
    } else if (ENUMS[key]) {
      if (key === 'proresProfile' && typeof value === 'number') value = String(value)
      if (!ENUMS[key].includes(value)) return fail(`The preset contains an unsupported ${key} setting.`)
    } else if (NUMBERS[key]) {
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)
        || value < NUMBERS[key][0] || value > NUMBERS[key][1]) return fail(`Choose a valid ${key} value before saving this preset.`)
      if (key === 'audioSampleRate' && ![44100, 48000].includes(value)) return fail('Choose 44.1 or 48 kHz audio.')
      if (key === 'loudnessTarget' && ![-14, -16, -23].includes(value)) return fail('Choose a supported loudness target.')
    } else if (typeof value !== 'boolean') return fail(`The preset contains an invalid ${key} setting.`)
    settings[key] = value
  }
  if (settings.format === 'mp4') {
    if (!['h264', 'h265'].includes(settings.videoCodec) || settings.audioCodec !== 'aac') return fail('MP4 presets require H.264/H.265 video and AAC audio.')
    if (settings.qualityMode === 'crf' && settings.crf > 51) return fail('H.264/H.265 CRF must be between 0 and 51.')
  }
  if (settings.format === 'webm' && (settings.videoCodec !== 'vp9' || settings.audioCodec !== 'opus')) return fail('WebM presets require VP9 video and Opus audio.')
  if (settings.format === 'prores' && (settings.videoCodec !== 'prores' || settings.audioCodec !== 'aac')) return fail('ProRes presets require ProRes video and AAC audio.')
  if (settings.format === 'audio' && !['aac', 'wav', 'mp3'].includes(settings.audioCodec)) return fail('Choose WAV, MP3, or AAC for an audio preset.')
  if (!['png-seq', 'gif', 'audio'].includes(settings.format) && settings.resolution === 'custom'
    && (settings.customWidth < 2 || settings.customHeight < 2)) return fail('Video dimensions must be at least 2 pixels.')
  if (['webm', 'prores', 'audio'].includes(settings.format)) {
    settings.useHardwareEncoder = false
    settings.postProcessUpscale = 'none'
  }
  if (settings.format === 'audio') settings.includeAudio = true
  return { ok: true, settings: normalizeTransparentExportSettings(settings) }
}

export function validateExportPresetName(value, presets = [], exceptId = null) {
  if (typeof value !== 'string') return fail('Enter a preset name.')
  const name = value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
  if (!name) return fail('Enter a preset name.')
  if (name.length > MAX_EXPORT_PRESET_NAME_LENGTH) return fail(`Use ${MAX_EXPORT_PRESET_NAME_LENGTH} characters or fewer.`)
  if (/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)) return fail('Preset names cannot contain control characters.')
  if (presets.some(preset => preset.id !== exceptId && preset.name.toLowerCase() === name.toLowerCase())) return fail('A preset with that name already exists. Choose another name.')
  return { ok: true, name }
}

export function parseExportPresetLibrary(raw) {
  if (raw == null) return { ok: true, presets: [] }
  if (typeof raw !== 'string' || raw.length > MAX_STORAGE_LENGTH) return fail('The saved preset library is too large to read safely. Existing data was left untouched.')
  let value
  try { value = JSON.parse(raw) } catch { return fail('Saved presets could not be read. Existing data was left untouched.') }
  // Version 0 is the initial name/settings shape. Migrate in memory only;
  // the original is retained until the user successfully saves a mutation.
  if (!isRecord(value) || ![0, EXPORT_PRESET_LIBRARY_VERSION].includes(value.version)
    || !Array.isArray(value.presets) || value.presets.length > MAX_CUSTOM_EXPORT_PRESETS) {
    return fail('This preset library has an unsupported version or structure. Existing data was left untouched.')
  }
  const presets = []
  for (const entry of value.presets) {
    const name = validateExportPresetName(entry?.name, presets)
    const settings = validateCustomExportPresetSettings(entry?.settings)
    if (!isRecord(entry) || !ID_PATTERN.test(entry.id) || presets.some(preset => preset.id === entry.id) || !name.ok || !settings.ok) {
      return fail('A saved preset is invalid or duplicated. Existing data was left untouched.')
    }
    presets.push({ id: entry.id, name: name.name, settings: settings.settings })
  }
  return { ok: true, presets, migrated: value.version === 0 }
}

export function readExportPresetLibrary(storage) {
  try {
    if (storage === undefined) storage = globalThis.localStorage
    if (!storage?.getItem) return fail('Local preset storage is unavailable. Your export settings are unchanged.')
    return parseExportPresetLibrary(storage.getItem(EXPORT_PRESET_LIBRARY_KEY))
  } catch { return fail('Saved presets could not be read from local storage. Your export settings are unchanged.') }
}

const newId = () => `user-export-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`

/** Re-read immediately before every mutation, preserving changes from other
 * windows. Rename/delete compare the dialog's exact record to reject a stale
 * target. Successful persistence is required before reporting success. */
export function updateExportPresetLibrary(operation, storage) {
  const current = readExportPresetLibrary(storage)
  if (!current.ok) return current
  const presets = current.presets
  const index = presets.findIndex(preset => preset.id === operation?.id)
  if (operation?.type !== 'save' && (index < 0 || !operation.expected
    || JSON.stringify(presets[index]) !== JSON.stringify(operation.expected))) {
    return fail('This preset changed or was removed in another window. Close this dialog and try again.')
  }
  let preset
  if (operation?.type === 'save' || operation?.type === 'rename') {
    if (operation.type === 'save' && presets.length >= MAX_CUSTOM_EXPORT_PRESETS) return fail(`You can save up to ${MAX_CUSTOM_EXPORT_PRESETS} presets. Delete one before adding another.`)
    const name = validateExportPresetName(operation.name, presets, operation.type === 'rename' ? operation.id : null)
    if (!name.ok) return name
    if (operation.type === 'save') {
      const settings = validateCustomExportPresetSettings(operation.settings)
      if (!settings.ok) return settings
      const id = newId()
      if (!ID_PATTERN.test(id) || presets.some(entry => entry.id === id)) return fail('Could not create a unique preset. Please try again.')
      preset = { id, name: name.name, settings: settings.settings }
      presets.push(preset)
    } else {
      preset = { ...presets[index], name: name.name }
      presets[index] = preset
    }
  } else if (operation?.type === 'delete') presets.splice(index, 1)
  else return fail('Unknown preset operation.')
  try {
    if (storage === undefined) storage = globalThis.localStorage
    if (!storage?.setItem) throw new Error('Storage unavailable')
    storage.setItem(EXPORT_PRESET_LIBRARY_KEY, JSON.stringify({ version: EXPORT_PRESET_LIBRARY_VERSION, presets }))
  } catch { return fail('The preset change could not be saved. Local storage may be full or unavailable. Nothing was changed.') }
  return { ok: true, presets, preset }
}

export function matchCustomExportPreset(presets, settings) {
  const current = validateCustomExportPresetSettings(settings)
  if (!current.ok) return null
  const serialized = JSON.stringify(current.settings)
  return presets.find(preset => JSON.stringify(preset.settings) === serialized) || null
}
