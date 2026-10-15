import test from 'node:test'
import assert from 'node:assert/strict'
import { getTrimPreviewSeekTime } from './trimPreviewSeeking.mjs'
import { doesPresentedVideoFrameMatchTarget, getTargetVideoFrameIndex } from './previewVideoSeeking.js'

test('reverse exclusive-tail target seeks safely inside frame 39 without changing its requested frame', () => {
  const target = 3.999999
  const seek = getTrimPreviewSeekTime(target, 10, 6)
  assert.ok(Math.abs(seek - 3.925) < 1e-12)
  assert.equal(getTargetVideoFrameIndex(seek, 10), 39)
  assert.equal(doesPresentedVideoFrameMatchTarget({ mediaTime: 3.9, targetTime: target, fps: 10 }), true)
  assert.equal(doesPresentedVideoFrameMatchTarget({ mediaTime: 4, targetTime: target, fps: 10 }), false)
})

test('exact boundaries, frame zero and same-frame targets share a stable interior destination', () => {
  assert.equal(getTrimPreviewSeekTime(0, 10, 6), 0.025)
  assert.equal(getTrimPreviewSeekTime(0.099999, 10, 6), 0.025)
  assert.equal(getTrimPreviewSeekTime(1.1, 10, 6), getTrimPreviewSeekTime(1.199999, 10, 6))
  assert.equal(getTargetVideoFrameIndex(getTrimPreviewSeekTime(4, 10, 6), 10), 40)
})

test('fractional source and Optical Flow frame rates retain every requested frame index', () => {
  for (const fps of [10, 24, 30000 / 1001, 48, 60000 / 1001, 120]) {
    for (let frame = 0; frame < 120; frame++) {
      for (const phase of [0, 0.1, 0.9, 0.99999]) {
        const target = (frame + phase) / fps
        const seek = getTrimPreviewSeekTime(target, fps, 121 / fps)
        assert.ok(seek > frame / fps && seek < (frame + 1) / fps)
        assert.equal(getTargetVideoFrameIndex(seek, fps), getTargetVideoFrameIndex(target, fps))
      }
    }
  }
})

test('final partial frame stays strictly within decoded duration', () => {
  const duration = 3.92
  const seek = getTrimPreviewSeekTime(duration - 0.000001, 10, duration)
  assert.ok(seek > 3.9 && seek < duration)
  assert.equal(getTargetVideoFrameIndex(seek, 10), 39)
  assert.equal(getTrimPreviewSeekTime(duration, 10, duration), null)
  assert.equal(getTrimPreviewSeekTime(duration + 0.000001, 10, duration), null)
})

test('invalid or unavailable timing fails closed rather than seeking a different frame', () => {
  for (const args of [[-1, 10, 6], [NaN, 10, 6], [Infinity, 10, 6], [1, 0, 6], [1, NaN, 6],
    [1, Infinity, 6], [1, 10, 0], [1, 10, NaN], [1, 10, Infinity], [6, 10, 6], [7, 10, 6]]) {
    assert.equal(getTrimPreviewSeekTime(...args), null)
  }
})
