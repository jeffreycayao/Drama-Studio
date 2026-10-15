const EPSILON = 1e-7
const finite = value => typeof value === 'number' && Number.isFinite(value)
const positive = value => finite(value) && value > 0
const fail = reason => ({ ok: false, changed: false, reason })
const clone = value => structuredClone(value)
export const isCompoundClip = clip => clip?.type === 'compound'
export const isCompoundLocked = value => Boolean(value?.locked || value?.syncLocked || value?.lockMode === 'sync' || value?.syncLock?.mode === 'sync')
export const isCompoundCacheBusy = clip => ['rendering', 'building', 'queued', 'processing', 'generating', 'running'].includes(clip?.cacheStatus)
  || ['rendering', 'building', 'queued', 'processing', 'generating', 'running'].includes(clip?.opticalFlowCache?.status)
  || Boolean(clip?.opticalFlowCache?.jobId)
const hasInserts = value => Array.isArray(value) && value.some(item => item && item.enabled !== false)
const caption = value => Boolean(value?.role === 'captions' || value?.captionScope || value?.metadata?.captionScope
  || value?.overlayKind === 'captions' || value?.settings?.overlayKind === 'captions' || value?.settings?.captionScope)
const overlaps = (a, b) => a.startTime < b.startTime + b.duration - EPSILON && a.startTime + a.duration > b.startTime + EPSILON
const supportedTypes = new Set(['video', 'image', 'text', 'shape', 'audio'])

function validateChildClip(clip, track) {
  if (!clip || !supportedTypes.has(clip.type) || caption(clip) || clip.compound) return fail('Compounds can contain video, images, text, shapes, and audio only. Nested compounds, captions, and adjustment layers are not supported yet.')
  if (!track || caption(track) || track.type !== (clip.type === 'audio' ? 'audio' : 'video')) return fail('Each child clip needs a matching normal video or audio track.')
  if (!finite(clip.startTime) || clip.startTime < 0 || !positive(clip.duration)) return fail('A child clip has invalid timing.')
  if (clip.trackMatte && clip.trackMatte !== 'none') return fail('Track-matte dependencies cannot be moved into a compound yet.')
  if (clip.compositeLowerLayers === 'off' || clip.transform?.blendMode && clip.transform.blendMode !== 'normal'
    || clip.blendMode && clip.blendMode !== 'normal') return fail('Compounds require normal blending and self-contained compositing.')
  return { ok: true }
}

export function validateCompoundDocument(document) {
  try {
    if (!document || !positive(document.fps) || !positive(document.width) || !positive(document.height) || !positive(document.duration)
      || !Array.isArray(document.clips) || !Array.isArray(document.tracks) || !Array.isArray(document.transitions || [])) return fail('The compound document has invalid settings or content.')
    if ((document.transitions || []).length) return fail('Transitions inside compounds are not supported yet. Remove them before returning or saving.')
    if ((document.masterAudioVolume ?? 100) !== 100 || hasInserts(document.masterAudioInserts)) return fail('Keep the compound master at 100% with no active inserts; the parent master applies once.')
    const trackIds = new Set()
    for (const track of document.tracks) {
      if (!track?.id || trackIds.has(track.id) || !['video', 'audio'].includes(track.type) || caption(track)) return fail('The compound has an unsupported or ambiguous track.')
      trackIds.add(track.id)
      if (track.solo) return fail('Turn off solo before creating, returning from, or saving a compound.')
      if (track.type === 'audio' && hasInserts(track.inserts)) return fail('Audio track inserts inside compounds are not supported yet.')
    }
    const clipIds = new Set()
    for (const clip of document.clips) {
      if (!clip?.id || clipIds.has(clip.id)) return fail('The compound has ambiguous child clip IDs.')
      clipIds.add(clip.id)
      const result = validateChildClip(clip, document.tracks.find(track => track.id === clip.trackId))
      if (!result.ok) return result
    }
    return { ok: true }
  } catch (_) { return fail('The compound document cannot be validated safely.') }
}

export function getCompoundDocumentExtent(document, minimum = 0) {
  return Math.max(minimum, positive(document?.duration) ? document.duration : 0,
    ...(document?.clips || []).map(clip => Number(clip.startTime) + Number(clip.duration)))
}

export function buildCreateCompoundPlan({ clips, tracks, transitions = [], markers = [], clipIds, name = 'Compound', width, height, fps, clipCounter = 1 } = {}) {
  try {
    if (!Array.isArray(clips) || !Array.isArray(tracks) || !Array.isArray(transitions) || !Array.isArray(clipIds) || !clipIds.length) return fail('Select the layers to put into a compound.')
    if (!positive(fps) || !positive(width) || !positive(height)) return fail('A compound needs known timeline dimensions and frame rate.')
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 160) return fail('Enter a compound name between 1 and 160 characters.')
    if (tracks.some(track => track.solo)) return fail('Turn off track solo before creating a compound.')
    const selectedIds = new Set(clipIds)
    if (selectedIds.size !== clipIds.length || clipIds.some(id => clips.filter(clip => clip.id === id).length !== 1)) return fail('The selected clips changed or contain ambiguous IDs.')
    const selected = clips.filter(clip => selectedIds.has(clip.id))
    for (const clip of selected) {
      const matchingTracks = tracks.filter(track => track.id === clip.trackId)
      const track = matchingTracks[0]
      if (matchingTracks.length !== 1) return fail('A selected clip has an ambiguous track.')
      const normalized = clip.type === 'video' && track.type === 'audio' ? { ...clip, type: 'audio' } : clip
      const valid = validateChildClip(normalized, track)
      if (!valid.ok) return valid
      if (isCompoundLocked(clip) || isCompoundLocked(track)) return fail('Unlock the selected clips and tracks before creating a compound.')
      if (isCompoundCacheBusy(clip)) return fail('Wait for selected clip render jobs to finish before creating a compound.')
      if (track.type === 'audio' && hasInserts(track.inserts)) return fail('Disable audio track inserts before creating a compound; separate bus processing cannot be preserved yet.')
      if (clip.linkGroupId && clips.some(other => other.linkGroupId === clip.linkGroupId && !selectedIds.has(other.id))) return fail('Select the complete linked picture/audio group before creating a compound.')
    }
    if (transitions.some(item => [item.clipId, item.clipAId, item.clipBId].some(id => selectedIds.has(id)))) return fail('Remove transitions attached to the selected layers before creating a compound.')
    const startTime = Math.min(...selected.map(clip => clip.startTime))
    const endTime = Math.max(...selected.map(clip => clip.startTime + clip.duration))
    const duration = endTime - startTime
    const visualIndexes = selected.filter(clip => tracks.find(track => track.id === clip.trackId)?.type === 'video')
      .map(clip => tracks.findIndex(track => track.id === clip.trackId))
    const topIndex = visualIndexes.length ? Math.min(...visualIndexes) : tracks.findIndex(track => track.type === 'video' && !caption(track) && !isCompoundLocked(track) && track.visible !== false && !track.muted)
    const bottomIndex = visualIndexes.length ? Math.max(...visualIndexes) : topIndex
    const destination = tracks[topIndex]
    if (!destination || destination.type !== 'video' || caption(destination) || isCompoundLocked(destination) || destination.visible === false || destination.muted) return fail('A compound needs an active, unlocked video destination track.')
    for (const other of clips) {
      if (selectedIds.has(other.id)) continue
      const index = tracks.findIndex(track => track.id === other.trackId)
      if (tracks[index]?.type === 'video' && index >= topIndex && index <= bottomIndex && overlaps(other, { startTime, duration })) {
        return fail('An unselected visual layer is interleaved with this selection. Include it or choose a self-contained stack.')
      }
    }
    const usedTrackIds = new Set(selected.map(clip => clip.trackId))
    const childTracks = clone(tracks.filter(track => usedTrackIds.has(track.id)))
    const childClips = clone(selected).map(clip => ({ ...clip, startTime: clip.startTime - startTime,
      ...(tracks.find(track => track.id === clip.trackId)?.type === 'audio' ? { type: 'audio' } : {}) }))
    const document = { fps, width, height, duration, zoom: 100, tracks: childTracks, clips: childClips,
      transitions: [], markers: [], clipCounter, transitionCounter: 1, markerCounter: 1,
      masterAudioVolume: 100, masterAudioInserts: [], snappingEnabled: true, snappingThreshold: 10, rippleEditMode: false }
    const valid = validateCompoundDocument(document)
    if (!valid.ok) return valid
    let counter = Math.max(1, Number.isInteger(clipCounter) ? clipCounter : 1)
    while (clips.some(clip => clip.id === `clip-${counter}`)) counter++
    const compoundClip = { id: `clip-${counter}`, type: 'compound', name: name.trim(), trackId: destination.id,
      assetId: null, startTime, duration, sourceDuration: duration, trimStart: 0, trimEnd: duration,
      sourceTimeScale: 1, speed: 1, reverse: false, timelineFps: fps, sourceFps: fps,
      enabled: true, color: '#527a88', compositeLowerLayers: 'on',
      transform: { positionX: 0, positionY: 0, scaleX: 100, scaleY: 100, opacity: 100, rotation: 0, blendMode: 'normal' },
      compound: { version: 1, document } }
    return { ok: true, changed: true, clips: [...clips.filter(clip => !selectedIds.has(clip.id)), compoundClip],
      compoundClip, clipCounter: counter + 1,
      summary: { clipCount: selected.length, startTime, duration, width, height, fps, name: name.trim(), compoundClipId: compoundClip.id, targetTrackId: destination.id } }
  } catch (_) { return fail('The selected content cannot be compounded safely. No changes were made.') }
}

// One-level recursive sanitation: child cache descriptors are portable, but
// decoded URLs and in-flight job state belong to the current renderer only.
export function sanitizeCompoundChildren(clip, sanitizeClip) {
  if (!isCompoundClip(clip)) return clip
  if (clip.compound?.version !== 1) throw new Error('Unsupported compound version.')
  const document = clip.compound.document
  const valid = validateCompoundDocument(document)
  if (!valid.ok) throw new Error(valid.reason)
  return { ...clip, compound: { version: 1, document: { ...document, clips: document.clips.map(sanitizeClip) } } }
}
