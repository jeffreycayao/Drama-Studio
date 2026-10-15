import { getCompoundRenderState, getClipPlaybackWindow } from './compoundPlayback.mjs'
import { getRenderableVideoClipIds } from './exportVideoClipEligibility.js'
import { hasAudioSolo, isAudioTrackAudible } from './audioTrackAudibility.js'
import { isAudioMixClip } from '../../electron/audioMixEligibility.mjs'
import { isBetweenClipTransition } from './transitionKinds.js'
import { isAbsoluteRecordedPath } from '../services/assetRelinkFallback.js'
import { normalizeShapeMask } from './shapeMask.js'
import {
  FRAME_SAMPLING_MODE, normalizeFrameSamplingMode, getOpticalFlowCacheUsability,
  getRequiredOpticalFlowHandleSeconds, isSafeOpticalFlowCachePath,
} from './frameSampling.js'

const PICTURE_TYPES = new Set(['video', 'image', 'text', 'shape', 'captions'])
const MEDIA_TYPES = new Set(['video', 'image', 'audio'])
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const overlaps = (span, start, end) => span.end > span.start && span.start < end && span.end > start

export const EXPORT_READINESS_WARNING_COPY = Object.freeze({
  'invalid-range': ['Choose an export range', 'The selected range has no duration.'],
  'missing-asset': ['Media record is missing', '“{{name}}” refers to media that is no longer in this project.'],
  'missing-location': ['Media location is missing', '“{{name}}” has no recorded file location or media URL.'],
  'media-unverified': ['Some media could not be checked', 'File availability could not be checked for “{{name}}”. Browser or remote media needs export validation.'],
  'missing-source': ['Source file is unavailable', 'The recorded source for “{{name}}” was not found or is inaccessible. Relink it in the Editor if needed.'],
  'missing-proxy-source': ['Original source file is unavailable', 'The original for “{{name}}” was not found or is inaccessible. A review proxy may still be available; verify the original before final delivery.'],
  'missing-mask': ['Mask media is unavailable', 'A mask file used by “{{name}}” was not found or is inaccessible.'],
  'optical-unready': ['Optical Flow needs attention', 'The cache for “{{name}}” is unavailable or no longer covers this edit. Review Optical Flow in the Inspector.'],
  'optical-path': ['Optical Flow location is invalid', 'The cache for “{{name}}” does not have a supported project-relative location. Rebuild it in the Inspector.'],
  'optical-unsaved': ['Optical Flow needs a saved project', 'Save the project and review the cache for “{{name}}” in the Inspector.'],
  'optical-signature': ['Optical Flow source is unverified', 'The cache for “{{name}}” has no source fingerprint. Export will require a valid cache built from the current source.'],
  'missing-optical': ['Optical Flow file is unavailable', 'The cache file for “{{name}}” was not found or is inaccessible. Rebuild it in the Inspector.'],
  'file-unverified': ['File availability could not be checked', 'The recorded file for “{{name}}” could not be checked. No media has been changed.'],
  'picture-gap': ['Possible picture gap', 'No active picture clip covers this interval. Black or transparency may be intentional.'],
  'picture-tail': ['Possible blank ending', 'No active picture clip covers the end of this export range. Black or transparency may be intentional.'],
  'no-audio': ['No active audio clips in this range', 'Audio is requested, but no enabled, audible audio clips were found. Silence may be intentional.'],
  'master-muted': ['Master audio is muted', 'The master volume is zero. Audio is requested, but the output will be silent.'],
  'compound-unverified': ['Compound could not be checked', '“{{name}}” has unsupported compound contents or timing. Review it in the Editor before exporting.'],
})

export function exportReadinessWarning(code, details = {}) {
  return { code, id: `${code}:${details.clipId || details.assetId || ''}:${details.time ?? ''}:${details.fileIndex ?? ''}`, ...details }
}

/** Half-open potential-picture coverage, across every visible layer. This is
 * deliberately not a claim about rendered pixels, opacity, or decode success. */
export function findExportPictureGaps(spans, rangeStart, rangeEnd, fps = 24) {
  const start = Math.max(0, finite(rangeStart)), end = Math.max(start, finite(rangeEnd, start))
  if (end <= start) return []
  const epsilon = 1 / Math.max(1, finite(fps, 24)) / 1000
  const ordered = spans.filter(span => overlaps(span, start, end))
    .map(span => ({ start: Math.max(start, span.start), end: Math.min(end, span.end) }))
    .sort((a, b) => a.start - b.start)
  const gaps = []
  let cursor = start
  for (const span of ordered) {
    if (span.start > cursor + epsilon) gaps.push({ start: cursor, end: span.start })
    cursor = Math.max(cursor, span.end)
  }
  if (cursor < end - epsilon) gaps.push({ start: cursor, end })
  return gaps
}

/** Mirror export's primary recorded source precedence. Never silently replace
 * a missing absolute source with a different project copy or original import. */
export function getExportReadinessFileLocation(asset) {
  const recorded = typeof asset?.absolutePath === 'string' && asset.absolutePath.trim()
    ? asset.absolutePath : asset?.path
  if (typeof recorded !== 'string' || !recorded.trim() || recorded.includes('\0')) return null
  if (/^[a-z][a-z\d+.-]*:/i.test(recorded) && !/^[a-z]:[\\/]/i.test(recorded)) return null
  return { path: recorded, relative: !isAbsoluteRecordedPath(recorded) }
}

// Reference + session guards match the stores' immutable authored snapshots.
// Playhead changes are intentionally absent: checking never disables review.
const CONTEXT_KEYS = ['clips', 'tracks', 'transitions', 'assets', 'projectHandle', 'timelineId',
  'timelineSessionId', 'timelineFps', 'masterAudioVolume', 'rangeStart', 'rangeEnd', 'includeAudio', 'format', 'useProxyMedia']
export function isExportReadinessContextCurrent(snapshot, current) {
  return Boolean(snapshot && current && CONTEXT_KEYS.every(key => Object.is(snapshot[key], current[key])))
}

function transitionSpan(transition, clips) {
  if (!isBetweenClipTransition(transition)) return null
  const a = clips.find(clip => clip.id === transition.clipAId), b = clips.find(clip => clip.id === transition.clipBId)
  if (!a || !b || a.trackId !== b.trackId) return null
  const duration = Math.max(0, finite(transition.duration))
  let left = 0.5, right = 0.5
  const split = transition.settings?.split
  if (split && Number.isFinite(Number(split.clipA)) && Number.isFinite(Number(split.clipB))
    && Math.max(0, Number(split.clipA)) + Math.max(0, Number(split.clipB)) > 0) {
    const sum = Math.max(0, Number(split.clipA)) + Math.max(0, Number(split.clipB))
    left = Math.max(0, Number(split.clipA)) / sum; right = Math.max(0, Number(split.clipB)) / sum
  } else if (transition.settings?.alignment === 'start') { left = 1; right = 0 }
  else if (transition.settings?.alignment === 'end') { left = 0; right = 1 }
  const edit = Number.isFinite(Number(transition.editPoint)) ? Number(transition.editPoint) : finite(a.startTime) + finite(a.duration)
  return { start: edit - duration * left, end: edit + duration * right }
}

/** Pure metadata plan. All file access is delegated to the read-only checker. */
export function buildExportReadinessPlan(input = {}) {
  const authored = { clips: input.clips || [], tracks: input.tracks || [], transitions: input.transitions || [] }
  const state = getCompoundRenderState(authored)
  const assets = new Map((input.assets || []).map(asset => [asset.id, asset]))
  const tracks = new Map(state.tracks.map(track => [track.id, track]))
  const rangeStart = Math.max(0, finite(input.rangeStart)), rangeEnd = Math.max(rangeStart, finite(input.rangeEnd, rangeStart))
  const plan = { warnings: [], files: [], rangeStart, rangeEnd, projectHandle: input.projectHandle,
    timelineFps: Math.max(1, finite(input.timelineFps, 24)), opticalFlowCount: 0 }
  const warn = (code, details) => plan.warnings.push(exportReadinessWarning(code, details))
  if (rangeEnd <= rangeStart) { warn('invalid-range'); return plan }
  const visual = input.format !== 'audio'
  const audio = !['png-seq', 'gif'].includes(input.format) && (input.includeAudio !== false || input.format === 'audio')
  const visibleIds = getRenderableVideoClipIds({ ...state, rangeStart, rangeEnd })
  const audioSolo = hasAudioSolo(state.tracks)
  const pictureSpans = []
  const inspectTime = (clip) => Math.max(rangeStart, Math.min(getClipPlaybackWindow(clip).start, rangeEnd - 1 / plan.timelineFps))
  const fileIds = new Set()
  const addAsset = (assetId, clip, kind = 'source') => {
    const asset = assets.get(assetId)
    const details = { clipId: clip.id, assetId, name: clip.name || asset?.name || clip.id || 'Clip',
      time: inspectTime(clip), kind }
    const key = `${kind}:${assetId || clip.id}`
    if (fileIds.has(key)) return
    fileIds.add(key)
    if (!asset) { warn('missing-asset', details); return }
    const media = kind === 'mask' && asset.maskFrames?.length ? asset.maskFrames : [asset]
    media.forEach((source, fileIndex) => {
      const location = getExportReadinessFileLocation(source)
      const item = { ...details, fileIndex, location }
      if (location) plan.files.push({ ...item, missingCode: kind === 'mask' ? 'missing-mask'
        : input.useProxyMedia && clip.type === 'video' ? 'missing-proxy-source' : 'missing-source' })
      else warn(source.url ? 'media-unverified' : 'missing-location', item)
    })
  }
  let possibleAudio = false, unknownCompound = false
  if (state.compoundRenderErrors?.length) {
    const authoredVisible = getRenderableVideoClipIds({ ...authored, rangeStart, rangeEnd })
    for (const parent of authored.clips.filter(clip => clip.type === 'compound' && authoredVisible.has(clip.id))) {
      const isolated = getCompoundRenderState({ ...authored, clips: [parent] })
      if (!isolated.compoundRenderErrors?.length) continue
      unknownCompound = true
      pictureSpans.push(getClipPlaybackWindow(parent))
      warn('compound-unverified', { clipId: parent.id, name: parent.name || parent.id,
        time: inspectTime(parent) })
    }
  }
  for (const clip of state.clips) {
    if (clip.enabled === false) continue
    const track = tracks.get(clip.trackId), span = getClipPlaybackWindow(clip)
    const audioRole = isAudioMixClip(clip, track)
    const inAudio = audio && audioRole && overlaps(span, rangeStart, rangeEnd)
      && !clip.reverse && clip.audioEnabled !== false && (!track || isAudioTrackAudible(track, audioSolo))
      && (track?.volume == null || finite(track.volume, 100) > 0)
      && assets.get(clip.assetId)?.hasAudio !== false
    const inPicture = visual && !audioRole && visibleIds.has(clip.id)
    if (inAudio) { possibleAudio = true; addAsset(clip.assetId, clip) }
    if (!inPicture) continue
    if (PICTURE_TYPES.has(clip.type)) pictureSpans.push(span)
    if (MEDIA_TYPES.has(clip.type)) addAsset(clip.assetId, clip)
    if (clip.bypass?.mask !== true && !normalizeShapeMask(clip.shapeMask)) {
      const mask = (clip.effects || []).find(effect => effect.type === 'mask' && effect.enabled)
      if (mask) addAsset(mask.maskAssetId, clip, 'mask')
    }
    if (clip.type !== 'video' || normalizeFrameSamplingMode(clip.frameSampling) !== FRAME_SAMPLING_MODE.OPTICAL_FLOW) continue
    plan.opticalFlowCount += 1
    const details = { clipId: clip.id, name: clip.name || assets.get(clip.assetId)?.name || clip.id,
      time: inspectTime(clip), kind: 'optical-flow' }
    const usability = getOpticalFlowCacheUsability(clip, { requireUrl: false,
      timelineFps: Number(clip.timelineFps) || plan.timelineFps, sourceFps: clip.sourceFps,
      handleSeconds: getRequiredOpticalFlowHandleSeconds(clip, state.transitions, state.clips) })
    if (!usability.usable) { warn('optical-unready', { ...details, reason: usability.reason }); continue }
    if (!isSafeOpticalFlowCachePath(usability.cache.path)) { warn('optical-path', details); continue }
    if (typeof input.projectHandle !== 'string' || !input.projectHandle.trim()) { warn('optical-unsaved', details); continue }
    if (!usability.cache.sourceSignature) warn('optical-signature', details)
    plan.files.push({ ...details, location: { path: usability.cache.path, relative: true }, missingCode: 'missing-optical' })
  }
  if (visual) {
    // Transition handles can provide picture beyond nominal clip windows.
    // Overestimating coverage is safer than falsely calling a dissolve blank.
    for (const transition of state.transitions) {
      const contributors = [transition.clipAId, transition.clipBId].map(id => state.clips.find(clip => clip.id === id))
      if (!contributors.every(clip => clip && visibleIds.has(clip.id) && PICTURE_TYPES.has(clip.type)
        && !isAudioMixClip(clip, tracks.get(clip.trackId)))) continue
      const span = transitionSpan(transition, state.clips)
      if (span) pictureSpans.push(span)
    }
    for (const gap of findExportPictureGaps(pictureSpans, rangeStart, rangeEnd, plan.timelineFps)) {
      warn(gap.end === rangeEnd && gap.start > rangeStart ? 'picture-tail' : 'picture-gap', { time: gap.start, endTime: gap.end })
    }
  }
  if (audio && input.masterAudioVolume != null && finite(input.masterAudioVolume, 100) === 0) warn('master-muted', { time: rangeStart })
  else if (audio && !possibleAudio && !unknownCompound) warn('no-audio', { time: rangeStart })
  return plan
}
