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
function makeClip({ fps = 24, sourceFps = fps, speed = 1, reverse = false, phase = 0, ...patch } = {}) {
  return { id: 'target', assetId: 'source', type: 'video', trackId: 'v1', name: 'Choose the best moment',
    startTime: 48 / fps, duration: 72 / fps, trimStart: 2 + phase, trimEnd: 2 + phase + 72 / fps * speed,
    sourceDuration: 30, sourceTimeScale: 1, sourceFps, timelineFps: fps, speed, reverse,
    transform: { scaleX: 115 }, adjustments: { saturation: 0.8 },
    effects: [{ id: 'grain', type: 'filmGrain', enabled: true, settings: { amount: 0.1 } }],
    keyframes: { positionX: [{ time: 0, value: 0 }, { time: 2, value: 70 }] },
    metadata: { note: 'Keep clip-local authored attributes' }, url: 'media/source.mp4', ...patch }
}
function reset(clip = makeClip(), fps = 24) {
  const before = { id: 'before', type: 'image', trackId: 'v1', startTime: 0, duration: clip.startTime,
    trimStart: 0, trimEnd: clip.startTime, sourceDuration: Infinity, url: 'media/before.png' }
  const after = { id: 'after', type: 'image', trackId: 'v1', startTime: clip.startTime + clip.duration,
    duration: 1, trimStart: 0, trimEnd: 1, sourceDuration: Infinity, url: 'media/after.png' }
  store.setState({ ...initial, clips: [before, clip, after], timelineFps: fps,
    tracks: [{ id: 'v1', type: 'video', name: 'Video 1', visible: true }, { id: 'a1', type: 'audio', name: 'Audio 1' }],
    transitions: [], markers: [{ id: 'm1', time: 15 }], selectedClipIds: ['target'],
    history: [], historyIndex: -1, playheadPosition: 1, inPoint: 0, outPoint: 20 })
}
const target = () => store.getState().clips.find(c => c.id === 'target')
function begin() {
  const result = store.getState().beginSlipEdit({ clipId: 'target' })
  assert.equal(result.ok, true, result.reason)
  return result.token
}
function apply(token, delta) {
  const result = store.getState().applySlipEdit(token, delta)
  assert.equal(result.ok, true, result.reason)
  return result
}
function assertTiming(actual, expected) {
  timingKeys.forEach(key => near(actual[key], expected[key], key))
}
function reload(fps) {
  const saved = JSON.parse(JSON.stringify(store.getState().getProjectData()))
  assert.equal(JSON.stringify(saved).includes('slipEdit'), false, 'gesture state is never project data')
  const clip = saved.clips.find(c => c.id === 'target')
  store.getState().loadFromProject(saved, [{ id: 'source', type: clip.type, duration: clip.sourceDuration,
    url: clip.url, settings: { fps: clip.sourceFps, hasAudio: false } }], fps)
  return target()
}
afterEach(() => reset())

test('96 forward/reverse, source-FPS, speed and source-phase combinations survive Slip, Undo, Redo and JSON reload', () => {
  for (const fps of [24, 30, 24000 / 1001, 30000 / 1001]) for (const sourceFps of [fps, 60]) {
    for (const speed of [0.5, 1, 2]) for (const reverse of [false, true]) for (const phase of [0, 0.017]) {
      reset(makeClip({ fps, sourceFps, speed, reverse, phase }), fps)
      const original = target(), before = store.getState()
      const token = begin()
      let result
      for (const frames of [-20, 11, 0, 3, 19]) result = apply(token, frames / fps)
      store.getState().endSlipEdit(token)
      const slipped = target()
      assert.equal(slipped.startTime, original.startTime)
      assert.equal(slipped.duration, original.duration)
      assert.equal(result.feedback.first.clip, slipped)
      assert.equal(result.feedback.last.clip, slipped)
      assert.equal(result.feedback.first.timelineTime, original.startTime)
      near(result.feedback.last.timelineTime, original.startTime + original.duration - 1 / fps, 'last retained frame')
      assert.equal(result.feedback.deltaFrames, 19)
      const sourceDelta = 19 / fps * speed
      near(slipped.trimStart, original.trimStart + sourceDelta, 'source In')
      near(slipped.trimEnd, original.trimEnd + sourceDelta, 'source Out')
      for (const key of ['transform', 'adjustments', 'effects', 'keyframes', 'metadata']) assert.equal(slipped[key], original[key])
      assert.equal(store.getState().clips[0], before.clips[0])
      assert.equal(store.getState().clips[2], before.clips[2])
      for (const key of ['playheadPosition', 'tracks', 'markers', 'transitions', 'duration', 'inPoint', 'outPoint']) {
        assert.equal(store.getState()[key], before[key], key)
      }
      for (let frame = 0; frame < 72; frame++) {
        const time = original.startTime + frame / fps
        for (const field of ['rawTime', 'time']) near(
          getClipPlaybackTimingAtTimeline(slipped, time, 0.000001, { useFrameSampling: false })[field],
          getClipPlaybackTimingAtTimeline(original, time, 0.000001, { useFrameSampling: false })[field] + sourceDelta,
          `shifted ${reverse ? 'reverse' : 'forward'} source ${field}`)
      }
      assert.equal(store.getState().history.length, 1)
      store.getState().undo(); assertTiming(target(), original)
      store.getState().redo(); assertTiming(target(), slipped)
      const loaded = reload(fps)
      assertTiming(loaded, slipped)
      assert.equal(loaded.sourceFps, sourceFps)
      assert.equal(loaded.speed, speed)
      assert.equal(loaded.reverse, reverse)
      assert.deepEqual(loaded.keyframes, original.keyframes)
      for (let frame = 0; frame < 72; frame += 7) {
        const time = original.startTime + frame / fps
        near(getClipPlaybackTimingAtTimeline(loaded, time, 0.000001, { useFrameSampling: false }).time,
          getClipPlaybackTimingAtTimeline(slipped, time, 0.000001, { useFrameSampling: false }).time, 'source after reload')
      }
    }
  }
})

test('Slip keeps audio envelopes and authored animation anchored to the clip, never shifts their coordinates', () => {
  // Reverse audio stays intentionally silent; this tests authored coordinates,
  // not a new reverse-audio playback feature.
  for (const speed of [0.5, 1, 2]) for (const sourceTimeScale of [0.5, 1, 2]) for (const reverse of [false, true]) {
    reset(makeClip({ type: 'audio', trackId: 'a1', duration: 2, trimEnd: 2 + 2 * speed * sourceTimeScale,
      speed, sourceTimeScale, reverse, volumeEnvelope: structuredClone(envelope), fadeIn: 0.3, fadeOut: 0.4 }))
    const original = target(), token = begin()
    for (const delta of [0.5, -0.25, 0.75, 0.75]) apply(token, delta)
    store.getState().endSlipEdit(token)
    const slipped = target()
    assert.equal(slipped.volumeEnvelope, original.volumeEnvelope)
    assert.equal(slipped.keyframes, original.keyframes)
    assert.equal(slipped.effects, original.effects)
    assert.equal(slipped.fadeIn, original.fadeIn)
    assert.equal(slipped.fadeOut, original.fadeOut)
    for (const time of [0, 0.5, 1, 1.5]) near(getAudioVolumeEnvelopeDb(slipped, time),
      getAudioVolumeEnvelopeDb(original, time), 'envelope anchored to timeline slot')
    near(slipped.trimStart, original.trimStart + 0.75 * speed * sourceTimeScale, 'retimed audio source shift')
    store.getState().undo(); assertTiming(target(), original)
    store.getState().redo(); assertTiming(target(), slipped)
    const loaded = reload(24)
    assertTiming(loaded, slipped)
    assert.deepEqual(loaded.volumeEnvelope, original.volumeEnvelope)
  }
})

test('Slip invalidates full bakes by signature, preserves covered source caches, and falls back outside either cache boundary', () => {
  let cached = makeClip({ cacheStatus: 'cached', cacheKind: 'full', cacheUrl: 'blob:full-bake', cachePath: 'cache/full.mp4',
    frameSampling: 'optical-flow', opticalFlowCache: { version: OPTICAL_FLOW_CACHE_VERSION,
      engine: OPTICAL_FLOW_CACHE_ENGINE, modelName: OPTICAL_FLOW_CACHE_MODEL, status: 'ready',
      path: 'cache/source-rife.mp4', url: 'blob:rife', sourceStart: 0, sourceEnd: 30,
      targetFps: 48, sourceSignature: 'synthetic-source' } })
  cached = { ...cached, cacheSignature: getClipBakeSignature(cached) }
  reset(cached)
  assert.ok(isFullBakeFresh(target()))
  assert.ok(isOpticalFlowCacheUsable(target()))
  const token = begin()
  apply(token, 0.5)
  store.getState().endSlipEdit(token)
  assert.equal(isFullBakeFresh(target()), false)
  assert.ok(isOpticalFlowCacheUsable(target()))
  assert.equal(target().cachePath, cached.cachePath)
  assert.equal(target().opticalFlowCache, cached.opticalFlowCache)
  store.getState().undo()
  assert.ok(isFullBakeFresh(target()))
  for (const delta of [-0.5, 0.5]) {
    reset({ ...cached, opticalFlowCache: { ...cached.opticalFlowCache,
      sourceStart: cached.trimStart - 1, sourceEnd: cached.trimEnd + 1 } })
    assert.ok(isOpticalFlowCacheUsable(target()))
    const narrow = begin(); apply(narrow, delta); store.getState().endSlipEdit(narrow)
    assert.equal(isOpticalFlowCacheUsable(target()), false)
    store.getState().undo()
    assert.ok(isOpticalFlowCacheUsable(target()))
  }
})
