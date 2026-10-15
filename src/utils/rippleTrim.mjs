import { resolveRollEditFrameDelta } from './rollEditPreview.mjs'
import { getTrimPreviewTimelineTime } from './trimPreview.mjs'
import { isCompoundLocked, isCompoundCacheBusy } from './compoundDocument.mjs'
import { validateAudioVolumeEnvelope, shiftAudioVolumeEnvelope } from './audioVolumeEnvelope.mjs'

const EPSILON = 1e-7
const finite = value => typeof value === 'number' && Number.isFinite(value)
const positive = value => finite(value) && value > 0
const close = (a, b) => Math.abs(a - b) <= EPSILON
const fail = reason => ({ ok: false, changed: false, reason })
const generators = new Set(['image', 'text', 'shape', 'adjustment'])
const supported = new Set(['video', 'audio', ...generators])
const caption = value => value?.role === 'captions' || value?.overlayKind === 'captions' || value?.captionScope
  || value?.settings?.overlayKind === 'captions' || value?.settings?.captionScope || value?.metadata?.captionScope
const populated = value => value != null && (typeof value !== 'object' || Object.keys(value).length > 0)
const endOf = clip => clip.startTime + clip.duration
const onFrame = (value, fps) => finite(value) && Number.isSafeInteger(Math.round(value * fps))
  && Math.abs(value * fps - Math.round(value * fps)) <= EPSILON
const intersects = (a, b) => a.trackId === b.trackId && a.startTime < endOf(b) - EPSILON && endOf(a) > b.startTime + EPSILON
const absoluteTransitionFields = ['startTime', 'endTime', 'editPoint', 'originalClipAStart', 'originalClipAEnd', 'originalClipBStart', 'originalClipBEnd']

function clockFor(clip) {
  if (populated(clip.keyframes?.speed) || populated(clip.speedRamp) || populated(clip.timeRemap)) return fail('Ripple trimming does not support speed ramps or time remapping yet.')
  if (clip.reverse != null && typeof clip.reverse !== 'boolean') return fail('A target has an invalid reverse setting.')
  for (const key of ['speed', 'sourceTimeScale', 'timelineFps', 'sourceFps']) if (clip[key] != null && !positive(clip[key])) return fail('A target has an invalid source clock or speed.')
  const baseScale = clip.sourceTimeScale ?? (clip.timelineFps && clip.sourceFps ? clip.timelineFps / clip.sourceFps : 1)
  const scale = baseScale * (clip.speed ?? 1), trimStart = clip.trimStart ?? 0
  if (!positive(scale) || !finite(trimStart) || trimStart < 0) return fail('A target has invalid source timing.')
  if (generators.has(clip.type)) return { ok: true, generator: true, scale, trimStart }
  if (clip.type === 'video' && !close(baseScale, 1)) return fail('This video uses older source timing. Reopen the project and check its timing before ripple trimming.')
  if (!positive(clip.sourceDuration)) return fail('Reload the target media metadata to establish its source duration before ripple trimming.')
  const trimEnd = clip.trimEnd ?? clip.sourceDuration, span = clip.duration * scale
  if (!positive(trimEnd) || trimEnd <= trimStart || trimEnd > clip.sourceDuration + EPSILON) return fail('A target needs valid source In and Out points before ripple trimming.')
  if (!positive(span) || Math.abs(trimEnd - trimStart - span) > EPSILON * Math.max(1, span)) return fail('A target’s source timing does not match its length. Restore a normal constant-speed trim before ripple trimming.')
  return { ok: true, generator: false, scale, trimStart, trimEnd, sourceDuration: clip.sourceDuration }
}

/** Plan the participants and common source/collision limits before any write.
 * Targets keep their starts. All followers move by the duration change, while
 * foreign tracks participate only through explicitly linked follower clips. */
export function createRippleTrimSession({ clips, tracks, transitions = [], clipId, edge, targetClipIds, fps = 24 } = {}) {
  if (!Array.isArray(clips) || !Array.isArray(tracks) || !Array.isArray(transitions) || !positive(fps) || fps < 1
    || typeof clipId !== 'string' || !clipId || !['left', 'right'].includes(edge)) return fail('Choose a clip edge to ripple trim.')
  const byId = new Map(), trackById = new Map()
  for (const clip of clips) {
    if (!clip?.id || byId.has(clip.id)) return fail('The timeline contains missing or ambiguous clip IDs.')
    byId.set(clip.id, clip)
  }
  for (const track of tracks) {
    if (!track?.id || trackById.has(track.id)) return fail('The timeline contains missing or ambiguous track IDs.')
    trackById.set(track.id, track)
  }
  const requested = targetClipIds === undefined ? [clipId] : targetClipIds
  if (!Array.isArray(requested) || !requested.length || !requested.includes(clipId) || new Set(requested).size !== requested.length
    || requested.some(id => !byId.has(id))) return fail('Choose a valid aligned set of ripple-trim targets.')
  const targetIds = new Set(requested), primary = byId.get(clipId)
  if (!primary) return fail('The ripple-trim target no longer exists.')
  for (const id of targetIds) {
    const clip = byId.get(id)
    if (clip.linkGroupId) for (const other of clips) if (other.linkGroupId === clip.linkGroupId) targetIds.add(other.id)
  }
  const targetTracks = new Set(), targets = [], clocks = new Map()
  const validateAffected = clip => {
    const track = trackById.get(clip.trackId)
    if (!supported.has(clip.type) || clip.compound || caption(clip)) return fail('Affected compounds and captions cannot ripple yet. Open compounds to edit their ordinary layers.')
    if (!track || caption(track) || !['video', 'audio'].includes(track.type)
      || (track.type === 'audio' ? !['audio', 'video'].includes(clip.type) : clip.type === 'audio')) return fail('Every affected clip needs a matching normal video or audio track.')
    if (isCompoundLocked(clip) || isCompoundLocked(track)) return fail('Unlock every affected clip and track before ripple trimming.')
    if (isCompoundCacheBusy(clip)) return fail('Wait for all affected clip render jobs to finish before ripple trimming.')
    if (!finite(clip.startTime) || clip.startTime < 0 || !positive(clip.duration) || !onFrame(clip.startTime, fps)
      || !onFrame(clip.duration, fps) || !onFrame(endOf(clip), fps) || Math.round(clip.duration * fps) < 1) return fail('Every affected clip needs valid frame-aligned timing and at least one frame.')
    return { ok: true }
  }
  for (const id of targetIds) {
    const clip = byId.get(id), valid = validateAffected(clip)
    if (!valid.ok) return valid
    if (!close(clip.startTime, primary.startTime) || !close(clip.duration, primary.duration) || targetTracks.has(clip.trackId)) return fail('Ripple-trim targets and linked mates must have the same start and duration on separate tracks.')
    const clock = clockFor(clip)
    if (!clock.ok) return clock
    const envelope = validateAudioVolumeEnvelope(clip.volumeEnvelope)
    if (!envelope.ok) return fail(envelope.reason)
    targets.push(clip); clocks.set(id, clock); targetTracks.add(clip.trackId)
  }
  const originalEnd = endOf(primary), shiftedIds = new Set()
  for (const clip of clips) {
    if (!targetIds.has(clip.id) && targetTracks.has(clip.trackId) && clip.startTime >= originalEnd - EPSILON) shiftedIds.add(clip.id)
  }
  // Set iteration visits newly added linked mates too, closing every group.
  for (const id of shiftedIds) {
    const clip = byId.get(id)
    if (clip.linkGroupId) for (const mate of clips) if (mate.linkGroupId === clip.linkGroupId) {
      if (targetIds.has(mate.id) || targetTracks.has(mate.trackId) && mate.startTime < originalEnd - EPSILON) return fail('A downstream linked mate reaches into the trimmed or earlier material. Unlink it before ripple trimming.')
      shiftedIds.add(mate.id)
    }
  }
  const shifted = [...shiftedIds].map(id => byId.get(id)), affectedIds = new Set([...targetIds, ...shiftedIds])
  for (const clip of shifted) {
    const valid = validateAffected(clip)
    if (!valid.ok) return valid
  }
  for (const clip of [...targets, ...shifted]) for (const other of clips) {
    if (other.id === clip.id || other.trackId !== clip.trackId) continue
    if (!finite(other.startTime) || other.startTime < 0 || !positive(other.duration) || !onFrame(other.startTime, fps)
      || !onFrame(other.duration, fps) || !onFrame(endOf(other), fps)) return fail('An affected track has invalid neighboring timing.')
    if (intersects(clip, other)) return fail('An affected clip overlaps other material. Resolve the overlap before ripple trimming.')
  }
  let minimumDelta = edge === 'left' ? -Infinity : 1 / fps - primary.duration
  let maximumDelta = edge === 'left' ? primary.duration - 1 / fps : Infinity
  let minimumLimit = edge === 'left' ? null : { label: 'Minimum duration: 1 frame', clipId }
  let maximumLimit = edge === 'left' ? { label: 'Minimum duration: 1 frame', clipId } : null
  const lower = (value, limit) => { if (value > minimumDelta) { minimumDelta = value; minimumLimit = limit } }
  const upper = (value, limit) => { if (value < maximumDelta) { maximumDelta = value; maximumLimit = limit } }
  const shiftLower = (value, limit) => edge === 'left' ? upper(-value, limit) : lower(value, limit)
  const shiftUpper = (value, limit) => edge === 'left' ? lower(-value, limit) : upper(value, limit)
  for (const clip of targets) {
    const clock = clocks.get(clip.id)
    if (clock.generator) continue
    if (edge === 'left') lower(clip.reverse ? -(clock.sourceDuration - clock.trimEnd) / clock.scale : -clock.trimStart / clock.scale,
      { label: clip.reverse ? 'Source end reached' : 'Source start reached', clipId: clip.id })
    else upper(clip.reverse ? clock.trimStart / clock.scale : (clock.sourceDuration - clock.trimEnd) / clock.scale,
      { label: clip.reverse ? 'Source start reached' : 'Source end reached', clipId: clip.id })
  }
  for (const clip of shifted) {
    shiftLower(-clip.startTime, { label: 'Timeline start reached', clipId: clip.id })
    for (const other of clips) {
      if (affectedIds.has(other.id) || other.trackId !== clip.trackId) continue
      if (endOf(other) <= clip.startTime + EPSILON) shiftLower(endOf(other) - clip.startTime, { label: 'Neighboring clip reached', clipId: clip.id })
      else if (other.startTime >= endOf(clip) - EPSILON) shiftUpper(other.startTime - endOf(clip), { label: 'Neighboring clip reached', clipId: clip.id })
    }
  }
  const movingTransitions = new Set()
  const transitionIdCounts = new Map()
  for (const transition of transitions) transitionIdCounts.set(transition?.id, (transitionIdCounts.get(transition?.id) || 0) + 1)
  for (const transition of transitions) {
    const refs = [...new Set([transition?.clipId, transition?.clipAId, transition?.clipBId].filter(Boolean))]
    if (!refs.length) return fail('A transition relationship is malformed. Repair or remove it before ripple trimming.')
    if (!refs.some(id => affectedIds.has(id))) continue
    if (refs.some(id => targetIds.has(id))) return fail('Remove transitions attached to the trimmed targets before ripple trimming.')
    const edgeTransition = transition.kind === 'edge'
    if (typeof transition.id !== 'string' || !transition.id.trim() || transitionIdCounts.get(transition.id) !== 1
      || ![undefined, 'between', 'edge'].includes(transition.kind) || !positive(transition.duration) || refs.some(id => !byId.has(id))
      || (edgeTransition ? refs.length !== 1 || !transition.clipId || transition.clipAId != null || transition.clipBId != null || !['in', 'out'].includes(transition.edge)
        : refs.length !== 2 || transition.clipId != null || !transition.clipAId || !transition.clipBId || transition.clipAId === transition.clipBId
          || byId.get(transition.clipAId)?.trackId !== byId.get(transition.clipBId)?.trackId)) return fail('An affected transition relationship is malformed. Repair or remove it before ripple trimming.')
    if (refs.some(id => !shiftedIds.has(id))) return fail('A transition connects moving and stationary clips. Remove it before ripple trimming.')
    for (const field of absoluteTransitionFields) if (transition[field] != null) {
      if (!finite(transition[field]) || transition[field] < 0) return fail('An affected transition has invalid timeline metadata.')
      shiftLower(-transition[field], { label: 'Transition timeline start reached', clipId: refs[0] })
    }
    movingTransitions.add(transition)
  }
  const bounds = { minimumDelta, maximumDelta, minimumLimit, maximumLimit }
  if (resolveRollEditFrameDelta({ requestedDelta: 0, ...bounds, fps }) !== 0) return fail('This selection has no valid frame-aligned ripple range.')
  const affectedTrackIds = new Set([...targets, ...shifted].map(clip => clip.trackId))
  const session = { clipId, edge, primaryEdgeTime: edge === 'left' ? primary.startTime : originalEnd,
    originalStartTime: primary.startTime, originalDuration: primary.duration, targetClipIds: [...targetIds],
    snapExcludedClipIds: [...affectedIds], affectedTrackNames: tracks.filter(track => affectedTrackIds.has(track.id)).map(track => track.name || track.id),
    shiftedClipCount: shifted.length, linkedTargetCount: targetIds.size - requested.length,
    clips, transitions, targets, shiftedIds, clocks, movingTransitions, fps, bounds }
  return { ok: true, session, bounds }
}

export function buildRippleTrimPreviewFeedback({ session, clips, requestedDelta } = {}) {
  if (!session || !Array.isArray(clips)) return null
  const { fps, edge, bounds } = session, targetSet = new Set(session.targetClipIds)
  const targets = clips.filter(clip => targetSet.has(clip?.id))
  if (targets.length !== targetSet.size || new Set(targets.map(clip => clip.id)).size !== targetSet.size) return null
  const clip = targets.find(clip => clip.id === session.clipId)
  if (!clip || targets.some(target => !close(target.startTime, session.originalStartTime) || !close(target.duration, clip.duration)
    || !positive(target.duration) || !onFrame(target.duration, fps))) return null
  const durationDelta = clip.duration - session.originalDuration, delta = edge === 'left' ? -durationDelta : durationDelta
  if (!onFrame(delta, fps)) return null
  const timelineTime = getTrimPreviewTimelineTime(clip, edge, fps)
  if (!finite(timelineTime)) return null
  let limit = null
  if (finite(requestedDelta) && Math.abs(requestedDelta) > EPSILON) for (const side of ['minimum', 'maximum']) {
    const bound = bounds[`${side}Delta`], label = bounds[`${side}Limit`]
    if (!finite(bound) || !label) continue
    const attempted = side === 'minimum' ? requestedDelta <= bound + EPSILON : requestedDelta >= bound - EPSILON
    const acceptedBound = resolveRollEditFrameDelta({ requestedDelta: bound, ...bounds, fps })
    if (attempted && acceptedBound !== null && close(delta, acceptedBound)) { limit = { ...label }; break }
  }
  return { clipId: clip.id, clip, edge, edgeTime: edge === 'left' ? clip.startTime : endOf(clip), timelineTime,
    duration: clip.duration, deltaFrames: Math.round(delta * fps) || 0, durationDeltaFrames: Math.round(durationDelta * fps) || 0,
    guideTime: session.primaryEdgeTime + delta, affectedCount: targets.length,
    affectedTrackNames: [...session.affectedTrackNames], shiftedClipCount: session.shiftedClipCount, linkedTargetCount: session.linkedTargetCount, limit }
}

/** Construct the complete result from original snapshots; no per-clip writes,
 * overlap resolution, source-file deletion, or cumulative offset mutation. */
export function planRippleTrim({ session, requestedDelta } = {}) {
  if (!session?.targets || !Array.isArray(session.clips)) return fail('Start a new ripple-trim gesture.')
  const { fps, bounds, edge } = session
  const delta = resolveRollEditFrameDelta({ requestedDelta, ...bounds, fps })
  if (delta === null) return fail('This pointer position has no valid frame-aligned ripple delta.')
  const durationDelta = edge === 'left' ? -delta : delta
  let clips = session.clips, transitions = session.transitions
  if (delta !== 0) {
    const newDuration = (Math.round(session.originalDuration * fps) + Math.round(durationDelta * fps)) / fps
    const changes = new Map()
    for (const clip of session.targets) {
      if (!positive(newDuration) || !onFrame(newDuration, fps) || !onFrame(clip.startTime + newDuration, fps)) return fail('The ripple trim exceeds the supported timeline frame range.')
      const clock = session.clocks.get(clip.id)
      const trims = clock.generator ? { trimStart: clock.trimStart, trimEnd: clock.trimStart + newDuration * clock.scale }
        : edge === 'left' ? clip.reverse
          ? { trimStart: clock.trimStart, trimEnd: clock.trimEnd - delta * clock.scale }
          : { trimStart: Math.max(0, clock.trimStart + delta * clock.scale), trimEnd: clock.trimEnd }
        : clip.reverse ? { trimStart: Math.max(0, clock.trimStart - delta * clock.scale), trimEnd: clock.trimEnd }
          : { trimStart: clock.trimStart, trimEnd: clock.trimEnd + delta * clock.scale }
      if (!finite(trims.trimStart) || !positive(trims.trimEnd) || trims.trimEnd <= trims.trimStart) return fail('The target source range cannot represent this ripple trim.')
      const next = { ...clip, duration: newDuration, ...trims }
      if (edge === 'left' && clip.volumeEnvelope != null) {
        if (!finite(clip.volumeEnvelope.offsetSeconds + delta)) return fail('A target volume envelope offset is outside the supported time range.')
        next.volumeEnvelope = shiftAudioVolumeEnvelope(clip, delta)
      }
      changes.set(clip.id, next)
    }
    for (const clip of session.clips) if (session.shiftedIds.has(clip.id)) {
      const startTime = (Math.round(clip.startTime * fps) + Math.round(durationDelta * fps)) / fps
      if (!finite(startTime) || startTime < 0 || !onFrame(startTime, fps) || !onFrame(startTime + clip.duration, fps)) return fail('An affected clip would leave the supported timeline frame range.')
      changes.set(clip.id, { ...clip, startTime })
    }
    clips = session.clips.map(clip => changes.get(clip.id) || clip)
    if (session.movingTransitions.size) {
      transitions = []
      for (const transition of session.transitions) {
        if (!session.movingTransitions.has(transition)) { transitions.push(transition); continue }
        const next = { ...transition }
        for (const field of absoluteTransitionFields) if (transition[field] != null) {
          next[field] = transition[field] + durationDelta
          if (!finite(next[field]) || next[field] < 0 || !Number.isSafeInteger(Math.round(next[field] * fps))) return fail('An affected transition would leave the supported timeline frame range.')
        }
        transitions.push(next)
      }
    }
    for (const clip of changes.values()) for (const other of clips) if (clip.id !== other.id && intersects(clip, other)) return fail('This ripple trim would overlap other material.')
  }
  const feedback = buildRippleTrimPreviewFeedback({ session, clips, requestedDelta })
  if (!feedback) return fail('The resulting target timing does not match a valid ripple trim.')
  return { ok: true, changed: delta !== 0, clips, transitions, delta, durationDelta, bounds, feedback }
}
