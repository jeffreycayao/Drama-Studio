import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { TIMELINE_PROJECT_KEYS, watchStoreForProjectChanges, isProjectDirty, markProjectClean } from '../services/projectDirtyTracker.js'

const require = createRequire(import.meta.url)
const code = buildSync({ entryPoints: [fileURLToPath(new URL('../stores/timelineStore.js', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'zustand', 'zustand/*'],
}).outputFiles[0].text
const module = { exports: {} }
Function('require', 'module', 'exports', 'localStorage', code)(require, module, module.exports,
  { getItem: () => null, setItem() {}, removeItem() {} })
const store = module.exports.useTimelineStore, initial = store.getState()
const clip = (id, trackId, startTime, duration, patch = {}) => ({ id, trackId, startTime, duration,
  type: trackId.startsWith('a') ? 'audio' : 'video', assetId: id, trimStart: 0, trimEnd: duration,
  sourceDuration: 100, sourceTimeScale: 1, timelineFps: 24, sourceFps: 24, speed: 1, ...patch })
const reset = (patch = {}) => store.setState({ ...initial,
  tracks: [{ id: 'v', type: 'video' }, { id: 'a1', type: 'audio' }, { id: 'a2', type: 'audio' }],
  clips: [clip('before', 'v', 0, 2), clip('picture', 'v', 3.125, 3, { linkGroupId: 'pair' }),
    clip('dialogue', 'a1', 3.125, 3, { linkGroupId: 'pair' }), clip('recording', 'a2', 10, 4)],
  transitions: [], markers: [{ id: 'm', time: 10 }], selectedClipIds: [], selectedTransitionId: null,
  selectedMarkerId: null, selectedGap: { trackId: 'v', startTime: 2, endTime: 3.125 },
  duration: 60, timelineFps: 24, rippleEditMode: false, playheadPosition: 12, inPoint: 1, outPoint: 20,
  history: [], historyIndex: -1, historyLastChangedAt: 0, ...patch })
const noWrite = action => {
  const before = store.getState(); let writes = 0
  const off = store.subscribe(() => writes++)
  let result
  try { result = action() } finally { off() }
  assert.equal(writes, 0); assert.equal(store.getState(), before)
  return result
}
const times = () => store.getState().clips.map(clip => [clip.id, clip.startTime])
beforeEach(() => { reset(); markProjectClean() })
afterEach(() => { reset(); markProjectClean() })

test('preview is read-only; one atomic edit moves picture and both audio tracks with one checkpoint in either ripple mode', () => {
  for (const rippleEditMode of [false, true]) {
    reset({ rippleEditMode }); markProjectClean()
    const before = store.getState(), stopDirty = watchStoreForProjectChanges(store, TIMELINE_PROJECT_KEYS)
    const preview = noWrite(() => store.getState().previewSelectedGapDelete())
    assert.equal(preview.ok, true); assert.equal(preview.changed, false); assert.equal(preview.deltaFrames, 27)
    assert.equal('clips' in preview, false); assert.equal(isProjectDirty(), false)
    const states = [], off = store.subscribe(state => states.push(state))
    assert.equal(store.getState().rippleDeleteSelectedGap(), true)
    off(); stopDirty()
    assert.equal(states.length, 1); assert.equal(states[0].history.length, 1)
    assert.deepEqual(times(), [['before', 0], ['picture', 2], ['dialogue', 2], ['recording', 8.875]])
    assert.equal(isProjectDirty(), true); assert.equal(store.getState().selectedGap, null)
    for (const key of ['tracks', 'markers', 'duration', 'playheadPosition', 'inPoint', 'outPoint', 'rippleEditMode']) assert.equal(store.getState()[key], before[key])
    store.getState().undo()
    assert.deepEqual(times(), before.clips.map(clip => [clip.id, clip.startTime]))
    store.getState().redo()
    assert.equal(store.getState().clips.find(clip => clip.id === 'recording').startTime, 8.875)
  }
})

test('overlapping music, protected independent audio, and stale selections refuse without history, selection or dirty writes', () => {
  const cases = [
    () => store.setState({ clips: [...store.getState().clips, clip('music', 'a2', 0, 8)] }),
    () => store.setState({ tracks: store.getState().tracks.map(track => track.id === 'a2' ? { ...track, locked: true } : track) }),
    () => store.setState({ clips: store.getState().clips.map(clip => clip.id === 'recording' ? { ...clip, lockMode: 'sync', syncLock: { mode: 'sync', startTime: 10, duration: 4 } } : clip) }),
    () => store.setState({ selectedGap: { trackId: 'v', startTime: 2.5, endTime: 3.125 } }),
    () => store.setState({ selectedGap: null }),
  ]
  for (const setup of cases) {
    reset(); setup(); markProjectClean()
    const off = watchStoreForProjectChanges(store, TIMELINE_PROJECT_KEYS)
    assert.equal(noWrite(() => store.getState().previewSelectedGapDelete()).ok, false)
    assert.equal(noWrite(() => store.getState().rippleDeleteSelectedGap()), false)
    assert.equal(store.getState().history.length, 0); assert.equal(isProjectDirty(), false)
    off()
  }
})

test('an accepted preview cannot authorize a later stale or locked edit', () => {
  assert.equal(noWrite(() => store.getState().previewSelectedGapDelete()).ok, true)
  store.setState({ clips: [...store.getState().clips, clip('new-music', 'a2', 2, 1)] })
  assert.equal(noWrite(() => store.getState().rippleDeleteSelectedGap()), false)
})

test('transition translation is atomic and undo/redo restores exact original transition metadata', () => {
  const transition = { id: 'fade', kind: 'edge', clipId: 'recording', edge: 'in', duration: .5, startTime: 10, endTime: 10.5 }
  store.setState({ transitions: [transition] })
  assert.equal(store.getState().rippleDeleteSelectedGap(), true)
  assert.deepEqual(store.getState().transitions, [{ ...transition, startTime: 8.875, endTime: 9.375 }])
  store.getState().undo(); assert.deepEqual(store.getState().transitions, [transition])
  store.getState().redo(); assert.equal(store.getState().transitions[0].startTime, 8.875)
})

test('ordinary imported non-frame source durations yield usable selected gaps and preserve portable source metadata', () => {
  reset({ clips: [], selectedGap: null })
  const add = (id, trackId, startTime, duration) => store.getState().addClip(trackId,
    { id, type: trackId === 'v' ? 'video' : 'audio', name: id, duration, url: `assets/${id}.mp4` }, startTime, 24,
    { saveHistory: false, resolveOverlaps: false })
  add('before-source', 'v', 0, 2.015)
  add('picture-source', 'v', 3.125, 2.891)
  add('recording-source', 'a2', 3.125, 5.237)
  const before = store.getState().clips[0], following = store.getState().clips[1]
  // These are the same neighboring boundaries getTrackGapAtTime uses.
  store.getState().selectGap({ trackId: 'v', startTime: before.startTime + before.duration, endTime: following.startTime })
  assert.equal(noWrite(() => store.getState().previewSelectedGapDelete()).ok, true)
  const original = structuredClone(store.getState().clips)
  assert.equal(store.getState().rippleDeleteSelectedGap(), true)
  for (const item of original) {
    const next = store.getState().clips.find(clip => clip.id === item.id)
    assert.deepEqual({ ...next, startTime: item.startTime }, item)
  }
  const saved = JSON.parse(JSON.stringify(store.getState().getProjectData()))
  const savedTimes = times()
  store.getState().loadFromProject(saved, [], 24)
  assert.deepEqual(times(), savedTimes)
  assert.equal(store.getState().clips[2].url, 'assets/recording-source.mp4')
})

test('refusal preserves an existing redo branch, successful gap close starts a new branch', () => {
  store.getState().rippleDeleteSelectedGap(); store.getState().undo()
  const history = store.getState().history
  store.setState({ selectedGap: { trackId: 'v', startTime: 2, endTime: 3.125 },
    tracks: store.getState().tracks.map(track => track.id === 'a2' ? { ...track, locked: true } : track) })
  assert.equal(noWrite(() => store.getState().rippleDeleteSelectedGap()), false)
  assert.equal(store.getState().history, history); assert.equal(store.getState().canRedo(), true)
  store.setState({ tracks: store.getState().tracks.map(track => ({ ...track, locked: false })) })
  assert.equal(store.getState().rippleDeleteSelectedGap(), true)
  assert.equal(store.getState().canRedo(), false)
})

const createCompound = clipIds => {
  const request = { clipIds, name: 'Synthetic scene', width: 1920, height: 1080 }
  const preview = noWrite(() => store.getState().previewCreateCompound(request))
  assert.equal(preview.ok, true, preview.reason)
  const result = store.getState().applyCreateCompound(request, preview.token)
  assert.equal(result.ok, true, result.reason)
  return result.clipId
}

test('a downstream parent compound moves as a whole without touching child timing, with undo/redo', () => {
  const compoundId = createCompound(['picture', 'dialogue'])
  const original = store.getState().clips.find(clip => clip.id === compoundId)
  store.getState().selectGap({ trackId: 'v', startTime: 2, endTime: 3.125 })
  assert.equal(noWrite(() => store.getState().previewSelectedGapDelete()).ok, true)
  assert.equal(store.getState().rippleDeleteSelectedGap(), true)
  const moved = store.getState().clips.find(clip => clip.id === compoundId)
  assert.equal(moved.startTime, 2); assert.equal(moved.compound, original.compound)
  assert.deepEqual({ ...moved, startTime: original.startTime }, original)
  assert.equal(store.getState().clips.find(clip => clip.id === 'recording').startTime, 8.875)
  store.getState().undo(); assert.equal(store.getState().clips.find(clip => clip.id === compoundId).startTime, 3.125)
  store.getState().redo(); assert.equal(store.getState().clips.find(clip => clip.id === compoundId).startTime, 2)
})

test('compound child gap edits support child Undo/Redo, Back, and parent Undo/Redo', () => {
  const compoundId = createCompound(['before', 'picture', 'dialogue', 'recording'])
  assert.equal(store.getState().openCompound(compoundId).ok, true)
  store.getState().selectGap({ trackId: 'v', startTime: 2, endTime: 3.125 })
  assert.equal(noWrite(() => store.getState().previewSelectedGapDelete()).ok, true)
  assert.equal(store.getState().rippleDeleteSelectedGap(), true)
  assert.equal(store.getState().clips.find(clip => clip.id === 'recording').startTime, 8.875)
  store.getState().undo(); assert.equal(store.getState().clips.find(clip => clip.id === 'recording').startTime, 10)
  store.getState().redo(); assert.equal(store.getState().clips.find(clip => clip.id === 'recording').startTime, 8.875)
  const closed = store.getState().closeCompound()
  assert.equal(closed.ok, true, closed.reason); assert.equal(closed.changed, true)
  const childRecording = () => store.getState().clips.find(clip => clip.id === compoundId).compound.document.clips.find(clip => clip.id === 'recording')
  assert.equal(childRecording().startTime, 8.875)
  store.getState().undo(); assert.equal(childRecording().startTime, 10)
  store.getState().redo(); assert.equal(childRecording().startTime, 8.875)
})
