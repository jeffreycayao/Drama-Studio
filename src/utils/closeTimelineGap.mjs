import { isCompoundLocked, isCompoundCacheBusy } from './compoundDocument.mjs'

const EPSILON = 1e-7
const finite = value => typeof value === 'number' && Number.isFinite(value)
const positive = value => finite(value) && value > 0
const fail = (code, reason) => ({ ok: false, changed: false, code, reason })
const frameAt = (time, fps) => {
  if (!finite(time) || time < 0) return null
  const frame = Math.round(time * fps)
  return Number.isSafeInteger(frame) && Math.abs(time * fps - frame) <= EPSILON ? frame : null
}
const linkId = clip => typeof clip.linkGroupId === 'string' ? clip.linkGroupId.trim() : null
const absoluteTransitionFields = ['startTime', 'endTime', 'editPoint', 'originalClipAStart', 'originalClipAEnd', 'originalClipBStart', 'originalClipBEnd']

/** Close a genuinely empty interval across the whole timeline, never cut media.
 * Planning is read-only. Every downstream clip participates, including muted,
 * hidden and unlinked material; unsafe participants refuse the complete edit. */
export function planCloseTimelineGap({ clips, tracks, transitions = [], gap, fps = 24 } = {}) {
  if (!Array.isArray(clips) || !Array.isArray(tracks) || !Array.isArray(transitions)
    || !positive(fps) || fps < 1 || !gap || typeof gap.trackId !== 'string') {
    return fail('invalid-gap', 'Select an empty timeline gap to close.')
  }
  const startFrame = frameAt(gap.startTime, fps), endFrame = frameAt(gap.endTime, fps)
  if (startFrame === null || endFrame === null || endFrame <= startFrame) {
    return fail('invalid-gap', 'Select a gap with valid frame-aligned boundaries.')
  }
  const start = startFrame / fps, end = endFrame / fps, deltaFrames = endFrame - startFrame
  const deltaSeconds = deltaFrames / fps
  const trackById = new Map(), clipById = new Map()
  for (const track of tracks) {
    if (typeof track?.id !== 'string' || !track.id || trackById.has(track.id)) {
      return fail('invalid-track', 'The timeline contains missing or ambiguous tracks.')
    }
    trackById.set(track.id, track)
  }
  const selectedTrack = trackById.get(gap.trackId)
  if (!selectedTrack) return fail('stale-gap', 'The selected gap no longer exists. Select it again.')
  if (isCompoundLocked(selectedTrack)) return fail('locked-track', 'Unlock the selected gap’s track before closing the gap.')

  for (const clip of clips) {
    if (typeof clip?.id !== 'string' || !clip.id || clipById.has(clip.id) || !trackById.has(clip.trackId)
      || !finite(clip.startTime) || clip.startTime < 0 || !positive(clip.duration)
      || !finite(clip.startTime + clip.duration)) {
      return fail('invalid-clip', 'A timeline clip has missing, ambiguous or invalid timing. Repair it before closing the gap.')
    }
    if (clip.linkGroupId != null && typeof clip.linkGroupId !== 'string') {
      return fail('invalid-link', 'A clip has an invalid linked group. Repair its link before closing the gap.')
    }
    clipById.set(clip.id, clip)
    if (clip.startTime < end - EPSILON && clip.startTime + clip.duration > start + EPSILON) {
      if (clip.trackId === gap.trackId) return fail('stale-gap', 'The selected gap now contains a clip. Select an empty gap again.')
      const track = trackById.get(clip.trackId)
      return fail('occupied-range', `Cannot close this gap: “${clip.name || clip.id}” on “${track.name || track.id}” occupies the same time. No clips were moved.`)
    }
  }

  // Recheck both neighboring boundaries, not just emptiness: a selection made
  // before a trim/move must not remove a stale subset of a different gap.
  let previousEnd = 0, nextStart = Infinity
  for (const clip of clips) if (clip.trackId === gap.trackId) {
    const clipEnd = clip.startTime + clip.duration
    if (clipEnd <= start + EPSILON) previousEnd = Math.max(previousEnd, clipEnd)
    if (clip.startTime >= end - EPSILON) nextStart = Math.min(nextStart, clip.startTime)
  }
  if (Math.abs(previousEnd - start) > EPSILON || Math.abs(nextStart - end) > EPSILON) {
    return fail('stale-gap', 'The selected gap changed or has no following clip. Select it again.')
  }

  const shiftedIds = new Set(), affectedTrackIds = new Set()
  for (const clip of clips) if (clip.startTime >= end - EPSILON) {
    const track = trackById.get(clip.trackId)
    if (isCompoundLocked(clip) || isCompoundLocked(track)) {
      return fail('locked-participant', `Cannot close this gap: “${clip.name || clip.id}” or its track is locked. Unlock it first; no clips were moved.`)
    }
    if (isCompoundCacheBusy(clip)) return fail('busy-participant', 'Wait for affected clip render jobs to finish before closing the gap.')
    if (frameAt(clip.startTime, fps) === null) return fail('invalid-timing', 'A following clip is not frame-aligned. Repair its timing before closing the gap.')
    shiftedIds.add(clip.id)
    affectedTrackIds.add(clip.trackId)
  }
  const movingLinkIds = new Set(clips.filter(clip => shiftedIds.has(clip.id)).map(linkId).filter(Boolean))
  if (clips.some(clip => !shiftedIds.has(clip.id) && movingLinkIds.has(linkId(clip)))) {
    return fail('partial-link', 'A linked group spans both sides of this gap. Unlink or adjust it before closing the gap; no clips were moved.')
  }

  const transitionIdCounts = new Map(), movingTransitions = new Set()
  for (const transition of transitions) transitionIdCounts.set(transition?.id, (transitionIdCounts.get(transition?.id) || 0) + 1)
  for (const transition of transitions) {
    const refs = [...new Set([transition?.clipId, transition?.clipAId, transition?.clipBId].filter(Boolean))]
    if (!refs.length) return fail('invalid-transition', 'A transition has no clip relationship. Repair it before closing the gap.')
    if (!refs.some(id => shiftedIds.has(id))) continue
    const edge = transition.kind === 'edge'
    if (typeof transition.id !== 'string' || !transition.id || transitionIdCounts.get(transition.id) !== 1
      || ![undefined, 'between', 'edge'].includes(transition.kind) || !positive(transition.duration)
      || refs.some(id => !clipById.has(id))
      || (edge ? refs.length !== 1 || !transition.clipId || transition.clipAId != null || transition.clipBId != null || !['in', 'out'].includes(transition.edge)
        : refs.length !== 2 || transition.clipId != null || !transition.clipAId || !transition.clipBId
          || clipById.get(transition.clipAId)?.trackId !== clipById.get(transition.clipBId)?.trackId)) {
      return fail('invalid-transition', 'An affected transition is malformed. Repair it before closing the gap.')
    }
    if (refs.some(id => !shiftedIds.has(id))) return fail('partial-transition', 'A transition connects both sides of the gap. Remove it before closing the gap.')
    for (const field of absoluteTransitionFields) if (transition[field] != null) {
      if (!finite(transition[field]) || transition[field] - deltaSeconds < -EPSILON) {
        return fail('invalid-transition-time', 'An affected transition cannot move safely. Repair it before closing the gap.')
      }
    }
    movingTransitions.add(transition)
  }

  const nextClips = clips.map(clip => shiftedIds.has(clip.id)
    ? { ...clip, startTime: (frameAt(clip.startTime, fps) - deltaFrames) / fps } : clip)
  const nextTransitions = movingTransitions.size ? transitions.map(transition => {
    if (!movingTransitions.has(transition)) return transition
    const next = { ...transition }
    for (const field of absoluteTransitionFields) if (transition[field] != null) next[field] = Math.max(0, transition[field] - deltaSeconds)
    return next
  }) : transitions
  return { ok: true, changed: true, clips: nextClips, transitions: nextTransitions, deltaFrames, deltaSeconds,
    shiftedClipIds: [...shiftedIds], affectedTrackIds: [...affectedTrackIds] }
}
