/**
 * Audio export eligibility shared by the renderer and Electron main process.
 *
 * Some projects saved by an older split path contain `type: "video"` clips
 * on audio tracks. Track placement is authoritative for those media clips:
 * they must remain audible and exportable even before the project is edited
 * and saved again with corrected clip metadata.
 */
export const isAudioMixClip = (clip, track = null) => Boolean(
  clip
  && (
    clip.type === 'audio'
    || (clip.type === 'video' && track?.type === 'audio')
  )
)

export const collectAudioMixClips = (clips = [], tracks = []) => {
  const trackMap = new Map((tracks || []).map((track) => [track.id, track]))
  return (clips || []).filter((clip) => (
    clip?.enabled !== false
    && isAudioMixClip(clip, trackMap.get(clip?.trackId))
  ))
}

// Shared with compound preview/export. Keep the authored start/duration for
// source, fade and envelope clocks; intersect only the audible/visible window.
export const getClipPlaybackWindow = (clip) => {
  const origin = Number(clip?.startTime) || 0
  const duration = Math.max(0, Number(clip?.duration) || 0)
  const lower = clip?.playbackWindowStart
  const upper = clip?.playbackWindowEnd
  return {
    start: Math.max(origin, typeof lower === 'number' && Number.isFinite(lower) ? lower : origin),
    end: Math.min(origin + duration, typeof upper === 'number' && Number.isFinite(upper) ? upper : origin + duration),
  }
}

export const countExpectedAudioMixClips = (clips, rangeStart, rangeEnd) => (
  (clips || []).filter((clip) => {
    if (clip?.reverse) return false // Reverse audio is intentionally silent.
    const { start, end } = getClipPlaybackWindow(clip)
    return end > start && start < rangeEnd && end > rangeStart
  }).length
)

export const getAudioMixDelayMilliseconds = (visibleStart, rangeStart) => {
  const start = Number(visibleStart)
  const range = Number(rangeStart)
  if (!Number.isFinite(start) || !Number.isFinite(range)) return 0
  return Math.max(0, (start - range) * 1000)
}
