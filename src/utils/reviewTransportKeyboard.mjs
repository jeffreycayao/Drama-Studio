import { isTextEditingElement } from './keyboardFocus.js'
import { getShuttleKeyAction } from './shuttlePlayback.js'

const MODAL_SELECTOR = '[aria-modal="true"], [role="dialog"], .fixed.inset-0'
const BLOCKED_ROLES = new Set(['textbox', 'combobox', 'spinbutton', 'slider', 'separator', 'menu', 'menuitem', 'listbox'])
const SPACE_MODIFIER_USED_EVENT = 'comfystudio-space-modifier-used'
const tagName = (element) => String(element?.tagName || '').toUpperCase()
const keyName = (event) => String(event?.key || '').toLowerCase()
const isSpace = (event) => event?.code === 'Space' || [' ', 'space', 'spacebar'].includes(keyName(event))
const isComposing = (event) => event?.isComposing || event?.keyCode === 229

function ancestors(element) {
  const result = []
  const seen = new Set()
  while (element && !seen.has(element)) {
    seen.add(element)
    result.push(element)
    element = element.parentElement || element.parentNode || null
  }
  return result
}

function isMarkedScrubber(element) {
  return tagName(element) === 'INPUT'
    && String(element.getAttribute?.('type') || element.type || '').toLowerCase() === 'range'
    && element.getAttribute?.('data-review-transport') === 'true'
}

function blocksTransport(element, scrubberException) {
  return ancestors(element).some((node) => {
    if (node === scrubberException) return false
    if (isTextEditingElement(node) || ['INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(tagName(node))) return true
    const editable = node.getAttribute?.('contenteditable')
    if (editable != null && String(editable).toLowerCase() !== 'false') return true
    return String(node.getAttribute?.('role') || '').toLowerCase().split(/\s+/).some((role) => BLOCKED_ROLES.has(role))
  })
}

function hasVisibleModal(documentTarget, windowTarget) {
  const elements = documentTarget?.querySelectorAll?.(MODAL_SELECTOR) || []
  const styleOwner = typeof documentTarget?.defaultView?.getComputedStyle === 'function'
    ? documentTarget.defaultView : windowTarget
  for (const element of elements) {
    if (!element.getClientRects?.().length) continue
    const style = styleOwner?.getComputedStyle?.(element) || element.style || {}
    if (style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse') return true
  }
  return false
}

/** Navigation-only keyboard ownership for a visible Export review session.
 * The caller supplies current-session/media-preparation/content gating and
 * interprets action strings; this helper knows nothing about project stores.
 */
export function attachReviewTransportKeyboard({
  windowTarget = globalThis.window,
  documentTarget = globalThis.document,
  onAction,
  canHandle = () => true,
} = {}) {
  if (!windowTarget?.addEventListener || typeof onAction !== 'function') return () => {}
  let disposed = false
  let pendingSpace = false
  let kHeld = false
  const listeners = []
  const reset = () => { pendingSpace = false; kHeld = false }
  const listen = (target, name, handler, capture = false) => {
    if (!target?.addEventListener) return
    target.addEventListener(name, handler, capture)
    listeners.push(() => target.removeEventListener(name, handler, capture))
  }
  const isAvailable = (event, allowBareShift = false) => {
    if (disposed || event.defaultPrevented || isComposing(event)
      || event.ctrlKey || event.metaKey || event.altKey
      || documentTarget?.hidden || documentTarget?.visibilityState === 'hidden') return false
    const key = keyName(event)
    // Shift+K belongs to the editor's Play Around binding, not review Pause.
    if (event.shiftKey && key !== 'j' && key !== 'l' && !(allowBareShift && key === 'shift')) return false
    if (!canHandle() || hasVisibleModal(documentTarget, windowTarget)) return false
    const active = documentTarget?.activeElement
    const allowedScrubberKey = isSpace(event) || ['enter', 'j', 'k', 'l'].includes(key)
    const scrubberException = allowedScrubberKey && active === event.target && isMarkedScrubber(active)
      ? active : null
    if (blocksTransport(active, scrubberException) || blocksTransport(event.target, scrubberException)) return false
    return !(event.composedPath?.() || []).some((node) => blocksTransport(node, scrubberException))
  }
  const emit = (event, action) => {
    event.preventDefault()
    onAction(action)
  }
  const keyDown = (event) => {
    // Shift may form Shift+J/L while K remains held, but cannot preserve a
    // chord across a blocked form, modal, preparation state, or session.
    if (keyName(event) === 'shift') {
      pendingSpace = false
      if (!isAvailable(event, true)) kHeld = false
      return
    }
    if (!isAvailable(event)) {
      reset()
      return
    }
    if (isSpace(event)) {
      if (event.repeat) {
        if (pendingSpace) event.preventDefault()
        return
      }
      // Prevent native button activation at its keydown as well as keyup.
      event.preventDefault()
      pendingSpace = true
      return
    }
    pendingSpace = false
    const key = keyName(event)
    if (key === 'enter') {
      const nativeTarget = [event.target, documentTarget?.activeElement].some((node) => ancestors(node)
        .some((element) => ['BUTTON', 'A'].includes(tagName(element))
          || element.getAttribute?.('role') === 'button'))
      if (nativeTarget) return
      event.preventDefault()
      if (!event.repeat) onAction('toggle')
      return
    }
    const navigation = { arrowleft: 'previous-frame', arrowright: 'next-frame', home: 'start', end: 'end' }[key]
    if (navigation) {
      event.preventDefault()
      if (!event.repeat || key === 'arrowleft' || key === 'arrowright') onAction(navigation)
      return
    }
    const shuttle = getShuttleKeyAction(event, kHeld)
    if (!shuttle) return
    if (shuttle.type === 'pause') {
      kHeld = true
      emit(event, 'pause')
    } else {
      const prefix = shuttle.type === 'hold-slow' ? 'hold-' : shuttle.type === 'step-slow' ? 'slow-' : ''
      emit(event, `${prefix}${shuttle.direction}`)
    }
  }
  const keyUp = (event) => {
    const space = isSpace(event)
    const wasPending = pendingSpace
    if (space) pendingSpace = false
    if (keyName(event) === 'k') kHeld = false
    // Always clear stale held state, even if a release was consumed by a
    // form, IME, modal, changed session, or another keyboard owner.
    if (!isAvailable(event)) { reset(); return }
    if (!space || !wasPending) return
    event.preventDefault()
    if (!event.repeat) onAction('toggle')
  }

  listen(windowTarget, 'keydown', keyDown)
  listen(windowTarget, 'keyup', keyUp)
  listen(windowTarget, 'blur', reset)
  listen(windowTarget, SPACE_MODIFIER_USED_EVENT, reset)
  listen(documentTarget, 'visibilitychange', reset)
  listen(documentTarget, 'focusin', reset, true)
  listen(documentTarget, 'pointerdown', reset, true)
  listen(documentTarget, 'mousedown', reset, true)
  return () => {
    if (disposed) return
    disposed = true
    reset()
    for (const remove of listeners) remove()
  }
}
