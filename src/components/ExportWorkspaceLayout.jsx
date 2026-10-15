import { Children, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/I18nContext'
import { PANEL_WIDTHS_STORAGE_KEY, resolveExportPanelLayout, sanitizeExportPanelWidths } from '../utils/exportPanelLayout.mjs'

function loadWidths() {
  try { return sanitizeExportPanelWidths(JSON.parse(localStorage.getItem(PANEL_WIDTHS_STORAGE_KEY))) }
  catch { return sanitizeExportPanelWidths(null) }
}
function saveWidths(widths) {
  try { localStorage.setItem(PANEL_WIDTHS_STORAGE_KEY, JSON.stringify(widths)) }
  catch { /* Resizing still works when local preferences are unavailable. */ }
}

/** Workspace-only sizing: no project settings, timeline writes, or render state. */
export default function ExportWorkspaceLayout({ active, queueOpen, children }) {
  const { t } = useI18n()
  const bodyRef = useRef(null), dragRef = useRef(null), rafRef = useRef(null)
  const mountedRef = useRef(true)
  const [width, setWidth] = useState(0)
  const [preferences, setPreferences] = useState(loadWidths)
  const preferencesRef = useRef(preferences)
  const [dragging, setDragging] = useState(false)
  const layout = resolveExportPanelLayout(width, queueOpen, preferences)
  const [settings, review, queue] = Children.toArray(children)

  const updateWidths = useCallback((next, persist = false) => {
    preferencesRef.current = next
    if (mountedRef.current) setPreferences(next)
    if (persist) saveWidths(next)
  }, [])
  const finishDrag = useCallback((commit) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (commit && drag.changed) saveWidths(preferencesRef.current)
    else updateWidths(drag.preferences)
    if (mountedRef.current) setDragging(false)
    try {
      if (drag.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId)
    } catch { /* The divider may have been removed by a workspace change. */ }
  }, [updateWidths])
  const applyDrag = useCallback((clientX) => {
    const drag = dragRef.current
    if (!drag) return
    // Pointer-up can arrive before ResizeObserver reports a window resize.
    // Do not commit coordinates measured against the previous container.
    if (bodyRef.current?.getBoundingClientRect().width !== drag.containerWidth) {
      finishDrag(false)
      return
    }
    const delta = (clientX - drag.startX) * (drag.side === 'settings' ? 1 : -1)
    const nextWidth = delta === 0 ? drag.startWidth : Math.max(drag.min, Math.min(drag.max, Math.round(drag.startWidth + delta)))
    drag.changed = nextWidth !== drag.startWidth
    // Keep the opposite visible panel fixed, even if the window has clamped
    // a wider saved preference. Window resizing itself never saves widths.
    updateWidths({ ...drag.visible, [drag.side]: nextWidth })
  }, [updateWidths, finishDrag])

  useLayoutEffect(() => {
    const node = bodyRef.current
    if (!node) return
    const measure = () => setWidth(node.getBoundingClientRect().width)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    const drag = dragRef.current
    if (drag && (!active || width !== drag.containerWidth || queueOpen !== drag.queueOpen)) finishDrag(false)
  }, [active, width, queueOpen, finishDrag])
  useEffect(() => {
    if (!dragging) return
    const style = document.body.style
    const previous = ['cursor', 'user-select'].map(key => [key, style.getPropertyValue(key), style.getPropertyPriority(key)])
    style.setProperty('cursor', 'col-resize')
    style.setProperty('user-select', 'none')
    const cancel = () => finishDrag(false)
    const onKeyDown = event => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); cancel()
    }
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', onKeyDown, true)
      for (const [key, value, priority] of previous) {
        if (value) style.setProperty(key, value, priority)
        else style.removeProperty(key)
      }
    }
  }, [dragging, finishDrag])
  useLayoutEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; finishDrag(false) }
  }, [finishDrag])

  const resetPanel = side => {
    finishDrag(false)
    updateWidths({ ...preferencesRef.current, [side]: null }, true)
  }
  const resizeWithKeyboard = (event, side) => {
    if (dragRef.current || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation(); resetPanel(side); return
    }
    const current = layout[side + 'Width']
    const min = layout[side + 'Min'], max = layout[side + 'Max']
    const step = event.shiftKey ? 40 : 10
    const direction = side === 'settings' ? 1 : -1
    const next = event.key === 'Home' ? min : event.key === 'End' ? max
      : event.key === 'ArrowLeft' ? current - step * direction
        : event.key === 'ArrowRight' ? current + step * direction : null
    if (next === null) return
    event.preventDefault(); event.stopPropagation()
    updateWidths({ settings: layout.settingsWidth, queue: queueOpen && layout.resizeQueue ? layout.queueWidth : preferencesRef.current.queue,
      [side]: Math.max(min, Math.min(max, Math.round(next))) }, true)
  }
  const divider = side => {
    if (!(side === 'settings' ? layout.resizeSettings : layout.resizeQueue)) return null
    return <div key={side} className="export-workspace__divider" data-testid={'export-resize-' + side}
      role="separator" tabIndex={0} aria-orientation="vertical"
      aria-label={t(side === 'settings' ? 'export.workspace.resizeSettings' : 'export.workspace.resizeQueue', undefined,
        side === 'settings' ? 'Resize export settings' : 'Resize export queue')}
      aria-controls={side === 'settings' ? 'export-settings-panel' : 'export-render-queue'}
      aria-valuemin={Math.round(layout[side + 'Min'])} aria-valuemax={Math.round(layout[side + 'Max'])}
      aria-valuenow={Math.round(layout[side + 'Width'])} title={t('export.workspace.resizePanelHelp', undefined,
        'Drag to resize. Double-click or press Enter to reset. Arrow keys adjust width; hold Shift for larger steps.')}
      onDoubleClick={() => resetPanel(side)} onKeyDown={event => resizeWithKeyboard(event, side)}
      onPointerDown={event => {
        if (!active || event.button !== 0 || event.isPrimary === false || dragRef.current) return
        event.preventDefault()
        event.currentTarget.focus()
        dragRef.current = { side, pointerId: event.pointerId, element: event.currentTarget,
          startX: event.clientX, startWidth: layout[side + 'Width'], min: layout[side + 'Min'], max: layout[side + 'Max'],
          containerWidth: width, queueOpen, changed: false, preferences: preferencesRef.current,
          visible: { settings: layout.settingsWidth, queue: queueOpen && layout.resizeQueue ? layout.queueWidth : preferencesRef.current.queue } }
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
      }}
      onPointerMove={event => {
        if (dragRef.current?.pointerId !== event.pointerId) return
        dragRef.current.latestX = event.clientX
        if (rafRef.current !== null) return
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null
          if (dragRef.current) applyDrag(dragRef.current.latestX)
        })
      }}
      onPointerUp={event => {
        if (dragRef.current?.pointerId !== event.pointerId) return
        applyDrag(event.clientX); finishDrag(true)
      }}
      onPointerCancel={() => finishDrag(false)} onLostPointerCapture={() => finishDrag(false)}
    />
  }

  return <div ref={bodyRef} className="export-workspace__body" data-queue-open={queueOpen} data-resizing={dragging}
    style={{ '--export-settings-width': layout.settingsWidth + 'px', '--export-queue-width': layout.queueWidth + 'px' }}>
    {settings}{divider('settings')}{review}{queueOpen && divider('queue')}{queue}
  </div>
}
