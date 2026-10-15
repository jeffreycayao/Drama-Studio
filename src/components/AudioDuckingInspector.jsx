import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import useTimelineStore from '../stores/timelineStore'
import useAssetsStore from '../stores/assetsStore'
import useProjectStore from '../stores/projectStore'
import { useAudioDuckingPreview } from '../services/audioDuckingPreview'
import { analyzeAudioDucking } from '../services/audioDucking.mjs'
import { DEFAULT_DUCKING_SETTINGS, DUCKING_MAX_DURATION } from '../utils/audioDucking.mjs'
import { getCompoundRenderState } from '../utils/compoundPlayback.mjs'
import { getAudioVolumeEnvelopeDb } from '../utils/audioVolumeEnvelope.mjs'

const capture = () => {
  const s = useTimelineStore.getState(), a = useAssetsStore.getState(), p = useProjectStore.getState()
  return { clips: s.clips, tracks: s.tracks, transitions: s.transitions, selected: JSON.stringify(s.selectedClipIds),
    session: s.timelineSessionId, fps: s.timelineFps, compound: s.compoundEditContext, history: s.historyIndex,
    assets: a.assets, previewMode: a.previewMode, projectHandle: p.currentProjectHandle, timelineId: p.currentTimelineId }
}
const current = context => { const now = capture(); return Object.keys(context).every(key => context[key] === now[key]) }
const buttonClass = 'rounded border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-xs disabled:opacity-40 hover:bg-sf-dark-700'

function EnvelopePreview({ clip, result }) {
  const curves = useMemo(() => {
    const path = source => Array.from({ length: 241 }, (_, i) => {
      const db = getAudioVolumeEnvelopeDb(source, clip.duration * i / 240)
      return `${i ? 'L' : 'M'}${i * 2},${12 + (12 - db) / 72 * 96}`
    }).join(' ')
    return { before: path(clip), after: path({ ...clip, volumeEnvelope: result.envelope }) }
  }, [clip, result])
  return <div className="rounded border border-sf-dark-600 bg-sf-dark-950 p-3">
    <svg viewBox="0 0 480 120" role="img" aria-label="Proposed volume curve across the music clip" className="w-full h-32">
      {result.activity.map((item, index) => <rect key={index} x={Math.max(0, item.start) / clip.duration * 480} y="0"
        width={Math.max(0, Math.min(clip.duration, item.end) - Math.max(0, item.start)) / clip.duration * 480} height="120" fill="currentColor" opacity="0.07" />)}
      <path d={curves.before} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 3" />
      <path d={curves.after} fill="none" stroke="#38bdf8" strokeWidth="2.5" />
    </svg>
    <p className="text-xs text-sf-text-muted">Dashed: existing volume · Blue: proposed volume · Shading: detected dialogue</p>
  </div>
}

export function AudioDuckingDialog({ clip, onClose }) {
  const [context] = useState(capture)
  const tracks = useMemo(() => getCompoundRenderState(useTimelineStore.getState()).tracks
    .filter(track => track.type === 'audio' && track.id !== clip.trackId), [])
  const [dialogueTrackId, setDialogueTrackId] = useState(tracks[0]?.id || '')
  const [settings, setSettings] = useState({ ...DEFAULT_DUCKING_SETTINGS })
  const [busy, setBusy] = useState(false), [invalid, setInvalid] = useState(false)
  const [result, setResult] = useState(null), [message, setMessage] = useState('')
  const [listening, setListening] = useState(null)
  const run = useRef({ controller: null, serial: 0 }), owner = useRef(null), mounted = useRef(true)
  const dialog = useRef(null), closeRef = useRef(onClose)
  closeRef.current = onClose
  const stop = (update = true) => {
    const token = owner.current
    owner.current = null
    if (token) {
      useAudioDuckingPreview.getState().clearPreview(token)
      const store = useTimelineStore.getState()
      if (!store.finishPlayAround(token)) store.cancelPlayAround(token)
    }
    if (update && mounted.current) setListening(null)
  }
  const cancelAnalysis = () => { run.current.serial++; run.current.controller?.abort(); run.current.controller = null }
  useEffect(() => {
    mounted.current = true
    const previousFocus = document.activeElement
    dialog.current?.querySelector('select,button')?.focus()
    const validate = () => {
      if (!current(context)) {
        cancelAnalysis(); stop(); setBusy(false); setInvalid(true)
        setMessage('The clip, selection or editing context changed. Close this dialog and open Music ducking again.')
      } else if (owner.current && useTimelineStore.getState().playAround?.token !== owner.current) stop()
    }
    const unsubscribers = [useTimelineStore, useAssetsStore, useProjectStore].map(store => store.subscribe(validate))
    const key = event => {
      if (event.isComposing || event.keyCode === 229) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const items = [...dialog.current.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled),[tabindex="0"]')]
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
    }
    const hide = () => { if (document.hidden) stop() }
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', stopOnBlur)
    function stopOnBlur() { stop() }
    document.addEventListener('visibilitychange', hide)
    return () => {
      mounted.current = false; unsubscribers.forEach(unsubscribe => unsubscribe())
      cancelAnalysis(); stop(false)
      window.removeEventListener('keydown', key, true); window.removeEventListener('blur', stopOnBlur)
      document.removeEventListener('visibilitychange', hide)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])
  const change = (key, value) => {
    cancelAnalysis(); stop(); setBusy(false); setResult(null); setMessage('')
    if (key === 'track') setDialogueTrackId(value)
    else setSettings(previous => ({ ...previous, [key]: Number(value) }))
  }
  const analyze = async () => {
    if (!current(context) || busy) return
    stop(); cancelAnalysis(); setResult(null); setBusy(true); setMessage('Reading local dialogue audio…')
    const serial = run.current.serial, controller = new AbortController()
    run.current.controller = controller
    const alive = () => mounted.current && serial === run.current.serial && current(context)
    try {
      const proposed = await analyzeAudioDucking({ state: useTimelineStore.getState(), assets: context.assets,
        projectHandle: context.projectHandle, musicId: clip.id, dialogueTrackId, settings, signal: controller.signal,
        isCurrent: alive, onProgress: text => { if (alive()) setMessage(text) } })
      if (alive()) { setResult(proposed); setMessage(`${proposed.dipCount} ducking regions · ${proposed.pointCount} editable volume points. Listen before applying.`) }
    } catch (error) { if (alive()) setMessage(error.message || 'Could not analyze the dialogue.') }
    finally { if (alive()) setBusy(false) }
  }
  const listen = mode => {
    stop()
    if (!result || !current(context)) return
    const token = useTimelineStore.getState().startPlayAround(clip.startTime + clip.duration / 2, clip)
    if (!token) { setMessage('Could not start the preview. Close this dialog and check the timeline.'); return }
    owner.current = token
    if (mode === 'ducked') useAudioDuckingPreview.getState().setPreview(clip, result.envelope, token)
    setListening(mode)
  }
  const apply = () => {
    if (!result || !current(context)) return
    stop()
    // Close subscriptions before the authored update invalidates this draft.
    const updated = useTimelineStore.getState().updateAudioVolumeEnvelope(clip.id, result.envelope, true, clip)
    if (updated.ok) onClose()
    else setMessage(updated.reason || 'The volume points could not be applied.')
  }
  return createPortal(<div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/70 p-5"
    onMouseDown={event => event.stopPropagation()}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="audio-ducking-title" data-testid="audio-ducking-dialog"
      className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl border border-sf-dark-600 bg-sf-dark-900 p-5 text-sf-text-primary shadow-2xl space-y-4"
      onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
      <h2 id="audio-ducking-title" className="text-base font-semibold">Music ducking</h2>
      <p className="text-xs text-sf-text-muted">Lower “{clip.name || 'Music'}” while another track is speaking. Preview first, then apply volume points you can edit or Undo.</p>
      <label className="block space-y-1 text-xs">Dialogue track
        <select aria-label="Dialogue track" value={dialogueTrackId} disabled={invalid || busy}
          onChange={event => change('track', event.target.value)} className="block w-full rounded bg-sf-dark-800 border border-sf-dark-600 p-2">
          {!tracks.length && <option value="">No other audio tracks</option>}
          {tracks.map(track => <option key={track.id} value={track.id}>{track.name || track.id}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-4">
        <label className="text-xs space-y-2">Reduction · {settings.reductionDb} dB
          <input aria-label="Ducking reduction" type="range" min="3" max="24" step="1" value={settings.reductionDb}
            disabled={invalid || busy} onChange={event => change('reductionDb', event.target.value)} className="block w-full accent-sf-accent" /></label>
        <label className="text-xs space-y-2">Fade · {settings.fadeSeconds.toFixed(2)} s
          <input aria-label="Ducking fade" type="range" min="0.05" max="1.5" step="0.05" value={settings.fadeSeconds}
            disabled={invalid || busy} onChange={event => change('fadeSeconds', event.target.value)} className="block w-full accent-sf-accent" /></label>
      </div>
      <label className="flex items-center justify-between gap-3 text-xs">Detection sensitivity
        <select aria-label="Ducking sensitivity" value={settings.thresholdDb} disabled={invalid || busy}
          onChange={event => change('thresholdDb', event.target.value)} className="rounded bg-sf-dark-800 border border-sf-dark-600 p-2">
          <option value="-45">More sensitive</option><option value="-35">Balanced</option><option value="-25">Less sensitive</option>
        </select></label>
      <p className="text-xs text-sf-text-muted">Local audio-level detection, not speech recognition. Use an isolated dialogue track; noise or music can trigger ducking. Detection includes clip volume and fades, but not EQ or audio inserts.</p>
      <button className={buttonClass} onClick={analyze} disabled={invalid || busy || !dialogueTrackId}>{busy ? 'Analyzing…' : result ? 'Analyze again' : 'Analyze dialogue'}</button>
      {busy && <button className={`${buttonClass} ml-2`} onClick={() => { cancelAnalysis(); setBusy(false); setMessage('Canceled. Any audio read already in progress will finish in the background.') }}>Cancel analysis</button>}
      {result && !invalid && <>
        <EnvelopePreview clip={clip} result={result} />
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} aria-pressed={listening === 'original'} onClick={() => listen('original')}>Listen original</button>
          <button className={buttonClass} aria-pressed={listening === 'ducked'} onClick={() => listen('ducked')}>Listen ducked</button>
          <button className={buttonClass} disabled={!listening} onClick={() => stop()}>Stop preview</button>
        </div>
        <p className="text-xs text-sf-text-muted">Plays this music clip’s timeline range with the rest of your mix. Adds to existing volume automation; Undo before redoing the same ducking pass.</p>
      </>}
      <p role="status" className="text-xs text-sf-text-secondary min-h-4">{message}</p>
      <div className="flex justify-end gap-2 border-t border-sf-dark-700 pt-4">
        <button className={buttonClass} onClick={onClose}>Cancel</button>
        <button className={`${buttonClass} !bg-sf-accent text-white`} disabled={!result || invalid || busy} onClick={apply}>Apply volume points</button>
      </div>
    </div>
  </div>, document.body)
}

export default function AudioDuckingInspector({ clip, track }) {
  const [open, setOpen] = useState(false)
  const locked = [clip, track].some(item => item?.locked || item?.syncLocked || item?.lockMode === 'sync' || item?.syncLock?.mode === 'sync')
  return <section className="p-3 space-y-2 border-b border-sf-dark-700" data-testid="audio-ducking-inspector">
    <h4 className="text-[10px] text-sf-text-muted uppercase tracking-wider">Music ducking</h4>
    <button className={`${buttonClass} w-full`} disabled={locked || clip.duration > DUCKING_MAX_DURATION}
      title={locked ? 'Unlock the clip and its audio track first.' : clip.duration > DUCKING_MAX_DURATION ? 'Choose a music clip up to 10 minutes long.' : undefined} onClick={() => {
      const timeline = useTimelineStore.getState()
      if (timeline.isPlaying) timeline.togglePlay()
      useAssetsStore.getState().setPreviewMode('timeline')
      setOpen(true)
    }}>Duck under dialogue…</button>
    <p className="text-[10px] text-sf-text-muted">Select your music clip. Preview automatic dips before applying.</p>
    {open && <AudioDuckingDialog clip={clip} onClose={() => setOpen(false)} />}
  </section>
}
