import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { getSplitTargets } from './timelineSplitTarget.mjs'

const require = createRequire(import.meta.url)
const code = buildSync({ entryPoints: [fileURLToPath(new URL('../stores/timelineStore.js', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'zustand', 'zustand/*'],
}).outputFiles[0].text
const module = { exports: {} }
const storage = new Map()
Function('require', 'module', 'exports', 'localStorage', code)(require, module, module.exports, {
  getItem: key => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key),
})
const store = module.exports.useTimelineStore, initial = store.getState()

const clip = (id, trackId, startTime, duration, patch = {}) => ({ id, trackId, startTime, duration,
  type: trackId.startsWith('audio') ? 'audio' : 'video', assetId: id, name: id, trimStart: 0, trimEnd: duration,
  sourceDuration: 200, sourceTimeScale: 1, timelineFps: 24, sourceFps: 24, speed: 1, ...patch })
const baseTracks = () => [
  { id: 'video-1', name: 'Video 1', type: 'video', muted: false, locked: false, visible: true },
  { id: 'audio-1', name: 'Audio 1', type: 'audio', channels: 'stereo', muted: false, locked: false, visible: true },
]
const reset = (patch = {}) => store.setState({ ...initial, tracks: baseTracks(), clips: [], transitions: [], timelineFps: 24,
  history: [], historyIndex: -1, clipCounter: 10, selectedClipIds: [], activeTrackId: 'video-1', playheadPosition: 0,
  magneticMainTrack: false, compoundEditContext: null, ...patch })
const get = id => store.getState().clips.find(c => c.id === id)
const asset = (id, type = 'video', duration = 4) => ({ id, name: id, type, duration, url: `file:///${id}` })

test('adding text over the video (the reported case) puts it on a new layer and leaves the video whole', () => {
  reset({ clips: [clip('sas', 'video-1', 0, 105.083)] })
  const text = store.getState().addTextClip(null, { placement: 'overlay', text: 'Sample Text' }, 38.33)
  assert.ok(text)
  assert.notEqual(text.trackId, 'video-1')
  const video = store.getState().clips.filter(c => c.assetId === 'sas')
  assert.equal(video.length, 1, 'the video was not split')
  assert.equal(video[0].duration, 105.083)
  assert.deepEqual(store.getState().tracks.map(t => t.id), ['video-2', 'video-1', 'audio-1'])
  store.getState().undo()
  assert.deepEqual(store.getState().tracks.map(t => t.id), ['video-1', 'audio-1'], 'one undo removes text and its layer')
  assert.equal(store.getState().clips.length, 1)
})

test('text aimed at an occupied track (old callers) also goes to a layer instead of cutting', () => {
  reset({ clips: [clip('v', 'video-1', 0, 20)] })
  const text = store.getState().addTextClip('video-1', { text: 'Hi' }, 5)
  assert.equal(text.trackId, 'video-2')
  assert.equal(get('v').duration, 20)
  const shape = store.getState().addShapeClip('video-1', { shapeType: 'rectangle' }, 5)
  assert.ok(shape.trackId !== 'video-1' && shape.trackId !== 'video-2', 'video-2 is taken by the text at that time')
  const adjustment = store.getState().addAdjustmentClip('video-1', 5, { duration: 2 })
  assert.notEqual(adjustment.trackId, 'video-1')
  assert.equal(store.getState().clips.filter(c => c.trackId === 'video-1').length, 1)
})

test('overwrite placement keeps the classic behaviour for internal callers', () => {
  reset({ clips: [clip('v', 'video-1', 0, 20)] })
  store.getState().addTextClip('video-1', { text: 'cut', placement: 'overwrite' }, 5)
  assert.equal(store.getState().clips.filter(c => c.trackId === 'video-1').length, 3, 'split around the text')
  reset({ clips: [clip('v', 'video-1', 0, 20)] })
  store.getState().addClip('video-1', asset('b'), 5, 24)
  assert.equal(store.getState().clips.filter(c => c.trackId === 'video-1').length, 3, 'addClip default is still overwrite')
})

test('a dropped clip on a taken spot takes a free layer; linked audio too', () => {
  reset({ clips: [clip('v', 'video-1', 0, 20), clip('a', 'audio-1', 0, 20)] })
  const placed = store.getState().addClip('video-1', asset('drop'), 5, 24, { placement: 'free' })
  assert.equal(placed.trackId, 'video-2')
  const sound = store.getState().addClip('audio-1', asset('drop', 'audio'), 5, 24, { placement: 'free' })
  assert.equal(sound.trackId, 'audio-2')
  assert.deepEqual(store.getState().tracks.map(t => t.id), ['video-2', 'video-1', 'audio-1', 'audio-2'])
  assert.equal(get('v').duration, 20)
  assert.equal(get('a').duration, 20)
})

test('dragging a clip onto another commits to a free layer; removing it later drops the empty layer', () => {
  reset({ clips: [clip('a', 'video-1', 0, 10), clip('b', 'video-1', 12, 4)] })
  store.getState().saveToHistory()
  store.getState().moveClip('b', 'video-1', 3, false)
  const result = store.getState().commitLayeredMove(['b'], { fromTrackIds: ['video-1'] })
  assert.equal(result.relocated.length, 1)
  assert.equal(get('b').trackId, 'video-2')
  assert.equal(get('a').duration, 10, 'the clip underneath is not cut')
  // Move it back down: the layer it leaves is empty and goes away.
  store.getState().moveClip('b', 'video-1', 12, false)
  store.getState().commitLayeredMove(['b'], { fromTrackIds: ['video-2'] })
  assert.deepEqual(store.getState().tracks.map(t => t.id), ['video-1', 'audio-1'])
  store.getState().undo()
  assert.equal(get('b').trackId, 'video-1')
  assert.equal(get('b').startTime, 12, 'one undo restores the drag start')
})

test('deleting the last clip on an auto layer removes the layer; user tracks stay', () => {
  reset({ clips: [clip('v', 'video-1', 0, 20)] })
  const text = store.getState().addTextClip(null, { placement: 'overlay', text: 'x' }, 2)
  store.getState().addTrack('video', { name: 'Mine' })
  store.getState().removeClip(text.id)
  const names = store.getState().tracks.map(t => t.name)
  assert.ok(names.includes('Mine'))
  assert.equal(store.getState().tracks.filter(t => t.autoLayer).length, 0)
})

test('magnetic main track: delete closes the gap, drop on the main track inserts; off by default', () => {
  reset({ clips: [clip('a', 'video-1', 0, 4), clip('b', 'video-1', 4, 4), clip('c', 'video-1', 8, 4)] })
  assert.equal(store.getState().magneticMainTrack, false)
  store.getState().removeClip('b')
  assert.equal(get('c').startTime, 8, 'without the setting the gap stays')

  reset({ magneticMainTrack: true, clips: [clip('a', 'video-1', 0, 4), clip('b', 'video-1', 4, 4), clip('c', 'video-1', 8, 4)] })
  store.getState().removeClip('b')
  assert.equal(get('c').startTime, 4)
  const inserted = store.getState().addClip('video-1', asset('n', 'video', 2), 1, 24, { placement: 'free' })
  assert.equal(inserted.trackId, 'video-1')
  assert.equal(inserted.startTime, 4, 'inserted after the clip it was dropped on')
  assert.equal(get('c').startTime, 6, 'later clips move along')
  store.getState().setMagneticMainTrack(false)
  assert.equal(storage.get('drama-studio-magnetic-main-track'), 'false')
})

test('loading an older project keeps every clip and track exactly where it was', () => {
  reset()
  const tracks = [...baseTracks(), { id: 'video-2', name: 'Video 2', type: 'video', muted: false, locked: false, visible: true }]
  const clips = [clip('a', 'video-1', 0, 4), clip('b', 'video-1', 6, 4), clip('t', 'video-2', 1, 2)]
  store.getState().loadFromProject({ tracks, clips, transitions: [], clipCounter: 5 }, [], 24)
  assert.deepEqual(store.getState().tracks.map(t => t.id), ['video-1', 'audio-1', 'video-2'])
  assert.deepEqual(store.getState().clips.map(c => [c.id, c.trackId, c.startTime]), [['a', 'video-1', 0], ['b', 'video-1', 6], ['t', 'video-2', 1]])
  assert.equal(store.getState().tracks.some(t => t.autoLayer), false)
})

test('split targets the selected clips, else the active track, never other layers', () => {
  const tracks = [{ id: 'video-2', type: 'video' }, { id: 'video-1', type: 'video' }, { id: 'audio-1', type: 'audio' }]
  const clips = [clip('v', 'video-1', 0, 20), clip('t', 'video-2', 5, 10), clip('a', 'audio-1', 0, 20)]
  const state = { tracks, clips, playheadPosition: 8, timelineFps: 24, activeTrackId: 'video-1', selectedClipIds: ['t'] }
  assert.deepEqual(getSplitTargets(state).map(c => c.id), ['t'])
  assert.deepEqual(getSplitTargets({ ...state, selectedClipIds: [] }).map(c => c.id), ['v'])
  assert.deepEqual(getSplitTargets({ ...state, selectedClipIds: ['v', 'a'] }).map(c => c.id), ['v', 'a'])
  assert.deepEqual(getSplitTargets({ ...state, selectedClipIds: ['t'], playheadPosition: 2 }).map(c => c.id), ['v'],
    'a selected clip away from the playhead falls back to the active track')
  const locked = { ...state, tracks: tracks.map(t => (t.id === 'video-2' ? { ...t, locked: true } : t)) }
  assert.deepEqual(getSplitTargets(locked).map(c => c.id), ['v'])
})
