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
const authoredKeys = ['transform', 'adjustments', 'effects', 'keyframes', 'metadata', 'shapeMask']
function makeClip({ fps = 24, sourceFps = fps, speed = 1, reverse = false, ...patch } = {}) {
  return { id: 'target', assetId: 'source', type: 'video', trackId: 'v1', name: 'Pace the sequence',
    startTime: 48 / fps, duration: 72 / fps, trimStart: 2.017, trimEnd: 2.017 + 72 / fps * speed,
    sourceDuration: 40, sourceTimeScale: 1, sourceFps, timelineFps: fps, speed, reverse,
    transform: { scaleX: 115 }, adjustments: { saturation: 0.8 },
    effects: [{ id: 'grain', type: 'filmGrain', enabled: true, settings: { amount: 0.1 } }],
    keyframes: { positionX: [{ time: 0, value: 0 }, { time: 2, value: 70 }] },
    shapeMask: { kind: 'ellipse', feather: 0.2 }, metadata: { note: 'Keep clip-local authored attributes' },
    url: 'media/source.mp4', ...patch }
}
function reset(clip = makeClip(), fps = 24, patch = {}) {
  const image = (id, startTime, duration, trackId = 'v1') => ({ id, assetId: id, type: 'image', trackId,
    startTime, duration, trimStart: 0, trimEnd: duration, sourceDuration: Infinity, url: `media/${id}.png` })
  store.setState({ ...initial, clips: [image('before', 0, clip.startTime), clip,
    image('after', clip.startTime + clip.duration + 12 / fps, 24 / fps),
    image('last', clip.startTime + clip.duration + 43 / fps, 24 / fps), image('overlay', 0, 240 / fps, 'v2')],
    timelineFps: fps, tracks: [
      { id: 'v1', type: 'video', name: 'Video 1', visible: true },
      { id: 'v2', type: 'video', name: 'Overlays', visible: true },
      { id: 'a1', type: 'audio', name: 'Dialogue' }, { id: 'a2', type: 'audio', name: 'Music' },
      { id: 'a3', type: 'audio', name: 'Linked sound' }],
    transitions: [], markers: [{ id: 'm1', name: 'Absolute marker', time: 15 }],
    selectedClipIds: ['target'], history: [], historyIndex: -1, historyLastChangedAt: 0,
    playheadPosition: 1, duration: 60, inPoint: 0, outPoint: 20, rippleEditMode: true, ...patch })
}
const getClip = id => store.getState().clips.find(c => c.id === id)
function begin(edge) {
  const result = store.getState().beginRippleTrim({ clipId: 'target', edge })
  assert.equal(result.ok, true, result.reason)
  return result.token
}
function apply(token, delta) {
  const result = store.getState().applyRippleTrim(token, delta)
  assert.equal(result.ok, true, result.reason)
  return result
}
function assertTiming(actual, expected) {
  timingKeys.forEach(key => near(actual[key], expected[key], key))
}
function reload(fps) {
  const saved = JSON.parse(JSON.stringify(store.getState().getProjectData()))
  assert.equal(JSON.stringify(saved).includes('rippleTrim'), false, 'gesture tokens are never project data')
  const assets = [...new Map(saved.clips.filter(c => c.assetId).map(c => [c.assetId, {
    id: c.assetId, type: c.type, duration: c.sourceDuration, url: c.url,
    settings: { fps: c.sourceFps || fps, hasAudio: c.type === 'audio' },
  }])).values()]
  store.getState().loadFromProject(saved, assets, fps)
}
afterEach(() => reset())

test('96 head/tail, integer/fractional FPS, source-FPS, speed and reverse cases preserve source samples and downstream gaps through reload', () => {
  for (const edge of ['left', 'right']) for (const fps of [24, 30, 24000 / 1001, 30000 / 1001]) {
    for (const sourceFps of [fps, 60]) for (const speed of [0.5, 1, 2]) for (const reverse of [false, true]) {
      reset(makeClip({ fps, sourceFps, speed, reverse }), fps)
      const before = store.getState(), original = getClip('target'), token = begin(edge)
      let result
      for (const frames of [-11, 7, 0, -5, 13]) result = apply(token, frames / fps)
      store.getState().endRippleTrim(token)
      const changed = getClip('target'), pointerDelta = 13 / fps
      const durationDelta = edge === 'left' ? -pointerDelta : pointerDelta
      assert.equal(changed.startTime, original.startTime)
      near(changed.duration, original.duration + durationDelta, 'target duration')
      assert.equal(result.feedback.clip, changed)
      assert.equal(result.feedback.durationDeltaFrames, edge === 'left' ? -13 : 13)
      near(result.feedback.timelineTime, changed.startTime + (edge === 'right' ? changed.duration - 1 / fps : 0), 'retained edge time')
      for (const key of authoredKeys) assert.equal(changed[key], original[key])
      for (const id of ['before', 'overlay']) assert.equal(getClip(id), before.clips.find(c => c.id === id))
      for (const id of ['after', 'last']) {
        const old = before.clips.find(c => c.id === id), moved = getClip(id)
        near(moved.startTime, old.startTime + durationDelta, 'following position')
        assert.deepEqual({ ...moved, startTime: old.startTime }, old)
      }
      near(getClip('after').startTime - changed.startTime - changed.duration, 12 / fps, 'existing gap retained')
      near(getClip('last').startTime - getClip('after').startTime - getClip('after').duration, 7 / fps, 'second gap retained')
      for (const key of ['playheadPosition', 'tracks', 'markers', 'transitions', 'inPoint', 'outPoint', 'duration']) {
        assert.equal(store.getState()[key], before[key], key)
      }
      for (let frame = 0; frame < Math.round(changed.duration * fps); frame++) {
        const localTime = frame / fps, originalLocal = localTime + (edge === 'left' ? pointerDelta : 0)
        const afterTime = getClipPlaybackTimingAtTimeline(changed, changed.startTime + localTime, 1e-6, { useFrameSampling: false })
        const beforeTime = getClipPlaybackTimingAtTimeline(original, original.startTime + originalLocal, 1e-6, { useFrameSampling: false })
        near(afterTime.rawTime, beforeTime.rawTime, 'retained raw source time')
        // A newly exposed reverse head remains an exclusive source Out. The
        // established playback helper retreats exactly 1 microsecond there;
        // the same interior sample was not an Out boundary before this trim.
        if (edge === 'left' && reverse && frame === 0) near(afterTime.time, beforeTime.rawTime - 1e-6, 'reverse head exclusive-Out guard')
        else if (originalLocal < original.duration - 1e-8) near(afterTime.time, beforeTime.time, 'retained bounded source time')
      }
      assert.equal(store.getState().history.length, 1)
      const changedClips = store.getState().clips
      store.getState().undo(); assertTiming(getClip('target'), original)
      store.getState().redo(); assertTiming(getClip('target'), changed)
      reload(fps); assertTiming(getClip('target'), changed)
      assert.equal(getClip('target').sourceFps, sourceFps)
      for (const expected of changedClips) assertTiming(getClip(expected.id), expected)
      assert.deepEqual(getClip('target').keyframes, original.keyframes)
    }
  }
})

test('linked picture/audio targets and downstream foreign-track mates preserve sync and envelope coordinates without moving separate music', () => {
  for (const edge of ['left', 'right']) for (const pointerDelta of [-0.5, 0.75]) {
    const primary = makeClip({ linkGroupId: 'take' })
    reset(primary)
    const dialogue = { ...makeClip(), id: 'dialogue', assetId: 'dialogue-source', type: 'audio', trackId: 'a1',
      linkGroupId: 'take', volumeEnvelope: structuredClone(envelope), fadeIn: 0.2, fadeOut: 0.3, gainDb: -3,
      audioEq: { version: 1, enabled: true, bassDb: 2, midDb: -1, trebleDb: 1, highPassEnabled: true } }
    const followPicture = makeClip({ id: 'follow-picture', assetId: 'later-source', startTime: 6, duration: 2,
      trimStart: 4, trimEnd: 6, linkGroupId: 'later', name: 'Following shot' })
    const followAudio = { ...followPicture, id: 'follow-audio', type: 'audio', trackId: 'a3', startTime: 5.75,
      volumeEnvelope: structuredClone(envelope), name: 'J-cut sound' }
    const music = { ...dialogue, id: 'music', assetId: 'music-source', trackId: 'a2', startTime: 0,
      duration: 20, trimStart: 0, trimEnd: 20, linkGroupId: undefined }
    store.setState(s => ({ clips: [...s.clips.filter(c => !['after', 'last'].includes(c.id)), dialogue, followPicture, followAudio, music] }))
    const before = store.getState(), originals = new Map(before.clips.map(c => [c.id, c])), token = begin(edge)
    apply(token, pointerDelta / 2); apply(token, 0); apply(token, pointerDelta)
    store.getState().endRippleTrim(token)
    const durationDelta = edge === 'left' ? -pointerDelta : pointerDelta
    for (const id of ['target', 'dialogue']) {
      const changed = getClip(id), original = originals.get(id)
      near(changed.duration, original.duration + durationDelta, 'paired duration')
      assert.equal(changed.startTime, original.startTime)
      assert.equal(changed.linkGroupId, original.linkGroupId)
      for (const key of authoredKeys) assert.equal(changed[key], original[key])
    }
    const changedAudio = getClip('dialogue')
    near(changedAudio.volumeEnvelope.offsetSeconds, envelope.offsetSeconds + (edge === 'left' ? pointerDelta : 0), 'one head-envelope offset')
    for (const time of [0, 0.4, 1, 1.75]) near(getAudioVolumeEnvelopeDb(changedAudio, time),
      getAudioVolumeEnvelopeDb(dialogue, time + (edge === 'left' ? pointerDelta : 0)), 'envelope at retained content')
    assert.deepEqual(changedAudio.volumeEnvelope.points, envelope.points)
    assert.equal(changedAudio.audioEq, dialogue.audioEq)
    for (const id of ['follow-picture', 'follow-audio']) {
      const changed = getClip(id), original = originals.get(id)
      near(changed.startTime, original.startTime + durationDelta, 'following linked shift')
      assert.deepEqual({ ...changed, startTime: original.startTime }, original)
      assert.equal(changed.volumeEnvelope, original.volumeEnvelope)
    }
    near(getClip('follow-audio').startTime - getClip('follow-picture').startTime, -0.25, 'J-cut offset retained')
    for (const id of ['before', 'overlay', 'music']) assert.equal(getClip(id), originals.get(id))
    for (const key of ['markers', 'playheadPosition', 'inPoint', 'outPoint']) assert.equal(store.getState()[key], before[key])
    const changedClips = store.getState().clips
    store.getState().undo()
    // Normal history JSON-normalizes unlimited durations and removes undefined
    // fields. Compare the complete durable document, not those runtime forms.
    assert.deepEqual(JSON.parse(JSON.stringify(store.getState().clips)), JSON.parse(JSON.stringify(before.clips)))
    store.getState().redo()
    reload(24)
    for (const expected of changedClips) {
      const loaded = getClip(expected.id)
      assertTiming(loaded, expected)
      assert.equal(loaded.linkGroupId, expected.linkGroupId)
      if (expected.volumeEnvelope) assert.deepEqual(loaded.volumeEnvelope, expected.volumeEnvelope)
    }
  }
})

test('unlimited generators ripple beyond original source bounds and remain portable after JSON normalization', () => {
  for (const type of ['image', 'text', 'shape', 'adjustment']) for (const edge of ['left', 'right']) {
    for (const sourceDuration of [Infinity, null]) {
      reset(makeClip({ type, sourceDuration, trimStart: 0, trimEnd: 3 }))
      const before = store.getState(), token = begin(edge)
      apply(token, edge === 'left' ? -4 : 4); store.getState().endRippleTrim(token)
      const changed = getClip('target')
      near(changed.duration, 7, 'generator extension')
      assert.ok(changed.trimStart >= 0 && changed.trimEnd > changed.trimStart)
      assert.equal(changed.startTime, 2)
      near(getClip('after').startTime, before.clips.find(c => c.id === 'after').startTime + 4, 'generator followers')
      reload(24); assertTiming(getClip('target'), changed)
    }
  }
})

test('target full bakes stale by signature while moved follower bakes and covered source caches remain reusable', () => {
  for (const edge of ['left', 'right']) {
    const cache = { version: OPTICAL_FLOW_CACHE_VERSION, engine: OPTICAL_FLOW_CACHE_ENGINE,
      modelName: OPTICAL_FLOW_CACHE_MODEL, status: 'ready', path: 'cache/source-rife.mp4', url: 'blob:rife',
      sourceStart: 0, sourceEnd: 40, targetFps: 48, sourceSignature: 'synthetic-source' }
    let primary = makeClip({ cacheStatus: 'cached', cacheKind: 'full', cacheUrl: 'blob:full-bake',
      cachePath: 'cache/full.mp4', frameSampling: 'optical-flow', opticalFlowCache: cache })
    primary = { ...primary, cacheSignature: getClipBakeSignature(primary) }
    reset(primary)
    let follower = { ...primary, id: 'follower', startTime: 6 }
    follower = { ...follower, cacheSignature: getClipBakeSignature(follower) }
    store.setState(s => ({ clips: [...s.clips.filter(c => !['after', 'last'].includes(c.id)), follower] }))
    assert.ok(isFullBakeFresh(getClip('target')) && isFullBakeFresh(getClip('follower')))
    const token = begin(edge); apply(token, 0.5); store.getState().endRippleTrim(token)
    assert.equal(isFullBakeFresh(getClip('target')), false)
    assert.equal(isFullBakeFresh(getClip('follower')), true)
    assert.equal(getClip('target').opticalFlowCache, cache)
    assert.equal(getClip('follower').opticalFlowCache, cache)
    assert.ok(isOpticalFlowCacheUsable(getClip('target')) && isOpticalFlowCacheUsable(getClip('follower')))
    assert.equal(getClip('target').cachePath, primary.cachePath)
    store.getState().undo()
    assert.ok(isFullBakeFresh(getClip('target')) && isFullBakeFresh(getClip('follower')))
  }
})

test('real downstream between/edge transition records move with their shots and survive Undo, reload and transition removal', () => {
  for (const edge of ['left', 'right']) {
    reset()
    const first = makeClip({ id: 'following-a', startTime: 6, duration: 2, trimStart: 2, trimEnd: 4 })
    const second = makeClip({ id: 'following-b', startTime: 8, duration: 2, trimStart: 5, trimEnd: 7 })
    store.setState(s => ({ clips: [...s.clips.filter(c => !['after', 'last'].includes(c.id)), first, second] }))
    const between = store.getState().addTransition(first.id, second.id, 'dissolve', 0.5)
    const tail = store.getState().addEdgeTransition(second.id, 'out', 'fade-black', 0.5)
    assert.ok(between && tail, 'fixture uses actual transition constructors')
    store.setState({ selectedClipIds: ['target'], history: [], historyIndex: -1, historyLastChangedAt: 0 })
    const before = store.getState(), token = begin(edge)
    apply(token, 0.5); store.getState().endRippleTrim(token)
    const durationDelta = edge === 'left' ? -0.5 : 0.5
    const changed = store.getState(), movedBetween = changed.transitions.find(t => t.id === between.id)
    for (const field of ['editPoint', 'originalClipAEnd', 'originalClipBStart']) {
      near(movedBetween[field], between[field] + durationDelta, field)
    }
    for (const field of ['duration', 'originalClipADuration', 'originalClipATrimEnd', 'originalClipBDuration', 'originalClipBTrimStart']) {
      assert.equal(movedBetween[field], between[field], field)
    }
    assert.deepEqual(changed.transitions.find(t => t.id === tail.id), tail)
    assert.equal(changed.history.length, 1)
    store.getState().undo(); assert.deepEqual(store.getState().transitions, before.transitions)
    store.getState().redo(); assert.deepEqual(store.getState().transitions, changed.transitions)
    reload(24)
    assert.deepEqual(store.getState().transitions, changed.transitions)
    store.getState().removeTransition(between.id)
    near(getClip(first.id).startTime, first.startTime + durationDelta, 'first shot stays moved after transition removal')
    near(getClip(second.id).startTime, second.startTime + durationDelta, 'second shot stays moved after transition removal')
    assert.equal(getClip(first.id).trimEnd, first.trimEnd)
    assert.equal(getClip(second.id).trimStart, second.trimStart)
  }
})
