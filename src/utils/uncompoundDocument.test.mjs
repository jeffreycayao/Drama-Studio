import test from 'node:test'
import assert from 'node:assert/strict'
import { buildUncompoundPlan } from './uncompoundDocument.mjs'
import { getClipPlaybackTimingAtTimeline } from './clipPlaybackTiming.js'
import { getValueAtTime } from './keyframes.js'
import { getAudioClipFadeGain } from './audioClipFades.js'
import { getAudioVolumeEnvelopeDb } from './audioVolumeEnvelope.mjs'
import { OPTICAL_FLOW_CACHE_VERSION, OPTICAL_FLOW_CACHE_ENGINE, OPTICAL_FLOW_CACHE_MODEL } from './frameSampling.js'

const clip = (patch = {}) => ({ id: 'child-video', type: 'video', name: 'Take', trackId: 'inner-video', startTime: 0,
  duration: 4, sourceDuration: 20, sourceTimeScale: 1, speed: 1, reverse: false, trimStart: 2, trimEnd: 6,
  timelineFps: 24, sourceFps: 24, ...patch })
const parent = (patch = {}, children = [clip()]) => ({ id: 'compound', name: 'Scene', type: 'compound', trackId: 'video-1',
  startTime: 10, duration: 4, trimStart: 0, trimEnd: 4, sourceDuration: 8, speed: 1, sourceTimeScale: 1,
  compound: { version: 1, document: { fps: 24, width: 1920, height: 1080, duration: 8,
    clips: children, tracks: [{ id: 'inner-video', name: 'Picture', type: 'video' },
      { id: 'inner-audio', name: 'Dialogue', type: 'audio', volume: 80, pan: -25, muted: false, channels: 'stereo' }],
    transitions: [], markers: [], masterAudioVolume: 100, masterAudioInserts: [] } }, ...patch })
const input = (target = parent(), patch = {}) => ({ clips: [target], tracks: [{ id: 'video-1', type: 'video' }, { id: 'audio-1', type: 'audio' }],
  clipId: target.id, fps: 24, clipCounter: 1, ...patch })
const plan = (target = parent(), patch) => buildUncompoundPlan(input(target, patch))

test('whole child restoration keeps metadata, fresh IDs, audio buses, stack placement, and unrelated references', () => {
  const video = clip({ linkGroupId: 'pair', effects: [{ id: 'effect-keep', type: 'blur', settings: { strength: 4 } }],
    keyframes: { opacity: [{ time: 0, value: 0 }, { time: 3, value: 100 }] }, metadata: { linkedAudioClipId: 'audio' } })
  const audio = clip({ id: 'audio', type: 'audio', trackId: 'inner-audio', linkGroupId: 'pair', gainDb: -3,
    audioEq: { version: 1, enabled: true, lowCut: true, bassDb: 2, midDb: -2, trebleDb: 0 },
    metadata: { linkedVideoClipId: video.id } })
  const target = parent({}, [video, audio]), other = clip({ id: 'other', trackId: 'video-1', startTime: 20 })
  const original = input(target, { clips: [target, other], clipCounter: 3 })
  const before = structuredClone(original), result = buildUncompoundPlan(original)
  assert.equal(result.ok, true, result.reason)
  assert.deepEqual(original, before)
  assert.equal(result.clips[0], other)
  assert.equal(result.tracks[1], original.tracks[0])
  assert.equal(result.tracks[2].name, 'Dialogue')
  assert.equal(result.tracks[2].pan, -25)
  const restored = result.clips.slice(1)
  assert.deepEqual(restored.map(item => item.startTime), [10, 10])
  assert.notEqual(restored[0].id, video.id)
  assert.equal(restored[0].effects[0].id, 'effect-keep')
  assert.notEqual(restored[0].effects, video.effects)
  assert.equal(restored[0].metadata.linkedAudioClipId, restored[1].id)
  assert.equal(restored[1].metadata.linkedVideoClipId, restored[0].id)
  assert.equal(restored[0].linkGroupId, restored[1].linkGroupId)
  assert.notEqual(restored[0].linkGroupId, 'pair')
  assert.deepEqual(restored[1].audioEq, audio.audioEq)
  assert.equal(result.clips.some(item => item.type === 'compound'), false)
})

test('head and tail crops create real visible tiles, exact eased/Bezier keyframes and source-mask timing', () => {
  const child = clip({ effects: [{ id: 'mask', type: 'mask', enabled: true, maskAssetId: 'maskAsset' }],
    shapeMask: { enabled: true, width: 70 }, keyframes: { positionX: [
      { time: -1, value: 0, easing: 'cubic-bezier(0.25,0.1,0.25,1)' }, { time: 3, value: 150, easing: 'easeIn' }, { time: 6, value: 0 },
    ] } })
  const target = parent({ trimStart: 1, trimEnd: 3, duration: 2, startTime: 0 }, [child])
  const result = plan(target)
  assert.equal(result.ok, true, result.reason)
  const restored = result.clips[0]
  assert.equal(restored.startTime, 0)
  assert.equal(restored.duration, 2)
  assert.equal(restored.trimStart, 3)
  assert.equal(restored.trimEnd, 5)
  assert.equal(restored.playbackWindowStart, undefined)
  assert.deepEqual(restored.keyframes.positionX.map(key => key.time), [-2, 2, 5])
  assert.equal(restored.effects[0].maskAssetId, 'maskAsset')
  for (let frame = 0; frame < 48; frame++) {
    const t = frame / 24
    assert.ok(Math.abs(getValueAtTime(restored.keyframes.positionX, t) - getValueAtTime(child.keyframes.positionX, t + 1)) < 1e-7)
    assert.ok(Math.abs(getClipPlaybackTimingAtTimeline(restored, t).time - getClipPlaybackTimingAtTimeline(child, t + 1).time) < 1e-7)
  }
  assert.equal(plan(parent({ trimStart: 1, trimEnd: 3, duration: 2 }, [{ ...child, sourceDuration: undefined }])).ok, false)
  assert.equal(plan(parent({ trimStart: 1, trimEnd: 3, duration: 2 }, [{ ...child, type: 'image', sourceDuration: Infinity }])).ok, true)
})

test('cropped audio preserves safe edge fades, gain, EQ and the offscreen volume-envelope coordinate', () => {
  const audio = clip({ type: 'audio', trackId: 'inner-audio', fadeIn: 0.5, fadeOut: 0.5, gainDb: -7,
    volumeEnvelope: { version: 1, offsetSeconds: 2, points: [{ id: 'p', time: -2, db: -9 }, { id: 'q', time: 7, db: 2 }] },
    audioEq: { version: 1, enabled: true, lowCut: false, bassDb: 3, midDb: -1, trebleDb: 2 } })
  const result = plan(parent({ duration: 3, trimStart: 1, trimEnd: 4 }, [audio]))
  assert.equal(result.ok, true, result.reason)
  const restored = result.clips[0]
  assert.equal(restored.fadeIn, 0)
  assert.equal(restored.fadeOut, 0.5)
  assert.equal(restored.gainDb, -7)
  assert.deepEqual(restored.audioEq, audio.audioEq)
  for (let index = 0; index < 72; index++) {
    const local = index / 24
    assert.ok(Math.abs(getAudioVolumeEnvelopeDb(restored, local) - getAudioVolumeEnvelopeDb(audio, local + 1)) < 1e-12)
    assert.ok(Math.abs(getAudioClipFadeGain(restored, local) - getAudioClipFadeGain(audio, local + 1)) < 1e-12)
  }
})

test('visible child markers map to root without losing root markers, and omitted contents are reported', () => {
  const target = parent({ trimStart: 1, trimEnd: 3, duration: 2 }, [clip(), clip({ id: 'outside', startTime: 6 })])
  target.compound.document.markers = [{ id: 'marker-1', time: 0 }, { id: 'marker-2', time: 1, label: 'Head' },
    { id: 'marker-3', time: 3, label: 'Tail' }, { id: 'marker-4', time: 4 }]
  const rootMarker = { id: 'marker-2', time: 40, label: 'Root' }
  const result = plan(target, { markers: [rootMarker], markerCounter: 1 })
  assert.equal(result.ok, true, result.reason)
  assert.equal(result.markers[2], rootMarker)
  assert.deepEqual(result.markers.slice(0, 2).map(item => item.time), [10, 12])
  assert.deepEqual(result.markers.slice(0, 2).map(item => item.id), ['marker-5', 'marker-6'])
  assert.equal(result.markerCounter, 7)
  assert.equal(result.summary.omittedMarkerCount, 2)
  assert.equal(result.summary.omittedClipCount, 1)
  assert.equal(result.summary.markerCount, 2)
})

test('fresh identifiers avoid reused root, nested, marker and linked-group identifiers', () => {
  const target = parent({}, [clip({ id: 'clip-9', linkGroupId: 'group' })])
  const result = plan(target, { clipCounter: 1, markers: [{ id: 'clip-10', time: 30 }] })
  assert.equal(result.ok, true, result.reason)
  assert.equal(result.clips[0].id, 'clip-11')
  assert.equal(result.clipCounter, 12)
  assert.equal(new Set(result.tracks.map(track => track.id)).size, result.tracks.length)
})

test('valid source Optical Flow remains selected and mapped after safe partial crop; full bakes detach', () => {
  const cache = { version: OPTICAL_FLOW_CACHE_VERSION, engine: OPTICAL_FLOW_CACHE_ENGINE, modelName: OPTICAL_FLOW_CACHE_MODEL,
    status: 'ready', path: 'cache/rife.mp4', url: 'blob:interpolated', sourceStart: 0, sourceEnd: 10, targetFps: 48 }
  const child = clip({ frameSampling: 'optical-flow', opticalFlowCache: cache,
    cacheStatus: 'cached', cacheUrl: 'blob:full', cachePath: 'cache/full.webm' })
  const result = plan(parent({ trimStart: 1, trimEnd: 3, duration: 2 }, [child]))
  assert.equal(result.ok, true, result.reason)
  const restored = result.clips[0]
  assert.deepEqual(restored.opticalFlowCache, cache)
  assert.equal(restored.cacheUrl, null)
  for (const local of [0, 0.5, 1, 1.95]) {
    const oldTime = getClipPlaybackTimingAtTimeline(child, 1 + local)
    const newTime = getClipPlaybackTimingAtTimeline(restored, 10 + local)
    assert.equal(newTime.usingOpticalFlow, true)
    assert.ok(Math.abs(oldTime.time - newTime.time) < 1e-7)
  }
})

test('whole ramps and temporal effects retain their complete clocks; partial unsafe crops refuse', () => {
  for (const patch of [{ keyframes: { speed: [{ time: 0, value: 1 }, { time: 4, value: 2 }] } },
    { effects: [{ id: 'seed', type: 'cameraShake' }] }, { effects: [{ id: 'seed', type: 'glslFilmGrain' }] },
    { transform: { motionBlurEnabled: true } }]) {
    assert.equal(plan(parent({}, [clip(patch)])).ok, true)
    assert.equal(plan(parent({ trimStart: 1, trimEnd: 3, duration: 2 }, [clip(patch)])).ok, false)
  }
  const bakedPreset = clip({ type: 'text', titleAnimation: { presetId: 'fade' }, keyframes: { opacity: [{ time: 0, value: 0 }, { time: 1, value: 100 }] } })
  assert.equal(plan(parent({ trimStart: 1, trimEnd: 3, duration: 2 }, [bakedPreset])).ok, true)
})

test('fade cut-throughs and changed reverse-head/slow-tail clamp samples reject', () => {
  for (const child of [clip({ type: 'audio', trackId: 'inner-audio', fadeIn: 2 }), clip({ type: 'audio', trackId: 'inner-audio', fadeOut: 2 }),
    clip({ reverse: true }), clip({ speed: 0.1, trimEnd: 2.4 })]) {
    assert.equal(plan(parent({ trimStart: 1, trimEnd: 3, duration: 2 }, [child])).ok, false)
  }
  const reverse = clip({ reverse: true })
  const result = plan(parent({ duration: 3, trimEnd: 3 }, [reverse]))
  assert.equal(result.ok, true, result.reason)
  for (let frame = 0; frame < 72; frame++) {
    assert.ok(Math.abs(getClipPlaybackTimingAtTimeline(reverse, frame / 24).time
      - getClipPlaybackTimingAtTimeline(result.clips[0], 10 + frame / 24).time) < 1e-7)
  }
})

test('legacy source scales, freeze trims and noncanonical whole spans refuse save/load-changing restoration', () => {
  for (const child of [clip({ sourceTimeScale: 2, trimEnd: 10 }), clip({ sourceTimeScale: undefined, sourceFps: 12, trimEnd: 10 }),
    clip({ trimEnd: 4 }), clip({ trimEnd: 8 })]) assert.equal(plan(parent({}, [child])).ok, false)
})

test('locks, jobs, solos, inactive parent, transitions, nested documents and focused-only shapes fail closed', () => {
  for (const target of [parent({ locked: true }), parent({ enabled: false }), parent({}, [clip({ syncLocked: true })]),
    parent({}, [clip({ cacheStatus: 'rendering' })]), parent({}, [clip({ opticalFlowCache: { status: 'hydrating' } })]),
    parent({}, [clip({ type: 'compound' })])]) assert.equal(plan(target).ok, false)
  assert.equal(plan(parent(), { tracks: [{ id: 'video-1', type: 'video', solo: true }] }).ok, false)
  assert.equal(plan(parent(), { transitions: [{ clipId: 'compound' }] }).ok, false)
  assert.equal(plan(parent({ transform: { scaleX: 200 } })).ok, false)
})

test('invalid markers, subframe survivors and empty visible windows reject without a replacement state', () => {
  const targets = [parent({ trimStart: 6, trimEnd: 8, duration: 2 }), parent({ duration: 0.01, trimEnd: 0.01 }),
    parent({ startTime: 10.01 }), parent({ duration: 3.99, trimEnd: 3.99 })]
  const markerTarget = parent(); markerTarget.compound.document.markers = [{ id: 'marker', time: NaN }]
  targets.push(markerTarget)
  for (const target of targets) {
    const result = plan(target)
    assert.equal(result.ok, false)
    assert.equal(Object.hasOwn(result, 'clips'), false)
  }
})
