import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { trapDialogFocus } from '../utils/dialogFocus.mjs'
import { MAX_EXPORT_PRESET_NAME_LENGTH } from '../utils/exportPresetLibrary.mjs'

/** Local preference editing only. The captured settings/record are supplied
 * by the caller; no timeline, project, export worker or filesystem is used. */
export default function ExportPresetDialog({ session, onSubmit, onClose }) {
  const dialogRef = useRef(null), inputRef = useRef(null), cancelRef = useRef(null)
  const composingRef = useRef(false)
  const isComposing = event => composingRef.current || event.isComposing || event.nativeEvent?.isComposing
    || event.keyCode === 229 || event.nativeEvent?.keyCode === 229
  const [name, setName] = useState(session.preset?.name || '')
  const [error, setError] = useState('')
  const deleting = session.mode === 'delete'
  const title = deleting ? 'Delete preset?' : session.mode === 'rename' ? 'Rename preset' : 'Save as preset'
  useLayoutEffect(() => {
    const previous = document.activeElement
    ;(deleting ? cancelRef.current : inputRef.current)?.focus()
    inputRef.current?.select()
    return () => {
      if (previous?.isConnected && previous.getClientRects?.().length) previous.focus({ preventScroll: true })
    }
  }, [deleting])
  return createPortal(<div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/60 p-4"
    onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <form ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="export-preset-dialog-title"
      aria-describedby="export-preset-dialog-description" tabIndex={-1}
      className="w-full max-w-sm rounded-xl border border-sf-dark-600 bg-sf-dark-900 p-5 text-sf-text-primary shadow-2xl"
      onCompositionStart={() => { composingRef.current = true }}
      onCompositionEnd={() => { composingRef.current = false }}
      onKeyDown={event => {
        event.stopPropagation()
        if (isComposing(event)) {
          // IME confirmation/cancellation belongs to the name input, not
          // this dialog. Do not block ordinary composing character events.
          if (['Enter', 'Escape'].includes(event.key) || ['Enter', 'Escape'].includes(event.code)) event.preventDefault()
          return
        }
        if (event.key === 'Escape') { event.preventDefault(); onClose() }
        else trapDialogFocus(event, dialogRef.current)
      }} onKeyUp={event => event.stopPropagation()}
      onSubmit={event => {
        event.preventDefault()
        if (isComposing(event)) return
        const result = onSubmit(name)
        if (!result.ok) setError(result.error)
      }}>
      <h2 id="export-preset-dialog-title" className="text-sm font-medium">{title}</h2>
      <p id="export-preset-dialog-description" className="mt-2 break-words text-xs text-sf-text-secondary">
        {deleting ? <>Remove “{session.preset.name}” from My presets? This cannot be undone. Current export settings and rendered files are not affected.</>
          : 'Available across projects on this device. Saves delivery settings only—not filenames, ranges, folders, or project settings.'}
      </p>
      {!deleting && <label className="mt-4 block text-xs text-sf-text-secondary">Preset name
        <input ref={inputRef} autoComplete="off" maxLength={MAX_EXPORT_PRESET_NAME_LENGTH}
          aria-label="Preset name" aria-invalid={Boolean(error)} aria-describedby={error ? 'export-preset-dialog-error' : undefined}
          className="mt-1 block w-full rounded-md border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-sm text-sf-text-primary focus:border-sf-accent focus:outline-none"
          value={name} onChange={event => { setName(event.target.value); setError('') }} />
      </label>}
      {error && <p id="export-preset-dialog-error" role="alert" className="mt-3 text-xs text-sf-error">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button ref={cancelRef} type="button" className="export-action" onClick={onClose}>Cancel</button>
        <button type="submit" className={`export-action ${deleting ? 'text-sf-error' : 'export-action--primary'}`}
          data-testid="export-preset-confirm">{deleting ? 'Delete preset' : session.mode === 'rename' ? 'Rename' : 'Save preset'}</button>
      </div>
    </form>
  </div>, document.body)
}
