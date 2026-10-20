// Detect TTS results that are silence rather than speech.
//
// Some local TTS node packs swallow runtime failures (for example a worker
// process dying while the model loads) and still save a short silent clip, so
// ComfyUI reports the prompt as executed. Real speech peaks far above
// -60 dBFS, so a clip that never gets that loud is a failed generation.

export const SILENT_TTS_ERROR_CODE = 'SILENT_TTS_OUTPUT'
export const SILENT_TTS_PEAK_DBFS = -60
// Below this the clip holds no usable speech whatever its level.
export const MIN_TTS_DURATION_SEC = 0.05
// Only decode small files in the renderer. A silent failure clip is a few KB;
// anything larger is skipped rather than risking a big in-renderer decode.
export const MAX_TTS_DECODE_BYTES = 4 * 1024 * 1024

export function peakDbfsFromChannels(channels) {
  let peak = 0
  for (const data of channels || []) {
    if (!data) continue
    for (let i = 0; i < data.length; i += 1) {
      const v = Math.abs(data[i])
      if (v > peak) peak = v
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity
}

export function classifyTtsAudio({ durationSec, peakDbfs } = {}) {
  const duration = Number(durationSec)
  if (!Number.isFinite(duration) || duration < MIN_TTS_DURATION_SEC) {
    return { silent: true, reason: 'empty' }
  }
  if (!(peakDbfs >= SILENT_TTS_PEAK_DBFS)) {
    return { silent: true, reason: 'silent' }
  }
  return { silent: false, reason: null }
}

export function silentTtsMessage({ engineLabel = 'The voice engine', durationSec, peakDbfs, local = true } = {}) {
  const parts = []
  if (Number.isFinite(Number(durationSec))) parts.push(`${Number(durationSec).toFixed(1)} s`)
  parts.push(Number.isFinite(peakDbfs) ? `peak ${Math.round(peakDbfs)} dBFS` : 'no signal')
  const advice = local
    ? 'It most likely failed while loading its model. Close other GPU- or memory-heavy apps, then retry this line.'
    : 'Retry this line.'
  return `${engineLabel} returned silence instead of speech (${parts.join(', ')}). ${advice}`
}

export function createSilentTtsError(details) {
  const err = new Error(silentTtsMessage(details))
  err.code = SILENT_TTS_ERROR_CODE
  return err
}

// Decode a finished TTS clip and measure it. Returns null when the clip can't
// be checked (too large, no Web Audio, undecodable) so the caller imports it
// as before instead of failing a possibly good result.
export async function measureTtsAudioBlob(blob, { createContext } = {}) {
  if (!blob || typeof blob.arrayBuffer !== 'function') return null
  if (!(blob.size > 0)) return { durationSec: 0, peakDbfs: -Infinity }
  if (blob.size > MAX_TTS_DECODE_BYTES) return null
  const context = typeof createContext === 'function' ? createContext() : null
  if (!context?.decodeAudioData) return null
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer())
    const channels = []
    for (let c = 0; c < (buffer.numberOfChannels || 0); c += 1) channels.push(buffer.getChannelData(c))
    return { durationSec: Number(buffer.duration) || 0, peakDbfs: peakDbfsFromChannels(channels) }
  } catch {
    return null
  } finally {
    try { await context.close?.() } catch { /* Measurement does not depend on context teardown. */ }
  }
}
