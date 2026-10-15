import { shiftAudioVolumeEnvelope } from './audioVolumeEnvelope.mjs'

const EPSILON = 1e-7
const close = (a, b) => Math.abs(a - b) <= EPSILON
const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback
const finite = (value) => value != null && Number.isFinite(Number(value))
const groupOf = (clip) => typeof clip?.linkGroupId === 'string' ? clip.linkGroupId.trim() : ''
const fail = (reason, details = {}) => ({ ok: false, reason, ...details })
const clipLabel = (clip) => clip.name || clip.id
const endOf = (clip) => Number(clip.startTime) + Number(clip.duration)
const overlaps = (startA, endA, startB, endB) => startA < endB - EPSILON && endA > startB + EPSILON

const isLocked = (clip, track) => Boolean(
  track?.locked || track?.syncLocked || track?.lockMode === 'sync' || track?.syncLock?.mode === 'sync'
  || clip?.locked || clip?.syncLocked || clip?.lockMode === 'sync' || clip?.syncLock?.mode === 'sync'
)

const hasContent = (value) => {
  if (value == null || value === false) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.values(value).some(hasContent)
  return Boolean(value)
}

// Mask assets can contain frame sequences whose local timing is not carried by
// the clip. With no asset table in this pure planner, declining a partial edit
// is safer than restarting such a sequence on the retained right-hand piece.
const hasComplexTiming = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  if (['cameraShake', 'filmGrain', 'vhsDamage', 'glslCameraShake', 'glslDigitalGlitch', 'glslFilmGrain', 'glslFilmLook', 'glslFlicker', 'glslVhsLook'].includes(value.type)) return true
  return Object.entries(value).some(([key, child]) => (
    ((/^(keyframes|animation|animations|titleAnimation|speedRamp|timeRemap|maskAssetId|maskFrames)$/i.test(key)) && hasContent(child))
    || hasComplexTiming(child, seen)
  ))
}

const clearPieceCaches = (clip) => ({
  ...clip,
  cacheStatus: 'none',
  cacheProgress: 0,
  cacheUrl: null,
  cachePath: null,
  cacheKind: null,
  cacheSignature: null,
  // A new trim can expose different handles. Let the normal cache preparation
  // path revalidate/rebuild instead of inheriting possibly insufficient RIFE.
  opticalFlowCache: undefined,
})

function sourceBounds(clip) {
  const staticGenerator = ['image', 'text', 'shape', 'adjustment'].includes(clip.type)
  const baseScale = positive(clip.sourceTimeScale, (
    positive(clip.timelineFps, null) && positive(clip.sourceFps, null)
      ? Number(clip.timelineFps) / Number(clip.sourceFps) : 1
  ))
  const scale = baseScale * positive(clip.speed, 1)
  const trimStart = finite(clip.trimStart) ? Number(clip.trimStart) : 0
  const trimEnd = finite(clip.trimEnd)
    ? Number(clip.trimEnd)
    : (finite(clip.sourceDuration) ? Number(clip.sourceDuration) : trimStart + Number(clip.duration) * scale)
  if (!Number.isFinite(scale) || trimStart < 0 || trimEnd < trimStart - EPSILON) return null
  // A legacy clip which freezes against a short trim needs a piece-local
  // freeze mapping that the current clip contract cannot express exactly.
  if (!staticGenerator && trimEnd - trimStart + EPSILON < Number(clip.duration) * scale) return null
  if (!staticGenerator && positive(clip.sourceDuration, null) && trimEnd > Number(clip.sourceDuration) + EPSILON) return null
  return { trimStart, trimEnd, scale }
}

function sliceFades(clip, from, to) {
  const duration = Number(clip.duration)
  const fadeIn = Math.min(duration, Math.max(0, Number(clip.fadeIn) || 0))
  const fadeOut = Math.min(duration, Math.max(0, Number(clip.fadeOut) || 0))
  // The current envelope only describes fades that begin/end at a clip edge.
  // Cutting within either ramp would clamp/restart it and change the gain.
  if ((fadeIn > 0 && ((from > EPSILON && from < fadeIn - EPSILON) || (close(from, 0) && to < fadeIn - EPSILON)))
    || (fadeOut > 0 && ((to < duration - EPSILON && to > duration - fadeOut + EPSILON)
      || (close(to, duration) && from > duration - fadeOut + EPSILON)))) return null
  return {
    ...(clip.fadeIn != null ? { fadeIn: close(from, 0) ? fadeIn : 0 } : {}),
    ...(clip.fadeOut != null ? { fadeOut: close(to, duration) ? fadeOut : 0 } : {}),
  }
}

function describeEdit(clip, mode, start, end, duration, destinationIds) {
  const clipStart = Number(clip.startTime)
  const clipDuration = Number(clip.duration)
  const clipEnd = clipStart + clipDuration
  if (mode === 'insert') {
    if (clipEnd <= start + EPSILON) return { kind: 'keep' }
    if (clipStart >= start - EPSILON) return { kind: 'move', delta: duration }
    return { kind: 'slice', pieces: [
      { from: 0, to: start - clipStart, startTime: clipStart },
      { from: start - clipStart, to: clipDuration, startTime: start + duration },
    ] }
  }
  if (mode !== 'overwrite' || !destinationIds.has(clip.trackId) || !overlaps(clipStart, clipEnd, start, end)) return { kind: 'keep' }
  const pieces = []
  if (clipStart < start - EPSILON) pieces.push({ from: 0, to: start - clipStart, startTime: clipStart })
  if (clipEnd > end + EPSILON) pieces.push({ from: end - clipStart, to: clipDuration, startTime: end })
  return { kind: pieces.length ? 'slice' : 'remove', pieces }
}

function sameLinkedEdit(a, b) {
  if (a.kind !== b.kind) return false
  if (a.kind !== 'slice') return a.kind !== 'move' || close(a.delta, b.delta)
  return a.pieces.length === b.pieces.length && a.pieces.every((piece, i) => (
    close(piece.from, b.pieces[i].from) && close(piece.to, b.pieces[i].to) && close(piece.startTime, b.pieces[i].startTime)
  ))
}

function transitionRange(transition, beforeById) {
  const a = beforeById.get(transition.clipAId)
  const b = beforeById.get(transition.clipBId)
  const clip = beforeById.get(transition.clipId)
  const duration = Math.max(0, Number(transition.duration) || 0)
  if (transition.kind === 'edge' && clip) {
    return transition.edge === 'out'
      ? [endOf(clip) - duration, endOf(clip)]
      : [Number(clip.startTime), Number(clip.startTime) + duration]
  }
  if (!a || !b) return null
  const editPoint = finite(transition.editPoint) ? Number(transition.editPoint) : endOf(a)
  const rawSplit = transition.settings?.split || transition.split
  let portionA = transition.settings?.alignment === 'start' ? 1 : transition.settings?.alignment === 'end' ? 0 : 0.5
  if (finite(rawSplit?.clipA) && finite(rawSplit?.clipB)) {
    const total = Math.max(0, Number(rawSplit.clipA)) + Math.max(0, Number(rawSplit.clipB))
    if (total > 0) portionA = Math.max(0, Number(rawSplit.clipA)) / total
  }
  return [editPoint - duration * portionA, editPoint + duration * (1 - portionA)]
}

/**
 * Pure, atomic plan for the Source Viewer's explicit edit commands.
 *
 * The caller resolves source marks, frame-quantizes the edit, and builds fresh
 * destination clips. This planner never calls store actions, rewrites inputs,
 * deletes media/caches, or silently discards transitions. A rejected plan has
 * no replacement state; the caller must not checkpoint or write it.
 */
export function planSourceTimelineEdit({
  clips = [], tracks = [], transitions = [], markers = [], fps = 24,
  mode, startTime, duration, newClips = [], clipCounter = 1,
} = {}) {
  if (!['insert', 'overwrite', 'append'].includes(mode)) return fail('Choose Insert, Overwrite, or Append.')
  if (![clips, tracks, transitions, markers, newClips].every(Array.isArray)) return fail('Timeline data is invalid.')
  if (!newClips.length) return fail('No source clips are available for this edit.')
  const minimumDuration = 1 / positive(fps, 24)
  if (!finite(startTime) || Number(startTime) < 0 || !finite(duration) || Number(duration) < minimumDuration - EPSILON) {
    return fail('The source edit needs a valid position and at least one frame.')
  }
  const start = Number(startTime)
  const editDuration = Number(duration)
  const end = start + editDuration
  if (!Number.isFinite(end)) return fail('The source edit exceeds the timeline time range.')
  const trackById = new Map(tracks.map((track) => [track?.id, track]))
  if (tracks.some((track) => !track?.id) || trackById.size !== tracks.length) return fail('Resolve invalid or duplicate timeline tracks before editing.')
  const beforeById = new Map()
  for (const clip of clips) {
    if (!clip?.id || beforeById.has(clip.id) || !trackById.has(clip.trackId)
      || !finite(clip.startTime) || Number(clip.startTime) < 0 || !positive(clip.duration, null) || !Number.isFinite(endOf(clip))) {
      return fail('Resolve invalid or duplicate timeline clips before making this source edit.')
    }
    beforeById.set(clip.id, clip)
  }
  const usedIds = new Set(beforeById.keys())
  const destinationIds = new Set()
  const existingGroupIds = new Set(clips.map(groupOf).filter(Boolean))
  for (const clip of newClips) {
    const track = trackById.get(clip?.trackId)
    if (!track || !['video', 'audio'].includes(track.type) || track.role === 'captions'
      || !['video', 'image', 'audio'].includes(clip?.type) || (track.type === 'video' && clip.type === 'audio')
      || (track.type === 'audio' && clip.type !== 'audio')
      || clip?.overlayKind === 'captions' || clip?.captionScope || clip?.metadata?.captionScope) {
      return fail('Choose a normal video or audio destination track, not the captions track.')
    }
    if (isLocked(clip, track)) return fail(`Unlock ${track.name || track.id} before editing.`, { trackId: track.id })
    if (!clip.id || usedIds.has(clip.id)) return fail('New source clips need unique clip IDs.')
    if (!finite(clip.startTime) || !finite(clip.duration) || !close(Number(clip.startTime), start) || !close(Number(clip.duration), editDuration)) {
      return fail('The new source clips do not match the requested edit range.')
    }
    if (destinationIds.has(clip.trackId)) return fail('A source edit can add only one new clip per destination track.')
    if (groupOf(clip) && existingGroupIds.has(groupOf(clip))) return fail('New source clips need a fresh linked group.')
    usedIds.add(clip.id)
    destinationIds.add(clip.trackId)
  }

  if (mode === 'append') {
    const collision = clips.find((clip) => destinationIds.has(clip.trackId) && overlaps(Number(clip.startTime), endOf(clip), start, end))
    if (collision) return fail(`The append range overlaps ${clipLabel(collision)}.`, { clipId: collision.id })
  }
  const edits = new Map(clips.map((clip) => [clip.id, describeEdit(clip, mode, start, end, editDuration, destinationIds)]))
  for (const clip of clips) {
    const edit = edits.get(clip.id)
    if (edit.kind === 'keep') continue
    if (isLocked(clip, trackById.get(clip.trackId))) return fail(`Unlock ${clipLabel(clip)} and its track before editing.`, { clipId: clip.id, trackId: clip.trackId })
    if (edit.kind === 'move') {
      if (!Number.isFinite(endOf(clip) + editDuration)) return fail('The source edit exceeds the timeline time range.')
      continue
    }
    if (edit.kind !== 'slice') continue
    if (!['video', 'audio', 'image', 'text', 'shape', 'adjustment'].includes(clip.type) || clip.captions || hasComplexTiming(clip)) {
      return fail(`Cannot partially edit ${clipLabel(clip)} with animated, masked, or live-caption timing. Move the edit point outside the clip first.`, { clipId: clip.id })
    }
    edit.bounds = sourceBounds(clip)
    if (!edit.bounds) return fail(`Cannot preserve the source timing of ${clipLabel(clip)} in a partial edit.`, { clipId: clip.id })
    for (const piece of edit.pieces) {
      if (piece.to - piece.from < minimumDuration - EPSILON) return fail(`The edit would leave less than one frame of ${clipLabel(clip)}.`, { clipId: clip.id })
      piece.fades = sliceFades(clip, piece.from, piece.to)
      if (!piece.fades) return fail(`The edit crosses an audio fade on ${clipLabel(clip)}. Move the edit point outside the fade first.`, { clipId: clip.id })
    }
  }

  const groups = new Map()
  for (const clip of clips) {
    const groupId = groupOf(clip)
    if (groupId) groups.set(groupId, [...(groups.get(groupId) || []), clip])
  }
  for (const members of groups.values()) {
    const changed = members.find((clip) => edits.get(clip.id).kind !== 'keep')
    if (!changed) continue
    if (mode === 'overwrite' && members.some((clip) => !destinationIds.has(clip.trackId))) {
      return fail('Overwrite would partially edit a linked group on other tracks. Unlink it or target all linked tracks first.', { clipId: changed.id })
    }
    if (members.some((clip) => !sameLinkedEdit(edits.get(changed.id), edits.get(clip.id)))) {
      return fail('This edit would change linked clips differently. Unlink the group or choose an aligned edit point first.', { clipId: changed.id })
    }
  }

  const nextTransitions = []
  for (const transition of transitions) {
    if (!transition || typeof transition !== 'object') return fail('Resolve invalid timeline transitions before editing.')
    const references = [...new Set([transition?.clipId, transition?.clipAId, transition?.clipBId].filter(Boolean))]
    const referencedClips = references.map((id) => beforeById.get(id)).filter(Boolean)
    const involved = references.map((id) => edits.get(id) || { kind: 'missing' })
    const changed = involved.some((edit) => !['keep', 'missing'].includes(edit.kind))
    const range = transitionRange(transition, beforeById)
    const relevant = mode === 'insert' || referencedClips.some((clip) => destinationIds.has(clip.trackId))
    const touchesRange = range && relevant && (mode === 'insert'
      ? start >= range[0] - EPSILON && start <= range[1] + EPSILON
      : mode === 'append'
        ? overlaps(start, end, range[0], range[1])
        : end >= range[0] - EPSILON && start <= range[1] + EPSILON)
    if (touchesRange || (changed && involved.some((edit) => edit.kind !== 'move'))) {
      return fail('The source edit touches a transition relationship. Move the edit range outside the transition clips first.', { transitionId: transition?.id })
    }
    if (!changed) {
      nextTransitions.push(transition)
      continue
    }
    const shifted = { ...transition }
    for (const field of ['startTime', 'endTime', 'editPoint', 'originalClipAStart', 'originalClipAEnd', 'originalClipBStart', 'originalClipBEnd']) {
      if (finite(transition[field])) shifted[field] = Number(transition[field]) + editDuration
    }
    nextTransitions.push(shifted)
  }

  let nextCounter = Math.max(1, Math.floor(positive(clipCounter, 1)))
  for (const id of usedIds) {
    const match = /^clip-(\d+)$/.exec(String(id))
    if (match && Number.isSafeInteger(Number(match[1]))) nextCounter = Math.max(nextCounter, Number(match[1]) + 1)
  }
  if (!Number.isSafeInteger(nextCounter)) return fail('The timeline clip ID range is exhausted.')
  const allocateId = () => {
    while (usedIds.has(`clip-${nextCounter}`)) nextCounter += 1
    const id = `clip-${nextCounter++}`
    usedIds.add(id)
    return id
  }
  const usedGroups = new Set([...existingGroupIds, ...newClips.map(groupOf).filter(Boolean)])
  const splitGroups = new Map()
  const splitGroupFor = (clip, id) => {
    const original = groupOf(clip)
    if (!original) return null
    if (!splitGroups.has(original)) {
      let group = `link-source-split-${id}`
      while (usedGroups.has(group)) group += '-split'
      usedGroups.add(group)
      splitGroups.set(original, group)
    }
    return splitGroups.get(original)
  }
  const nextClips = []
  const rightPieceByOriginalId = new Map()
  const changedClipIds = new Set()
  const removedClipIds = []
  const splitClipIds = []
  const addedClipIds = newClips.map((clip) => clip.id)
  const affectedTrackIds = new Set(destinationIds)
  for (const clip of clips) {
    const edit = edits.get(clip.id)
    if (edit.kind === 'keep') {
      nextClips.push(clip)
      continue
    }
    changedClipIds.add(clip.id)
    affectedTrackIds.add(clip.trackId)
    if (edit.kind === 'remove') {
      removedClipIds.push(clip.id)
      continue
    }
    if (edit.kind === 'move') {
      nextClips.push({ ...clip, startTime: Number(clip.startTime) + edit.delta })
      continue
    }
    for (const [index, piece] of edit.pieces.entries()) {
      const id = index === 0 ? clip.id : allocateId()
      const { trimStart, trimEnd, scale } = edit.bounds
      const sliced = clearPieceCaches({
        ...clip,
        id,
        startTime: piece.startTime,
        duration: piece.to - piece.from,
        trimStart: clip.reverse ? trimEnd - piece.to * scale : trimStart + piece.from * scale,
        trimEnd: clip.reverse ? trimEnd - piece.from * scale : trimStart + piece.to * scale,
        ...piece.fades,
        ...(clip.volumeEnvelope != null ? { volumeEnvelope: shiftAudioVolumeEnvelope(clip, piece.from) } : {}),
      })
      if (index > 0) {
        const splitGroup = splitGroupFor(clip, id)
        if (splitGroup) sliced.linkGroupId = splitGroup
        splitClipIds.push(id)
        addedClipIds.push(id)
        rightPieceByOriginalId.set(clip.id, sliced)
      }
      changedClipIds.add(id)
      nextClips.push(sliced)
    }
  }
  // Embedded-audio metadata also references its paired video independently of
  // linkGroupId. Point retained right-hand mates at the new right-hand IDs,
  // leaving the original left metadata untouched.
  for (const piece of rightPieceByOriginalId.values()) {
    for (const field of ['linkedVideoClipId', 'linkedAudioClipId']) {
      const paired = rightPieceByOriginalId.get(piece.metadata?.[field])
      if (paired) piece.metadata = { ...piece.metadata, [field]: paired.id }
    }
  }
  for (const clip of newClips) {
    nextClips.push(clearPieceCaches(clip))
    changedClipIds.add(clip.id)
  }
  const nextMarkers = mode === 'insert'
    ? markers.map((marker) => finite(marker?.time) && Number(marker.time) >= start - EPSILON
      ? { ...marker, time: Number(marker.time) + editDuration } : marker)
    : markers
  return {
    ok: true, mode, startTime: start, duration: editDuration, endTime: end,
    clips: nextClips, transitions: nextTransitions, markers: nextMarkers,
    clipCounter: nextCounter, affectedTrackIds: [...affectedTrackIds],
    changedClipIds: [...changedClipIds], addedClipIds, removedClipIds, splitClipIds,
  }
}
