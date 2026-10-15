import { getClipPlaybackWindow } from '../../electron/audioMixEligibility.mjs'
import { isBetweenClipTransition } from './transitionKinds.js'
import { hasVideoSolo, isVideoTrackVisible } from './videoTrackVisibility.js'

// Keep the authored split semantics used by timelineStore.getTransitionAtTime.
// A custom split wins over alignment; "start" places the range before the cut.
const normalizeTransitionSplit = (split = null, alignment = 'center') => {
  if (split && Number.isFinite(Number(split.clipA)) && Number.isFinite(Number(split.clipB))) {
    const clipA = Math.max(0, Number(split.clipA))
    const clipB = Math.max(0, Number(split.clipB))
    const total = clipA + clipB
    if (total > 0) return { clipA: clipA / total, clipB: clipB / total }
  }
  if (alignment === 'start') return { clipA: 1, clipB: 0 }
  if (alignment === 'end') return { clipA: 0, clipB: 1 }
  return { clipA: 0.5, clipB: 0.5 }
}

/**
 * Plan video preloading without assigning decoder ownership to the preloader.
 * Active nominal footage OR transition handles must never be parked: the
 * compositor owns their currentTime. Otherwise prepare the nearest real entry
 * interval in the playback direction, not a union that fills unrelated gaps.
 *
 * The caller maps targetTimelineTime through getClipPlaybackTimeAtTimeline
 * with allowHandles, preserving its source clamps, retiming and end epsilon.
 * Recompute this plan before applying a delayed metadata seek; the user may
 * have started playing, reversed, edited, or scrubbed into this clip meanwhile.
 */
export function getClipPreviewPreloadPlan({
  clip,
  clips = [],
  transitions = [],
  tracks = null,
  time,
  playbackRate = 1,
  lookahead = 2.5,
} = {}) {
  const safeTime = Number(time)
  if (!clip?.id || clip.enabled === false || !Number.isFinite(safeTime)) return null
  if (Array.isArray(tracks) && !isVideoTrackVisible(
    tracks.find((track) => track?.id === clip.trackId), hasVideoSolo(tracks)
  )) return null

  const intervals = []
  const nominal = getClipPlaybackWindow(clip)
  if (nominal.end > nominal.start) intervals.push({ ...nominal, allowHandles: false })
  // Compound bounds constrain visibility, but the nominal clip bounds must
  // not constrain transition handles before/after that clip's authored trim.
  const lower = typeof clip.playbackWindowStart === 'number' && Number.isFinite(clip.playbackWindowStart)
    ? clip.playbackWindowStart : -Infinity
  const upper = typeof clip.playbackWindowEnd === 'number' && Number.isFinite(clip.playbackWindowEnd)
    ? clip.playbackWindowEnd : Infinity

  for (const transition of transitions) {
    if (!isBetweenClipTransition(transition)) continue
    if (transition.clipAId !== clip.id && transition.clipBId !== clip.id) continue
    const clipA = clips.find((item) => item?.id === transition.clipAId)
    const clipB = clips.find((item) => item?.id === transition.clipBId)
    if (!clipA || !clipB || clipA.enabled === false || clipB.enabled === false || clipA.trackId !== clipB.trackId) continue
    const duration = Number(transition.duration)
    if (!Number.isFinite(duration) || duration <= 0) continue
    const split = normalizeTransitionSplit(transition.settings?.split, transition.settings?.alignment || 'center')
    const editPoint = Number.isFinite(Number(transition.editPoint))
      ? Number(transition.editPoint)
      : ((Number(clipA.startTime) || 0) + (Number(clipA.duration) || 0))
    const start = Math.max(lower, editPoint - duration * split.clipA)
    const end = Math.min(upper, editPoint + duration * split.clipB)
    if (end > start) intervals.push({ start, end, allowHandles: true })
  }

  if (intervals.some(({ start, end }) => safeTime >= start && safeTime < end)) {
    return { active: true, targetTimelineTime: null, allowHandles: false }
  }

  const forward = !(Number(playbackRate) < 0)
  const safeLookahead = Math.max(0, Number(lookahead) || 0)
  let nearest = null
  let nearestDistance = Infinity
  for (const interval of intervals) {
    const targetTimelineTime = forward ? interval.start : interval.end
    const distance = forward ? targetTimelineTime - safeTime : safeTime - targetTimelineTime
    // A half-open interval's end is not active, but is the immediate next
    // entry when playing backward. Keep that zero-distance target instead of
    // parking at an earlier nominal boundary. Source mapping owns end epsilon.
    if (distance < 0 || (forward && distance === 0) || distance > safeLookahead || distance >= nearestDistance) continue
    nearestDistance = distance
    nearest = { active: false, targetTimelineTime, allowHandles: interval.allowHandles }
  }
  return nearest
}
