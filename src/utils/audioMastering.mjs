import { getAudioSourceTimeAtTimeline, getAudioClipTimeScale } from './audioPreviewScheduling.js'
import { getAudioClipLinearGain } from './audioClipGain.js'
import { getAudioClipFadeGain } from './audioClipFades.js'
import { trackVolumeToLinearGain } from './audioTrackAudibility.js'
import { getClipPlaybackWindow } from './compoundPlayback.mjs'
import { getDuckingSources, DUCKING_MAX_DURATION } from './audioDucking.mjs'
import {
  getAudioVolumeEnvelopeDb, getAudioVolumeEnvelopeGain, normalizeAudioVolumeEnvelope, validateAudioVolumeEnvelope,
  AUDIO_VOLUME_ENVELOPE_MIN_DB, AUDIO_VOLUME_ENVELOPE_MAX_POINTS,
} from './audioVolumeEnvelope.mjs'

/** Track mix roles. Separate from `track.role` (captions), which restricts
 * which clips a track accepts; a mix role only drives mastering tools. */
export const MIX_ROLES = Object.freeze(['dialogue', 'bgm', 'sfx'])
export const MIX_ROLE_LABELS = Object.freeze({ dialogue: 'Dialogue', bgm: 'Music (BGM)', sfx: 'Sound effects' })

/** Defaults follow the request: -14 dB, 60 ms attack, 500 ms hold. */
export const DEFAULT_AUTO_DUCKING_SETTINGS = Object.freeze({
  reductionDb: 14, attackMs: 60, holdMs: 500, releaseMs: 300, thresholdDb: -38, detector: 'rms', minSpeechMs: 80,
})
export const AUTO_DUCKING_LIMITS = Object.freeze({
  reductionDb: [3, 30], attackMs: [5, 1000], holdMs: [0, 3000], releaseMs: [20, 3000],
  thresholdDb: [-70, -10], minSpeechMs: [0, 1000],
})
const HYSTERESIS_DB = 6
const STEP_SECONDS = 0.01
const MAX_DIALOGUE_SOURCES = 32
const finite = value => typeof value === 'number' && Number.isFinite(value)
const fail = reason => ({ ok: false, reason })

export function normalizeMixRole(value) {
  return MIX_ROLES.includes(value) ? value : null
}

export function getTrackMixRole(track) {
  return track?.type === 'audio' ? normalizeMixRole(track.mixRole) : null
}

export function validateAutoDuckingSettings(settings) {
  if (!settings || typeof settings !== 'object') return fail('Use valid auto-ducking settings.')
  const next = {}
  for (const [key, [min, max]] of Object.entries(AUTO_DUCKING_LIMITS)) {
    const value = settings[key] ?? DEFAULT_AUTO_DUCKING_SETTINGS[key]
    if (!finite(value) || value < min || value > max) return fail(`${key} must be between ${min} and ${max}.`)
    next[key] = value
  }
  const detector = settings.detector ?? DEFAULT_AUTO_DUCKING_SETTINGS.detector
  if (!['rms', 'peak'].includes(detector)) return fail('The detector must be RMS or peak.')
  return { ok: true, settings: { ...next, detector } }
}

const seconds = settings => ({
  attack: settings.attackMs / 1000, hold: settings.holdMs / 1000, release: settings.releaseMs / 1000,
})

/** Every audible BGM clip with the dialogue clips that can duck it. Read-only;
 * the eligibility rules (mute/solo/lock/reverse/compound) are the existing
 * single-pair ducking rules, applied once per dialogue track. */
export function planAutoDuckingTargets(state, assets) {
  const tracks = Array.isArray(state?.tracks) ? state.tracks : []
  const dialogueTracks = tracks.filter(track => getTrackMixRole(track) === 'dialogue')
  const bgmTracks = tracks.filter(track => getTrackMixRole(track) === 'bgm')
  if (!dialogueTracks.length) return fail('Mark at least one audio track as Dialogue.')
  if (!bgmTracks.length) return fail('Mark at least one audio track as Music (BGM).')
  const targets = [], skipped = []
  for (const bgmTrack of bgmTracks) {
    for (const music of state.clips.filter(clip => clip.trackId === bgmTrack.id && clip.type === 'audio')) {
      const sources = new Map()
      let blocking = null
      for (const dialogueTrack of dialogueTracks) {
        if (dialogueTrack.id === bgmTrack.id) continue
        const plan = getDuckingSources(state, assets, music.id, dialogueTrack.id)
        if (plan.ok) { for (const source of plan.sources) sources.set(source.clip.id, source); continue }
        // "Nothing overlaps on this dialogue track" is normal; anything else
        // (locked, muted, too long, missing source) blocks this music clip.
        if (!/No audible dialogue clips overlap/.test(plan.reason)) { blocking = plan.reason; break }
      }
      if (blocking) skipped.push({ clipId: music.id, name: music.name || music.id, reason: blocking })
      else if (!sources.size) skipped.push({ clipId: music.id, name: music.name || music.id, reason: 'No dialogue overlaps this music clip.' })
      else if (new Set([...sources.values()].map(source => source.asset.id)).size > MAX_DIALOGUE_SOURCES) {
        skipped.push({ clipId: music.id, name: music.name || music.id, reason: `More than ${MAX_DIALOGUE_SOURCES} dialogue sources overlap. Split the music clip.` })
      } else targets.push({ music, musicTrack: bgmTrack, sources: [...sources.values()] })
    }
  }
  return { ok: true, targets, skipped }
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

function levelsFor(waveform, detector) {
  if (detector === 'rms' && Array.isArray(waveform.rms) && waveform.rms.length === waveform.peaks.length
    && waveform.rms.every(value => finite(value) && value >= 0 && value <= 1)) return { levels: waveform.rms, detector: 'rms' }
  return { levels: waveform.peaks, detector: 'peak' }
}

/** RMS (or peak) gate with hysteresis: opens at the threshold and closes 6 dB
 * lower, so the gaps between syllables do not flutter the music. Intervals
 * are relative to the music clip's start. Level includes clip gain, fades,
 * the dialogue clip's own envelope and its track volume. */
export function detectSpeechActivity(music, sources, waveforms, input = DEFAULT_AUTO_DUCKING_SETTINGS) {
  const checked = validateAutoDuckingSettings(input)
  if (!checked.ok) throw new Error(checked.reason)
  const settings = checked.settings
  const { attack, hold, release } = seconds(settings)
  const open = Math.pow(10, settings.thresholdDb / 20)
  const close = Math.pow(10, (settings.thresholdDb - HYSTERESIS_DB) / 20)
  const intervals = []
  let usedDetector = settings.detector
  for (const { clip, asset, track } of sources) {
    const waveform = waveforms.get(asset.id)
    if (!waveform || !Array.isArray(waveform.peaks) || !waveform.peaks.length || !finite(waveform.duration)
      || waveform.duration <= 0 || waveform.peaks.some(peak => !finite(peak) || peak < 0 || peak > 1)) {
      throw new Error(`Could not analyze valid audio levels for “${asset.name || asset.id}”.`)
    }
    const { levels, detector } = levelsFor(waveform, settings.detector)
    if (detector !== settings.detector) usedDetector = detector
    const hop = waveform.hopSeconds ?? waveform.duration / levels.length
    if (!finite(hop) || hop <= 0) throw new Error('The dialogue waveform timing is invalid.')
    const window = getClipPlaybackWindow(clip)
    const start = Math.max(window.start, music.startTime - hold - release)
    const end = Math.min(window.end, music.startTime + music.duration + attack)
    let activeStart = null
    const finish = time => {
      if (activeStart !== null) intervals.push({ start: activeStart - music.startTime, end: time - music.startTime })
      activeStart = null
    }
    for (let index = 0; start + index * STEP_SECONDS < end; index++) {
      const time = start + index * STEP_SECONDS
      const next = Math.min(end, time + STEP_SECONDS), mid = (time + next) / 2
      const raw = (clip.trimStart || 0) + (mid - clip.startTime) * getAudioClipTimeScale(clip)
      const sourceEnd = Math.min(waveform.duration, clip.trimEnd ?? waveform.duration)
      const bucket = Math.min(levels.length - 1, Math.floor(getAudioSourceTimeAtTimeline(clip, mid) / hop))
      const level = raw >= sourceEnd || raw < 0 || bucket < 0 ? 0 : (levels[bucket] || 0)
        * getAudioClipLinearGain(clip) * getAudioClipFadeGain(clip, mid - clip.startTime)
        * getAudioVolumeEnvelopeGain(clip, mid - clip.startTime) * trackVolumeToLinearGain(track.volume)
      if (activeStart === null ? level >= open : level >= close) { if (activeStart === null) activeStart = time }
      else finish(time)
      if (next === end) finish(end)
    }
  }
  const minimum = settings.minSpeechMs / 1000
  const activity = mergeIntervals(intervals, STEP_SECONDS * 2).filter(item => item.end - item.start >= minimum - 1e-9)
  return Object.assign(activity, { detector: usedDetector })
}

const samePoints = (a, b) => JSON.stringify(a.points) === JSON.stringify(b.points)

/** The envelope auto-ducking should build on. When the clip still carries
 * exactly the points the last pass applied, return that pass's base so a
 * re-run replaces it instead of stacking. Head trims only move
 * `offsetSeconds`, so the comparison ignores the offset. */
export function getAutoDuckingBase(clip) {
  const current = normalizeAudioVolumeEnvelope(clip?.volumeEnvelope)
  const record = clip?.autoDucking
  if (record?.version === 1 && record.appliedEnvelope && record.baseEnvelope) {
    const applied = validateAudioVolumeEnvelope(record.appliedEnvelope)
    const base = validateAudioVolumeEnvelope(record.baseEnvelope)
    if (applied.ok && base.ok && samePoints(applied.envelope, current)) {
      return { envelope: { ...base.envelope, offsetSeconds: current.offsetSeconds }, replacesPrevious: true, editedSinceDucking: false }
    }
    return { envelope: current, replacesPrevious: false, editedSinceDucking: true }
  }
  return { envelope: current, replacesPrevious: false, editedSinceDucking: false }
}

function dipTimes(dip, settings) {
  const { attack, hold, release } = seconds(settings)
  return [dip.start - attack, dip.start, dip.end + hold, dip.end + hold + release]
}

function envelopeTimes(music, base, dips, settings) {
  const times = new Set([0, music.duration])
  for (const dip of dips) for (const time of dipTimes(dip, settings)) if (time > 0 && time < music.duration) times.add(time)
  for (const point of base.points) times.add(point.time - base.offsetSeconds)
  return times
}

/** Attenuation in dB at a music-local time (always <= 0). Ramps are linear in
 * dB, matching how the envelope interpolates between points. */
export function getDuckingAttenuationDb(time, dips, settings) {
  const { attack, hold, release } = seconds(settings)
  let lowest = 0
  for (const { start, end } of dips) {
    const finish = end + hold
    let value = 0
    if (time <= start - attack || time >= finish + release) value = 0
    else if (time < start) value = -settings.reductionDb * ((time - start + attack) / attack)
    else if (time <= finish) value = -settings.reductionDb
    else value = -settings.reductionDb * (1 - (time - finish) / release)
    if (value < lowest) lowest = value
  }
  return lowest
}

/** Build the BGM clip's new envelope: base curve plus attack/hold/release
 * dips. Dips closer than attack+hold+release merge (no pumping). If the
 * result would exceed the editable point cap, the closest dips are merged
 * until it fits; ducking is only ever extended across a short gap, never
 * shortened over speech. Existing point ids and hidden trim points survive. */
export function buildAutoDuckingEnvelope(music, activity, input = DEFAULT_AUTO_DUCKING_SETTINGS, baseEnvelope = music?.volumeEnvelope) {
  const checked = validateAutoDuckingSettings(input)
  if (!checked.ok) return checked
  const settings = checked.settings
  if (!finite(music?.duration) || music.duration <= 0 || music.duration > DUCKING_MAX_DURATION) return fail('Choose a music clip up to 10 minutes long.')
  if (!Array.isArray(activity)) return fail('The dialogue activity is invalid.')
  if (activity.some(item => !item || !finite(item.start) || !finite(item.end) || item.end <= item.start)) return fail('The dialogue activity timing is invalid.')
  const validated = validateAudioVolumeEnvelope(baseEnvelope)
  if (!validated.ok) return fail(validated.reason)
  const base = validated.envelope
  const { attack, hold, release } = seconds(settings)
  let dips = mergeIntervals(activity, attack + hold + release)
    .filter(item => item.end + hold + release > 0 && item.start - attack < music.duration)
  if (!dips.length) return fail('No dialogue was detected under this music clip. Try a lower threshold.')
  const requested = dips.length
  while (dips.length > 1 && envelopeTimes(music, base, dips, settings).size > AUDIO_VOLUME_ENVELOPE_MAX_POINTS) {
    let index = 0
    for (let i = 1; i < dips.length - 1; i++) {
      if (dips[i + 1].start - dips[i].end < dips[index + 1].start - dips[index].end) index = i
    }
    dips = [...dips.slice(0, index), { start: dips[index].start, end: dips[index + 1].end }, ...dips.slice(index + 2)]
  }
  const times = envelopeTimes(music, base, dips, settings)
  const baseClip = { volumeEnvelope: base }
  const sum = time => getAudioVolumeEnvelopeDb(baseClip, time) + getDuckingAttenuationDb(time, dips, settings)
  const sorted = [...times].sort((a, b) => a - b)
  // Keep the exact -60 dB saturation knee instead of flattening a whole ramp.
  for (let i = 1; i < sorted.length; i++) {
    const left = sorted[i - 1], right = sorted[i]
    if (left < 0 || right > music.duration) continue
    const a = sum(left), b = sum(right)
    if ((a < AUDIO_VOLUME_ENVELOPE_MIN_DB) !== (b < AUDIO_VOLUME_ENVELOPE_MIN_DB)) {
      times.add(left + (right - left) * ((AUDIO_VOLUME_ENVELOPE_MIN_DB - a) / (b - a)))
    }
  }
  if (times.size > AUDIO_VOLUME_ENVELOPE_MAX_POINTS) {
    return fail(`This needs ${times.size} volume points (limit ${AUDIO_VOLUME_ENVELOPE_MAX_POINTS}). Remove some existing volume points or split the music clip.`)
  }
  const originalByTime = new Map(base.points.map(point => [point.time - base.offsetSeconds, point]))
  const ids = new Set(base.points.map(point => point.id))
  let serial = 0
  const newId = () => { let id; do { id = `aduck-${++serial}` } while (ids.has(id)); ids.add(id); return id }
  const points = [...times].sort((a, b) => a - b).map(time => {
    const original = originalByTime.get(time)
    const outside = time < 0 || time > music.duration
    return { id: original?.id || newId(), time: original?.time ?? time + base.offsetSeconds,
      db: outside ? original.db : Math.min(12, Math.max(AUDIO_VOLUME_ENVELOPE_MIN_DB, sum(time))) }
  })
  const result = validateAudioVolumeEnvelope({ version: 1, offsetSeconds: base.offsetSeconds, points })
  if (!result.ok) return fail(result.reason)
  return { ok: true, envelope: result.envelope, dips, dipCount: dips.length, mergedForLimit: requested - dips.length,
    pointCount: points.length, settings }
}

/** Only the documented settings are stored in the project file. */
export function pickAutoDuckingSettings(settings) {
  const source = settings && typeof settings === 'object' ? settings : {}
  const picked = {}
  for (const key of [...Object.keys(AUTO_DUCKING_LIMITS), 'detector']) {
    const value = source[key]
    if (key === 'detector' ? ['rms', 'peak'].includes(value) : finite(value)) picked[key] = value
  }
  return picked
}

/** The per-clip record that lets a later pass replace (or remove) this one. */
export function buildAutoDuckingRecord(baseEnvelope, appliedEnvelope, settings, appliedAt = Date.now()) {
  return { version: 1, baseEnvelope: normalizeAudioVolumeEnvelope(baseEnvelope),
    appliedEnvelope: normalizeAudioVolumeEnvelope(appliedEnvelope), settings: pickAutoDuckingSettings(settings), appliedAt }
}

/** Everything the detector reads: clips on Dialogue/BGM tracks (timing,
 * gain, fades, envelopes, enable/reverse) and every audio track's role,
 * mute, solo and volume. A proposal is stale as soon as this changes. */
export function getAutoDuckingInputSignature(state) {
  const audioTracks = (state?.tracks || []).filter(track => track?.type === 'audio')
  const roleTrackIds = new Set(audioTracks.filter(track => ['dialogue', 'bgm'].includes(getTrackMixRole(track))).map(track => track.id))
  return JSON.stringify({
    tracks: audioTracks.map(track => [track.id, getTrackMixRole(track), Boolean(track.muted), Boolean(track.solo), track.volume ?? 100, Boolean(track.locked)]),
    clips: (state?.clips || []).filter(clip => roleTrackIds.has(clip.trackId)),
  })
}

/** Restore the pre-ducking curve if nobody edited the points since. */
export function planRemoveAutoDucking(clip) {
  if (!clip?.autoDucking) return fail('This clip has no auto-ducking to remove.')
  const base = getAutoDuckingBase(clip)
  if (!base.replacesPrevious) return fail('The volume points were edited after auto-ducking. Use Undo or edit the points directly.')
  return { ok: true, envelope: base.envelope }
}
