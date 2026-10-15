import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { isFrameStepSeekIntentAtTime } from './previewVideoSeeking.js'
import { watchStoreForProjectChanges, TIMELINE_PROJECT_KEYS, markProjectClean, markProjectDirty, isProjectDirty } from '../services/projectDirtyTracker.js'

// Exercise the production navigation path without loading media, native IPC or
// a user project. The scrub input helper deliberately does not change this API.
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
    timelineFps: 24, sourceFps: 24, transform: { positionX: 10 }, keyframes: {}, effects: [],
    opticalFlowCache: { path: 'cache/existing.mp4', status: 'ready', targetFps: 48 } }],
    tracks: [{ id: 'v1', type: 'video', name: 'Picture' }], duration: 60, timelineFps: 24, zoom: 150,
    transitions: [], markers: [{ id: 'm', time: 4 }], selectedClipIds: ['shot'], playheadPosition: 5,
    playheadSeekRevision: 0, playheadSeekIntent: null, inPoint: 1, outPoint: 20,
    history: [], historyIndex: -1, isPlaying: false, playbackRate: 1, compoundEditContext: null })
  stop = watchStoreForProjectChanges(store, TIMELINE_PROJECT_KEYS)
  markProjectClean()
})
afterEach(() => stop())
const document = () => JSON.parse(JSON.stringify(store.getState().getProjectData()))
const move = target => store.getState().setPlayheadPosition(target, { snap: true })
const release = target => store.getState().setPlayheadPosition(target, { snap: true, intent: 'frame-step' })
const authoredKeys = ['clips', 'tracks', 'transitions', 'markers', 'history', 'historyIndex', 'selectedClipIds',
  'duration', 'zoom', 'inPoint', 'outPoint', 'isPlaying', 'playbackRate']

test('scrub navigation and precise release preserve the authored document, caches, selection and Undo/Redo', () => {
  store.getState().updateClipTransform('shot', { positionX: 42 }, true)
  store.getState().undo()
  markProjectClean()
  const before = store.getState(), saved = document()
  assert.equal(before.canRedo(), true)
  for (const target of [3.125, 6.75, 4.5, 0, 5.125]) move(target)
  release(5.125)
  const after = store.getState()
  assert.equal(isFrameStepSeekIntentAtTime(after.playheadSeekIntent, after.playheadPosition), true)
  assert.equal(after.playheadPosition, 5.125)
  for (const key of authoredKeys) assert.equal(after[key], before[key], key)
  assert.deepEqual(document(), saved)
  assert.equal(isProjectDirty(), false)
  assert.equal(after.canRedo(), true)
  after.redo()
  assert.equal(store.getState().clips[0].transform.positionX, 42)
})

test('same-frame exact requests remain intentional and a later drag clears the old exact intent', () => {
  move(5)
  const firstRevision = store.getState().playheadSeekRevision
  release(5)
  const first = store.getState().playheadSeekIntent
  assert.equal(first.revision, firstRevision + 1)
  release(5)
  assert.equal(store.getState().playheadSeekIntent.revision, first.revision + 1)
  assert.equal(isFrameStepSeekIntentAtTime(store.getState().playheadSeekIntent, 5), true)
  move(5.5)
  assert.equal(store.getState().playheadSeekIntent, null)
  assert.equal(isProjectDirty(), false)
})

test('fractional and high frame-rate release targets reach the existing exact-frame gate without schema changes', () => {
  for (const fps of [24, 30, 60, 120, 24000 / 1001, 30000 / 1001]) {
    store.setState({ timelineFps: fps })
    markProjectClean()
    const saved = document()
    for (const frame of [0, 1, 11, 101]) {
      release((frame + 0.2) / fps)
      const state = store.getState()
      assert.ok(Math.abs(state.playheadPosition - frame / fps) < 1e-10)
      assert.equal(isFrameStepSeekIntentAtTime(state.playheadSeekIntent, frame / fps), true)
      assert.deepEqual(document(), saved)
      assert.equal(isProjectDirty(), false)
    }
  }
})

test('navigation inside a compound does not author a child edit or invalidate its parent', () => {
  const request = { clipIds: ['shot'], name: 'Scene', width: 1920, height: 1080 }
  const plan = store.getState().previewCreateCompound(request)
  assert.equal(plan.ok, true, plan.reason)
  const created = store.getState().applyCreateCompound(request, plan.token)
  assert.equal(created.ok, true, created.reason)
  const before = store.getState(), saved = document()
  assert.equal(before.openCompound(created.clipId).ok, true)
  markProjectClean()
  move(0.25); move(1.5); release(2.125)
  assert.equal(isProjectDirty(), false)
  assert.deepEqual(document(), saved)
  assert.deepEqual(store.getState().closeCompound(), { ok: true, changed: false })
  for (const key of ['clips', 'tracks', 'history', 'historyIndex', 'zoom', 'selectedClipIds']) {
    assert.equal(store.getState()[key], before[key], key)
  }
  assert.equal(isProjectDirty(), false)
})

test('navigation never clears existing edits and project reload clears transient release intent', () => {
  markProjectDirty()
  move(2); release(2.5)
  assert.equal(isProjectDirty(), true)
  const saved = document()
  assert.equal('playheadSeekIntent' in saved, false)
  assert.equal('playheadSeekRevision' in saved, false)
  store.getState().loadFromProject(saved)
  assert.equal(store.getState().playheadSeekIntent, null)
  release(3)
  store.getState().clearProject()
  assert.equal(store.getState().playheadSeekIntent, null)
})
