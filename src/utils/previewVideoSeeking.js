export const PRECISE_VIDEO_SEEK_EPSILON_SECONDS = 1e-6

const finiteNonNegative = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

const positiveFps = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function getPreciseVideoSeekFps({
  usingOpticalFlow = false,
  opticalFlowFps = null,
  isTimelineCache = false,
  timelineFps = null,
  clipSourceFps = null,
  assetFps = null,
} = {}) {
  if (usingOpticalFlow) return positiveFps(opticalFlowFps) || positiveFps(timelineFps) || 24
  if (isTimelineCache) return positiveFps(timelineFps) || 24
  return positiveFps(clipSourceFps)
    || positiveFps(assetFps)
    || positiveFps(timelineFps)
    || 24
}

export function isSamePreciseVideoSeekTarget(a, b) {
  if (a == null || b == null) return false
  const parsedA = Number(a)
  const parsedB = Number(b)
  if (!Number.isFinite(parsedA) || !Number.isFinite(parsedB)) return false
  return Math.abs(Math.max(0, parsedA) - Math.max(0, parsedB)) <= PRECISE_VIDEO_SEEK_EPSILON_SECONDS
}

export function isFrameStepSeekIntentAtTime(intent, timelineTime) {
  return intent?.type === 'frame-step'
    && Number.isFinite(Number(intent.targetTime))
    && isSamePreciseVideoSeekTarget(intent.targetTime, timelineTime)
}

// currentTime can change synchronously before Chromium has presented the
// newly decoded picture. Precise stepping therefore compares against the
// last target whose seek actually completed, never against currentTime alone.
export function shouldIssuePreciseVideoSeek({ targetTime, pendingTargetTime, settledTargetTime }) {
  if (pendingTargetTime != null
    && Number.isFinite(Number(pendingTargetTime))
    && isSamePreciseVideoSeekTarget(pendingTargetTime, targetTime)) {
    return false
  }
  return settledTargetTime == null
    || !Number.isFinite(Number(settledTargetTime))
    || !isSamePreciseVideoSeekTarget(settledTargetTime, targetTime)
}

export function getTargetVideoFrameIndex(targetTime, fps) {
  const safeFps = positiveFps(fps)
  if (!safeFps) return null
  // A seek at t displays the frame whose presentation interval contains t.
  // The epsilon protects exact frame boundaries from floating-point drift.
  return Math.max(0, Math.floor(finiteNonNegative(targetTime) * safeFps + 1e-7))
}

// Chromium can truncate currentTime to microseconds. An exact frame boundary
// such as 19 / 24 then lands just inside the preceding frame. Seek into the
// intended frame's presentation interval while keeping the logical target
// unchanged for frame validation and timeline positioning.
export function getVideoFrameSeekTime(targetTime, fps, duration = Infinity) {
  const safeFps = positiveFps(fps)
  const time = safeFps
    ? (getTargetVideoFrameIndex(targetTime, safeFps) + 0.5) / safeFps
    : finiteNonNegative(targetTime)
  const finiteDuration = Number(duration)
  if (!Number.isFinite(finiteDuration) || finiteDuration <= 0) return time
  return Math.min(time, Math.max(0, finiteDuration - PRECISE_VIDEO_SEEK_EPSILON_SECONDS))
}

// Decoder time-base conversion can round twice (e.g. 4.020833333 becomes
// 4.020832). This tolerance is only for physical element ownership, never
// logical timeline targets or presentation PTS. Require the same frame too.
export function isSameVideoFrameSeekTime(actualTime, seekTime, fps) {
  if (!Number.isFinite(Number(actualTime)) || !Number.isFinite(Number(seekTime))) return false
  const frame = getTargetVideoFrameIndex(seekTime, fps)
  return frame !== null && getTargetVideoFrameIndex(actualTime, fps) === frame
    && Math.abs(Number(actualTime) - Number(seekTime)) <= 1e-5
}

export function getPresentedVideoFrameIndex(mediaTime, fps) {
  const safeFps = positiveFps(fps)
  if (!safeFps || !Number.isFinite(Number(mediaTime))) return null
  // requestVideoFrameCallback mediaTime is a frame PTS, so nearest-frame
  // rounding is stable even when the encoded time base is slightly fractional.
  return Math.max(0, Math.round(finiteNonNegative(mediaTime) * safeFps))
}

export function doesPresentedVideoFrameMatchTarget({ mediaTime, targetTime, fps }) {
  const targetFrame = getTargetVideoFrameIndex(targetTime, fps)
  const presentedFrame = getPresentedVideoFrameIndex(mediaTime, fps)
  if (targetFrame === null || presentedFrame === null) return false
  return targetFrame === presentedFrame
}
