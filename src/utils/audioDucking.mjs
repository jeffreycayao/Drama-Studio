import { getAudioSourceTimeAtTimeline, getAudioClipTimeScale } from './audioPreviewScheduling.js'
import { getAudioClipLinearGain } from './audioClipGain.js'
import { getAudioClipFadeGain } from './audioClipFades.js'
import { hasAudioSolo, isAudioTrackAudible, trackVolumeToLinearGain } from './audioTrackAudibility.js'
import { getCompoundRenderState, getClipPlaybackWindow } from './compoundPlayback.mjs'
import { getAudioVolumeEnvelopeDb, getAudioVolumeEnvelopeGain, validateAudioVolumeEnvelope,
  AUDIO_VOLUME_ENVELOPE_MIN_DB, AUDIO_VOLUME_ENVELOPE_MAX_POINTS } from './audioVolumeEnvelope.mjs'

export const DEFAULT_DUCKING_SETTINGS = Object.freeze({ reductionDb: 12, fadeSeconds: 0.25, thresholdDb: -35 })
export const DUCKING_MAX_DURATION = 600
const HOLD_SECONDS = 0.2
const STEP_SECONDS = 0.02
const MIN_ACTIVE_SECONDS = 0.08
const finite = value => typeof value === 'number' && Number.isFinite(value)
const locked = value => value?.locked || value?.syncLocked || value?.lockMode === 'sync' || value?.syncLock?.mode === 'sync'
const fail = reason => ({ ok: false, reason })

export function getDuckingSources(state, assets, musicId, dialogueTrackId) {
  const music = state.clips.filter(clip => clip.id === musicId)
  if (music.length !== 1 || music[0].type !== 'audio') return fail('Select one music clip on an audio track.')
  const clip = music[0], track = state.tracks.find(item => item.id === clip.trackId)
  if (!track || track.type !== 'audio' || locked(clip) || locked(track)) return fail('Unlock the music clip and its audio track first.')
  if (!finite(clip.startTime) || !finite(clip.duration) || clip.duration <= 0 || clip.duration > DUCKING_MAX_DURATION) {
    return fail('Choose a music clip up to 10 minutes long.')
  }
  const render = getCompoundRenderState(state)
  if (render.compoundRenderErrors?.length) return fail('Resolve the unsupported compound contents before analyzing dialogue.')
  const voiceTrack = render.tracks.find(item => item.id === dialogueTrackId)
  if (!voiceTrack || voiceTrack.type !== 'audio' || voiceTrack.id === clip.trackId) return fail('Choose a separate dialogue audio track.')
  const anySolo = hasAudioSolo(render.tracks)
  if (!isAudioTrackAudible(track, anySolo) || !isAudioTrackAudible(voiceTrack, anySolo)
    || trackVolumeToLinearGain(track.volume) <= 0 || trackVolumeToLinearGain(voiceTrack.volume) <= 0
    || clip.enabled === false || clip.audioEnabled === false || clip.reverse) {
    return fail('Make both the music clip and dialogue track audible. Check mute, solo, volume and reverse playback.')
  }
  const musicAsset = assets.find(asset => asset.id === clip.assetId)
  if (!musicAsset || musicAsset.hasAudio === false) return fail('The music source is missing or has no audio.')
  const sources = []
  for (const voice of render.clips) {
    if (voice.trackId !== voiceTrack.id || voice.type !== 'audio' || voice.enabled === false
      || voice.audioEnabled === false || voice.reverse) continue
    const window = getClipPlaybackWindow(voice)
    if (window.end <= clip.startTime - 3 || window.start >= clip.startTime + clip.duration + 3) continue
    const asset = assets.find(item => item.id === voice.assetId)
    if (!asset) return fail(`The dialogue source for “${voice.name || voice.id}” is missing.`)
    if (asset.hasAudio === false) continue
    sources.push({ clip: voice, asset, track: voiceTrack })
  }
  if (!sources.length) return fail('No audible dialogue clips overlap this music clip.')
  if (new Set(sources.map(source => source.asset.id)).size > 32) return fail('Choose a section with at most 32 dialogue sources.')
  return { ok: true, music: clip, musicTrack: track, sources }
}

function mergeIntervals(intervals, gap = 0) {
  const merged = []
  for (const interval of [...intervals].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1)
    if (last && interval.start <= last.end + gap + 1e-9) last.end = Math.max(last.end, interval.end)
    else merged.push({ ...interval })
  }
  return merged
}

/** Level-based activity, not a speech recognizer. Sampling follows the same
 * constant-speed/source trim clock as the audio preview. EQ/inserts are not
 * analyzed; an isolated dialogue track gives the most predictable result. */
export function findDuckingActivity(music, sources, waveforms, settings = DEFAULT_DUCKING_SETTINGS) {
  const intervals = []
  const threshold = Math.pow(10, settings.thresholdDb / 20)
  for (const source of sources) {
    const { clip, asset, track } = source
    const waveform = waveforms.get(asset.id)
    if (!waveform || !Array.isArray(waveform.peaks) || !waveform.peaks.length || !finite(waveform.duration)
      || waveform.duration <= 0 || waveform.peaks.some(peak => !finite(peak) || peak < 0 || peak > 1)) {
      throw new Error(`Could not analyze valid audio levels for “${asset.name || asset.id}”.`)
    }
    const hop = waveform.hopSeconds ?? waveform.duration / waveform.peaks.length
    if (!finite(hop) || hop <= 0) throw new Error('The dialogue waveform timing is invalid.')
    const window = getClipPlaybackWindow(clip)
    const start = Math.max(window.start, music.startTime - settings.fadeSeconds - HOLD_SECONDS)
    const end = Math.min(window.end, music.startTime + music.duration + settings.fadeSeconds)
    let activeStart = null
    const close = time => {
      if (activeStart !== null) intervals.push({ start: activeStart - music.startTime, end: time - music.startTime })
      activeStart = null
    }
    for (let index = 0; start + index * STEP_SECONDS < end; index++) {
      const time = start + index * STEP_SECONDS
      const next = Math.min(end, time + STEP_SECONDS), mid = (time + next) / 2
      const raw = (clip.trimStart || 0) + (mid - clip.startTime) * getAudioClipTimeScale(clip)
      const sourceEnd = Math.min(waveform.duration, clip.trimEnd ?? waveform.duration)
      const sourceTime = getAudioSourceTimeAtTimeline(clip, mid)
      const bucket = Math.min(waveform.peaks.length - 1, Math.floor(sourceTime / hop))
      const level = raw >= sourceEnd || raw < 0 ? 0 : (waveform.peaks[bucket] || 0)
        * getAudioClipLinearGain(clip) * getAudioClipFadeGain(clip, mid - clip.startTime)
        * getAudioVolumeEnvelopeGain(clip, mid - clip.startTime) * trackVolumeToLinearGain(track.volume)
      if (level >= threshold) { if (activeStart === null) activeStart = time }
      else close(time)
      if (next === end) close(end)
    }
  }
  return mergeIntervals(intervals, HOLD_SECONDS).filter(interval => interval.end - interval.start >= MIN_ACTIVE_SECONDS - 1e-9)
}

/** Add the proposed attenuation to the current dB curve. Keep existing point
 * IDs, hidden trim points, gain, fades, EQ and every other clip property. */
export function buildDuckingEnvelope(music, activity, settings = DEFAULT_DUCKING_SETTINGS) {
  if (!settings || typeof settings !== 'object' || !Array.isArray(activity)) return fail('Use valid ducking settings and dialogue activity.')
  const { reductionDb, fadeSeconds, thresholdDb } = settings
  if (!finite(reductionDb) || reductionDb < 3 || reductionDb > 24 || !finite(fadeSeconds) || fadeSeconds < 0.05
    || fadeSeconds > 1.5 || !finite(thresholdDb) || thresholdDb < -60 || thresholdDb > -10) return fail('Use valid ducking settings.')
  if (!finite(music?.duration) || music.duration <= 0 || music.duration > DUCKING_MAX_DURATION) return fail('Choose a music clip up to 10 minutes long.')
  const validated = validateAudioVolumeEnvelope(music.volumeEnvelope)
  if (!validated.ok) return fail(validated.reason)
  const previous = validated.envelope
  if (!activity.length) return fail('No dialogue activity was detected. Try a more sensitive setting or another dialogue track.')
  if (activity.some(item => !item || !finite(item.start) || !finite(item.end) || item.end <= item.start)) return fail('The dialogue activity timing is invalid.')
  const dips = mergeIntervals(activity, HOLD_SECONDS + fadeSeconds * 2)
    .filter(item => item.end + HOLD_SECONDS + fadeSeconds > 0 && item.start - fadeSeconds < music.duration)
  if (!dips.length) return fail('No dialogue activity overlaps this music clip.')
  const attenuation = time => Math.min(0, ...dips.map(({ start, end }) => {
    const finish = end + HOLD_SECONDS
    if (time <= start - fadeSeconds || time >= finish + fadeSeconds) return 0
    if (time < start) return -reductionDb * ((time - start + fadeSeconds) / fadeSeconds)
    if (time <= finish) return -reductionDb
    return -reductionDb * (1 - (time - finish) / fadeSeconds)
  }))
  const times = new Set([0, music.duration])
  for (const dip of dips) for (const time of [dip.start - fadeSeconds, dip.start, dip.end + HOLD_SECONDS, dip.end + HOLD_SECONDS + fadeSeconds]) {
    if (time > 0 && time < music.duration) times.add(time)
  }
  for (const point of previous.points) times.add(point.time - previous.offsetSeconds)
  const originalByTime = new Map(previous.points.map(point => [point.time - previous.offsetSeconds, point]))
  const sum = time => getAudioVolumeEnvelopeDb(music, time) + (time >= 0 && time <= music.duration ? attenuation(time) : 0)
  const sorted = [...times].sort((a, b) => a - b)
  // Preserve the exact -60 dB saturation knee instead of flattening a whole ramp.
  for (let i = 1; i < sorted.length; i++) {
    const left = sorted[i - 1], right = sorted[i]
    if (left < 0 || right > music.duration) continue
    const a = sum(left), b = sum(right)
    if ((a < AUDIO_VOLUME_ENVELOPE_MIN_DB) !== (b < AUDIO_VOLUME_ENVELOPE_MIN_DB)) {
      times.add(left + (right - left) * ((AUDIO_VOLUME_ENVELOPE_MIN_DB - a) / (b - a)))
    }
  }
  const ids = new Set(previous.points.map(point => point.id))
  let serial = 0
  const newId = () => { let id; do { id = `duck-${++serial}` } while (ids.has(id)); ids.add(id); return id }
  const points = [...times].sort((a, b) => a - b).map(time => ({
    id: originalByTime.get(time)?.id || newId(), time: originalByTime.get(time)?.time ?? time + previous.offsetSeconds,
    db: time < 0 || time > music.duration ? originalByTime.get(time).db : Math.max(AUDIO_VOLUME_ENVELOPE_MIN_DB, sum(time)),
  }))
  if (points.length > AUDIO_VOLUME_ENVELOPE_MAX_POINTS) return fail(`This needs ${points.length} volume points (limit ${AUDIO_VOLUME_ENVELOPE_MAX_POINTS}). Try a shorter music clip or a longer fade.`)
  const envelope = { version: 1, offsetSeconds: previous.offsetSeconds, points }
  const result = validateAudioVolumeEnvelope(envelope)
  return result.ok ? { ok: true, envelope: result.envelope, activity, dipCount: dips.length, pointCount: points.length } : fail(result.reason)
}
