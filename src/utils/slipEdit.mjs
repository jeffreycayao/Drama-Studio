import { resolveRollEditFrameDelta } from './rollEditPreview.mjs'
import { getTrimPreviewTimelineTime } from './trimPreview.mjs'
import { isCompoundLocked, isCompoundCacheBusy } from './compoundDocument.mjs'

const EPSILON = 1e-7
const finite = value => typeof value === 'number' && Number.isFinite(value)
const positive = value => finite(value) && value > 0
const fail = reason => ({ ok: false, changed: false, reason })
const populated = value => value != null && (typeof value !== 'object' || Object.keys(value).length > 0)
const caption = value => value?.role === 'captions' || value?.overlayKind === 'captions' || value?.captionScope
  || value?.settings?.overlayKind === 'captions' || value?.settings?.captionScope || value?.metadata?.captionScope
const onFrame = (value, fps) => finite(value) && Number.isSafeInteger(Math.round(value * fps))
  && Math.abs(value * fps - Math.round(value * fps)) <= EPSILON

function readClock(clip) {
  if (populated(clip.keyframes?.speed) || populated(clip.speedRamp) || populated(clip.timeRemap)) {
    return fail('Slip does not support speed ramps or time remapping yet.')
  }
  if (clip.reverse != null && typeof clip.reverse !== 'boolean') return fail('This clip has an invalid reverse setting.')
  for (const key of ['speed', 'sourceTimeScale', 'timelineFps', 'sourceFps']) {
    if (clip[key] != null && !positive(clip[key])) return fail('This clip has an invalid source clock or speed.')
  }
  const baseScale = clip.sourceTimeScale ?? (clip.timelineFps && clip.sourceFps ? clip.timelineFps / clip.sourceFps : 1)
  const timeScale = baseScale * (clip.speed ?? 1)
  if (!positive(timeScale)) return fail('This clip has an unsupported source clock.')
  // Ordinary video is currently canonicalized to source scale 1 on project
  // load. Do not create an edit whose source samples would shift on reopen.
  if (clip.type === 'video' && Math.abs(baseScale - 1) > EPSILON) return fail('This video uses older source timing. Reopen the project and check this clip’s timing before using Slip.')
  if (!positive(clip.sourceDuration)) return fail('Reload this clip’s media metadata to establish its source duration before using Slip.')
  const trimStart = clip.trimStart ?? 0, trimEnd = clip.trimEnd ?? clip.sourceDuration
  if (!finite(trimStart) || trimStart < 0 || !positive(trimEnd) || trimEnd <= trimStart || trimEnd > clip.sourceDuration + EPSILON) {
    return fail('This clip needs valid source In and Out points before using Slip.')
  }
  const span = clip.duration * timeScale
  if (!positive(span) || Math.abs(trimEnd - trimStart - span) > EPSILON * Math.max(1, span)) {
    return fail('This clip’s source timing does not match its length. Restore a normal constant-speed trim before using Slip.')
  }
  return { ok: true, timeScale, trimStart, trimEnd, sourceDuration: clip.sourceDuration }
}

/** Validate a single finite media instance without changing selection/history.
 * Positive timeline delta deliberately means a LATER source In/Out for both
 * playback orientations, matching the existing Slip tool direction. */
export function createSlipEditSession({ clips, tracks, transitions = [], clipId, fps = 24 } = {}) {
  if (!Array.isArray(clips) || !Array.isArray(tracks) || !Array.isArray(transitions) || typeof clipId !== 'string' || !clipId
    || !positive(fps) || fps < 1) return fail('Choose a video or audio clip to slip its source range.')
  const matches = clips.filter(clip => clip?.id === clipId)
  if (matches.length !== 1) return fail('The Slip target is missing or ambiguous. Select the clip again.')
  const clip = matches[0]
  if (!['video', 'audio'].includes(clip.type) || clip.compound || caption(clip)) {
    return fail('Slip needs finite video or audio media. Stills, titles, captions and compound parents cannot be slipped.')
  }
  const trackMatches = tracks.filter(track => track?.id === clip.trackId)
  if (trackMatches.length !== 1 || caption(trackMatches[0]) || !['video', 'audio'].includes(trackMatches[0].type)) return fail('Slip needs a normal video or audio track.')
  const track = trackMatches[0]
  if (track.type === 'video' && clip.type === 'audio') return fail('This clip is on an incompatible track.')
  if (isCompoundLocked(clip) || isCompoundLocked(track)) return fail('Unlock this clip and its track before using Slip.')
  if (isCompoundCacheBusy(clip)) return fail('Wait for this clip’s render jobs to finish before using Slip.')
  if (!finite(clip.startTime) || clip.startTime < 0 || !positive(clip.duration) || !onFrame(clip.startTime, fps)
    || !onFrame(clip.duration, fps) || !onFrame(clip.startTime + clip.duration, fps) || Math.round(clip.duration * fps) < 1) {
    return fail('The clip must have valid frame-aligned timing and at least one frame before using Slip.')
  }
  if (clip.linkGroupId && clips.some(other => other !== clip && other?.linkGroupId === clip.linkGroupId)) {
    return fail('Unlink this clip before using Slip; linked mates cannot be slipped together yet.')
  }
  if (transitions.some(transition => [transition?.clipId, transition?.clipAId, transition?.clipBId].includes(clipId))) {
    return fail('Remove transitions attached to this clip before using Slip.')
  }
  const clock = readClock(clip)
  if (!clock.ok) return clock
  const bounds = { minimumDelta: -clock.trimStart / clock.timeScale,
    maximumDelta: (clock.sourceDuration - clock.trimEnd) / clock.timeScale,
    minimumLimit: { label: 'Source start', clipId }, maximumLimit: { label: 'Source end', clipId } }
  if (resolveRollEditFrameDelta({ requestedDelta: 0, ...bounds, fps }) !== 0) return fail('This clip has no valid frame-aligned Slip range.')
  const session = { clipId, originalTrimStart: clock.trimStart, originalTrimEnd: clock.trimEnd,
    originalStartTime: clip.startTime, originalDuration: clip.duration, timeScale: clock.timeScale,
    clip, clips, fps, bounds }
  return { ok: true, session, bounds }
}

/** Source-only first/last frame feedback from an ACTUAL edited clip. Refuse a
 * moved/resized clip or mismatched source offsets instead of showing a proposed
 * source range as though it were applied. No seeking or project writes. */
export function buildSlipEditPreviewFeedback({ session, clips, fps = 24, requestedDelta, bounds = session?.bounds } = {}) {
  if (!session || !Array.isArray(clips) || !positive(fps) || fps < 1 || !positive(session.timeScale)
    || !finite(session.originalTrimStart) || !positive(session.originalTrimEnd)) return null
  const matches = clips.filter(clip => clip?.id === session.clipId)
  if (matches.length !== 1) return null
  const clip = matches[0]
  const trimStart = clip.trimStart ?? 0, trimEnd = clip.trimEnd ?? clip.sourceDuration
  if (clip.startTime !== session.originalStartTime || clip.duration !== session.originalDuration
    || clip.startTime < 0 || !onFrame(clip.startTime, fps) || !onFrame(clip.duration, fps) || Math.round(clip.duration * fps) < 1
    || !finite(trimStart) || !positive(trimEnd) || trimStart < 0 || trimEnd <= trimStart) return null
  const sourceDelta = trimStart - session.originalTrimStart
  if (Math.abs(trimEnd - session.originalTrimEnd - sourceDelta) > EPSILON * Math.max(1, Math.abs(sourceDelta))) return null
  const actualDelta = sourceDelta / session.timeScale
  if (!onFrame(actualDelta, fps)) return null
  const firstTime = getTrimPreviewTimelineTime(clip, 'left', fps), lastTime = getTrimPreviewTimelineTime(clip, 'right', fps)
  if (!finite(firstTime) || !finite(lastTime)) return null
  let limit = null
  if (finite(requestedDelta) && Math.abs(requestedDelta) > EPSILON && bounds) {
    for (const side of ['minimum', 'maximum']) {
      const bound = bounds[`${side}Delta`], label = bounds[`${side}Limit`]
      if (!finite(bound) || !label || label.clipId !== clip.id || typeof label.label !== 'string' || !label.label.trim()) continue
      const attempted = side === 'minimum' ? requestedDelta <= bound + EPSILON : requestedDelta >= bound - EPSILON
      const acceptedBound = resolveRollEditFrameDelta({ requestedDelta: bound, ...bounds, fps })
      if (attempted && acceptedBound !== null && Math.abs(actualDelta - acceptedBound) <= EPSILON) {
        limit = { label: label.label, clipId: label.clipId }
        break
      }
    }
  }
  return { first: { clipId: clip.id, clip, edge: 'left', timelineTime: firstTime, duration: clip.duration },
    last: { clipId: clip.id, clip, edge: 'right', timelineTime: lastTime, duration: clip.duration },
    deltaFrames: Math.round(actualDelta * fps) || 0, sourceDelta: sourceDelta || 0, limit }
}

/** Plan a cumulative gesture delta using one inward-bounded timeline-frame
 * quantization. Only trimStart/trimEnd change. Local animation, audio envelopes,
 * placement, duration and cache descriptors keep their existing conventions. */
export function planSlipEdit({ session, requestedDelta } = {}) {
  if (!session?.clip || !Array.isArray(session.clips) || !positive(session.timeScale)) return fail('Start a new Slip gesture before changing the source range.')
  const { clip, clips: originalClips, fps, bounds, timeScale } = session
  const delta = resolveRollEditFrameDelta({ requestedDelta, ...bounds, fps })
  if (delta === null) return fail('This pointer position has no valid frame-aligned Slip delta.')
  let clips = originalClips
  if (delta !== 0) {
    const sourceDelta = delta * timeScale
    const trimStart = Math.max(0, session.originalTrimStart + sourceDelta)
    const trimEnd = Math.min(clip.sourceDuration, session.originalTrimEnd + sourceDelta)
    if (!finite(trimStart) || !positive(trimEnd) || trimEnd <= trimStart) return fail('This source range cannot represent the Slip edit safely.')
    const next = { ...clip, trimStart, trimEnd }
    clips = originalClips.map(item => item === clip ? next : item)
  }
  const feedback = buildSlipEditPreviewFeedback({ session, clips, fps, requestedDelta, bounds })
  if (!feedback) return fail('The resulting source range does not match a valid Slip edit.')
  return { ok: true, changed: delta !== 0, clips, delta, bounds, feedback }
}
