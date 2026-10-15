import { getAudioSourceTimeAtTimeline } from './audioPreviewScheduling.js'
import { updatePreviewVolumeEnvelope } from './audioVolumeAutomation.mjs'

// A decoder handoff pauses sound without ending the user's Play transport.
// Keep source-generation listeners and any play promise alive: they still
// belong to this media element and must settle before it can resume safely.
export function holdAudioPreviewEntry(entry, {
  timelineTime, contextTime = 0, contextState, playbackRate = 1, resetPosition = false,
} = {}) {
  if (!entry || entry.disposed) return
  entry.desiredPlaying = false
  if (!entry.element.paused) entry.element.pause()
  const clip = entry.clip
  if (!clip) return

  if (resetPosition && Number.isFinite(timelineTime)) {
    entry.pendingSeekTarget = getAudioSourceTimeAtTimeline(clip, timelineTime)
    entry.positionPrepared = false
    entry.startAlignmentAttempts = 0
    // Do not clear seekInFlight: its seeked callback must drain this newest
    // pending target instead of issuing overlapping currentTime assignments.
  }
  updatePreviewVolumeEnvelope(entry, clip, {
    localTime: timelineTime - (Number(clip.startTime) || 0),
    contextTime, contextState, playbackRate, playing: false, discontinuity: true,
  })
}
