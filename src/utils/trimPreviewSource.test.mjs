import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveTrimPreviewSource } from './trimPreviewSource.js'
import {
  OPTICAL_FLOW_CACHE_ENGINE,
  OPTICAL_FLOW_CACHE_MODEL,
  OPTICAL_FLOW_CACHE_VERSION,
} from './frameSampling.js'

const video = (extra = {}) => ({
  id: 'clip', type: 'video', startTime: 10, duration: 3, trimStart: 2, trimEnd: 5,
  sourceDuration: 20, sourceFps: 24, timelineFps: 24, sourceTimeScale: 1,
  speed: 1, url: 'file:///source.mp4', ...extra,
})
const resolve = (clip, timelineTime = clip.startTime, extra = {}) => resolveTrimPreviewSource({ clip, timelineTime, ...extra })
const optical = (extra = {}) => ({
  version: OPTICAL_FLOW_CACHE_VERSION, engine: OPTICAL_FLOW_CACHE_ENGINE, modelName: OPTICAL_FLOW_CACHE_MODEL,
  status: 'ready', path: 'cache/optical.mp4', url: 'file:///optical.mp4', sourceStart: 1, sourceEnd: 6, targetFps: 48,
  ...extra,
})

test('first and last retained frames use timeline sampling, never the exclusive tail', () => {
  const clip = video()
  assert.equal(resolve(clip).time, 2)
  assert.ok(Math.abs(resolve(clip, 13 - 1 / 24).time - (5 - 1 / 24)) < 1e-12)
  assert.ok(Math.abs(resolve(clip, 13 - 1 / 24).sourceTime - (5 - 1 / 24)) < 1e-12)
})

test('reverse samples the inside of the source out point and advances backward', () => {
  const clip = video({ reverse: true })
  assert.equal(resolve(clip).time, 5 - 0.000001)
  assert.ok(Math.abs(resolve(clip, 13 - 1 / 24).time - (2 + 1 / 24)) < 1e-12)
})

test('constant speed and source timebase are applied exactly once', () => {
  const clip = video({ speed: 0.5, sourceTimeScale: 2 })
  assert.equal(resolve(clip, 11).time, 3)
  assert.equal(resolve(video({ speed: 0.25 }), 11).time, 2.25)
  assert.equal(resolve(video({ sourceFps: 60, timelineFps: 30, sourceTimeScale: null }), 11).time, 2.5)
})

test('speed ramp uses the same integrated mapping as playback', () => {
  const clip = video({ duration: 4, trimEnd: 20, keyframes: { speed: [{ time: 0, value: 1, easing: 'linear' }, { time: 4, value: 3 }] } })
  assert.ok(Math.abs(resolve(clip, 12).time - 5) < 1e-9)
})

test('fractional source FPS remains fractional for presented-frame matching', () => {
  const clip = video({ sourceFps: 30000 / 1001 })
  const result = resolve(clip, 10.25)
  assert.equal(result.fps, 30000 / 1001)
  assert.equal(result.time, 2.25)
})

test('valid Optical Flow URL and cache-local time stay paired', () => {
  const clip = video({ speed: 0.5, duration: 6, frameSampling: 'optical-flow', opticalFlowCache: optical() })
  const result = resolve(clip, 12)
  assert.equal(result.url, 'file:///optical.mp4')
  assert.equal(result.sourceTime, 3)
  assert.equal(result.time, 2)
  assert.equal(result.fps, 48)
  assert.equal(result.usingOpticalFlow, true)
})

test('stale, undersampled, reversed and insufficient-coverage Optical Flow falls back without shifting source time', () => {
  const variants = [
    { opticalFlowCache: optical({ status: 'stale' }) },
    { opticalFlowCache: optical({ targetFps: 24 }) },
    { opticalFlowCache: optical({ sourceStart: 2 }) },
    { opticalFlowCache: optical({ sourceEnd: 4 }) },
    { opticalFlowCache: optical(), reverse: true },
  ]
  for (const extra of variants) {
    const clip = video({ speed: 0.5, duration: 6, frameSampling: 'optical-flow', ...extra })
    const result = resolve(clip, 12)
    assert.equal(result.url, clip.url)
    assert.equal(result.time, result.sourceTime)
    assert.equal(result.usingOpticalFlow, false)
    assert.match(result.note, /Optical Flow unavailable/)
  }
})

test('derivative precedence honors proxy toggle and validity independently', () => {
  const asset = { url: 'file:///asset.mp4', proxyUrl: 'file:///proxy.mp4', playbackCacheUrl: 'file:///playback.mp4' }
  const args = { asset, proxyUsable: true, playbackCacheUsable: true }
  assert.equal(resolve(video(), 10, args).mode, 'playback-cache')
  assert.equal(resolve(video(), 10, { ...args, useProxyPlaybackForAssets: true }).mode, 'proxy')
  assert.equal(resolve(video(), 10, { ...args, playbackCacheUsable: false }).url, asset.url)
  assert.equal(resolve(video(), 10, { ...args, proxyUsable: false, useProxyPlaybackForAssets: true }).mode, 'playback-cache')
})

test('alpha sources never silently use opaque derivatives', () => {
  const clip = video({ speed: 0.5, duration: 6, frameSampling: 'optical-flow', opticalFlowCache: optical() })
  const asset = { settings: { hasAlpha: true }, url: 'file:///alpha.webm', proxyUrl: 'file:///proxy.mp4', playbackCacheUrl: 'file:///playback.mp4' }
  const result = resolve(clip, 12, { asset, proxyUsable: true, playbackCacheUsable: true, useProxyPlaybackForAssets: true })
  assert.equal(result.url, asset.url)
  assert.equal(result.time, 3)
  assert.equal(result.usingOpticalFlow, false)
})

test('render bakes are ignored, frame blend is clearly source-only, and inputs are not mutated', () => {
  const clip = video({ frameSampling: 'blend', cacheStatus: 'cached', cacheKind: 'full', cacheUrl: 'file:///baked.mp4' })
  const before = JSON.stringify(clip)
  const result = resolve(clip)
  assert.equal(result.url, clip.url)
  assert.match(result.note, /blending not shown/)
  assert.equal(JSON.stringify(clip), before)
})

test('images, unsupported clip types, missing media and malformed timing fail honestly', () => {
  assert.equal(resolve({ type: 'image', url: 'blob:picture' }).kind, 'image')
  assert.equal(resolve({ type: 'image' }).kind, 'unavailable')
  for (const type of ['text', 'shape', 'captions', 'audio', 'adjustment', 'future']) {
    assert.equal(resolve({ type }).kind, 'timing-only')
  }
  assert.equal(resolve(video({ url: null })).kind, 'unavailable')
  assert.equal(resolve(video(), NaN).kind, 'unavailable')
  assert.equal(resolveTrimPreviewSource().kind, 'unavailable')
})
