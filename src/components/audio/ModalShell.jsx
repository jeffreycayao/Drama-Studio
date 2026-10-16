import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export const buttonClass = 'rounded border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-xs text-sf-text-primary disabled:opacity-40 hover:bg-sf-dark-700'
// Text on solid lime is always charcoal (sf-accent-on).
export const primaryButtonClass = 'rounded px-3 py-2 text-xs font-medium bg-sf-accent text-sf-accent-on hover:bg-sf-accent-hover disabled:opacity-40'
export const fieldClass = 'block w-full rounded bg-sf-dark-800 border border-sf-dark-600 p-2 text-xs text-sf-text-primary'

/** Modal with Escape, a Tab focus trap and keyboard isolation, so timeline
 * shortcuts (Delete, cut, Undo) cannot fire behind it. Focus returns on close. */
export default function ModalShell({ title, titleId, onClose, children, footer, testId, wide = false }) {
  const dialog = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previousFocus = document.activeElement
    dialog.current?.querySelector('button,select,input')?.focus()
    const key = event => {
      if (event.isComposing || event.keyCode === 229) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); return }
      if (event.key !== 'Tab' || !dialog.current) return
      const items = [...dialog.current.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled),[tabindex="0"]')]
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [])
  return createPortal(<div className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/70 p-5"
    onMouseDown={event => event.stopPropagation()}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid={testId}
      className={`w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} max-h-[90vh] flex flex-col rounded-xl border border-sf-dark-600 bg-sf-dark-900 text-sf-text-primary shadow-2xl`}
      onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
      <h2 id={titleId} className="px-5 pt-5 text-base font-semibold">{title}</h2>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">{children}</div>
      {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-sf-dark-700 px-5 py-4">{footer}</div>}
    </div>
  </div>, document.body)
}
