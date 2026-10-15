import assert from 'node:assert/strict'
import test from 'node:test'
import { anchoredKeyframeScroll, keyframeZoomBounds } from './keyframeViewport.js'

test('fit fills the usable lane width and maximum separates single-frame keys', () => {
  const bounds = keyframeZoomBounds(10, 800, 24)
  assert.equal(bounds.min, 80)
  assert.equal(bounds.max / 24, 24)
})
test('extreme durations have bounded lanes and valid zoom ranges', () => {
  for (const duration of [0, 0.001, 1, 120, 7200, 86400]) {
    const { min, max } = keyframeZoomBounds(duration, 800, 60)
    assert.ok(Number.isFinite(min) && min > 0 && max >= min)
    assert.ok(max * Math.max(0.001, duration) <= 250000 + 0.001)
  }
})
test('zoom preserves time under the mouse or toolbar anchor', () => {
  const args = { scrollLeft: 300, anchorX: 200, oldScale: 100, newScale: 200, duration: 30, viewportWidth: 800 }
  const scrollLeft = anchoredKeyframeScroll(args)
  assert.equal(scrollLeft, 800)
  assert.equal((args.scrollLeft + args.anchorX) / args.oldScale, (scrollLeft + args.anchorX) / args.newScale)
  assert.equal(anchoredKeyframeScroll({ ...args, scrollLeft, oldScale: 200, newScale: 100 }), 300)
})
test('fit and edge anchors clamp to the scrollable clip', () => {
  const args = { scrollLeft: 900, anchorX: 800, oldScale: 200, newScale: 80, duration: 10, viewportWidth: 800 }
  assert.equal(anchoredKeyframeScroll(args), 0)
  assert.equal(anchoredKeyframeScroll({ ...args, newScale: 100 }), 50)
  assert.equal(anchoredKeyframeScroll({ ...args, scrollLeft: 5000, newScale: 100 }), 200)
})
