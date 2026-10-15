import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { useAssetsStore } from '../stores/assetsStore'
import { useTimelineStore } from '../stores/timelineStore'
import { attachSourceTransportKeyboard } from '../utils/sourceTransportKeyboard.mjs'

// Source controls (issue #89): mark In/Out on the previewed video/audio asset,
// then insert only that range onto the timeline as a pre-trimmed clip. Lives
// under the preview monitor in asset mode — the timeline stays visible, so
// "Insert at playhead" lands before your eyes (the old Source Player modal
// covered the timeline, which made inserting blind; that is why it was
// retired in favor of this).
//
// Keyboard grammar is the NLE standard while the monitor is in asset mode:
// I / O mark points at the playhead, X clears, Space plays, arrow keys step
// frames. Playback is range-bounded: play stops at the Out point and restarts
// from In, so you audition the select rather than the whole file.
//
// The clip is born with trimStart + duration, so the timeline trim handles
// can still reveal the rest of the source afterwards — nothing destructive.

const formatTc = (seconds) => {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
}

// The asset preview <video> element is owned by PreviewPanel and registered
// into the assets store; grab it lazily so registration timing (cleared and
// re-registered on every preview switch) never leaves us holding a stale node.
const getPreviewVideo = () => useAssetsStore.getState().videoRef || null

const readDecodedSourceDuration = (video, assetUrl) => {
  if (!video || video.readyState < 1 || !video.currentSrc || !assetUrl) return null
  try {
    const baseUrl = typeof document === 'undefined' ? undefined : document.baseURI
    const expectedUrl = new URL(assetUrl, baseUrl).href
    const decodedUrl = new URL(video.currentSrc, baseUrl).href
    const duration = Number(video.duration)
    return decodedUrl === expectedUrl && Number.isFinite(duration) && duration > 0 ? duration : null
  } catch (_) {
    return null
  }
}

// Scrub seeks are coalesced: a video seek is asynchronous and can take
// 100-300ms on long-GOP sources, while pointermove fires far faster than
// that. Issuing every move as a seek starves the decoder and the frame only
// catches up on release. Instead, while a seek is in flight we remember only
// the LATEST requested position and issue it when 'seeked' fires — dropped
// intermediates were stale the moment the pointer moved on.
const issueCoalescedSeek = (video, target, pendingRef) => {
  pendingRef.current = null
  video.currentTime = target
  video.addEventListener('seeked', () => {
    if (pendingRef.current != null) {
      issueCoalescedSeek(video, pendingRef.current, pendingRef)
    }
  }, { once: true })
}

const SOURCE_EDIT_LABELS = { insert: 'Insert', overwrite: 'Overwrite', append: 'Add to End' }

export default function PreviewSourceControls({ asset }) {
  const barRef = useRef(null)
  const playheadRef = useRef(null)
  const tcRef = useRef(null)
  const draggingRef = useRef(null)
  const pendingSeekRef = useRef(null)
  const sourceEditDescriptionId = useId()
  const sourceEditStatusId = useId()

  const isPlaying = useAssetsStore((s) => s.isPlaying)
  const setPreviewMode = useAssetsStore((s) => s.setPreviewMode)
  const videoEl = useAssetsStore((s) => s.videoRef)
  const sourceSeedRequest = useAssetsStore((s) => s.sourceSeedRequest)
  const timelineTracks = useTimelineStore((s) => s.tracks)
  const timelineClips = useTimelineStore((s) => s.clips)
  const timelineTransitions = useTimelineStore((s) => s.transitions)
  const timelineMarkers = useTimelineStore((s) => s.markers)
  const timelineFps = useTimelineStore((s) => s.timelineFps)
  const activeTrackId = useTimelineStore((s) => s.activeTrackId)
  const playheadPosition = useTimelineStore((s) => s.playheadPosition)
  const timelineSessionId = useTimelineStore((s) => s.timelineSessionId)
  const timelineHistory = useTimelineStore((s) => s.history)
  const timelineHistoryIndex = useTimelineStore((s) => s.historyIndex)
  const timelineClipCounter = useTimelineStore((s) => s.clipCounter)
  const timelineDuration = useTimelineStore((s) => s.duration)
  const timelineIsPlaying = useTimelineStore((s) => s.isPlaying)
  const previewSourceEdit = useTimelineStore((s) => s.previewSourceEdit)

  const [inPoint, setInPoint] = useState(null)
  const [outPoint, setOutPoint] = useState(null)
  const [decodedSourceMeasurement, setDecodedSourceMeasurement] = useState(null)
  const [footerNote, setFooterNote] = useState({ tone: 'muted', text: '' })
  const noteTimerRef = useRef(null)

  // Success notes are transient receipts. Live targets and validation remain
  // visible independently, so a result never hides the next edit's scope.
  const showFooterNote = useCallback((note) => {
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    setFooterNote(note)
    if (note.tone === 'success') {
      noteTimerRef.current = setTimeout(() => {
        setFooterNote({ tone: 'muted', text: '' })
      }, 4000)
    }
  }, [])

  useEffect(() => () => {
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
  }, [])

  // The range belongs to the asset being auditioned, not to the panel.
  useEffect(() => {
    setInPoint(null)
    setOutPoint(null)
    setFooterNote({ tone: 'muted', text: '' })
    pendingSeekRef.current = null
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    // A seed aimed at a different asset is stale — drop it so it can't fire
    // if that asset gets previewed again later.
    const staleSeed = useAssetsStore.getState().sourceSeedRequest
    if (staleSeed && staleSeed.assetId !== asset?.id) {
      useAssetsStore.getState().clearSourceSeedRequest()
    }
  }, [asset?.id])

  // Match Frame: consume a one-shot seed — mark the clip's source range and
  // park the playhead on the requested frame. Runs after the reset effect
  // (declaration order), so the seed lands on a clean slate. Waits for the
  // preview <video> to register; seeks now or on loadedmetadata.
  useEffect(() => {
    const request = sourceSeedRequest
    if (!request || !asset || request.assetId !== asset.id || !videoEl) return
    const inSeed = Number(request.inPoint)
    const outSeed = Number(request.outPoint)
    setInPoint(Number.isFinite(inSeed) ? inSeed : null)
    setOutPoint(Number.isFinite(outSeed) && outSeed > (Number.isFinite(inSeed) ? inSeed : 0) ? outSeed : null)
    pendingSeekRef.current = null
    const target = Number(request.seekTime)
    if (Number.isFinite(target)) {
      const applySeek = () => { videoEl.currentTime = Math.max(0, target) }
      if (videoEl.readyState >= 1) applySeek()
      else videoEl.addEventListener('loadedmetadata', applySeek, { once: true })
    }
    useAssetsStore.getState().clearSourceSeedRequest()
  }, [sourceSeedRequest, asset?.id, videoEl])

  // Shared preview duration can still belong to the previous asset while a
  // replacement source loads. Only trust a decoder which has metadata for
  // this URL; the src attribute alone changes before the decoder catches up.
  useEffect(() => {
    const measure = () => {
      const duration = readDecodedSourceDuration(videoEl, asset?.url)
      setDecodedSourceMeasurement(previous => (
        previous?.assetId === asset?.id && previous?.assetUrl === asset?.url
        && previous?.video === videoEl && previous?.duration === duration
          ? previous
          : { assetId: asset?.id, assetUrl: asset?.url, video: videoEl, duration }
      ))
    }
    const clear = () => setDecodedSourceMeasurement(null)
    measure()
    videoEl?.addEventListener('loadedmetadata', measure)
    videoEl?.addEventListener('durationchange', measure)
    videoEl?.addEventListener('emptied', clear)
    videoEl?.addEventListener('error', clear)
    return () => {
      videoEl?.removeEventListener('loadedmetadata', measure)
      videoEl?.removeEventListener('durationchange', measure)
      videoEl?.removeEventListener('emptied', clear)
      videoEl?.removeEventListener('error', clear)
    }
  }, [asset?.id, asset?.url, videoEl])

  const sourceFps = Number(asset?.settings?.fps ?? asset?.fps) || 24
  const frameStep = 1 / sourceFps
  const decodedSourceDuration = decodedSourceMeasurement && decodedSourceMeasurement.assetId === asset?.id
    && decodedSourceMeasurement?.assetUrl === asset?.url && decodedSourceMeasurement?.video === videoEl
    ? decodedSourceMeasurement.duration : null
  const sourceDuration = decodedSourceDuration ?? [asset?.duration, asset?.settings?.duration]
    .map(Number).find(value => Number.isFinite(value) && value > 0) ?? 0

  const effIn = inPoint ?? 0
  const effOut = outPoint ?? sourceDuration
  const hasRange = inPoint != null || outPoint != null
  const rangeDuration = Math.max(0, effOut - effIn)

  const clampT = useCallback(
    (value) => Math.max(0, Math.min(sourceDuration || 0, value)),
    [sourceDuration]
  )

  // Position readouts bypass React: the playhead line and timecode update on
  // every animation frame, and re-rendering the panel 60×/s for a moving
  // <div> is the exact class of mistake the playback-perf work removed.
  useEffect(() => {
    let raf = null
    const tick = () => {
      const video = getPreviewVideo()
      if (video) {
        // During a coalesced scrub the pending target is where the user's
        // hand is; the video's own time trails it by one in-flight seek.
        const t = pendingSeekRef.current ?? (video.currentTime || 0)
        const total = sourceDuration || video.duration || 1
        if (playheadRef.current) {
          playheadRef.current.style.left = `${Math.min(100, (t / total) * 100)}%`
        }
        if (tcRef.current) tcRef.current.textContent = formatTc(t)
        if (!video.paused && outPoint != null && t >= outPoint - 0.001) {
          video.pause()
          video.currentTime = outPoint
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [sourceDuration, outPoint])

  // Backstop for the rAF out-point stop: rAF is throttled to zero when the
  // window is hidden or occluded, but 'timeupdate' keeps firing — without
  // this, backgrounded playback would sail through the Out point. Coarser
  // than rAF (~4Hz), and the seek back to outPoint corrects any overshoot.
  useEffect(() => {
    if (outPoint == null) return undefined
    const video = getPreviewVideo()
    if (!video) return undefined
    const onTimeUpdate = () => {
      if (!video.paused && video.currentTime >= outPoint - 0.001) {
        video.pause()
        video.currentTime = outPoint
      }
    }
    video.addEventListener('timeupdate', onTimeUpdate)
    return () => video.removeEventListener('timeupdate', onTimeUpdate)
  }, [outPoint])

  const requestSeek = useCallback((value) => {
    const video = getPreviewVideo()
    if (!video) return
    const target = clampT(value)
    if (video.seeking) {
      pendingSeekRef.current = target
      return
    }
    issueCoalescedSeek(video, target, pendingSeekRef)
  }, [clampT])

  const togglePlay = useCallback(() => {
    const video = getPreviewVideo()
    if (!video) return
    if (video.paused) {
      pendingSeekRef.current = null
      if (outPoint != null && video.currentTime >= outPoint - 0.001) {
        video.currentTime = effIn
      }
      void video.play()
    } else {
      video.pause()
    }
  }, [effIn, outPoint])

  const stepFrame = useCallback((direction) => {
    const video = getPreviewVideo()
    if (!video) return
    video.pause()
    // Frame steps are precise and final — drop any stale scrub target so a
    // late coalesced drain can't stomp the stepped position.
    pendingSeekRef.current = null
    video.currentTime = clampT((video.currentTime || 0) + direction * frameStep)
  }, [clampT, frameStep])

  const markIn = useCallback(() => {
    const t = pendingSeekRef.current ?? getPreviewVideo()?.currentTime ?? 0
    setInPoint(Math.min(t, (outPoint ?? sourceDuration) - frameStep))
  }, [outPoint, sourceDuration, frameStep])

  const markOut = useCallback(() => {
    const t = pendingSeekRef.current ?? getPreviewVideo()?.currentTime ?? 0
    setOutPoint(Math.max(t, (inPoint ?? 0) + frameStep))
  }, [inPoint, frameStep])

  const clearRange = useCallback(() => {
    setInPoint(null)
    setOutPoint(null)
  }, [])

  // Capture-phase listener so I/O/X/Space never fall through to the global
  // shortcuts while the monitor is in asset mode (out there I/O set the
  // timeline range and X is cut-at-playhead). Modified combos pass through —
  // Alt+X still clears the timeline In/Out. Escape hands the monitor back to
  // the timeline; no stopPropagation so an open context menu still closes.
  useEffect(() => attachSourceTransportKeyboard({
    canHandle: () => {
      const state = useAssetsStore.getState()
      return state.previewMode === 'asset' && state.currentPreview?.id === asset?.id && state.currentPreview?.url === asset?.url
        && state.videoRef === videoEl && useTimelineStore.getState().timelineSessionId === timelineSessionId
        && !state.mediaPreparation?.critical
    },
    onAction: action => {
      if (action === 'exit') {
        if (document.fullscreenElement) return
        if ((useTimelineStore.getState().clips || []).length === 0) return
        setPreviewMode('timeline')
        return
      }
      if (action === 'in') markIn()
      else if (action === 'out') markOut()
      else if (action === 'clear') clearRange()
      else if (action === 'toggle') togglePlay()
      else if (action === 'previous-frame') stepFrame(-1)
      else if (action === 'next-frame') stepFrame(1)
    }
  }), [asset?.id, asset?.url, videoEl, timelineSessionId, markIn, markOut, clearRange, togglePlay, stepFrame, setPreviewMode])

  // Scrub bar: click/drag scrubs, gold handles drag the In/Out points.
  const positionToTime = useCallback((clientX) => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return 0
    return clampT(((clientX - rect.left) / rect.width) * (sourceDuration || 0))
  }, [clampT, sourceDuration])

  const applyPointer = useCallback((event) => {
    if (!draggingRef.current) return
    const t = positionToTime(event.clientX)
    if (draggingRef.current === 'in') {
      setInPoint(Math.min(t, (outPoint ?? sourceDuration) - frameStep))
    } else if (draggingRef.current === 'out') {
      setOutPoint(Math.max(t, (inPoint ?? 0) + frameStep))
    } else {
      getPreviewVideo()?.pause?.()
      requestSeek(t)
    }
  }, [positionToTime, inPoint, outPoint, sourceDuration, frameStep, requestSeek])

  const onBarPointerDown = useCallback((event) => {
    const targetRole = event.target?.dataset?.role
    draggingRef.current = targetRole === 'in-handle' ? 'in' : targetRole === 'out-handle' ? 'out' : 'scrub'
    barRef.current?.setPointerCapture?.(event.pointerId)
    applyPointer(event)
  }, [applyPointer])

  const onBarPointerMove = applyPointer

  const onBarPointerUp = useCallback(() => {
    draggingRef.current = null
  }, [])

  // ---- Source edits ----------------------------------------------------

  const sourceEditRequests = useMemo(() => Object.fromEntries(
    Object.keys(SOURCE_EDIT_LABELS).map((mode) => [mode, { asset, mode, inPoint, outPoint, sourceDuration }])
  ), [asset, inPoint, outPoint, sourceDuration])

  // The store owns range validation, destination resolution, and edit scope.
  // Subscribe to every timeline input used by its preview so the displayed
  // targets and blockers always reflect the current timeline. On click, pass
  // this exact preview's token rather than silently accepting a newer target.
  const sourceEditPreviews = useMemo(() => Object.fromEntries(
    Object.entries(sourceEditRequests).map(([mode, request]) => [mode,
      previewSourceEdit?.(request) || { ok: false, reason: 'Source editing is not available yet.' },
    ])
  ), [
    sourceEditRequests, previewSourceEdit, timelineTracks, timelineClips,
    timelineTransitions, timelineMarkers, timelineFps, activeTrackId,
    playheadPosition, timelineSessionId, timelineHistory, timelineHistoryIndex,
    timelineClipCounter, timelineDuration, timelineIsPlaying,
  ])

  const sourceEditBlockers = useMemo(() => {
    const byReason = new Map()
    Object.entries(sourceEditPreviews).forEach(([mode, preview]) => {
      if (preview.ok) return
      const reason = preview.reason || 'This edit is not available.'
      const labels = byReason.get(reason) || []
      labels.push(SOURCE_EDIT_LABELS[mode])
      byReason.set(reason, labels)
    })
    return Array.from(byReason, ([reason, labels]) => ({ reason, label: labels.join(' / ') }))
  }, [sourceEditPreviews])

  const handleSourceEdit = useCallback((mode) => {
    const preview = sourceEditPreviews[mode]
    if (!preview?.ok) {
      showFooterNote({ tone: 'error', text: preview?.reason || 'This edit is not available.' })
      return
    }
    const result = useTimelineStore.getState().applySourceEdit?.(sourceEditRequests[mode], preview.token)
    if (!result?.ok) {
      showFooterNote({ tone: 'error', text: result?.reason || 'Could not apply the source edit. No clips were added.' })
      return
    }
    const action = mode === 'overwrite' ? 'Overwrote' : mode === 'append' ? 'Added' : 'Inserted'
    const targets = (preview.targetTrackNames || [preview.videoTrackName, preview.audioTrackName]).filter(Boolean).join(' + ')
    showFooterNote({
      tone: 'success',
      text: `${action} ${formatTc(result.duration)} at ${formatTc(result.startTime)}${targets ? ` on ${targets}` : ''}${hasRange ? ` (source ${formatTc(effIn)} → ${formatTc(effOut)})` : ''}.`,
    })
  }, [sourceEditPreviews, sourceEditRequests, hasRange, effIn, effOut, showFooterNote])

  const videoTrackName = Object.values(sourceEditPreviews).find((preview) => preview.videoTrackName)?.videoTrackName
  const audioTrackName = Object.values(sourceEditPreviews).find((preview) => preview.audioTrackName)?.audioTrackName

  if (!asset) return null

  const barPct = (value) => `${sourceDuration > 0 ? Math.min(100, (value / sourceDuration) * 100) : 0}%`

  return (
    <div className="bg-sf-dark-900 border-t border-sf-dark-700 flex-shrink-0">
      {/* Source scrub bar — replaces the plain preview scrubber in asset mode */}
      <div className="h-7 flex items-center px-3 gap-2">
        <span ref={tcRef} className="text-[10px] text-sf-text-secondary font-mono w-12 text-right">
          00:00.0
        </span>
        <div
          ref={barRef}
          onPointerDown={onBarPointerDown}
          onPointerMove={onBarPointerMove}
          onPointerUp={onBarPointerUp}
          className="relative flex-1 h-5 cursor-pointer touch-none select-none"
        >
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 bg-sf-dark-700 rounded-full" />
          {hasRange && (
            <>
              <div
                className="absolute top-1/2 -translate-y-1/2 h-2.5 rounded-sm bg-sf-accent/25 border-y border-sf-accent/70"
                style={{ left: barPct(effIn), width: barPct(rangeDuration) }}
              />
              <div
                data-role="in-handle"
                className="absolute inset-y-0 z-[3] w-2 cursor-ew-resize rounded-sm bg-sf-accent"
                style={{ left: `calc(${barPct(effIn)} - 4px)` }}
                title="In point — drag, or press I at the playhead"
              />
              <div
                data-role="out-handle"
                className="absolute inset-y-0 z-[3] w-2 cursor-ew-resize rounded-sm bg-sf-accent"
                style={{ left: `calc(${barPct(effOut)} - 4px)` }}
                title="Out point — drag, or press O at the playhead"
              />
            </>
          )}
          <div ref={playheadRef} className="pointer-events-none absolute inset-y-0 z-[2] w-0.5 bg-white" />
        </div>
        <span className="text-[10px] text-sf-text-muted font-mono w-12">
          {formatTc(sourceDuration)}
        </span>
      </div>

      {/* Transport and source marks */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
        <button
          type="button"
          onClick={togglePlay}
          title={isPlaying ? 'Pause (Space)' : 'Play the marked range (Space)'}
          className="inline-flex items-center gap-1 rounded-md bg-sf-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-sf-accent/90"
        >
          {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={() => stepFrame(-1)} title="Back one frame (←)" className="rounded-md border border-sf-dark-600 bg-sf-dark-800 px-2 py-1 text-xs text-sf-text-primary hover:bg-sf-dark-700">
          <ChevronLeft className="h-3 w-3" />
        </button>
        <button type="button" onClick={() => stepFrame(1)} title="Forward one frame (→)" className="rounded-md border border-sf-dark-600 bg-sf-dark-800 px-2 py-1 text-xs text-sf-text-primary hover:bg-sf-dark-700">
          <ChevronRight className="h-3 w-3" />
        </button>
        <button type="button" onClick={markIn} className="rounded-md border border-sf-dark-600 bg-sf-dark-800 px-2 py-1 text-xs text-sf-text-primary hover:bg-sf-dark-700">
          In <span className="ml-0.5 rounded border border-sf-dark-500 px-1 font-mono text-[10px] text-sf-text-muted">I</span>
        </button>
        <button type="button" onClick={markOut} className="rounded-md border border-sf-dark-600 bg-sf-dark-800 px-2 py-1 text-xs text-sf-text-primary hover:bg-sf-dark-700">
          Out <span className="ml-0.5 rounded border border-sf-dark-500 px-1 font-mono text-[10px] text-sf-text-muted">O</span>
        </button>
        <button type="button" onClick={clearRange} className="rounded-md border border-sf-dark-600 bg-sf-dark-800 px-2 py-1 text-xs text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary">
          Clear <span className="ml-0.5 rounded border border-sf-dark-500 px-1 font-mono text-[10px]">X</span>
        </button>
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-1.5 font-mono text-[10px] text-sf-text-muted">
          <span>In <span className="text-sf-text-primary">{formatTc(inPoint)}</span></span>
          <span>Out <span className="text-sf-text-primary">{formatTc(outPoint)}</span></span>
          <span>Range <span className="text-sf-accent">{hasRange ? formatTc(rangeDuration) : 'full clip'}</span></span>
        </div>
      </div>

      <div className="space-y-1.5 border-t border-sf-dark-700 px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div data-testid="source-edit-targets" className="flex min-w-0 flex-1 basis-48 flex-wrap gap-x-3 gap-y-1 text-[10px] text-sf-text-muted">
            <span className="min-w-0 break-words">Video: <span className="text-sf-text-primary">{videoTrackName || '—'}</span></span>
            <span className="min-w-0 break-words">Audio: <span className="text-sf-text-primary">{audioTrackName || '—'}</span></span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="source-edit-insert"
              onClick={() => handleSourceEdit('insert')}
              disabled={!sourceEditPreviews.insert.ok}
              aria-describedby={`${sourceEditDescriptionId} ${sourceEditStatusId}`}
              title={sourceEditPreviews.insert.ok ? 'Open space at the playhead across the whole timeline' : sourceEditPreviews.insert.reason}
              className="rounded-md bg-sf-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-sf-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Insert at Playhead
            </button>
            <button
              type="button"
              data-testid="source-edit-overwrite"
              onClick={() => handleSourceEdit('overwrite')}
              disabled={!sourceEditPreviews.overwrite.ok}
              aria-describedby={`${sourceEditDescriptionId} ${sourceEditStatusId}`}
              title={sourceEditPreviews.overwrite.ok ? 'Replace material at the playhead on destination tracks only' : sourceEditPreviews.overwrite.reason}
              className="rounded-md border border-sf-dark-600 bg-sf-dark-800 px-2.5 py-1 text-xs text-sf-text-primary hover:bg-sf-dark-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Overwrite at Playhead
            </button>
            <button
              type="button"
              data-testid="source-edit-append"
              onClick={() => handleSourceEdit('append')}
              disabled={!sourceEditPreviews.append.ok}
              aria-describedby={`${sourceEditDescriptionId} ${sourceEditStatusId}`}
              title={sourceEditPreviews.append.ok ? `Add at ${formatTc(sourceEditPreviews.append.startTime)} on destination tracks` : sourceEditPreviews.append.reason}
              className="rounded-md border border-sf-dark-600 bg-sf-dark-800 px-2.5 py-1 text-xs text-sf-text-primary hover:bg-sf-dark-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add to End
            </button>
          </div>
        </div>
        <p id={sourceEditDescriptionId} className="text-[10px] leading-relaxed text-sf-text-muted">
          Insert affects the whole timeline, including markers. Overwrite affects destination tracks only.
        </p>
        <div id={sourceEditStatusId} data-testid="source-edit-status" role="status" aria-live="polite" aria-atomic="true" className="space-y-1 break-words text-[10px] leading-relaxed">
          {footerNote.text && (
            <p className={footerNote.tone === 'error' ? 'text-sf-error' : footerNote.tone === 'success' ? 'text-sf-success' : 'text-sf-text-muted'}>
              {footerNote.text}
            </p>
          )}
          {sourceEditBlockers.map(({ reason, label }) => (
            <p key={reason} className="text-sf-error">{label}: {reason}</p>
          ))}
        </div>
      </div>
    </div>
  )
}
