export const TRANSITION_DRAG_TYPE = 'application/x-comfystudio-transition'
const VISUAL_TYPES = new Set(['video', 'image', 'text', 'shape'])

// Drag payload contents are protected during native dragover. Only types are
// readable until drop; inspecting getData here silently breaks Electron DnD.
export function isTransitionDrag(dataTransfer) {
  return Array.from(dataTransfer?.types || []).includes(TRANSITION_DRAG_TYPE)
}

export function parseTransitionDrag(dataTransfer, allowedTypes) {
  try {
    const payload = JSON.parse(dataTransfer.getData(TRANSITION_DRAG_TYPE))
    if (!payload || !allowedTypes.includes(payload.type)
      || typeof payload.duration !== 'number' || !Number.isFinite(payload.duration) || payload.duration <= 0) return null
    return { type: payload.type, duration: payload.duration }
  } catch (_) { return null }
}

/** Resolve an actual consecutive butt cut, not a gap, overlap, or selected pair.
 * Pixel-sized targeting stays equally usable at every timeline zoom level.
 * No store writes or selection changes occur while opening a cut menu.
 */
export function findTransitionCutTarget(state, { trackId, time, pixelsPerSecond, radiusPx = 8, allowExisting = false } = {}) {
  if (!state || state.compoundEditContext || !Number.isFinite(time) || !Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0
    || !Number.isFinite(radiusPx) || radiusPx < 0) return null
  const track = state.tracks?.find(item => item.id === trackId)
  if (!track || track.type !== 'video' || track.role === 'captions' || track.locked) return null
  const clips = (state.clips || []).filter(clip => clip.trackId === trackId)
    .sort((a, b) => a.startTime - b.startTime)
  const fps = Number(state.timelineFps) > 0 ? Number(state.timelineFps) : 24
  const tolerance = Math.min(0.001, 1 / fps / 10)
  const candidates = []
  for (let index = 0; index < clips.length - 1; index++) {
    const clipA = clips[index], clipB = clips[index + 1]
    if (![clipA, clipB].every(clip => VISUAL_TYPES.has(clip.type)
      && Number.isFinite(clip.startTime) && Number.isFinite(clip.duration) && clip.duration > 0)) continue
    const editPoint = clipA.startTime + clipA.duration
    if (Math.abs(clipB.startTime - editPoint) > tolerance) continue
    const distance = Math.abs(time - editPoint) * pixelsPerSecond
    if (distance > radiusPx) continue
    // An unrelated overlapping layer on this same track makes the cut ambiguous.
    if (clips.some(clip => clip !== clipA && clip !== clipB
      && clip.startTime < editPoint - tolerance && clip.startTime + clip.duration > editPoint + tolerance)) continue
    const transition = (state.transitions || []).find(item => item.kind !== 'edge'
      && ((item.clipAId === clipA.id && item.clipBId === clipB.id)
        || (item.clipBId === clipA.id && item.clipAId === clipB.id))) || null
    if (transition && !allowExisting) continue
    candidates.push({ clipA, clipB, trackId, editPoint, transition, distance,
      timelineSessionId: state.timelineSessionId, compoundEditContext: state.compoundEditContext ?? null,
      timelineFps: state.timelineFps })
  }
  candidates.sort((a, b) => a.distance - b.distance)
  if (candidates.length > 1 && Math.abs(candidates[0].distance - candidates[1].distance) < 0.1) return null
  return candidates[0] || null
}

/** Menus are snapshots. A changed/replaced source or timeline needs a new click. */
export function isTransitionCutTargetCurrent(state, target, { allowExisting = false } = {}) {
  if (!state || !target || state.timelineSessionId !== target.timelineSessionId
    || (state.compoundEditContext ?? null) !== target.compoundEditContext
    || state.timelineFps !== target.timelineFps) return false
  const current = findTransitionCutTarget(state, { trackId: target.trackId,
    time: target.editPoint, pixelsPerSecond: 1, radiusPx: 0, allowExisting })
  return Boolean(current && current.clipA === target.clipA && current.clipB === target.clipB
    && current.transition === target.transition)
}
