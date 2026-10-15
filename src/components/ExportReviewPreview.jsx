import { useLayoutEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Film, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import useTimelineStore from '../stores/timelineStore'
import useProjectStore from '../stores/projectStore'
import useAssetsStore from '../stores/assetsStore'
import videoCache from '../services/videoCache'
import { stepTimeByFrames, timeToFrameIndex } from '../utils/timelineFrames'
import { formatExportOverviewTimecode } from '../utils/exportTimelineOverview.mjs'
import { getPlaybackReviewRange } from '../utils/playbackReviewRange.mjs'
import { attachReviewTransportKeyboard } from '../utils/reviewTransportKeyboard.mjs'
import PreviewPanel from './PreviewPanel'

const transportButtonClass = 'rounded-md p-2 text-sf-text-secondary transition-colors hover:bg-sf-dark-600 hover:text-sf-text-primary disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent'

function ActiveExportReview({ rangeStart, rangeEnd }) {
  const { playheadPosition, isPlaying, playbackRate, timelineFps, timelineSessionId, clips, getTimelineEndTime } = useTimelineStore()
  const { getCurrentTimelineSettings } = useProjectStore()
  const fps = getCurrentTimelineSettings()?.fps || timelineFps || 30
  const timelineEnd = getTimelineEndTime()
  const range = useMemo(() => getPlaybackReviewRange({ start: rangeStart, end: rangeEnd }, timelineEnd, fps),
    [rangeStart, rangeEnd, timelineEnd, fps])
  const hasContent = clips.length > 0 && range.duration > 0
  const timecode = (time) => formatExportOverviewTimecode(timeToFrameIndex(time, range.fps), range.fps)

  // This session exists only while the Export tab is visible and idle. Do
  // not seek, change selection/marks, or touch a replacement timeline when
  // releasing it. Layout cleanup also pauses pooled video decoders before
  // another workspace or the export worker takes over.
  useLayoutEffect(() => () => {
    const state = useTimelineStore.getState()
    if (state.timelineSessionId === timelineSessionId && state.isPlaying) state.shuttlePause()
    videoCache.pauseAll()
  }, [timelineSessionId])

  const seekFrame = (position) => {
    const state = useTimelineStore.getState()
    if (state.isPlaying) state.shuttlePause()
    state.setPlayheadPosition(Math.max(range.start, Math.min(range.lastFrame, position)), { snap: true, intent: 'frame-step' })
  }
  const stepFrame = (direction) => {
    seekFrame(stepTimeByFrames(useTimelineStore.getState().playheadPosition, direction, range.fps,
      { min: range.start, max: range.lastFrame }))
  }
  const togglePlayback = () => {
    if (!hasContent) return
    const state = useTimelineStore.getState()
    if (state.isPlaying) {
      state.shuttlePause()
      return
    }
    const epsilon = 1e-7 / range.fps
    const startPosition = state.playheadPosition < range.start - epsilon || state.playheadPosition >= range.lastFrame - epsilon
      ? range.start : state.playheadPosition
    if (startPosition !== state.playheadPosition) {
      state.setPlayheadPosition(startPosition, { snap: true })
    }
    state.togglePlay()
    // The editor's normal Play action rewinds at the last clip's end. A
    // marked export range may intentionally extend beyond that into black,
    // so restore its requested start through the regular jump/readiness path.
    const playingState = useTimelineStore.getState()
    if (playingState.isPlaying && Math.abs(playingState.playheadPosition - startPosition) > 0.5 / range.fps) {
      playingState.setPlayheadPosition(startPosition, { snap: true })
    }
  }

  const startShuttle = (action) => {
    const state = useTimelineStore.getState()
    const reverse = action.endsWith('reverse')
    const position = state.playheadPosition
    const epsilon = 1e-7 / range.fps
    const outsideRange = position < range.start - epsilon || position > range.lastFrame + epsilon
    if (outsideRange || (reverse ? position <= range.start + epsilon : position >= range.lastFrame - epsilon)) {
      seekFrame(reverse ? range.lastFrame : range.start)
    }
    const current = useTimelineStore.getState()
    if (action.startsWith('slow-') || action.startsWith('hold-')) {
      current.shuttleSlow(reverse ? 'reverse' : 'forward', action.startsWith('slow-'))
    } else if (reverse) current.shuttleReverse()
    else current.shuttleForward()
  }

  // The Editor's TransportControls is deliberately unmounted in Export. Own
  // only review shortcuts here, using the same shuttle actions and the same
  // bounded seek/play paths as these buttons. Hidden/busy review owns none.
  useLayoutEffect(() => attachReviewTransportKeyboard({
    canHandle: () => hasContent
      && useTimelineStore.getState().timelineSessionId === timelineSessionId
      && useTimelineStore.getState().clips.length > 0
      && !useAssetsStore.getState().mediaPreparation?.critical,
    onAction: action => {
      if (action === 'toggle') togglePlayback()
      else if (action === 'pause') useTimelineStore.getState().shuttlePause()
      else if (action === 'previous-frame') stepFrame(-1)
      else if (action === 'next-frame') stepFrame(1)
      else if (action === 'start') seekFrame(range.start)
      else if (action === 'end') seekFrame(range.lastFrame)
      else startShuttle(action)
    },
  }), [timelineSessionId, hasContent, range.start, range.end, range.fps])

  return (
    <div data-testid="export-review-preview" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <PreviewPanel reviewOnly playbackRange={range} />
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-sf-dark-500 bg-sf-dark-800 px-4 py-2">
        <div className="flex items-center gap-0.5" aria-label="Timeline review transport">
          <button type="button" className={transportButtonClass} disabled={!hasContent} onClick={() => seekFrame(range.start)} title="Go to range start · Home" aria-label="Go to range start" aria-keyshortcuts="Home">
            <SkipBack className="h-4 w-4" />
          </button>
          <button type="button" className={transportButtonClass} disabled={!hasContent} onClick={() => stepFrame(-1)} title="Previous frame · Left arrow" aria-label="Previous frame" aria-keyshortcuts="ArrowLeft">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" data-testid="export-review-play" className={`${transportButtonClass} mx-1 bg-sf-dark-600 !px-3 !text-sf-text-primary`} disabled={!hasContent} onClick={togglePlayback}
            title={`${isPlaying ? 'Pause review' : 'Play range'} · Space/Enter · J/L shuttle · Shift+J/L slow shuttle · K pause`}
            aria-label={isPlaying ? 'Pause review' : 'Play range'} aria-keyshortcuts="Space Enter J K L Shift+J Shift+L">
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button type="button" className={transportButtonClass} disabled={!hasContent} onClick={() => stepFrame(1)} title="Next frame · Right arrow" aria-label="Next frame" aria-keyshortcuts="ArrowRight">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button type="button" className={transportButtonClass} disabled={!hasContent} onClick={() => seekFrame(range.lastFrame)} title="Go to last frame of range · End" aria-label="Go to last frame of range" aria-keyshortcuts="End">
            <SkipForward className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-sf-text-muted">
          {isPlaying && playbackRate !== 1 && <span data-testid="export-review-rate" className="font-mono text-sf-accent">
            {playbackRate < 0 ? '◀' : '▶'} {Math.abs(playbackRate)}×
          </span>}
          <span className="font-mono tabular-nums text-sf-text-secondary" data-testid="export-review-timecode">{timecode(playheadPosition)}</span>
          <span>/</span>
          <span className="font-mono tabular-nums">{timecode(range.end)}</span>
        </div>
      </div>
    </div>
  )
}

/** A visible-only, non-authoring view of the editor's actual timeline preview. */
export default function ExportReviewPreview({ active = false, disabled = false, rangeStart = 0, rangeEnd = null }) {
  // Keep this boundary outside the subscribed/clocked component. ExportPanel
  // stays mounted for jobs, but a hidden or busy Export tab owns no renderer.
  if (!active) return null
  if (disabled) {
    return (
      <div data-testid="export-review-paused" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-sf-dark-900 px-6 py-10 text-center text-xs text-sf-text-muted">
        <Film className="h-7 w-7 opacity-50" />
        <span>Timeline preview is paused while export is running.</span>
      </div>
    )
  }
  return <ActiveExportReview rangeStart={rangeStart} rangeEnd={rangeEnd} />
}
