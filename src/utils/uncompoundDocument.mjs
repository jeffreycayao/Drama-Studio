import { validateCompoundDocument, isCompoundLocked, isCompoundCacheBusy } from './compoundDocument.mjs'
import { getCompoundRenderState } from './compoundPlayback.mjs'
import { getClipPlaybackTimingAtTimeline } from './clipPlaybackTiming.js'
import { shiftAudioVolumeEnvelope } from './audioVolumeEnvelope.mjs'
import { getAudioClipFadeValues } from './audioClipFades.js'

const EPSILON = 1e-7
const finite = value => typeof value === 'number' && Number.isFinite(value)
const positive = value => finite(value) && value > 0
const close = (a, b) => Math.abs(a - b) <= EPSILON
const fail = reason => ({ ok: false, changed: false, reason })
const label = clip => clip.name || clip.id
const temporalEffects = new Set(['cameraShake', 'filmGrain', 'vhsDamage', 'glslCameraShake', 'glslDigitalGlitch',
  'glslFilmGrain', 'glslFilmLook', 'glslFlicker', 'glslVhsLook'])
const clearCaches = clip => ({ ...clip, cacheStatus: 'none', cacheProgress: 0, cacheUrl: null,
  cachePath: null, cacheKind: null, cacheSignature: null })
const hasContent = value => value && (typeof value !== 'object' || Object.values(value).some(hasContent))

function sliceFailure(clip, from, to) {
  if (Array.isArray(clip.keyframes?.speed) && clip.keyframes.speed.length || hasContent(clip.speedRamp) || hasContent(clip.timeRemap)) {
    return 'a speed ramp whose sampled source clock cannot be cropped exactly'
  }
  if (clip.transform?.motionBlurEnabled === true || clip.transform?.motionBlur === true) return 'motion blur that samples outside the new clip edges'
  if (from > EPSILON && clip.effects?.some(effect => temporalEffects.has(effect.type))) return 'a procedural effect whose local-time phase would restart'
  if (hasContent(clip.animation) || hasContent(clip.animations)) return 'an opaque animation clock'
  // Runtime-supported transform, shape-mask and effect animation uses the
  // one top-level keyframe map. Unknown nested clocks cannot be rebased safely.
  const nestedClock = value => value && typeof value === 'object' && Object.entries(value).some(([key, child]) =>
    ['keyframes', 'animation', 'animations', 'timeRemap', 'speedRamp'].includes(key) && hasContent(child) || nestedClock(child))
  if (nestedClock(clip.effects) || nestedClock(clip.shapeMask)) return 'an unsupported nested animation clock'
  const { duration, fadeIn, fadeOut } = getAudioClipFadeValues(clip)
  if (fadeIn && (from > EPSILON && from < fadeIn - EPSILON || close(from, 0) && to < fadeIn - EPSILON)
    || fadeOut && (to < duration - EPSILON && to > duration - fadeOut + EPSILON || close(to, duration) && from > duration - fadeOut + EPSILON)) {
    return 'an audio fade cut through its ramp'
  }
  return null
}

function sliceChild(clip, from, to, startTime, fps) {
  const duration = to - from
  const partial = !close(from, 0) || !close(to, clip.duration)
  if (!partial) return { ok: true, clip: { ...structuredClone(clip), startTime } }
  const issue = sliceFailure(clip, from, to)
  if (issue) return fail(`Cannot uncompound the cropped portion of “${label(clip)}”: ${issue}. Extend the compound to include the whole child or adjust that child first.`)
  if (clip.effects?.some(effect => effect.type === 'mask' && effect.maskAssetId)
    && !positive(clip.sourceDuration) && clip.sourceDuration !== Infinity) {
    return fail(`Cannot crop the raster mask on “${label(clip)}” without a known source duration. Extend the compound to include the whole child first.`)
  }
  const sourceTimeScale = positive(clip.sourceTimeScale) ? clip.sourceTimeScale
    : positive(clip.timelineFps) && positive(clip.sourceFps) ? clip.timelineFps / clip.sourceFps : 1
  const scale = sourceTimeScale * (positive(clip.speed) ? clip.speed : 1)
  const trimStart = finite(clip.trimStart) ? clip.trimStart : 0
  const trimEnd = finite(clip.trimEnd) ? clip.trimEnd
    : finite(clip.sourceDuration) ? clip.sourceDuration : trimStart + clip.duration * scale
  const media = ['video', 'audio'].includes(clip.type)
  if (media && (trimStart < 0 || trimEnd - trimStart + EPSILON < clip.duration * scale
    || positive(clip.sourceDuration) && trimEnd > clip.sourceDuration + EPSILON)) {
    return fail(`Cannot crop “${label(clip)}” without changing its frozen or invalid source bounds. Extend the compound to include the whole child first.`)
  }
  const fades = getAudioClipFadeValues(clip)
  const sliced = { ...structuredClone(clip), startTime, duration,
    trimStart: clip.reverse ? trimEnd - to * scale : trimStart + from * scale,
    trimEnd: clip.reverse ? trimEnd - from * scale : trimStart + to * scale,
    ...(clip.fadeIn != null ? { fadeIn: close(from, 0) ? fades.fadeIn : 0 } : {}),
    ...(clip.fadeOut != null ? { fadeOut: close(to, clip.duration) ? fades.fadeOut : 0 } : {}),
    ...(clip.volumeEnvelope != null ? { volumeEnvelope: shiftAudioVolumeEnvelope(clip, from) } : {}),
  }
  if (clip.keyframes != null) {
    if (typeof clip.keyframes !== 'object' || Array.isArray(clip.keyframes)) return fail(`“${label(clip)}” has invalid keyframes.`)
    sliced.keyframes = {}
    for (const [property, points] of Object.entries(clip.keyframes)) {
      if (!Array.isArray(points) || points.some(point => !finite(point?.time))) return fail(`“${label(clip)}” has invalid keyframe times.`)
      sliced.keyframes[property] = points.map(point => ({ ...structuredClone(point), time: point.time - from }))
    }
  }
  if (media) {
    // Constant clocks only differ at a trim clamp, so checking both visible
    // frame boundaries proves every intervening affine sample is unchanged.
    // Different preview paths use these two source-end safety offsets.
    const first = Math.ceil((startTime - EPSILON) * fps) / fps
    const last = Math.ceil((startTime + duration - EPSILON) * fps) / fps - 1 / fps
    for (const time of [first, last]) {
      if (time < startTime - EPSILON || time >= startTime + duration - EPSILON) continue
      for (const endOffset of [0.01, 0.001, 0]) {
        const previous = getClipPlaybackTimingAtTimeline(clip, clip.startTime + from + time - startTime, endOffset, { useFrameSampling: false })
        const next = getClipPlaybackTimingAtTimeline(sliced, time, endOffset, { useFrameSampling: false })
        if (!close(previous.time, next.time)) return fail(`Cannot crop “${label(clip)}” without changing source-boundary frame sampling. Extend the compound to include the whole child first.`)
      }
    }
  }
  return { ok: true, clip: sliced }
}

/** Replace exactly one embedded document with real, editable visible clips.
 * No render-only playback windows are retained, and no disk caches are deleted. */
export function buildUncompoundPlan({ clips = [], tracks = [], transitions = [], markers = [], clipId,
  clipCounter = 1, markerCounter = 1, fps = 24 } = {}) {
  try {
    if (![clips, tracks, transitions, markers].every(Array.isArray) || !positive(fps)) return fail('The timeline data or frame rate is invalid.')
    if (new Set(clips.map(clip => clip?.id)).size !== clips.length || new Set(tracks.map(track => track?.id)).size !== tracks.length) return fail('Resolve ambiguous timeline IDs before uncompounding.')
    const parent = clips.find(clip => clip.id === clipId)
    if (parent?.type !== 'compound' || parent.compound?.version !== 1) return fail('Select one current top-level compound to uncompound.')
    const parentTrack = tracks.find(track => track.id === parent.trackId)
    const document = parent.compound.document
    const valid = validateCompoundDocument(document)
    if (!valid.ok) return valid
    if (!parentTrack || parentTrack.type !== 'video' || parentTrack.role === 'captions') return fail('The compound needs a normal video parent track.')
    if (tracks.some(track => track.solo)) return fail('Turn off track solo before uncompounding.')
    if (parentTrack.visible === false || parentTrack.muted || parent.enabled === false) return fail('Enable the compound and its parent track before uncompounding.')
    if (isCompoundLocked(parent) || isCompoundLocked(parentTrack) || document.clips.some(isCompoundLocked) || document.tracks.some(isCompoundLocked)) return fail('Unlock the compound, its children, and their tracks before uncompounding.')
    if (isCompoundCacheBusy(parent) || document.clips.some(isCompoundCacheBusy)) return fail('Wait for compound and child render jobs to finish before uncompounding.')
    if (parent.linkGroupId || transitions.some(item => [item.clipId, item.clipAId, item.clipBId].includes(parent.id))) return fail('Remove parent links and transitions before uncompounding.')
    if (!close(document.fps, fps)) return fail('The child and parent frame rates must match before uncompounding.')
    const projection = getCompoundRenderState({ clips: [parent], tracks, transitions: [] })
    if (projection.compoundRenderErrors.length) return fail(projection.compoundRenderErrors[0])
    const sourceStart = parent.trimStart, sourceEnd = parent.trimStart + parent.duration
    if (!positive(parent.sourceDuration) || sourceEnd > parent.sourceDuration + EPSILON) return fail('The compound has invalid source bounds.')
    const retained = []
    let omittedClipCount = 0, croppedClipCount = 0
    for (const child of document.clips) {
      const start = Math.max(sourceStart, child.startTime), end = Math.min(sourceEnd, child.startTime + child.duration)
      if (end <= start + EPSILON) { omittedClipCount++; continue }
      if (child.opticalFlowCache?.status === 'hydrating') return fail(`Wait for Optical Flow cache verification on “${label(child)}” before uncompounding.`)
      if (end - start < 1 / fps - EPSILON) return fail(`Uncompounding would leave less than one frame of “${label(child)}”. Adjust the compound trim first.`)
      const from = start - child.startTime, to = end - child.startTime
      const result = sliceChild(child, from, to, parent.startTime + start - sourceStart, fps)
      if (!result.ok) return result
      if ([result.clip.startTime, result.clip.duration].some(time => !close(time, Math.round(time * fps) / fps))) {
        return fail(`“${label(child)}” would land between timeline frames and shift after saving. Align the compound and child edges to frames before uncompounding.`)
      }
      if (['video', 'audio'].includes(child.type)) {
        const output = result.clip
        const baseScale = positive(output.sourceTimeScale) ? output.sourceTimeScale
          : positive(output.timelineFps) && positive(output.sourceFps) ? output.timelineFps / output.sourceFps : 1
        const scale = baseScale * (positive(output.speed) ? output.speed : 1)
        // Ordinary loading canonicalizes video scale and media trim spans.
        // Embedded children deliberately bypass that legacy normalization.
        // Do not emit a clip that changes on its first save/reopen.
        if (child.type === 'video' && !close(baseScale, 1)
          || !finite(output.trimStart) || !finite(output.trimEnd)
          || !close(output.trimEnd - output.trimStart, output.duration * scale)) {
          return fail(`“${label(child)}” uses noncanonical source timing that ordinary clips cannot preserve after saving. Adjust its source timing before uncompounding.`)
        }
      }
      if (!close(from, 0) || !close(to, child.duration)) croppedClipCount++
      retained.push({ source: child, clip: result.clip })
    }
    if (!retained.length) return fail('No child clips intersect the visible compound range. Extend its trim or open it to add layers first.')
    const childMarkers = document.markers || []
    if (!Array.isArray(childMarkers) || new Set(childMarkers.map(marker => marker?.id)).size !== childMarkers.length
      || new Set(markers.map(marker => marker?.id)).size !== markers.length
      || [...markers, ...childMarkers].some(marker => !marker?.id || !finite(marker.time) || marker.time < 0)) {
      return fail('Resolve invalid or ambiguous markers before uncompounding.')
    }
    const usedIds = new Set([...clips, ...tracks, ...markers, ...childMarkers, ...document.clips, ...document.tracks].map(item => item.id))
    let counter = Math.max(1, Number.isSafeInteger(clipCounter) ? clipCounter : 1)
    for (const id of usedIds) {
      const match = /^clip-(\d+)$/.exec(String(id))
      if (match) counter = Math.max(counter, Number(match[1]) + 1)
    }
    const allocateClipId = () => {
      while (usedIds.has(`clip-${counter}`)) counter++
      if (!Number.isSafeInteger(counter)) throw new Error('Clip ID range exhausted.')
      const id = `clip-${counter++}`; usedIds.add(id); return id
    }
    const clipIds = new Map(retained.map(({ source }) => [source.id, allocateClipId()]))
    const trackIds = new Map()
    const usedTrackIds = new Set(retained.map(({ source }) => source.trackId))
    const restoredTracks = document.tracks.filter(track => usedTrackIds.has(track.id)).map(track => {
      let index = 1
      while (usedIds.has(`${track.type}-${index}`)) index++
      const id = `${track.type}-${index}`; usedIds.add(id); trackIds.set(track.id, id)
      return { ...structuredClone(track), id }
    })
    const existingGroups = new Set(clips.map(clip => clip.linkGroupId).filter(Boolean))
    const groups = new Map()
    for (const { source } of retained) if (source.linkGroupId && !groups.has(source.linkGroupId)) {
      let id = `link-uncompound-${clipIds.get(source.id)}`
      while (existingGroups.has(id)) id += '-new'
      existingGroups.add(id); groups.set(source.linkGroupId, id)
    }
    const restoredClips = retained.map(({ source, clip }) => {
      const restored = clearCaches({ ...clip, id: clipIds.get(source.id), trackId: trackIds.get(source.trackId),
        ...(source.linkGroupId ? { linkGroupId: groups.get(source.linkGroupId) } : {}) })
      for (const field of ['compoundParentId', 'compoundSourceClipId', 'playbackWindowStart', 'playbackWindowEnd']) delete restored[field]
      for (const field of ['linkedVideoClipId', 'linkedAudioClipId']) {
        if (source.metadata?.[field] != null) {
          restored.metadata = { ...restored.metadata }
          if (clipIds.has(source.metadata[field])) restored.metadata[field] = clipIds.get(source.metadata[field])
          else delete restored.metadata[field]
        }
      }
      return restored
    })
    const nextTracks = []
    let insertedAudio = false
    for (const track of tracks) {
      if (track.id === parent.trackId) nextTracks.push(...restoredTracks.filter(item => item.type === 'video'))
      if (track.type === 'audio' && !insertedAudio) { nextTracks.push(...restoredTracks.filter(item => item.type === 'audio')); insertedAudio = true }
      nextTracks.push(track)
    }
    if (!insertedAudio) nextTracks.push(...restoredTracks.filter(item => item.type === 'audio'))
    let nextMarkerCounter = Math.max(1, Number.isSafeInteger(markerCounter) ? markerCounter : 1)
    for (const id of usedIds) {
      const match = /^marker-(\d+)$/.exec(String(id))
      if (match) nextMarkerCounter = Math.max(nextMarkerCounter, Number(match[1]) + 1)
    }
    let omittedMarkerCount = 0
    const restoredMarkers = []
    for (const marker of childMarkers) {
      if (marker.time < sourceStart - EPSILON || marker.time > sourceEnd + EPSILON) { omittedMarkerCount++; continue }
      while (usedIds.has(`marker-${nextMarkerCounter}`)) nextMarkerCounter++
      if (!Number.isSafeInteger(nextMarkerCounter)) throw new Error('Marker ID range exhausted.')
      const id = `marker-${nextMarkerCounter++}`; usedIds.add(id)
      restoredMarkers.push({ ...structuredClone(marker), id, time: parent.startTime - sourceStart + marker.time })
    }
    const warnings = []
    if (omittedClipCount) warnings.push(`${omittedClipCount} child clip${omittedClipCount === 1 ? '' : 's'} outside the visible compound range will not be restored. Undo restores the complete compound.`)
    if (croppedClipCount) warnings.push(`${croppedClipCount} child clip${croppedClipCount === 1 ? '' : 's'} will be trimmed to the visible compound range; offscreen keyframes remain editable.`)
    if (omittedMarkerCount) warnings.push(`${omittedMarkerCount} child marker${omittedMarkerCount === 1 ? '' : 's'} outside the visible compound range will not be restored. Undo restores them.`)
    return { ok: true, changed: true, clips: [...clips.filter(clip => clip !== parent), ...restoredClips], tracks: nextTracks,
      markers: [...markers, ...restoredMarkers].sort((a, b) => a.time - b.time), markerCounter: nextMarkerCounter,
      clipCounter: counter, restoredClipIds: restoredClips.map(clip => clip.id), summary: { compoundName: label(parent),
        clipCount: restoredClips.length, omittedClipCount, croppedClipCount, trackCount: restoredTracks.length,
        markerCount: restoredMarkers.length, omittedMarkerCount,
        startTime: parent.startTime, duration: parent.duration, warnings } }
  } catch (_) { return fail('The compound cannot be restored safely. No changes were made.') }
}
