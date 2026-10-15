import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { buildSync } from 'esbuild'
import { watchStoreForProjectChanges, TIMELINE_PROJECT_KEYS, markProjectClean, isProjectDirty } from '../services/projectDirtyTracker.js'

const require = createRequire(import.meta.url)
const code = buildSync({ entryPoints: [fileURLToPath(new URL('../stores/timelineStore.js', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'zustand', 'zustand/*'],
}).outputFiles[0].text
const module = { exports: {} }
const writes = new Map()
Function('require', 'module', 'exports', 'localStorage', code)(require, module, module.exports,
  { getItem: () => null, setItem(key, value) { writes.set(key, value) }, removeItem() {} })
const store = module.exports.useTimelineStore
const initial = store.getState()
const clip = (patch = {}) => ({ id: 'child', type: 'video', assetId: 'source', name: 'Source', trackId: 'v1', startTime: 3, duration: 4,
  trimStart: 2, trimEnd: 6, sourceDuration: 20, sourceTimeScale: 1, speed: 1, reverse: false, timelineFps: 24, sourceFps: 24,
  transform: { positionX: 10, scaleX: 120 }, keyframes: { scaleX: [{ time: 0, value: 120 }] },
  opticalFlowCache: { path: 'cache/rife.mp4', status: 'ready', url: 'blob:decoded', progress: 100 }, ...patch })
const tracks = () => [{ id: 'v1', type: 'video' }, { id: 'a1', type: 'audio' }]
const reset = (patch = {}) => store.setState({ ...initial, clips: [clip()], tracks: tracks(), duration: 60,
  transitions: [], markers: [{ id: 'marker', time: 9 }], selectedClipIds: ['child'], timelineFps: 24,
  inPoint: 1, outPoint: 20, playheadPosition: 5, zoom: 150, history: [], historyIndex: -1, ...patch })
const request = () => ({ clipIds: ['child'], name: 'Scene', width: 1920, height: 1080 })
const noWrite = action => {
  const previous = store.getState()
  let count = 0
  const off = store.subscribe(() => count++)
  let result
  try { result = action() } finally { off() }
  assert.equal(count, 0)
  assert.equal(store.getState(), previous)
  return result
}
const create = () => {
  const input = request(), plan = noWrite(() => store.getState().previewCreateCompound(input))
  assert.equal(plan.ok, true, plan.reason)
  const result = store.getState().applyCreateCompound(input, plan.token)
  assert.equal(result.ok, true, result.reason)
  return store.getState().clips.find(item => item.id === result.clipId)
}
beforeEach(() => reset())
afterEach(() => reset())

test('create is one atomic checkpoint; stale preview cannot mutate', () => {
  const input = request(), plan = store.getState().previewCreateCompound(input)
  store.setState({ selectedClipIds: [] })
  assert.equal(noWrite(() => store.getState().applyCreateCompound(input, plan.token)).ok, false)
  reset()
  const parent = create()
  assert.equal(store.getState().history.length, 1)
  store.getState().undo()
  assert.equal(store.getState().clips[0].id, 'child')
  store.getState().redo()
  assert.equal(store.getState().clips[0].id, parent.id)
})

test('Open and unchanged Back restore exact parent references/UI/history without dirtying', () => {
  const parent = create(), before = store.getState()
  const off = watchStoreForProjectChanges(store, TIMELINE_PROJECT_KEYS)
  markProjectClean()
  assert.equal(store.getState().openCompound(parent.id, parent).ok, true)
  assert.equal(isProjectDirty(), false)
  assert.equal(store.getState().clips[0].opticalFlowCache.url, 'blob:decoded')
  assert.equal(store.getState().playheadPosition, 2)
  assert.equal(store.getState().closeCompound().changed, false)
  assert.equal(isProjectDirty(), false)
  for (const key of ['clips', 'tracks', 'markers', 'history', 'playheadPosition', 'zoom', 'selectedClipIds', 'inPoint', 'outPoint']) {
    assert.equal(store.getState()[key], before[key], key)
  }
  assert.equal(store.getState().timelineSessionId, before.timelineSessionId + 2)
  off()
})

test('child edits are saved inside root while focused, Back commits one checkpoint and supports Undo/Redo/reopen', () => {
  const parent = create()
  const oldHistoryLength = store.getState().history.length
  store.getState().openCompound(parent.id)
  store.getState().updateClipTransform('child', { positionX: 44 })
  store.getState().updateClipTransform('child', { positionX: 55 })
  const saved = store.getState().getProjectData()
  assert.equal(saved.clips[0].type, 'compound')
  assert.equal(saved.clips[0].duration, 4)
  assert.equal(saved.clips[0].compound.document.clips[0].transform.positionX, 55)
  assert.equal(saved.clips[0].compound.document.clips[0].opticalFlowCache.url, undefined)
  assert.equal(store.getState().getActiveDocumentData().clips[0].id, 'child')
  assert.equal(store.getState().closeCompound().changed, true)
  assert.equal(store.getState().history.length, oldHistoryLength + 1)
  store.getState().undo()
  assert.equal(store.getState().clips[0].compound.document.clips[0].transform.positionX, 10)
  store.getState().redo()
  const updated = store.getState().clips[0]
  assert.equal(updated.compound.document.clips[0].transform.positionX, 55)
  assert.equal(store.getState().openCompound(updated.id).ok, true)
  assert.equal(store.getState().clips[0].transform.positionX, 55)
})

test('child extent grows from child clips but never viewport padding or destructive shortening', () => {
  const parent = create()
  store.getState().openCompound(parent.id)
  store.setState({ duration: 500 })
  assert.equal(store.getState().getProjectData().clips[0].sourceDuration, 4)
  store.getState().moveClip('child', 'v1', 7)
  assert.equal(store.getState().getProjectData().clips[0].sourceDuration, 11)
  assert.equal(store.getState().getProjectData().clips[0].duration, 4)
  store.getState().closeCompound()
  store.getState().openCompound(parent.id)
  store.getState().removeClip('child')
  assert.equal(store.getState().getProjectData().clips[0].sourceDuration, 11)
})

test('parent trim is finite, move/rename/enable work, incompatible edit paths reject before history', () => {
  const parent = create()
  store.getState().moveClip(parent.id, 'v1', 10)
  store.getState().updateClipTrim(parent.id, { startTime: 11, trimStart: 1, duration: 3, trimEnd: 4 })
  assert.equal(store.getState().clips[0].trimStart, 1)
  store.getState().resizeClip(parent.id, 100)
  assert.equal(store.getState().clips[0].duration, 3)
  assert.equal(store.getState().renameCompound(parent.id, 'New Scene').changed, true)
  for (const action of [() => store.getState().updateClipSpeed(parent.id, 2),
    () => store.getState().updateClipTransform(parent.id, { scaleX: 200 }),
    () => store.getState().copySelectedClips(), () => store.getState().setTimelineFps(30)]) noWrite(action)
  assert.equal(store.getState().clips[0].name, 'New Scene')
})

test('parent overlap operations and child unsupported edits reject atomically', () => {
  const parent = create()
  noWrite(() => store.getState().addClip('v1', { id: 'new', type: 'image' }, 4))
  store.setState({ clips: [...store.getState().clips, clip({ id: 'ordinary', startTime: 10 })] })
  noWrite(() => store.getState().moveClip('ordinary', 'v1', 4))
  store.getState().openCompound(parent.id)
  for (const action of [() => store.getState().addAdjustmentClip('v1', 0),
    () => store.getState().setMasterAudioVolume(50), () => store.getState().toggleTrackSolo('v1'),
    () => store.getState().updateClipTransform('child', { blendMode: 'multiply' }),
    () => store.getState().updateClipCompositeMode('child', 'off'),
    () => store.getState().updateClipTrackMatte('child', { trackId: 'a1' })]) noWrite(action)
  assert.equal(noWrite(() => store.getState().previewCreateCompound(request())).ok, false)
})

test('load restores embedded cached descriptors as hydrating while preserving authored child timing', () => {
  const parent = create()
  const saved = store.getState().getProjectData()
  store.getState().loadFromProject(saved, [], 24)
  const child = store.getState().clips[0].compound.document.clips[0]
  assert.equal(child.opticalFlowCache.status, 'hydrating')
  assert.equal(child.opticalFlowCache.url, undefined)
  assert.equal(child.trimStart, 2)
  assert.deepEqual(child.keyframes, parent.compound.document.clips[0].keyframes)
})

test('cache hydration alone survives Back without an authored checkpoint', () => {
  const parent = create(), history = store.getState().history
  store.getState().openCompound(parent.id)
  store.getState().updateOpticalFlowCache('child', { status: 'ready', url: 'blob:new-hydrated' })
  assert.equal(store.getState().closeCompound().changed, false)
  assert.equal(store.getState().history, history)
  assert.equal(store.getState().clips[0].compound.document.clips[0].opticalFlowCache.url, 'blob:new-hydrated')
})

test('Back rejects active child render jobs without a write while the live root remains serializable', () => {
  const parent = create()
  store.getState().openCompound(parent.id)
  for (const patch of [{ cacheStatus: 'rendering' }, { opticalFlowCache: { status: 'building', jobId: 'job' } }]) {
    store.setState({ clips: [{ ...store.getState().clips[0], cacheStatus: 'none', ...patch }] })
    assert.equal(noWrite(() => store.getState().closeCompound()).ok, false)
    assert.equal(store.getState().getProjectData().clips[0].type, 'compound')
  }
})

test('multi-Inspector and Paste Attributes reject non-normal child blending before writes or history', () => {
  const parent = create()
  store.getState().openCompound(parent.id)
  store.setState({ clips: [...store.getState().clips, clip({ id: 'second', startTime: 10 })], selectedClipIds: ['child', 'second'] })
  for (const input of [{ clipIds: ['child', 'second'], property: 'blendMode', value: 'multiply' },
    { clipIds: ['child', 'second'], updates: { blendMode: 'screen' } }]) {
    assert.equal(noWrite(() => store.getState().applyMultiClipInspectorEdit(input)).ok, false)
  }
  store.getState().copySelectedClips()
  const clipboard = store.getState().attributeClipboard
  store.setState({ attributeClipboard: { ...clipboard, clips: clipboard.clips.map(item => ({ ...item,
    transform: { ...item.transform, blendMode: 'multiply' } })) } })
  const current = store.getState()
  const result = noWrite(() => current.applyPasteAttributes({ clipboardId: current.attributeClipboard.id, sourceId: 'child',
    clipIds: ['second'], groups: ['transform'], expectedClips: current.clips, expectedTracks: current.tracks }))
  assert.equal(result.ok, false)
})

test('project switch to the current timeline commits child once without reloading stale parent data', async () => {
  const source = readFileSync(new URL('../stores/projectStore.js', import.meta.url), 'utf8')
  const start = source.indexOf('      switchTimeline: async (timelineId) => {')
  const end = source.indexOf('\n      },', start)
  const body = source.slice(start, end).replace('      switchTimeline:', 'return') + '\n}'
  const parent = create()
  let projectState = { currentTimelineId: 'timeline-1', currentProject: { settings: { fps: 24 }, timelines: [
    { id: 'timeline-1', ...store.getState().getProjectData() },
    { id: 'timeline-2', clips: [], tracks: tracks(), duration: 60 },
  ] } }
  const switchTimeline = Function('get', 'set', 'useTimelineStore', 'finishCompoundFocus', 'hydrateActiveOpticalFlowCaches', body)(
    () => projectState, update => { projectState = { ...projectState, ...(typeof update === 'function' ? update(projectState) : update) } },
    store, () => !store.getState().compoundEditContext || store.getState().closeCompound().ok, () => {})
  store.getState().openCompound(parent.id)
  store.getState().updateClipTransform('child', { positionX: 81 })
  assert.equal(await switchTimeline('timeline-1'), true)
  assert.equal(store.getState().compoundEditContext, null)
  assert.equal(store.getState().clips[0].compound.document.clips[0].transform.positionX, 81)
  assert.equal(store.getState().history.length, 2)
  assert.equal(await switchTimeline('timeline-2'), true)
  assert.equal(projectState.currentProject.timelines[0].clips[0].compound.document.clips[0].transform.positionX, 81)
  assert.equal(store.getState().clips.length, 0)
})

test('active query accepts explicit render state and respects bounded playback windows', () => {
  const state = { clips: [clip({ startTime: 0, playbackWindowStart: 1, playbackWindowEnd: 2 })], tracks: tracks(), transitions: [] }
  assert.equal(store.getState().getActiveClipsAtTime(0.5, state).length, 0)
  assert.equal(store.getState().getActiveClipsAtTime(1.5, state).length, 1)
  assert.equal(store.getState().getActiveClipsAtTime(2, state).length, 0)
  assert.equal(store.getState().getActiveClipsAtTime(10, state).length, 0)
  assert.equal(store.getState().getTransitionAtTime(1, state), null)
})
