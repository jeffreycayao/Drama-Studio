import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const require = createRequire(import.meta.url)
const code = buildSync({ entryPoints: [fileURLToPath(new URL('../stores/timelineStore.js', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'zustand', 'zustand/*'],
}).outputFiles[0].text
const module = { exports: {} }
Function('require', 'module', 'exports', 'localStorage', code)(require, module, module.exports,
  { getItem: () => null, setItem() {}, removeItem() {} })
const store = module.exports.useTimelineStore
const initial = store.getState()
const source = (patch = {}) => ({ id: 'new', name: 'Replacement', type: 'video', duration: 20,
  url: 'blob:new', settings: { fps: 24 }, ...patch })
const clip = (patch = {}) => ({ id: 'clip', name: 'Keep label', assetId: 'old', type: 'video', trackId: 'v1',
  startTime: 2, duration: 4, sourceDuration: 12, trimStart: 1, trimEnd: 5,
  timelineFps: 24, sourceFps: 24, sourceTimeScale: 1, speed: 1, reverse: false,
  transform: { scaleX: 120 }, adjustments: { saturation: 0.8 }, effects: [{ id: 'e', type: 'blur', enabled: false }],
  keyframes: { positionX: [{ time: 0, value: 30 }] }, metadata: { user: 'keep' },
  cacheStatus: 'cached', cacheUrl: 'blob:old-cache', cachePath: 'cache/old.webm', cacheKind: 'full', cacheSignature: 'old', cacheProgress: 100,
  opticalFlowCache: { status: 'ready', path: 'cache/old-rife.mp4', url: 'blob:old-rife', sourceStart: 0, sourceEnd: 8 },
  ...patch })
const tracks = () => [{ id: 'v1', type: 'video' }, { id: 'a1', type: 'audio' }]
const reset = (patch = {}) => store.setState({ ...initial, clips: [clip()], tracks: tracks(),
  transitions: [], markers: [{ id: 'marker', time: 12 }], selectedClipIds: ['clip'], timelineFps: 24,
  inPoint: 1, outPoint: 20, playheadPosition: 7, history: [], historyIndex: -1, ...patch })
const target = () => store.getState().clips.find(item => item.id === 'clip')
const request = (patch = {}) => ({ clipId: 'clip', asset: source(), ...patch })
function noWrite(action) {
  const before = store.getState()
  let writes = 0
  const unsubscribe = store.subscribe(() => { writes++ })
  let result
  try { result = action() } finally { unsubscribe() }
  assert.equal(writes, 0)
  assert.equal(store.getState(), before)
  return result
}
const preview = input => noWrite(() => store.getState().previewSmartReplace(input))
const apply = input => {
  const plan = preview(input)
  assert.equal(plan.ok, true, plan.reason)
  return store.getState().applySmartReplace(input, plan.token)
}
beforeEach(() => reset())
// Leave a serializable document for the store's pending debounced persistence
// write, including after the deliberate malformed-checkpoint fixture below.
afterEach(() => reset())

test('preview is read-only and one apply atomically changes one clip plus one history checkpoint', () => {
  const original = target()
  const mate = clip({ id: 'mate', type: 'audio', trackId: 'a1', linkGroupId: 'linked' })
  const other = clip({ id: 'other', startTime: 20 })
  reset({ clips: [{ ...original, linkGroupId: 'linked' }, mate, other], selectedClipIds: ['clip', 'mate'] })
  const before = store.getState()
  const input = request()
  const plan = preview(input)
  assert.equal(plan.ok, true)
  assert.equal(Object.hasOwn(plan, 'updates'), false, 'private updates cannot be tampered with through the public preview')
  assert.deepEqual(plan.summary.linkedCompanionsUnchanged, ['mate'])
  let writes = 0
  const unsubscribe = store.subscribe(() => { writes++ })
  const result = store.getState().applySmartReplace(input, plan.token)
  unsubscribe()
  assert.equal(result.ok, true)
  assert.equal(result.changed, true)
  assert.equal(writes, 1)
  assert.equal(store.getState().history.length, 1)
  assert.equal(target().assetId, 'new')
  assert.equal(store.getState().clips[1], mate)
  assert.equal(store.getState().clips[2], other)
  for (const key of ['tracks', 'transitions', 'markers', 'selectedClipIds', 'playheadPosition', 'inPoint', 'outPoint', 'duration', 'clipCounter']) {
    assert.equal(store.getState()[key], before[key], key)
  }
  for (const key of ['name', 'duration', 'startTime', 'keyframes', 'effects', 'adjustments', 'transform', 'metadata']) {
    assert.equal(target()[key], before.clips[0][key], key)
  }
  assert.equal(target().cacheStatus, 'none')
  assert.equal(target().cacheUrl, null)
  assert.equal(target().cachePath, null)
  assert.equal(target().opticalFlowCache, undefined)
  assert.equal(noWrite(() => store.getState().applySmartReplace(input, plan.token)).ok, false, 'token is single use')
})

test('same-source no-op preview and apply do not dirty the document or create history', () => {
  const input = request({ asset: source({ id: 'old' }) })
  const plan = preview(input)
  assert.equal(plan.changed, false)
  assert.equal(noWrite(() => store.getState().applySmartReplace(input, plan.token)).changed, false)
  assert.equal(store.getState().history.length, 0)
})

test('too-short, incompatible, missing, locked, playing and malformed requests never write', () => {
  for (const input of [request({ asset: source({ duration: 4 }) }), request({ asset: source({ type: 'image' }) }),
    request({ clipId: 'missing' }), request({ asset: null }), request({ sourceInSeconds: NaN })]) {
    assert.equal(preview(input).ok, false)
  }
  for (const patch of [{ clips: [clip({ locked: true })] }, { tracks: [{ id: 'v1', type: 'video', locked: true }] }, { isPlaying: true }]) {
    reset(patch)
    assert.equal(preview(request()).ok, false)
  }
  assert.equal(noWrite(() => store.getState().applySmartReplace(request(), {})).ok, false)
})

test('every bound timeline identity invalidates a preview without adding history', () => {
  for (const key of ['clips', 'tracks', 'transitions', 'markers', 'timelineFps', 'timelineSessionId', 'history', 'historyIndex', 'duration', 'isPlaying', 'selectedClipIds']) {
    reset()
    const input = request()
    const plan = preview(input)
    const old = store.getState()[key]
    store.setState({ [key]: Array.isArray(old) ? [...old] : typeof old === 'boolean' ? !old : old + 1 })
    assert.equal(noWrite(() => store.getState().applySmartReplace(input, plan.token)).ok, false, key)
  }
})

test('asset metadata, duration, URL or requested In changes invalidate a preview', () => {
  for (const mutate of [input => { input.asset.url = 'blob:changed' }, input => { input.asset.duration = 3 },
    input => { input.asset.settings.fps = 60 }, input => { input.asset.id = 'different' }, input => { input.sourceInSeconds = 0 }]) {
    reset()
    const input = request()
    const plan = preview(input)
    mutate(input)
    assert.equal(noWrite(() => store.getState().applySmartReplace(input, plan.token)).ok, false)
  }
})

test('public preview mutation cannot retarget an opaque token or change its planned source range', () => {
  const input = request()
  const plan = preview(input)
  plan.summary.clipId = 'other'
  plan.summary.sourceInSeconds = 999
  plan.changed = false
  const result = store.getState().applySmartReplace(input, plan.token)
  assert.equal(result.changed, true)
  assert.equal(result.summary.clipId, 'clip')
  assert.equal(target().trimStart, 1)
  assert.equal(target().trimEnd, 5)
})

test('Undo/Redo restore source identity and editing without reviving old-source Optical Flow on the replacement', () => {
  const original = target()
  apply(request())
  const replaced = target()
  assert.equal(store.getState().undo(), true)
  assert.equal(target().assetId, 'old')
  assert.equal(target().cachePath, original.cachePath)
  assert.equal(target().opticalFlowCache.path, original.opticalFlowCache.path)
  assert.equal(target().opticalFlowCache.status, 'stale')
  assert.equal(target().opticalFlowCache.url, undefined)
  assert.deepEqual(target().keyframes, original.keyframes)
  assert.equal(store.getState().redo(), true)
  assert.equal(target().assetId, replaced.assetId)
  assert.equal(target().cachePath, null)
  assert.equal(target().opticalFlowCache, undefined)
})

test('replaced source survives ordinary Copy/Paste and portable project save/load', () => {
  const replacement = source()
  apply(request({ asset: replacement }))
  store.getState().copySelectedClips()
  store.getState().pasteClipsAtPlayhead('v1', 20, [replacement])
  const pasted = store.getState().clips.find(item => item.id !== 'clip')
  assert.equal(pasted.assetId, 'new')
  assert.equal(pasted.trimStart, 1)
  assert.equal(pasted.duration, 4)
  assert.deepEqual(pasted.keyframes, target().keyframes)
  const project = JSON.parse(JSON.stringify(store.getState().getProjectData()))
  store.getState().loadFromProject(project, [replacement], 24)
  assert.equal(target().assetId, 'new')
  assert.equal(target().duration, 4)
  assert.equal(target().trimStart, 1)
  assert.deepEqual(target().metadata, { user: 'keep' })
  assert.equal(target().cachePath, null)
  assert.equal(target().opticalFlowCache, undefined)
})

test('checkpoint failure refuses replacement rather than leaving a partial source edit', () => {
  const cyclic = {}
  cyclic.self = cyclic
  reset({ clips: [clip({ metadata: cyclic })] })
  const input = request()
  const plan = preview(input)
  assert.equal(plan.ok, true)
  const result = noWrite(() => store.getState().applySmartReplace(input, plan.token))
  assert.equal(result.ok, false)
  assert.match(result.reason, /checkpointed safely/)
})
