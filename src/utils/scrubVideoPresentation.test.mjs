import test from 'node:test'
import assert from 'node:assert/strict'
import { createScrubVideoPresentation } from './scrubVideoPresentation.mjs'
import { getVideoFrameSeekTime, getTargetVideoFrameIndex } from './previewVideoSeeking.js'

const seek = (time, fps = 24) => getVideoFrameSeekTime(time, fps)

class Video {
  constructor({ currentTime = 0, readyState = 4, callbacks = true } = {}) {
    this._time = currentTime; this.readyState = readyState; this.seeking = false
    this.videoWidth = 96; this.videoHeight = 54; this.error = null
    this.writes = []; this.listeners = new Map(); this.callbacks = new Map(); this.cancelled = []; this.nextId = 0
    if (!callbacks) this.requestVideoFrameCallback = undefined
  }
  get currentTime() { return this._time }
  set currentTime(time) { this._time = time; this.writes.push(time); this.readyState = 1; this.seeking = true }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(listener) }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener) }
  emit(type) { for (const listener of [...(this.listeners.get(type) || [])]) listener() }
  requestVideoFrameCallback(callback) { const id = ++this.nextId; this.callbacks.set(id, callback); return id }
  cancelVideoFrameCallback(id) { this.cancelled.push(id); this.callbacks.delete(id) }
  frame(mediaTime) { const callbacks = [...this.callbacks.values()]; this.callbacks.clear(); for (const callback of callbacks) callback(0, { mediaTime }) }
  complete(mediaTime = this.currentTime) { this.readyState = 4; this.seeking = false; this.emit('seeked'); this.frame(mediaTime) }
  listenerCount() { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0) }
}

function setup(options = {}) {
  const tasks = [], draws = []
  const controller = createScrubVideoPresentation({ scheduleTask: task => tasks.push(task), requestDraw: () => {
    draws.push(true); options.onDraw?.()
  } })
  const observe = (video, targetTime, patch = {}) => controller.observe(video, { sourceKey: 'source.mp4', targetTime, fps: 24, ...patch })
  const pass = (entries, painted = false) => {
    controller.beginPass()
    const results = entries.map(([video, time, patch]) => observe(video, time, patch))
    controller.endPass({ painted })
    return results
  }
  return { controller, observe, pass, draws, tasks, flush() { while (tasks.length) tasks.shift()() } }
}

test('a drawable picture is not retargeted until the final composite acknowledges paint', () => {
  const t = setup(), video = new Video()
  assert.equal(t.pass([[video, 1]], false)[0].ready, true)
  assert.deepEqual(video.writes, [])
  assert.equal(t.pass([[video, 2]], true)[0].ready, true)
  assert.deepEqual(video.writes, [seek(2)])
  assert.equal(t.controller.hasPending(), true)
  assert.equal(t.pass([[video, 3]], false)[0].ready, false)
  assert.deepEqual(video.writes, [seek(2)])
  video.complete(2); t.flush()
  assert.equal(t.draws.length, 1)
  assert.equal(t.pass([[video, 3]], false)[0].ready, true)
  assert.deepEqual(video.writes, [seek(2)], 'completion must be painted before the latest target starts')
  t.pass([[video, 3]], true)
  assert.deepEqual(video.writes, [seek(2), seek(3)])
})

test('continuous moving targets consume each decoded picture before starting their next seek', () => {
  const t = setup(), video = new Video(); let paints = 0
  for (let iteration = 1; iteration <= 20; iteration++) {
    const target = iteration / 4
    t.controller.beginPass()
    if (t.observe(video, target).ready) paints++
    t.controller.endPass({ painted: true })
    for (let burst = 0; burst < 15; burst++) t.pass([[video, target + (burst + 1) / 48]], false)
    assert.equal(video.writes.length, iteration)
    video.complete(getTargetVideoFrameIndex(video.currentTime, 24) / 24); t.flush()
  }
  assert.equal(paints, 20, 'each completed decode becomes a visible picture despite a newer desired target')
})

test('a decode longer than 400ms is never restarted by subsequent render passes', async () => {
  const t = setup(), video = new Video()
  t.pass([[video, 1]], true)
  const originalCallback = [...video.callbacks.values()][0]
  await new Promise(resolve => setTimeout(resolve, 430))
  for (let i = 0; i < 100; i++) t.pass([[video, 2 + i / 24]], false)
  assert.deepEqual(video.writes, [seek(1)]); assert.equal([...video.callbacks.values()][0], originalCallback)
  assert.equal(t.controller.hasPending(), true)
  video.complete(1); t.flush()
  assert.equal(t.pass([[video, 6]], false)[0].ready, true)
})

test('retired callbacks cannot complete or delete a newer source request', () => {
  const t = setup(), video = new Video()
  t.pass([[video, 1]], true)
  const old = [...video.callbacks.values()][0]
  t.pass([[video, 2, { sourceKey: 'replacement.mp4' }]], false)
  assert.deepEqual(video.writes, [seek(1), seek(2)])
  old(0, { mediaTime: 1 }); t.flush()
  assert.equal(t.draws.length, 0); assert.equal(t.controller.hasPending(), true)
  video.complete(2); t.flush()
  assert.equal(t.pass([[video, 2, { sourceKey: 'replacement.mp4' }]], true)[0].ready, true)
  assert.deepEqual(video.writes, [seek(1), seek(2)])
})

test('a pre-seek or wrong-PTS callback is not accepted as the new decoded frame', () => {
  const t = setup(), video = new Video()
  t.pass([[video, 2]], true)
  video.readyState = 4; video.seeking = false; video.emit('seeked')
  video.frame(0); t.flush()
  assert.equal(t.draws.length, 0); assert.equal(t.controller.hasPending(), true)
  assert.equal(video.callbacks.size, 1)
  assert.equal(t.pass([[video, 3]], false)[0].ready, false)
  video.frame(2); t.flush()
  assert.equal(t.draws.length, 1)
  assert.equal(t.pass([[video, 3]], false)[0].ready, true)
})

test('presentation before seeked is retained until the video becomes drawable', () => {
  const t = setup(), video = new Video()
  t.pass([[video, 2]], true)
  video.frame(2); t.flush()
  assert.equal(t.controller.hasPending(), true); assert.equal(t.draws.length, 0)
  video.readyState = 4; video.seeking = false; video.emit('seeked'); t.flush()
  assert.equal(t.draws.length, 1)
  assert.equal(t.pass([[video, 2]], true)[0].ready, true)
  assert.equal(video.listenerCount(), 0)
})

test('owned presentation remains pending across an idle timeout until its composite actually paints', () => {
  const t = setup(), video = new Video()
  t.pass([[video, 1]], true)
  video.complete(1); t.flush()
  assert.equal(t.controller.hasPending(), true, 'decoded but unpainted must not switch to a direct paused seek')
  assert.equal(t.pass([[video, 2]], false)[0].ready, true)
  assert.equal(t.controller.hasPending(), true)
  assert.deepEqual(video.writes, [seek(1)])
  t.pass([[video, 2]], true)
  assert.equal(t.controller.hasPending(), true, 'the newest target now owns an in-flight decode')
  video.complete(2); t.flush()
  t.pass([[video, 2]], true)
  assert.equal(t.controller.hasPending(), false, 'all requested pictures have now been painted')
})

test('without requestVideoFrameCallback, the owned seeked event is the compatibility completion', () => {
  const t = setup(), video = new Video({ callbacks: false })
  t.pass([[video, 2]], true)
  video.readyState = 4; video.seeking = false; video.emit('canplay'); t.flush()
  assert.equal(t.draws.length, 0); assert.equal(t.controller.hasPending(), true)
  video.emit('seeked'); t.flush()
  assert.equal(t.draws.length, 1); assert.equal(t.pass([[video, 2]], true)[0].ready, true)
})

test('same encoded confirmed frame needs no no-op seek, including fractional frame rates', () => {
  for (const fps of [24, 30, 24000 / 1001]) {
    const t = setup(), video = new Video({ currentTime: 10.1 / fps })
    assert.equal(t.pass([[video, 10.8 / fps, { fps }]], true)[0].ready, true)
    assert.deepEqual(video.writes, [])
    t.pass([[video, 20.1 / fps, { fps }]], true)
    video.complete(20 / fps); t.flush()
    assert.equal(t.pass([[video, 20.8 / fps, { fps }]], true)[0].ready, true)
    assert.deepEqual(video.writes, [seek(20.1 / fps, fps)])
  }
})

test('physical interior seeks survive microsecond truncation without changing the logical target frame', () => {
  for (const fps of [24, 30, 24000 / 1001]) for (const target of [19 / fps, 4 - .000001]) {
    const t = setup(), video = new Video()
    video.duration = 4
    Object.defineProperty(video, 'currentTime', { get() { return this._time }, set(time) {
      this._time = Math.floor(time * 1e6) / 1e6; this.writes.push(time); this.readyState = 1; this.seeking = true
    } })
    t.pass([[video, target, { fps }]], true)
    const frame = getTargetVideoFrameIndex(target, fps)
    assert.equal(getTargetVideoFrameIndex(video.currentTime, fps), frame)
    assert.equal(video.writes[0], getVideoFrameSeekTime(target, fps, video.duration))
    video.complete(frame / fps); t.flush()
    assert.equal(t.draws.length, 1)
    assert.equal(t.pass([[video, target, { fps }]], true)[0].ready, true)
    assert.equal(video.writes.length, 1)
    assert.equal(t.controller.hasPending(), false)
  }
})

test('double-truncated physical readback keeps ownership without weakening encoded-frame confirmation', () => {
  const t = setup(), video = new Video()
  Object.defineProperty(video, 'currentTime', { get() { return this._time }, set(time) {
    const first = Math.floor(time * 1e6) / 1e6
    this._time = Math.floor(first * 1e6) / 1e6
    this.writes.push(time); this.readyState = 1; this.seeking = true
  } })
  t.pass([[video, 4]], true)
  assert.equal(video.writes[0], 4.020833333333333)
  assert.equal(video.currentTime, 4.020832)
  assert.ok(Math.abs(video.currentTime - video.writes[0]) > 1e-6, 'reproduces the reported greater-than-1µs readback difference')
  assert.equal(getTargetVideoFrameIndex(video.currentTime, 24), 96)
  assert.equal(t.pass([[video, 5]], false)[0].ready, false)
  assert.equal(video.writes.length, 1, 'rounding cannot abandon or restart the owned decode')
  video.readyState = 4; video.seeking = false; video.emit('seeked')
  video.frame(95 / 24); t.flush()
  assert.equal(t.draws.length, 0, 'physical tolerance does not admit the preceding encoded picture')
  assert.equal(t.controller.hasPending(), true)
  video.frame(4); t.flush()
  assert.equal(t.draws.length, 1)
  assert.equal(t.pass([[video, 5]], false)[0].ready, true)
  assert.equal(video.writes.length, 1, 'the confirmed frame still waits for its visible composite')
  t.pass([[video, 5]], true)
  assert.deepEqual(video.writes, [seek(4), seek(5)])
})

test('a throwing presentation API falls back to the owned seeked event without abandoning the initial write', () => {
  const t = setup(), video = new Video()
  video.requestVideoFrameCallback = () => { throw new Error('Unavailable') }
  t.pass([[video, 1]], true)
  assert.deepEqual(video.writes, [seek(1)])
  video.complete(1); t.flush()
  assert.equal(t.draws.length, 1)
  assert.equal(t.pass([[video, 1]], true)[0].ready, true)
  assert.equal(video.listenerCount(), 0)
})

test('metadata-only media can begin its first decode before any drawable picture exists', () => {
  const t = setup(), video = new Video({ readyState: 1 })
  assert.equal(t.pass([[video, 2]], false)[0].ready, false)
  assert.deepEqual(video.writes, [seek(2)])
  video.complete(2); t.flush()
  assert.equal(t.pass([[video, 3]], false)[0].ready, true)
  assert.deepEqual(video.writes, [seek(2)])
})

test('multi-layer and matte passes hold completed pictures until the entire composite paints', () => {
  const t = setup(), picture = new Video(), matte = new Video()
  assert.ok(t.pass([[picture, 1], [matte, 2]], true).every(result => result.ready))
  assert.deepEqual(picture.writes, [seek(1)]); assert.deepEqual(matte.writes, [seek(2)])
  picture.complete(1); t.flush()
  const held = t.pass([[picture, 3], [matte, 4]], false)
  assert.equal(held[0].ready, true); assert.equal(held[1].ready, false)
  assert.deepEqual(picture.writes, [seek(1)], 'later unready matte must prevent picture retarget')
  matte.complete(2); t.flush()
  assert.ok(t.pass([[picture, 3], [matte, 4]], true).every(result => result.ready))
  assert.deepEqual(picture.writes, [seek(1), seek(3)]); assert.deepEqual(matte.writes, [seek(2), seek(4)])
})

test('cancelAll preempts decode and queued redraws for exact release, mode/session changes and unmount', () => {
  const t = setup(), video = new Video()
  t.pass([[video, 1]], true)
  const old = [...video.callbacks.values()][0]
  video.complete(1)
  assert.equal(t.tasks.length, 1)
  t.controller.cancelAll(); old(0, { mediaTime: 1 }); t.flush()
  assert.equal(t.draws.length, 0); assert.equal(t.controller.hasPending(), false)
  assert.equal(video.listenerCount(), 0); assert.equal(video.callbacks.size, 0)
  t.controller.endPass({ painted: true }); assert.deepEqual(video.writes, [seek(1)])
  t.pass([[video, 2]], true); video.complete(2); t.flush()
  assert.equal(t.draws.length, 1, 'a fresh gesture remains usable after cancellation')
})

test('inactive videos and per-video cancellation retire only their owned callbacks', () => {
  const t = setup(), first = new Video(), second = new Video()
  t.pass([[first, 1], [second, 2]], true)
  const old = [...first.callbacks.values()][0]
  t.pass([[second, 3]], false)
  assert.equal(first.callbacks.size, 0); assert.equal(first.listenerCount(), 0)
  old(0, { mediaTime: 1 }); t.flush(); assert.equal(t.draws.length, 0)
  assert.equal(t.controller.hasPending(), true)
  t.controller.cancel(second); assert.equal(t.controller.hasPending(), false)
  assert.equal(second.listenerCount(), 0)
})

test('external currentTime writes cannot falsely acknowledge or retire the replacement request', () => {
  const t = setup(), video = new Video()
  t.pass([[video, 1]], true)
  const old = [...video.callbacks.values()][0]
  video.currentTime = 8
  t.pass([[video, 2]], false)
  assert.deepEqual(video.writes, [seek(1), 8, seek(2)])
  old(0, { mediaTime: 1 }); t.flush()
  assert.equal(t.controller.hasPending(), true); assert.equal(t.draws.length, 0)
  video.complete(2); t.flush()
  assert.equal(t.pass([[video, 2]], true)[0].ready, true)
})

test('synchronous seeked completion schedules rather than recursively calling the renderer', () => {
  const t = setup(), video = new Video({ callbacks: false })
  Object.defineProperty(video, 'currentTime', { get() { return this._time }, set(time) {
    this._time = time; this.writes.push(time); this.readyState = 4; this.seeking = false; this.emit('seeked')
  } })
  t.pass([[video, 1]], true)
  assert.equal(t.draws.length, 0); assert.equal(t.tasks.length, 1)
  t.flush(); assert.equal(t.draws.length, 1)
  assert.equal(t.pass([[video, 2]], false)[0].ready, true)
  assert.deepEqual(video.writes, [seek(1)])
})

test('FPS/source replacement and invalid observations never reuse mismatched presentation ownership', () => {
  const t = setup(), video = new Video()
  t.pass([[video, 1]], true)
  const old = [...video.callbacks.values()][0]
  t.pass([[video, 2, { fps: 48 }]], false)
  old(0, { mediaTime: 1 }); t.flush()
  assert.equal(t.draws.length, 0)
  for (const patch of [{ sourceKey: '' }, { fps: 0 }, { fps: Infinity }, { targetTime: NaN }, { targetTime: -1 }]) {
    t.controller.beginPass()
    assert.equal(t.controller.observe(video, { sourceKey: 'source.mp4', fps: 24, targetTime: 2, ...patch }).ready, false)
    t.controller.endPass({ painted: false })
  }
  assert.equal(t.controller.hasPending(), false); assert.equal(video.listenerCount(), 0)
})
