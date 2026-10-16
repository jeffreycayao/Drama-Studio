import assert from 'node:assert/strict'
import test from 'node:test'
import { TRANSITION_CATEGORIES, TRANSITION_TYPES } from '../constants/transitions.js'
import { applyTransitionClip, getTransitionCanvasStyle } from './transitionStyles.js'

const NEW_TYPES = ['iris-open', 'iris-close', 'diamond', 'clock-wipe', 'barn-door-h', 'barn-door-v', 'box-in',
  'diagonal-tl', 'diagonal-tr', 'blinds-h', 'blinds-v', 'cover-left', 'cover-right', 'cover-up', 'cover-down']

const info = (type, progress, extra = {}) => ({ transition: { type, kind: 'between', ...extra }, progress, clipA: { id: 'a' }, clipB: { id: 'b' } })

/** Records path calls like a 2D context. */
function recorder() {
  const calls = []
  const ctx = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args.map(v => (typeof v === 'number' ? Math.round(v * 10) / 10 : v))]) })
  return { ctx, calls }
}

test('every transition is listed in a category and has unique ids', () => {
  const ids = TRANSITION_TYPES.map(item => item.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.equal(ids.length, 34)
  assert.deepEqual([...ids].sort(), TRANSITION_CATEGORIES.flatMap(category => category.items).sort())
  for (const type of NEW_TYPES) assert.ok(ids.includes(type), type)
})

test('reveal transitions leave the outgoing clip untouched and reveal the incoming one', () => {
  for (const type of NEW_TYPES) {
    const outgoing = getTransitionCanvasStyle(info(type, 0.5), true)
    assert.deepEqual([outgoing.opacity, outgoing.translateX, outgoing.scale, outgoing.clipInset ?? null, outgoing.clipShape ?? null, outgoing.display],
      [1, 0, 1, null, null, true], type)
    const done = getTransitionCanvasStyle(info(type, 1), false)
    assert.equal(done.display, true, type)
    assert.equal(done.opacity, 1, type)
  }
  // At progress 1 the incoming clip covers the frame.
  assert.equal(getTransitionCanvasStyle(info('cover-left', 1), false).translateX, 0)
  assert.equal(getTransitionCanvasStyle(info('cover-left', 0), false).translateX, 1)
  assert.deepEqual(getTransitionCanvasStyle(info('box-in', 1), false).clipInset, { top: 0, right: 0, bottom: 0, left: 0 })
  assert.equal(getTransitionCanvasStyle(info('iris-open', 1), false).clipShape.radius, 1)
  assert.equal(getTransitionCanvasStyle(info('iris-close', 1), false).clipShape.radius, 0)
  assert.equal(getTransitionCanvasStyle(info('blinds-h', 0.5), false).clipShape.rects.length, 8)
  assert.equal(getTransitionCanvasStyle(info('blinds-h', 0.5, { settings: { slats: 4 } }), false).clipShape.rects.length, 4)
  assert.equal(getTransitionCanvasStyle(info('clock-wipe', 0), false).display, false)
})

test('on a lone clip edge the reveal runs in on the way in and out on the way out', () => {
  const edge = (progress, side) => getTransitionCanvasStyle({ transition: { type: 'iris-open', kind: 'edge' }, progress, edge: side, clip: { id: 'a' } }, side === 'out')
  assert.equal(edge(0.25, 'in').clipShape.radius < edge(0.75, 'in').clipShape.radius, true)
  assert.equal(edge(0.25, 'out').clipShape.radius > edge(0.75, 'out').clipShape.radius, true)
})

test('clip shapes become canvas paths (circle, polygon, rects, inverted with evenodd)', () => {
  const rect = { width: 100, height: 50 }
  const circle = recorder()
  applyTransitionClip(circle.ctx, rect, getTransitionCanvasStyle(info('iris-open', 1), false))
  assert.deepEqual(circle.calls.find(call => call[0] === 'arc').slice(1, 4), [50, 25, 55.9])
  assert.deepEqual(circle.calls.at(-1), ['clip', 'nonzero'])

  const inverted = recorder()
  applyTransitionClip(inverted.ctx, rect, getTransitionCanvasStyle(info('iris-close', 0.5), false))
  assert.deepEqual(inverted.calls[1], ['rect', -100, -50, 300, 150])
  assert.deepEqual(inverted.calls.at(-1), ['clip', 'evenodd'])

  const diamond = recorder()
  applyTransitionClip(diamond.ctx, rect, getTransitionCanvasStyle(info('diamond', 0.5), false))
  assert.deepEqual(diamond.calls.filter(call => call[0] === 'moveTo' || call[0] === 'lineTo').map(call => call.slice(1)), [[50, 0], [100, 25], [50, 50], [0, 25]])

  const blinds = recorder()
  applyTransitionClip(blinds.ctx, rect, getTransitionCanvasStyle(info('blinds-v', 1, { settings: { slats: 2 } }), false))
  assert.deepEqual(blinds.calls.filter(call => call[0] === 'rect').map(call => call.slice(1)), [[0, 0, 50, 50], [50, 0, 50, 50]])

  const barn = recorder()
  applyTransitionClip(barn.ctx, rect, getTransitionCanvasStyle(info('barn-door-h', 0.5), false))
  assert.deepEqual(barn.calls.filter(call => call[0] === 'rect')[0].slice(1), [25, 0, 50, 50])

  const none = recorder()
  applyTransitionClip(none.ctx, rect, getTransitionCanvasStyle(info('dissolve', 0.5), false))
  assert.deepEqual(none.calls, [])
})
