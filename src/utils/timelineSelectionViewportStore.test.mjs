import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { watchStoreForProjectChanges, TIMELINE_PROJECT_KEYS, markProjectClean, markProjectDirty, isProjectDirty } from '../services/projectDirtyTracker.js'

const require = createRequire(import.meta.url)
const code = buildSync({ entryPoints: [fileURLToPath(new URL('../stores/timelineStore.js', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'zustand', 'zustand/*'],
}).outputFiles[0].text
const module = { exports: {} }
Function('require', 'module', 'exports', 'localStorage', code)(require, module, module.exports,
  { getItem: () => null, setItem() {}, removeItem() {} })
const store = module.exports.useTimelineStore, initial = store.getState()
let stop
beforeEach(() => {
  store.setState({ ...initial, clips: [{ id: 'shot', type: 'video', assetId: 'source', name: 'Shot', trackId: 'v1',
    startTime: 3, duration: 4, trimStart: 2, trimEnd: 6, sourceDuration: 20, sourceTimeScale: 1, speed: 1,
    timelineFps: 24, sourceFps: 24, transform: { positionX: 10 }, keyframes: {}, effects: [] }],
    tracks: [{ id: 'v1', type: 'video', name: 'Picture' }], duration: 60, timelineFps: 24, zoom: 150,
    transitions: [], markers: [], selectedClipIds: ['shot'], playheadPosition: 5, inPoint: 1, outPoint: 20,
    history: [], historyIndex: -1 })
  stop = watchStoreForProjectChanges(store, TIMELINE_PROJECT_KEYS)
  markProjectClean()
})
afterEach(() => stop())
const document = () => JSON.parse(JSON.stringify(store.getState().getProjectData()))
const focus = zoom => store.getState().setZoom(zoom, { navigationOnly: true })
const compound = () => {
  const request = { clipIds: ['shot'], name: 'Scene', width: 1920, height: 1080 }
  const plan = store.getState().previewCreateCompound(request)
  assert.equal(plan.ok, true, plan.reason)
  const result = store.getState().applyCreateCompound(request, plan.token)
  assert.equal(result.ok, true, result.reason)
  return result.clipId
}

test('focus/restore keeps document, history, selection and transport exact without dirtying', () => {
  const before = store.getState(), saved = document()
  for (const zoom of [500, 900, 150]) {
    focus(zoom)
    const after = store.getState()
    assert.equal(after.zoom, zoom)
    assert.deepEqual(document(), saved)
    for (const key of ['clips', 'tracks', 'transitions', 'history', 'historyIndex', 'selectedClipIds', 'playheadPosition', 'isPlaying', 'inPoint', 'outPoint']) {
      assert.equal(after[key], before[key], key)
    }
    assert.equal(isProjectDirty(), false)
  }
  markProjectDirty(); focus(1000)
  assert.equal(isProjectDirty(), true, 'never clears existing edits')
  assert.equal('viewportNavigation' in document(), false)
})

test('same zoom and invalid input are write-free; ordinary zoom retains saved behavior', () => {
  const before = store.getState()
  for (const value of [150, NaN, Infinity, -Infinity, undefined, '400']) focus(value)
  assert.equal(store.getState(), before)
  focus(9000)
  assert.equal(store.getState().zoom, 2000)
  store.getState().setZoom(300)
  assert.equal(store.getState().viewportNavigation, null)
  assert.equal(document().zoom, 300)
  assert.equal(isProjectDirty(), true)
  markProjectClean(); focus(600)
  assert.equal(document().zoom, 300)
  assert.equal(isProjectDirty(), false)
})

test('clean compound focus and Back preserve exact parent refs/history/cache', () => {
  const id = compound()
  store.setState(s => ({ clips: s.clips.map(c => ({ ...c, cacheStatus: 'ready', cacheUrl: 'blob:existing', cacheKind: 'full' })) }))
  const before = store.getState(), saved = document()
  assert.equal(store.getState().openCompound(id).ok, true)
  markProjectClean()
  const childZoom = store.getState().zoom
  focus(900)
  assert.equal(isProjectDirty(), false)
  assert.deepEqual(document(), saved)
  assert.equal(store.getState().getActiveDocumentData().zoom, childZoom)
  assert.deepEqual(store.getState().closeCompound(), { ok: true, changed: false })
  for (const key of ['clips', 'tracks', 'history', 'historyIndex', 'zoom', 'selectedClipIds']) assert.equal(store.getState()[key], before[key], key)
  assert.equal(isProjectDirty(), false)
})

test('actual child edits after focusing still dirty, invalidate cache and create one parent Undo', () => {
  const id = compound(), before = store.getState()
  store.getState().openCompound(id)
  markProjectClean(); focus(900)
  store.getState().updateClipTransform('shot', { positionX: 44 })
  assert.equal(isProjectDirty(), true)
  assert.equal(store.getState().closeCompound().changed, true)
  assert.equal(store.getState().history.length, before.history.length + 1)
  assert.equal(store.getState().clips[0].compound.document.clips[0].transform.positionX, 44)
  store.getState().undo()
  assert.equal(store.getState().clips[0].compound.document.clips[0].transform.positionX, 10)
})

test('parent focus receipt survives compound navigation, load/clear drop it', () => {
  const id = compound(), saved = document()
  focus(900)
  store.getState().openCompound(id)
  focus(700)
  store.getState().closeCompound()
  assert.equal(store.getState().zoom, 900)
  assert.deepEqual(document(), saved)
  store.getState().loadFromProject({ ...saved, zoom: 900 })
  assert.equal(store.getState().viewportNavigation, null)
  assert.equal(document().zoom, 900)
  focus(600); store.getState().clearProject()
  assert.equal(store.getState().viewportNavigation, null)
  assert.equal(document().zoom, 100)
})

test('ordinary child zoom retains preexisting authoring behavior after temporary focus', () => {
  const id = compound()
  store.getState().openCompound(id)
  focus(900)
  store.getState().setZoom(400)
  assert.equal(store.getState().closeCompound().changed, true)
  assert.equal(store.getState().clips[0].compound.document.zoom, 400)
})
