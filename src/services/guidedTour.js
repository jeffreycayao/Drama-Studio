/**
 * Guided tours (driver.js).
 *
 * Steps anchor to `data-tour` attributes rather than class names so restyling
 * never breaks a tour. A step whose element is not on screen (a collapsed
 * panel, a different layout) is skipped instead of breaking the run. Each
 * context is offered once automatically; Getting Started can replay it.
 */

import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'

const SEEN_KEY_PREFIX = 'drama-studio-tour'
const TOUR_VERSION = 1

const TOURS = {
  welcome: [
    { anchor: 'welcome-new-project', key: 'newProject', side: 'bottom', align: 'end' },
    { anchor: 'welcome-open-project', key: 'openProject', side: 'bottom', align: 'end' },
    { anchor: 'welcome-setup-doctor', key: 'setupDoctor', side: 'bottom', align: 'end' },
    { anchor: 'welcome-comfy', key: 'comfy', side: 'bottom', align: 'start' },
    { anchor: 'welcome-api-key', key: 'apiKey', side: 'bottom', align: 'start' },
    { anchor: 'welcome-discover', key: 'discover', side: 'bottom', align: 'end' },
    { anchor: 'welcome-getting-started', key: 'gettingStarted', side: 'bottom', align: 'end' },
  ],
  editor: [
    { anchor: 'editor-modes', key: 'modes', side: 'bottom', align: 'center' },
    { anchor: 'editor-left-panel', key: 'leftPanel', side: 'right', align: 'start' },
    { anchor: 'editor-preview', key: 'preview', side: 'bottom', align: 'center' },
    { anchor: 'editor-inspector', key: 'inspector', side: 'left', align: 'start' },
    { anchor: 'editor-timeline', key: 'timeline', side: 'top', align: 'center' },
    { anchor: 'editor-app-menu', key: 'appMenu', side: 'top', align: 'end' },
  ],
}

let activeTour = null

function seenKey(context) {
  return `${SEEN_KEY_PREFIX}:${context}:v${TOUR_VERSION}`
}

function hasSeen(context) {
  try {
    return localStorage.getItem(seenKey(context)) === '1'
  } catch {
    return true // storage unavailable: never nag
  }
}

function markSeen(context) {
  try {
    localStorage.setItem(seenKey(context), '1')
  } catch {
    // storage unavailable
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ))
}

function isVisible(element) {
  if (!element) return false
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

/** Which tour fits what is on screen right now. */
export function detectTourContext() {
  if (typeof document === 'undefined') return null
  if (isVisible(document.querySelector('[data-tour^="editor-"]'))) return 'editor'
  if (isVisible(document.querySelector('[data-tour^="welcome-"]'))) return 'welcome'
  return null
}

/** Steps whose anchor is currently visible, as driver.js step objects. */
export function buildTourSteps(context, t, root = typeof document !== 'undefined' ? document : null) {
  const definitions = TOURS[context] || []
  return definitions
    .map((step) => ({ step, element: root?.querySelector(`[data-tour="${step.anchor}"]`) }))
    .filter(({ element }) => isVisible(element))
    .map(({ step, element }) => ({
      element,
      popover: {
        title: escapeHtml(t(`guidedTour.${context}.${step.key}.title`)),
        description: escapeHtml(t(`guidedTour.${context}.${step.key}.body`)),
        side: step.side,
        align: step.align,
      },
    }))
}

/**
 * Start the tour for the current screen.
 * @param {Object} options - { t, context?, force? }
 * @returns {boolean} whether a tour started
 */
export function startGuidedTour({ t, context = detectTourContext(), force = false } = {}) {
  if (!context || typeof t !== 'function') return false
  if (!force && hasSeen(context)) return false
  const steps = buildTourSteps(context, t)
  if (steps.length === 0) return false

  activeTour?.destroy()
  // Mark on start: closing a tour early still counts as "offered".
  markSeen(context)
  activeTour = driver({
    steps,
    showProgress: steps.length > 1,
    allowClose: true,
    smoothScroll: true,
    stagePadding: 6,
    stageRadius: 10,
    overlayColor: '#16140f',
    overlayOpacity: 0.72,
    popoverClass: 'drama-tour',
    nextBtnText: t('guidedTour.next'),
    prevBtnText: t('guidedTour.back'),
    doneBtnText: t('guidedTour.done'),
    progressText: t('guidedTour.progress'),
    onDestroyed: () => {
      activeTour = null
    },
  })
  activeTour.drive()
  return true
}

/** Offer a context's tour the first time it is reached. */
export function maybeStartFirstRunTour(context, t) {
  if (activeTour || hasSeen(context)) return false
  // Wait for any open dialog to close before highlighting the page beneath it.
  if (typeof document !== 'undefined' && document.querySelector('[role="dialog"], .fixed.inset-0')) return false
  return startGuidedTour({ t, context })
}
