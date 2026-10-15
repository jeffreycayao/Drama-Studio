import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatTimecode } from '../utils/timelineFrames'
import TrimPreviewFrame from './TrimPreviewFrame'

function RollFrame({ feedback, fps, side }) {
  const outgoing = side === 'outgoing'
  return <TrimPreviewFrame feedback={feedback} fps={fps} testId={`roll-edit-${side}-canvas`}
    frameStyle={{ minHeight: 0, flexShrink: 1 }}>
    {({ frame, state, status, asset, clip }) => {
      const name = clip.name || asset?.name || 'Clip'
      return <section data-testid={`roll-edit-${side}`} data-state={state} data-clip-id={clip.id}
        aria-label={`${outgoing ? 'Outgoing last' : 'Incoming first'} source frame`}
        className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-black/20">
        <header className="shrink-0 border-b border-white/10 px-3 py-1.5 text-[11px]">
          <div className="text-accent">{outgoing ? 'Outgoing · Last frame' : 'Incoming · First frame'}</div>
          <div data-testid={`roll-edit-${side}-name`} className="truncate font-medium" title={name}>{name}</div>
        </header>
        {frame}
        <p data-testid={`roll-edit-${side}-status`} className="shrink-0 break-words px-3 py-1.5 text-[10px] leading-relaxed text-gray-400">{status}</p>
      </section>
    }}
  </TrimPreviewFrame>
}

/** Two private muted source viewers; no shared preview or playhead writes. */
export default function RollEditPreview({ feedback, anchor, fps = 24, reason = null }) {
  const panelRef = useRef(null)
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const [panelHeight, setPanelHeight] = useState(300)
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

  if (!reason && (!feedback?.outgoing?.clip || !feedback?.incoming?.clip)) return null
  const width = Math.min(reason ? 340 : 560, Math.max(1, viewport.width - 16))
  const height = Math.min(panelHeight, Math.max(1, viewport.height - 16))
  const stacked = width < 440
  const left = Math.max(8, Math.min((Number(anchor?.x) || 8) - width / 2, viewport.width - width - 8))
  const top = Math.max(8, Math.min((Number(anchor?.y) || height + 24) - height - 16, viewport.height - height - 8))
  if (reason) return createPortal(<aside ref={panelRef} data-testid="roll-edit-refusal" role="status" aria-live="polite"
    className="fixed z-[10000] overflow-hidden rounded-lg border border-amber-400/40 bg-[#10131d] px-3 py-2 text-white shadow-2xl"
    style={{ width, left, top, pointerEvents: 'none', maxHeight: Math.max(1, viewport.height - 16) }}>
    <p className="mb-1 text-xs font-medium text-amber-200">Cannot roll this cut</p>
    <p className="break-words text-[11px] leading-relaxed text-gray-300">{reason}</p>
  </aside>, document.body)
  const frameDelta = Math.round(Number(feedback.deltaFrames) || 0)
  const delta = `${frameDelta > 0 ? '+' : frameDelta < 0 ? '−' : ''}${Math.abs(frameDelta)} frame${Math.abs(frameDelta) === 1 ? '' : 's'}`
  const constraintClip = [feedback.outgoing.clip, feedback.incoming.clip].find(clip => clip.id === feedback.limit?.clipId)
  return createPortal(<aside ref={panelRef} data-testid="roll-edit-preview" data-layout={stacked ? 'stacked' : 'two-up'}
    aria-label="Rolling edit source preview"
    className="fixed z-[10000] flex flex-col overflow-hidden rounded-lg border border-accent/60 bg-[#10131d] text-white shadow-2xl"
    style={{ width, left, top, pointerEvents: 'none', maxHeight: Math.max(1, viewport.height - 16) }}>
    <header className="shrink-0 border-b border-white/10 px-3 py-1.5 text-center text-xs font-medium">Rolling edit · source preview</header>
    <div className="grid min-h-0 gap-px bg-white/10" style={{
      gridTemplateColumns: stacked ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))',
      gridTemplateRows: stacked ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
    }}>
      <RollFrame feedback={feedback.outgoing} fps={fps} side="outgoing" />
      <RollFrame feedback={feedback.incoming} fps={fps} side="incoming" />
    </div>
    <footer className="shrink-0 space-y-1.5 border-t border-white/10 px-3 py-2 text-[11px]">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <span className="text-gray-400">Cut <span data-testid="roll-edit-cut-time" className="font-mono tabular-nums text-white">{formatTimecode(feedback.cutTime, fps)}</span></span>
        <span data-testid="roll-edit-delta" className="font-medium text-accent">{delta}</span>
      </div>
      {feedback.limit && <p data-testid="roll-edit-limit" className="break-words text-center leading-relaxed text-amber-300">{feedback.limit.label}{constraintClip?.name ? ` · ${constraintClip.name}` : ''}</p>}
    </footer>
  </aside>, document.body)
}
