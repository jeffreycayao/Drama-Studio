import { getTargetVideoFrameIndex } from './previewVideoSeeking.js'

/**
 * Seek the private trim decoder inside the requested frame's interval.
 * Chromium can round an exclusive-end-minus-epsilon seek onto the next
 * frame; the original target remains the source of truth for PTS checks.
 */
export function getTrimPreviewSeekTime(targetTime, fps, duration) {
  if (!Number.isFinite(targetTime) || targetTime < 0 || !Number.isFinite(fps) || fps <= 0
    || !Number.isFinite(duration) || duration <= 0 || targetTime >= duration) return null
  const frame = getTargetVideoFrameIndex(targetTime, fps)
  if (!Number.isSafeInteger(frame)) return null
  const start = frame / fps
  const end = Math.min((frame + 1) / fps, duration)
  if (!(end > start)) return null
  const time = start + (end - start) / 4
  return time > start && time < end && getTargetVideoFrameIndex(time, fps) === frame ? time : null
}
