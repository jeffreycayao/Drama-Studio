// Export review is navigation only: never rewrite the editor's marks, loop
// preference, or clip selection to constrain playback to an output range.
export function getPlaybackReviewRange(range, timelineEnd = 0, timelineFps = 30) {
  const fps = Number.isFinite(Number(timelineFps)) && Number(timelineFps) > 0 ? Number(timelineFps) : 30
  const rawStart = Number(range?.start)
  const rawEnd = range?.end == null ? Number(timelineEnd) : Number(range.end)
  const start = Math.max(0, Number.isFinite(rawStart) ? rawStart : 0)
  const end = Math.max(start, Number.isFinite(rawEnd) ? rawEnd : start)
  // The range end is exclusive, just like export. Keep the final included
  // picture visible instead of parking on the black frame after the edit.
  const frameCount = Math.max(0, Math.ceil((end - start) * fps - 1e-7))
  const lastFrame = frameCount > 0 ? start + (frameCount - 1) / fps : start
  return { start, end, lastFrame, fps, duration: end - start, frameCount }
}
