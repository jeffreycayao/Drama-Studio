import assert from 'node:assert/strict'
import test from 'node:test'
import { getClipChainFrameTime, canChainFromClip } from './frameChaining.mjs'

test('last visible frame is the final whole frame inside the clip', () => {
  assert.equal(getClipChainFrameTime({ startTime: 2, duration: 3 }, 24), (5 * 24 - 1) / 24)
  assert.equal(getClipChainFrameTime({ startTime: 2, duration: 3 }, 24, 'first'), 2)
  // Off-grid edges: never sample outside [start, end).
  const t = getClipChainFrameTime({ startTime: 1.01, duration: 0.5 }, 24)
  assert.ok(t >= 1.01 && t < 1.51)
  assert.equal(getClipChainFrameTime({ startTime: 1, duration: 1 / 24 }, 24), 1, 'one-frame clip')
  assert.equal(getClipChainFrameTime({ startTime: 0, duration: 0 }, 24), null)
})

test('only enabled picture clips on video tracks can chain', () => {
  assert.equal(canChainFromClip({ type: 'video' }, { type: 'video' }), true)
  assert.equal(canChainFromClip({ type: 'audio' }, { type: 'audio' }), false)
  assert.equal(canChainFromClip({ type: 'video', enabled: false }, { type: 'video' }), false)
  assert.equal(canChainFromClip({ type: 'image' }, { type: 'video', role: 'captions' }), false)
})
