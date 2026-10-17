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

const isSplittableAt = (clip, position, tracksById) => {
  if (!clip || clip.type === 'compound' || clip.locked
    || (clip.lockMode === 'sync' && clip.syncLock?.mode === 'sync')) return false
  if (tracksById.get(clip.trackId)?.locked) return false
  return position > clip.startTime && position < clip.startTime + clip.duration
}

/** What Split cuts at the playhead, like a modern editor: the selected clips
 * under the playhead (with their linked partners, which selection already
 * includes); with none, the active track's clip. Never other layers.
 */
export function getSplitTargets(state) {
  if (!state || !Number.isFinite(state.playheadPosition)) return []
  const position = quantizeTimeToFrame(state.playheadPosition, getSafeTimelineFps(state.timelineFps))
  const tracksById = new Map((state.tracks || []).map(track => [track.id, track]))
  const selected = new Set(state.selectedClipIds || [])
  if (selected.size > 0) {
    const targets = (state.clips || []).filter(clip => selected.has(clip.id) && isSplittableAt(clip, position, tracksById))
    if (targets.length > 0) return targets
  }
  const active = getActiveTrackSplitTarget(state)
  return active ? [active] : []
}

export const canSplitAtPlayhead = state => getSplitTargets(state).length > 0
