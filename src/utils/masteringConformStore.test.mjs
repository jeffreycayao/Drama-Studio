import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { buildAutoDuckingEnvelope, buildAutoDuckingRecord } from './audioMastering.mjs'

const require = createRequire(import.meta.url)
const code = buildSync({ entryPoints: [fileURLToPath(new URL('../stores/timelineStore.js', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'zustand', 'zustand/*'],
}).outputFiles[0].text
const module = { exports: {} }
Function('require', 'module', 'exports', 'localStorage', code)(require, module, module.exports,
  { getItem: () => null, setItem() {}, removeItem() {} })
const store = module.exports.useTimelineStore, initial = store.getState()
const audio = (id, trackId, patch = {}) => ({ id, trackId, type: 'audio', assetId: id, startTime: 0, duration: 10,
  trimStart: 0, trimEnd: 10, sourceDuration: 10, sourceTimeScale: 1, speed: 1, ...patch })
const video = (id, patch = {}) => ({ id, trackId: 'v1', type: 'video', assetId: 'draft', name: id, startTime: 0, duration: 2,
  trimStart: 1, trimEnd: 3, sourceDuration: 5, sourceFps: 24, timelineFps: 24, sourceTimeScale: 1, speed: 1, url: 'blob:draft', ...patch })
const reset = patch => store.setState({ ...initial, tracks: [{ id: 'v1', type: 'video', name: 'V1' },
  { id: 'bgm', type: 'audio', name: 'Music' }, { id: 'dia', type: 'audio', name: 'Dialogue' }],
transitions: [], timelineFps: 24, history: [], historyIndex: -1, isPlaying: false, ...patch })
const hero = { id: 'hero', type: 'video', url: 'blob:hero', duration: 5, fps: 24 }

test('setTrackMixRole is undoable, rejects unknown roles and video tracks, and clears with null', () => {
  reset({ clips: [] })
  assert.equal(store.getState().setTrackMixRole('bgm', 'music').ok, false)
  assert.equal(store.getState().setTrackMixRole('v1', 'bgm').ok, false)
  assert.equal(store.getState().setTrackMixRole('bgm', 'bgm').changed, true)
  assert.equal(store.getState().tracks.find(t => t.id === 'bgm').mixRole, 'bgm')
  assert.equal(store.getState().setTrackMixRole('bgm', 'bgm').changed, false)
  store.getState().undo()
  assert.equal(store.getState().tracks.find(t => t.id === 'bgm').mixRole, undefined)
  store.getState().setTrackMixRole('bgm', 'bgm')
  store.getState().setTrackMixRole('bgm', null)
  assert.equal('mixRole' in store.getState().tracks.find(t => t.id === 'bgm'), false)
})

test('applyAutoDucking writes every BGM clip in one undo step and refuses stale clips', () => {
  const a = audio('m1', 'bgm'), b = audio('m2', 'bgm', { startTime: 10 })
  reset({ clips: [a, b] })
  const updates = [a, b].map(clip => {
    const result = buildAutoDuckingEnvelope(clip, [{ start: 2, end: 3 }])
    return { clipId: clip.id, expectedClip: clip, envelope: result.envelope, autoDucking: buildAutoDuckingRecord(clip.volumeEnvelope, result.envelope, result.settings) }
  })
  const states = [], off = store.subscribe(state => states.push(state))
  const result = store.getState().applyAutoDucking({ updates })
  off()
  assert.equal(result.ok, true)
  assert.equal(result.count, 2)
  assert.equal(states.length, 2, 'history save + one document publish')
  assert.ok(store.getState().clips.every(clip => clip.volumeEnvelope.points.length > 0 && clip.autoDucking?.version === 1))
  store.getState().undo()
  assert.ok(store.getState().clips.every(clip => !clip.volumeEnvelope && !clip.autoDucking))
  // Stale: the analysis saw a different clip object.
  reset({ clips: [{ ...a }, b] })
  const stale = store.getState().applyAutoDucking({ updates })
  assert.equal(stale.ok, false)
  assert.match(stale.reason, /changed after analysis/)
  assert.equal(store.getState().history.length, 0)
})

test('applyAutoDucking removal (autoDucking: null) restores the base and drops the record', () => {
  const result = buildAutoDuckingEnvelope(audio('m', 'bgm'), [{ start: 2, end: 3 }])
  const ducked = audio('m', 'bgm', { volumeEnvelope: result.envelope, autoDucking: buildAutoDuckingRecord(null, result.envelope, result.settings) })
  reset({ clips: [ducked] })
  const removed = store.getState().applyAutoDucking({ updates: [{ clipId: 'm', expectedClip: ducked, envelope: { version: 1, offsetSeconds: 0, points: [] }, autoDucking: null }] })
  assert.equal(removed.ok, true)
  const clip = store.getState().clips[0]
  assert.deepEqual(clip.volumeEnvelope.points, [])
  assert.equal('autoDucking' in clip, false)
})

test('applyAutoDucking refuses locked tracks without touching history', () => {
  const a = audio('m', 'bgm')
  reset({ clips: [a] })
  store.setState({ tracks: store.getState().tracks.map(t => t.id === 'bgm' ? { ...t, locked: true } : t) })
  const result = store.getState().applyAutoDucking({ updates: [{ clipId: 'm', expectedClip: a, envelope: null, autoDucking: null }] })
  assert.match(result.reason, /Unlock/)
  assert.equal(store.getState().history.length, 0)
})

test('setClipRenderMode marks picture clips and is undoable', () => {
  reset({ clips: [video('c1'), audio('a', 'bgm')] })
  assert.equal(store.getState().setClipRenderMode(['a'], 'draft').ok, false)
  assert.equal(store.getState().setClipRenderMode(['c1'], 'final').ok, false)
  assert.equal(store.getState().setClipRenderMode(['c1'], 'draft').changed, true)
  assert.equal(store.getState().clips[0].renderMode, 'draft')
  store.getState().undo()
  assert.equal(store.getState().clips[0].renderMode, undefined)
})

test('applyHeroConform swaps sources in one undo step and keeps edit points, trims and linked audio', () => {
  const pic = video('c1', { startTime: 4, linkGroupId: 'g' }), split = video('c2', { startTime: 6, trimStart: 3, trimEnd: 4, duration: 1 })
  const sound = audio('snd', 'dia', { assetId: 'draft', linkGroupId: 'g', startTime: 4, duration: 2 })
  reset({ clips: [pic, split, sound] })
  const result = store.getState().applyHeroConform({ swaps: [
    { clipId: 'c1', draftAssetId: 'draft', asset: hero }, { clipId: 'c2', draftAssetId: 'draft', asset: hero }] })
  assert.equal(result.ok, true, result.reason)
  const [a, b, s] = store.getState().clips
  assert.equal(a.assetId, 'hero')
  assert.deepEqual([a.startTime, a.duration, a.trimStart, a.trimEnd], [4, 2, 1, 3])
  assert.deepEqual([b.startTime, b.duration, b.trimStart, b.trimEnd], [6, 1, 3, 4])
  assert.equal(a.renderMode, 'hero')
  assert.deepEqual({ ...a.conform, conformedAt: 0 }, { version: 1, draftAssetId: 'draft', heroAssetId: 'hero', conformedAt: 0 })
  assert.equal(s, sound, 'linked audio is untouched')
  assert.ok(result.warnings.some(text => /Linked picture or audio/.test(text)))
  store.getState().undo()
  assert.deepEqual(store.getState().clips.map(clip => clip.assetId), ['draft', 'draft', 'draft'])
})

test('applyHeroConform is all-or-nothing and refuses clips that moved off their draft', () => {
  const ok = video('c1'), tooLong = video('c2', { startTime: 5, trimStart: 4, trimEnd: 6, duration: 2, sourceDuration: 8 })
  reset({ clips: [ok, tooLong] })
  const result = store.getState().applyHeroConform({ swaps: [
    { clipId: 'c1', draftAssetId: 'draft', asset: hero }, { clipId: 'c2', draftAssetId: 'draft', asset: hero }] })
  assert.equal(result.ok, false)
  assert.match(result.reason, /c2/)
  assert.equal(store.getState().clips[0].assetId, 'draft')
  assert.equal(store.getState().history.length, 0)
  reset({ clips: [video('c1', { assetId: 'other' })] })
  assert.match(store.getState().applyHeroConform({ swaps: [{ clipId: 'c1', draftAssetId: 'draft', asset: hero }] }).reason, /no longer uses/)
  reset({ clips: [ok], isPlaying: true })
  assert.match(store.getState().applyHeroConform({ swaps: [{ clipId: 'c1', draftAssetId: 'draft', asset: hero }] }).reason, /Pause/)
})
