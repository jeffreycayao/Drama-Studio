import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useTimelineStore from '../stores/timelineStore'
import useAssetsStore from '../stores/assetsStore'
import useAudioEqPreview from '../services/audioEqPreview'
import { AUDIO_EQ_MIN_DB, AUDIO_EQ_MAX_DB, normalizeAudioEq } from '../utils/audioEq.mjs'
import { getSingleAudioEnvelopeTarget } from './AudioVolumeEnvelope'

const BANDS = [
  { key: 'bassDb', id: 'bass', label: 'Bass', frequency: '120 Hz' },
  { key: 'midDb', id: 'mid', label: 'Mid', frequency: '1 kHz' },
  { key: 'trebleDb', id: 'treble', label: 'Treble', frequency: '5 kHz' },
]
const RANGE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'])
const textValuesFor = eq => Object.fromEntries(BANDS.map(band => [band.key, String(eq[band.key])]))
const isUndoRedoKey = event => (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(String(event.key).toLowerCase())
const isNumericField = element => element?.tagName === 'INPUT' && element.type === 'number'
const getLockReason = (clip, track) => (
  clip?.locked || clip?.syncLocked || clip?.lockMode === 'sync' || clip?.syncLock?.mode === 'sync'
  || track?.locked || track?.syncLocked || track?.lockMode === 'sync' || track?.syncLock?.mode === 'sync'
) ? 'Unlock this clip and its track to adjust EQ.' : ''

const editContext = clip => {
  const state = useTimelineStore.getState()
  return {
    clip,
    selection: JSON.stringify(state.selectedClipIds),
    timelineSessionId: state.timelineSessionId,
    previewMode: useAssetsStore.getState().previewMode,
  }
}

const contextProblem = context => {
  const state = useTimelineStore.getState()
  if (getSingleAudioEnvelopeTarget(state.clips, state.tracks, state.selectedClipIds) !== context.clip
    || JSON.stringify(state.selectedClipIds) !== context.selection
    || state.timelineSessionId !== context.timelineSessionId
    || useAssetsStore.getState().previewMode !== context.previewMode) {
    return 'The clip or editing context changed. The EQ draft was canceled.'
  }
  return getLockReason(context.clip, state.tracks.find(track => track.id === context.clip.trackId))
}

export default function AudioEqInspector({ clip, track }) {
  const eq = useMemo(() => normalizeAudioEq(clip.audioEq), [clip.audioEq])
  const currentClipRef = useRef(clip)
  currentClipRef.current = clip
  const gestureRef = useRef(null)
  const fieldRef = useRef(null)
  const ignoreLateSliderChangeRef = useRef(false)
  const [draft, setDraft] = useState(null)
  const [gestureActive, setGestureActive] = useState(false)
  const [textValues, setTextValues] = useState(() => textValuesFor(eq))
  const [status, setStatus] = useState('')
  const shownEq = draft || eq
  const reason = getLockReason(clip, track)
  const isFlat = eq.enabled && !eq.lowCut && BANDS.every(band => eq[band.key] === 0)
  const hasWebAudio = typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext)

  const cancelEdit = useCallback(({ message = '', unmounting = false } = {}) => {
    const gesture = gestureRef.current
    gestureRef.current = null
    fieldRef.current = null
    if (gesture) {
      ignoreLateSliderChangeRef.current = true
      useAudioEqPreview.getState().clearPreview(gesture.clip)
      try { gesture.target?.releasePointerCapture?.(gesture.pointerId) } catch (_) { /* Pointer capture may already be released. */ }
    }
    if (!unmounting) {
      setDraft(null)
      setGestureActive(false)
      setTextValues(textValuesFor(normalizeAudioEq(currentClipRef.current.audioEq)))
      setStatus(message)
    }
  }, [])

  const applyEq = useCallback((context, nextEq) => {
    const problem = contextProblem(context)
    if (problem) { setStatus(problem); return false }
    const result = useTimelineStore.getState().updateAudioEq?.(context.clip.id, nextEq, true, context.clip)
    setStatus(result?.ok ? '' : result?.reason || 'The EQ change could not be applied.')
    return result?.ok === true
  }, [])

  const finishGesture = useCallback(() => {
    const gesture = gestureRef.current
    if (!gesture) return
    // Remove the pending gesture before the store update notifies subscribers.
    // Keep audition active until the commit changes clip identity, avoiding an
    // intermediate return to the original EQ between release and commit.
    gestureRef.current = null
    ignoreLateSliderChangeRef.current = true
    const accepted = applyEq(gesture, gesture.eq)
    useAudioEqPreview.getState().clearPreview(gesture.clip)
    try { gesture.target?.releasePointerCapture?.(gesture.pointerId) } catch (_) { /* Capture may already be released. */ }
    setDraft(null)
    setGestureActive(false)
    setTextValues(textValuesFor(accepted ? gesture.eq : normalizeAudioEq(currentClipRef.current.audioEq)))
  }, [applyEq])

  useEffect(() => {
    // Moving from a typed value to a slider may commit that field first. The
    // new gesture already owns the resulting clip, so do not cancel it here.
    if (gestureRef.current?.clip === clip) return
    cancelEdit()
  }, [clip, cancelEdit])

  useEffect(() => {
    const validateDraft = () => {
      const context = gestureRef.current || fieldRef.current
      if (!context) return
      const problem = contextProblem(context)
      if (problem) cancelEdit({ message: problem })
    }
    const unsubscribeTimeline = useTimelineStore.subscribe(validateDraft)
    const unsubscribeAssets = useAssetsStore.subscribe(validateDraft)
    const pointerUp = event => {
      if (gestureRef.current?.kind === 'pointer' && gestureRef.current.pointerId === event.pointerId) finishGesture()
    }
    const pointerCancel = event => {
      if (gestureRef.current?.pointerId === event.pointerId) cancelEdit()
    }
    const blur = () => cancelEdit()
    const visibility = () => { if (document.hidden) cancelEdit() }
    const escape = event => {
      if (event.key !== 'Escape' || (!gestureRef.current && !fieldRef.current)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancelEdit()
      event.target?.blur?.()
    }
    window.addEventListener('pointerup', pointerUp)
    window.addEventListener('pointercancel', pointerCancel)
    window.addEventListener('blur', blur)
    window.addEventListener('keydown', escape, true)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      unsubscribeTimeline()
      unsubscribeAssets()
      window.removeEventListener('pointerup', pointerUp)
      window.removeEventListener('pointercancel', pointerCancel)
      window.removeEventListener('blur', blur)
      window.removeEventListener('keydown', escape, true)
      document.removeEventListener('visibilitychange', visibility)
      cancelEdit({ unmounting: true })
    }
  }, [cancelEdit, finishGesture])

  const startGesture = (key, kind, event) => {
    if (gestureRef.current) return kind === 'keyboard' && gestureRef.current.kind === 'keyboard' && gestureRef.current.key === key
    const context = editContext(clip)
    // Pointerdown precedes native focus/blur. Commit an edited number before
    // starting a different control, rather than silently dropping its text.
    if (fieldRef.current) {
      const pendingField = fieldRef.current
      if (!commitField(pendingField.key)) {
        // Refusing pointerdown keeps focus in the numeric field. Keep its
        // valid editing context so the user can correct the value in place.
        if (!contextProblem(pendingField)) fieldRef.current = pendingField
        return false
      }
      const state = useTimelineStore.getState()
      const nextClip = getSingleAudioEnvelopeTarget(state.clips, state.tracks, state.selectedClipIds)
      if (nextClip?.id !== clip.id) return false
      context.clip = nextClip
    }
    const problem = contextProblem(context)
    if (problem) { setStatus(problem); return false }
    fieldRef.current = null
    ignoreLateSliderChangeRef.current = false
    gestureRef.current = { ...context, key, kind, eq: normalizeAudioEq(context.clip.audioEq), target: event.currentTarget, pointerId: kind === 'pointer' ? event.pointerId : null }
    setGestureActive(true)
    setStatus('')
    if (kind === 'pointer') event.currentTarget.setPointerCapture?.(event.pointerId)
    return true
  }

  const changeSlider = (key, value) => {
    const db = Number(value)
    if (!Number.isFinite(db) || db < AUDIO_EQ_MIN_DB || db > AUDIO_EQ_MAX_DB) return
    const gesture = gestureRef.current
    if (!gesture) {
      if (ignoreLateSliderChangeRef.current) return
      // Accessibility controls can emit a value change without pointer/keys.
      applyEq(editContext(clip), { ...eq, [key]: db })
      return
    }
    const problem = contextProblem(gesture)
    if (problem) { cancelEdit({ message: problem }); return }
    if (gesture.key !== key) return
    gesture.eq = { ...gesture.eq, [key]: db }
    setDraft(gesture.eq)
    setTextValues(textValuesFor(gesture.eq))
    useAudioEqPreview.getState().setPreview(gesture.clip, gesture.eq)
  }

  const commitField = key => {
    const field = fieldRef.current
    fieldRef.current = null
    if (!field || field.key !== key) return false
    if (!field.changed) return true
    const raw = textValues[key]
    const value = raw.trim() === '' ? NaN : Number(raw)
    if (!Number.isFinite(value) || value < AUDIO_EQ_MIN_DB || value > AUDIO_EQ_MAX_DB) {
      setStatus(`Use a level from ${AUDIO_EQ_MIN_DB} to +${AUDIO_EQ_MAX_DB} dB.`)
      return false
    }
    const accepted = applyEq(field, { ...field.eq, [key]: value })
    if (accepted) setTextValues(values => ({ ...values, [key]: String(value) }))
    return accepted
  }

  const commitToggle = patch => {
    cancelEdit()
    applyEq(editContext(clip), { ...eq, ...patch })
  }

  return <section data-testid="audio-eq-inspector" data-audio-eq-editor="true"
    className="space-y-3 border-b border-sf-dark-700 p-3"
    onMouseDown={event => event.stopPropagation()}
    onKeyDown={event => {
      if (isUndoRedoKey(event) && !gestureRef.current && !isNumericField(event.target)) return
      event.stopPropagation()
      if (isUndoRedoKey(event) && gestureRef.current) { event.preventDefault(); cancelEdit() }
      if (event.key === 'Escape') { event.preventDefault(); cancelEdit(); event.target?.blur?.() }
    }}
    onKeyUp={event => event.stopPropagation()}
  >
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-[10px] uppercase tracking-wider text-sf-text-muted">Equalizer</h4>
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-sf-text-secondary">
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" data-testid="audio-eq-bypass" checked={!shownEq.enabled} disabled={Boolean(reason) || gestureActive}
            onChange={event => commitToggle({ enabled: !event.target.checked })} className="accent-sf-accent" />
          Bypass
        </label>
        <button type="button" data-testid="audio-eq-reset" disabled={Boolean(reason) || gestureActive || isFlat}
          onClick={() => commitToggle(normalizeAudioEq(null))}
          className="hover:text-sf-text-primary disabled:opacity-40">Reset</button>
      </div>
    </div>

    <div className="space-y-3">
      {BANDS.map(band => <div key={band.key} className="space-y-1.5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <label htmlFor={`audio-eq-${clip.id}-${band.id}`} className="min-w-0 text-[11px] text-sf-text-secondary">
            {band.label} <span className="ml-1 text-[10px] text-sf-text-muted">{band.frequency}</span>
          </label>
          <div className="flex shrink-0 items-center gap-1">
            <input type="number" data-testid={`audio-eq-${band.id}-input`} aria-label={`${band.label} EQ level in dB`}
              min={AUDIO_EQ_MIN_DB} max={AUDIO_EQ_MAX_DB} step="0.1" value={textValues[band.key]}
              disabled={Boolean(reason) || gestureActive}
              onFocus={() => {
                fieldRef.current = { ...editContext(clip), key: band.key, eq, initialValue: textValues[band.key], changed: false }
                setStatus('')
              }}
              onChange={event => {
                if (fieldRef.current?.key === band.key) fieldRef.current.changed = event.target.value !== fieldRef.current.initialValue
                setTextValues(values => ({ ...values, [band.key]: event.target.value }))
              }}
              onBlur={() => commitField(band.key)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }}
              className="w-[4.5rem] rounded border border-sf-dark-600 bg-sf-dark-700 px-1.5 py-1 text-right text-xs text-sf-text-primary focus:border-sf-accent focus:outline-none" />
            <span className="text-[10px] text-sf-text-muted">dB</span>
          </div>
        </div>
        <input id={`audio-eq-${clip.id}-${band.id}`} type="range" data-testid={`audio-eq-${band.id}-slider`} aria-label={`${band.label} EQ`}
          min={AUDIO_EQ_MIN_DB} max={AUDIO_EQ_MAX_DB} step="0.1" value={shownEq[band.key]} disabled={Boolean(reason)}
          onFocus={() => {
            // A fresh focus is a new interaction, including assistive input
            // with no pointer/key events. Cancellation itself never refocuses.
            if (!gestureRef.current) ignoreLateSliderChangeRef.current = false
          }}
          onPointerDown={event => {
            event.stopPropagation()
            if (event.button !== 0 || !startGesture(band.key, 'pointer', event)) event.preventDefault()
          }}
          onChange={event => changeSlider(band.key, event.target.value)}
          onLostPointerCapture={() => { if (gestureRef.current?.kind === 'pointer') cancelEdit() }}
          onBlur={() => { if (gestureRef.current?.key === band.key) cancelEdit() }}
          onKeyDown={event => {
            if (RANGE_KEYS.has(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
              if (!startGesture(band.key, 'keyboard', event)) event.preventDefault()
            }
          }}
          onKeyUp={event => { if (RANGE_KEYS.has(event.key) && gestureRef.current?.kind === 'keyboard') finishGesture() }}
          className="block h-1 w-full cursor-pointer appearance-none rounded-lg bg-sf-dark-600 accent-sf-accent disabled:cursor-not-allowed disabled:opacity-40" />
      </div>)}
    </div>
    <div className="flex justify-between text-[9px] text-sf-text-muted" aria-hidden="true"><span>−12 dB</span><span>0 dB</span><span>+12 dB</span></div>
    <label className="inline-flex max-w-full cursor-pointer items-center gap-2 text-[11px] text-sf-text-secondary">
      <input type="checkbox" data-testid="audio-eq-low-cut" checked={shownEq.lowCut} disabled={Boolean(reason) || gestureActive}
        onChange={event => commitToggle({ lowCut: event.target.checked })} className="shrink-0 accent-sf-accent" />
      Reduce rumble <span className="text-[10px] text-sf-text-muted">80 Hz</span>
    </label>
    <p className="text-[10px] leading-relaxed text-sf-text-muted">Boosts can clip; use Clip Gain to leave headroom.</p>
    {!hasWebAudio && <p className="text-[10px] leading-relaxed text-sf-text-muted">Live EQ audition requires Web Audio in this environment. Saved EQ still applies to export.</p>}
    <p data-testid="audio-eq-status" role="status" aria-live="polite" className={`break-words text-[10px] leading-relaxed ${reason || status ? 'text-sf-error' : 'text-sf-text-muted'}`}>
      {reason || status || (!shownEq.enabled ? 'EQ bypassed. Settings are retained.' : draft && hasWebAudio ? 'Auditioning EQ. Release to save; Escape cancels.' : '')}
    </p>
  </section>
}
