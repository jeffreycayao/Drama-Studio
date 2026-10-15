import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { getClipPlaybackTimingAtTimeline } from './clipPlaybackTiming.js'
import { getAudioVolumeEnvelopeDb } from './audioVolumeEnvelope.mjs'
import { isOpticalFlowCacheUsable, OPTICAL_FLOW_CACHE_VERSION, OPTICAL_FLOW_CACHE_ENGINE,
  OPTICAL_FLOW_CACHE_MODEL } from './frameSampling.js'

const require = createRequire(import.meta.url)
function loadModule(relativePath) {
  const code = buildSync({ entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'zustand', 'zustand/*'],
  }).outputFiles[0].text
  const module = { exports: {} }
  Function('require', 'module', 'exports', 'localStorage', code)(require, module, module.exports,
    { getItem: () => null, setItem() {}, removeItem() {} })
  return module.exports
}
const store = loadModule('../stores/timelineStore.js').useTimelineStore
const { getClipBakeSignature, isFullBakeFresh } = loadModule('./clipBakeSignature.js')
const initial = store.getState()
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} != ${expected}`)
const timingKeys = ['startTime', 'duration', 'trimStart', 'trimEnd']
const envelope = { version: 1, offsetSeconds: 0.2,
  points: [{ id: 'a', time: -2, db: -12 }, { id: 'b', time: 5, db: 4 }] }
const pair = (fps = 24, speed = 1, reverseA = false, reverseB = false) => [false, true].map(incoming => ({
  id: incoming ? 'in' : 'out', assetId: incoming ? 'asset-in' : 'asset-out', type: 'video', trackId: 'v1',
  name: incoming ? 'Incoming' : 'Outgoing', startTime: (incoming ? 72 : 24) / fps, duration: 48 / fps,
  trimStart: incoming ? 4 : 2, trimEnd: (incoming ? 4 : 2) + 48 / fps * speed, sourceDuration: 20,
  sourceTimeScale: 1, sourceFps: fps, timelineFps: fps, speed, reverse: incoming ? reverseB : reverseA,
  transform: { scaleX: 115 }, effects: [{ id: incoming ? 'e-in' : 'e-out', type: 'filmGrain', enabled: true, settings: { amount: 0.1 } }],
  keyframes: { positionX: [{ time: 0, value: 0 }, { time: 2, value: 70 }] },
  metadata: { note: 'Keep authored attributes' }, url: incoming ? 'media/in.mp4' : 'media/out.mp4',
}))
function reset(clips = pair(), fps = 24, extra = {}) {
  store.setState({ ...initial, clips, timelineFps: fps,
    tracks: [{ id: 'v1', type: 'video', name: 'Video 1', visible: true }, { id: 'a1', type: 'audio', name: 'Audio 1' }],
    transitions: [], markers: [{ id: 'm1', time: 15 }], selectedClipIds: ['out'],
    history: [], historyIndex: -1, playheadPosition: 1, inPoint: 0, outPoint: 20, ...extra })
}
function begin() {
  const result = store.getState().beginRollEdit({ clipAId: 'out', clipBId: 'in' })
  assert.equal(result.ok, true, result.reason)
  return result.token
}
function apply(token, delta) {
  const result = store.getState().applyRollEdit(token, delta)
  assert.equal(result.ok, true, result.reason)
  return result
}
function assertTiming(actual, expected) {
  actual.forEach((clip, index) => timingKeys.forEach(key => near(clip[key], expected[index][key], `${clip.id}.${key}`)))
}
function roundTrip(fps) {
  const saved = JSON.parse(JSON.stringify(store.getState().getProjectData()))
  assert.equal(JSON.stringify(saved).includes('rollEdit'), false, 'gesture state is not project data')
  const assets = saved.clips.filter(c => c.type === 'video' || c.type === 'audio').map(c => ({
    id: c.assetId, type: c.type, duration: c.sourceDuration, url: c.url, settings: { fps: c.sourceFps || fps, hasAudio: false },
  }))
  store.getState().loadFromProject(saved, assets, fps)
  return store.getState().clips
}
afterEach(() => reset())

test('rolled constant-speed forward/reverse source clocks and attributes survive Undo, Redo and JSON save/load', () => {
  for (const fps of [24, 30, 24000 / 1001, 30000 / 1001]) {
    for (const sourceFps of [fps, 60]) for (const speed of [0.5, 1, 2]) for (const reverseA of [false, true]) for (const reverseB of [false, true]) {
      reset(pair(fps, speed, reverseA, reverseB).map(c => ({ ...c, sourceFps })), fps)
      const original = store.getState().clips
      const token = begin()
      for (const frames of [-18, 11, -3, 0, 7]) apply(token, frames / fps)
      store.getState().endRollEdit(token)
      const rolled = store.getState().clips
      near(rolled[0].startTime, original[0].startTime, 'outer start')
      near(rolled[1].startTime + rolled[1].duration, original[1].startTime + original[1].duration, 'outer end')
      for (const [index, clip] of rolled.entries()) {
        for (const field of ['keyframes', 'effects', 'transform', 'metadata']) assert.deepEqual(clip[field], original[index][field])
        const overlapStart = Math.max(clip.startTime, original[index].startTime)
        const overlapEnd = Math.min(clip.startTime + clip.duration, original[index].startTime + original[index].duration)
        for (let frame = 0; frame < Math.floor((overlapEnd - overlapStart) * fps); frame++) {
          const t = overlapStart + frame / fps
          // The raw affine clock is retained. The existing reverse first-frame
          // clamp still treats each clip's source Out as exclusive.
          near(getClipPlaybackTimingAtTimeline(clip, t, 0.000001, { useFrameSampling: false }).rawTime,
            getClipPlaybackTimingAtTimeline(original[index], t, 0.000001, { useFrameSampling: false }).rawTime, 'retained source clock')
        }
      }
      assert.equal(store.getState().history.length, 1)
      store.getState().undo()
      assertTiming(store.getState().clips, original)
      store.getState().redo()
      assertTiming(store.getState().clips, rolled)
      const loaded = roundTrip(fps)
      assertTiming(loaded, rolled)
      loaded.forEach((clip, index) => {
        assert.equal(clip.reverse, rolled[index].reverse)
        assert.equal(clip.speed, speed)
        assert.equal(clip.sourceFps, sourceFps)
        assert.deepEqual(clip.keyframes, rolled[index].keyframes)
        assert.deepEqual(clip.effects, rolled[index].effects)
        for (const fraction of [0, 0.25, 0.5, 0.75]) {
          const time = clip.startTime + clip.duration * fraction
          near(getClipPlaybackTimingAtTimeline(clip, time, 0.000001, { useFrameSampling: false }).rawTime,
            getClipPlaybackTimingAtTimeline(rolled[index], time, 0.000001, { useFrameSampling: false }).rawTime,
            'source clock after reload')
        }
      })
    }
  }
})

test('unlimited image/title/shape/adjustment trims stay nonnegative and portable after extending either side', () => {
  for (const type of ['image', 'text', 'shape', 'adjustment']) for (const sourceDuration of [null, Infinity]) {
    for (const delta of [-1.5, 1.5]) {
      reset(pair().map(c => ({ ...c, type, trimStart: 0, trimEnd: 2, sourceDuration, reverse: true })))
      const token = begin()
      apply(token, delta)
      store.getState().endRollEdit(token)
      const rolled = store.getState().clips
      near(rolled[0].duration, 2 + delta, `${type} outgoing duration`)
      near(rolled[1].duration, 2 - delta, `${type} incoming duration`)
      for (const clip of rolled) {
        assert.ok(clip.trimStart >= 0)
        near(clip.trimEnd - clip.trimStart, clip.duration, `${type} synthetic span`)
      }
      const loaded = roundTrip(24)
      assertTiming(loaded, rolled)
      loaded.forEach(c => assert.equal(c.sourceDuration, Infinity))
    }
  }
})

test('incoming audio envelope coordinates survive repeated rolls, Undo and reload', () => {
  // This verifies authored gain coordinates; existing reverse-audio playback
  // remains intentionally silent and is not made audible by rolling edits.
  for (const reverse of [false, true]) {
    reset(pair(24, 0.5, reverse, reverse).map(c => ({ ...c, type: 'audio', trackId: 'a1', volumeEnvelope: structuredClone(envelope) })))
    const original = store.getState().clips
    const token = begin()
    for (const delta of [0.5, -0.5, 0.75, 0.75]) apply(token, delta)
    store.getState().endRollEdit(token)
    const rolled = store.getState().clips
    near(rolled[0].volumeEnvelope.offsetSeconds, 0.2, 'outgoing envelope origin')
    near(rolled[1].volumeEnvelope.offsetSeconds, 0.95, 'incoming envelope origin')
    for (const localTime of [0, 0.5, 1]) near(getAudioVolumeEnvelopeDb(rolled[1], localTime),
      getAudioVolumeEnvelopeDb(original[1], localTime + 0.75), 'retained audio gain')
    store.getState().undo()
    assert.deepEqual(store.getState().clips.map(c => c.volumeEnvelope), original.map(c => c.volumeEnvelope))
    store.getState().redo()
    assert.deepEqual(roundTrip(24).map(c => c.volumeEnvelope), rolled.map(c => c.volumeEnvelope))
  }
})

test('roll makes full bakes stale without deleting files; covered RIFE remains usable and uncovered RIFE falls back', () => {
  const clips = pair().map(c => {
    const cached = { ...c, cacheStatus: 'cached', cacheKind: 'full', cacheUrl: `blob:bake-${c.id}`,
      cachePath: `cache/${c.id}.mp4`, frameSampling: 'optical-flow', opticalFlowCache: {
        version: OPTICAL_FLOW_CACHE_VERSION, engine: OPTICAL_FLOW_CACHE_ENGINE, modelName: OPTICAL_FLOW_CACHE_MODEL,
        status: 'ready', path: `cache/rife-${c.id}.mp4`, url: `blob:rife-${c.id}`, sourceStart: 0, sourceEnd: 20,
        targetFps: 48, sourceSignature: 'synthetic-source',
      } }
    return { ...cached, cacheSignature: getClipBakeSignature(cached) }
  })
  reset(clips)
  clips.forEach(c => { assert.ok(isFullBakeFresh(c)); assert.ok(isOpticalFlowCacheUsable(c)) })
  const token = begin()
  apply(token, 0.5)
  store.getState().endRollEdit(token)
  store.getState().clips.forEach((c, index) => {
    assert.equal(isFullBakeFresh(c), false)
    assert.ok(isOpticalFlowCacheUsable(c))
    assert.equal(c.cachePath, clips[index].cachePath)
    assert.equal(c.opticalFlowCache, clips[index].opticalFlowCache)
  })
  store.getState().undo()
  store.getState().clips.forEach(c => assert.ok(isFullBakeFresh(c)))
  reset(clips.map(c => ({ ...c, opticalFlowCache: { ...c.opticalFlowCache, sourceStart: c.trimStart - 1, sourceEnd: c.trimEnd + 1 } })))
  const narrowToken = begin()
  apply(narrowToken, 0.5)
  store.getState().endRollEdit(narrowToken)
  assert.equal(isOpticalFlowCacheUsable(store.getState().clips[0]), false, 'new outgoing handles exceed narrow cache')
  assert.ok(isOpticalFlowCacheUsable(store.getState().clips[1]), 'incoming crop remains within cache')
})
