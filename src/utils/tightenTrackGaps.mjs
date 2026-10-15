import { isCompoundLocked, isCompoundCacheBusy } from './compoundDocument.mjs'

// Shorten the pauses between clips on ONE track (e.g. a dialogue track), keeping
// a small breath between lines. Unlike planCloseTimelineGap this does not ripple
// every track: only clips on the chosen track and their linked partners move.
// Planning is read-only; anything unsafe refuses the whole edit.

const EPSILON = 1e-6
const finite = value => typeof value === 'number' && Number.isFinite(value)
const fail = (code, reason, extra = {}) => ({ ok: false, changed: false, code, reason, ...extra })
const linkId = clip => (typeof clip?.linkGroupId === 'string' && clip.linkGroupId.trim()) || null
const absoluteTransitionFields = ['startTime', 'endTime', 'editPoint', 'originalClipAStart', 'originalClipAEnd', 'originalClipBStart', 'originalClipBEnd']

/** Resolve "Track 1", "Audio 1", a track id, or a 1-based number to one track. */
export function resolveTimelineTrack(tracks = [], ref) {
  const list = Array.isArray(tracks) ? tracks.filter(track => track && typeof track.id === 'string') : []
  const raw = String(ref ?? '').trim()
  if (!raw) return { ok: false, reason: 'Provide trackId or track (for example "Audio 1").', candidates: list }
  const byId = list.find(track => track.id === raw)
  if (byId) return { ok: true, track: byId }
  const lower = raw.toLowerCase()
  const byName = list.filter(track => String(track.name || '').trim().toLowerCase() === lower)
  if (byName.length === 1) return { ok: true, track: byName[0] }
  const number = lower.match(/^(?:track\s*|t)?(\d+)$/)
  if (number) {
    const n = Number(number[1])
    const named = list.filter(track => new RegExp(`(?:^|\\D)${n}$`).test(String(track.name || '').trim()))
    if (named.length === 1) return { ok: true, track: named[0] }
    const options = named.length ? named : list
    return {
      ok: false,
      reason: `"${raw}" is ambiguous. Pick one of: ${options.map(track => `${track.name || track.id} (${track.id}, ${track.type})`).join('; ')}.`,
      candidates: options,
    }
  }
  return { ok: false, reason: `Track "${raw}" was not found.`, candidates: list }
}

export function planTightenTrackGaps({
  clips, tracks, transitions = [], trackId, fps = 24,
  keepGapSeconds = 0.25, minGapSeconds, startSeconds, endSeconds,
} = {}) {
  if (!Array.isArray(clips) || !Array.isArray(tracks) || !Array.isArray(transitions) || !finite(fps) || fps < 1) {
    return fail('invalid-input', 'The timeline could not be read.')
  }
  const track = tracks.find(item => item?.id === trackId)
  if (!track) return fail('invalid-track', `Track "${trackId}" was not found.`)
  if (isCompoundLocked(track)) return fail('locked-track', `Unlock "${track.name || track.id}" before tightening its pauses.`)

  const keep = Math.max(0, finite(Number(keepGapSeconds)) ? Number(keepGapSeconds) : 0.25)
  const threshold = Math.max(keep, finite(Number(minGapSeconds)) ? Number(minGapSeconds) : keep)
  const keepFrames = Math.round(keep * fps)
  const thresholdFrames = Math.round(threshold * fps)
  const rangeStart = finite(Number(startSeconds)) ? Number(startSeconds) : -Infinity
  const rangeEnd = finite(Number(endSeconds)) ? Number(endSeconds) : Infinity
  const frame = time => Math.round(time * fps)

  const trackClips = clips
    .filter(clip => clip?.trackId === trackId)
    .filter(clip => finite(clip.startTime) && finite(clip.duration) && clip.duration > 0)
    .sort((a, b) => a.startTime - b.startTime)
  if (trackClips.length < 2) return fail('nothing-to-tighten', `"${track.name || track.id}" needs at least two clips to tighten the pauses between them.`)

  // Walk the track; every clip after a long gap (and everything after it) moves left.
  const shiftFrames = new Map()
  const gaps = []
  let accumulated = 0
  let previousEnd = frame(trackClips[0].startTime + trackClips[0].duration)
  let previousClip = trackClips[0]
  shiftFrames.set(trackClips[0].id, 0)
  for (const clip of trackClips.slice(1)) {
    const start = frame(clip.startTime)
    const gapFrames = start - previousEnd
    const inRange = clip.startTime >= rangeStart - EPSILON && previousEnd / fps <= rangeEnd + EPSILON
    if (inRange && gapFrames > thresholdFrames) {
      const removed = gapFrames - keepFrames
      gaps.push({
        afterClipId: previousClip.id,
        beforeClipId: clip.id,
        startTime: previousEnd / fps,
        originalSeconds: gapFrames / fps,
        newSeconds: keepFrames / fps,
        removedSeconds: removed / fps,
      })
      accumulated += removed
    }
    shiftFrames.set(clip.id, accumulated)
    const end = frame(clip.startTime + clip.duration)
    if (end > previousEnd) { previousEnd = end; previousClip = clip }
  }
  if (!gaps.length) {
    return { ok: true, changed: false, gaps: [], removedSeconds: 0, shiftedClipIds: [], track: { id: track.id, name: track.name },
      reason: `No pauses longer than ${threshold.toFixed(2)}s were found on "${track.name || track.id}".` }
  }

  // Linked partners (picture/sound pairs) move with their clip on this track.
  const groupShift = new Map()
  for (const clip of trackClips) {
    const group = linkId(clip)
    if (!group) continue
    const shift = shiftFrames.get(clip.id)
    if (groupShift.has(group) && groupShift.get(group) !== shift) {
      return fail('split-link', `A linked group spans a pause on "${track.name || track.id}". Unlink it first; nothing was moved.`)
    }
    groupShift.set(group, shift)
  }
  const trackById = new Map(tracks.map(item => [item.id, item]))
  for (const clip of clips) {
    if (clip.trackId === trackId) continue
    const group = linkId(clip)
    if (group && groupShift.has(group)) shiftFrames.set(clip.id, groupShift.get(group))
  }

  const moving = clips.filter(clip => (shiftFrames.get(clip.id) || 0) > 0)
  for (const clip of moving) {
    const owner = trackById.get(clip.trackId)
    if (isCompoundLocked(clip) || isCompoundLocked(owner)) {
      return fail('locked-participant', `"${clip.name || clip.id}" or its track is locked. Unlock it first; nothing was moved.`)
    }
    if (isCompoundCacheBusy(clip)) return fail('busy-participant', 'Wait for clip render jobs to finish before tightening pauses.')
    if (frame(clip.startTime) - shiftFrames.get(clip.id) < 0) return fail('invalid-timing', 'A clip would move before the start of the timeline.')
  }

  const nextClips = clips.map(clip => {
    const shift = shiftFrames.get(clip.id) || 0
    return shift > 0 ? { ...clip, startTime: (frame(clip.startTime) - shift) / fps } : clip
  })

  // Linked partners on other tracks must not land on top of unrelated clips.
  const otherTrackIds = new Set(moving.filter(clip => clip.trackId !== trackId).map(clip => clip.trackId))
  for (const otherTrackId of otherTrackIds) {
    const onTrack = nextClips.filter(clip => clip.trackId === otherTrackId).sort((a, b) => a.startTime - b.startTime)
    for (let i = 1; i < onTrack.length; i += 1) {
      const prev = onTrack[i - 1], next = onTrack[i]
      if (!shiftFrames.get(prev.id) && !shiftFrames.get(next.id)) continue
      if (next.startTime < prev.startTime + prev.duration - EPSILON) {
        const other = trackById.get(otherTrackId)
        return fail('linked-collision', `Moving linked clips would overlap "${(shiftFrames.get(prev.id) ? next : prev).name || next.id}" on "${other?.name || otherTrackId}". Nothing was moved.`)
      }
    }
  }

  const nextTransitions = []
  for (const transition of transitions) {
    const refs = [...new Set([transition?.clipId, transition?.clipAId, transition?.clipBId].filter(Boolean))]
    const shifts = new Set(refs.map(id => shiftFrames.get(id) || 0))
    if (shifts.size > 1) return fail('partial-transition', 'A transition connects clips that would move by different amounts. Remove it first; nothing was moved.')
    const shift = shifts.size ? [...shifts][0] : 0
    if (!shift) { nextTransitions.push(transition); continue }
    const next = { ...transition }
    for (const field of absoluteTransitionFields) if (finite(transition[field])) next[field] = Math.max(0, transition[field] - shift / fps)
    nextTransitions.push(next)
  }

  const removedFrames = gaps.reduce((sum, gap) => sum + Math.round(gap.removedSeconds * fps), 0)
  return {
    ok: true,
    changed: true,
    clips: nextClips,
    transitions: nextTransitions,
    gaps,
    removedSeconds: removedFrames / fps,
    shiftedClipIds: moving.map(clip => clip.id),
    track: { id: track.id, name: track.name, type: track.type },
    keepGapSeconds: keepFrames / fps,
  }
}
