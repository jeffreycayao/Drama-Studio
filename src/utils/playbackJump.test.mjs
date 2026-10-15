import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlaybackJump, getCurrentPlaybackJump, PLAYBACK_JUMP_TIMEOUT_MS } from './playbackJump.mjs'

const state = (patch = {}) => ({ isPlaying: true, playheadPosition: 4, playbackRate: 1,
  timelineFps: 24, timelineSessionId: 2, compoundEditContext: null, ...patch })
const pending = (patch = {}) => {
  const value = state(patch)
  return { ...value, playbackJump: createPlaybackJump(value, value.playheadPosition, 7, 1000) }
}

test('request is transient data and ownership returns the original current request', () => {
  const value = pending()
  assert.equal(getCurrentPlaybackJump(value), value.playbackJump)
  assert.equal(value.playbackJump.token, '2:7')
  assert.equal(PLAYBACK_JUMP_TIMEOUT_MS, 5000)
  assert.equal(getCurrentPlaybackJump({ ...value, unrelatedUi: true }), value.playbackJump)
})

test('pause, navigation, source context, FPS and rate changes invalidate old handoffs', () => {
  const value = pending()
  for (const patch of [{ isPlaying: false }, { playheadPosition: 4.1 }, { timelineSessionId: 3 },
    { compoundEditContext: {} }, { timelineFps: 25 }, { playbackRate: -1 }, { playbackRate: 0.5 }]) {
    assert.equal(getCurrentPlaybackJump({ ...value, ...patch }), null, JSON.stringify(patch))
  }
  const compound = {}
  const child = pending({ compoundEditContext: compound })
  assert.equal(getCurrentPlaybackJump(child), child.playbackJump)
  assert.equal(getCurrentPlaybackJump({ ...child, compoundEditContext: {} }), null)
})

test('separate revision/session tokens distinguish repeated targets', () => {
  const first = pending()
  const later = createPlaybackJump(first, 4, 8, 1200)
  const otherSession = createPlaybackJump({ ...first, timelineSessionId: 3 }, 4, 7, 1200)
  assert.notEqual(later.token, first.playbackJump.token)
  assert.notEqual(otherSession.token, first.playbackJump.token)
})

test('malformed and absent requests never hold playback', () => {
  const value = pending()
  assert.equal(getCurrentPlaybackJump(), null)
  assert.equal(getCurrentPlaybackJump(state()), null)
  for (const patch of [{ token: null }, { targetTime: NaN }, { targetTime: Infinity }, { requestedAt: undefined }]) {
    assert.equal(getCurrentPlaybackJump({ ...value, playbackJump: { ...value.playbackJump, ...patch } }), null)
  }
})
