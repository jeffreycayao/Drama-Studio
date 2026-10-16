import { useEffect, useRef, useState } from 'react'
import useTimelineStore from '../stores/timelineStore'
import useAssetsStore from '../stores/assetsStore'
import useProjectStore from '../stores/projectStore'
import { useAudioDuckingPreview } from '../services/audioDuckingPreview'
import { analyzeAutoDucking, toAutoDuckingUpdates } from '../services/audioMastering.js'
import {
  DEFAULT_AUTO_DUCKING_SETTINGS, AUTO_DUCKING_LIMITS, MIX_ROLES, MIX_ROLE_LABELS, getTrackMixRole, planRemoveAutoDucking,
  getAutoDuckingInputSignature,
} from '../utils/audioMastering.mjs'
import ModalShell, { buttonClass, primaryButtonClass, fieldClass } from './audio/ModalShell'
import { useI18n } from '../i18n/I18nContext'
import Hint from './ui/Hint'

const SLIDERS = [
  ['reductionDb', 'Reduction', 'dB', 1],
  ['attackMs', 'Attack', 'ms', 5],
  ['holdMs', 'Hold', 'ms', 50],
  ['releaseMs', 'Release', 'ms', 10],
  ['thresholdDb', 'Speech threshold', 'dBFS', 1],
]

/** Auto-ducking for every BGM clip under every Dialogue track. Analysis is
 * read-only; Apply is one undo step; previews use the transient audition
 * override, never project data. */
export default function AutoDuckingDialog({ onClose }) {
  const { t } = useI18n()
  const tracks = useTimelineStore(state => state.tracks)
  const clips = useTimelineStore(state => state.clips)
  const [settings, setSettings] = useState({ ...DEFAULT_AUTO_DUCKING_SETTINGS })
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [message, setMessage] = useState('')
  const [listening, setListening] = useState(null)
  const run = useRef({ controller: null, serial: 0 }), owner = useRef(null), mounted = useRef(true)
  const audioTracks = tracks.filter(track => track.type === 'audio')
  const removable = clips.filter(clip => clip.autoDucking && getTrackMixRole(tracks.find(track => track.id === clip.trackId)) === 'bgm')

  const stopListening = (update = true) => {
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
  const invalidate = () => { cancelAnalysis(); stopListening(); setBusy(false); setResult(null) }

  useEffect(() => {
    mounted.current = true
    const timeline = useTimelineStore.getState()
    if (timeline.isPlaying) timeline.togglePlay()
    useAssetsStore.getState().setPreviewMode('timeline')
    const hide = () => { if (document.hidden) stopListening() }
    const blur = () => stopListening()
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('blur', blur)
    return () => {
      mounted.current = false
      cancelAnalysis(); stopListening(false)
      document.removeEventListener('visibilitychange', hide)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // Any change to what the detector read (music OR dialogue clips, track
  // levels, mute/solo, roles) makes the proposal stale; drop it so the user
  // re-analyzes instead of ducking lines at their old positions.
  useEffect(() => {
    if (!result) return
    if (result.signature !== getAutoDuckingInputSignature({ clips, tracks })) {
      stopListening(); setResult(null); setMessage('The timeline changed. Analyze again.')
    }
  }, [clips, tracks])

  const setRole = (trackId, role) => {
    invalidate()
    const outcome = useTimelineStore.getState().setTrackMixRole(trackId, role || null)
    setMessage(outcome.ok ? '' : outcome.reason)
  }
  const change = (key, value) => { invalidate(); setMessage(''); setSettings(previous => ({ ...previous, [key]: key === 'detector' ? value : Number(value) })) }

  const analyze = async () => {
    if (busy) return
    invalidate(); setBusy(true); setMessage('Reading dialogue levels…')
    const serial = run.current.serial, controller = new AbortController()
    run.current.controller = controller
    const alive = () => mounted.current && serial === run.current.serial
    const analyzedState = useTimelineStore.getState()
    const signature = getAutoDuckingInputSignature(analyzedState)
    try {
      const analysis = await analyzeAutoDucking({ state: analyzedState, assets: useAssetsStore.getState().assets,
        projectHandle: useProjectStore.getState().currentProjectHandle, settings, signal: controller.signal,
        isCurrent: alive, onProgress: text => { if (alive()) setMessage(text) } })
      if (!alive()) return
      if (signature !== getAutoDuckingInputSignature(useTimelineStore.getState())) {
        setMessage('The timeline changed while analyzing. Analyze again.')
        return
      }
      setResult({ ...analysis, signature })
      const fallback = analysis.detector !== settings.detector ? ' RMS was unavailable for a browser-only source; peak levels were used.' : ''
      setMessage(analysis.proposals.length
        ? `${analysis.proposals.length} music clip${analysis.proposals.length === 1 ? '' : 's'} ready. Listen, then apply.${fallback}`
        : `Nothing to duck.${fallback}`)
    } catch (error) { if (alive()) setMessage(error.message || 'Could not analyze the dialogue.') }
    finally { if (alive()) setBusy(false) }
  }

  const listen = (proposal, mode) => {
    stopListening()
    const token = useTimelineStore.getState().startPlayAround(proposal.clip.startTime + proposal.clip.duration / 2, proposal.clip)
    if (!token) { setMessage('Could not start the preview. Check the timeline and try again.'); return }
    owner.current = token
    if (mode === 'ducked') useAudioDuckingPreview.getState().setPreview(proposal.clip, proposal.envelope, token)
    setListening(`${proposal.clip.id}:${mode}`)
  }

  const apply = () => {
    if (!result?.proposals.length) return
    stopListening()
    const outcome = useTimelineStore.getState().applyAutoDucking({ updates: toAutoDuckingUpdates(result.proposals) })
    if (outcome.ok) onClose()
    else setMessage(outcome.reason || 'Auto-ducking could not be applied.')
  }

  const removeAll = () => {
    invalidate()
    const updates = [], refused = []
    for (const clip of removable) {
      const plan = planRemoveAutoDucking(clip)
      if (plan.ok) updates.push({ clipId: clip.id, expectedClip: clip, envelope: plan.envelope, autoDucking: null })
      else refused.push(clip.name || clip.id)
    }
    if (!updates.length) { setMessage(refused.length ? `Edited after ducking, not removed: ${refused.join(', ')}.` : 'Nothing to remove.'); return }
    const outcome = useTimelineStore.getState().applyAutoDucking({ updates })
    setMessage(outcome.ok
      ? `Removed auto-ducking from ${outcome.count} clip${outcome.count === 1 ? '' : 's'}.${refused.length ? ` Edited after ducking, kept: ${refused.join(', ')}.` : ''}`
      : outcome.reason)
  }

  return <ModalShell title="Auto-duck music under dialogue" titleId="auto-ducking-title" testId="auto-ducking-dialog" onClose={onClose} wide
    footer={<>
      {removable.length > 0 && <button className={`${buttonClass} mr-auto`} onClick={removeAll} disabled={busy}>Remove auto-ducking</button>}
      <button className={buttonClass} onClick={onClose}>Close</button>
      <button className={primaryButtonClass} disabled={!result?.proposals.length || busy} onClick={apply}>
        Apply to {result?.proposals.length || 0} music clip{result?.proposals.length === 1 ? '' : 's'}
      </button>
    </>}>
    <p className="text-xs text-sf-text-muted">Mark which tracks carry dialogue and music. Drama Studio reads the dialogue levels locally and writes editable volume points on every music clip. Export uses the same curve.</p>
    <fieldset className="space-y-2">
      <legend className="text-[10px] uppercase tracking-wider text-sf-text-muted">Track roles</legend>
      {!audioTracks.length && <p className="text-xs text-sf-text-muted">Add an audio track first.</p>}
      {audioTracks.map(track => <label key={track.id} className="flex items-center justify-between gap-3 text-xs">
        <span className="truncate">{track.name || track.id}</span>
        <select aria-label={`Mix role for ${track.name || track.id}`} value={getTrackMixRole(track) || ''} disabled={busy}
          onChange={event => setRole(track.id, event.target.value)} className={`${fieldClass} !w-44`}>
          <option value="">No role</option>
          {MIX_ROLES.map(role => <option key={role} value={role}>{MIX_ROLE_LABELS[role]}</option>)}
        </select>
      </label>)}
    </fieldset>
    <div className="grid grid-cols-2 gap-x-6 gap-y-3">
      {SLIDERS.map(([key, label, unit, step]) => <label key={key} className="text-xs space-y-1">
        <span>{label} · {key === 'reductionDb' ? `-${settings[key]}` : settings[key]} {unit}</span>
        <input aria-label={label} type="range" min={AUTO_DUCKING_LIMITS[key][0]} max={key === 'thresholdDb' ? -20 : AUTO_DUCKING_LIMITS[key][1]}
          step={step} value={settings[key]} disabled={busy} onChange={event => change(key, event.target.value)} className="block w-full accent-sf-accent" />
        <Hint>{t('hints.audio.ducking.' + key)}</Hint>
      </label>)}
      <label className="text-xs space-y-1">Detector
        <select aria-label="Detector" value={settings.detector} disabled={busy} onChange={event => change('detector', event.target.value)} className={fieldClass}>
          <option value="rms">RMS (follows speech energy)</option>
          <option value="peak">Peak (fast, triggers on clicks)</option>
        </select>
        <Hint>{t('hints.audio.ducking.detector')}</Hint>
      </label>
    </div>
    <div className="flex gap-2">
      <button className={buttonClass} onClick={analyze} disabled={busy}>{busy ? 'Analyzing…' : result ? 'Analyze again' : 'Analyze dialogue'}</button>
      {busy && <button className={buttonClass} onClick={() => { cancelAnalysis(); setBusy(false); setMessage('Canceled.') }}>Cancel</button>}
    </div>
    {result?.proposals.map(proposal => <div key={proposal.clip.id} className="rounded border border-sf-dark-700 bg-sf-dark-950 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium truncate">{proposal.clip.name || proposal.clip.id} <span className="text-sf-text-muted">· {proposal.trackName}</span></span>
        <span className="text-sf-text-muted whitespace-nowrap">{proposal.dipCount} dips · {proposal.pointCount} points</span>
      </div>
      {proposal.replacesPrevious && <p className="text-[11px] text-sf-text-muted">Replaces the previous auto-ducking pass.</p>}
      {proposal.editedSinceDucking && <p className="text-[11px] text-sf-warning">Volume points were edited after the last pass; ducking is added on top of your edits.</p>}
      {proposal.mergedForLimit > 0 && <p className="text-[11px] text-sf-warning">{proposal.mergedForLimit} short gaps were bridged to stay within 128 editable points.</p>}
      <div className="flex gap-2">
        <button className={buttonClass} aria-pressed={listening === `${proposal.clip.id}:original`} onClick={() => listen(proposal, 'original')}>Listen original</button>
        <button className={buttonClass} aria-pressed={listening === `${proposal.clip.id}:ducked`} onClick={() => listen(proposal, 'ducked')}>Listen ducked</button>
        {listening?.startsWith(`${proposal.clip.id}:`) && <button className={buttonClass} onClick={() => stopListening()}>Stop</button>}
      </div>
    </div>)}
    {result?.skipped.length > 0 && <div className="text-[11px] text-sf-text-muted space-y-1">
      {result.skipped.map(item => <p key={item.clipId}>Skipped “{item.name}”: {item.reason}</p>)}
    </div>}
    <p className="text-[11px] text-sf-text-muted">Level-based detection, not speech recognition: keep dialogue on its own tracks. EQ and inserts are not analyzed.</p>
    <p role="status" className="text-xs text-sf-text-secondary min-h-4">{message}</p>
  </ModalShell>
}
