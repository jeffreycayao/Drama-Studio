import { getAudioVolumeEnvelopeGain, normalizeAudioVolumeEnvelope } from './audioVolumeEnvelope.mjs'

// A separate GainNode keeps the volume curve independent of the existing
// static clip gain and edge fades. Exponential amplitude ramps are linear in
// decibels, and run on the audio clock rather than stepping once per video frame.
export function scheduleAudioVolumeEnvelope(param, clip, {
  localTime = 0, contextTime = 0, playbackRate = 1, playing = true,
  endLocalTime = Number(clip?.duration) || 0,
} = {}) {
  if (!param) return
  const now = Math.max(0, Number(contextTime) || 0)
  const start = Number.isFinite(Number(localTime)) ? Number(localTime) : 0
  const rate = Number(playbackRate)
  param.cancelScheduledValues(now)
  param.setValueAtTime(getAudioVolumeEnvelopeGain(clip, start), now)
  if (!playing || !Number.isFinite(rate) || rate <= 0 || endLocalTime <= start) return
  const envelope = normalizeAudioVolumeEnvelope(clip?.volumeEnvelope)
  if (!envelope.points.length) return
  const boundaries = envelope.points.map(point => point.time - envelope.offsetSeconds)
    .filter(time => time > start && time < endLocalTime)
  boundaries.push(endLocalTime)
  for (const local of boundaries) {
    param.exponentialRampToValueAtTime(
      getAudioVolumeEnvelopeGain(clip, local), now + (local - start) / rate,
    )
  }
}

// Keep the schedule through ordinary render ticks. Re-anchor after transport
// jumps, loop wraps, rate/trim/envelope changes or a suspended audio context.
export function updatePreviewVolumeEnvelope(entry, clip, options = {}) {
  const next = {
    envelope: clip.volumeEnvelope, startTime: clip.startTime, duration: clip.duration,
    rate: options.playbackRate, playing: options.playing, contextState: options.contextState,
  }
  const previous = entry.volumeEnvelopeSchedule
  // Per-tick discontinuity checks can miss small errors which accumulate
  // while the playhead stalls or the audio clock resumes. Compare with the
  // actual schedule anchor as well, without rebuilding on normal RAF jitter.
  const phaseError = previous?.playing && options.playing
    ? Math.abs(Number(options.localTime) - (previous.anchorLocalTime
      + (Number(options.contextTime) - previous.anchorContextTime) * previous.rate))
    : 0
  if (!previous || options.discontinuity
    || phaseError > 0.1
    || Object.keys(next).some(key => next[key] !== previous[key])) {
    scheduleAudioVolumeEnvelope(entry.envelopeGainNode?.gain, clip, options)
    entry.volumeEnvelopeSchedule = {
      ...next, anchorLocalTime: Number(options.localTime) || 0,
      anchorContextTime: Number(options.contextTime) || 0,
    }
  }
}
