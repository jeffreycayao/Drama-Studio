// Cache files belong to a particular source/edit, not merely a reusable clip
// ID. Keep this token outside project data and validate after every disk read.
export function getClipCacheReadKey(clip, timelineSessionId) {
  if (!clip?.id || clip.cacheStatus !== 'cached' || !clip.cachePath) return null
  return JSON.stringify({
    timelineSessionId,
    id: clip.id, assetId: clip.assetId, url: clip.url,
    cachePath: clip.cachePath, cacheKind: clip.cacheKind || null, cacheSignature: clip.cacheSignature || null,
    trimStart: clip.trimStart, trimEnd: clip.trimEnd, duration: clip.duration,
    sourceDuration: clip.sourceDuration, sourceTimeScale: clip.sourceTimeScale,
    sourceFps: clip.sourceFps, timelineFps: clip.timelineFps,
    speed: clip.speed, reverse: clip.reverse, frameSampling: clip.frameSampling,
  })
}

export function createClipCacheReadRequest(clip, timelineSessionId, projectHandle) {
  const key = getClipCacheReadKey(clip, timelineSessionId)
  return key && projectHandle ? { key, clipId: clip.id, projectHandle } : null
}

export function isClipCacheReadCurrent(request, timeline, projectHandle) {
  if (!request || request.projectHandle !== projectHandle) return false
  const matches = timeline.clips.filter(clip => clip.id === request.clipId)
  return matches.length === 1 && getClipCacheReadKey(matches[0], timeline.timelineSessionId) === request.key
}

// Async render completions/progress must not land on media Smart Replace put
// under the same clip ID (including when a prior job was just cancelled).
export function createClipSourceRequest(clip, timelineSessionId, projectHandle) {
  if (!clip?.id) return null
  return { clipId: clip.id, projectHandle, timelineSessionId, key: JSON.stringify({
    assetId: clip.assetId, url: clip.url, type: clip.type,
    trimStart: clip.trimStart, trimEnd: clip.trimEnd, duration: clip.duration,
    sourceDuration: clip.sourceDuration, sourceTimeScale: clip.sourceTimeScale,
    sourceFps: clip.sourceFps, timelineFps: clip.timelineFps,
    speed: clip.speed, reverse: clip.reverse,
  }) }
}

export function isClipSourceRequestCurrent(request, timeline, projectHandle) {
  if (!request || request.projectHandle !== projectHandle || request.timelineSessionId !== timeline.timelineSessionId) return false
  const matches = timeline.clips.filter(clip => clip.id === request.clipId)
  return matches.length === 1 && createClipSourceRequest(matches[0], timeline.timelineSessionId, projectHandle)?.key === request.key
}
