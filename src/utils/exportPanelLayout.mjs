export const PANEL_WIDTHS_STORAGE_KEY = 'velorn-export-panel-widths-v1'

const SETTINGS_MIN = 220
const SETTINGS_MAX = 520
const QUEUE_MIN = 180
const QUEUE_MAX = 480
const HANDLE_WIDTH = 6

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

/** Null means "use this container's responsive default", not zero pixels.
 * Storage parsing belongs to the caller; malformed objects are harmless. */
export function sanitizeExportPanelWidths(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    settings: finiteNumber(source.settings) ? clamp(source.settings, SETTINGS_MIN, SETTINGS_MAX) : null,
    queue: finiteNumber(source.queue) ? clamp(source.queue, QUEUE_MIN, QUEUE_MAX) : null,
  }
}

/** Resolve rendered widths without overwriting saved user preferences.
 *
 * Above 800px, both sidebars share a budget that leaves a 320px preview.
 * If necessary, reduce only their space ABOVE minimum widths, in proportion
 * to each sidebar's requested excess. At 561–800px the queue moves below the
 * other panels, leaving a 280px preview beside the settings panel. At 560px
 * and below everything stacks and there are no horizontal resize handles.
 *
 * Drag maxima hold the OTHER rendered sidebar fixed. Responsive shrinking
 * therefore does not unexpectedly move both panels during one drag.
 */
export function resolveExportPanelLayout(width, queueOpen, preferences) {
  if (!finiteNumber(width) || width <= 0) {
    return {
      settingsWidth: 0, queueWidth: 0,
      settingsMin: 0, settingsMax: 0, queueMin: 0, queueMax: 0,
      resizeSettings: false, resizeQueue: false,
    }
  }

  const showQueue = queueOpen === true
  if (width <= 560) {
    return {
      settingsWidth: width, queueWidth: showQueue ? width : 0,
      settingsMin: width, settingsMax: width,
      queueMin: showQueue ? width : 0, queueMax: showQueue ? width : 0,
      resizeSettings: false, resizeQueue: false,
    }
  }

  const saved = sanitizeExportPanelWidths(preferences)
  if (width <= 800) {
    const settingsMax = Math.min(SETTINGS_MAX, width - 280 - HANDLE_WIDTH)
    return {
      settingsWidth: clamp(saved.settings ?? 225, SETTINGS_MIN, settingsMax),
      queueWidth: showQueue ? width : 0,
      settingsMin: SETTINGS_MIN, settingsMax,
      queueMin: showQueue ? width : 0, queueMax: showQueue ? width : 0,
      resizeSettings: true, resizeQueue: false,
    }
  }

  const defaults = width >= 1600 ? [296, 258] : width > 1090 ? [272, 230] : [238, 192]
  let settingsWidth = saved.settings ?? defaults[0]
  let queueWidth = showQueue ? saved.queue ?? defaults[1] : 0
  const sidebarBudget = width - 320 - HANDLE_WIDTH * (showQueue ? 2 : 1)

  if (settingsWidth + queueWidth > sidebarBudget) {
    const minimumTotal = SETTINGS_MIN + (showQueue ? QUEUE_MIN : 0)
    const settingsExcess = settingsWidth - SETTINGS_MIN
    const queueExcess = showQueue ? queueWidth - QUEUE_MIN : 0
    const totalExcess = settingsExcess + queueExcess
    const retainedShare = totalExcess > 0
      ? clamp((sidebarBudget - minimumTotal) / totalExcess, 0, 1)
      : 0
    settingsWidth = SETTINGS_MIN + settingsExcess * retainedShare
    queueWidth = showQueue ? QUEUE_MIN + queueExcess * retainedShare : 0
  }

  return {
    settingsWidth,
    queueWidth,
    settingsMin: SETTINGS_MIN,
    settingsMax: Math.min(SETTINGS_MAX, sidebarBudget - queueWidth),
    queueMin: showQueue ? QUEUE_MIN : 0,
    queueMax: showQueue ? Math.min(QUEUE_MAX, sidebarBudget - settingsWidth) : 0,
    resizeSettings: true,
    resizeQueue: showQueue,
  }
}
