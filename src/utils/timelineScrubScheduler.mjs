import { quantizeTimeToFrame } from './timelineFrames.js'

const finite = value => typeof value === 'number' && Number.isFinite(value)

/** Shared, DOM-free mapping. Initial/release samples do not add another
 * auto-scroll step; only animation ticks advance a held edge pointer. */
export function resolveTimelineScrubSample({ clientX, geometry, pixelsPerSecond, duration, fps,
  autoScroll = true, edgePixels = 40, maxStepPixels = 28 } = {}) {
  if (!finite(clientX) || !geometry || !finite(geometry.left) || !finite(geometry.right)
    || geometry.right <= geometry.left || !finite(geometry.scrollLeft) || !finite(geometry.maxScrollLeft)
    || geometry.maxScrollLeft < 0 || !finite(pixelsPerSecond) || pixelsPerSecond <= 0
    || !finite(duration) || duration < 0 || !finite(fps) || fps <= 0
    || !finite(edgePixels) || edgePixels <= 0 || !finite(maxStepPixels) || maxStepPixels < 0) return null
  let step = 0
  if (autoScroll) {
    const rightThreshold = geometry.right - edgePixels
    const leftThreshold = geometry.left + edgePixels
    if (clientX >= rightThreshold) {
      step = Math.round(maxStepPixels * Math.min(1.5, Math.max(0.2, (clientX - rightThreshold) / edgePixels)))
    } else if (clientX <= leftThreshold) {
      step = -Math.round(maxStepPixels * Math.min(1.5, Math.max(0.2, (leftThreshold - clientX) / edgePixels)))
    }
  }
  const before = Math.max(0, Math.min(geometry.maxScrollLeft, geometry.scrollLeft))
  const scrollLeft = Math.max(0, Math.min(geometry.maxScrollLeft, before + step))
  const seconds = Math.max(0, Math.min(duration, (clientX - geometry.left + scrollLeft) / pixelsPerSecond))
  return { time: quantizeTimeToFrame(seconds, fps), scrollLeft, continue: scrollLeft !== before }
}

/** One latest-target slot and one RAF for both pointer motion and edge hold.
 * Deduplication belongs to this gesture, never to global frame-step intent. */
export function createTimelineScrubScheduler({ requestFrame, cancelFrame, readSample, onPosition, getCurrentPosition, forcePublish }) {
  let latestX = null
  let frame = null
  let started = false
  let moved = false
  let closed = false
  let finishing = false
  let lastPosition = null

  const clearFrame = () => {
    if (frame !== null) cancelFrame(frame)
    frame = null
  }
  const sample = phase => {
    if (closed || latestX === null) return false
    const result = readSample(latestX, phase)
    if (closed || !result || !finite(result.time)) return false
    const livePosition = getCurrentPosition ? getCurrentPosition() : lastPosition
    if (phase === 'initial' || result.time !== lastPosition || livePosition !== result.time || forcePublish?.(result.time, phase)) {
      lastPosition = result.time
      onPosition(result.time, phase)
    }
    return !closed && result.continue === true
  }
  const schedule = () => {
    if (closed || finishing || !started || frame !== null || latestX === null) return
    frame = requestFrame(() => {
      frame = null
      if (sample('update')) schedule()
    })
  }
  return {
    start(clientX, { deferInitial = false, initialPosition = null } = {}) {
      if (closed || finishing || started || !finite(clientX)) return
      started = true
      latestX = clientX
      if (deferInitial) lastPosition = initialPosition
      else sample('initial')
    },
    move(clientX) {
      if (closed || finishing || !started || !finite(clientX)) return
      latestX = clientX
      moved = true
      schedule()
    },
    invalidate() { if (moved) schedule() },
    finish(clientX) {
      if (closed || finishing || !started) return
      finishing = true
      if (finite(clientX)) latestX = clientX
      clearFrame()
      try { sample('release') } finally { closed = true; finishing = false; clearFrame() }
    },
    cancel() {
      closed = true
      clearFrame()
    },
  }
}
