import { getAudioWaveformData } from './audioWaveform.js'
import { getDuckingSources, findDuckingActivity, buildDuckingEnvelope } from '../utils/audioDucking.mjs'

const SAMPLES = 32768
const SAMPLE_RATE = 8000
const MAX_SOURCE_SECONDS = 1800
const absolute = value => /^(?:[a-z]:[\\/]|\/|\\\\)/i.test(value || '')
const nativeUrl = value => /^(?:file|comfystudio):\/\//i.test(value || '')
let pendingNative = null

export function duckingWaveformSamples(duration) {
  const frames = Math.round(duration * SAMPLE_RATE)
  // The existing extractor uses floor-sized buckets and one final remainder.
  // Choose a nearly exact divisor so its last peak does not smear seconds of
  // silence/speech together (a fixed large count can do that on short files).
  const hop = Math.max(160, Math.ceil(frames / SAMPLES))
  return Math.max(128, Math.floor(frames / hop))
}

export async function resolveDuckingSource(asset, projectHandle, api) {
  if (asset.path) {
    if (absolute(asset.path) || nativeUrl(asset.path)) return asset.path
    if (typeof projectHandle === 'string' && typeof api?.pathJoin === 'function') {
      return api.pathJoin(projectHandle, asset.path.replace(/\\/g, '/'))
    }
  }
  if (absolute(asset.absolutePath)) return asset.absolutePath
  if (nativeUrl(asset.url) || absolute(asset.url) || /^(blob:|data:)/i.test(asset.url || '')) return asset.url
  throw new Error(`Open or relink the local dialogue source “${asset.name || asset.id}” first.`)
}

/** One dialogue source's levels. Native decodes run one at a time across
 * every ducking tool: a canceled analysis may still be finishing in Electron,
 * so repeated clicks never stack concurrent full-source FFmpeg decodes.
 * `includeRms` is only sent when requested, keeping the old call shape. */
export async function fetchDuckingWaveform(asset, { projectHandle, api = globalThis.window?.electronAPI,
  browserWaveform = getAudioWaveformData, check = () => {}, includeRms = false } = {}) {
  const duration = Number(asset.duration ?? asset.settings?.duration)
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_SOURCE_SECONDS) {
    throw new Error(`“${asset.name || asset.id}” needs a known source duration of 30 minutes or less. Use a shorter dialogue file.`)
  }
  const sampleCount = duckingWaveformSamples(duration)
  const source = await resolveDuckingSource(asset, projectHandle, api)
  check()
  let waveform
  if (absolute(source) || nativeUrl(source)) {
    if (typeof api?.getAudioWaveform !== 'function') throw new Error('Local-file analysis needs the Drama Studio desktop app.')
    while (pendingNative) { await pendingNative.catch(() => {}); check() }
    const options = includeRms ? { sampleCount, sampleRate: SAMPLE_RATE, includeRms: true } : { sampleCount, sampleRate: SAMPLE_RATE }
    const job = Promise.resolve().then(() => { check(); return api.getAudioWaveform(source, options) })
    pendingNative = job
    try { waveform = await job } finally { if (pendingNative === job) pendingNative = null }
    check()
    if (!waveform?.success) throw new Error(waveform?.error || 'The dialogue audio could not be analyzed.')
    waveform = { ...waveform, hopSeconds: Math.max(1, Math.floor(Math.round(waveform.duration * SAMPLE_RATE) / sampleCount)) / SAMPLE_RATE }
  } else {
    waveform = await browserWaveform(source, sampleCount)
    check()
  }
  if (!waveform || waveform.duration > MAX_SOURCE_SECONDS) throw new Error('The dialogue source is unavailable or exceeds 30 minutes.')
  return waveform
}

/** Sequential, read-only analysis. Cancel discards a pending native result and
 * prevents subsequent jobs; the existing waveform IPC cannot kill FFmpeg. */
export async function analyzeAudioDucking({ state, assets, projectHandle, musicId, dialogueTrackId, settings,
  signal, isCurrent = () => true, onProgress = () => {}, api = globalThis.window?.electronAPI,
  browserWaveform = getAudioWaveformData }) {
  const alive = () => !signal?.aborted && isCurrent()
  const check = () => { if (!alive()) throw new Error('Analysis canceled because the editing context changed or the dialog was closed.') }
  check()
  const plan = getDuckingSources(state, assets, musicId, dialogueTrackId)
  if (!plan.ok) throw new Error(plan.reason)
  const unique = [...new Map(plan.sources.map(source => [source.asset.id, source.asset])).values()]
  const waveforms = new Map()
  for (const [index, asset] of unique.entries()) {
    check()
    onProgress(`Analyzing dialogue ${index + 1} of ${unique.length}…`)
    waveforms.set(asset.id, await fetchDuckingWaveform(asset, { projectHandle, api, browserWaveform, check }))
  }
  check()
  const activity = findDuckingActivity(plan.music, plan.sources, waveforms, settings)
  const result = buildDuckingEnvelope(plan.music, activity, settings)
  if (!result.ok) throw new Error(result.reason)
  return result
}
