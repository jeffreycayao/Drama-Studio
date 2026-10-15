import { getSafeTimelineFps, quantizeTimeToFrame } from './timelineFrames.js'

/** Resolve the active-track command from a current store snapshot, not selection.
 * Match the split operation's frame quantization and honor track/clip locks,
 * so a boundary is unavailable even during an unsnapped scrub.
 */
export function getActiveTrackSplitTarget(state) {
  if (!state?.activeTrackId || !Number.isFinite(state.playheadPosition)) return null
  const track = state.tracks?.find(candidate => candidate.id === state.activeTrackId)
  if (!track || track.locked) return null
  const position = quantizeTimeToFrame(state.playheadPosition, getSafeTimelineFps(state.timelineFps))
  const clip = (state.clips || []).find(candidate => candidate.trackId === state.activeTrackId
    && position > candidate.startTime && position < candidate.startTime + candidate.duration)
  if (!clip || clip.type === 'compound' || clip.locked
    || (clip.lockMode === 'sync' && clip.syncLock?.mode === 'sync')) return null
  return clip
}

// Subscribe only to this boolean in the Split button: playback within a clip
// does not change it or force the full timeline to render on every frame.
export const canSplitActiveTrackAtPlayhead = state => Boolean(getActiveTrackSplitTarget(state))
