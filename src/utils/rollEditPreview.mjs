import { getTrimPreviewTimelineTime } from './trimPreview.mjs'

const EPSILON = 1e-7
const finite = value => typeof value === 'number' && Number.isFinite(value)

/** Pick one common timeline-frame delta for both roll sides. Source/duration
 * constraints remain caller-owned; rounding each side separately is unsafe at
 * half-frame ties. Match the existing Math.round convention (ties toward +∞).
 * Inward frame bounds tolerate only numerical noise at an exact frame edge. */
export function resolveRollEditFrameDelta({ requestedDelta, minimumDelta, maximumDelta, fps = 24 } = {}) {
  if (!finite(requestedDelta) || !finite(fps) || fps < 1
    || !(finite(minimumDelta) || minimumDelta === -Infinity)
    || !(finite(maximumDelta) || maximumDelta === Infinity)
    || minimumDelta > maximumDelta) return null
  const minimumRaw = minimumDelta * fps, maximumRaw = maximumDelta * fps, requestedRaw = requestedDelta * fps
  if (!finite(requestedRaw) || finite(minimumDelta) && !finite(minimumRaw) || finite(maximumDelta) && !finite(maximumRaw)) return null
  const minimumFrame = minimumDelta === -Infinity ? -Infinity : Math.ceil(minimumRaw - EPSILON)
  const maximumFrame = maximumDelta === Infinity ? Infinity : Math.floor(maximumRaw + EPSILON)
  if (minimumFrame > maximumFrame) return null
  const acceptedFrame = Math.max(minimumFrame, Math.min(maximumFrame, Math.round(requestedRaw)))
  if (!Number.isSafeInteger(acceptedFrame)) return null
  return acceptedFrame / fps || 0
}

const frameIndex = (time, fps) => {
  if (!finite(time) || time < 0) return null
  const raw = time * fps, frame = Math.round(raw)
  const tolerance = Math.max(EPSILON, Math.abs(raw) * Number.EPSILON * 4)
  return Number.isSafeInteger(frame) && Math.abs(raw - frame) <= tolerance ? frame : null
}

function reachedLimit(bounds, actualDelta, requestedDelta, fps, clipIds) {
  if (!bounds || !finite(requestedDelta) || Math.abs(requestedDelta) < EPSILON) return null
  if (finite(bounds.minimumDelta) && finite(bounds.maximumDelta) && bounds.minimumDelta > bounds.maximumDelta) return null
  for (const side of ['minimum', 'maximum']) {
    const bound = bounds[`${side}Delta`], limit = bounds[`${side}Limit`]
    if (!finite(bound) || !limit || !clipIds.has(limit.clipId) || typeof limit.label !== 'string' || !limit.label.trim()) continue
    const requestedStop = side === 'minimum' ? requestedDelta <= bound + EPSILON : requestedDelta >= bound - EPSILON
    const distance = actualDelta - bound
    // Source limits round inward to a legal common frame: ceil the minimum,
    // floor the maximum. Either accepted edge can sit almost a frame inside
    // its fractional source bound without changing the preview clocks.
    const acceptedStop = Math.abs(distance) <= 0.5 / fps + EPSILON
      || side === 'maximum' && distance < 0 && -distance <= 1 / fps + EPSILON
      || side === 'minimum' && distance > 0 && distance <= 1 / fps + EPSILON
    if (requestedStop && acceptedStop) return { label: limit.label, clipId: limit.clipId }
  }
  return null
}

/**
 * Read-only two-up roll feedback from the ACTUAL post-store pair. Call after
 * both writes have settled: a proposed mouse delta or an intermediate gap is
 * not a valid edit point. No source seeks, edit math, or project state lives here.
 *
 * Optional bounds: { minimumDelta, maximumDelta,
 *   minimumLimit: { label, clipId }, maximumLimit: { label, clipId } }.
 * Bounds annotate a reached stop only; they never calculate preview clocks.
 */
export function buildRollEditPreviewFeedback({ session, clips, fps = 24, requestedDelta, bounds } = {}) {
  if (!session || !Array.isArray(clips) || !finite(fps) || fps < 1
    || typeof session.clipAId !== 'string' || !session.clipAId || typeof session.clipBId !== 'string' || !session.clipBId
    || session.clipAId === session.clipBId) return null
  const originalCutFrame = frameIndex(session.originalEditPoint, fps)
  if (originalCutFrame === null) return null
  const ids = new Set([session.clipAId, session.clipBId]), pair = new Map()
  for (const clip of clips) {
    if (!clip || !ids.has(clip.id)) continue
    if (pair.has(clip.id)) return null
    pair.set(clip.id, clip)
  }
  const clipA = pair.get(session.clipAId), clipB = pair.get(session.clipBId)
  if (!clipA || !clipB || typeof clipA.trackId !== 'string' || !clipA.trackId || clipA.trackId !== clipB.trackId) return null
  const aStartFrame = frameIndex(clipA.startTime, fps), aDurationFrames = frameIndex(clipA.duration, fps)
  const bStartFrame = frameIndex(clipB.startTime, fps), bDurationFrames = frameIndex(clipB.duration, fps)
  const aEndFrame = frameIndex(clipA.startTime + clipA.duration, fps)
  const bEndFrame = frameIndex(clipB.startTime + clipB.duration, fps)
  if ([aStartFrame, aDurationFrames, bStartFrame, bDurationFrames, aEndFrame, bEndFrame].some(value => value === null)
    || aDurationFrames < 1 || bDurationFrames < 1 || aEndFrame !== bStartFrame) return null

  // Existing sessions carry these outer boundaries. If supplied, ensure this
  // is still the same roll, not a stale gesture after a move or normalization.
  if (session.clipAOriginalDuration !== undefined) {
    const frames = frameIndex(session.clipAOriginalDuration, fps)
    if (frames === null || frames < 1 || aStartFrame !== originalCutFrame - frames) return null
  }
  if (session.clipBOriginalStart !== undefined) {
    const frame = frameIndex(session.clipBOriginalStart, fps)
    if (frame === null || frame !== originalCutFrame) return null
  }
  if (session.clipBOriginalDuration !== undefined) {
    const frames = frameIndex(session.clipBOriginalDuration, fps)
    if (frames === null || frames < 1 || bEndFrame !== originalCutFrame + frames) return null
  }
  const outgoingTime = getTrimPreviewTimelineTime(clipA, 'right', fps)
  const incomingTime = getTrimPreviewTimelineTime(clipB, 'left', fps)
  const cutTime = clipB.startTime
  if (!finite(outgoingTime) || !finite(incomingTime) || outgoingTime >= cutTime || incomingTime !== cutTime) return null
  const deltaFrames = bStartFrame - originalCutFrame || 0
  return {
    outgoing: { clipId: clipA.id, clip: clipA, edge: 'right', timelineTime: outgoingTime, duration: clipA.duration },
    incoming: { clipId: clipB.id, clip: clipB, edge: 'left', timelineTime: incomingTime, duration: clipB.duration },
    cutTime, deltaFrames,
    limit: reachedLimit(bounds, cutTime - session.originalEditPoint, requestedDelta, fps, ids),
  }
}
