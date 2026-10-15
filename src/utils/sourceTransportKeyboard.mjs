import { isNativeTransportActivation, isSpaceKey, isTransportKeyboardBlocked } from './transportKeyboardGuards.mjs'

// The source monitor owns these keys before the background Editor listener.
// Space is a release gesture, matching Editor/Export without OS-repeat play.
export function attachSourceTransportKeyboard({ windowTarget = globalThis.window, documentTarget = globalThis.document,
  canHandle = () => true, onAction } = {}) {
  let pendingSpace = false, disposed = false
  const listeners = []
  const reset = () => { pendingSpace = false }
  const available = event => !disposed && canHandle() && !isTransportKeyboardBlocked(event, { windowTarget, documentTarget })
  const consume = event => { event.preventDefault(); event.stopPropagation() }
  const down = event => {
    if (!available(event)) { reset(); return }
    const key = String(event.key || '').toLowerCase()
    if (event.ctrlKey || event.metaKey || event.altKey) { reset(); return }
    if (isSpaceKey(event)) {
      if (event.shiftKey) { reset(); return }
      // Keep passive PreviewPanel/Timeline pan-modifier tracking informed.
      // Editor transport respects defaultPrevented, so it cannot also play.
      event.preventDefault()
      if (!event.repeat) pendingSpace = true
      return
    }
    reset()
    if (key === 'enter' && !event.shiftKey) {
      if (isNativeTransportActivation(event, documentTarget)) return
      consume(event)
      if (!event.repeat) onAction('toggle')
      return
    }
    if (key === 'escape') { if (!event.repeat) onAction('exit'); return }
    const action = { i: 'in', o: 'out', x: 'clear', arrowleft: 'previous-frame', arrowright: 'next-frame' }[key]
    if (!action) return
    consume(event)
    if (!event.repeat || action.endsWith('frame')) onAction(action)
  }
  const up = event => {
    if (!isSpaceKey(event)) return
    const pending = pendingSpace
    reset()
    if (!available(event) || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
    event.preventDefault()
    if (pending && !event.repeat) onAction('toggle')
  }
  const listen = (target, name, handler, capture = false) => {
    target?.addEventListener(name, handler, capture)
    listeners.push(() => target?.removeEventListener(name, handler, capture))
  }
  listen(windowTarget, 'keydown', down, true)
  listen(windowTarget, 'keyup', up, true)
  listen(windowTarget, 'blur', reset)
  listen(windowTarget, 'comfystudio-space-modifier-used', reset)
  for (const name of ['focusin', 'pointerdown', 'mousedown', 'visibilitychange']) listen(documentTarget, name, reset, true)
  return () => { disposed = true; reset(); listeners.forEach(remove => remove()) }
}
