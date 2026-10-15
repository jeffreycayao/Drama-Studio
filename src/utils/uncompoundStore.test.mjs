import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { getClipPlaybackTimingAtTimeline } from './clipPlaybackTiming.js'
import { OPTICAL_FLOW_CACHE_VERSION, OPTICAL_FLOW_CACHE_ENGINE, OPTICAL_FLOW_CACHE_MODEL } from './frameSampling.js'

const require = createRequire(import.meta.url)
const code = buildSync({ entryPoints: [fileURLToPath(new URL('../stores/timelineStore.js', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'zustand', 'zustand/*'],
}).outputFiles[0].text
const module = { exports: {} }
Function('require', 'module', 'exports', 'localStorage', code)(require, module, module.exports,
  { getItem: () => null, setItem() {}, removeItem() {} })
const store = module.exports.useTimelineStore
const initial = store.getState()
const clip = (patch = {}) => ({ id: 'source-clip', type: 'video', assetId: 'source', name: 'Take', trackId: 'v1',
  startTime: 2, duration: 4, trimStart: 1, trimEnd: 5, sourceDuration: 20, speed: 1, reverse: false,
  sourceTimeScale: 1, sourceFps: 24, timelineFps: 24, transform: { scaleX: 110 },
  keyframes: { positionX: [{ time: 0, value: 10, easing: 'easeInOut' }, { time: 3, value: 90 }] }, ...patch })
const tracks = () => [{ id: 'v1', type: 'video', name: 'V1' }, { id: 'a1', type: 'audio', name: 'A1' }]
const reset = patch => store.setState({ ...initial, clips: [clip()], tracks: tracks(), duration: 60, timelineFps: 24,
  markers: [{ id: 'marker-1', time: 40 }], selectedClipIds: ['source-clip'], playheadPosition: 3, inPoint: 1, outPoint: 15,
  history: [], historyIndex: -1, ...patch })
const create = () => {
  const input = { clipIds: ['source-clip'], name: 'Scene', width: 1920, height: 1080 }
  const preview = store.getState().previewCreateCompound(input)
  assert.equal(preview.ok, true, preview.reason)
  const result = store.getState().applyCreateCompound(input, preview.token)
  assert.equal(result.ok, true, result.reason)
  return store.getState().clips.find(clip => clip.id === result.clipId)
}
const noWrite = action => {
  const previous = store.getState(); let count = 0
  const off = store.subscribe(() => count++)
  let result
  try { result = action() } finally { off() }
  assert.equal(count, 0); assert.equal(store.getState(), previous)
  return result
}
const preview = clipId => noWrite(() => store.getState().previewUncompound({ clipId }))
const apply = clipId => {
  const result = preview(clipId)
  assert.equal(result.ok, true, result.reason)
  return store.getState().applyUncompound({ clipId }, result.token)
}
beforeEach(() => reset())
afterEach(() => reset())

test('read-only preview and one atomic apply restore ordinary clips/tracks with one Undo checkpoint', () => {
  const parent = create(), before = store.getState()
  const plan = preview(parent.id)
  assert.equal(plan.ok, true, plan.reason)
  assert.equal(Object.hasOwn(plan, 'clips'), false)
  let count = 0; const off = store.subscribe(() => count++)
  const result = store.getState().applyUncompound({ clipId: parent.id }, plan.token); off()
  assert.equal(count, 1)
  assert.equal(result.changed, true)
  assert.equal(store.getState().history.length, before.history.length + 1)
  assert.deepEqual(store.getState().selectedClipIds, result.restoredClipIds)
  assert.equal(store.getState().activeTrackId, store.getState().clips[0].trackId)
  for (const key of ['playheadPosition', 'inPoint', 'outPoint', 'duration', 'transitions']) assert.equal(store.getState()[key], before[key])
  assert.equal(store.getState().markers[0], before.markers[0])
  store.getState().undo()
  assert.equal(store.getState().clips[0].type, 'compound')
  assert.equal(store.getState().clips[0].id, parent.id)
  assert.deepEqual(store.getState().tracks, before.tracks)
  store.getState().redo()
  assert.equal(store.getState().clips[0].type, 'video')
  assert.deepEqual(store.getState().selectedClipIds, [])
})

test('restores latest Back-edited child state and child markers after move and safe parent trim', () => {
  const parent = create()
  store.getState().openCompound(parent.id)
  store.getState().updateClipTransform('source-clip', { scaleX: 140 })
  store.getState().addMarker(1.5, 'Child marker')
  assert.equal(store.getState().closeCompound().ok, true)
  store.getState().moveClip(parent.id, 'v1', 10)
  store.getState().updateClipTrim(parent.id, { startTime: 10, trimStart: 1, trimEnd: 3, duration: 2 })
  assert.equal(apply(parent.id).ok, true)
  const restored = store.getState().clips[0]
  assert.equal(restored.startTime, 10)
  assert.equal(restored.duration, 2)
  assert.equal(restored.transform.scaleX, 140)
  assert.deepEqual(restored.keyframes.positionX.map(point => point.time), [-1, 2])
  assert.equal(store.getState().markers.find(marker => marker.label === 'Child marker').time, 10.5)
})

test('every bound state identity and counters invalidate a token without adding history', () => {
  for (const key of ['clips', 'tracks', 'transitions', 'markers', 'timelineFps', 'timelineSessionId', 'history', 'historyIndex',
    'duration', 'isPlaying', 'selectedClipIds', 'clipCounter', 'markerCounter', 'compoundEditContext']) {
    reset(); const parent = create(), result = preview(parent.id)
    assert.equal(result.ok, true, result.reason)
    const value = store.getState()[key]
    if (key === 'compoundEditContext') store.getState().openCompound(parent.id)
    else store.setState({ [key]: Array.isArray(value) ? [...value] : typeof value === 'number' ? value + 1 : !value })
    assert.equal(noWrite(() => store.getState().applyUncompound({ clipId: parent.id }, result.token)).ok, false, key)
  }
})

test('token is single-use, cannot retarget, and public summary mutation cannot affect planned clips', () => {
  const parent = create(), result = preview(parent.id)
  result.summary.clipCount = 999
  assert.equal(noWrite(() => store.getState().applyUncompound({ clipId: 'other' }, result.token)).ok, false)
  assert.equal(store.getState().applyUncompound({ clipId: parent.id }, result.token).ok, true)
  assert.equal(store.getState().clips.length, 1)
  assert.equal(noWrite(() => store.getState().applyUncompound({ clipId: parent.id }, result.token)).ok, false)
})

test('playing, focused, locked, active-job and unsupported cropped-ramp requests never write', () => {
  const parent = create()
  store.setState({ isPlaying: true }); assert.equal(preview(parent.id).ok, false)
  store.setState({ isPlaying: false }); store.getState().openCompound(parent.id)
  assert.equal(preview(parent.id).ok, false); store.getState().closeCompound()
  for (const patch of [{ locked: true }, { cacheStatus: 'rendering' }]) {
    store.setState({ clips: [{ ...parent, ...patch }] }); assert.equal(preview(parent.id).ok, false)
  }
  store.setState({ clips: [{ ...parent, duration: 2, trimStart: 1, trimEnd: 3, compound: { ...parent.compound,
    document: { ...parent.compound.document, clips: [clip({ startTime: 0, keyframes: { speed: [{ time: 0, value: 1 }] } })] } } }] })
  assert.equal(preview(parent.id).ok, false)
})

test('ordinary save/reload preserves restored trim/source samples and offscreen eased keyframes', () => {
  const parent = create()
  store.getState().updateClipTrim(parent.id, { trimStart: 1, trimEnd: 3, duration: 2 })
  assert.equal(apply(parent.id).ok, true)
  const before = store.getState().clips[0], data = store.getState().getProjectData()
  store.getState().loadFromProject(data, [{ id: 'source', type: 'video', duration: 20, settings: { fps: 24 } }], 24)
  const after = store.getState().clips[0]
  assert.equal(after.duration, before.duration)
  assert.deepEqual(after.keyframes, before.keyframes)
  for (let frame = 0; frame < 48; frame++) {
    assert.ok(Math.abs(getClipPlaybackTimingAtTimeline(before, before.startTime + frame / 24).time
      - getClipPlaybackTimingAtTimeline(after, after.startTime + frame / 24).time) < 1e-7)
  }
})

const rifeCache = () => ({ version: OPTICAL_FLOW_CACHE_VERSION, engine: OPTICAL_FLOW_CACHE_ENGINE, modelName: OPTICAL_FLOW_CACHE_MODEL,
  status: 'ready', path: 'cache/source-rife.mp4', url: 'blob:verified-rife', sourceSignature: 'size:123-mtime:456',
  sourceStart: 0, sourceEnd: 10, targetFps: 48, frameCount: 480, progress: 100 })

test('Uncompound Undo and Redo retain verified source RIFE across fresh clip IDs without restoring full bakes', () => {
  reset({ clips: [clip({ frameSampling: 'optical-flow', opticalFlowCache: rifeCache(), cacheStatus: 'cached', cacheUrl: 'blob:bake' })] })
  const parent = create()
  assert.equal(apply(parent.id).ok, true)
  const restoredId = store.getState().clips[0].id
  assert.notEqual(restoredId, 'source-clip')
  assert.equal(store.getState().clips[0].cacheUrl, null)
  for (let cycle = 0; cycle < 2; cycle++) {
    store.getState().undo()
    const inner = store.getState().clips[0].compound.document.clips[0]
    assert.equal(inner.opticalFlowCache.status, 'ready')
    assert.equal(inner.opticalFlowCache.url, 'blob:verified-rife')
    assert.equal(getClipPlaybackTimingAtTimeline(inner, inner.startTime + 0.5).usingOpticalFlow, true)
    store.getState().redo()
    const restored = store.getState().clips[0]
    assert.equal(restored.id, restoredId)
    assert.equal(restored.opticalFlowCache.status, 'ready')
    assert.equal(restored.opticalFlowCache.url, 'blob:verified-rife')
    assert.equal(restored.cacheUrl, null)
  }
})

test('Undo refuses cross-ID RIFE reuse for mismatched source identity, durable descriptors, or unverified state', () => {
  for (const patch of [{ assetId: 'other-source' }, { opticalFlowCache: { ...rifeCache(), sourceSignature: 'changed' } },
    { opticalFlowCache: { ...rifeCache(), path: 'cache/other.mp4' } }, { opticalFlowCache: { ...rifeCache(), frameCount: 479 } },
    { opticalFlowCache: { ...rifeCache(), status: 'stale' } }, { opticalFlowCache: { ...rifeCache(), status: 'hydrating' } },
    { opticalFlowCache: { ...rifeCache(), jobId: 'unverified-job' } }]) {
    reset({ clips: [clip({ frameSampling: 'optical-flow', opticalFlowCache: rifeCache() })] })
    const parent = create(); assert.equal(apply(parent.id).ok, true)
    store.setState({ clips: [{ ...store.getState().clips[0], ...patch }] })
    store.getState().undo()
    const cache = store.getState().clips[0].compound.document.clips[0].opticalFlowCache
    assert.equal(cache.status, 'stale')
    assert.equal(cache.url, undefined)
  }
})
