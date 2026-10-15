export const DEFAULT_AUDIO_CLIP_GAIN_DB = 0
export const MIN_AUDIO_CLIP_GAIN_DB = -24
export const MAX_AUDIO_CLIP_GAIN_DB = 24

export function normalizeAudioClipGainDb(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_AUDIO_CLIP_GAIN_DB
  return Math.max(MIN_AUDIO_CLIP_GAIN_DB, Math.min(MAX_AUDIO_CLIP_GAIN_DB, parsed))
}

export function getAudioClipGainDb(clip) {
  return normalizeAudioClipGainDb(clip?.gainDb)
}

export function audioGainDbToLinear(value) {
  return Math.pow(10, normalizeAudioClipGainDb(value) / 20)
}

export function getAudioClipLinearGain(clip) {
  return audioGainDbToLinear(getAudioClipGainDb(clip))
}
