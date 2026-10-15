import assert from 'node:assert/strict'
import test from 'node:test'
import { createTimelineScrubScheduler, resolveTimelineScrubSample } from './timelineScrubScheduler.mjs'

function setup(options = {}) {
  let nextId = 0, current = 0
  const frames = new Map(), samples = [], positions = []
  const scheduler = createTimelineScrubScheduler({
    requestFrame: callback => { frames.set(++nextId, callback); return nextId },
    cancelFrame: id => frames.delete(id),
    getCurrentPosition: () => current,
    forcePublish: options.forcePublish,
    readSample: (x, phase) => { samples.push({ x, phase }); return options.readSample?.(x, phase) ?? { time: Math.round(x) / 10 } },
    onPosition: (time, phase) => { current = time; positions.push({ time, phase }); options.onPosition?.(time, phase) },
  })
  return { scheduler, frames, samples, positions, externalPosition: value => { current = value },
    tick() { const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback()) } }
}

test('initial click is immediate and a burst publishes only its latest animation target', () => {
  const t = setup()
  t.scheduler.start(0)
  assert.deepEqual(t.positions, [{ time: 0, phase: 'initial' }])
  for (let x = 1; x <= 500; x++) t.scheduler.move(x)
  assert.equal(t.frames.size, 1)
  assert.equal(t.samples.length, 1)
  t.tick()
  assert.deepEqual(t.positions.at(-1), { time: 50, phase: 'update' })
  assert.equal(t.positions.length, 2)
})

test('same snapped target is skipped locally but a live transport change is not hidden', () => {
  const t = setup()
  t.scheduler.start(10)
  t.scheduler.move(10.1); t.tick()
  t.scheduler.move(10.2); t.tick()
  assert.equal(t.positions.length, 1)
  t.externalPosition(2)
  t.scheduler.move(10.3); t.tick()
  assert.deepEqual(t.positions.at(-1), { time: 1, phase: 'update' })
  assert.equal(t.positions.length, 2)
})

test('release flushes the actual final coordinate synchronously and consumes pending work', () => {
  const t = setup()
  t.scheduler.start(10)
  t.scheduler.move(20)
  t.scheduler.finish(35)
  assert.equal(t.frames.size, 0)
  assert.deepEqual(t.positions.at(-1), { time: 3.5, phase: 'release' })
  t.scheduler.move(40); t.scheduler.invalidate(); t.tick(); t.scheduler.finish(50)
  assert.equal(t.positions.length, 2)
})

test('release at an already published frame needs no duplicate store update', () => {
  const t = setup()
  t.scheduler.start(10)
  t.scheduler.finish(10.2)
  assert.equal(t.samples.at(-1).phase, 'release')
  assert.equal(t.positions.length, 1)
})

test('a precise release can force one same-frame publication without changing ordinary dedupe', () => {
  const t = setup({ forcePublish: (_, phase) => phase === 'release' })
  t.scheduler.start(10)
  t.scheduler.move(10.2); t.tick()
  t.scheduler.finish(10.1); t.scheduler.finish(10.1)
  assert.deepEqual(t.positions, [{ time: 1, phase: 'initial' }, { time: 1, phase: 'release' }])
})

test('release is single-use even when its publication synchronously tries to reenter', () => {
  const t = setup({ forcePublish: (_, phase) => phase === 'release', onPosition: (_, phase) => {
    if (phase !== 'release') return
    t.scheduler.finish(50); t.scheduler.move(60); t.scheduler.invalidate()
  } })
  t.scheduler.start(10)
  t.scheduler.finish(20)
  assert.deepEqual(t.positions, [{ time: 1, phase: 'initial' }, { time: 2, phase: 'release' }])
  assert.equal(t.frames.size, 0)
})

test('deferred handle start does not jump or publish until movement or release', () => {
  const t = setup()
  t.scheduler.start(20, { deferInitial: true, initialPosition: 0 })
  assert.equal(t.samples.length, 0)
  assert.equal(t.positions.length, 0)
  t.scheduler.move(30); t.tick()
  assert.equal(t.positions.at(-1).time, 3)
})

test('release before a gesture starts is a no-op', () => {
  const t = setup()
  t.scheduler.finish(50)
  assert.equal(t.positions.length, 0)
  assert.equal(t.samples.length, 0)
  t.scheduler.start(10)
  assert.equal(t.positions.length, 1)
})

test('stationary edge hold and pointer movement share one RAF and stop at the bound', () => {
  let remaining = 3
  const t = setup({ readSample: (x, phase) => ({ time: x + (3 - remaining), continue: phase === 'update' && --remaining > 0 }) })
  t.scheduler.start(10)
  t.scheduler.move(11); t.scheduler.move(12)
  t.tick()
  assert.equal(t.frames.size, 1)
  t.scheduler.move(13)
  assert.equal(t.frames.size, 1)
  t.tick(); t.tick()
  assert.equal(t.frames.size, 0)
  assert.equal(t.samples.length, 4)
  assert.equal(t.samples.at(-1).x, 13)
})

test('cancel ignores all late input and a previously captured animation callback', () => {
  const t = setup()
  t.scheduler.start(10); t.scheduler.move(20)
  const stale = [...t.frames.values()][0]
  t.scheduler.cancel(); stale()
  t.scheduler.move(40); t.scheduler.finish(50); t.scheduler.invalidate(); t.tick()
  assert.equal(t.frames.size, 0)
  assert.equal(t.positions.length, 1)
})

test('invalidation resamples the held coordinate; invalid coordinates are ignored', () => {
  let offset = 0
  const t = setup({ readSample: x => ({ time: x + offset }) })
  t.scheduler.start(5)
  t.scheduler.move(5); t.tick()
  t.scheduler.move(NaN)
  offset = 3
  t.scheduler.invalidate(); t.tick()
  assert.equal(t.positions.at(-1).time, 8)
  t.scheduler.finish(Infinity)
  assert.equal(t.positions.at(-1).time, 8)
})

const geometry = { left: 100, right: 600, scrollLeft: 200, maxScrollLeft: 1000 }
const resolve = extras => resolveTimelineScrubSample({ clientX: 350, geometry, pixelsPerSecond: 100, duration: 20, fps: 24, ...extras })

test('geometry maps fractional FPS and nonzero scroll without mutating its cache', () => {
  const snapshot = { ...geometry }
  assert.equal(resolve({}).time, 4.5)
  assert.equal(resolve({ fps: 23.976, clientX: 151 }).time, Math.round(2.51 * 23.976) / 23.976)
  assert.deepEqual(geometry, snapshot)
})

test('edge ticks preserve existing intensity/clamps; initial and release never add a step', () => {
  assert.deepEqual(resolve({ clientX: 600 }), { time: Math.round(7.28 * 24) / 24, scrollLeft: 228, continue: true })
  assert.equal(resolve({ clientX: 600, autoScroll: false }).scrollLeft, 200)
  assert.equal(resolve({ clientX: 100 }).scrollLeft, 172)
  assert.equal(resolve({ clientX: 900 }).scrollLeft, 242)
  assert.equal(resolve({ clientX: 600, geometry: { ...geometry, scrollLeft: 1000 } }).continue, false)
})

test('mapping clamps timeline endpoints and rejects unusable geometry', () => {
  assert.equal(resolve({ clientX: -999, autoScroll: false }).time, 0)
  assert.equal(resolve({ clientX: 99999, autoScroll: false }).time, 20)
  for (const extras of [{ clientX: NaN }, { fps: 0 }, { pixelsPerSecond: 0 }, { duration: Infinity }, { geometry: null },
    { geometry: { ...geometry, right: 100 } }, { geometry: { ...geometry, maxScrollLeft: -1 } }]) assert.equal(resolve(extras), null)
})
