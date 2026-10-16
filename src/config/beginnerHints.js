/**
 * Plain-language "good for" hints for technical choices.
 *
 * Each helper returns an i18n key under `hints.*` (public/lang/lang_*.json)
 * or null when there is nothing useful to say. Components render the text
 * with <Hint> from components/ui/Hint.jsx.
 */

const RESOLUTION_HINTS = {
  '1920x1080': 'hints.resolution.fullHd',
  '1280x720': 'hints.resolution.hd720',
  '3840x2160': 'hints.resolution.uhd4k',
  '1080x1920': 'hints.resolution.vertical',
  '1080x1080': 'hints.resolution.square',
  '1024x1024': 'hints.resolution.square',
  '2048x2048': 'hints.resolution.squareLarge',
  '1080x1350': 'hints.resolution.portrait45',
  '2560x1080': 'hints.resolution.cinematic',
}

export function resolutionHintKey(width, height) {
  return RESOLUTION_HINTS[`${Number(width)}x${Number(height)}`] || null
}

const FPS_HINTS = {
  15: 'hints.fps.f15',
  23.976: 'hints.fps.f23976',
  24: 'hints.fps.f24',
  25: 'hints.fps.f25',
  30: 'hints.fps.f30',
  60: 'hints.fps.f60',
}

export function fpsHintKey(fps) {
  return FPS_HINTS[Number(fps)] || null
}

const EXPORT_HINTS = {
  format: {
    mp4: 'hints.export.format.mp4',
    webm: 'hints.export.format.webm',
    prores: 'hints.export.format.prores',
    audio: 'hints.export.format.audio',
    'png-seq': 'hints.export.format.pngSeq',
    gif: 'hints.export.format.gif',
  },
  videoCodec: {
    h264: 'hints.export.videoCodec.h264',
    h265: 'hints.export.videoCodec.h265',
    vp9: 'hints.export.videoCodec.vp9',
  },
  proresProfile: {
    0: 'hints.export.proresProfile.proxy',
    1: 'hints.export.proresProfile.lt',
    2: 'hints.export.proresProfile.standard',
    3: 'hints.export.proresProfile.hq',
    4: 'hints.export.proresProfile.alpha',
  },
  qualityMode: {
    crf: 'hints.export.qualityMode.crf',
    bitrate: 'hints.export.qualityMode.bitrate',
  },
  keyframeMode: {
    auto: 'hints.export.keyframeMode.auto',
    manual: 'hints.export.keyframeMode.manual',
  },
  audioCodec: {
    aac: 'hints.export.audioCodec.aac',
    opus: 'hints.export.audioCodec.opus',
    wav: 'hints.export.audioCodec.wav',
    mp3: 'hints.export.audioCodec.mp3',
  },
  audioSampleRate: {
    44100: 'hints.export.audioSampleRate.r44',
    48000: 'hints.export.audioSampleRate.r48',
  },
  audioChannels: {
    2: 'hints.export.audioChannels.stereo',
    1: 'hints.export.audioChannels.mono',
  },
}

const FAST_ENCODER_PRESETS = new Set(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast'])
const SLOW_ENCODER_PRESETS = new Set(['slow', 'slower', 'veryslow'])

/** Hint for the value currently chosen in one export setting. */
export function exportSettingHintKey(setting, value) {
  if (setting === 'preset') {
    if (FAST_ENCODER_PRESETS.has(value)) return 'hints.export.preset.fast'
    if (SLOW_ENCODER_PRESETS.has(value)) return 'hints.export.preset.slow'
    return value === 'medium' ? 'hints.export.preset.medium' : null
  }
  if (setting === 'nvencPreset') {
    const level = Number(String(value || '').replace(/^p/i, ''))
    if (!Number.isFinite(level) || level <= 0) return null
    return level <= 2 ? 'hints.export.nvencPreset.fast' : level >= 6 ? 'hints.export.nvencPreset.best' : 'hints.export.nvencPreset.balanced'
  }
  if (setting === 'resolution') {
    if (value === 'project') return 'hints.export.resolution.project'
    if (value === 'youtube-hd' || value === 'youtube-uhd') return null
    if (String(value || '').startsWith('timeline-')) return 'hints.export.resolution.scaled'
    return null
  }
  if (setting === 'fps') return value === 'project' ? 'hints.export.fps.project' : fpsHintKey(value)
  return EXPORT_HINTS[setting]?.[value] || null
}

const CAPTION_MODEL_HINTS = {
  base: 'hints.captions.model.base',
  small: 'hints.captions.model.small',
  'large-v3-turbo': 'hints.captions.model.best',
}

export function captionModelHintKey(tierId) {
  return CAPTION_MODEL_HINTS[tierId] || null
}
