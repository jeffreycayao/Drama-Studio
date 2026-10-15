import test from 'node:test'
import assert from 'node:assert/strict'
import { landPlaybackJumpVideo } from './playbackJumpVideo.mjs'
import { getVideoFrameSeekTime } from './previewVideoSeeking.js'

class Video {
  constructor({ time = 0, readyState = 4, callbacks = true } = {}) {
    this._time = time; this.readyState = readyState; this.seeking = false; this.paused = false
    this.videoWidth = 96; this.videoHeight = 54; this.duration = 8; this.src = 'blob:source'; this.error = null
    this.writes = []; this.events = new Map(); this.callbacks = new Map(); this.nextId = 0
    if (!callbacks) this.requestVideoFrameCallback = undefined
  }
  get currentTime() { return this._time }
  set currentTime(time) { this._time = time; this.writes.push(time); this.readyState = 1; this.seeking = true }
  pause() { this.paused = true }
  addEventListener(event, fn) { if (!this.events.has(event)) this.events.set(event, new Set()); this.events.get(event).add(fn) }
  removeEventListener(event, fn) { this.events.get(event)?.delete(fn) }
  emit(event) { for (const fn of [...(this.events.get(event) || [])]) fn() }
  requestVideoFrameCallback(fn) { const id = ++this.nextId; this.callbacks.set(id, fn); return id }
  cancelVideoFrameCallback(id) { this.callbacks.delete(id) }
  frame(mediaTime) { const callbacks = [...this.callbacks.values()]; this.callbacks.clear(); callbacks.forEach(fn => fn(0, { mediaTime })) }
  settle() { this.readyState = 4; this.seeking = false; this.emit('seeked') }
}
function setup(video, targetTime = 2, fps = 24) {
  const tasks = [], ready = [], errors = []
  const landing = landPlaybackJumpVideo(video, { targetTime, fps, scheduleTask: fn => tasks.push(fn),
    onReady: () => ready.push(true), onError: message => errors.push(message) })
  return { landing, ready, errors, flush() { while (tasks.length) tasks.shift()() } }
}
test('jump pauses and requests one stable interior frame, requiring decoded PTS and seek completion', () => {
  const video = new Video(), t = setup(video)
  assert.equal(video.paused, true)
  assert.deepEqual(video.writes, [getVideoFrameSeekTime(2, 24, 8)])
  video.frame(2); t.flush(); assert.equal(t.landing.isReady(), false)
  video.settle(); t.flush(); assert.equal(t.landing.isReady(), true); assert.equal(t.ready.length, 1)
  for (let i = 0; i < 100; i++) assert.equal(t.landing.isReady(), true)
  assert.equal(video.writes.length, 1, 'render retries never restart the decoder')
})
test('stale presented frames cannot acknowledge a new destination', () => {
  const video = new Video(), t = setup(video)
  video.settle(); video.frame(1); t.flush(); assert.equal(t.ready.length, 0)
  video.frame(2); t.flush(); assert.equal(t.ready.length, 1)
})
test('metadata-only source starts after metadata with the same frozen target', () => {
  const video = new Video({ readyState: 0 }), t = setup(video)
  video.emit('emptied'); video.emit('error'); t.flush()
  assert.deepEqual(t.errors, [], 'queued events from initial load do not fail the new source')
  assert.deepEqual(video.writes, [])
  video.readyState = 1; video.emit('loadedmetadata'); video.emit('loadedmetadata')
  assert.equal(video.writes.length, 1)
  video.settle(); video.frame(2); t.flush(); assert.equal(t.landing.isReady(), true)
})
test('emptying an owned seek or replacing a cold source fails the matching request', () => {
  for (const cold of [false, true]) {
    const video = new Video({ readyState: cold ? 0 : 4 }), t = setup(video)
    if (cold) video.src = 'blob:replacement'
    video.emit('emptied'); t.flush()
    assert.equal(t.errors.length, 1); assert.equal(t.ready.length, 0)
  }
})
test('newest jump retires callbacks and queued notifications from the old request', () => {
  const video = new Video(), first = setup(video), oldCallback = [...video.callbacks.values()][0]
  first.landing.cancel()
  const next = setup(video, 3)
  oldCallback(0, { mediaTime: 2 }); first.flush(); assert.equal(first.ready.length, 0)
  video.settle(); video.frame(3); next.landing.cancel(); next.flush(); assert.equal(next.ready.length, 0)
  assert.equal(video.callbacks.size, 0)
})
test('media errors fail once and never acknowledge playback', () => {
  const video = new Video(), t = setup(video)
  video.error = { code: 3 }; video.emit('error'); video.emit('error'); t.flush()
  assert.equal(t.errors.length, 1); assert.equal(t.ready.length, 0)
  assert.equal(video.callbacks.size, 0)
})
test('source replacement and foreign seeks invalidate ready ownership', () => {
  const video = new Video(), t = setup(video)
  video.settle(); video.frame(2); t.flush(); assert.equal(t.landing.isReady(), true)
  video.currentTime = 3; assert.equal(t.landing.isReady(), false)
  video.src = 'blob:other'; assert.equal(t.landing.isReady(), false)
})
test('without presentation callbacks, the owned seeked event is the compatibility barrier', () => {
  const video = new Video({ callbacks: false }), t = setup(video)
  assert.equal(t.landing.isReady(), false)
  video.settle(); t.flush(); assert.equal(t.landing.isReady(), true)
})
test('cold frame zero and already settled interior frame avoid no-op seeks', () => {
  for (const [time, target] of [[0, 0], [getVideoFrameSeekTime(2, 24, 8), 2]]) {
    const video = new Video({ time }), t = setup(video, target)
    t.flush(); assert.equal(t.landing.isReady(), true); assert.deepEqual(video.writes, [])
  }
})
test('fractional rate and double-truncated timestamps retain encoded frame ownership', () => {
  const video = new Video(), t = setup(video, 19 / 24, 24)
  video._time = Math.trunc(Math.trunc(video.currentTime * 1e6) / 1e6 * 1e6) / 1e6
  video.settle(); video.frame(19 / 24); t.flush(); assert.equal(t.landing.isReady(), true)
})
test('invalid targets report a cancelable failure without touching the decoder', () => {
  const video = new Video(), t = setup(video, NaN)
  t.flush(); assert.equal(t.errors.length, 1); assert.deepEqual(video.writes, [])
})
