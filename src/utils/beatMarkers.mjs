const timingKeys = ['id', 'assetId', 'trackId', 'startTime', 'duration', 'trimStart', 'trimEnd',
  'sourceTimeScale', 'timelineFps', 'sourceFps', 'speed', 'reverse']
const timingKey = clip => JSON.stringify([...timingKeys.map(key => clip?.[key]), clip?.keyframes?.speed])
const sourceKey = asset => JSON.stringify([asset?.id, asset?.absolutePath, asset?.path, asset?.url])

// Analysis is asynchronous. Keep the source/range and edit context tied to the
// click so finishing an old request can never write markers into a new edit.
export function captureBeatMarkerRequest(timeline, project, clip, asset) {
  if (!clip || !asset) throw new Error('The audio source is no longer available.')
  if (clip.reverse) throw new Error('Beat markers are not supported on reversed clips.')
  if (clip.keyframes?.speed?.length) throw new Error('Beat markers are not supported on speed-ramped clips yet.')
  const baseScale = clip.sourceTimeScale || (clip.timelineFps && clip.sourceFps ? clip.timelineFps / clip.sourceFps : 1)
  const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1
  const timeScale = baseScale * speed
  const startSeconds = Number(clip.trimStart) || 0
  const endSeconds = clip.trimEnd != null && Number.isFinite(Number(clip.trimEnd))
    ? Number(clip.trimEnd) : startSeconds + Number(clip.duration) * timeScale
  if (!Number.isFinite(timeScale) || timeScale <= 0 || !Number.isFinite(clip.startTime)
    || !Number.isFinite(clip.duration) || clip.duration <= 0
    || !Number.isFinite(startSeconds) || startSeconds < 0 || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
    throw new Error('This clip has an invalid audio range. Check its trim and speed before detecting beats.')
  }
  return {
    clipId: clip.id, assetId: asset.id, timeScale, clipStart: clip.startTime, clipDuration: clip.duration,
    startSeconds, endSeconds, timing: timingKey(clip), source: sourceKey(asset),
    timelineSessionId: timeline.timelineSessionId, compoundEditContext: timeline.compoundEditContext,
    timelineFps: timeline.timelineFps, projectHandle: project.currentProjectHandle,
    currentTimelineId: project.currentTimelineId,
  }
}

export function isBeatMarkerRequestCurrent(request, timeline, project, asset) {
  const clip = timeline.clips.find(candidate => candidate.id === request.clipId)
  return timeline.timelineSessionId === request.timelineSessionId
    && timeline.compoundEditContext === request.compoundEditContext
    && timeline.timelineFps === request.timelineFps
    && project.currentProjectHandle === request.projectHandle
    && project.currentTimelineId === request.currentTimelineId
    && timingKey(clip) === request.timing && sourceKey(asset) === request.source
}

export function buildDetectedBeatMarkers(request, analysis) {
  if (analysis?.error) throw new Error(analysis.error)
  const sourceDuration = Math.min(request.endSeconds - request.startSeconds, request.clipDuration * request.timeScale)
  const beats = (Array.isArray(analysis?.beats) ? analysis.beats : [])
    .filter(beat => Number.isFinite(beat) && beat >= 0 && beat <= sourceDuration + 1e-7)
    .slice(0, 600)
  if (!beats.length) throw new Error('No steady beat detected in this clip.')
  return beats.map((beat, index) => ({
    time: request.clipStart + beat / request.timeScale,
    label: index === 0 ? `Beats ${Number.isFinite(analysis.bpm) && analysis.bpm > 0 ? `${analysis.bpm} BPM` : ''}`.trim() : '',
    color: '#38bdf8',
  }))
}
