import { getSafeTimelineFps, timeToFrameIndex } from './timelineFrames.js'

const finite = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}
const frameIndex = (value, fallback = 0) => Math.min(Number.MAX_SAFE_INTEGER,
  Math.max(0, Math.round(finite(value, fallback))))

/** The export interval is [startFrame, endFrame); the final seekable picture
 * is one frame before the overview's end. In/Out may include an empty tail. */
export function getExportOverviewBounds({ clips = [], fps, startFrame = 0, endFrame } = {}) {
  const rate = getSafeTimelineFps(fps)
  const contentEnd = clips.reduce((end, clip) => {
    if (!clip || !Number.isFinite(Number(clip.startTime)) || !Number.isFinite(Number(clip.duration))
      || Number(clip.duration) <= 0) return end
    return Math.max(end, Number(clip.startTime) + Number(clip.duration))
  }, 0)
  const contentFrames = frameIndex(timeToFrameIndex(contentEnd, rate, 'ceil'))
  const first = frameIndex(startFrame)
  const last = endFrame == null ? contentFrames : frameIndex(endFrame, contentFrames)
  const rangeStart = Math.min(first, last)
  const rangeEnd = Math.max(first, last)
  const totalFrames = Math.max(contentFrames, rangeEnd)
  return {
    fps: rate,
    contentFrames,
    totalFrames,
    lastFrame: Math.max(0, totalFrames - 1),
    startFrame: rangeStart,
    endFrame: rangeEnd,
    hasContent: contentFrames > 0,
    hasRange: rangeEnd > rangeStart,
  }
}

export function clampExportOverviewFrame(frame, totalFrames) {
  return Math.min(Math.max(0, frameIndex(totalFrames) - 1), frameIndex(frame))
}

/** A boundary may reach 100%; a seek never reaches the exclusive end. */
export function exportOverviewFramePercent(frame, totalFrames) {
  if (!Number.isFinite(Number(totalFrames)) || Number(totalFrames) <= 0) return 0
  return Math.min(100, Math.max(0, finite(frame) / Number(totalFrames) * 100))
}

export function getExportOverviewPointerFrame(clientX, rect, totalFrames) {
  if (!rect || !Number.isFinite(clientX) || !Number.isFinite(rect.left)
    || !Number.isFinite(rect.width) || rect.width <= 0) return null
  const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  return clampExportOverviewFrame(Math.round(fraction * frameIndex(totalFrames)), totalFrames)
}

export function getExportOverviewClipSpan(clip, fps, totalFrames) {
  if (!clip || !Number.isFinite(Number(clip.startTime)) || !Number.isFinite(Number(clip.duration))
    || Number(clip.duration) <= 0 || totalFrames <= 0) return null
  const start = Math.min(totalFrames, timeToFrameIndex(Number(clip.startTime), fps, 'floor'))
  const end = Math.min(totalFrames, timeToFrameIndex(Number(clip.startTime) + Number(clip.duration), fps, 'ceil'))
  if (end <= start) return null
  const left = exportOverviewFramePercent(start, totalFrames)
  return { startFrame: start, endFrame: end, left, width: exportOverviewFramePercent(end, totalFrames) - left }
}

export function getExportOverviewTicks(totalFrames, count = 3) {
  const total = frameIndex(totalFrames)
  if (!total) return [0]
  const divisions = Math.max(1, Math.min(8, Math.round(finite(count, 3)) - 1))
  return [...new Set(Array.from({ length: divisions + 1 }, (_, index) => Math.round(total * index / divisions)))]
}

/** Frame-count NDF timecode. Use the exact FPS for seconds→frames and the
 * nominal rate only for timecode numbering, including 23.976/29.97 media. */
export function formatExportOverviewTimecode(frame, fps) {
  const nominalFps = Math.max(1, Math.round(getSafeTimelineFps(fps)))
  const total = frameIndex(frame)
  const seconds = Math.floor(total / nominalFps)
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}:${pad(total % nominalFps)}`
}

/** Only calls the existing navigation action; never authors timeline data. */
export function seekExportOverviewFrame(setPlayheadPosition, frame, fps, totalFrames, precise = true) {
  if (typeof setPlayheadPosition !== 'function' || totalFrames <= 0) return false
  const target = clampExportOverviewFrame(frame, totalFrames) / getSafeTimelineFps(fps)
  return setPlayheadPosition(target, precise ? { snap: true, intent: 'frame-step' } : { snap: true })
}
