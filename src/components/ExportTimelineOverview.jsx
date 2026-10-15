import { useEffect, useMemo, useRef } from 'react'
import { Film, Music2 } from 'lucide-react'
import useTimelineStore from '../stores/timelineStore'
import useProjectStore from '../stores/projectStore'
import useAssetsStore from '../stores/assetsStore'
import { useI18n } from '../i18n/I18nContext'
import { timeToFrameIndex } from '../utils/timelineFrames'
import { hasVideoSolo, isVideoTrackVisible } from '../utils/videoTrackVisibility'
import { hasAudioSolo, isAudioTrackAudible } from '../utils/audioTrackAudibility'
import { createTimelineScrubScheduler } from '../utils/timelineScrubScheduler.mjs'
import {
  clampExportOverviewFrame,
  exportOverviewFramePercent,
  formatExportOverviewTimecode,
  getExportOverviewBounds,
  getExportOverviewClipSpan,
  getExportOverviewPointerFrame,
  getExportOverviewTicks,
  seekExportOverviewFrame,
} from '../utils/exportTimelineOverview.mjs'

/** A navigation-only view of the authored timeline. Frame props use project
 * FPS and an exclusive end, independently of the chosen delivery FPS. */
export default function ExportTimelineOverview({ startFrame = 0, endFrame, rangeMode = 'full', disabled = false, className = '' }) {
  const { t } = useI18n()
  const clips = useTimelineStore((state) => state.clips)
  const tracks = useTimelineStore((state) => state.tracks)
  const playheadPosition = useTimelineStore((state) => state.playheadPosition)
  const timelineFps = useTimelineStore((state) => state.timelineFps)
  const timelineSessionId = useTimelineStore((state) => state.timelineSessionId)
  const assets = useAssetsStore((state) => state.assets)
  const projectFps = useProjectStore((state) => (
    state.currentProject?.timelines?.find((timeline) => timeline.id === state.currentTimelineId)?.fps
      || state.currentProject?.settings?.fps
  ))
  const bounds = useMemo(() => getExportOverviewBounds({ clips, fps: projectFps || timelineFps, startFrame, endFrame }),
    [clips, projectFps, timelineFps, startFrame, endFrame])
  const { fps, totalFrames, lastFrame } = bounds
  const currentFrame = clampExportOverviewFrame(timeToFrameIndex(playheadPosition, fps), totalFrames)
  const playheadPercent = exportOverviewFramePercent(timeToFrameIndex(playheadPosition, fps), totalFrames)
  const rangeLeft = exportOverviewFramePercent(bounds.startFrame, totalFrames)
  const rangeWidth = exportOverviewFramePercent(bounds.endFrame, totalFrames) - rangeLeft
  const ticks = useMemo(() => getExportOverviewTicks(totalFrames), [totalFrames])
  const sliderRef = useRef(null)
  const gestureRef = useRef(null)
  const unavailable = disabled || !bounds.hasContent
  const timecode = (frame) => formatExportOverviewTimecode(frame, fps)
  const fpsLabel = Number(fps.toFixed(3))
  const rangeLabel = rangeMode === 'full'
    ? t('export.overview.fullTimeline', undefined, 'Full timeline')
    : t('export.overview.inOut', undefined, 'In / Out')
  const lanes = useMemo(() => {
    const assetNames = new Map(assets.map((asset) => [asset.id, asset.name]))
    const videoSolo = hasVideoSolo(tracks)
    const audioSolo = hasAudioSolo(tracks)
    return tracks.map((track, index) => ({
      ...track,
      label: track.name || (track.type === 'audio'
        ? t('export.overview.audioTrack', { number: index + 1 }, 'Audio {{number}}')
        : t('export.overview.videoTrack', { number: index + 1 }, 'Video {{number}}')),
      active: track.type === 'audio' ? isAudioTrackAudible(track, audioSolo) : isVideoTrackVisible(track, videoSolo),
      items: clips.filter((clip) => clip.trackId === track.id).map((clip) => ({
        clip,
        label: clip.name || assetNames.get(clip.assetId) || (clip.type === 'audio'
          ? t('export.overview.audioClip', undefined, 'Audio clip')
          : t('export.overview.clip', undefined, 'Clip')),
        span: getExportOverviewClipSpan(clip, fps, totalFrames),
      })).filter((item) => item.span),
    }))
  }, [clips, tracks, assets, fps, totalFrames, t])

  useEffect(() => () => {
    gestureRef.current?.scheduler.cancel()
    gestureRef.current = null
  }, [fps, totalFrames, timelineSessionId, disabled])

  const seek = (frame, precise = true) => {
    if (unavailable) return
    seekExportOverviewFrame(useTimelineStore.getState().setPlayheadPosition, frame, fps, totalFrames, precise)
  }
  const beginScrub = (event) => {
    if (unavailable || event.button !== 0 || event.isPrimary === false) return
    event.preventDefault()
    event.stopPropagation()
    sliderRef.current?.focus({ preventScroll: true })
    gestureRef.current?.scheduler.cancel()
    const target = event.currentTarget
    const scheduler = createTimelineScrubScheduler({
      requestFrame: requestAnimationFrame,
      cancelFrame: cancelAnimationFrame,
      readSample: (clientX) => {
        const frame = getExportOverviewPointerFrame(clientX, target.getBoundingClientRect(), totalFrames)
        return frame == null ? null : { time: frame / fps, continue: false }
      },
      getCurrentPosition: () => useTimelineStore.getState().playheadPosition,
      forcePublish: (_, phase) => phase === 'release',
      onPosition: (time, phase) => seek(Math.round(time * fps), phase === 'release'),
    })
    gestureRef.current = { scheduler, pointerId: event.pointerId }
    target.setPointerCapture?.(event.pointerId)
    scheduler.start(event.clientX)
  }
  const moveScrub = (event) => {
    if (gestureRef.current?.pointerId === event.pointerId) gestureRef.current.scheduler.move(event.clientX)
  }
  const endScrub = (event) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gestureRef.current = null
    gesture.scheduler.finish(event.type === 'lostpointercapture' ? undefined : event.clientX)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const scrubEvents = { onPointerDown: beginScrub, onPointerMove: moveScrub, onPointerUp: endScrub,
    onPointerCancel: endScrub, onLostPointerCapture: endScrub }

  const overlays = (
    <>
      {bounds.hasRange && <div data-export-overview-range aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 z-10 border-x border-sf-accent/60 bg-sf-accent/10"
        style={{ left: `${rangeLeft}%`, width: `${rangeWidth}%` }} />}
      {totalFrames > 0 && <div data-export-overview-playhead aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 z-20 w-px -translate-x-1/2 bg-sf-accent"
        style={{ left: `${playheadPercent}%` }} />}
    </>
  )

  return (
    <section aria-label={t('export.overview.regionLabel', undefined, 'Export timeline overview')} data-export-timeline-overview
      className={`export-workspace__overview min-w-0 shrink-0 overflow-hidden bg-sf-dark-950 px-3 ${className}`}>
      <div className="flex items-center justify-between gap-3 py-2.5">
        <h3 className="text-xs font-medium text-sf-text-primary">{t('export.overview.title', undefined, 'Timeline overview')}</h3>
        <span className="text-[11px] text-sf-text-muted">{t('export.overview.readOnly', undefined, 'Read-only')}</span>
      </div>
      <div className="max-h-[164px] overflow-y-auto border-y border-sf-dark-700 bg-sf-dark-900" style={{ scrollbarGutter: 'stable' }}>
        <div className="sticky top-0 z-30 flex h-7 border-b border-sf-dark-700 bg-sf-dark-900">
          <div className="export-workspace__track-label flex w-24 shrink-0 items-center px-2 text-[11px] text-sf-text-muted"
            title={t('export.overview.timecodeHint', undefined, 'Timecode uses non-drop-frame numbering.')}>
            {t('export.overview.frameRate', { fps: fpsLabel }, '{{fps}} fps')}
          </div>
          <div className={`relative min-w-0 flex-1 overflow-hidden ${unavailable ? '' : 'cursor-crosshair'}`}
            style={{ touchAction: 'none' }} {...scrubEvents}>
            {ticks.map((frame, index) => (
              <div key={frame} className="pointer-events-none absolute inset-y-0 border-l border-sf-dark-700"
                style={{ left: `${exportOverviewFramePercent(frame, totalFrames)}%` }}>
                <span data-export-overview-tick={index === 0 || index === ticks.length - 1 ? 'boundary' : 'middle'}
                  className={`absolute top-1 whitespace-nowrap font-mono text-[11px] tabular-nums text-sf-text-muted ${
                  index === 0 ? 'left-1' : index === ticks.length - 1 ? 'right-1' : 'left-0 -translate-x-1/2'}`}>
                  {timecode(frame)}
                </span>
              </div>
            ))}
            {overlays}
          </div>
        </div>
        <div className="flex min-h-12">
          <div className="export-workspace__track-label w-24 shrink-0 border-r border-sf-dark-700">
            {lanes.map((lane) => {
              const Icon = lane.type === 'audio' ? Music2 : Film
              const stateLabel = lane.active ? '' : lane.muted
                ? t('export.overview.muted', undefined, 'Muted') : lane.visible === false
                  ? t('export.overview.hidden', undefined, 'Hidden') : t('export.overview.excludedBySolo', undefined, 'Excluded by solo')
              return <div key={lane.id} className={`flex h-7 items-center gap-1.5 border-b border-sf-dark-700 px-2 text-[11px] ${lane.active ? 'text-sf-text-secondary' : 'text-sf-text-muted'}`}
                title={`${lane.label}${stateLabel ? ` · ${stateLabel}` : ''}`}>
                <Icon size={11} aria-hidden="true" className="shrink-0" />
                <span className="truncate">{lane.label}</span>
                {stateLabel && <span className="sr-only"> · {stateLabel}</span>}
              </div>
            })}
          </div>
          <div className={`relative min-w-0 flex-1 overflow-hidden ${unavailable ? '' : 'cursor-crosshair'}`}
            style={{ touchAction: 'none' }} {...scrubEvents}>
            {lanes.map((lane) => <div key={lane.id} className="relative h-7 border-b border-sf-dark-700">
              {lane.items.map(({ clip, label, span }) => <div key={clip.id}
                className={`absolute inset-y-1 overflow-hidden rounded-sm border px-1.5 text-[11px] leading-[18px] text-sf-text-primary ${
                  clip.type === 'audio' || lane.type === 'audio'
                    ? 'border-sf-clip-audio/50 bg-sf-clip-audio/30'
                    : 'border-sf-clip-video/50 bg-sf-clip-video/30'} ${!lane.active || clip.enabled === false ? 'opacity-40' : ''}`}
                style={{ left: `${span.left}%`, width: `${span.width}%` }}
                title={`${label} · ${timecode(span.startFrame)} → ${timecode(span.endFrame)}${!lane.active || clip.enabled === false ? ` · ${t('export.overview.inactive', undefined, 'Inactive')}` : ''}`}>
                <span className="block truncate">{label}</span>
              </div>)}
            </div>)}
            {!bounds.hasContent && <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-2 text-center text-[11px] text-sf-text-muted">
              {t('export.overview.empty', undefined, 'No clips on this timeline')}
            </div>}
            {overlays}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 py-3" title={rangeLabel}>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-sf-text-secondary"
          title={t('export.overview.startBoundary', undefined, 'First frame of the export range')}>
          {timecode(bounds.startFrame)}
        </span>
        <input ref={sliderRef} type="range" data-review-transport="true" min="0" max={lastFrame} step="1" value={currentFrame}
          disabled={unavailable} aria-label={t('export.overview.scrubLabel', undefined, 'Scrub export preview')}
          aria-valuetext={t('export.overview.scrubValue', { timecode: timecode(currentFrame), fps: fpsLabel }, '{{timecode}} at {{fps}} frames per second, non-drop-frame')}
          className="h-2 min-w-0 flex-1 cursor-pointer rounded accent-sf-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sf-accent disabled:cursor-default disabled:opacity-40"
          onChange={(event) => seek(Number(event.target.value))} onKeyDown={(event) => {
            // Keep native slider navigation, but don't trap playback shortcuts
            // after a mouse scrub leaves this control focused.
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) event.stopPropagation()
          }} />
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-sf-text-secondary"
          title={t('export.overview.endBoundary', undefined, 'The Out boundary is exclusive; its frame is not exported.')}>
          {timecode(bounds.endFrame)}
        </span>
      </div>
    </section>
  )
}
