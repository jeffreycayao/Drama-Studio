import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { X } from 'lucide-react'
import useTimelineStore from '../stores/timelineStore'
import { trapDialogFocus } from '../utils/dialogFocus.mjs'

const EMPTY_GROUPS = [
  { id: 'transform', label: 'Transform' },
  { id: 'color', label: 'Color' },
  { id: 'effects', label: 'Effects' },
  { id: 'audio', label: 'Audio' },
]

const sameSelection = (current, captured) => current.length === captured.length
  && current.every(id => captured.includes(id))

// This dialog owns keyboard focus rather than letting checkbox/button focus
// activate Timeline's or TransportControls' independent window shortcuts.
export default function PasteAttributesDialog({ session, onClose }) {
  const dialogRef = useRef(null)
  const applyingRef = useRef(false)
  const [sourceId, setSourceId] = useState(session.clipboard.clips.length === 1
    ? session.clipboard.clips[0].id
    : '')
  const [selectedGroups, setSelectedGroups] = useState([])
  const [error, setError] = useState('')
  const { clips, tracks, selectedClipIds, attributeClipboard, getPasteAttributesPreview } = useTimelineStore(useShallow(state => ({
    clips: state.clips,
    tracks: state.tracks,
    selectedClipIds: state.selectedClipIds,
    attributeClipboard: state.attributeClipboard,
    getPasteAttributesPreview: state.getPasteAttributesPreview,
  })))

  const stale = clips !== session.expectedClips || tracks !== session.expectedTracks
    || attributeClipboard?.id !== session.clipboard.id
    || !sameSelection(selectedClipIds, session.clipIds)
  const preview = useMemo(() => {
    if (!sourceId || stale) return null
    return getPasteAttributesPreview({
      clipboardId: session.clipboard.id,
      sourceId,
      clipIds: session.clipIds,
    })
  }, [sourceId, stale, getPasteAttributesPreview, session, clips, tracks, attributeClipboard, selectedClipIds])
  const groups = preview?.groups || EMPTY_GROUPS
  const canApply = !stale && preview?.ok && selectedGroups.length > 0
    && selectedGroups.every(id => groups.some(group => group.id === id
      && group.targetCount > 0 && !group.blockedReason))

  useLayoutEffect(() => {
    const returnFocus = session.returnFocus || document.activeElement
    const getFocusable = () => [...(dialogRef.current?.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]',
    ) || [])].filter(element => element.getClientRects().length > 0)
    const focusFirst = () => (getFocusable().find(element => element.tagName !== 'BUTTON')
      || getFocusable()[0] || dialogRef.current)?.focus()

    const handleKeyDown = event => {
      // Keep native checkbox/select/button keyboard behavior, but never pass
      // this event to editor shortcut listeners (including other window ones).
      event.stopImmediatePropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else trapDialogFocus(event, dialogRef.current)
    }
    const handleKeyUp = event => event.stopImmediatePropagation()
    const containFocus = event => {
      if (!dialogRef.current?.contains(event.target)) focusFirst()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    document.addEventListener('focusin', containFocus, true)
    focusFirst()
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      document.removeEventListener('focusin', containFocus, true)
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [onClose, session])

  const apply = event => {
    event.preventDefault()
    if (!canApply || applyingRef.current) return
    applyingRef.current = true
    const result = useTimelineStore.getState().applyPasteAttributes({
      clipboardId: session.clipboard.id,
      sourceId,
      clipIds: session.clipIds,
      groups: selectedGroups,
      expectedClips: session.expectedClips,
      expectedTracks: session.expectedTracks,
    })
    if (result.ok) onClose()
    else {
      applyingRef.current = false
      setError(result.error || 'These attributes could not be pasted. Nothing was changed.')
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={event => {
        event.stopPropagation()
        if (event.target === event.currentTarget) onClose()
      }}
      onClick={event => event.stopPropagation()}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation() }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="paste-attributes-title"
        aria-describedby="paste-attributes-description"
        data-testid="paste-attributes-dialog"
        tabIndex={-1}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border border-sf-dark-600 bg-sf-dark-800 text-sf-text-primary shadow-2xl"
      >
        <header className="flex items-start gap-3 border-b border-sf-dark-700 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="paste-attributes-title" className="text-sm font-medium">Paste Attributes</h2>
            <p id="paste-attributes-description" className="mt-1 text-xs leading-relaxed text-sf-text-muted">
              Choose which settings to replace on {session.clipIds.length} selected clip{session.clipIds.length === 1 ? '' : 's'}. Each category applies only to compatible, unlocked clips.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close Paste Attributes" className="rounded p-1 text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary">
            <X className="h-4 w-4" />
          </button>
        </header>
        <form onSubmit={apply}>
          <div className="space-y-4 px-5 py-4">
            <div>
              <label htmlFor="paste-attributes-source" className="mb-1.5 block text-xs font-medium">Copied source clip</label>
              <select
                id="paste-attributes-source"
                data-testid="paste-attributes-source"
                value={sourceId}
                disabled={stale}
                onChange={event => { setSourceId(event.target.value); setSelectedGroups([]); setError('') }}
                className="w-full min-w-0 rounded border border-sf-dark-600 bg-sf-dark-900 px-2.5 py-2 text-xs disabled:opacity-50"
              >
                {session.clipboard.clips.length > 1 && <option value="">Choose a copied clip</option>}
                {session.clipboard.clips.map(clip => <option key={clip.id} value={clip.id}>{clip.name || clip.id} ({clip.type})</option>)}
              </select>
              {!sourceId && <p className="mt-1.5 text-xs text-sf-text-muted">Several clips were copied. Choose the one whose settings you want to use.</p>}
            </div>

            <fieldset className="space-y-2" disabled={stale || !sourceId || !preview?.ok}>
              <legend className="mb-2 text-xs font-medium">Replace selected attributes</legend>
              {groups.map(group => {
                const disabled = !preview?.ok || !group.targetCount || !!group.blockedReason || stale
                return <label key={group.id} className={`flex items-start gap-3 rounded border border-sf-dark-600 px-3 py-2.5 ${disabled ? 'opacity-60' : 'cursor-pointer hover:bg-sf-dark-700/60'}`}>
                  <input
                    type="checkbox"
                    data-testid={`paste-attributes-group-${group.id}`}
                    checked={selectedGroups.includes(group.id)}
                    disabled={disabled}
                    onChange={event => {
                      const checked = event.target.checked
                      setSelectedGroups(previous => checked ? [...previous, group.id] : previous.filter(id => id !== group.id))
                      setError('')
                    }}
                    className="mt-0.5 accent-sf-accent"
                  />
                  <span className="min-w-0 text-xs">
                    <span className="font-medium">{group.label}</span>
                    {!!group.targetCount && !group.blockedReason && <span className="ml-2 text-sf-text-muted">{group.targetCount} clip{group.targetCount === 1 ? '' : 's'}</span>}
                    {group.description && <span className="mt-1 block leading-relaxed text-sf-text-muted">{group.description}</span>}
                    {sourceId && group.blockedReason && <span className="mt-1 block leading-relaxed text-amber-300">{group.blockedReason}</span>}
                  </span>
                </label>
              })}
            </fieldset>

            {(preview?.lockedCount > 0 || preview?.unsupportedCount > 0) && <p className="text-xs text-sf-text-muted">
              {preview.lockedCount > 0 && `${preview.lockedCount} locked clip${preview.lockedCount === 1 ? '' : 's'} skipped. `}
              {preview.unsupportedCount > 0 && `${preview.unsupportedCount} unsupported clip${preview.unsupportedCount === 1 ? '' : 's'} skipped.`}
            </p>}
            <p className="text-xs leading-relaxed text-sf-text-muted">
              Timing, source media, masks and animation stay unchanged. Categories with animation on the source or a destination are unavailable. One Undo restores the whole paste.
            </p>
            {(stale || error || (sourceId && preview && !preview.ok)) && <p role="alert" className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
              {stale ? 'The timeline, selection or copied clips changed. Close this dialog and reopen Paste Attributes to review the current clips.' : error || preview.error}
            </p>}
          </div>
          <footer className="flex justify-end gap-2 border-t border-sf-dark-700 px-5 py-3">
            <button type="button" data-testid="paste-attributes-cancel" onClick={onClose} className="rounded border border-sf-dark-600 px-3 py-1.5 text-xs hover:bg-sf-dark-700">Cancel</button>
            <button type="submit" data-testid="paste-attributes-apply" disabled={!canApply} className="rounded bg-sf-accent px-3 py-1.5 text-xs font-medium text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">Paste Attributes</button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  )
}
