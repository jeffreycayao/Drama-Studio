import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AudioLines, Cloud, Loader2, X } from 'lucide-react'
import useTimelineStore from '../stores/timelineStore'
import useAssetsStore from '../stores/assetsStore'
import { listLipSyncAudioCandidates, planLipSync, SYNC_SO_USD_PER_SECOND } from '../utils/lipSyncPlan.mjs'
import { runLipSync } from '../services/lipSync'

const formatSeconds = (value) => `${Number(Number(value || 0).toFixed(2))} s`
const formatUsd = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0)

/**
 * Timeline › clip menu › "Lip-sync to dialogue (sync.so)…".
 * 1. Pick the dialogue clip, review the length and the estimated cost.
 * 2. "Spend …" runs the paid job (services/lipSync.js) and imports the take.
 * 3. "Swap into clip" replaces the clip source through Smart Replace, as one
 *    undo step that keeps trims, transitions and linked audio. The take stays
 *    in the project either way.
 */
export default function LipSyncDialog({ clipId, onClose }) {
  const clips = useTimelineStore((state) => state.clips)
  const tracks = useTimelineStore((state) => state.tracks)
  const transitions = useTimelineStore((state) => state.transitions)
  const getAssetById = useAssetsStore((state) => state.getAssetById)
  const clip = clips.find((item) => item.id === clipId)

  const candidates = useMemo(() => listLipSyncAudioCandidates({ clips, tracks, clipId }), [clips, tracks, clipId])
  const [audioClipId, setAudioClipId] = useState(() => candidates[0]?.clipId || '')
  const [followActiveSpeaker, setFollowActiveSpeaker] = useState(false)
  const [phase, setPhase] = useState('review') // review | running | ready | applied
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [frozenPlan, setFrozenPlan] = useState(null)
  const dialogRef = useRef(null)

  const livePlan = useMemo(() => planLipSync({ clips, tracks, transitions, getAsset: getAssetById, clipId, audioClipId }),
    [clips, tracks, transitions, getAssetById, clipId, audioClipId])
  const plan = frozenPlan || livePlan

  useEffect(() => {
    dialogRef.current?.focus()
    const onKey = (event) => { if (event.key === 'Escape' && phase !== 'running') { event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, phase])

  const start = async () => {
    if (!livePlan.ok || phase !== 'review') return
    setFrozenPlan(livePlan)
    setPhase('running')
    setError('')
    try {
      const outcome = await runLipSync({ plan: livePlan, allowCloudSpend: true, followActiveSpeaker,
        onStatus: (next) => setStatus(next?.message || '') })
      setResult(outcome)
      setPhase('ready')
      setStatus('The lip-synced take is in the project. Swap it into the clip, or keep it for later.')
    } catch (err) {
      setPhase('review')
      setFrozenPlan(null)
      setError(err?.message || 'Lip-sync failed.')
    }
  }

  const swap = () => {
    if (phase !== 'ready' || !result?.asset) return
    const asset = useAssetsStore.getState().getAssetById(result.asset.id) || result.asset
    const request = { clipId, asset, sourceInSeconds: plan.sourceInSeconds }
    const store = useTimelineStore.getState()
    const preview = store.previewSmartReplace(request)
    if (!preview?.ok) { setError(preview?.reason || 'The take could not replace this clip. It is still in the project.'); return }
    const applied = store.applySmartReplace(request, preview.token)
    if (!applied?.ok) { setError(applied?.reason || 'The take could not replace this clip. It is still in the project.'); return }
    setPhase('applied')
    setStatus((applied.warnings || []).length
      ? `Swapped (undo with Ctrl+Z). ${applied.warnings.join(' ')}`
      : 'Swapped into the clip. Undo with Ctrl+Z.')
  }

  const running = phase === 'running'
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3 sm:p-4"
      onMouseDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget && !running) onClose() }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="lipsync-title" data-testid="lipsync-dialog" tabIndex={-1}
        className="flex max-h-[90vh] w-full min-w-0 max-w-lg flex-col overflow-hidden rounded-lg border border-sf-dark-600 bg-sf-dark-800 text-sf-text-primary shadow-2xl">
        <header className="flex flex-shrink-0 items-start gap-3 border-b border-sf-dark-700 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="lipsync-title" className="flex items-center gap-1.5 text-sm font-medium"><AudioLines className="h-4 w-4 text-sf-accent" />Lip-sync to dialogue</h2>
            <p className="mt-1 text-xs leading-relaxed text-sf-text-muted">Re-sync mouth movement in “{clip?.name || 'this clip'}” to a dialogue clip with sync.so, then swap the take in as one undo step.</p>
          </div>
          <button type="button" onClick={onClose} disabled={running} aria-label="Close lip-sync" className="rounded p-1 text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary disabled:opacity-40"><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 space-y-4 overflow-y-auto px-4 py-4 text-xs">
          <div>
            <label htmlFor="lipsync-audio" className="mb-1.5 block font-medium">Dialogue clip</label>
            <select id="lipsync-audio" data-testid="lipsync-audio" value={audioClipId} disabled={phase !== 'review'}
              onChange={(event) => { setAudioClipId(event.target.value); setError('') }}
              className="w-full rounded border border-sf-dark-600 bg-sf-dark-900 px-2 py-1.5 disabled:opacity-50">
              {!candidates.length && <option value="">No audio overlaps this clip</option>}
              {candidates.map((item) => (
                <option key={item.clipId} value={item.clipId}>
                  {item.name}{item.trackName ? ` · ${item.trackName}` : ''}{item.isDialogueTrack ? ' · dialogue' : ''}{item.isLinked ? ' · linked camera audio' : ''}
                </option>
              ))}
            </select>
            <p className="mt-1.5 leading-relaxed text-sf-text-muted">Where the dialogue does not cover the clip, the take gets silence (closed mouth).</p>
          </div>
          <label className="flex items-center gap-2 text-sf-text-secondary">
            <input type="checkbox" checked={followActiveSpeaker} disabled={phase !== 'review'} onChange={(event) => setFollowActiveSpeaker(event.target.checked)} />
            Several faces in shot: follow the active speaker
          </label>
          <div data-testid="lipsync-summary" className="space-y-1.5 rounded border border-sf-dark-600 bg-sf-dark-900/50 px-3 py-2.5 leading-relaxed">
            {plan.ok ? <>
              <p>Sends {formatSeconds(plan.segmentSeconds)} of source video (the clip plus transition handles and a short margin) and the matching dialogue.</p>
              <p className="flex gap-1 text-amber-200"><Cloud className="mt-0.5 h-3 w-3 shrink-0" />
                <span>Estimated cost {formatUsd(plan.estimatedUsd)}: sync.so bills about {formatUsd(SYNC_SO_USD_PER_SECOND)} per output second (ComfyUI 0.41.1 price badge), paid in Comfy.org credits.</span></p>
            </> : <p className="text-amber-200">{plan.reason}</p>}
          </div>
          {(status || error) && (
            <p role={error ? 'alert' : 'status'} aria-live="polite" data-testid="lipsync-status"
              className={`rounded border px-3 py-2 leading-relaxed ${error ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-sf-dark-600 text-sf-text-muted'}`}>
              {running && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}{error || status}
            </p>
          )}
        </div>
        <footer className="flex flex-shrink-0 flex-wrap justify-end gap-2 border-t border-sf-dark-700 px-4 py-3">
          <button type="button" onClick={onClose} disabled={running} className="rounded border border-sf-dark-600 px-3 py-1.5 text-xs hover:bg-sf-dark-700 disabled:opacity-40">
            {phase === 'ready' ? 'Keep take only' : phase === 'applied' ? 'Done' : 'Cancel'}
          </button>
          {(phase === 'review' || phase === 'running') && (
            <button type="button" data-testid="lipsync-run" onClick={start} disabled={!livePlan.ok || running}
              className="rounded bg-sf-accent px-3 py-1.5 text-xs font-medium text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
              {running ? 'Lip-syncing…' : `Spend ≈ ${formatUsd(plan.ok ? plan.estimatedUsd : 0)} and lip-sync`}
            </button>
          )}
          {phase === 'ready' && (
            <button type="button" data-testid="lipsync-swap" onClick={swap}
              className="rounded bg-sf-accent px-3 py-1.5 text-xs font-medium text-black hover:brightness-110">Swap into clip</button>
          )}
        </footer>
      </section>
    </div>, document.body,
  )
}
