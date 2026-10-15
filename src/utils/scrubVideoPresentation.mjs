import { doesPresentedVideoFrameMatchTarget, getTargetVideoFrameIndex, getVideoFrameSeekTime,
  isSameVideoFrameSeekTime } from './previewVideoSeeking.js'

const finite = value => typeof value === 'number' && Number.isFinite(value)
const drawable = video => video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 && !video.seeking
const enqueueMicrotask = callback => typeof queueMicrotask === 'function'
  ? queueMicrotask(callback) : Promise.resolve().then(callback)

/** Coordinates approximate scrub pictures, not timeline state or decoding.
 * A render pass observes every visible video/matte, paints the available
 * pictures, then calls endPass({painted:true}). Only that acknowledgement may
 * retarget a drawable picture. Missing pictures can start their first decode
 * immediately. Exact seeks/playback take ownership through cancelAll(). */
export function createScrubVideoPresentation({ requestDraw = () => {}, scheduleTask = enqueueMicrotask } = {}) {
  const records = new Map()
  let pass = null
  let nextRequestId = 0
  let queuedDraw = null

  const notify = record => {
    if (records.get(record.video) !== record) return
    if (!queuedDraw) {
      const notification = { records: new Set([record]) }
      queuedDraw = notification
      scheduleTask(() => {
        if (queuedDraw !== notification) return
        queuedDraw = null
        if ([...notification.records].some(item => records.get(item.video) === item)) requestDraw()
      })
    }
    queuedDraw?.records.add(record)
  }

  const removePending = record => {
    const request = record.pending
    if (!request) return
    // Retire before touching browser APIs: any late/reentrant callback loses
    // ownership immediately and cannot delete or complete a newer request.
    record.pending = null
    if (request.callbackId != null && typeof record.video.cancelVideoFrameCallback === 'function') {
      try { record.video.cancelVideoFrameCallback(request.callbackId) } catch (_) { /* detached element */ }
    }
    for (const [event, listener] of request.listeners) record.video.removeEventListener(event, listener)
  }
  const cancel = video => {
    const record = records.get(video)
    if (!record) return
    records.delete(video)
    removePending(record)
    queuedDraw?.records.delete(record)
  }
  const cancelAll = () => {
    // Drop queued redraws as well as pending media callbacks. A later mode or
    // document may create fresh records without reviving this notification.
    queuedDraw = null
    pass = null
    for (const video of [...records.keys()]) cancel(video)
  }
  const owns = (record, request) => records.get(record.video) === record && record.pending === request
  const targetStillOwned = (record, request) => isSameVideoFrameSeekTime(record.video.currentTime, request.time, record.fps)

  const startSeek = record => {
    const video = record.video, desired = record.desired
    if (records.get(video) !== record || record.pending || record.failed || !desired || video.readyState < 1 || video.error) return
    const targetFrame = getTargetVideoFrameIndex(desired.time, record.fps)
    if (drawable(video) && record.confirmedFrame === targetFrame
      && getTargetVideoFrameIndex(video.currentTime, record.fps) === targetFrame) return
    const seekTime = getVideoFrameSeekTime(desired.time, record.fps, video.duration)
    if (!finite(seekTime)) return
    const request = { id: ++nextRequestId, time: seekTime, targetTime: desired.time, frame: targetFrame, callbackId: null, issued: false,
      listeners: [], presentedTime: null, seeked: false, usesFrameCallback: typeof video.requestVideoFrameCallback === 'function' }
    record.pending = request
    record.confirmedFrame = null
    record.needsPaint = false

    const abandonForeignSeek = () => {
      if (!owns(record, request)) return
      removePending(record)
      record.confirmedFrame = null
      notify(record)
    }
    const complete = () => {
      if (!owns(record, request) || !request.issued) return
      if (!targetStillOwned(record, request)) { abandonForeignSeek(); return }
      if (!drawable(video) || request.usesFrameCallback && request.presentedTime === null
        || !request.usesFrameCallback && !request.seeked) return
      const frame = request.frame
      removePending(record)
      record.confirmedFrame = frame
      record.needsPaint = true
      // Completion never immediately chases the latest target. The next
      // successful composite must consume this picture first.
      notify(record)
    }
    const arm = () => {
      if (!owns(record, request) || !request.usesFrameCallback) return
      try {
        request.callbackId = video.requestVideoFrameCallback((_now, metadata = {}) => {
          request.callbackId = null
          if (!owns(record, request)) return
          if (!targetStillOwned(record, request)) { abandonForeignSeek(); return }
          if (finite(metadata.mediaTime) && doesPresentedVideoFrameMatchTarget({
            mediaTime: metadata.mediaTime, targetTime: request.targetTime, fps: record.fps,
          })) {
            request.presentedTime = metadata.mediaTime
            complete()
          } else {
            // A pre-seek picture can arrive after registration. It does not
            // acknowledge the new request; keep waiting for its actual PTS.
            arm()
          }
        })
      } catch (_) {
        request.callbackId = null
        request.usesFrameCallback = false
        complete()
      }
    }
    const listen = (event, callback) => {
      request.listeners.push([event, callback])
      video.addEventListener(event, callback)
    }
    listen('seeked', () => {
      if (!owns(record, request)) return
      request.seeked = true
      complete()
    })
    // A presentation callback can precede seeked/readyState's final update.
    // Acknowledge it once drawable, without demanding a second presentation.
    listen('loadeddata', complete)
    listen('canplay', complete)
    listen('error', () => {
      if (!owns(record, request)) return
      removePending(record)
      record.failed = true
      notify(record)
    })
    arm()
    if (!owns(record, request)) return
    request.issued = true
    try { video.currentTime = request.time } catch (_) {
      if (owns(record, request)) {
        removePending(record)
        record.failed = true
        notify(record)
      }
    }
  }

  return {
    beginPass() { pass = new Map() },

    observe(video, { sourceKey, targetTime, fps } = {}) {
      if (!pass || !video || typeof video.addEventListener !== 'function' || typeof video.removeEventListener !== 'function'
        || typeof sourceKey !== 'string' || !sourceKey || !finite(targetTime) || targetTime < 0
        || !finite(fps) || fps <= 0 || !Number.isSafeInteger(getTargetVideoFrameIndex(targetTime, fps))) {
        if (video) cancel(video)
        return { ready: false, pending: false }
      }
      let record = records.get(video)
      if (record && (record.sourceKey !== sourceKey || record.fps !== fps)) { cancel(video); record = null }
      if (!record) {
        record = { video, sourceKey, fps, desired: null, pending: null, failed: false, needsPaint: false,
          // A fresh already-drawable element has an initial picture we may
          // paint. Once we issue a seek, only its owned completion confirms it.
          confirmedFrame: drawable(video) ? getTargetVideoFrameIndex(video.currentTime, fps) : null }
        records.set(video, record)
      }
      pass.set(video, record)
      record.desired = { time: targetTime }
      if (record.pending && !targetStillOwned(record, record.pending)) {
        removePending(record)
        record.confirmedFrame = null
        record.needsPaint = false
      }
      const ready = !record.failed && !record.pending && drawable(video)
        && record.confirmedFrame !== null && record.confirmedFrame === getTargetVideoFrameIndex(video.currentTime, fps)
      if (!ready && !record.pending) startSeek(record)
      return { ready, pending: Boolean(record.pending) }
    },

    endPass({ painted = false } = {}) {
      if (!pass) return
      const observed = pass
      pass = null
      for (const [video, record] of records) if (observed.get(video) !== record) cancel(video)
      if (!painted) return
      // A caller must acknowledge only after its final visible composite, not
      // after one layer raster: another layer/matte can still hold the frame.
      for (const [video, record] of observed) {
        if (records.get(video) !== record || record.pending || !drawable(video)) continue
        record.needsPaint = false
        startSeek(record)
      }
    },

    cancel,
    cancelAll,
    // Ownership lasts through presentation AND its visible composite. Without
    // this barrier an idle timer can switch to ordinary seeking after decode
    // but before paint, recreating retarget-before-presentation starvation.
    hasPending: () => [...records.values()].some(record => Boolean(record.pending) || record.needsPaint),
  }
}
