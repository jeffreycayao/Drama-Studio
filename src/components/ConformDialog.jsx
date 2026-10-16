import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useTimelineStore from '../stores/timelineStore'
import useAssetsStore from '../stores/assetsStore'
import { GENERATE_WORKFLOW_CATALOG } from '../config/generateWorkflowCatalog'
import { planCurrentConform, queueHeroRenders, swapHeroRenders, loadConformWorkflowInfo } from '../services/projectConformer.js'
import { HERO_RESOLUTION_SCALES, DEFAULT_HERO_SETTINGS } from '../utils/projectConform.mjs'
import ModalShell, { buttonClass, primaryButtonClass, fieldClass } from './audio/ModalShell'

const STATUS = {
  'ready-to-render': ['Ready to render', 'text-sf-text-secondary'],
  rendering: ['Rendering…', 'text-sf-accent'],
  'ready-to-swap': ['Hero ready', 'text-sf-success'],
  blocked: ['Needs attention', 'text-sf-warning'],
}
const fmt = range => range ? `${range.start.toFixed(2)}–${range.end.toFixed(2)} s` : 'still'

/** Draft → hero conform. Planning is read-only. Queueing spends GPU time or
 * cloud credits and needs an explicit second confirmation. Swapping is one
 * undo step that keeps every edit point, trim, transition and linked audio. */
export default function ConformDialog({ onClose }) {
  const clips = useTimelineStore(state => state.clips)
  const assets = useAssetsStore(state => state.assets)
  const [heroSettings, setHeroSettings] = useState({ ...DEFAULT_HERO_SETTINGS })
  const [overrides, setOverrides] = useState({})
  const [plan, setPlan] = useState(null)
  const [workflowInfo, setWorkflowInfo] = useState(() => () => null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const serial = useRef(0)
  const workflows = useMemo(() => GENERATE_WORKFLOW_CATALOG
    .filter(item => item.runnable !== false && ['video', 'image'].includes(item.outputType))
    .map(item => ({ id: item.workflowId, label: item.title, outputType: item.outputType, cloud: item.route === 'cloud' })), [])

  const refresh = useCallback(async () => {
    const mine = ++serial.current
    try {
      const next = await planCurrentConform({ heroSettings, workflowOverrides: overrides })
      if (mine === serial.current) { setPlan(next); setConfirming(false) }
    } catch (error) { if (mine === serial.current) setMessage(error.message || 'Could not read the timeline.') }
  }, [heroSettings, overrides])

  useEffect(() => { loadConformWorkflowInfo().then(info => setWorkflowInfo(() => info)).catch(() => {}) }, [])
  // Re-plan when the edit, the bin or the hero settings change; the plan is
  // cheap and must never act on a stale timeline.
  useEffect(() => { refresh() }, [refresh, clips, assets])
  // Pick up hero renders while the dialog stays open.
  useEffect(() => {
    if (!plan?.rendering.length) return undefined
    const timer = setInterval(refresh, 4000)
    return () => clearInterval(timer)
  }, [plan?.rendering.length, refresh])

  const cloudJobs = (plan?.renderable || []).filter(entry => workflowInfo(entry.job.workflowId)?.cloud)

  const queue = async () => {
    if (!plan?.renderable.length || busy) return
    setBusy(true); setMessage('Queueing hero renders in Generate…')
    try {
      const result = await queueHeroRenders(plan.renderable)
      setMessage(`Queued ${result.queuedCount} hero render${result.queuedCount === 1 ? '' : 's'}. They appear in the Generate queue; this list updates when they finish.`)
      setConfirming(false)
      await refresh()
    } catch (error) { setMessage(error.message || 'Could not queue the hero renders.') }
    finally { setBusy(false) }
  }

  const swap = async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await swapHeroRenders({ heroSettings, workflowOverrides: overrides })
      setMessage(result.ok
        ? `Swapped ${result.count} clip${result.count === 1 ? '' : 's'} to hero renders (one Undo step).${result.warnings?.length ? ` ${result.warnings.join(' ')}` : ''}`
        : result.reason)
    } catch (error) { setMessage(error.message || 'Could not swap the hero renders.') }
    finally { setBusy(false) }
  }

  const swapCount = plan?.swappable.reduce((sum, entry) => sum + entry.clips.length, 0) || 0
  return <ModalShell title="Conform drafts to hero renders" titleId="conform-title" testId="conform-dialog" onClose={onClose} wide
    footer={<>
      <button className={`${buttonClass} mr-auto`} onClick={refresh} disabled={busy}>Refresh</button>
      <button className={buttonClass} onClick={onClose}>Close</button>
      <button className={buttonClass} disabled={busy || !plan?.renderable.length} onClick={() => setConfirming(true)}>
        Render {plan?.renderable.length || 0} hero version{plan?.renderable.length === 1 ? '' : 's'}…
      </button>
      <button className={primaryButtonClass} disabled={busy || !swapCount} onClick={swap}>
        Swap {swapCount} clip{swapCount === 1 ? '' : 's'} to hero
      </button>
    </>}>
    <p className="text-xs text-sf-text-muted">Edit with fast draft renders, then re-render them at full quality with the same prompt and seed. Swapping keeps every cut, trim, transition and the audio exactly where they are.</p>
    {plan && <p className="text-xs">{plan.draftClipCount} draft clip{plan.draftClipCount === 1 ? '' : 's'} from {plan.entries.length} render{plan.entries.length === 1 ? '' : 's'} · {plan.heroClipCount} already hero</p>}
    <div className="grid grid-cols-2 gap-4">
      <label className="text-xs space-y-1">Hero workflow
        <select aria-label="Hero workflow" className={fieldClass} value={heroSettings.workflowId || ''}
          onChange={event => setHeroSettings(previous => ({ ...previous, workflowId: event.target.value || null }))}>
          <option value="">Same workflow as each draft</option>
          {workflows.map(item => <option key={item.id} value={item.id}>{item.label}{item.cloud ? ' (cloud, uses credits)' : ''}</option>)}
        </select>
      </label>
      <label className="text-xs space-y-1">Resolution
        <select aria-label="Hero resolution" className={fieldClass} value={heroSettings.resolutionScale}
          onChange={event => setHeroSettings(previous => ({ ...previous, resolutionScale: Number(event.target.value) }))}>
          {HERO_RESOLUTION_SCALES.map(scale => <option key={scale} value={scale}>{scale === 1 ? 'Same as draft' : `${scale}× draft`}</option>)}
        </select>
      </label>
    </div>
    <p className="text-[11px] text-sf-text-muted">For full sampling steps, pick a non-Lightning or custom workflow here. Each hero renders the draft’s full length so the visible range lands on the same moment.</p>
    {!plan && <p className="text-xs text-sf-text-muted">Reading the timeline…</p>}
    {plan && !plan.entries.length && <p className="text-xs text-sf-text-muted">No draft clips. Generated clips count as drafts until they are swapped or marked Hero in the Inspector.</p>}
    {plan?.entries.map(entry => {
      const [label, tone] = STATUS[entry.status] || STATUS.blocked
      return <div key={entry.draftAssetId} className="rounded border border-sf-dark-700 bg-sf-dark-950 p-3 space-y-1 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium truncate">{entry.draftAsset?.name || entry.draftAssetId}</span>
          <span className={`${tone} whitespace-nowrap`}>{label}</span>
        </div>
        <p className="text-[11px] text-sf-text-muted">{entry.clips.length} clip{entry.clips.length === 1 ? '' : 's'} · visible {entry.clips.map(item => fmt(item.visible)).join(', ')}{entry.required ? ` · needs ${fmt(entry.required)} incl. handles` : ''}</p>
        {entry.job && <p className="text-[11px] text-sf-text-muted">{entry.job.workflowLabel} · {entry.job.resolution.width}×{entry.job.resolution.height} · seed {entry.job.seed}{entry.job.durationSeconds ? ` · ${entry.job.durationSeconds} s` : ''}</p>}
        {entry.blockers.map(text => <p key={text} className="text-[11px] text-sf-warning">{text}</p>)}
        {entry.status === 'blocked' && entry.provenance && !entry.provenance.workflowId && <label className="flex items-center gap-2 text-[11px]">Workflow for this draft
          <select aria-label={`Workflow for ${entry.draftAsset?.name || entry.draftAssetId}`} className={`${fieldClass} !w-64`} value={overrides[entry.draftAssetId] || ''}
            onChange={event => setOverrides(previous => ({ ...previous, [entry.draftAssetId]: event.target.value }))}>
            <option value="">Choose…</option>
            {workflows.filter(item => item.outputType === (entry.draftAsset?.type === 'image' ? 'image' : 'video'))
              .map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>}
      </div>
    })}
    {confirming && plan?.renderable.length > 0 && <div role="alertdialog" aria-label="Confirm hero renders" className="rounded border border-sf-accent/50 bg-sf-dark-800 p-3 space-y-2 text-xs">
      <p className="font-medium">Queue {plan.renderable.length} hero render{plan.renderable.length === 1 ? '' : 's'}?</p>
      <p className="text-sf-text-muted">This uses your GPU for a while{cloudJobs.length ? ` and spends cloud credits for ${cloudJobs.length} job${cloudJobs.length === 1 ? '' : 's'}` : ''}. Nothing on the timeline changes until you swap.</p>
      <ul className="list-disc pl-5 text-sf-text-muted">
        {plan.renderable.map(entry => <li key={entry.draftAssetId}>{entry.draftAsset?.name || entry.draftAssetId}: {entry.job.workflowLabel}, {entry.job.resolution.width}×{entry.job.resolution.height}</li>)}
      </ul>
      <div className="flex gap-2">
        <button className={primaryButtonClass} onClick={queue} disabled={busy}>Queue renders</button>
        <button className={buttonClass} onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
      </div>
    </div>}
    <p role="status" className="text-xs text-sf-text-secondary min-h-4">{message}</p>
  </ModalShell>
}

/** Inspector control: render mode for the selected picture clip. */
export function RenderModeInspector({ clip }) {
  const asset = useAssetsStore(state => state.assets.find(item => item.id === clip.assetId))
  const [open, setOpen] = useState(false)
  const generated = Boolean(asset?.settings?.generation || (asset?.isImported && asset?.prompt && Number.isSafeInteger(Number(asset?.settings?.seed))))
  if (!generated && !clip.renderMode) return null
  const mode = clip.renderMode || asset?.settings?.generation?.renderMode || 'draft'
  const setMode = value => useTimelineStore.getState().setClipRenderMode([clip.id], value)
  return <div className="space-y-1" data-testid="render-mode-inspector">
    <label className="text-[9px] text-sf-text-muted block">Render pass</label>
    <div className="flex gap-1">
      {['draft', 'hero'].map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}
        className={`flex-1 rounded px-2 py-1 text-[10px] border ${mode === value ? 'bg-sf-accent text-sf-accent-on border-sf-accent' : 'bg-sf-dark-700 border-sf-dark-600 text-sf-text-secondary hover:bg-sf-dark-600'}`}>
        {value === 'draft' ? 'Draft' : 'Hero'}
      </button>)}
      <button type="button" onClick={() => setOpen(true)} className="rounded px-2 py-1 text-[10px] border border-sf-dark-600 bg-sf-dark-700 text-sf-text-secondary hover:bg-sf-dark-600">Conform…</button>
    </div>
    {open && <ConformDialog onClose={() => setOpen(false)} />}
  </div>
}
