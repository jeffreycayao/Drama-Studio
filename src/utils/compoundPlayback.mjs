import { hasVideoSolo, isVideoTrackVisible } from './videoTrackVisibility.js'
import { hasAudioSolo, isAudioTrackAudible } from './audioTrackAudibility.js'
import { getClipPlaybackWindow } from '../../electron/audioMixEligibility.mjs'
import { validateCompoundDocument } from './compoundDocument.mjs'
export { getClipPlaybackWindow } from '../../electron/audioMixEligibility.mjs'

const EMPTY = Object.freeze([])
const expansions = new WeakMap()
const OUTER_TRANSFORM_DEFAULTS = { positionX: 0, positionY: 0, positionZ: 0, scaleX: 100, scaleY: 100, scaleLinked: true,
  opacity: 100, rotation: 0, rotationX: 0, rotationY: 0, blendMode: 'normal', anchorX: 50, anchorY: 50,
  cropTop: 0, cropBottom: 0, cropLeft: 0, cropRight: 0, flipX: false, flipY: false, blur: 0,
  flipH: false, flipV: false, perspective: 1200, motionBlurEnabled: false,
  motionBlurMode: 'auto', motionBlurSamples: 8, motionBlurShutter: 180 }

// A container limits WHEN its children are visible, without changing the
// children's authored clocks. In particular, never move keyframes, restart
// fades or reintegrate a speed ramp when the outer clip is trimmed.
export function isClipInPlaybackWindow(clip, time) {
  const { start, end } = getClipPlaybackWindow(clip)
  return time >= start && time < end
}

function expand(clips, tracks, transitions) {
  const resultClips = [], resultTracks = [], errors = []
  const parentVideoSolo = hasVideoSolo(tracks)
  const parentAudioSolo = hasAudioSolo(tracks)
  const takenIds = new Set([...clips, ...tracks, ...transitions].map(item => item.id))
  const id = (parentId, kind, originalId) => {
    const base = `compound/${encodeURIComponent(parentId)}/${kind}/${encodeURIComponent(originalId)}`
    let next = base
    while (takenIds.has(next)) next = `_${next}`
    takenIds.add(next)
    return next
  }
  for (const track of tracks) {
    for (const parent of clips.filter(clip => clip.type === 'compound' && clip.trackId === track.id)) {
      const document = parent.compound?.document
      if (parent.compound?.version !== 1 || !Array.isArray(document?.clips) || !Array.isArray(document?.tracks)
        || document.clips.some(clip => clip.type === 'compound')) {
        errors.push(`Compound “${parent.name || parent.id}” has unsupported contents.`)
        continue
      }
      const validation = validateCompoundDocument(document)
      if (!validation.ok) { errors.push(`Compound “${parent.name || parent.id}”: ${validation.reason}`); continue }
      if (!Number.isFinite(parent.startTime) || parent.startTime < 0 || !Number.isFinite(parent.duration) || parent.duration <= 0
        || !Number.isFinite(parent.trimStart) || parent.trimStart < 0
        || parent.reverse || (parent.speed ?? 1) !== 1 || (parent.sourceTimeScale ?? 1) !== 1
        || parent.effects?.length || Object.keys(parent.keyframes || {}).length
        || Object.keys(parent.adjustments || {}).length || parent.shapeMask || parent.trackMatte
        || Object.entries(parent.transform || {}).some(([key, value]) => value !== OUTER_TRANSFORM_DEFAULTS[key])) {
        errors.push(`Compound “${parent.name || parent.id}” has unsupported outer timing or effects. Edit its layers instead.`)
        continue
      }
      const { start, end } = getClipPlaybackWindow(parent)
      const offset = parent.startTime - (parent.trimStart || 0)
      const visible = parent.enabled !== false && isVideoTrackVisible(track, parentVideoSolo)
      const childVideoSolo = hasVideoSolo(document.tracks)
      const childAudioSolo = hasAudioSolo(document.tracks)
      const trackIds = new Map(document.tracks.map(childTrack => [childTrack.id, id(parent.id, 'track', childTrack.id)]))
      const clipIds = new Map(document.clips.map(child => [child.id, id(parent.id, 'clip', child.id)]))
      // Child video tracks occupy the container's one stack position. First
      // version eligibility excludes backdrop-dependent composites/mattes.
      for (const childTrack of document.tracks) {
        const video = childTrack.type === 'video'
        const childVisible = video ? isVideoTrackVisible(childTrack, childVideoSolo)
          : isAudioTrackAudible(childTrack, childAudioSolo)
        resultTracks.push({ ...childTrack, id: trackIds.get(childTrack.id),
          compoundParentId: parent.id, compoundSourceTrackId: childTrack.id,
          visible: visible && childVisible,
          muted: !visible || !childVisible || (!video && parentAudioSolo),
          // Fold inner solos into visibility; retain only the parent's video
          // solo for the outer compositor's existing global solo predicate.
          solo: video && track.solo === true,
        })
      }
      for (const child of document.clips) {
        if (!trackIds.has(child.trackId)) { errors.push(`Compound “${parent.name || parent.id}” has a missing child track.`); continue }
        resultClips.push({ ...child,
          id: clipIds.get(child.id), trackId: trackIds.get(child.trackId),
          compoundParentId: parent.id, compoundSourceClipId: child.id,
          startTime: offset + child.startTime,
          playbackWindowStart: start, playbackWindowEnd: end,
          enabled: visible && child.enabled !== false,
          // No renderer-side job may attach a source bake to a virtual ID.
          // Child source effects remain live; source-frame interpolation has
          // its own signature and can keep using a valid original cache.
          cacheStatus: 'none', cacheProgress: 0, cacheUrl: null, cachePath: null,
          cacheKind: null, cacheSignature: null,
          linkGroupId: child.linkGroupId ? `compound/${encodeURIComponent(parent.id)}/link/${encodeURIComponent(child.linkGroupId)}` : undefined,
        })
      }
    }
    resultTracks.push(track)
  }
  resultClips.push(...clips.filter(clip => clip.type !== 'compound'))
  for (const parent of clips.filter(clip => clip.type === 'compound' && !tracks.some(track => track.id === clip.trackId))) {
    errors.push(`Compound “${parent.name || parent.id}” has no parent track.`)
  }
  return { clips: resultClips, tracks: resultTracks, transitions, compoundRenderErrors: errors }
}

// Only render consumers use this projection. Editor stores, history, assets,
// and project serialization retain the original compound and child document.
export function getCompoundRenderState(state) {
  if (state?.isCompoundRenderState || !state?.clips?.some(clip => clip.type === 'compound')) return state
  const { clips, tracks = EMPTY, transitions = EMPTY } = state
  let byTracks = expansions.get(clips)
  if (!byTracks) { byTracks = new WeakMap(); expansions.set(clips, byTracks) }
  let byTransitions = byTracks.get(tracks)
  if (!byTransitions) { byTransitions = new WeakMap(); byTracks.set(tracks, byTransitions) }
  let projection = byTransitions.get(transitions)
  if (!projection) { projection = expand(clips, tracks, transitions); byTransitions.set(transitions, projection) }
  const result = { ...state, ...projection, isCompoundRenderState: true }
  if (typeof state.getActiveClipsAtTime === 'function') result.getActiveClipsAtTime = time => state.getActiveClipsAtTime(time, result)
  if (typeof state.getTransitionAtTime === 'function') result.getTransitionAtTime = time => state.getTransitionAtTime(time, result)
  // The leaves can extend outside the outer window; program duration is
  // defined by the authored top-level document, never by hidden handles.
  result.getTimelineEndTime = () => clips.reduce((end, clip) => Math.max(end, clip.startTime + clip.duration), 0)
  return result
}
