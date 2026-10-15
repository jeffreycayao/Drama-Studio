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
const store = module.exports.useTimelineStore, initial = store.getState()
const clip = patch => ({ id: 'target', type: 'video', assetId: 'source', trackId: 'v', startTime: 2,
  duration: 3, trimStart: 2, trimEnd: 5, sourceDuration: 10, sourceTimeScale: 1, sourceFps: 10, timelineFps: 10,
  speed: 1, reverse: false, ...patch })
const reset = patch => store.setState({ ...initial, clips: [clip(), clip({ id: 'follower', startTime: 6, duration: 2, trimEnd: 4 }),
  clip({ id: 'overlay', trackId: 'other', startTime: 0 })],
  tracks: [{ id: 'v', type: 'video' }, { id: 'a', type: 'audio' }, { id: 'other', type: 'video' }],
  transitions: [], markers: [{ id: 'marker-1', time: 6 }], selectedClipIds: ['target'],
  playheadPosition: 4, inPoint: 1, outPoint: 8, duration: 60, timelineFps: 10, rippleEditMode: true,
  history: [], historyIndex: -1, historyLastChangedAt: 0, ...patch })
const noWrite = action => {
  const state = store.getState(); let count = 0
  const off = store.subscribe(() => count++)
  let result
  try { result = action() } finally { off() }
  assert.equal(count, 0); assert.equal(store.getState(), state)
  return result
}
const begin = (edge = 'right', targetClipIds) => {
  const result = noWrite(() => store.getState().beginRippleTrim({ clipId: 'target', edge, targetClipIds }))
  assert.equal(result.ok, true, result.reason)
  return result
}
const apply = (session, delta) => {
  const result = store.getState().applyRippleTrim(session.token, delta)
  assert.equal(result.ok, true, result.reason)
  return result
}
beforeEach(() => reset())
afterEach(() => reset())

test('begin/idle are read-only and first movement publishes targets, followers, transitions and history atomically', () => {
  const transition = { id: 'fade', kind: 'edge', clipId: 'follower', edge: 'in', duration: .5, startTime: 6, endTime: 6.5 }
  store.setState({ transitions: [transition] })
  const before = store.getState(), session = begin()
  assert.equal(noWrite(() => apply(session, .01)).changed, false)
  const states = []; const off = store.subscribe(state => states.push(state))
  const result = apply(session, .15); off()
  assert.equal(states.length, 1)
  const state = states[0]
  assert.equal(state.clips[0].duration, 3.2); assert.equal(state.clips[1].startTime, 6.2)
  assert.equal(state.clips[2], before.clips[2])
  assert.equal(state.transitions[0].startTime, 6.2)
  assert.equal(state.history.length, 1)
  assert.equal(result.feedback.clip, state.clips[0])
  const repeated = noWrite(() => apply(session, .2))
  assert.equal(repeated.changed, false); assert.equal(repeated.feedback.clip, state.clips[0])
  assert.equal(store.getState().transitions, state.transitions)
  for (const key of ['tracks', 'markers', 'playheadPosition', 'inPoint', 'outPoint', 'selectedClipIds', 'duration']) assert.equal(state[key], before[key])
  noWrite(() => store.getState().endRippleTrim(session.token))
})

test('no transition movement preserves its array identity; head moves use originals and only one Undo checkpoint', () => {
  const before = store.getState(), session = begin('left')
  apply(session, .4); const history = store.getState().history
  apply(session, -.3)
  assert.equal(store.getState().clips[0].startTime, 2)
  assert.equal(store.getState().clips[0].duration, 3.3)
  assert.equal(store.getState().clips[0].trimStart, 1.7)
  assert.equal(store.getState().clips[1].startTime, 6.3)
  assert.equal(store.getState().transitions, before.transitions)
  assert.equal(store.getState().history, history)
  noWrite(() => store.getState().endRippleTrim(session.token))
  store.getState().undo()
  assert.equal(store.getState().clips[0].duration, 3); assert.equal(store.getState().clips[1].startTime, 6)
  store.getState().redo()
  assert.equal(store.getState().clips[0].duration, 3.3); assert.equal(store.getState().clips[1].startTime, 6.3)
})

test('generator extension past the viewport then return to origin restores exact refs, padded duration and Redo branch', () => {
  for (const withRedo of [false, true]) {
    reset({ clips: [clip({ type: 'image', sourceDuration: Infinity, trimStart: 0, trimEnd: 3 })], duration: 6 })
    if (withRedo) {
      const prior = begin(); apply(prior, .5); store.getState().endRippleTrim(prior.token); store.getState().undo()
      assert.equal(store.getState().canRedo(), true)
    }
    const before = store.getState(), session = begin()
    apply(session, 10)
    assert.equal(store.getState().duration, 15)
    apply(session, 0)
    assert.equal(store.getState().clips, before.clips)
    assert.equal(store.getState().transitions, before.transitions)
    assert.equal(store.getState().duration, before.duration)
    store.getState().endRippleTrim(session.token)
    assert.equal(store.getState().history, before.history)
    assert.equal(store.getState().historyIndex, before.historyIndex)
    assert.equal(store.getState().historyLastChangedAt, before.historyLastChangedAt)
    if (withRedo) assert.equal(store.getState().canRedo(), true)
  }
})

test('all bound state changes including ripple mode, snap settings, playhead and range stale the token', () => {
  for (const key of ['clips', 'tracks', 'transitions', 'markers', 'timelineFps', 'timelineSessionId', 'history', 'historyIndex',
    'duration', 'isPlaying', 'selectedClipIds', 'clipCounter', 'markerCounter', 'transitionCounter', 'zoom', 'masterAudioVolume', 'masterAudioInserts',
    'rippleEditMode', 'snappingEnabled', 'snappingThreshold', 'playheadPosition', 'inPoint', 'outPoint']) {
    reset(); const session = begin(), value = store.getState()[key]
    store.setState({ [key]: Array.isArray(value) ? [...value] : typeof value === 'number' ? value + 1 : !value })
    assert.equal(noWrite(() => store.getState().applyRippleTrim(session.token, .5)).ok, false, key)
    noWrite(() => store.getState().endRippleTrim(session.token))
  }
  reset(); const session = begin()
  store.setState({ activeSnapTime: 7 })
  assert.equal(apply(session, .5).ok, true)
})

test('public target arrays/session/bounds cannot redirect or widen a private planned ripple', () => {
  const session = begin()
  session.session.targetClipIds.push('overlay'); session.session.snapExcludedClipIds.length = 0
  session.session.clipId = 'overlay'; session.session.originalDuration = 100
  session.bounds.maximumDelta = 100
  const result = apply(session, 99)
  assert.equal(result.delta, 5)
  assert.equal(store.getState().clips[0].duration, 8)
  assert.equal(store.getState().clips[1].startTime, 11)
  assert.equal(store.getState().clips[2].duration, 3)
})

test('explicit target selection expands linked mates and head envelope offsets never accumulate across pointer moves', () => {
  const envelope = { version: 1, offsetSeconds: 2, points: [{ id: 'point', time: 0, db: -6 }] }
  store.setState({ selectedClipIds: ['overlay'], clips: [{ ...store.getState().clips[0], linkGroupId: 'take' },
    ...store.getState().clips.slice(1), clip({ id: 'sound', type: 'audio', trackId: 'a', linkGroupId: 'take', volumeEnvelope: envelope })] })
  const session = begin('left', ['target'])
  assert.deepEqual(session.session.targetClipIds, ['target', 'sound'])
  apply(session, .4); apply(session, .7); apply(session, -.3)
  const sound = store.getState().clips.find(clip => clip.id === 'sound')
  assert.equal(sound.duration, 3.3); assert.equal(sound.startTime, 2)
  assert.equal(sound.volumeEnvelope.offsetSeconds, 1.7)
  assert.deepEqual(store.getState().selectedClipIds, ['overlay'])
})

test('unsupported participants, bad links/transitions, disabled ripple and invalid pointers never checkpoint', () => {
  for (const patch of [{ locked: true }, { syncLocked: true }, { cacheStatus: 'rendering' },
    { metadata: { captionScope: 'timeline' } }, { startTime: 4 }]) {
    reset(); store.setState({ clips: [store.getState().clips[0], { ...store.getState().clips[1], ...patch }, store.getState().clips[2]] })
    assert.equal(noWrite(() => store.getState().beginRippleTrim({ clipId: 'target', edge: 'right' })).ok, false)
  }
  for (const patch of [{ rippleEditMode: false }, { isPlaying: true },
    { transitions: [{ id: 'edge', kind: 'edge', clipId: 'target', edge: 'out', duration: .5 }] }]) {
    reset(patch); assert.equal(noWrite(() => store.getState().beginRippleTrim({ clipId: 'target', edge: 'right' })).ok, false)
  }
  reset(); const session = begin()
  for (const delta of [null, undefined, Infinity, NaN, '1']) assert.equal(noWrite(() => store.getState().applyRippleTrim(session.token, delta)).ok, false)
  noWrite(() => store.getState().endRippleTrim(session.token))
  assert.equal(noWrite(() => store.getState().applyRippleTrim(session.token, .5)).ok, false)
})

test('synchronous subscribers cannot be adopted as expected state or have their edits erased on retry/end', () => {
  const session = begin(); let externalClips, externalHistory, fired = false
  const off = store.subscribe(state => {
    if (fired) return
    fired = true
    externalClips = state.clips.map(clip => ({ ...clip, name: 'Subscriber edit' }))
    externalHistory = [...state.history]
    store.setState({ clips: externalClips, history: externalHistory })
  })
  const result = store.getState().applyRippleTrim(session.token, .5); off()
  assert.equal(result.ok, false); assert.equal(result.changed, true)
  assert.equal(noWrite(() => store.getState().applyRippleTrim(session.token, 0)).ok, false)
  noWrite(() => store.getState().endRippleTrim(session.token))
  assert.equal(store.getState().clips, externalClips); assert.equal(store.getState().history, externalHistory)
})

test('ordinary compound children can ripple while parent targets/followers and stale navigation tokens refuse', () => {
  const request = { clipIds: ['target', 'follower'], name: 'Scene', width: 1920, height: 1080 }
  const preview = store.getState().previewCreateCompound(request)
  assert.equal(preview.ok, true, preview.reason)
  const created = store.getState().applyCreateCompound(request, preview.token)
  assert.equal(noWrite(() => store.getState().beginRippleTrim({ clipId: created.clipId, edge: 'right' })).ok, false)
  assert.equal(store.getState().openCompound(created.clipId).ok, true)
  store.getState().setRippleEditMode(true)
  const session = begin(); apply(session, .5); store.getState().endRippleTrim(session.token)
  const stale = begin()
  assert.equal(store.getState().closeCompound().ok, true)
  assert.equal(noWrite(() => store.getState().applyRippleTrim(stale.token, .5)).ok, false)
  const document = store.getState().clips.find(clip => clip.id === created.clipId).compound.document
  assert.equal(document.clips.find(clip => clip.id === 'target').duration, 3.5)
  assert.equal(document.clips.find(clip => clip.id === 'follower').startTime, 4.5)
})
