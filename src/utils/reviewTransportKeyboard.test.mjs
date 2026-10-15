import test from 'node:test'
import assert from 'node:assert/strict'
import { attachReviewTransportKeyboard } from './reviewTransportKeyboard.mjs'
import { nextShuttleRate } from './shuttlePlayback.js'

class FakeTarget {
  constructor() { this.listeners = new Map() }
  addEventListener(name, handler, capture = false) {
    const listeners = this.listeners.get(name) || []
    listeners.push({ handler, capture })
    this.listeners.set(name, listeners)
  }
  removeEventListener(name, handler, capture = false) {
    this.listeners.set(name, (this.listeners.get(name) || []).filter((entry) => entry.handler !== handler || entry.capture !== capture))
  }
  dispatch(name, properties = {}) {
    const event = { target: this, key: '', code: '', repeat: false, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true }, ...properties, type: name }
    for (const entry of [...(this.listeners.get(name) || [])]) entry.handler(event)
    return event
  }
  count() { return [...this.listeners.values()].reduce((total, entries) => total + entries.length, 0) }
}

function element(tag = 'DIV', attributes = {}, parentElement = null) {
  return {
    tagName: tag.toUpperCase(), attributes, parentElement,
    isContentEditable: false,
    getAttribute(name) { return this.attributes[name] ?? null },
    getClientRects() { return this.noRect ? [] : [{}] },
    style: { display: 'block', visibility: 'visible' },
  }
}

function fixture() {
  const win = new FakeTarget(), doc = new FakeTarget(), body = element('BODY'), actions = []
  let enabled = true
  doc.activeElement = body
  doc.visibilityState = 'visible'
  doc.hidden = false
  doc.modals = []
  doc.querySelectorAll = (selector) => {
    assert.equal(selector, '[aria-modal="true"], [role="dialog"], .fixed.inset-0')
    return doc.modals
  }
  win.getComputedStyle = (node) => node.style
  doc.defaultView = win
  const cleanup = attachReviewTransportKeyboard({ windowTarget: win, documentTarget: doc,
    onAction: (action) => actions.push(action), canHandle: () => enabled })
  const key = (type, name, extras = {}) => win.dispatch(type, {
    key: name, code: name === ' ' ? 'Space' : '', target: doc.activeElement, ...extras,
  })
  return { win, doc, body, actions, cleanup, key, enable: (value) => { enabled = value } }
}

test('Space toggles once on release and suppresses repeats and native button activation', () => {
  const f = fixture()
  for (const label of ['Play', 'Export now', 'Preset']) {
    f.doc.activeElement = element('BUTTON', { 'aria-label': label })
    let nativeArmed = false, nativeClicks = 0
    const down = f.key('keydown', ' ')
    if (!down.defaultPrevented) nativeArmed = true
    assert.equal(down.defaultPrevented, true)
    assert.equal(f.key('keydown', ' ', { repeat: true }).defaultPrevented, true)
    assert.equal(f.actions.length, nativeClicks)
    const up = f.key('keyup', ' ')
    if (nativeArmed && !up.defaultPrevented) nativeClicks++
    assert.equal(up.defaultPrevented, true)
    assert.equal(nativeClicks, 0)
    assert.deepEqual(f.actions.splice(0), ['toggle'])
    f.key('keyup', ' ')
    assert.deepEqual(f.actions, [])
  }
  assert.equal(f.key('keydown', ' ', { repeat: true }).defaultPrevented, false)
  f.cleanup()
})

test('Space aliases work and unrelated transport input cancels a pending toggle', () => {
  const f = fixture()
  for (const name of ['Spacebar', 'Space']) {
    f.key('keydown', name)
    f.key('keyup', name)
  }
  f.key('keydown', ' ')
  f.key('keydown', 'ArrowRight')
  f.key('keyup', ' ')
  assert.deepEqual(f.actions, ['toggle', 'toggle', 'next-frame'])
  f.cleanup()
})

test('Enter toggles on non-repeated keydown but leaves buttons and links native', () => {
  const f = fixture()
  assert.equal(f.key('keydown', 'Enter').defaultPrevented, true)
  assert.equal(f.key('keydown', 'Enter', { repeat: true }).defaultPrevented, true)
  f.key('keyup', 'Enter')
  assert.deepEqual(f.actions, ['toggle'])
  for (const node of [element('BUTTON'), element('A', { href: '/test' }), element('DIV', { role: 'button' }),
    element('SPAN', {}, element('BUTTON'))]) {
    f.doc.activeElement = node
    assert.equal(f.key('keydown', 'Enter').defaultPrevented, false)
  }
  assert.deepEqual(f.actions, ['toggle'])
  f.cleanup()
})

test('Left/Right repeat, Home/End navigate, and editing keys remain unhandled', () => {
  const f = fixture()
  for (const name of ['ArrowLeft', 'ArrowRight']) {
    assert.equal(f.key('keydown', name).defaultPrevented, true)
    assert.equal(f.key('keydown', name, { repeat: true }).defaultPrevented, true)
  }
  f.key('keydown', 'Home'); f.key('keydown', 'Home', { repeat: true })
  f.key('keydown', 'End'); f.key('keydown', 'End', { repeat: true })
  for (const name of ['i', 'o', 'Delete', 'Backspace', 'x', 'PageUp', 'PageDown']) {
    assert.equal(f.key('keydown', name).defaultPrevented, false)
  }
  assert.deepEqual(f.actions, ['previous-frame', 'previous-frame', 'next-frame', 'next-frame', 'start', 'end'])
  f.cleanup()
})

test('JKL maps existing fast, slow, and held-K shuttle actions without repeat escalation', () => {
  const f = fixture()
  f.key('keydown', 'j'); f.key('keydown', 'l')
  f.key('keydown', 'J', { shiftKey: true }); f.key('keydown', 'L', { shiftKey: true })
  f.key('keydown', 'k'); f.key('keydown', 'j'); f.key('keydown', 'l')
  f.key('keydown', 'Shift', { shiftKey: true }); f.key('keydown', 'J', { shiftKey: true })
  f.key('keyup', 'j'); f.key('keydown', 'l')
  f.key('keyup', 'k'); f.key('keydown', 'l')
  for (const name of ['j', 'k', 'l']) f.key('keydown', name, { repeat: true })
  assert.deepEqual(f.actions, ['reverse', 'forward', 'slow-reverse', 'slow-forward', 'pause',
    'hold-reverse', 'hold-forward', 'hold-reverse', 'hold-forward', 'forward'])
  f.cleanup()
})

test('mapped J/L taps retain the shared fast and slow speed ladders', () => {
  const f = fixture()
  for (let index = 0; index < 5; index++) f.key('keydown', 'l')
  for (let index = 0; index < 5; index++) f.key('keydown', 'J', { shiftKey: true })
  let state = { isPlaying: false, playbackRate: 1 }
  const rates = f.actions.map((action) => {
    const direction = action.endsWith('reverse') ? 'reverse' : 'forward'
    state = { isPlaying: true, playbackRate: nextShuttleRate(state, direction, action.startsWith('slow-')) }
    return state.playbackRate
  })
  assert.deepEqual(rates, [1, 2, 4, 8, 8, -0.5, -0.25, -0.125, -0.125, -0.125])
  f.cleanup()
})

test('all form controls, editable content, summaries, and guarded role ancestors keep their keys', () => {
  const f = fixture()
  const controls = [element('TEXTAREA'), element('SELECT'), element('SUMMARY'),
    element('SPAN', {}, element('SUMMARY')), element('DIV', { contenteditable: '' }),
    element('SPAN', {}, element('DIV', { contenteditable: 'plaintext-only' }))]
  for (const type of ['text', 'number', 'range', 'checkbox', 'radio', 'button', 'submit', 'search']) controls.push(element('INPUT', { type }))
  for (const role of ['textbox', 'combobox', 'spinbutton', 'slider', 'separator', 'menu', 'menuitem', 'listbox']) {
    controls.push(element('SPAN', {}, element('DIV', { role })))
  }
  const inheritedEditable = element('DIV'); inheritedEditable.isContentEditable = true
  controls.push(inheritedEditable)
  for (const control of controls) {
    f.doc.activeElement = control
    for (const name of [' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'j', 'k', 'l']) {
      assert.equal(f.key('keydown', name).defaultPrevented, false, `${control.tagName} keeps ${name}`)
      f.key('keyup', name)
    }
  }
  assert.deepEqual(f.actions, [])
  f.cleanup()
})

test('both focused and event-target controls are guarded, including composed-path ancestors', () => {
  const f = fixture(), control = element('INPUT', { type: 'range' })
  f.doc.activeElement = control
  assert.equal(f.key('keydown', ' ', { target: f.body }).defaultPrevented, false)
  f.doc.activeElement = f.body
  assert.equal(f.key('keydown', 'Enter', { target: control }).defaultPrevented, false)
  const host = element('DIV', { role: 'menu' })
  assert.equal(f.key('keydown', 'l', { composedPath: () => [f.body, host, f.doc, f.win] }).defaultPrevented, false)
  assert.deepEqual(f.actions, [])
  f.cleanup()
})

test('only the exact focused marked overview range passes playback keys through', () => {
  const f = fixture(), scrubber = element('INPUT', { type: 'range', 'data-review-transport': 'true' })
  f.doc.activeElement = scrubber
  f.key('keydown', ' '); f.key('keyup', ' ')
  f.key('keydown', 'Enter')
  f.key('keydown', 'j'); f.key('keydown', 'L', { shiftKey: true })
  f.key('keydown', 'k'); f.key('keydown', 'l'); f.key('keyup', 'k')
  assert.deepEqual(f.actions, ['toggle', 'toggle', 'reverse', 'slow-forward', 'pause', 'hold-forward'])
  f.actions.length = 0
  for (const name of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']) {
    assert.equal(f.key('keydown', name).defaultPrevented, false)
  }
  assert.equal(f.key('keydown', 'K', { shiftKey: true }).defaultPrevented, false)
  f.key('keyup', 'K', { shiftKey: true })
  f.key('keydown', ' ', { target: f.body }); f.key('keyup', ' ', { target: f.body })
  f.doc.activeElement = f.body
  f.key('keydown', ' ', { target: scrubber }); f.key('keyup', ' ', { target: scrubber })
  for (const invalid of [element('INPUT', { type: 'range' }), element('INPUT', { type: 'text', 'data-review-transport': 'true' }),
    element('INPUT', { type: 'range', 'data-review-transport': 'false' })]) {
    f.doc.activeElement = invalid
    f.key('keydown', ' '); f.key('keyup', ' ')
  }
  assert.deepEqual(f.actions, [])
  f.cleanup()
})

test('marked scrubber exception cannot bypass a guarded ancestor', () => {
  const f = fixture()
  f.doc.activeElement = element('INPUT', { type: 'range', 'data-review-transport': 'true' }, element('DIV', { role: 'menu' }))
  f.key('keydown', ' '); f.key('keyup', ' '); f.key('keydown', 'l')
  assert.deepEqual(f.actions, [])
  f.cleanup()
})

test('prevented, composing, modifier, and Shift+K events never dispatch actions', () => {
  const f = fixture()
  for (const extra of [{ defaultPrevented: true }, { isComposing: true }, { keyCode: 229 },
    { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    for (const name of [' ', 'Enter', 'ArrowLeft', 'Home', 'j', 'k', 'l']) {
      f.key('keydown', name, extra); f.key('keyup', name, extra)
    }
  }
  for (const name of [' ', 'Enter', 'ArrowLeft', 'Home', 'K']) {
    f.key('keydown', name, { shiftKey: true }); f.key('keyup', name, { shiftKey: true })
  }
  assert.deepEqual(f.actions, [])
  f.key('keydown', 'l')
  assert.deepEqual(f.actions, ['forward'], 'Shift+K did not establish a held-K chord')
  f.cleanup()
})

test('visibility, session, and visible modal guards prevent transport without stealing keys', () => {
  const f = fixture()
  const assertBlocked = () => {
    for (const name of [' ', 'Enter', 'ArrowRight', 'End', 'j', 'k', 'l']) {
      assert.equal(f.key('keydown', name).defaultPrevented, false)
      f.key('keyup', name)
    }
  }
  f.enable(false); assertBlocked(); f.enable(true)
  f.doc.hidden = true; assertBlocked(); f.doc.hidden = false
  f.doc.visibilityState = 'hidden'; assertBlocked(); f.doc.visibilityState = 'visible'
  for (const attributes of [{ 'aria-modal': 'true' }, { role: 'dialog' }, { class: 'fixed inset-0' }]) {
    const modal = element('DIV', attributes)
    f.doc.modals = [modal]
    assertBlocked()
    for (const hidden of ['noRect', 'visibility', 'display']) {
      modal.noRect = hidden === 'noRect'
      modal.style.visibility = hidden === 'visibility' ? 'hidden' : 'visible'
      modal.style.display = hidden === 'display' ? 'none' : 'block'
      f.key('keydown', 'Enter')
      assert.deepEqual(f.actions.splice(0), ['toggle'])
    }
  }
  assert.deepEqual(f.actions, [])
  f.cleanup()
})

test('blur, visibility, focus, pointer, mouse, and modifier-use events cancel pending Space and K', () => {
  for (const [target, name] of [['win', 'blur'], ['doc', 'visibilitychange'], ['doc', 'focusin'],
    ['doc', 'pointerdown'], ['doc', 'mousedown'], ['win', 'comfystudio-space-modifier-used']]) {
    const f = fixture()
    f.key('keydown', ' ')
    f[target].dispatch(name)
    f.key('keyup', ' ')
    assert.deepEqual(f.actions, [], name)
    f.key('keydown', 'k')
    f[target].dispatch(name)
    f.key('keydown', 'l')
    assert.deepEqual(f.actions, ['pause', 'forward'], `${name} clears K`)
    f.cleanup()
  }
})

test('prevented/composing releases clear pending Space and K before returning', () => {
  for (const extra of [{ defaultPrevented: true }, { isComposing: true }, { keyCode: 229 }, { ctrlKey: true }]) {
    const f = fixture()
    f.key('keydown', ' '); f.key('keyup', ' ', extra); f.key('keyup', ' ')
    assert.deepEqual(f.actions, [])
    f.key('keydown', 'k'); f.key('keyup', 'k', extra); f.key('keydown', 'l')
    assert.deepEqual(f.actions, ['pause', 'forward'])
    f.cleanup()
  }
})

test('a gate, focus, or modal change before release cannot leave an armed toggle', () => {
  for (const change of ['gate', 'focus', 'modal']) {
    const f = fixture()
    f.key('keydown', ' ')
    if (change === 'gate') f.enable(false)
    if (change === 'focus') f.doc.activeElement = element('INPUT', { type: 'text' })
    if (change === 'modal') f.doc.modals = [element('DIV', { role: 'dialog' })]
    f.key('keyup', ' ')
    f.enable(true); f.doc.activeElement = f.body; f.doc.modals = []
    f.key('keyup', ' ')
    assert.deepEqual(f.actions, [], change)
    f.cleanup()
  }
})

test('bare Shift cannot preserve a held-K chord across a blocked review session', () => {
  const f = fixture()
  f.key('keydown', 'k')
  f.enable(false)
  f.key('keydown', 'Shift', { shiftKey: true })
  f.enable(true)
  f.key('keydown', 'L', { shiftKey: true })
  assert.deepEqual(f.actions, ['pause', 'slow-forward'])
  f.cleanup()
})

test('cleanup removes every listener, clears pending work, and is idempotent', () => {
  const f = fixture()
  assert.ok(f.win.count() > 0 && f.doc.count() > 0)
  f.key('keydown', ' ')
  f.cleanup(); f.cleanup()
  assert.equal(f.win.count(), 0)
  assert.equal(f.doc.count(), 0)
  f.key('keyup', ' '); f.key('keydown', 'Enter'); f.key('keydown', 'l')
  assert.deepEqual(f.actions, [])
  assert.doesNotThrow(() => attachReviewTransportKeyboard()())
})
