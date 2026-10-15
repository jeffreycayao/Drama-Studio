const ABSOLUTE_MIN_ZOOM = 0.5
const ABSOLUTE_MAX_ZOOM = 2000
const SELECTION_WIDTH_FRACTION = 0.8
const finite = value => typeof value === 'number' && Number.isFinite(value)

/** Pure view calculation, independent of FPS, tracks, source media and history.
 * viewportWidth is the usable scrolling timeline width, excluding fixed track
 * headers. At an unconstrained zoom the selection occupies 80% of that width,
 * with equal margins. Timeline zero and zoom bounds can prevent perfect centering
 * or fitting; the caller may further clamp scrollLeft to its actual DOM range.
 *
 * Missing IDs and invalid timing are ignored; an ambiguous duplicate clip ID
 * refuses the view. A zero-length clip is a point, framed at the maximum zoom.
 * Returned startTime/endTime are the actual selected extents, not padded times.
 * This helper neither determines toggle state nor writes any document/view state.
 */
export function resolveTimelineSelectionViewport(options = {}) {
  if (!options || typeof options !== 'object') return null
  const { clips, selectedClipIds, viewportWidth, minZoom = ABSOLUTE_MIN_ZOOM, maxZoom = ABSOLUTE_MAX_ZOOM } = options
  if (!Array.isArray(clips) || !Array.isArray(selectedClipIds) || !finite(viewportWidth) || viewportWidth <= 0
    || viewportWidth > Number.MAX_SAFE_INTEGER || !finite(minZoom) || minZoom <= 0 || !finite(maxZoom) || maxZoom <= 0) return null
  const minimum = Math.max(ABSOLUTE_MIN_ZOOM, Math.min(ABSOLUTE_MAX_ZOOM, minZoom))
  const maximum = Math.max(ABSOLUTE_MIN_ZOOM, Math.min(ABSOLUTE_MAX_ZOOM, maxZoom))
  if (minimum > maximum) return null
  const selected = new Set(selectedClipIds.filter(id => typeof id === 'string' && id.trim()))
  if (!selected.size) return null
  const matched = new Set()
  let startTime = Infinity, endTime = -Infinity
  for (const clip of clips) {
    if (!clip || !selected.has(clip.id)) continue
    if (matched.has(clip.id)) return null
    matched.add(clip.id)
    if (!finite(clip.startTime) || clip.startTime < 0 || !finite(clip.duration) || clip.duration < 0) continue
    const end = clip.startTime + clip.duration
    if (!finite(end)) continue
    startTime = Math.min(startTime, clip.startTime)
    endTime = Math.max(endTime, end)
  }
  if (!finite(startTime) || !finite(endTime)) return null
  const span = endTime - startTime
  // Dividing before multiplying avoids overflowing a large, otherwise valid
  // viewport. Infinite desired zoom for a subnormal span simply reaches the cap.
  const desiredZoom = span > 0 ? (viewportWidth / span) * (5 * SELECTION_WIDTH_FRACTION) : maximum
  const zoom = Math.max(minimum, Math.min(maximum, desiredZoom))
  const pixelsPerSecond = zoom / 5
  const centerTime = startTime + span / 2
  const leftPixel = startTime * pixelsPerSecond, rightPixel = endTime * pixelsPerSecond
  const scrollLeft = Math.max(0, centerTime * pixelsPerSecond - viewportWidth / 2)
  // Coordinates beyond exact integer-pixel range cannot describe a meaningful
  // browser viewport. Refuse them instead of returning Infinity/unsafe positions.
  if (![zoom, leftPixel, rightPixel, scrollLeft].every(finite) || rightPixel > Number.MAX_SAFE_INTEGER
    || scrollLeft > Number.MAX_SAFE_INTEGER) return null
  return { zoom, scrollLeft: scrollLeft || 0, startTime: startTime || 0, endTime: endTime || 0 }
}
