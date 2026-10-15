import { doesPresentedVideoFrameMatchTarget, getTargetVideoFrameIndex, getVideoFrameSeekTime,
  isSameVideoFrameSeekTime } from './previewVideoSeeking.js'

const drawable = video => video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 && !video.seeking

/** One frozen transport destination. Never retries or chases a moving clock.
 * The caller owns the jump token/deadline and acknowledges the whole composite,
 * not just this video's readiness. Cancellation also retires queued callbacks.
 */
export function landPlaybackJumpVideo(video, { targetTime, fps, onReady = () => {}, onError = () => {},
  scheduleTask = queueMicrotask } = {}) {
  let cancelled = false, ready = false, issued = false, callbackId = null
  let presented = false, seeked = false, seekTime = null, failure = null
  let usesFrameCallback = typeof video?.requestVideoFrameCallback === 'function'
  const source = video?.src
  const listeners = []
  const listen = (event, callback) => { listeners.push([event, callback]); video.addEventListener(event, callback) }
  const cleanup = () => {
    if (callbackId != null) {
      try { video.cancelVideoFrameCallback?.(callbackId) } catch (_) { /* detached source */ }
      callbackId = null
    }
    for (const [event, callback] of listeners) video.removeEventListener(event, callback)
    listeners.length = 0
  }
  const fail = message => {
    if (cancelled || failure || ready) return
    failure = message
    cleanup()
    scheduleTask(() => { if (!cancelled) onError(message) })
  }
  const ownsSource = () => !cancelled && Boolean(video) && video.src === source
  const isReady = () => ownsSource() && ready && !video.error && drawable(video)
    && isSameVideoFrameSeekTime(video.currentTime, seekTime, fps)
  const complete = () => {
    if (!ownsSource() || failure || ready || !issued || !drawable(video)
      || !isSameVideoFrameSeekTime(video.currentTime, seekTime, fps)
      || (usesFrameCallback ? !presented : !seeked)) return
    ready = true
    cleanup()
    scheduleTask(() => { if (isReady()) onReady() })
  }
  const arm = () => {
    if (!ownsSource() || failure || ready || !usesFrameCallback) return
    try {
      callbackId = video.requestVideoFrameCallback((_now, metadata = {}) => {
        callbackId = null
        if (!ownsSource() || !issued || failure || ready) return
        if (doesPresentedVideoFrameMatchTarget({ mediaTime: metadata.mediaTime, targetTime, fps })) {
          presented = true
          complete()
        } else arm()
      })
    } catch (_) {
      usesFrameCallback = false
      complete()
    }
  }
  const start = () => {
    if (!ownsSource() || failure || issued || video.readyState < 1) return
    if (video.error) { fail('The video could not be decoded.'); return }
    seekTime = getVideoFrameSeekTime(targetTime, fps, video.duration)
    if (!Number.isFinite(seekTime)) { fail('The requested video frame is unavailable.'); return }
    // A settled exact seek (or a cold frame zero) must not wait for a no-op
    // seek callback which some browsers never dispatch.
    if (drawable(video) && (isSameVideoFrameSeekTime(video.currentTime, seekTime, fps)
      || (video.currentTime === 0 && getTargetVideoFrameIndex(targetTime, fps) === 0))) {
      seekTime = video.currentTime
      issued = true; presented = true; seeked = true
      complete()
      return
    }
    issued = true
    arm()
    try { video.currentTime = seekTime } catch (_) { fail('The video could not seek to that frame.') }
  }

  if (!video || !Number.isFinite(targetTime) || targetTime < 0 || !Number.isFinite(fps) || fps <= 0) {
    failure = 'The requested video frame is invalid.'
    scheduleTask(() => { if (!cancelled) onError(failure) })
  } else {
    video.pause()
    listen('loadedmetadata', start)
    listen('seeked', () => { seeked = true; complete() })
    listen('loadeddata', complete)
    listen('canplay', complete)
    listen('error', () => {
      if (!ownsSource()) fail('The video source changed during playback.')
      else if (video.error) fail('The video could not be loaded.')
    })
    listen('emptied', () => {
      // load() queues this event before cold metadata arrives. The cache can
      // attach this controller between those two events; that is not a source
      // replacement. Once a seek is owned, an emptied decoder is invalid.
      if (!ownsSource() || issued) fail('The video source changed during playback.')
    })
    if (video.error) fail('The video could not be loaded.')
    else start()
  }
  return {
    isReady,
    get error() { return failure },
    cancel() { cancelled = true; ready = false; cleanup() },
  }
}
