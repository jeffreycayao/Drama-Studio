import { buildRollEditPreviewFeedback, resolveRollEditFrameDelta } from './rollEditPreview.mjs'
import { isCompoundLocked, isCompoundCacheBusy } from './compoundDocument.mjs'
import { shiftAudioVolumeEnvelope, validateAudioVolumeEnvelope } from './audioVolumeEnvelope.mjs'

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

function readClock(clip) {
  if (populated(clip.keyframes?.speed) || populated(clip.speedRamp) || populated(clip.timeRemap)) {
    return fail('Rolling edits do not support speed ramps or time remapping yet.')
  }
  if (clip.reverse != null && typeof clip.reverse !== 'boolean') return fail('A clip has an invalid reverse setting.')
  for (const key of ['speed', 'sourceTimeScale', 'timelineFps', 'sourceFps']) {
    if (clip[key] != null && !positive(clip[key])) return fail('A clip has an invalid source clock or speed.')
  }
  const baseScale = clip.sourceTimeScale ?? (clip.timelineFps && clip.sourceFps ? clip.timelineFps / clip.sourceFps : 1)
  const scale = baseScale * (clip.speed ?? 1)
  if (!positive(scale)) return fail('A clip has an unsupported source clock.')
  // The current project loader canonicalizes ordinary video to source scale 1.
  // Do not author a roll whose retained source samples would change on reload.
  if (clip.type === 'video' && Math.abs(baseScale - 1) > EPSILON) return fail('This video uses older source timing. Reopen the project and check this clip’s timing before rolling.')
  if (clip.type === 'video' && !positive(clip.sourceDuration)) return fail('Reload this video’s media metadata to establish its source duration before rolling.')
  const trimStart = clip.trimStart ?? 0
  if (!finite(trimStart) || trimStart < 0) return fail('A clip has an invalid source In point.')
  const generator = generators.has(clip.type)
  if (generator) return { ok: true, generator, scale, trimStart, sourceEnd: Infinity }
  const trimEnd = clip.trimEnd ?? clip.sourceDuration
  // A known nominal source end remains a conservative limit if imported source
  // duration is unknown. Never coerce null/undefined to a zero-length source.
  const sourceEnd = clip.sourceDuration == null ? trimEnd : clip.sourceDuration
  if (!positive(trimEnd) || !positive(sourceEnd) || trimEnd <= trimStart || trimEnd > sourceEnd + EPSILON) {
    return fail('A media clip needs valid source bounds before it can be rolled.')
  }
  const expectedSpan = clip.duration * scale
  if (!positive(expectedSpan) || Math.abs(trimEnd - trimStart - expectedSpan) > EPSILON * Math.max(1, expectedSpan)) {
    return fail('This clip’s source timing does not match its length. Restore a normal constant-speed trim before rolling.')
  }
  return { ok: true, generator, scale, trimStart, trimEnd, sourceEnd }
}

/** Read-only validation of one ordinary, truly adjacent pair. The returned
 * session is immutable-by-convention input to planRollEdit; the store keeps its
 * original session private and exposes only a small feedback projection. */
export function createRollEditSession({ clips, tracks, transitions = [], clipAId, clipBId, fps = 24 } = {}) {
  if (!Array.isArray(clips) || !Array.isArray(tracks) || !Array.isArray(transitions) || !positive(fps) || fps < 1
    || typeof clipAId !== 'string' || !clipAId || typeof clipBId !== 'string' || !clipBId || clipAId === clipBId) {
    return fail('Choose two adjacent clips on one track to roll their shared cut.')
  }
  const aMatches = clips.filter(clip => clip?.id === clipAId), bMatches = clips.filter(clip => clip?.id === clipBId)
  if (aMatches.length !== 1 || bMatches.length !== 1) return fail('The rolling-edit pair is missing or ambiguous.')
  const clipA = aMatches[0], clipB = bMatches[0]
  if (clipA.trackId !== clipB.trackId) return fail('Rolling edits need two adjacent clips on the same track.')
  const trackMatches = tracks.filter(track => track?.id === clipA.trackId)
  if (trackMatches.length !== 1 || !['video', 'audio'].includes(trackMatches[0].type) || caption(trackMatches[0])) return fail('Rolling edits need a normal video or audio track.')
  const track = trackMatches[0]
  for (const clip of [clipA, clipB]) {
    if (!supported.has(clip.type) || clip.compound || caption(clip)) return fail('Rolling edits do not support compounds or captions. Open a compound to edit its ordinary layers.')
    if (track.type === 'audio' ? !['audio', 'video'].includes(clip.type) : clip.type === 'audio') return fail('A rolling-edit clip is on an incompatible track.')
    if (isCompoundLocked(clip) || isCompoundLocked(track)) return fail('Unlock both clips and their track before rolling the cut.')
    if (isCompoundCacheBusy(clip)) return fail('Wait for both clip render jobs to finish before rolling the cut.')
    if (!finite(clip.startTime) || clip.startTime < 0 || !positive(clip.duration)
      || !onFrame(clip.startTime, fps) || !onFrame(clip.duration, fps) || !onFrame(clip.startTime + clip.duration, fps)
      || Math.round(clip.duration * fps) < 1) return fail('Both clips must have valid frame-aligned timing and at least one frame.')
    if (clip.linkGroupId && clips.some(other => other !== clip && other?.linkGroupId === clip.linkGroupId)) {
      return fail('Unlink these clips before rolling; linked mates cannot be rolled together yet.')
    }
    const envelope = validateAudioVolumeEnvelope(clip.volumeEnvelope)
    if (!envelope.ok) return fail(envelope.reason)
  }
  if (Math.abs(clipA.startTime + clipA.duration - clipB.startTime) > EPSILON) return fail('Rolling edits require an exact shared cut, without a gap or overlap.')
  const end = clipB.startTime + clipB.duration
  if (clips.some(clip => clip && clip.id !== clipAId && clip.id !== clipBId && clip.trackId === clipA.trackId
    && clip.startTime < end - EPSILON && clip.startTime + clip.duration > clipA.startTime + EPSILON)) {
    return fail('Another clip overlaps this pair. Resolve the overlap before rolling the cut.')
  }
  if (transitions.some(transition => [transition?.clipId, transition?.clipAId, transition?.clipBId].some(id => id === clipAId || id === clipBId))) {
    return fail('Remove transitions attached to these clips before rolling their shared cut.')
  }
  const clockA = readClock(clipA), clockB = readClock(clipB)
  if (!clockA.ok) return clockA
  if (!clockB.ok) return clockB
  let minimumDelta = 1 / fps - clipA.duration, maximumDelta = clipB.duration - 1 / fps
  let minimumLimit = { label: 'Outgoing clip minimum duration', clipId: clipAId }
  let maximumLimit = { label: 'Incoming clip minimum duration', clipId: clipBId }
  if (!clockB.generator) {
    const sourceMinimum = clipB.reverse ? -(clockB.sourceEnd - clockB.trimEnd) / clockB.scale : -clockB.trimStart / clockB.scale
    if (sourceMinimum > minimumDelta) {
      minimumDelta = sourceMinimum
      minimumLimit = { label: clipB.reverse ? 'Incoming source end' : 'Incoming source start', clipId: clipBId }
    }
  }
  if (!clockA.generator) {
    const sourceMaximum = clipA.reverse ? clockA.trimStart / clockA.scale : (clockA.sourceEnd - clockA.trimEnd) / clockA.scale
    if (sourceMaximum < maximumDelta) {
      maximumDelta = sourceMaximum
      maximumLimit = { label: clipA.reverse ? 'Outgoing source start' : 'Outgoing source end', clipId: clipAId }
    }
  }
  const bounds = { minimumDelta, maximumDelta, minimumLimit, maximumLimit }
  if (resolveRollEditFrameDelta({ requestedDelta: 0, ...bounds, fps }) !== 0) return fail('This pair has no valid frame-aligned rolling range.')
  const session = { clipAId, clipBId, originalEditPoint: clipB.startTime, clipAOriginalDuration: clipA.duration,
    clipBOriginalStart: clipB.startTime, clipBOriginalDuration: clipB.duration,
    clipA, clipB, clockA, clockB, clips, fps, bounds }
  return { ok: true, session, bounds }
}

/** Apply one quantization to the cumulative gesture delta, then construct BOTH
 * clips without invoking the ordinary trim normalizer or touching source files.
 * Cache descriptors remain attached: full-bake signatures and source-cache
 * coverage validation already reject content invalidated by the new timing,
 * while returning to the original cut/Undo can reuse the original cache. */
export function planRollEdit({ session, requestedDelta } = {}) {
  if (!session || !Array.isArray(session.clips) || !session.clockA?.ok || !session.clockB?.ok) return fail('Start a new rolling edit before moving the cut.')
  const { clipA, clipB, clockA, clockB, fps, bounds } = session
  const delta = resolveRollEditFrameDelta({ requestedDelta, ...bounds, fps })
  if (delta === null) return fail('This pointer position has no valid frame-aligned rolling delta.')
  let clips = session.clips
  if (delta !== 0) {
    const deltaFrames = Math.round(delta * fps)
    const aDuration = (Math.round(clipA.duration * fps) + deltaFrames) / fps
    const bDuration = (Math.round(clipB.duration * fps) - deltaFrames) / fps
    const bStart = (Math.round(clipB.startTime * fps) + deltaFrames) / fps
    const aTrim = clockA.generator
      ? { trimStart: clockA.trimStart, trimEnd: clockA.trimStart + aDuration * clockA.scale }
      : clipA.reverse
        ? { trimStart: Math.max(0, clockA.trimStart - delta * clockA.scale), trimEnd: clockA.trimEnd }
        : { trimStart: clockA.trimStart, trimEnd: clockA.trimEnd + delta * clockA.scale }
    const bTrim = clockB.generator
      ? { trimStart: clockB.trimStart, trimEnd: clockB.trimStart + bDuration * clockB.scale }
      : clipB.reverse
        ? { trimStart: clockB.trimStart, trimEnd: clockB.trimEnd - delta * clockB.scale }
        : { trimStart: Math.max(0, clockB.trimStart + delta * clockB.scale), trimEnd: clockB.trimEnd }
    const nextA = { ...clipA, duration: aDuration, ...aTrim }
    const nextB = { ...clipB, startTime: bStart, duration: bDuration, ...bTrim }
    if (clipB.volumeEnvelope != null) {
      if (!finite(clipB.volumeEnvelope.offsetSeconds + delta)) return fail('The volume envelope offset is outside the supported time range.')
      nextB.volumeEnvelope = shiftAudioVolumeEnvelope(clipB, delta)
    }
    if ([nextA, nextB].some(clip => !finite(clip.trimStart) || !positive(clip.trimEnd) || clip.trimStart < 0 || clip.trimEnd <= clip.trimStart)) return fail('The source bounds cannot represent this rolling edit safely.')
    clips = session.clips.map(clip => clip === clipA ? nextA : clip === clipB ? nextB : clip)
  }
  const feedback = buildRollEditPreviewFeedback({ session, clips, fps, requestedDelta, bounds })
  if (!feedback) return fail('The resulting clips no longer share a valid frame-aligned cut.')
  return { ok: true, changed: delta !== 0, clips, delta, bounds, feedback }
}
