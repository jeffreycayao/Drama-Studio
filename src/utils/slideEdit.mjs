import { resolveRollEditFrameDelta } from './rollEditPreview.mjs'
import { getTrimPreviewTimelineTime } from './trimPreview.mjs'
import { isCompoundLocked, isCompoundCacheBusy } from './compoundDocument.mjs'
import { validateAudioVolumeEnvelope, shiftAudioVolumeEnvelope } from './audioVolumeEnvelope.mjs'

const EPSILON = 1e-7
const finite = value => typeof value === 'number' && Number.isFinite(value)
const positive = value => finite(value) && value > 0
const fail = reason => ({ ok: false, changed: false, reason })
const generators = new Set(['image', 'text', 'shape', 'adjustment'])
const supported = new Set([...generators, 'video', 'audio'])
const caption = value => value?.role === 'captions' || value?.overlayKind === 'captions' || value?.captionScope
  || value?.settings?.overlayKind === 'captions' || value?.settings?.captionScope || value?.metadata?.captionScope
const populated = value => value != null && (typeof value !== 'object' || Object.keys(value).length > 0)
const onFrame = (value, fps) => finite(value) && Number.isSafeInteger(Math.round(value * fps))
  && Math.abs(value * fps - Math.round(value * fps)) <= EPSILON
const validTiming = (clip, fps) => clip && typeof clip === 'object' && finite(clip.startTime) && clip.startTime >= 0 && positive(clip.duration)
  && onFrame(clip.startTime, fps) && onFrame(clip.duration, fps) && onFrame(clip.startTime + clip.duration, fps)
  && Math.round(clip.duration * fps) >= 1
const close = (a, b) => finite(a) && finite(b) && Math.abs(a - b) <= EPSILON

function readClock(clip) {
  if (populated(clip.keyframes?.speed) || populated(clip.speedRamp) || populated(clip.timeRemap)) {
    return fail('Slide does not support speed ramps or time remapping yet.')
  }
  if (clip.reverse != null && typeof clip.reverse !== 'boolean') return fail('A clip has an invalid reverse setting.')
  for (const key of ['speed', 'sourceTimeScale', 'timelineFps', 'sourceFps']) {
    if (clip[key] != null && !positive(clip[key])) return fail('A clip has an invalid source clock or speed.')
  }
  const baseScale = clip.sourceTimeScale ?? (clip.timelineFps && clip.sourceFps ? clip.timelineFps / clip.sourceFps : 1)
  const scale = baseScale * (clip.speed ?? 1)
  if (!positive(scale)) return fail('A clip has an unsupported source clock.')
  // Ordinary video is canonicalized to source scale 1 on project load. Do not
  // author a Slide whose source samples would change when the project reopens.
  if (clip.type === 'video' && Math.abs(baseScale - 1) > EPSILON) return fail('This video uses older source timing. Reopen the project and check this clip’s timing before using Slide.')
  const trimStart = clip.trimStart ?? 0
  if (!finite(trimStart) || trimStart < 0) return fail('A clip has an invalid source In point.')
  if (generators.has(clip.type)) return { ok: true, generator: true, scale, trimStart, sourceEnd: Infinity }
  if (!positive(clip.sourceDuration)) return fail('Reload this clip’s media metadata to establish its source duration before using Slide.')
  const trimEnd = clip.trimEnd ?? clip.sourceDuration
  if (!positive(trimEnd) || trimEnd <= trimStart || trimEnd > clip.sourceDuration + EPSILON) return fail('A media clip needs valid source In and Out points before using Slide.')
  const span = clip.duration * scale
  if (!positive(span) || Math.abs(trimEnd - trimStart - span) > EPSILON * Math.max(1, span)) {
    return fail('This clip’s source timing does not match its length. Restore a normal constant-speed trim before using Slide.')
  }
  return { ok: true, generator: false, scale, trimStart, trimEnd, sourceEnd: clip.sourceDuration }
}

/** Read-only, one-level Slide validation. Neighbors must be distinct, touching
 * and unambiguous. The store keeps this original session private throughout a
 * cumulative gesture so repeated moves cannot accumulate trim/envelope drift. */
export function createSlideEditSession({ clips, tracks, transitions = [], clipId, fps = 24 } = {}) {
  if (!Array.isArray(clips) || !Array.isArray(tracks) || !Array.isArray(transitions)
    || typeof clipId !== 'string' || !clipId || !positive(fps) || fps < 1) return fail('Choose one clip with a touching neighbor on each side to use Slide.')
  const matches = clips.filter(clip => clip?.id === clipId)
  if (matches.length !== 1) return fail('The Slide target is missing or ambiguous. Select the clip again.')
  const middle = matches[0]
  if (typeof middle.trackId !== 'string' || !middle.trackId) return fail('The Slide clip needs a valid track identity.')
  const trackMatches = tracks.filter(track => track?.id === middle.trackId)
  if (trackMatches.length !== 1 || !['video', 'audio'].includes(trackMatches[0].type) || caption(trackMatches[0])) return fail('Slide needs a normal video or audio track.')
  const track = trackMatches[0]
  const lane = clips.filter(clip => clip?.trackId === middle.trackId)
  if (lane.some(clip => !finite(clip.startTime) || clip.startTime < 0 || !positive(clip.duration)
    || !finite(clip.startTime + clip.duration))) return fail('Resolve invalid clip timing on this track before using Slide.')
  const before = lane.filter(clip => clip !== middle && close(clip.startTime + clip.duration, middle.startTime))
  const after = lane.filter(clip => clip !== middle && close(clip.startTime, middle.startTime + middle.duration))
  if (before.length !== 1 || after.length !== 1 || before[0] === after[0]) return fail('Slide needs one touching neighbor on each side, without gaps or ambiguous overlaps.')
  const previous = before[0], next = after[0], triplet = [previous, middle, next]
  const ids = triplet.map(clip => clip.id)
  if (new Set(ids).size !== 3 || ids.some(id => typeof id !== 'string' || !id || clips.filter(clip => clip?.id === id).length !== 1)) return fail('The Slide clips have missing or duplicate identities.')
  if (lane.some(clip => !triplet.includes(clip) && clip.startTime < next.startTime + next.duration - EPSILON
    && clip.startTime + clip.duration > previous.startTime + EPSILON)) return fail('Another clip overlaps this group. Resolve the overlap before using Slide.')
  for (const clip of triplet) {
    if (!validTiming(clip, fps)) return fail('All three clips must have valid frame-aligned timing and at least one frame before using Slide.')
    if (!supported.has(clip.type) || clip.compound || caption(clip)) return fail('Slide does not support compounds or captions. Open a compound to edit its ordinary layers.')
    if (track.type === 'audio' ? !['audio', 'video'].includes(clip.type) : clip.type === 'audio') return fail('A Slide clip is on an incompatible track.')
    if (isCompoundLocked(clip) || isCompoundLocked(track)) return fail('Unlock all three clips and their track before using Slide.')
    if (isCompoundCacheBusy(clip)) return fail('Wait for all three clip render jobs to finish before using Slide.')
    if (clip.linkGroupId && clips.some(other => other !== clip && other?.linkGroupId === clip.linkGroupId)) return fail('Unlink these clips before using Slide; linked mates cannot slide together yet.')
  }
  if (transitions.some(transition => [transition?.clipId, transition?.clipAId, transition?.clipBId].some(id => ids.includes(id)))) return fail('Remove transitions attached to these clips before using Slide.')
  const clockPrevious = readClock(previous), clockMiddle = readClock(middle), clockNext = readClock(next)
  for (const clock of [clockPrevious, clockMiddle, clockNext]) if (!clock.ok) return clock
  const envelope = validateAudioVolumeEnvelope(next.volumeEnvelope)
  if (!envelope.ok) return fail(envelope.reason)
  let minimumDelta = 1 / fps - previous.duration, maximumDelta = next.duration - 1 / fps
  let minimumLimit = { label: 'Previous clip minimum duration', clipId: previous.id }
  let maximumLimit = { label: 'Next clip minimum duration', clipId: next.id }
  if (!clockNext.generator) {
    const minimum = next.reverse ? -(clockNext.sourceEnd - clockNext.trimEnd) / clockNext.scale : -clockNext.trimStart / clockNext.scale
    if (minimum > minimumDelta) {
      minimumDelta = minimum
      minimumLimit = { label: next.reverse ? 'Next source end' : 'Next source start', clipId: next.id }
    }
  }
  if (!clockPrevious.generator) {
    const maximum = previous.reverse ? clockPrevious.trimStart / clockPrevious.scale : (clockPrevious.sourceEnd - clockPrevious.trimEnd) / clockPrevious.scale
    if (maximum < maximumDelta) {
      maximumDelta = maximum
      maximumLimit = { label: previous.reverse ? 'Previous source start' : 'Previous source end', clipId: previous.id }
    }
  }
  const bounds = { minimumDelta, maximumDelta, minimumLimit, maximumLimit }
  if (resolveRollEditFrameDelta({ requestedDelta: 0, ...bounds, fps }) !== 0) return fail('This group has no valid frame-aligned Slide range.')
  const session = { clipId, previousClipId: previous.id, nextClipId: next.id, originalStartTime: middle.startTime,
    originalDuration: middle.duration, snapExcludedClipIds: ids, previous, middle, next, clockPrevious, clockNext, clips, fps, bounds }
  return { ok: true, session, bounds }
}

/** Feedback uses the committed clips, never an unaccepted pointer proposal. */
export function buildSlideEditPreviewFeedback({ session, clips, requestedDelta } = {}) {
  if (!session || !Array.isArray(clips) || !positive(session.fps)) return null
  const { fps, bounds } = session
  const ids = [session.previousClipId, session.clipId, session.nextClipId]
  const matches = ids.map(id => clips.filter(clip => clip?.id === id))
  if (matches.some(items => items.length !== 1)) return null
  const [previous, middle, next] = matches.map(items => items[0])
  if ([previous, middle, next].some(clip => !validTiming(clip, fps))) return null
  const delta = middle.startTime - session.originalStartTime
  if (!onFrame(delta, fps) || middle.duration !== session.originalDuration
    || previous.startTime !== session.previous.startTime || !close(previous.duration, session.previous.duration + delta)
    || !close(next.startTime, session.next.startTime + delta) || !close(next.duration, session.next.duration - delta)
    || !close(previous.startTime + previous.duration, middle.startTime)
    || !close(middle.startTime + middle.duration, next.startTime)
    || !close(next.startTime + next.duration, session.next.startTime + session.next.duration)) return null
  // Only middle placement may change. This also protects preview consumers from
  // accidentally showing a source/slip edit as a Slide result.
  if (Object.keys(middle).length !== Object.keys(session.middle).length
    || Object.keys(session.middle).some(key => key !== 'startTime' && middle[key] !== session.middle[key])) return null
  let limit = null
  if (finite(requestedDelta) && Math.abs(requestedDelta) > EPSILON) {
    for (const side of ['minimum', 'maximum']) {
      const bound = bounds?.[`${side}Delta`], label = bounds?.[`${side}Limit`]
      if (!finite(bound) || !label || !ids.includes(label.clipId) || typeof label.label !== 'string' || !label.label.trim()) continue
      const attempted = side === 'minimum' ? requestedDelta <= bound + EPSILON : requestedDelta >= bound - EPSILON
      const acceptedBound = resolveRollEditFrameDelta({ requestedDelta: bound, ...bounds, fps })
      if (attempted && acceptedBound !== null && close(delta, acceptedBound)) { limit = { ...label }; break }
    }
  }
  return { outgoing: { clipId: previous.id, clip: previous, edge: 'right', timelineTime: getTrimPreviewTimelineTime(previous, 'right', fps), duration: previous.duration },
    incoming: { clipId: next.id, clip: next, edge: 'left', timelineTime: getTrimPreviewTimelineTime(next, 'left', fps), duration: next.duration },
    middle: { clipId: middle.id, clip: middle, startTime: middle.startTime, duration: middle.duration },
    deltaFrames: Math.round(delta * fps) || 0, limit }
}

/** One frame quantization and one three-clip plan. Full-bake/source cache
 * descriptors remain attached; existing signatures and coverage guards decide
 * freshness, including reuse after returning to origin or Undo. */
export function planSlideEdit({ session, requestedDelta } = {}) {
  if (!session?.clockPrevious?.ok || !session.clockNext?.ok || !Array.isArray(session.clips)) return fail('Start a new Slide gesture before moving this clip.')
  const { previous, middle, next, clockPrevious, clockNext, fps, bounds } = session
  const delta = resolveRollEditFrameDelta({ requestedDelta, ...bounds, fps })
  if (delta === null) return fail('This pointer position has no valid frame-aligned Slide delta.')
  let clips = session.clips
  if (delta !== 0) {
    const frames = Math.round(delta * fps)
    const durationPrevious = (Math.round(previous.duration * fps) + frames) / fps
    const durationNext = (Math.round(next.duration * fps) - frames) / fps
    const trimPrevious = clockPrevious.generator
      ? { trimStart: clockPrevious.trimStart, trimEnd: clockPrevious.trimStart + durationPrevious * clockPrevious.scale }
      : previous.reverse
        ? { trimStart: Math.max(0, clockPrevious.trimStart - delta * clockPrevious.scale), trimEnd: clockPrevious.trimEnd }
        : { trimStart: clockPrevious.trimStart, trimEnd: Math.min(clockPrevious.sourceEnd, clockPrevious.trimEnd + delta * clockPrevious.scale) }
    const trimNext = clockNext.generator
      ? { trimStart: clockNext.trimStart, trimEnd: clockNext.trimStart + durationNext * clockNext.scale }
      : next.reverse
        ? { trimStart: clockNext.trimStart, trimEnd: Math.min(clockNext.sourceEnd, clockNext.trimEnd - delta * clockNext.scale) }
        : { trimStart: Math.max(0, clockNext.trimStart + delta * clockNext.scale), trimEnd: clockNext.trimEnd }
    const updatedPrevious = { ...previous, duration: durationPrevious, ...trimPrevious }
    const updatedMiddle = { ...middle, startTime: (Math.round(middle.startTime * fps) + frames) / fps }
    const updatedNext = { ...next, startTime: (Math.round(next.startTime * fps) + frames) / fps, duration: durationNext, ...trimNext }
    if (next.volumeEnvelope != null) {
      if (!finite(next.volumeEnvelope.offsetSeconds + delta)) return fail('The volume envelope offset is outside the supported time range.')
      updatedNext.volumeEnvelope = shiftAudioVolumeEnvelope(next, delta)
    }
    if ([updatedPrevious, updatedMiddle, updatedNext].some(clip => !validTiming(clip, fps))) return fail('The Slide timing exceeds the supported frame range.')
    if ([updatedPrevious, updatedNext].some(clip => !finite(clip.trimStart) || clip.trimStart < 0 || !positive(clip.trimEnd) || clip.trimEnd <= clip.trimStart)) return fail('The source bounds cannot represent this Slide safely.')
    clips = session.clips.map(clip => clip === previous ? updatedPrevious : clip === middle ? updatedMiddle : clip === next ? updatedNext : clip)
  }
  const feedback = buildSlideEditPreviewFeedback({ session, clips, requestedDelta })
  if (!feedback) return fail('The resulting clips no longer form a valid frame-aligned Slide.')
  return { ok: true, changed: delta !== 0, clips, delta, bounds, feedback }
}
