import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import vm from 'node:vm'
import { buildSync } from 'esbuild'
import { getCompoundRenderState } from '../src/utils/compoundPlayback.mjs'
import { normalizeAdjustmentSettings } from '../src/utils/adjustments.js'
import * as sampling from '../src/utils/frameSampling.js'

const compositeModule = { exports: {} }
const compositeCode = buildSync({ entryPoints: [new URL('../src/utils/layerCompositing.js', import.meta.url).pathname],
  bundle: true, write: false, format: 'cjs', platform: 'node' }).outputFiles[0].text
Function('module', 'exports', compositeCode)(compositeModule, compositeModule.exports)
const { normalizeClipCompositeMode } = compositeModule.exports

const previewSource = fs.readFileSync(new URL('../src/services/previewCache.js', import.meta.url), 'utf8')
const computeSignature = vm.runInNewContext(previewSource.slice(previewSource.indexOf('const CACHE_DIR'),
  previewSource.indexOf('/**\n * Get the relative path'))
  .replaceAll('export function ', 'function ') + '\ncomputePreviewSignature', {
    getCompoundRenderState, normalizeAdjustmentSettings, normalizeClipCompositeMode,
    getFrameSamplingSignature: sampling.getFrameSamplingSignature,
    useAssetsStore: { getState: () => ({ assets: [] }) },
  })
function state() {
  return { timelineFps: 24, duration: 20, tracks: [{ id: 'root', type: 'video' }], transitions: [],
    assets: [{ id: 'media', type: 'video', path: 'assets/source.mp4' }],
    clips: [{ id: 'parent', type: 'compound', name: 'Intro', trackId: 'root', startTime: 5, duration: 3, trimStart: 1,
      compound: { version: 1, document: { fps: 24, width: 1920, height: 1080, duration: 6,
        tracks: [{ id: 'v', type: 'video' }], transitions: [], clips: [{ id: 'child', type: 'video', trackId: 'v',
          assetId: 'media', startTime: 0, duration: 6, trimStart: 0, trimEnd: 6, sourceDuration: 6,
          transform: { scaleX: 100, scaleY: 100, opacity: 100 } }] } } }] }
}

test('compound preview signature invalidates on child edits, child media relink and outer windows, not playhead changes', () => {
  const input = state(), initial = computeSignature('timeline', input)
  assert.ok(initial)
  assert.equal(computeSignature('timeline', { ...input, playheadPosition: 10 }), initial)
  for (const change of [
    s => { s.clips[0].compound.document.clips[0].transform.scaleX = 120 },
    s => { s.clips[0].compound.document.clips[0].keyframes = { positionX: [{ time: 0, value: 22 }] } },
    s => { s.assets[0].path = 'assets/relinked.mp4' },
    s => { s.clips[0].trimStart = 2 },
    s => { s.clips[0].duration = 2 },
    s => { s.clips[0].startTime = 7 },
  ]) {
    const next = structuredClone(input); change(next)
    assert.notEqual(computeSignature('timeline', next), initial)
  }
  const malformed = state(); malformed.clips[0].compound.version = 9
  assert.notEqual(computeSignature('timeline', malformed), computeSignature('timeline', { ...malformed, clips: [] }),
    'a broken container must not reuse an empty timeline proxy')
})

const hydrationSource = fs.readFileSync(new URL('../src/services/opticalFlowCache.js', import.meta.url), 'utf8')
function hydrationFixture() {
  const clip = { id: 'child', assetId: 'media', type: 'video', startTime: 0, duration: 6,
    keyframes: { positionX: [{ time: 0, value: 12 }] }, opticalFlowCache: {
      status: 'hydrating', path: 'cache/optical_flow_child.mp4', sourceSignature: 'source-signature',
      version: sampling.OPTICAL_FLOW_CACHE_VERSION, engine: sampling.OPTICAL_FLOW_CACHE_ENGINE,
      modelName: sampling.OPTICAL_FLOW_CACHE_MODEL,
    } }
  let timeline = { timelineSessionId: 'one', clips: [{ id: 'parent', type: 'compound',
    compound: { version: 1, document: { clips: [clip] } } }] }
  let project = { currentProjectHandle: '/project' }, asset = { id: 'media', path: 'assets/source.mp4' }, writes = 0
  let release
  const pending = new Promise(resolve => { release = resolve })
  const store = { getState: () => timeline, setState: change => { timeline = { ...timeline, ...change(timeline) }; writes++ } }
  const hydration = vm.runInNewContext(hydrationSource.slice(hydrationSource.indexOf('export async function hydrateOpticalFlowCaches'),
    hydrationSource.indexOf('export function getOpticalFlowClipStatus')).replace('export async function', 'async function')
      + '\nhydrateOpticalFlowCaches', {
    ...sampling, isElectron: () => true, useTimelineStore: store,
    useAssetsStore: { getState: () => ({ getAssetById: () => asset }) }, useProjectStore: { getState: () => project },
    getAssetSourceIdentity: value => JSON.stringify(value), resolveAssetSourcePath: async () => '/project/assets/source.mp4',
    buildSourceSignature: async () => 'source-signature', getProjectFileUrl: async () => 'blob:verified',
    errorMessage: error => String(error),
    window: { electronAPI: { pathJoin: () => pending, exists: async () => true } },
  })
  return { clip, hydrate: () => hydration('/project'), release: () => release('/project/cache/optical_flow_child.mp4'),
    get timeline() { return timeline }, set timeline(value) { timeline = value },
    get writes() { return writes }, set project(value) { project = value }, set asset(value) { asset = value } }
}

test('nested Optical Flow hydration verifies the cache and changes no authored data', async () => {
  const fixture = hydrationFixture(), before = structuredClone(fixture.timeline)
  const pending = fixture.hydrate(); fixture.release(); await pending
  const next = fixture.timeline.clips[0].compound.document.clips[0]
  assert.equal(next.opticalFlowCache.status, 'ready')
  assert.equal(next.opticalFlowCache.url, 'blob:verified')
  assert.equal(fixture.writes, 1)
  assert.deepEqual({ ...next, opticalFlowCache: before.clips[0].compound.document.clips[0].opticalFlowCache },
    before.clips[0].compound.document.clips[0])
  assert.equal(fixture.clip.opticalFlowCache.status, 'hydrating', 'captured history object stays untouched')
})

test('deferred compound hydration cannot write after navigation, removal, replacement, relink or a new cache job', async () => {
  for (const change of [
    f => { f.timeline = { ...f.timeline, timelineSessionId: 'two' } },
    f => { f.project = { currentProjectHandle: '/other-project' } },
    f => { f.timeline = { ...f.timeline, clips: [] } },
    f => { f.timeline.clips[0].compound.document.clips[0].assetId = 'replacement' },
    f => { f.asset = { id: 'media', path: 'assets/new-source.mp4' } },
    f => { f.timeline.clips[0].compound.document.clips[0].opticalFlowCache.jobId = 'new-job' },
    f => { f.timeline.clips[0].compound.document.clips[0].opticalFlowCache.path = 'cache/new.mp4' },
  ]) {
    const fixture = hydrationFixture(), pending = fixture.hydrate()
    fixture.timeline = structuredClone(fixture.timeline)
    change(fixture); fixture.release(); await pending
    assert.equal(fixture.writes, 0)
  }
})
