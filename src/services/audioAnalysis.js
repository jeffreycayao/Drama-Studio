/**
 * Audio source analysis. Desktop decoding/DSP runs outside the renderer via
 * the bounded native analysis job. Never fall back to Electron's native Web
 * Audio decoder: even small valid PCM files can crash that renderer process.
 */
import { analyzeAudioBuffer } from '../utils/audioAnalysisDsp.mjs'

// Preserve the buffer-level API used by export and synthetic DSP tests.
export { analyzeAudioBuffer } from '../utils/audioAnalysisDsp.mjs'

const IN_FLIGHT_ANALYSES = new Map()
const MAX_ANALYSIS_SECONDS = 600
const MAX_BROWSER_SOURCE_BYTES = 32 * 1024 * 1024

function normalizeSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('No readable source for audio analysis.')
  }
  const normalized = {}
  for (const name of ['absolutePath', 'path', 'url', 'projectPath']) {
    const value = source[name]
    if (value === undefined || value === null || value === '') continue
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
      throw new Error('Audio analysis source ' + name + ' must be a valid string.')
    }
    normalized[name] = value
  }
  if (!normalized.absolutePath && !normalized.path && !normalized.url) {
    throw new Error('No readable source for audio analysis (missing URL and file path).')
  }
  return normalized
}

function normalizeOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Audio analysis options must be an object.')
  }
  const number = (name, fallback, min, max) => {
    const value = options[name] === undefined ? fallback : options[name]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new Error('Audio analysis ' + name + ' must be a finite number between ' + min + ' and ' + max + '.')
    }
    return value
  }
  const normalized = {
    startSeconds: number('startSeconds', 0, 0, Number.MAX_SAFE_INTEGER),
    includeLoudnessCurve: options.includeLoudnessCurve === undefined ? true : options.includeLoudnessCurve,
    maxCurvePoints: number('maxCurvePoints', 400, 20, 1000),
    silenceThresholdDb: number('silenceThresholdDb', -45, -160, 0),
    minSilenceSeconds: number('minSilenceSeconds', 0.35, 0, MAX_ANALYSIS_SECONDS),
  }
  if (typeof normalized.includeLoudnessCurve !== 'boolean') {
    throw new Error('Audio analysis includeLoudnessCurve must be a boolean.')
  }
  normalized.maxCurvePoints = Math.round(normalized.maxCurvePoints)
  if (options.endSeconds !== undefined) {
    normalized.endSeconds = number('endSeconds', 0, 0, Number.MAX_SAFE_INTEGER)
    if (normalized.endSeconds <= normalized.startSeconds) {
      throw new Error('Audio analysis endSeconds must be after startSeconds.')
    }
    if (normalized.endSeconds - normalized.startSeconds > MAX_ANALYSIS_SECONDS) {
      throw new Error('Audio analysis is limited to 10 minutes at a time. Select a shorter range.')
    }
  }
  return normalized
}

function isDesktopRuntime() {
  if (typeof window === 'undefined') return false
  // Also recognize Electron when an old/missing preload does not expose the
  // bridge, so a bridge mismatch fails safely instead of trying Web Audio.
  return Boolean(window.electronAPI) || /Electron\//i.test(window.navigator?.userAgent || '')
}

async function analyzeNative(source, options) {
  const bridge = window.electronAPI
  if (typeof bridge?.analyzeAudio !== 'function') {
    throw new Error('Native audio analysis is unavailable. Restart or update Drama Studio and try again.')
  }
  const response = await bridge.analyzeAudio({ source, options })
  if (!response?.success || !response.analysis || typeof response.analysis !== 'object' || Array.isArray(response.analysis)) {
    const error = new Error(response?.error || 'Could not analyze audio from this source.')
    if (typeof response?.code === 'string') error.code = response.code
    throw error
  }
  // Native decoding already selected the source range. Do not trim or shift
  // these range-relative results again in the renderer.
  return response.analysis
}

async function fetchBrowserSourceBytes(url) {
  if (!url) throw new Error('Browser audio analysis needs a readable source URL.')
  const response = await fetch(url)
  if (!response.ok) throw new Error('Could not load audio source (' + response.status + ').')
  const declaredLength = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BROWSER_SOURCE_BYTES) {
    await response.body?.cancel?.()
    throw new Error('Browser audio analysis is limited to 32 MiB sources. Use the Drama Studio desktop app.')
  }
  // Read incrementally so a missing or inaccurate Content-Length cannot cause
  // an unbounded renderer allocation. Modern fetch responses expose a stream.
  if (!response.body?.getReader) {
    throw new Error('Bounded browser audio loading is unavailable. Use the Drama Studio desktop app.')
  }
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_BROWSER_SOURCE_BYTES) {
        await reader.cancel()
        throw new Error('Browser audio analysis is limited to 32 MiB sources. Use the Drama Studio desktop app.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes.buffer
}

async function analyzeBrowser(source, options) {
  const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
  if (!Ctor) throw new Error('Web Audio API is not available.')
  const bytes = await fetchBrowserSourceBytes(source.url)
  const context = new Ctor({ sampleRate: 24000 })
  try {
    let buffer
    try {
      buffer = await context.decodeAudioData(bytes)
    } catch {
      throw new Error('Could not decode audio from this source (unsupported codec or no audio track).')
    }
    if (!Number.isFinite(buffer.duration) || buffer.duration > MAX_ANALYSIS_SECONDS ||
        buffer.numberOfChannels > 2 || buffer.sampleRate > 48000) {
      throw new Error('Browser audio analysis needs a source of at most 10 minutes and two channels. Use the Drama Studio desktop app.')
    }
    return analyzeAudioBuffer(buffer, options)
  } finally {
    try { await context.close?.() } catch { /* Analysis results do not depend on context teardown. */ }
  }
}

/**
 * Analyze a local audio/video source or a browser URL. Source fields are kept
 * separate so native resolution can prefer a portable project-relative path
 * over an old absolute fallback. Only identical in-flight jobs are reused:
 * subsequent calls recheck the actual file, including replacements/relinks.
 */
export async function analyzeAudioSource(source, options = {}) {
  const normalizedSource = normalizeSource(source)
  const normalizedOptions = normalizeOptions(options)
  const desktop = isDesktopRuntime()
  const key = JSON.stringify([desktop, normalizedSource, normalizedOptions])
  if (IN_FLIGHT_ANALYSES.has(key)) return IN_FLIGHT_ANALYSES.get(key)

  const pending = Promise.resolve()
    .then(() => desktop
      ? analyzeNative(normalizedSource, normalizedOptions)
      : analyzeBrowser(normalizedSource, normalizedOptions))
    .finally(() => {
      if (IN_FLIGHT_ANALYSES.get(key) === pending) IN_FLIGHT_ANALYSES.delete(key)
    })
  IN_FLIGHT_ANALYSES.set(key, pending)
  return pending
}
