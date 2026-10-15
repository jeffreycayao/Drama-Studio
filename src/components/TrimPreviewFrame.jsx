import { useEffect, useMemo, useRef, useState } from 'react'
import useAssetsStore from '../stores/assetsStore'
import useTimelineStore from '../stores/timelineStore'
import { hasUsableProxy } from '../services/proxyCache'
import { hasUsablePlaybackCache } from '../services/playbackCache'
import { resolveTrimPreviewSource } from '../utils/trimPreviewSource.js'
import { getTrimPreviewSeekTime } from '../utils/trimPreviewSeeking.mjs'
import {
  doesPresentedVideoFrameMatchTarget,
  getTargetVideoFrameIndex,
} from '../utils/previewVideoSeeking.js'

const sourceKey = (source) => JSON.stringify([source.kind, source.url, source.time, source.sourceTime, source.fps])
const sameFrame = (a, b) => a && b && a.fps === b.fps
  && getTargetVideoFrameIndex(a.time, a.fps) === getTargetVideoFrameIndex(b.time, b.fps)

/** A disposable source viewer; it never seeks the playhead or shared videos. */
export default function TrimPreviewFrame({ feedback, fps = 24, testId = 'trim-edge-canvas', frameStyle, children }) {
  const clip = feedback?.clip
  const asset = useAssetsStore(state => state.assets.find(item => item.id === clip?.assetId) || null)
  const useProxyPlaybackForAssets = useTimelineStore(state => state.useProxyPlaybackForAssets)
  const transitions = useTimelineStore(state => state.transitions)
  const clips = useTimelineStore(state => state.clips)
  const source = useMemo(() => resolveTrimPreviewSource({
    clip, asset, timelineTime: feedback?.timelineTime, timelineFps: fps,
    useProxyPlaybackForAssets, transitions, clips,
    proxyUsable: hasUsableProxy(asset), playbackCacheUsable: hasUsablePlaybackCache(asset),
  }), [clip, asset, feedback?.timelineTime, fps, useProxyPlaybackForAssets, transitions, clips])
  const canvasRef = useRef(null)
  const mediaHostRef = useRef(null)
  const controllerRef = useRef(null)
  const latestSourceRef = useRef(source)
  latestSourceRef.current = source
  const mediaSession = useMemo(() => ({}), [source.kind, source.url, feedback?.clipId])
  const latestSessionRef = useRef(mediaSession)
  latestSessionRef.current = mediaSession
  const [result, setResult] = useState(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || (source.kind !== 'video' && source.kind !== 'image')) return undefined
    const context = canvas.getContext('2d')
    let disposed = false
    let pending = null
    let confirmed = null
    let failedKey = null
    let fatalError = null
    let image = null
    let video = null
    let loadTimer = null
    let hasIssuedSeek = false
    const sessionUrl = source.url
    const sessionClipId = feedback?.clipId

    const clearPending = () => {
      if (!pending) return
      clearTimeout(pending.timer)
      if (pending.callbackId != null && video?.cancelVideoFrameCallback) {
        try { video.cancelVideoFrameCallback(pending.callbackId) } catch (_) { /* decoder detached */ }
      }
      if (pending.onSeeked) video?.removeEventListener('seeked', pending.onSeeked)
      pending = null
    }
    const latest = () => {
      const value = latestSourceRef.current
      return latestSessionRef.current === mediaSession && value.url === sessionUrl && value.kind === source.kind ? value : null
    }
    const fail = (message, fatal = false) => {
      if (fatal) fatalError = message
      clearTimeout(loadTimer)
      clearPending()
      const target = latest()
      if (disposed || !target) return
      failedKey = sourceKey(target)
      context?.clearRect(0, 0, canvas.width, canvas.height)
      setResult({ state: 'unavailable', key: failedKey, clipId: sessionClipId, mediaSession, message })
    }
    const draw = (media, target, presentedTime = null) => {
      if (disposed || !context || !target) return false
      const width = media.videoWidth || media.naturalWidth || 0
      const height = media.videoHeight || media.naturalHeight || 0
      if (!width || !height) return false
      try {
        context.clearRect(0, 0, canvas.width, canvas.height)
        const scale = Math.min(canvas.width / width, canvas.height / height)
        context.drawImage(media, (canvas.width - width * scale) / 2, (canvas.height - height * scale) / 2, width * scale, height * scale)
        setResult({ state: 'ready', key: sourceKey(target), clipId: sessionClipId, mediaSession, target, presentedTime })
        return true
      } catch (_) {
        fail('Source frame could not be displayed.')
        return false
      }
    }

    const pump = () => {
      const target = latest()
      if (disposed || !video || !target || pending || fatalError || video.readyState < 2 || failedKey === sourceKey(target)) return
      const seekTime = getTrimPreviewSeekTime(target.time, target.fps, video.duration)
      if (seekTime === null) {
        fail('Source frame is outside the available media.')
        return
      }
      if (confirmed && sameFrame(confirmed.target, target) && !video.seeking
        && sameFrame(confirmed.target, { time: video.currentTime, fps: target.fps })) {
        draw(video, target, confirmed.presentedTime)
        return
      }
      // A cold element's loadeddata frame at zero needs no seek. A no-op
      // paused seek is allowed to omit a presentation callback in Chromium.
      if (!confirmed && !hasIssuedSeek && !video.seeking && video.currentTime === 0
        && getTargetVideoFrameIndex(target.time, target.fps) === 0) {
        confirmed = { target, presentedTime: 0 }
        draw(video, target, 0)
        return
      }
      const request = { target, callbackId: null, onSeeked: null, timer: null }
      const previousConfirmed = confirmed
      confirmed = null
      pending = request
      const settle = (presentedTime) => {
        if (disposed || pending !== request) return
        clearPending()
        confirmed = { target: request.target, presentedTime }
        const desired = latest()
        // Coalesce mouse movement, not decoder work: never continually
        // restart an in-flight seek or publish old pixels as the new frame.
        if (sameFrame(request.target, desired)) draw(video, desired, presentedTime)
        else pump()
      }
      const arm = () => {
        if (disposed || pending !== request || !video.requestVideoFrameCallback) return
        request.callbackId = video.requestVideoFrameCallback((_now, metadata) => {
          request.callbackId = null
          if (disposed || pending !== request) return
          if (doesPresentedVideoFrameMatchTarget({
            mediaTime: metadata.mediaTime, targetTime: request.target.time, fps: request.target.fps,
          })) settle(metadata.mediaTime)
          else arm()
        })
      }
      request.onSeeked = () => {
        if (disposed || pending !== request) return
        if (video.seeking || !sameFrame(request.target, { time: video.currentTime, fps: request.target.fps })) return
        if (!video.requestVideoFrameCallback) settle(video.currentTime)
        else if (previousConfirmed && sameFrame(previousConfirmed.target, request.target)) settle(previousConfirmed.presentedTime)
      }
      video.addEventListener('seeked', request.onSeeked)
      request.timer = setTimeout(() => {
        if (pending !== request || disposed) return
        const desired = latest()
        clearPending()
        if (desired && !sameFrame(request.target, desired)) pump()
        else fail('Source frame unavailable. Try a nearby frame.')
      }, 5000)
      try {
        arm()
        hasIssuedSeek = true
        video.currentTime = seekTime
      } catch (_) {
        fail('Source video could not be decoded.')
      }
    }

    const loadedData = () => {
      clearTimeout(loadTimer)
      fatalError = null
      failedKey = null
      pump()
    }
    loadTimer = setTimeout(() => fail('Source media could not be loaded.', true), 8000)
    if (source.kind === 'image') {
      image = new Image()
      image.onload = () => {
        clearTimeout(loadTimer)
        fatalError = null
        failedKey = null
        draw(image, latest())
      }
      image.onerror = () => fail('Source image unavailable. Relink the media.', true)
      image.src = sessionUrl
    } else {
      video = document.createElement('video')
      video.muted = true
      video.defaultMuted = true
      video.volume = 0
      video.playsInline = true
      video.preload = 'auto'
      video.setAttribute('aria-hidden', 'true')
      video.tabIndex = -1
      video.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;'
      mediaHostRef.current?.appendChild(video)
      video.addEventListener('loadeddata', loadedData)
      video.addEventListener('canplay', pump)
      video.onerror = () => fail('Source video unavailable or unsupported. Relink the media.', true)
      video.src = sessionUrl
      video.load()
    }
    controllerRef.current = { update: () => {
      if (fatalError) fail(fatalError)
      else if (image?.complete && image.naturalWidth) draw(image, latest())
      else pump()
    } }
    return () => {
      disposed = true
      controllerRef.current = null
      clearTimeout(loadTimer)
      clearPending()
      if (image) {
        image.onload = null
        image.onerror = null
        image.removeAttribute('src')
      }
      if (video) {
        video.removeEventListener('loadeddata', loadedData)
        video.removeEventListener('canplay', pump)
        video.onerror = null
        video.pause()
        video.removeAttribute('src')
        video.load()
        video.remove()
      }
      context?.clearRect(0, 0, canvas.width, canvas.height)
    }
  // Time changes are fed to the same decoder below; only media identity
  // changes create a new private element.
  }, [source.kind, source.url, feedback?.clipId, mediaSession])

  useEffect(() => { controllerRef.current?.update() }, [source])

  if (!feedback || !clip) return null
  const currentResult = result?.mediaSession === mediaSession && result?.clipId === feedback.clipId
    && result?.key === sourceKey(source) ? result : null
  const state = source.kind === 'timing-only' || source.kind === 'unavailable'
    ? source.kind
    : currentResult?.state || 'pending'
  const ready = state === 'ready'
  const status = state === 'pending'
    ? 'Updating source frame…'
    : currentResult?.message || source.note
  const frame = <div className="relative bg-black" style={{ aspectRatio: '16 / 9', ...frameStyle }}>
    <div ref={mediaHostRef} />
    <canvas
      ref={canvasRef} width={576} height={324} data-testid={testId} data-state={state}
      data-source-mode={source.mode} data-source-time={ready ? currentResult?.target?.sourceTime ?? '' : ''}
      data-frame-time={ready ? currentResult?.target?.time ?? '' : ''}
      data-presented-time={ready ? currentResult?.presentedTime ?? '' : ''}
      className="h-full w-full object-contain" style={{ visibility: ready ? 'visible' : 'hidden' }}
    />
    {!ready && <div className="absolute inset-0 flex items-center justify-center px-5 text-center text-xs text-gray-400">{status}</div>}
  </div>
  return children ? children({ frame, state, status, asset, clip, clips }) : frame
}
