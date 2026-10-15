const COMMON_SETTINGS = Object.freeze({
  format: 'mp4',
  videoCodec: 'h264',
  audioCodec: 'aac',
  useHardwareEncoder: false,
  preset: 'medium',
  fps: 'project',
  includeAudio: true,
  audioBitrateKbps: 320,
  audioSampleRate: 48000,
  audioChannels: 2,
  normalizeAudio: false,
  keyframeMode: 'auto',
  useProxyMedia: false,
  useDirectFramePipe: true,
  postProcessUpscale: 'none',
  transparent: false,
})

const makePreset = (id, label, summary, settings) => Object.freeze({
  id, label, summary, settings: Object.freeze({ ...COMMON_SETTINGS, ...settings }),
})

/** Delivery choices are additive to the legacy encoder presets. They never
 * carry a filename, range, project setting, or timeline mutation. */
export const DELIVERY_PRESETS = Object.freeze([
  makePreset('youtube-1080p', 'YouTube 1080p',
    'H.264 upload with an HD size cap. Keeps aspect ratio and project FPS; never enlarges.',
    { qualityMode: 'bitrate', bitrateKbps: 8000, resolution: 'youtube-hd' }),
  makePreset('youtube-4k', 'YouTube 4K',
    'H.264 upload with a 4K size cap. Keeps aspect ratio and project FPS; never enlarges.',
    { qualityMode: 'bitrate', bitrateKbps: 45000, resolution: 'youtube-uhd' }),
  makePreset('h264-master', 'H.264 Master',
    'High-quality H.264 at project size, with CRF 16 and source media.',
    { qualityMode: 'crf', crf: 16, resolution: 'project' }),
  makePreset('prores-master', 'ProRes Master',
    'Large, editing-friendly ProRes HQ MOV at project size.',
    { format: 'prores', videoCodec: 'prores', proresProfile: '3', resolution: 'project' }),
  makePreset('review-copy', 'Review Copy',
    'Smaller half-resolution review MP4. Uses available proxies for quicker renders.',
    { qualityMode: 'crf', crf: 24, preset: 'veryfast', resolution: 'timeline-half', audioBitrateKbps: 160, useProxyMedia: true }),
])

const finitePositive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0
const validDimension = (value) => finitePositive(value) && value >= 2
const floorEven = (value) => Math.max(2, Math.floor(value / 2 + 1e-9) * 2)

function normalizeTimeline(timeline) {
  const validSize = validDimension(timeline?.width) && validDimension(timeline?.height)
  return {
    width: validSize ? floorEven(timeline.width) : 1920,
    height: validSize ? floorEven(timeline.height) : 1080,
    fps: finitePositive(timeline?.fps) ? timeline.fps : 24,
  }
}

/** Fit, never fill. Portrait swaps the cap axes; squares fit the shorter cap
 * edge. Even dimensions round down so valid sources are never enlarged. */
export function resolveDeliveryResolution(mode, timeline) {
  if (mode !== 'youtube-hd' && mode !== 'youtube-uhd') return null
  const source = normalizeTimeline(timeline)
  const longCap = mode === 'youtube-uhd' ? 3840 : 1920
  const shortCap = mode === 'youtube-uhd' ? 2160 : 1080
  const portrait = source.height > source.width
  const capWidth = portrait ? shortCap : longCap
  const capHeight = portrait ? longCap : shortCap
  const scale = Math.min(1, capWidth / source.width, capHeight / source.height)
  return {
    width: Math.min(source.width, capWidth, floorEven(source.width * scale)),
    height: Math.min(source.height, capHeight, floorEven(source.height * scale)),
    fps: source.fps,
  }
}

function youtubeBitrate({ width, height, fps }) {
  // Select from actual output size, not the preset name: a 4K cap applied
  // to an HD timeline remains HD and should not inherit a 4K bitrate.
  const shortSide = Math.min(width, height)
  const tiers = [
    [360, 1000, 1500],
    [480, 2500, 4000],
    [720, 5000, 7500],
    [1080, 8000, 12000],
    [1440, 16000, 24000],
    [Infinity, 45000, 68000],
  ]
  const tier = tiers.find(([maximum]) => shortSide <= maximum)
  return tier[fps > 30 ? 2 : 1]
}

/** Accept a preset definition or a recommended preset ID. A supplied legacy
 * definition is copied unchanged unless it uses one of the new size caps. */
export function resolveDeliveryPresetSettings(preset, timeline) {
  const definition = typeof preset === 'string'
    ? DELIVERY_PRESETS.find((candidate) => candidate.id === preset)
    : preset
  if (!definition?.settings || typeof definition.settings !== 'object' || Array.isArray(definition.settings)) return null
  const settings = { ...definition.settings }
  const resolution = resolveDeliveryResolution(settings.resolution, timeline)
  if (resolution) settings.bitrateKbps = youtubeBitrate(resolution)
  return settings
}
