export const PLAYBACK_JUMP_TIMEOUT_MS = 5000

/** Session-only decoder handoff; never part of the authored project. */
export function createPlaybackJump(state, targetTime, revision, requestedAt) {
  return {
    token: `${state.timelineSessionId}:${revision}`,
    targetTime,
    timelineSessionId: state.timelineSessionId,
    compoundEditContext: state.compoundEditContext ?? null,
    timelineFps: state.timelineFps,
    playbackRate: state.playbackRate,
    requestedAt,
  }
}

/**
 * All render/audio/transport consumers must validate the same ownership.
 * Direct store replacement can bypass action cleanup (fixtures, hydration,
 * undo/context changes); such stale requests must neither hold nor acknowledge
 * the new playback state. A repeated target in a different session is not the
 * same decoder handoff.
 */
export function getCurrentPlaybackJump(state) {
  const request = state?.playbackJump
  if (!state?.isPlaying || !request?.token
    || !Number.isFinite(request.targetTime) || !Number.isFinite(request.requestedAt)
    || request.timelineSessionId !== state.timelineSessionId
    || request.compoundEditContext !== (state.compoundEditContext ?? null)
    || request.timelineFps !== state.timelineFps
    || request.playbackRate !== state.playbackRate
    || !Number.isFinite(state.playheadPosition)
    || Math.abs(request.targetTime - state.playheadPosition) > 1e-9) return null
  return request
}
