import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveTimelineSelectionViewport } from './timelineSelectionViewport.mjs'

const clip = (id, startTime, duration, extra = {}) => ({ id, startTime, duration, ...extra })
const resolve = patch => resolveTimelineSelectionViewport({ clips: [clip('selected', 10, 10)], selectedClipIds: ['selected'], viewportWidth: 1000, ...patch })
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`)

test('fits a selected range with symmetric 10% viewport margins and the existing zoom/5 pixel scale', () => {
  const result = resolve()
  assert.deepEqual(result, { zoom: 400, scrollLeft: 700, startTime: 10, endTime: 20 })
  const pps = result.zoom / 5
  near(result.startTime * pps - result.scrollLeft, 100)
  near(1000 - (result.endTime * pps - result.scrollLeft), 100)
})

test('fits the complete selected union including gaps, independent of order, track, visibility or media type', () => {
  const clips = [clip('b', 40, 5, { type: 'audio', trackId: 'audio', muted: true }),
    clip('unselected', 0, 10000), clip('a', 10, 2, { type: 'compound', locked: true }),
    clip('c', 25, 4, { type: 'image', visible: false, sourceDuration: Infinity })]
  const result = resolve({ clips, selectedClipIds: ['c', 'b', 'a'] })
  assert.equal(result.startTime, 10); assert.equal(result.endTime, 45)
  near(result.zoom, 4000 / 35)
  assert.deepEqual(resolve({ clips: [...clips].reverse(), selectedClipIds: ['a', 'b', 'c'] }), result)
})

test('timeline zero clamps scroll without moving the selected extent or inventing negative time', () => {
  const result = resolve({ clips: [clip('selected', 0, 10)] })
  assert.deepEqual(result, { zoom: 400, scrollLeft: 0, startTime: 0, endTime: 10 })
  const nearStart = resolve({ clips: [clip('selected', .01, 10)] })
  assert.equal(nearStart.scrollLeft, 0)
  assert.equal(Object.is(result.scrollLeft, -0), false)
})

test('late timeline clips are centered using their actual offset, not the timeline origin', () => {
  const result = resolve({ clips: [clip('selected', 36000, 10)] })
  assert.equal(result.zoom, 400)
  near(result.scrollLeft, 36005 * 80 - 500)
  near(result.startTime * (result.zoom / 5) - result.scrollLeft, 100)
})

test('zero and extremely short durations use maximum zoom without division by zero or frame rounding', () => {
  const point = resolve({ clips: [clip('selected', 10, 0)] })
  assert.deepEqual(point, { zoom: 2000, scrollLeft: 3500, startTime: 10, endTime: 10 })
  const zero = resolve({ clips: [clip('selected', 0, 0)] })
  assert.deepEqual(zero, { zoom: 2000, scrollLeft: 0, startTime: 0, endTime: 0 })
  const tiny = resolve({ clips: [clip('selected', 0, Number.MIN_VALUE)] })
  assert.equal(tiny.zoom, 2000)
  assert.equal(tiny.endTime, Number.MIN_VALUE)
  const fractional = resolve({ clips: [clip('selected', 10.123456, .00001)] })
  assert.equal(fractional.zoom, 2000)
  assert.equal(fractional.startTime, 10.123456)
  assert.equal(fractional.endTime, 10.123456 + .00001)
})

test('large selection ranges use the minimum zoom as best effort within existing absolute limits', () => {
  const result = resolve({ clips: [clip('selected', 0, 1000000)] })
  assert.equal(result.zoom, .5)
  assert.equal(result.scrollLeft, 49500)
  assert.equal(result.endTime, 1000000)
})

test('optional zoom bounds narrow the fit but never exceed the existing absolute 0.5..2000 range', () => {
  assert.equal(resolve({ minZoom: 500 }).zoom, 500)
  assert.equal(resolve({ maxZoom: 200 }).zoom, 200)
  assert.equal(resolve({ minZoom: .001, maxZoom: 9000, clips: [clip('selected', 0, 1000000)] }).zoom, .5)
  assert.equal(resolve({ minZoom: .001, maxZoom: 9000, clips: [clip('selected', 10, 0)] }).zoom, 2000)
  assert.equal(resolve({ minZoom: 400, maxZoom: 400 }).zoom, 400)
  assert.equal(resolve({ minZoom: 500, maxZoom: 400 }), null)
})

test('stale IDs, duplicate selection entries, sparse clip arrays and invalid timing are handled without throwing', () => {
  const clips = [undefined, clip('selected', 10, 10), null, clip('invalid', NaN, 3)]
  assert.deepEqual(resolve({ clips, selectedClipIds: ['stale', 'selected', 'selected', '', null, 'invalid'] }), resolve())
  assert.equal(resolve({ selectedClipIds: ['missing'] }), null)
  assert.equal(resolve({ selectedClipIds: [] }), null)
  assert.equal(resolve({ clips: [] }), null)
  assert.equal(resolve({ clips: [clip('selected', 10, 10), clip('selected', 40, 3)] }), null)
})

test('malformed inputs and nonfinite or negative extents return null when no valid selected range remains', () => {
  for (const options of [null, undefined, true, 'view', [], {}]) assert.equal(resolveTimelineSelectionViewport(options), null)
  for (const viewportWidth of [undefined, null, 0, -1, NaN, Infinity, '1000']) assert.equal(resolve({ viewportWidth }), null)
  for (const selectedClipIds of [null, undefined, {}, 'selected']) assert.equal(resolve({ selectedClipIds }), null)
  for (const clips of [null, {}, 'clips']) assert.equal(resolve({ clips }), null)
  for (const [start, duration] of [[-1, 3], [NaN, 3], [Infinity, 3], ['10', 3], [10, -1], [10, NaN], [10, Infinity], [10, '3'], [10, undefined]]) {
    assert.equal(resolve({ clips: [clip('selected', start, duration)] }), null)
  }
  for (const key of ['minZoom', 'maxZoom']) for (const value of [0, -1, NaN, Infinity, '1', null]) assert.equal(resolve({ [key]: value }), null)
})

test('huge finite values that overflow endpoints or safe pixel coordinates refuse instead of returning unsafe scroll positions', () => {
  assert.equal(resolve({ clips: [clip('selected', Number.MAX_VALUE, Number.MAX_VALUE)] }), null)
  assert.equal(resolve({ clips: [clip('selected', 1e300, 1)] }), null)
  assert.equal(resolve({ clips: [clip('selected', 0, Number.MAX_VALUE)] }), null)
  assert.equal(resolve({ viewportWidth: Number.MAX_VALUE }), null)
  const largeButSafe = resolve({ clips: [clip('selected', 1e9, 10)] })
  assert.ok(largeButSafe)
  assert.ok(Number.isFinite(largeButSafe.scrollLeft))
  near(largeButSafe.startTime * (largeButSafe.zoom / 5) - largeButSafe.scrollLeft, 100)
})

test('FPS is irrelevant and repeated calls on frozen input are deterministic and nonmutating', () => {
  const options = { clips: [clip('selected', 10.123, 8.987, { fps: 24, keyframes: { opacity: [{ time: .2, value: 1 }] } })],
    selectedClipIds: ['selected'], viewportWidth: 937 }
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
  freeze(options)
  const before = structuredClone(options), result = resolveTimelineSelectionViewport(options)
  assert.deepEqual(resolveTimelineSelectionViewport(options), result)
  assert.deepEqual(resolveTimelineSelectionViewport({ ...options, fps: 30000 / 1001 }), result)
  assert.deepEqual(options, before)
  assert.equal(result.startTime, 10.123)
  assert.equal(result.endTime, 10.123 + 8.987)
})
