import { isSpaceKey, isTransportKeyboardBlocked } from './transportKeyboardGuards.mjs'

export function attachPreviewPopoutKeyboard({ windowTarget, documentTarget = windowTarget?.document,
  canHandle = () => true, onTogglePlay, onToggleFullscreen }) {
  let pending = false, disposed = false
  const listeners = [], reset = () => { pending = false }
  const available = event => !disposed && canHandle() && !event.ctrlKey && !event.altKey && !event.metaKey
    && !isTransportKeyboardBlocked(event, { windowTarget, documentTarget })
  const down = event => {
    if (!available(event)) { reset(); return }
    if (isSpaceKey(event) && !event.shiftKey) {
      event.preventDefault()
      if (!event.repeat) pending = true
    } else {
      reset()
      if (String(event.key).toLowerCase() === 'f') {
        event.preventDefault()
        if (!event.repeat) onToggleFullscreen?.()
      }
    }
  }
  const up = event => {
    if (!isSpaceKey(event)) return
    const wasPending = pending
    reset()
    if (!wasPending || !available(event) || event.shiftKey || event.repeat) return
    event.preventDefault()
    onTogglePlay?.()
  }
  const listen = (target, name, handler, capture = false) => {
    target?.addEventListener(name, handler, capture)
    listeners.push(() => target?.removeEventListener(name, handler, capture))
  }
  listen(documentTarget, 'keydown', down)
  listen(documentTarget, 'keyup', up)
  listen(windowTarget, 'blur', reset)
  for (const name of ['visibilitychange', 'focusin', 'pointerdown', 'mousedown']) listen(documentTarget, name, reset, true)
  return () => { disposed = true; reset(); listeners.forEach(remove => remove()) }
}
