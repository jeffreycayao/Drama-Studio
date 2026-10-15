export function keyframeZoomBounds(duration, viewportWidth, fps = 24) {
  const seconds = Math.max(0.001, Number(duration) || 0.001)
  const width = Math.max(1, Number(viewportWidth) || 1)
  const fit = width / seconds
  // Allow individual frames to spread apart without building unbounded lanes.
  const max = Math.max(fit, Math.min(Math.max(1, Number(fps) || 24) * 24, 250000 / seconds))
  return { min: fit, max }
}

export function anchoredKeyframeScroll({ scrollLeft, anchorX, oldScale, newScale, duration, viewportWidth }) {
  const time = (Math.max(0, scrollLeft) + Math.max(0, anchorX)) / oldScale
  const maxScroll = Math.max(0, duration * newScale - viewportWidth)
  return Math.max(0, Math.min(maxScroll, time * newScale - Math.max(0, anchorX)))
}
