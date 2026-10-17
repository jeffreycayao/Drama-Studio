// Layer placement for the timeline: where a new or moved clip lands so it
// never cuts what is already there. Pure functions; the store applies them.
//
// Track order: `tracks` lists video tracks top-to-bottom, then audio tracks.
// The bottom-most video track that is not the captions track is the main
// track (the base picture). Overlays (text, shapes, adjustment layers, image
// overlays) never land on it when placed automatically.

const EPSILON = 1e-6

const isCaptions = (track) => track?.role === 'captions'
const finite = (value) => typeof value === 'number' && Number.isFinite(value)

export function getVideoLayerTracks(tracks = []) {
  return (tracks || []).filter((track) => track?.type === 'video' && !isCaptions(track))
}

/** The base picture track: the bottom-most non-captions video track. */
export function getMainVideoTrack(tracks = []) {
  const videoTracks = getVideoLayerTracks(tracks)
  return videoTracks.length > 0 ? videoTracks[videoTracks.length - 1] : null
}

export function isMainVideoTrack(tracks, trackId) {
  return Boolean(trackId) && getMainVideoTrack(tracks)?.id === trackId
}

/** True when no clip on the track overlaps [startTime, startTime + duration). */
export function isTrackRangeFree(clips, trackId, startTime, duration, ignoreClipIds = []) {
  const ignore = ignoreClipIds instanceof Set ? ignoreClipIds : new Set(ignoreClipIds || [])
  const start = Number(startTime) || 0
  const end = start + Math.max(0, Number(duration) || 0)
  return !(clips || []).some((clip) => (
    clip
    && clip.trackId === trackId
    && !ignore.has(clip.id)
    && clip.startTime < end - EPSILON
    && clip.startTime + clip.duration > start + EPSILON
  ))
}

// A track the app may pick by itself: unlocked, not captions, and actually
// seen or heard (a hidden or muted lane would swallow the new clip).
function isAutoUsable(track) {
  if (!track || track.locked || isCaptions(track)) return false
  if (track.type === 'video') return track.visible !== false
  return track.muted !== true
}

// A track the user aimed at: honoured unless it is locked or captions-only.
function isTargetUsable(track) {
  return Boolean(track) && !track.locked && !isCaptions(track)
}

/**
 * Pick the layer for a clip.
 * mode 'overlay': on top of whatever is visible in the range, never the main track.
 * mode 'free': the target track if the range is free, else the adjacent layer
 *   (above for video, below for audio), else a new layer next to the target.
 * Returns { trackId } or { create: { type, beforeTrackId?, afterTrackId? } },
 * or { trackId: null, reason } when nothing fits.
 */
export function pickClipLayer({
  tracks = [], clips = [], startTime = 0, duration = 0, family = 'video',
  mode = 'free', targetTrackId = null, ignoreClipIds = [],
} = {}) {
  const ignore = new Set(ignoreClipIds || [])
  const free = (track) => isTrackRangeFree(clips, track.id, startTime, duration, ignore)
  const target = targetTrackId ? (tracks || []).find((track) => track?.id === targetTrackId) : null

  if (mode === 'overlay' && family === 'video') {
    const layers = getVideoLayerTracks(tracks)
    const main = layers[layers.length - 1] || null
    if (target && target.type === 'video' && target !== main && isTargetUsable(target) && free(target)) {
      return { trackId: target.id }
    }
    if (!main) return { create: { type: 'video', beforeTrackId: null } }
    const occupied = layers.map((track, index) => (free(track) ? -1 : index)).filter((index) => index >= 0)
    if (occupied.length > 0) {
      const top = Math.min(...occupied)
      for (let index = top - 1; index >= 0; index -= 1) {
        if (isAutoUsable(layers[index])) return { trackId: layers[index].id }
      }
      return { create: { type: 'video', beforeTrackId: layers[top].id } }
    }
    for (let index = layers.length - 2; index >= 0; index -= 1) {
      if (isAutoUsable(layers[index])) return { trackId: layers[index].id }
    }
    return { create: { type: 'video', beforeTrackId: main.id } }
  }

  if (!target || target.type !== family) {
    return { trackId: null, reason: 'The target track was not found.' }
  }
  if (isTargetUsable(target) && free(target)) return { trackId: target.id }
  if (isCaptions(target)) return { trackId: null, reason: 'The captions track only holds captions.' }

  const sameFamily = (tracks || []).filter((track) => track?.type === family && !isCaptions(track))
  const index = sameFamily.findIndex((track) => track.id === target.id)
  if (family === 'video') {
    const above = index > 0 ? sameFamily[index - 1] : null
    if (above && isAutoUsable(above) && free(above)) return { trackId: above.id }
    return { create: { type: 'video', beforeTrackId: target.id } }
  }
  const below = index >= 0 ? sameFamily[index + 1] : null
  if (below && isAutoUsable(below) && free(below)) return { trackId: below.id }
  return { create: { type: 'audio', afterTrackId: target.id } }
}

/** Mirrors timelineStore.addTrack ids and names: `video-N` / "Video N". */
export function buildLayerTrack(tracks = [], type = 'video') {
  let maxNum = 0
  const pattern = new RegExp(`^${type}-(\\d+)$`)
  for (const track of tracks || []) {
    const match = typeof track?.id === 'string' ? track.id.match(pattern) : null
    if (match) maxNum = Math.max(maxNum, Number.parseInt(match[1], 10))
  }
  const track = {
    id: `${type}-${maxNum + 1}`,
    name: `${type === 'video' ? 'Video' : 'Audio'} ${maxNum + 1}`,
    type,
    muted: false,
    locked: false,
    visible: true,
    autoLayer: true,
  }
  if (type === 'audio') track.channels = 'stereo'
  return track
}

/** Insert a new layer track where `create` says; returns { tracks, track }. */
export function insertLayerTrack(tracks = [], create = {}) {
  const type = create.type === 'audio' ? 'audio' : 'video'
  const track = buildLayerTrack(tracks, type)
  const list = [...(tracks || [])]
  let index = -1
  if (create.beforeTrackId) index = list.findIndex((candidate) => candidate.id === create.beforeTrackId)
  else if (create.afterTrackId) {
    const after = list.findIndex((candidate) => candidate.id === create.afterTrackId)
    index = after >= 0 ? after + 1 : -1
  }
  if (index < 0) {
    if (type === 'video') {
      const firstVideo = list.findIndex((candidate) => candidate.type === 'video' && !isCaptions(candidate))
      index = firstVideo >= 0 ? firstVideo : list.findIndex((candidate) => candidate.type !== 'video')
      if (index < 0) index = list.length
    } else {
      index = list.length
    }
  }
  list.splice(index, 0, track)
  return { tracks: list, track }
}

/** pickClipLayer + insertLayerTrack: { tracks, trackId, createdTrack } or null. */
export function resolveClipLayer(args = {}) {
  const tracks = args.tracks || []
  const pick = pickClipLayer(args)
  if (pick.create) {
    const { tracks: nextTracks, track } = insertLayerTrack(tracks, pick.create)
    return { tracks: nextTracks, trackId: track.id, createdTrack: track }
  }
  if (!pick.trackId) return null
  return { tracks, trackId: pick.trackId, createdTrack: null }
}

/**
 * After clips moved, send any that now sit on top of another clip to a free
 * layer. Captions-track clips are left for the caller (overwrite rules).
 * Returns { tracks, clips, createdTracks, relocated, unresolvedIds }.
 */
export function layerMovedClips({ tracks = [], clips = [], movedClipIds = [] } = {}) {
  const movedSet = new Set(movedClipIds || [])
  let nextTracks = [...(tracks || [])]
  const nextClips = [...(clips || [])]
  const createdTracks = []
  const relocated = []
  const unresolvedIds = []
  const order = () => new Map(nextTracks.map((track, index) => [track.id, index]))
  const trackOrder = order()
  const moved = nextClips
    .map((clip, index) => ({ clip, index }))
    .filter(({ clip }) => movedSet.has(clip.id))
    .sort((a, b) => (
      ((trackOrder.get(a.clip.trackId) ?? 1e9) - (trackOrder.get(b.clip.trackId) ?? 1e9))
      || (a.clip.startTime - b.clip.startTime)
      || String(a.clip.id).localeCompare(String(b.clip.id))
    ))

  for (const { index } of moved) {
    const clip = nextClips[index]
    const track = nextTracks.find((candidate) => candidate.id === clip.trackId)
    if (!track) continue
    if (isTrackRangeFree(nextClips, clip.trackId, clip.startTime, clip.duration, [clip.id])) continue
    if (isCaptions(track)) { unresolvedIds.push(clip.id); continue }
    const placement = resolveClipLayer({
      tracks: nextTracks,
      clips: nextClips,
      startTime: clip.startTime,
      duration: clip.duration,
      family: track.type,
      mode: 'free',
      targetTrackId: track.id,
      ignoreClipIds: [clip.id],
    })
    if (!placement || placement.trackId === clip.trackId) { unresolvedIds.push(clip.id); continue }
    nextTracks = placement.tracks
    if (placement.createdTrack) createdTracks.push(placement.createdTrack)
    nextClips[index] = { ...clip, trackId: placement.trackId }
    relocated.push({ clipId: clip.id, fromTrackId: clip.trackId, toTrackId: placement.trackId })
  }

  return { tracks: nextTracks, clips: nextClips, createdTracks, relocated, unresolvedIds }
}

/**
 * Remove layer tracks the app created that no longer hold clips. Never the
 * main video track, the captions track, a track the user made, or the last
 * track of its type. Returns the same array when nothing changes.
 */
export function pruneEmptyAutoLayers(tracks = [], clips = []) {
  const used = new Set((clips || []).map((clip) => clip?.trackId))
  const main = getMainVideoTrack(tracks)
  const removable = (tracks || []).filter((track) => (
    track?.autoLayer === true
    && !used.has(track.id)
    && track.id !== main?.id
    && !isCaptions(track)
  ))
  if (removable.length === 0) return tracks
  const removeIds = new Set()
  for (const track of removable) {
    const remainingOfType = (tracks || []).filter((candidate) => (
      candidate.type === track.type && !removeIds.has(candidate.id)
    )).length
    if (remainingOfType > 1) removeIds.add(track.id)
  }
  return removeIds.size > 0 ? tracks.filter((track) => !removeIds.has(track.id)) : tracks
}

const roundToFrame = (time, fps) => Math.round(time * fps) / fps

/**
 * Magnetic main track: pack the track's clips from 0 in time order, keeping
 * any overlap two neighbours already had (transition handles). Linked clips
 * on other tracks move by the same amount. `priorityClipIds` win ties, so a
 * clip dropped at an occupied start goes in front.
 * Returns { ok, changed, clips } or { ok: false, reason }.
 */
export function packMagneticTrack({ clips = [], trackId, fps = 24, priorityClipIds = [] } = {}) {
  if (!trackId) return { ok: false, changed: false, reason: 'No main track.' }
  const safeFps = finite(fps) && fps > 0 ? fps : 24
  const priority = new Set(priorityClipIds || [])
  const trackClips = (clips || [])
    .filter((clip) => clip?.trackId === trackId)
    .sort((a, b) => (
      (a.startTime - b.startTime)
      || ((priority.has(b.id) ? 1 : 0) - (priority.has(a.id) ? 1 : 0))
      || String(a.id).localeCompare(String(b.id))
    ))
  if (trackClips.length === 0) return { ok: true, changed: false, clips }

  const deltas = new Map()
  let cursor = 0
  let previous = null
  for (const clip of trackClips) {
    let start = cursor
    if (previous) {
      // Keep a pre-existing overlap (a transition between neighbours).
      const overlap = previous.startTime + previous.duration - clip.startTime
      if (overlap > EPSILON && overlap < Math.min(previous.duration, clip.duration) && !priority.has(clip.id) && !priority.has(previous.id)) {
        start = cursor - overlap
      }
    }
    start = Math.max(0, roundToFrame(start, safeFps))
    const delta = start - clip.startTime
    if (Math.abs(delta) > EPSILON) deltas.set(clip.id, delta)
    cursor = start + clip.duration
    previous = clip
  }
  if (deltas.size === 0) return { ok: true, changed: false, clips }

  // Linked partners on other tracks follow their main-track clip.
  const partnerDelta = new Map()
  for (const clip of trackClips) {
    const delta = deltas.get(clip.id)
    if (delta == null || typeof clip.linkGroupId !== 'string' || !clip.linkGroupId) continue
    for (const partner of clips) {
      if (partner.id !== clip.id && partner.trackId !== trackId && partner.linkGroupId === clip.linkGroupId) {
        partnerDelta.set(partner.id, delta)
      }
    }
  }
  const shifted = (clips || []).map((clip) => {
    const delta = deltas.get(clip.id) ?? partnerDelta.get(clip.id)
    if (delta == null) return clip
    return { ...clip, startTime: Math.max(0, roundToFrame(clip.startTime + delta, safeFps)) }
  })
  for (const clip of shifted) {
    if (!partnerDelta.has(clip.id)) continue
    const original = clips.find((candidate) => candidate.id === clip.id)
    if (original && original.startTime + partnerDelta.get(clip.id) < -EPSILON) {
      return { ok: false, changed: false, reason: 'A linked clip would move before the start of the timeline.' }
    }
    const blocked = shifted.some((other) => (
      other.id !== clip.id
      && other.trackId === clip.trackId
      && other.startTime < clip.startTime + clip.duration - EPSILON
      && other.startTime + other.duration > clip.startTime + EPSILON
    ))
    if (blocked) return { ok: false, changed: false, reason: 'A linked clip would collide with another clip.' }
  }
  return { ok: true, changed: true, clips: shifted }
}
