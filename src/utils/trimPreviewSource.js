import { getClipPlaybackTimingAtTimeline } from './clipPlaybackTiming.js'
import {
  FRAME_SAMPLING_MODE,
  getOpticalFlowCacheUsability,
  getRequiredOpticalFlowHandleSeconds,
  normalizeFrameSamplingMode,
} from './frameSampling.js'
import { getPreciseVideoSeekFps } from './previewVideoSeeking.js'

const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0
  ? Number(value)
  : fallback

/** Source-only sampling: no render bakes, effects, compositing, or state writes. */
export function resolveTrimPreviewSource({
  clip,
  asset = null,
  timelineTime,
  timelineFps = 24,
  transitions = [],
  clips = [],
  useProxyPlaybackForAssets = false,
  proxyUsable = false,
  playbackCacheUsable = false,
} = {}) {
  const fps = positive(timelineFps, 24)
  const empty = { kind: 'unavailable', url: null, time: null, sourceTime: null, fps, usingOpticalFlow: false, mode: 'none' }
  if (!clip) return { ...empty, note: 'Clip unavailable.' }
  if (clip.type !== 'video' && clip.type !== 'image') {
    const label = ({ audio: 'Audio', text: 'Text', shape: 'Shape', captions: 'Captions', adjustment: 'Adjustment layer' })[clip.type] || 'This clip'
    return { ...empty, kind: 'timing-only', note: `${label} · timing only` }
  }
  const originalUrl = asset?.url || clip.url || null
  if (clip.type === 'image') {
    return originalUrl
      ? { ...empty, kind: 'image', url: originalUrl, mode: 'image', note: 'Still image · source only' }
      : { ...empty, note: 'Source image unavailable. Relink the media.' }
  }
  if (!Number.isFinite(Number(timelineTime))) return { ...empty, note: 'Source timing unavailable.' }

  // URL selection and time mapping MUST share the same cache contract. A
  // trim can exhaust coverage mid-drag; the old cache must never be sought
  // using original-source seconds (or used after it became stale).
  const handleSeconds = getRequiredOpticalFlowHandleSeconds(clip, transitions, clips)
  const options = { handleSeconds, requireUrl: true }
  const sourceTiming = getClipPlaybackTimingAtTimeline(clip, Number(timelineTime), 0.000001, {
    ...options,
    useFrameSampling: false,
  })
  const samplingMode = normalizeFrameSamplingMode(clip.frameSampling)
  const opticalFlow = getOpticalFlowCacheUsability(clip, options)
  const usingOpticalFlow = opticalFlow.usable && asset?.settings?.hasAlpha !== true
  let mode = 'original'
  let url = originalUrl
  if (usingOpticalFlow) {
    url = opticalFlow.cache.url
    mode = 'optical-flow'
  } else if (useProxyPlaybackForAssets && proxyUsable && asset?.proxyUrl && asset?.settings?.hasAlpha !== true) {
    url = asset.proxyUrl
    mode = 'proxy'
  } else if (playbackCacheUsable && asset?.playbackCacheUrl && asset?.settings?.hasAlpha !== true) {
    url = asset.playbackCacheUrl
    mode = 'playback-cache'
  }
  if (!url) return { ...empty, sourceTime: sourceTiming.time, note: 'Source video unavailable. Relink the media.' }
  const timing = usingOpticalFlow
    ? getClipPlaybackTimingAtTimeline(clip, Number(timelineTime), 0.000001, options)
    : sourceTiming
  const sourceFps = getPreciseVideoSeekFps({
    usingOpticalFlow,
    opticalFlowFps: opticalFlow.cache?.targetFps,
    timelineFps: fps,
    clipSourceFps: clip.sourceFps,
    assetFps: asset?.settings?.fps ?? asset?.fps ?? asset?.metadata?.fps,
  })
  let note = usingOpticalFlow ? 'Optical Flow · source only' : 'Source frame · effects not shown'
  if (!usingOpticalFlow && samplingMode === FRAME_SAMPLING_MODE.OPTICAL_FLOW) {
    note = 'Source frame · Optical Flow unavailable'
  } else if (samplingMode === FRAME_SAMPLING_MODE.BLEND) {
    note = 'Source frame · blending not shown'
  } else if (mode === 'proxy') note = 'Proxy source · effects not shown'
  return {
    kind: 'video', url, time: timing.time, sourceTime: sourceTiming.time,
    fps: sourceFps, usingOpticalFlow, mode, note,
  }
}
