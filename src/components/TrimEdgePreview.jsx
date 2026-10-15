import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatTimecode } from '../utils/timelineFrames'
import TrimPreviewFrame from './TrimPreviewFrame'

/** A disposable source viewer; it never seeks the playhead or shared videos. */
export default function TrimEdgePreview({ feedback, anchor, fps = 24, mode = 'trim', reason = null }) {
  const panelRef = useRef(null)
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const [panelHeight, setPanelHeight] = useState(320)

  useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return undefined
    const measure = () => {
      const height = Math.ceil(panel.getBoundingClientRect().height)
      setPanelHeight(previous => previous === height ? previous : height)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [Boolean(feedback), Boolean(reason)])

  const isRipple = mode === 'ripple'
  const testIdPrefix = isRipple ? 'ripple-trim' : 'trim-edge'
  if (!feedback?.clip && !reason) return null
  const count = Math.max(1, Number(feedback?.affectedCount) || 1)
  const followingCount = Math.max(0, Number(feedback?.shiftedClipCount) || 0)
  const frameDelta = Math.round(Number(feedback?.durationDeltaFrames) || 0)
  const delta = frameDelta === 0 ? '0 frames' : `${frameDelta > 0 ? '+' : '−'}${Math.abs(frameDelta)} frame${Math.abs(frameDelta) === 1 ? '' : 's'} ${frameDelta > 0 ? 'added' : 'removed'}`
  const width = Math.min(300, Math.max(1, viewport.width - 16))
  const height = Math.min(panelHeight, Math.max(1, viewport.height - 16))
  const left = Math.max(8, Math.min((Number(anchor?.x) || 8) - width / 2, viewport.width - width - 8))
  const top = Math.max(8, Math.min((Number(anchor?.y) || height + 24) - height - 16, viewport.height - height - 8))

  if (reason) return createPortal(<aside ref={panelRef} data-testid={`${testIdPrefix}-refusal`} role="status" aria-live="polite"
    className="fixed z-[10000] overflow-hidden rounded-lg border border-amber-400/40 bg-[#10131d] px-3 py-2 text-white shadow-2xl"
    style={{ width, left, top, pointerEvents: 'none', maxHeight: Math.max(1, viewport.height - 16) }}>
    <p className="mb-1 text-xs font-medium text-amber-200">Cannot ripple trim</p>
    <p className="break-words text-[11px] leading-relaxed text-gray-300">{reason}</p>
  </aside>, document.body)

  return <TrimPreviewFrame feedback={feedback} fps={fps} testId={`${testIdPrefix}-canvas`}>
    {({ frame, state, status, asset, clip, clips }) => {
      const constraintClip = feedback.limit?.clipId && feedback.limit.clipId !== clip.id
        ? clips.find(item => item.id === feedback.limit.clipId)
        : null
      const name = clip.name || asset?.name || 'Clip'
      return createPortal(
        <aside
          ref={panelRef}
          data-testid={`${testIdPrefix}-preview`} data-state={state} data-edge={feedback.edge} data-clip-id={clip.id}
          className="fixed z-[10000] overflow-hidden rounded-lg border border-accent/60 bg-[#10131d] text-white shadow-2xl"
          style={{ width, left, top, pointerEvents: 'none', maxHeight: Math.max(1, viewport.height - 16) }}
          aria-label={`${isRipple ? 'Ripple ' : ''}${feedback.edge === 'left' ? 'Head' : 'Tail'} trim source preview`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2 text-xs">
            <span className="truncate font-medium" title={name}>{name}</span>
            <span className="shrink-0 text-accent">{feedback.edge === 'left' ? 'First frame' : 'Last frame'}</span>
          </div>
          {frame}
          <div className="space-y-1.5 px-3 py-2 text-[11px]">
            <div className="flex items-center justify-between gap-2 text-gray-400">
              <span data-testid={`${testIdPrefix}-status`}>{status}</span>
              {count > 1 && <span className="shrink-0">{count} clips</span>}
            </div>
            <div className="flex justify-between gap-2"><span className="text-gray-400">{isRipple && feedback.edge === 'left' ? 'Head stays at' : 'Cut'}</span><span data-testid={`${testIdPrefix}-time`} className="font-mono tabular-nums">{formatTimecode(feedback.edgeTime, fps)}</span></div>
            <div className="flex justify-between gap-2"><span className="text-gray-400">Duration</span><span data-testid={`${testIdPrefix}-duration`} className="font-mono tabular-nums">{formatTimecode(feedback.duration, fps)}</span></div>
            <div data-testid={`${testIdPrefix}-delta`} className="font-medium text-accent">{delta}</div>
            {isRipple && <div className="space-y-1 border-t border-accent/20 pt-1.5">
              <p data-testid="ripple-trim-tracks" className="break-words leading-relaxed text-accent">Ripple: {(feedback.affectedTrackNames || []).join(', ') || 'Target tracks'} · {followingCount} following clip{followingCount === 1 ? '' : 's'}</p>
              <p className="text-[10px] text-gray-400">Other tracks stay fixed</p>
            </div>}
            {feedback.limit && <div data-testid={`${testIdPrefix}-limit`} className="break-words border-t border-amber-400/20 pt-1.5 text-amber-300">{feedback.limit.label}{constraintClip ? ` · ${constraintClip.name || 'Another selected clip'}` : ''}</div>}
          </div>
        </aside>, document.body
      )
    }}
  </TrimPreviewFrame>
}
