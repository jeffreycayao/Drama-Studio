export const PLAY_AROUND_SECONDS = 2

const sameContext = (state, session) => state.timelineSessionId === session.timelineSessionId
  && (state.compoundEditContext ?? null) === session.compoundEditContext

/** Transient audition. References bind it to the edit being reviewed, not just IDs. */
export function createPlayAround(state, centerTime, revision) {
  const active = getCurrentPlayAround(state)
  const center = centerTime == null ? (active?.centerTime ?? state.playheadPosition) : Number(centerTime)
  const end = Number(state.getTimelineEndTime?.())
  const fps = Number(state.timelineFps)
  if (!Number.isFinite(center) || !Number.isFinite(end) || end <= 0 || !Number.isFinite(fps) || fps <= 0
    || !state.clips?.length || center < 0 || center > end || !Number.isFinite(state.playheadPosition)) return null
  const startTime = Math.max(0, Math.round((center - PLAY_AROUND_SECONDS) * fps) / fps)
  const endTime = Math.min(end, Math.round((center + PLAY_AROUND_SECONDS) * fps) / fps)
  if (endTime - startTime < 1 / fps - 1e-9) return null
  return {
    token: `${state.timelineSessionId}:around:${revision}`,
    centerTime: center, startTime, endTime,
    returnTime: active?.returnTime ?? state.playheadPosition,
    previousRate: active?.previousRate ?? state.playbackRate,
    previousShuttleMode: active?.previousShuttleMode ?? state.shuttleMode,
    timelineSessionId: state.timelineSessionId, timelineFps: state.timelineFps,
    compoundEditContext: state.compoundEditContext ?? null,
    clips: state.clips, tracks: state.tracks, transitions: state.transitions,
    loopMode: state.loopMode, inPoint: state.inPoint, outPoint: state.outPoint,
  }
}

export function getCurrentPlayAround(state) {
  const session = state?.playAround
  if (!session?.token || !state.isPlaying || state.playbackRate !== 1 || state.shuttleMode
    || !sameContext(state, session) || state.timelineFps !== session.timelineFps
    || state.clips !== session.clips || state.tracks !== session.tracks || state.transitions !== session.transitions
    || state.loopMode !== session.loopMode || state.inPoint !== session.inPoint || state.outPoint !== session.outPoint
    || !Number.isFinite(state.playheadPosition) || state.playheadPosition < session.startTime - 1e-9
    || state.playheadPosition > session.endTime + 1e-9) return null
  return session
}

/** Retire only the owned audition; never pause or seek a replacement timeline. */
export function stopPlayAroundPatch(state) {
  const session = state?.playAround
  if (!session) return {}
  if (!sameContext(state, session) || state.playbackRate !== 1 || state.shuttleMode) return { playAround: null }
  return { playAround: null, isPlaying: false, playbackRate: session.previousRate,
    shuttleMode: session.previousShuttleMode, playbackJump: null }
}
