import assert from 'node:assert/strict'
import test from 'node:test'
import { getShuttleKeyAction, nextShuttleRate } from './shuttlePlayback.js'

for (const [direction, sign] of [['forward', 1], ['reverse', -1]]) {
  test(`${direction}: slow taps halve speed and hold at one eighth`, () => {
    let state = { isPlaying: false, playbackRate: 1 }
    const rates = []
    for (let i = 0; i < 5; i++) {
      state = { isPlaying: true, playbackRate: nextShuttleRate(state, direction, true) }
      rates.push(state.playbackRate)
    }
    assert.deepEqual(rates, [0.5, 0.25, 0.125, 0.125, 0.125].map(rate => rate * sign))
  })
  test(`${direction}: fast ladder is unchanged`, () => {
    let state = { isPlaying: false, playbackRate: 1 }
    const rates = []
    for (let i = 0; i < 5; i++) {
      state = { isPlaying: true, playbackRate: nextShuttleRate(state, direction) }
      rates.push(state.playbackRate)
    }
    assert.deepEqual(rates, [1, 2, 4, 8, 8].map(rate => rate * sign))
  })
  test(`${direction}: switching speed ladders and directions resets predictably`, () => {
    assert.equal(nextShuttleRate({ isPlaying: true, playbackRate: sign * 8 }, direction, true), sign * 0.5)
    assert.equal(nextShuttleRate({ isPlaying: true, playbackRate: sign * 0.125 }, direction), sign)
    assert.equal(nextShuttleRate({ isPlaying: true, playbackRate: -sign * 0.25 }, direction, true), sign * 0.5)
    assert.equal(nextShuttleRate({ isPlaying: false, playbackRate: sign * 0.25 }, direction, true), sign * 0.5)
  })
}

test('Shift J/L chooses the slow ladder; K chords retain fixed slow behavior', () => {
  assert.deepEqual(getShuttleKeyAction({ key: 'L', shiftKey: true }), { type: 'step-slow', direction: 'forward' })
  assert.deepEqual(getShuttleKeyAction({ key: 'J', shiftKey: true }), { type: 'step-slow', direction: 'reverse' })
  assert.deepEqual(getShuttleKeyAction({ key: 'l' }, true), { type: 'hold-slow', direction: 'forward' })
  assert.deepEqual(getShuttleKeyAction({ key: 'k' }), { type: 'pause' })
})

test('OS key repeat and Ctrl/Meta/Alt combinations never change shuttle rate', () => {
  for (const modifier of ['repeat', 'ctrlKey', 'metaKey', 'altKey']) {
    for (const key of ['j', 'k', 'L']) assert.equal(getShuttleKeyAction({ key, shiftKey: true, [modifier]: true }), null)
  }
  assert.equal(getShuttleKeyAction({ key: 'x' }), null)
})
