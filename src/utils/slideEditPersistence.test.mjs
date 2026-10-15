import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { getClipPlaybackTimingAtTimeline } from './clipPlaybackTiming.js'
import { getAudioVolumeEnvelopeDb } from './audioVolumeEnvelope.mjs'
import { isOpticalFlowCacheUsable, OPTICAL_FLOW_CACHE_VERSION, OPTICAL_FLOW_CACHE_ENGINE, OPTICAL_FLOW_CACHE_MODEL } from './frameSampling.js'

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
const envelope = { version: 1, offsetSeconds: 0.2, points: [{ id: 'a', time: -2, db: -12 }, { id: 'b', time: 5, db: 4 }] }
function trio({ fps = 24, sourceFps = fps, speed = 1, reverse = [false, false, false], type = 'video', sourceTimeScale = 1 } = {}) {
  return ['previous', 'middle', 'next'].map((id, index) => {
    const duration = [48, 72, 48][index] / fps, trimStart = 2.017 + index
    return { id, assetId: `source-${id}`, name: id, type, trackId: type === 'audio' ? 'a1' : 'v1',
      startTime: [24, 72, 144][index] / fps, duration, trimStart, trimEnd: trimStart + duration * speed * sourceTimeScale,
      sourceDuration: 40, sourceTimeScale, sourceFps, timelineFps: fps, speed, reverse: reverse[index],
      transform: { scaleX: 115 }, adjustments: { saturation: 0.8 }, effects: [{ id: `fx-${id}`, type: 'filmGrain', enabled: true, settings: { amount: 0.1 } }],
      keyframes: { positionX: [{ time: 0, value: 0 }, { time: 2, value: 70 }] },
      masks: [{ id: `mask-${id}`, type: 'ellipse', feather: 0.1 }], metadata: { note: 'Preserve local attributes' }, url: `media/${id}.mp4` }
  })
}
function reset(clips = trio(), fps = 24) {
  store.setState({ ...initial, clips: [...clips,
    { id: 'overlay', type: 'shape', trackId: 'v2', startTime: 0, duration: 30, trimStart: 0, trimEnd: 30 },
    { id: 'downstream', type: 'image', trackId: clips[0].trackId, startTime: 20, duration: 2, trimStart: 0, trimEnd: 2, sourceDuration: Infinity }],
    tracks: [{ id: 'v1', type: 'video', name: 'Picture', visible: true }, { id: 'v2', type: 'video', name: 'Overlay', visible: true },
      { id: 'a1', type: 'audio', name: 'Audio' }], timelineFps: fps, duration: 60, zoom: 150,
    selectedClipIds: ['middle'], transitions: [], markers: [{ id: 'marker', time: 15 }], history: [], historyIndex: -1,
    isPlaying: false, playheadPosition: 1, inPoint: 0, outPoint: 20 })
}
const edited = () => store.getState().clips.slice(0, 3)
const begin = () => {
  const result = store.getState().beginSlideEdit({ clipId: 'middle' })
  assert.equal(result.ok, true, result.reason)
  return result.token
}
const apply = (token, delta) => {
  const result = store.getState().applySlideEdit(token, delta)
  assert.equal(result.ok, true, result.reason)
  return result
}
const assertTiming = (actual, expected) => actual.forEach((clip, index) => timingKeys.forEach(key => near(clip[key], expected[index][key], `${clip.id}.${key}`)))
function reload(fps = 24) {
  const saved = JSON.parse(JSON.stringify(store.getState().getProjectData()))
  assert.equal(JSON.stringify(saved).includes('slideEdit'), false, 'private gesture data never serialized')
  const assets = saved.clips.filter(c => ['video', 'audio'].includes(c.type)).map(c => ({ id: c.assetId, type: c.type,
    url: c.url, duration: c.sourceDuration, settings: { fps: c.sourceFps || fps, hasAudio: false } }))
  store.getState().loadFromProject(saved, assets, fps)
  return edited()
}
afterEach(() => reset())

test('192 source-clock combinations preserve the moved shot and retained neighbor samples through Undo/Redo/reopen', () => {
  for (const fps of [24, 30, 24000 / 1001, 30000 / 1001]) for (const sourceFps of [fps, 60]) {
    for (const speed of [0.5, 1, 2]) for (let orientation = 0; orientation < 8; orientation++) {
      const reverse = [0, 1, 2].map(bit => Boolean(orientation & 1 << bit))
      reset(trio({ fps, sourceFps, speed, reverse }), fps)
      const original = edited(), before = store.getState(), token = begin()
      let result
      for (const frames of [-11, 7, 0, -5, 13]) result = apply(token, frames / fps)
      store.getState().endSlideEdit(token)
      const clips = edited(), delta = 13 / fps
      near(clips[0].startTime, original[0].startTime, 'outer start')
      near(clips[0].duration, original[0].duration + delta, 'previous duration')
      near(clips[1].startTime, original[1].startTime + delta, 'middle position')
      near(clips[2].startTime, original[2].startTime + delta, 'next position')
      near(clips[2].duration, original[2].duration - delta, 'next duration')
      near(clips[2].startTime + clips[2].duration, original[2].startTime + original[2].duration, 'outer end')
      near(clips[0].startTime + clips[0].duration, clips[1].startTime, 'first cut')
      near(clips[1].startTime + clips[1].duration, clips[2].startTime, 'second cut')
      assert.deepEqual({ ...clips[1], startTime: original[1].startTime }, original[1], 'middle changes only timeline position')
      for (const [index, clip] of clips.entries()) {
        for (const key of ['transform', 'adjustments', 'effects', 'keyframes', 'masks', 'metadata']) assert.equal(clip[key], original[index][key])
        if (index === 1) {
          for (let frame = 0; frame < 72; frame += 3) for (const field of ['rawTime', 'time']) near(
            getClipPlaybackTimingAtTimeline(clip, clip.startTime + frame / fps, 1e-6, { useFrameSampling: false })[field],
            getClipPlaybackTimingAtTimeline(original[index], original[index].startTime + frame / fps, 1e-6, { useFrameSampling: false })[field], `middle ${field}`)
        } else {
          const start = Math.max(clip.startTime, original[index].startTime)
          const end = Math.min(clip.startTime + clip.duration, original[index].startTime + original[index].duration)
          for (let frame = 0; frame < Math.floor((end - start) * fps); frame += 3) {
            const time = start + frame / fps
            near(getClipPlaybackTimingAtTimeline(clip, time, 1e-6, { useFrameSampling: false }).rawTime,
              getClipPlaybackTimingAtTimeline(original[index], time, 1e-6, { useFrameSampling: false }).rawTime, 'retained neighbor raw source')
          }
        }
      }
      assert.equal(result.feedback.outgoing.clip, clips[0])
      assert.equal(result.feedback.incoming.clip, clips[2])
      near(result.feedback.outgoing.timelineTime, clips[1].startTime - 1 / fps, 'last retained outgoing frame')
      near(result.feedback.incoming.timelineTime, clips[2].startTime, 'first retained incoming frame')
      assert.equal(result.feedback.deltaFrames, 13)
      for (const key of ['tracks', 'markers', 'transitions', 'duration', 'zoom', 'playheadPosition', 'inPoint', 'outPoint']) assert.equal(store.getState()[key], before[key], key)
      assert.equal(store.getState().clips[3], before.clips[3]); assert.equal(store.getState().clips[4], before.clips[4])
      assert.equal(store.getState().history.length, 1)
      store.getState().undo(); assertTiming(edited(), original)
      store.getState().redo(); assertTiming(edited(), clips)
      const loaded = reload(fps); assertTiming(loaded, clips)
      loaded.forEach((clip, index) => {
        assert.equal(clip.reverse, reverse[index]); assert.equal(clip.speed, speed); assert.equal(clip.sourceFps, sourceFps)
        for (const key of ['keyframes', 'effects', 'masks', 'metadata']) assert.deepEqual(clip[key], clips[index][key])
        for (const fraction of [0, 0.25, 0.5, 0.75]) {
          const time = clip.startTime + clip.duration * fraction
          near(getClipPlaybackTimingAtTimeline(clip, time, 1e-6, { useFrameSampling: false }).rawTime,
            getClipPlaybackTimingAtTimeline(clips[index], time, 1e-6, { useFrameSampling: false }).rawTime, 'source after reopen')
        }
      })
    }
  }
})

test('different clip speeds and reverse directions constrain and trim each neighbor in its own source clock', () => {
  for (const speeds of [[0.5, 2, 1], [2, 1, 0.5]]) for (const delta of [-0.5, 0.75]) {
    const original = trio({ reverse: [true, false, true] }).map((clip, index) => ({ ...clip, speed: speeds[index], trimEnd: clip.trimStart + clip.duration * speeds[index] }))
    reset(original); const token = begin(); apply(token, delta); store.getState().endSlideEdit(token)
    const clips = edited()
    near(clips[0].trimStart, original[0].trimStart - delta * speeds[0], 'reverse previous In')
    near(clips[2].trimEnd, original[2].trimEnd - delta * speeds[2], 'reverse next Out')
    assert.deepEqual({ ...clips[1], startTime: original[1].startTime }, original[1])
    assertTiming(reload(), clips)
  }
})

test('audio envelope follows retained next-head content while the moved shot keeps its local envelope/fades/EQ', () => {
  // Reverse-audio playback is not introduced; this tests authored coordinates.
  for (const speed of [0.5, 1, 2]) for (const sourceTimeScale of [0.5, 1, 2]) for (const reverse of [false, true]) {
    const original = trio({ type: 'audio', speed, sourceTimeScale, reverse: [reverse, reverse, reverse] }).map(clip => ({ ...clip,
      trimStart: clip.trimStart + 4, trimEnd: clip.trimEnd + 4,
      volumeEnvelope: structuredClone(envelope), fadeIn: 0.2, fadeOut: 0.3, audioEq: { version: 1, enabled: true, lowCut: false, bassDb: 2, midDb: -3, trebleDb: 1 } }))
    reset(original); const token = begin()
    for (const delta of [0.5, -0.25, 0.75, 0.75]) apply(token, delta)
    store.getState().endSlideEdit(token)
    const clips = edited()
    assert.equal(clips[0].volumeEnvelope, original[0].volumeEnvelope)
    assert.equal(clips[1].volumeEnvelope, original[1].volumeEnvelope)
    near(clips[2].volumeEnvelope.offsetSeconds, envelope.offsetSeconds + 0.75, 'next envelope origin advances once')
    for (const time of [0, 0.25, 0.5, 1]) {
      near(getAudioVolumeEnvelopeDb(clips[1], time), getAudioVolumeEnvelopeDb(original[1], time), 'middle local envelope')
      near(getAudioVolumeEnvelopeDb(clips[2], time), getAudioVolumeEnvelopeDb(original[2], time + 0.75), 'next retained gain')
    }
    for (let index = 0; index < 3; index++) {
      for (const key of ['effects', 'keyframes', 'fadeIn', 'fadeOut', 'audioEq']) assert.equal(clips[index][key], original[index][key])
    }
    store.getState().undo(); assertTiming(edited(), original)
    store.getState().redo(); assertTiming(edited(), clips)
    const loaded = reload(); assertTiming(loaded, clips)
    loaded.forEach((clip, index) => {
      assert.deepEqual(clip.volumeEnvelope, clips[index].volumeEnvelope)
      assert.deepEqual(clip.audioEq, clips[index].audioEq)
    })
  }
})

test('unlimited generators extend either neighbor without negative synthetic trims and preserve middle metadata', () => {
  for (const type of ['image', 'text', 'shape', 'adjustment']) for (const sourceDuration of [null, Infinity]) for (const delta of [-1.5, 1.5]) {
    const original = trio({ type }).map(clip => ({ ...clip, trimStart: 0, trimEnd: clip.duration, sourceDuration }))
    reset(original); const token = begin(); apply(token, delta); store.getState().endSlideEdit(token)
    const clips = edited()
    clips.forEach(clip => { assert.ok(clip.trimStart >= 0); near(clip.trimEnd - clip.trimStart, clip.duration, 'synthetic source duration') })
    assert.deepEqual({ ...clips[1], startTime: original[1].startTime }, original[1])
    assertTiming(reload(), clips)
  }
})

test('middle full bake stays fresh; changed neighbors go stale, covered RIFE stays usable, and Undo restores all bakes', () => {
  const cached = trio().map(clip => {
    const result = { ...clip, cacheStatus: 'cached', cacheKind: 'full', cacheUrl: `blob:${clip.id}`, cachePath: `cache/${clip.id}.mp4`,
      frameSampling: 'optical-flow', opticalFlowCache: { version: OPTICAL_FLOW_CACHE_VERSION, engine: OPTICAL_FLOW_CACHE_ENGINE,
        modelName: OPTICAL_FLOW_CACHE_MODEL, status: 'ready', path: `cache/rife-${clip.id}.mp4`, url: `blob:rife-${clip.id}`,
        sourceStart: 0, sourceEnd: 40, targetFps: 48, sourceSignature: 'synthetic-source' } }
    return { ...result, cacheSignature: getClipBakeSignature(result) }
  })
  reset(cached); const token = begin(); apply(token, 0.5); store.getState().endSlideEdit(token)
  edited().forEach((clip, index) => {
    assert.equal(isFullBakeFresh(clip), index === 1)
    assert.ok(isOpticalFlowCacheUsable(clip))
    assert.equal(clip.cachePath, cached[index].cachePath)
    assert.equal(clip.opticalFlowCache, cached[index].opticalFlowCache)
  })
  store.getState().undo(); edited().forEach(clip => assert.ok(isFullBakeFresh(clip)))
  reset(cached.map(clip => ({ ...clip, opticalFlowCache: { ...clip.opticalFlowCache, sourceStart: clip.trimStart - 1, sourceEnd: clip.trimEnd + 1 } })))
  const narrow = begin(); apply(narrow, 0.5); store.getState().endSlideEdit(narrow)
  assert.equal(isOpticalFlowCacheUsable(edited()[0]), false)
  assert.ok(isOpticalFlowCacheUsable(edited()[1]))
  assert.ok(isOpticalFlowCacheUsable(edited()[2]))
})
