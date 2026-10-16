/** Frame chaining: the timeline time of a clip's first or last VISIBLE frame,
 * so the next generated shot can start exactly where this one ends (same
 * lighting, pose and framing). Frame-aligned to the timeline grid; never
 * outside the clip, even for one-frame clips. */
export function getClipChainFrameTime(clip, fps, edge = 'last') {
  const rate = Number(fps) > 0 ? Number(fps) : 24
  const start = Number(clip?.startTime)
  const duration = Number(clip?.duration)
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return null
  const firstFrame = Math.ceil(start * rate - 1e-6)
  const lastFrame = Math.max(firstFrame, Math.ceil((start + duration) * rate - 1e-6) - 1)
  return (edge === 'first' ? firstFrame : lastFrame) / rate
}

export const canChainFromClip = (clip, track) => Boolean(clip && track && track.type === 'video'
  && ['video', 'image'].includes(clip.type) && track.role !== 'captions' && clip.enabled !== false)
