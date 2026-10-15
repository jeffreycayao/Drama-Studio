const DEFAULT_FPS = 24
const BOUND_EPSILON = 1e-7

const LIMIT_LABELS = {
  'source-start': 'Source start reached',
  'source-end': 'Source end reached',
  'source-limit': 'Available media limit reached',
  neighbor: 'Neighboring clip reached',
  'minimum-duration': 'Minimum duration: 1 frame',
  'timeline-start': 'Timeline start reached',
}

// If different restrictions coincide, do not present a neighboring clip or
// minimum-duration stop as though the footage alone were the cause.
const LIMIT_PRIORITY = ['minimum-duration', 'neighbor', 'source-start', 'source-end', 'source-limit', 'timeline-start']

const getSafeFps = (fps) => Number.isFinite(Number(fps)) && Number(fps) > 0
  ? Math.max(1, Number(fps))
  : DEFAULT_FPS

/** Return a retained timeline frame, never the excluded end boundary. */
export function getTrimPreviewTimelineTime(clip, edge, fps = DEFAULT_FPS) {
  const startTime = Number(clip?.startTime)
  const duration = Number(clip?.duration)
  if ((edge !== 'left' && edge !== 'right') || !Number.isFinite(startTime)
    || startTime < 0 || !Number.isFinite(duration) || duration <= 0) return null
  if (edge === 'left') return startTime

  const safeFps = getSafeFps(fps)
  const endFrame = (startTime + duration) * safeFps
  if (!Number.isFinite(endFrame)) return null
  const epsilon = Math.max(BOUND_EPSILON, Math.abs(endFrame) * Number.EPSILON * 4)
  const lastFrame = Math.ceil(endFrame - epsilon) - 1
  return Math.max(startTime, lastFrame / safeFps)
}

const getReachedLimit = (session, actualDelta, requestedDelta, fps, currentById) => {
  // A mouse-down or a no-movement click is not an attempt to cross a limit.
  if (!Number.isFinite(requestedDelta) || Math.abs(requestedDelta) < BOUND_EPSILON) return null
  const tolerance = (0.5 / fps) + BOUND_EPSILON
  const sides = [
    { key: 'minimum', bound: session.minimumDelta, requested: (bound) => requestedDelta <= bound + BOUND_EPSILON },
    { key: 'maximum', bound: session.maximumDelta, requested: (bound) => requestedDelta >= bound - BOUND_EPSILON },
  ]
  for (const { key, bound, requested } of sides) {
    if (!Number.isFinite(bound) || !requested(bound)) continue
    const constraints = session.limitConstraints?.[key]
    if (!Array.isArray(constraints)) continue
    const candidates = constraints.filter((constraint) => (
      constraint && Object.hasOwn(LIMIT_LABELS, constraint.kind)
      && Number.isFinite(constraint.delta)
      && Math.abs(constraint.delta - bound) < BOUND_EPSILON
      && currentById.has(constraint.clipId)
      && (
        Math.abs(actualDelta - bound) <= tolerance
        // Finite-media normalization floors a tail which would otherwise
        // round past the source. Its final legal frame may be almost one
        // frame below the raw bound, rather than the usual half frame.
        || ((constraint.kind === 'source-end' || constraint.kind === 'source-limit')
          && actualDelta < bound && bound - actualDelta <= (1 / fps) + BOUND_EPSILON)
      )
    ))
    candidates.sort((a, b) => LIMIT_PRIORITY.indexOf(a.kind) - LIMIT_PRIORITY.indexOf(b.kind))
    if (!candidates.length) continue
    const { kind, clipId } = candidates[0]
    return { kind, label: LIMIT_LABELS[kind], clipId }
  }
  return null
}

/**
 * Describe the actual post-store trim result. The resolver's unquantized
 * proposal is deliberately not used for preview timing or frame deltas.
 * This creates no project state, seeks nothing, and mutates no inputs.
 */
export function buildTrimPreviewFeedback({ session, clips, requestedDelta, fps = DEFAULT_FPS } = {}) {
  if (!session || (session.edge !== 'left' && session.edge !== 'right')
    || !Array.isArray(session.snapshots) || !session.snapshots.length
    || !Array.isArray(session.targetClipIds) || !Array.isArray(clips)) return null

  const targetIds = new Set(session.targetClipIds)
  const snapshotIds = new Set(session.snapshots.map((snapshot) => snapshot?.id))
  if (targetIds.size !== session.targetClipIds.length
    || snapshotIds.size !== session.snapshots.length
    || targetIds.size !== snapshotIds.size
    || [...targetIds].some((id) => !id || !snapshotIds.has(id))) return null

  const currentById = new Map()
  for (const clip of clips) {
    if (!clip || !targetIds.has(clip.id)) continue
    if (currentById.has(clip.id)) return null
    currentById.set(clip.id, clip)
  }
  if (currentById.size !== targetIds.size) return null
  const clip = currentById.get(session.primaryClipId)
  const snapshot = session.snapshots.find((entry) => entry?.id === session.primaryClipId)
  const primaryEdgeTime = Number(session.primaryEdgeTime)
  if (!clip || !snapshot || !Number.isFinite(primaryEdgeTime)
    || !Number.isFinite(Number(snapshot.duration)) || Number(snapshot.duration) <= 0) return null

  const safeFps = getSafeFps(fps)
  const timelineTime = getTrimPreviewTimelineTime(clip, session.edge, safeFps)
  if (timelineTime === null) return null
  const duration = Number(clip.duration)
  const edgeTime = Number(clip.startTime) + (session.edge === 'right' ? duration : 0)
  const delta = edgeTime - primaryEdgeTime
  if (!Number.isFinite(edgeTime) || !Number.isFinite(delta)) return null

  return {
    clipId: clip.id,
    clip,
    edge: session.edge,
    edgeTime,
    timelineTime,
    duration,
    deltaFrames: Math.round(delta * safeFps) || 0,
    durationDeltaFrames: Math.round((duration - Number(snapshot.duration)) * safeFps) || 0,
    affectedCount: targetIds.size,
    limit: getReachedLimit(session, delta, Number(requestedDelta), safeFps, currentById),
  }
}
