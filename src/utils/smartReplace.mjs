import { getClipPlaybackTimingAtTimeline } from './clipPlaybackTiming.js'
import { hasSpeedRamp } from './timeRemap.js'
import { isBetweenClipTransition } from './transitionKinds.js'

const EPSILON = 1e-7
const finite = value => typeof value === 'number' && Number.isFinite(value)
const positive = value => finite(value) && value > 0
const fail = reason => ({ ok: false, changed: false, reason })
const close = (a, b) => Math.abs(a - b) <= EPSILON
const busyStatuses = new Set(['rendering', 'building', 'queued', 'processing', 'generating', 'running'])
const locked = value => Boolean(value?.locked || value?.syncLocked || value?.lockMode === 'sync' || value?.syncLock?.mode === 'sync')
const caption = value => Boolean(value?.role === 'captions' || value?.captionScope || value?.overlayKind === 'captions'
  || value?.metadata?.captionScope || value?.settings?.overlayKind === 'captions' || value?.settings?.captionScope)

const positiveMetadata = value => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

// Imported top-level metadata is measured from the actual file. Generation
// settings can describe the requested result instead (for example a requested
// five-second generation which actually produced twenty seconds of media).
// Share this precedence with the picker so its label and fit check agree.
export function getSmartReplaceSourceMetadata(asset) {
  return {
    sourceDuration: asset?.type === 'image' ? Infinity
      : positiveMetadata(asset?.duration) ?? positiveMetadata(asset?.settings?.duration),
    sourceFps: asset?.type === 'video'
      ? positiveMetadata(asset?.fps) ?? positiveMetadata(asset?.settings?.fps) : null,
  }
}

function containsField(value, pattern, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  return Object.entries(value).some(([key, child]) => (
    pattern.test(key) && child != null && child !== false
  ) || containsField(child, pattern, seen))
}

function isSyncAsset(asset) {
  const info = asset?.yolo || asset?.settings?.yolo
  return locked(asset) || (info?.mode === 'music' && info?.stage === 'video'
    && ['performance', 'performance_wide'].includes(String(info.shotType || '').trim().toLowerCase()))
}

function transitionExtent(clip, clips, transitions, sourceDelta) {
  let start = clip.startTime
  let end = start + clip.duration
  for (const transition of transitions) {
    if (!transition || ![transition.clipId, transition.clipAId, transition.clipBId].includes(clip.id)) continue
    if (!positive(transition.duration)) return fail('A related transition has invalid timing. Fix it before replacing this source.')
    if (transition.kind === 'edge') {
      if (transition.clipId !== clip.id || !['in', 'out'].includes(transition.edge)) {
        return fail('A related edge transition is ambiguous. Fix it before replacing this source.')
      }
      continue // Edge fades never request source media outside the clip.
    }
    if (!isBetweenClipTransition(transition)) return fail('A related transition is unsupported. Remove it before replacing this source.')
    const matchesA = clips.filter(item => item.id === transition.clipAId)
    const matchesB = clips.filter(item => item.id === transition.clipBId)
    const a = matchesA[0]
    const b = matchesB[0]
    if (matchesA.length !== 1 || matchesB.length !== 1 || a === b || a.trackId !== b.trackId
      || !finite(a.startTime) || !positive(a.duration) || !finite(b.startTime) || !positive(b.duration)) {
      return fail('A related transition no longer has an unambiguous pair of clips.')
    }
    const originalTrimKey = transition.clipAId === clip.id ? 'originalClipATrimEnd' : 'originalClipBTrimStart'
    if (!close(sourceDelta, 0) && transition[originalTrimKey] != null) {
      return fail('Keep the current source In, or remove and recreate this transition before choosing a different source In. Its saved trim would otherwise become invalid.')
    }
    const duration = transition.duration
    const edit = transition.editPoint == null ? a.startTime + a.duration : transition.editPoint
    if (!finite(edit) || edit < a.startTime - EPSILON || edit > a.startTime + a.duration + EPSILON
      || edit < b.startTime - EPSILON || edit > b.startTime + b.duration + EPSILON) {
      return fail('A related transition has an invalid edit point. Fix it before replacing this source.')
    }
    const settings = transition.settings || {}
    let portionA = settings.alignment === 'start' ? 1 : settings.alignment === 'end' ? 0 : 0.5
    if (settings.split != null) {
      const { clipA, clipB } = settings.split
      if (!finite(clipA) || !finite(clipB) || clipA < 0 || clipB < 0 || !positive(clipA + clipB)) {
        return fail('A related transition has invalid handle proportions.')
      }
      portionA = clipA / (clipA + clipB)
    } else if (settings.alignment != null && !['start', 'center', 'end'].includes(settings.alignment)) {
      return fail('A related transition has unsupported alignment.')
    }
    start = Math.min(start, edit - duration * portionA)
    end = Math.max(end, edit + duration * (1 - portionA))
  }
  return { ok: true, start, end }
}

/** Replace exactly one source binding, never its authored timeline edit.
 * Bounds come from the same playback helper as preview/export, with optical
 * cache mapping disabled because this plan invalidates that old-source cache.
 * Nominal trim span is retained too, including intentional ramp freezes and
 * reverse anchors; we never silently shorten it to fit the replacement. */
function planReplacement({ clips, tracks, transitions = [], clipId, asset, sourceInSeconds, timelineFps } = {}) {
  if (!Array.isArray(clips) || !Array.isArray(tracks) || !Array.isArray(transitions)) return fail('The timeline contains unsupported data.')
  const matches = clips.filter(clip => clip?.id === clipId)
  const clip = matches[0]
  if (!clipId || matches.length !== 1) return fail('Select one unambiguous timeline clip to replace.')
  const matchingTracks = tracks.filter(track => track?.id === clip.trackId)
  const track = matchingTracks[0]
  if (matchingTracks.length !== 1 || caption(track) || caption(clip)) return fail('This clip is not on a replaceable media track.')
  const kind = track.type === 'audio' && clip.type === 'video' ? 'audio' : clip.type
  if (!['video', 'image', 'audio'].includes(kind) || track.type !== (kind === 'audio' ? 'audio' : 'video')) {
    return fail('Smart Replace supports video, image, or audio clips on matching tracks.')
  }
  if (locked(clip) || locked(track)) return fail('Unlock this clip and its track before replacing the source.')
  if (typeof asset?.id !== 'string' || !asset.id.trim() || asset.type !== kind || caption(asset)) return fail(`Choose another ${kind} asset. Smart Replace keeps the current media kind.`)
  if (isSyncAsset(asset)) return fail('This asset is tied to song timing. Use its sync-aware workflow instead.')
  if (typeof asset.url !== 'string' || !asset.url.trim()) return fail('The replacement source is unavailable. Relink or load it first.')
  if (busyStatuses.has(clip.cacheStatus) || busyStatuses.has(clip.opticalFlowCache?.status) || clip.opticalFlowCache?.jobId) {
    return fail('Wait for this clip’s render or Optical Flow job to finish before replacing its source.')
  }
  const fps = timelineFps ?? clip.timelineFps
  if (!positive(fps)) return fail('Set a known timeline frame rate before replacing this source.')
  if (!finite(clip.startTime) || clip.startTime < 0 || !positive(clip.duration)
    || !Number.isSafeInteger(Math.ceil((clip.startTime + clip.duration) * fps))) {
    return fail('This clip has invalid timeline timing.')
  }
  const oldIn = clip.trimStart ?? 0
  if (!finite(oldIn) || oldIn < 0) return fail('This clip has an invalid source In.')
  const sourceIn = sourceInSeconds === undefined ? oldIn : sourceInSeconds
  if (!finite(sourceIn) || sourceIn < 0) return fail('Enter a finite, non-negative source In in seconds.')
  if (kind === 'image' && !close(sourceIn, oldIn)) return fail('Still images do not have a replacement source In. Keep the existing trim.')
  const sourceDelta = sourceIn - oldIn
  const linkedCompanionsUnchanged = clip.linkGroupId
    ? clips.filter(item => item.id !== clip.id && item.linkGroupId === clip.linkGroupId).map(item => item.id) : []
  const summary = {
    clipId: clip.id, clipName: clip.name || clip.id, assetId: asset.id, assetName: asset.name || asset.id,
    kind, startTime: clip.startTime, duration: clip.duration, sourceInSeconds: sourceIn,
    linkedCompanionsUnchanged,
  }
  if (asset.id === clip.assetId && close(sourceDelta, 0)) return { ok: true, changed: false, updates: {}, summary, warnings: [] }

  const explicitScale = clip.sourceTimeScale
  if (explicitScale != null && !positive(explicitScale)) return fail('The clip has an invalid source time scale.')
  const oldSourceFps = clip.sourceFps
  const oldTimelineFps = clip.timelineFps
  if ((oldSourceFps != null && !positive(oldSourceFps)) || (oldTimelineFps != null && !positive(oldTimelineFps))) {
    return fail('The clip has invalid frame-rate metadata.')
  }
  const baseScale = explicitScale ?? (oldTimelineFps && oldSourceFps ? oldTimelineFps / oldSourceFps : 1)
  const speed = clip.speed ?? 1
  if (!positive(speed) || !positive(baseScale)) return fail('The clip has invalid playback speed.')
  const oldOut = clip.trimEnd ?? clip.sourceDuration ?? (oldIn + clip.duration * baseScale * speed)
  if (!finite(oldOut) || oldOut <= oldIn) return fail('The clip has an unknown or invalid nominal source trim.')
  const sourceOut = oldOut + sourceDelta
  if (!finite(sourceOut) || sourceOut <= sourceIn) return fail('The replacement source range is invalid.')
  const { sourceFps, sourceDuration } = getSmartReplaceSourceMetadata(asset)
  if (kind === 'video' && !positive(sourceFps)) return fail('Wait for the replacement video’s frame rate to load.')
  if (sourceDuration === null) return fail('Wait for a known replacement source duration. Smart Replace will not guess or freeze missing media.')
  if (hasSpeedRamp(clip) && clip.duration > 4 * 60 * 60) {
    return fail('This speed-ramped clip is too long to validate safely in one replacement. Split it first.')
  }
  const nextTiming = { ...clip, trimStart: sourceIn, trimEnd: sourceOut, sourceDuration,
    sourceFps, sourceTimeScale: baseScale, opticalFlowCache: undefined }
  const extent = transitionExtent(clip, clips, transitions, sourceDelta)
  if (!extent.ok) return extent
  let requiredSourceStart = sourceIn
  let requiredSourceEnd = sourceOut
  let playbackSourceStart = sourceIn
  let playbackSourceEnd = sourceOut
  if (kind !== 'image') {
    for (const time of [clip.startTime, clip.startTime + clip.duration, extent.start, extent.end]) {
      const timing = getClipPlaybackTimingAtTimeline(nextTiming, time, 0, { useFrameSampling: false, allowHandles: true })
      const nominal = time >= clip.startTime && time <= clip.startTime + clip.duration
      const needed = nominal ? timing.time : timing.rawTime
      if (!finite(needed)) return fail('The source timing could not be evaluated safely.')
      requiredSourceStart = Math.min(requiredSourceStart, needed)
      requiredSourceEnd = Math.max(requiredSourceEnd, needed)
      if (time === clip.startTime) playbackSourceStart = timing.time
      if (time === clip.startTime + clip.duration) playbackSourceEnd = timing.time
    }
    if (requiredSourceStart < -EPSILON || requiredSourceEnd > sourceDuration + EPSILON) {
      return { ...fail(`The replacement needs source seconds ${Math.max(0, requiredSourceStart).toFixed(3)}–${requiredSourceEnd.toFixed(3)} to preserve this trim and its transition handles, but the asset is only ${sourceDuration.toFixed(3)} seconds long.${requiredSourceStart < -EPSILON ? ' There is not enough media before the chosen source In.' : ''}`),
        summary: { ...summary, requiredSourceStart, requiredSourceEnd, sourceDuration }, warnings: [] }
    }
  }
  const requiresMaskReview = Boolean(clip.shapeMask || clip.trackMatte || containsField(clip, /^(maskAssetId|maskFrames)$/i))
  const requiresTrackingReview = containsField(clip, /^(tracking|trackingData|motionTrack|motionTracking|trackingMetadata)$/i)
  const warnings = []
  if (linkedCompanionsUnchanged.length) warnings.push('Only this clip instance is replaced. Linked picture or audio clips keep their current sources.')
  if (requiresMaskReview) warnings.push('Masks retained; check alignment on new footage. Regenerate source-derived masks if needed.')
  if (requiresTrackingReview) warnings.push('Tracking edits retained; check alignment on new footage and retrack if needed.')
  if (clip.frameSampling === 'optical-flow') warnings.push('Optical Flow remains selected. Rebuild its cache for the replacement source.')
  const updates = {
    assetId: asset.id, type: kind, url: asset.url, thumbnail: typeof asset.thumbnail === 'string' && asset.thumbnail ? asset.thumbnail : asset.url,
    sourceDuration, trimStart: sourceIn, trimEnd: sourceOut, sourceFps,
    // Materialize the OLD implicit ratio before changing sourceFps. Otherwise
    // replacing a 24 fps take with 60 fps footage changes the authored speed.
    sourceTimeScale: baseScale,
    cacheStatus: 'none', cacheProgress: 0, cacheUrl: null, cachePath: null,
    cacheKind: null, cacheSignature: null, opticalFlowCache: undefined,
  }
  return { ok: true, changed: true, updates, warnings, summary: { ...summary,
    sourceDuration, requiredSourceStart, requiredSourceEnd, playbackSourceStart, playbackSourceEnd,
    requiresMaskReview, requiresTrackingReview,
  } }
}

export function buildSmartReplacePlan(request) {
  try { return planReplacement(request) } catch (_) {
    return fail('This clip or source contains unsupported data. No changes were made.')
  }
}
