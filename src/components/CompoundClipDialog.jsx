import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { Layers, X } from 'lucide-react'
import useTimelineStore from '../stores/timelineStore'
import useAssetsStore from '../stores/assetsStore'
import { trapDialogFocus } from '../utils/dialogFocus.mjs'

const SNAPSHOT_KEYS = ['clips', 'tracks', 'transitions', 'markers', 'timelineFps', 'timelineSessionId',
  'history', 'historyIndex', 'compoundEditContext', 'duration', 'isPlaying']
const UNCOMPOUND_SNAPSHOT_KEYS = [...SNAPSHOT_KEYS, 'selectedClipIds']
const sameSelection = (current, captured) => current.length === captured.length && current.every(id => captured.includes(id))
const seconds = value => `${Number((Number(value) || 0).toFixed(3))} s`
const locked = value => value?.locked || value?.syncLocked || value?.lockMode === 'sync' || value?.syncLock?.mode === 'sync'

export function captureCompoundClipSession(state, dimensions, returnFocus) {
  if (state.compoundEditContext || !state.selectedClipIds.length
    || state.clips.some(clip => state.selectedClipIds.includes(clip.id) && clip.type === 'compound')) return null
  return {
    clipIds: [...state.selectedClipIds],
    width: dimensions?.width || 1920,
    height: dimensions?.height || 1080,
    snapshot: Object.fromEntries(SNAPSHOT_KEYS.map(key => [key, state[key]])),
    returnFocus,
  }
}

export function captureUncompoundSession(state, clipId, returnFocus, returnFocusFallback = null) {
  if (state.compoundEditContext || state.selectedClipIds.length !== 1 || state.selectedClipIds[0] !== clipId) return null
  const clip = state.clips.find(candidate => candidate.id === clipId && candidate.type === 'compound')
  if (!clip) return null
  return { clipId, clip, snapshot: Object.fromEntries(UNCOMPOUND_SNAPSHOT_KEYS.map(key => [key, state[key]])), returnFocus, returnFocusFallback }
}

function useCompoundDialogFocus(session, onClose, dialogRef, initialFocusRef, selectInitial = false) {
  useLayoutEffect(() => {
    const returnFocus = session.returnFocus || document.activeElement
    const focusFirst = () => (initialFocusRef.current || dialogRef.current)?.focus()
    const keyDown = event => {
      event.stopImmediatePropagation()
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      else trapDialogFocus(event, dialogRef.current)
    }
    const keyUp = event => event.stopImmediatePropagation()
    const focusIn = event => { if (!dialogRef.current?.contains(event.target)) focusFirst() }
    window.addEventListener('keydown', keyDown, true)
    window.addEventListener('keyup', keyUp, true)
    document.addEventListener('focusin', focusIn, true)
    focusFirst()
    if (selectInitial) initialFocusRef.current?.select()
    return () => {
      window.removeEventListener('keydown', keyDown, true)
      window.removeEventListener('keyup', keyUp, true)
      document.removeEventListener('focusin', focusIn, true)
      // Applying Uncompound removes the Inspector that opened this dialog.
      // Wait until React finishes detaching it before choosing a fallback.
      queueMicrotask(() => {
        const target = returnFocus?.isConnected ? returnFocus : session.returnFocusFallback
        if (target?.isConnected) target.focus({ preventScroll: true })
      })
    }
  }, [session, onClose, dialogRef, initialFocusRef, selectInitial])
}

// Shared by Timeline and Inspector. Navigation is not a document edit, and a
// source audition must not keep playing over the newly opened child timeline.
export function navigateCompoundContents(clip = null) {
  const state = useTimelineStore.getState()
  state.shuttlePause?.()
  const source = useAssetsStore.getState()
  source.videoRef?.pause?.()
  source.setIsPlaying?.(false)
  source.setPreviewMode?.('timeline')
  const latest = useTimelineStore.getState()
  const result = (clip ? latest.openCompound?.(clip.id, clip) : latest.closeCompound?.())
    || { ok: false, reason: 'Compound navigation is unavailable. Try again.' }
  if (result.ok) {
    const sessionId = useTimelineStore.getState().timelineSessionId
    void Promise.all([import('../services/opticalFlowCache'), import('../stores/projectStore')]).then(([cache, project]) => {
      if (useTimelineStore.getState().timelineSessionId !== sessionId) return
      return cache.hydrateOpticalFlowCaches(project.default.getState().currentProjectHandle)
    }).catch(error => console.warn('[CompoundClip] Optical Flow cache hydration failed:', error))
  }
  return result
}

export function CompoundClipInspector({ clip, track }) {
  const [name, setName] = useState(clip.name || 'Compound Clip')
  const [error, setError] = useState('')
  const [uncompoundSession, setUncompoundSession] = useState(null)
  const closeUncompound = useCallback(() => setUncompoundSession(null), [])
  const editRef = useRef(null)
  const nameRef = useRef(null)
  const disabled = locked(clip) || locked(track)
  useEffect(() => {
    editRef.current = null
    setName(clip.name || 'Compound Clip')
    setError('')
  }, [clip])
  useEffect(() => {
    const cancel = () => {
      editRef.current = null
      setName(clip.name || 'Compound Clip')
    }
    window.addEventListener('blur', cancel)
    return () => window.removeEventListener('blur', cancel)
  }, [clip])
  const commitName = () => {
    const edit = editRef.current
    if (!edit?.changed) return true
    const result = useTimelineStore.getState().renameCompound?.(clip.id, name, edit.clip)
    if (!result?.ok) {
      setError(result?.reason || 'The compound could not be renamed. Nothing was changed.')
      return false
    }
    editRef.current = null
    setError('')
    return true
  }
  return <div data-testid="compound-inspector" className="space-y-3 p-3 text-xs text-sf-text-primary"
    onKeyDown={event => {
      if (event.target?.tagName === 'INPUT' || !((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase()))) event.stopPropagation()
    }}>
    <div className="flex items-center gap-2 font-medium"><Layers className="h-4 w-4 text-violet-300" />Compound Clip</div>
    <label className="block text-sf-text-muted">Name
      <input ref={nameRef} data-testid="compound-name" value={name} disabled={disabled} maxLength={160}
        onFocus={() => { editRef.current = { clip, changed: false } }}
        onChange={event => { if (!editRef.current) editRef.current = { clip, changed: false }; editRef.current.changed = true; setName(event.target.value); setError('') }}
        onBlur={commitName}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); if (commitName()) event.currentTarget.blur() }
          if (event.key === 'Escape') { event.preventDefault(); editRef.current = null; setName(clip.name || 'Compound Clip'); setError(''); event.currentTarget.blur() }
        }}
        className="mt-1 w-full min-w-0 rounded border border-sf-dark-600 bg-sf-dark-800 px-2 py-1.5 text-sf-text-primary disabled:opacity-50" />
    </label>
    <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-sf-text-muted">
      <dt>Timeline start</dt><dd className="text-right text-sf-text-primary">{seconds(clip.startTime)}</dd>
      <dt>Visible duration</dt><dd className="text-right text-sf-text-primary">{seconds(clip.duration)}</dd>
      <dt>Original clips</dt><dd className="text-right text-sf-text-primary">{clip.compound?.document?.clips?.length || 0}</dd>
    </dl>
    <button type="button" data-testid="compound-inspector-open" disabled={disabled} onClick={() => {
      if (!commitName()) return
      const current = useTimelineStore.getState().clips.find(candidate => candidate.id === clip.id)
      const result = current ? navigateCompoundContents(current) : { ok: false, reason: 'The compound changed. Select it again.' }
      if (!result.ok) setError(result.reason || 'The compound could not be opened.')
    }} className="w-full rounded border border-violet-400/40 bg-violet-400/10 px-2 py-2 font-medium text-violet-200 hover:bg-violet-400/20 disabled:opacity-50">Open Contents</button>
    <button type="button" data-testid="compound-inspector-uncompound" onClick={event => {
      if (!commitName()) return
      const session = captureUncompoundSession(useTimelineStore.getState(), clip.id, event.currentTarget, document.querySelector('[data-compound-timeline-focus]'))
      if (session) setUncompoundSession(session)
      else setError('Select just this compound on the parent timeline to uncompound it.')
    }} className="w-full rounded border border-sf-dark-600 px-2 py-2 text-sf-text-primary hover:bg-sf-dark-700">Uncompound…</button>
    <p className="leading-relaxed text-sf-text-muted">Move or trim this clip on the parent timeline. Open its contents to edit the original clips, effects and audio. One level of compounds is supported.</p>
    {(error || disabled) && <p data-testid="compound-inspector-status" role="alert" className="break-words text-amber-200">{error || 'Unlock the compound and its track to edit its contents.'}</p>}
    {uncompoundSession && <UncompoundDialog session={uncompoundSession} onClose={closeUncompound} />}
  </div>
}

export default function CompoundClipDialog({ session, onClose }) {
  const dialogRef = useRef(null)
  const inputRef = useRef(null)
  const applyingRef = useRef(false)
  const [name, setName] = useState('Compound Clip')
  const [error, setError] = useState('')
  const live = useTimelineStore(useShallow(state => ({
    ...Object.fromEntries(SNAPSHOT_KEYS.map(key => [key, state[key]])),
    selectedClipIds: state.selectedClipIds,
    previewCreateCompound: state.previewCreateCompound,
  })))
  const stale = SNAPSHOT_KEYS.some(key => live[key] !== session.snapshot[key]) || !sameSelection(live.selectedClipIds, session.clipIds)
  const request = useMemo(() => ({ clipIds: session.clipIds, name: name.trim(), width: session.width, height: session.height }), [name, session])
  const preview = useMemo(() => stale ? null : live.previewCreateCompound?.(request), [stale, live, request])
  const selected = session.snapshot.clips.filter(clip => session.clipIds.includes(clip.id))
  const start = selected.length ? Math.min(...selected.map(clip => clip.startTime)) : 0
  const duration = selected.length ? Math.max(...selected.map(clip => clip.startTime + clip.duration)) - start : 0
  const canApply = !stale && name.trim() && preview?.ok && !applyingRef.current
  const status = stale ? 'The timeline or selection changed. Close this dialog and review the selection again.'
    : error || (!name.trim() ? 'Enter a compound name.' : preview?.reason || (!preview ? 'Compound creation is unavailable.' : 'The original clips stay editable inside the compound. One Undo restores this selection.'))
  useCompoundDialogFocus(session, onClose, dialogRef, inputRef, true)
  const apply = event => {
    event.preventDefault()
    if (!canApply || applyingRef.current) return
    applyingRef.current = true
    const state = useTimelineStore.getState()
    if (SNAPSHOT_KEYS.some(key => state[key] !== session.snapshot[key]) || !sameSelection(state.selectedClipIds, session.clipIds)) {
      applyingRef.current = false
      setError('The timeline changed. Close this dialog and review the selection again.')
      return
    }
    const result = state.applyCreateCompound?.(request, preview.token)
    if (result?.ok) onClose()
    else { applyingRef.current = false; setError(result?.reason || 'The compound could not be created. Nothing was changed.') }
  }
  return createPortal(<div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3" data-testid="compound-create-backdrop"
    onMouseDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose() }} onClick={event => event.stopPropagation()}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation() }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="compound-create-title" tabIndex={-1} data-testid="compound-create-dialog"
      className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-sf-dark-600 bg-sf-dark-800 text-sf-text-primary shadow-2xl">
      <header className="flex items-center gap-2 border-b border-sf-dark-700 px-4 py-3"><Layers className="h-4 w-4 text-violet-300" /><h2 id="compound-create-title" className="min-w-0 flex-1 text-sm font-medium">Create Compound Clip</h2><button type="button" onClick={onClose} aria-label="Close Create Compound Clip" className="rounded p-1 hover:bg-sf-dark-700"><X className="h-4 w-4" /></button></header>
      <form onSubmit={apply}>
        <div className="space-y-3 px-4 py-4 text-xs">
          <label className="block">Name<input ref={inputRef} data-testid="compound-create-name" value={name} maxLength={160} disabled={stale} onChange={event => { setName(event.target.value); setError('') }} className="mt-1.5 w-full min-w-0 rounded border border-sf-dark-600 bg-sf-dark-900 px-2.5 py-2 disabled:opacity-50" /></label>
          <p data-testid="compound-create-summary" className="rounded border border-sf-dark-600 px-3 py-2 leading-relaxed">{preview?.summary?.clipCount ?? selected.length} clips · {seconds(preview?.summary?.duration ?? duration)} · starts at {seconds(preview?.summary?.startTime ?? start)}<br /><span className="text-sf-text-muted">{session.width} × {session.height} · Original track order, timing and clip settings are retained.</span></p>
          <p className="leading-relaxed text-sf-text-muted">The selection becomes one clip on the parent timeline. Double-click it to edit the contents. Compounds cannot contain another compound.</p>
          <p data-testid="compound-create-status" role={stale || error || !preview?.ok ? 'alert' : 'status'} aria-live="polite" className={`break-words leading-relaxed ${stale || error || !preview?.ok ? 'text-amber-200' : 'text-sf-text-muted'}`}>{status}</p>
        </div>
        <footer className="flex flex-wrap justify-end gap-2 border-t border-sf-dark-700 px-4 py-3"><button type="button" data-testid="compound-create-cancel" onClick={onClose} className="rounded border border-sf-dark-600 px-3 py-1.5 text-xs hover:bg-sf-dark-700">Cancel</button><button type="submit" data-testid="compound-create-apply" disabled={!canApply} className="rounded bg-sf-accent px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40">Create Compound</button></footer>
      </form>
    </section>
  </div>, document.body)
}

export function UncompoundDialog({ session, onClose }) {
  const dialogRef = useRef(null)
  const cancelRef = useRef(null)
  const applyingRef = useRef(false)
  const [error, setError] = useState('')
  const live = useTimelineStore(useShallow(state => ({
    ...Object.fromEntries(UNCOMPOUND_SNAPSHOT_KEYS.map(key => [key, state[key]])),
    previewUncompound: state.previewUncompound,
  })))
  const stale = UNCOMPOUND_SNAPSHOT_KEYS.some(key => live[key] !== session.snapshot[key])
  const request = useMemo(() => ({ clipId: session.clipId }), [session])
  const preview = useMemo(() => stale ? null : live.previewUncompound?.(request), [stale, live, request])
  const summary = preview?.summary
  const warnings = [...new Set(summary?.warnings || [])]
  const canApply = !stale && preview?.ok && !applyingRef.current
  const status = stale ? 'The timeline or selection changed. Close this dialog and review the compound again.'
    : error || preview?.reason || (!preview ? 'Uncompound is unavailable. Try again.' : 'Ready to restore the visible child clips. One Undo restores the complete compound.')
  useCompoundDialogFocus(session, onClose, dialogRef, cancelRef)
  const apply = event => {
    event.preventDefault()
    if (!canApply || applyingRef.current) return
    applyingRef.current = true
    const state = useTimelineStore.getState()
    if (UNCOMPOUND_SNAPSHOT_KEYS.some(key => state[key] !== session.snapshot[key])) {
      applyingRef.current = false
      setError('The timeline changed. Close this dialog and review the compound again.')
      return
    }
    const result = state.applyUncompound?.(request, preview.token)
    if (result?.ok) onClose()
    else { applyingRef.current = false; setError(result?.reason || 'The compound could not be restored. Nothing was changed.') }
  }
  const start = summary?.startTime ?? session.clip.startTime
  const duration = summary?.duration ?? session.clip.duration
  return createPortal(<div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3" data-testid="compound-uncompound-backdrop"
    onMouseDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose() }} onClick={event => event.stopPropagation()}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation() }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="compound-uncompound-title" aria-describedby="compound-uncompound-description" tabIndex={-1} data-testid="compound-uncompound-dialog"
      className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-sf-dark-600 bg-sf-dark-800 text-sf-text-primary shadow-2xl">
      <header className="flex items-center gap-2 border-b border-sf-dark-700 px-4 py-3"><Layers className="h-4 w-4 text-violet-300" /><h2 id="compound-uncompound-title" className="min-w-0 flex-1 text-sm font-medium">Uncompound</h2><button type="button" onClick={onClose} aria-label="Close Uncompound" className="rounded p-1 hover:bg-sf-dark-700"><X className="h-4 w-4" /></button></header>
      <form onSubmit={apply}>
        <div className="space-y-3 px-4 py-4 text-xs">
          <div data-testid="compound-uncompound-summary" className="space-y-1 rounded border border-sf-dark-600 px-3 py-2 leading-relaxed">
            <p className="break-words font-medium">{summary?.compoundName || session.clip.name || 'Compound Clip'}</p>
            <p className="text-sf-text-muted">Visible range: {seconds(start)} – {seconds(start + duration)} · {seconds(duration)}</p>
            {summary && <p>{summary.clipCount} clip{summary.clipCount === 1 ? '' : 's'} on {summary.trackCount} fresh track{summary.trackCount === 1 ? '' : 's'}</p>}
          </div>
          <p id="compound-uncompound-description" className="leading-relaxed text-sf-text-muted">Replace the compound with its visible child sections, keeping their current timeline position, trims and edits. Existing tracks and other clips stay in place.</p>
          <p className="leading-relaxed text-sf-text-muted">Only visible portions are restored. Use Undo to recover cropped-out contents and the complete compound. Media files are not deleted.</p>
          {warnings.length > 0 && <ul data-testid="compound-uncompound-warnings" className="list-disc space-y-1 pl-4 text-amber-200">{warnings.map(warning => <li className="break-words leading-relaxed" key={warning}>{warning}</li>)}</ul>}
          <p data-testid="compound-uncompound-status" role={stale || error || !preview?.ok ? 'alert' : 'status'} aria-live="polite" className={`break-words leading-relaxed ${stale || error || !preview?.ok ? 'text-amber-200' : 'text-sf-text-muted'}`}>{status}</p>
        </div>
        <footer className="flex flex-wrap justify-end gap-2 border-t border-sf-dark-700 px-4 py-3"><button ref={cancelRef} type="button" data-testid="compound-uncompound-cancel" onClick={onClose} className="rounded border border-sf-dark-600 px-3 py-1.5 text-xs hover:bg-sf-dark-700">Cancel</button><button type="submit" data-testid="compound-uncompound-apply" disabled={!canApply} className="rounded bg-sf-accent px-3 py-1.5 text-xs font-medium text-black disabled:opacity-40">Uncompound</button></footer>
      </form>
    </section>
  </div>, document.body)
}
