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
const clip = patch => ({ id: 'a', type: 'video', assetId: 'source', name: 'A', trackId: 'v', startTime: 2,
  duration: 3, trimStart: 2, trimEnd: 5, sourceDuration: 20, speed: 1, reverse: false, sourceTimeScale: 1,
  timelineFps: 10, sourceFps: 10, ...patch })
const reset = patch => store.setState({ ...initial, clips: [clip(), clip({ id: 'b', startTime: 5, duration: 2, trimStart: 4, trimEnd: 6 })],
  tracks: [{ id: 'v', type: 'video' }], transitions: [], markers: [{ id: 'marker-1', time: 6 }],
  selectedClipIds: ['a'], playheadPosition: 4, inPoint: 1, outPoint: 8, duration: 60, timelineFps: 10,
  history: [], historyIndex: -1, historyLastChangedAt: 0, ...patch })
const noWrite = action => {
  const state = store.getState(); let count = 0
  const off = store.subscribe(() => count++)
  let result
  try { result = action() } finally { off() }
  assert.equal(count, 0)
  assert.equal(store.getState(), state)
  return result
}
const begin = () => {
  const result = noWrite(() => store.getState().beginRollEdit({ clipAId: 'a', clipBId: 'b' }))
  assert.equal(result.ok, true, result.reason)
  return result
}
const apply = (session, delta) => {
  const result = store.getState().applyRollEdit(session.token, delta)
  assert.equal(result.ok, true, result.reason)
  return result
}
beforeEach(() => reset())
afterEach(() => reset())

test('begin and idle gestures are read-only; first changed frame publishes both sides and history together', () => {
  const before = store.getState(), session = begin()
  assert.equal(noWrite(() => apply(session, .01)).changed, false)
  let changes = []
  const off = store.subscribe(state => changes.push(state))
  const result = apply(session, .15); off()
  assert.equal(changes.length, 1)
  const state = changes[0]
  assert.notEqual(state.clips[0], before.clips[0]); assert.notEqual(state.clips[1], before.clips[1])
  assert.equal(state.clips[0].duration, 3.2); assert.equal(state.clips[1].startTime, 5.2)
  assert.equal(state.history.length, 1)
  assert.equal(result.feedback.outgoing.clip, state.clips[0]); assert.equal(result.feedback.incoming.clip, state.clips[1])
  for (const key of ['tracks', 'transitions', 'markers', 'playheadPosition', 'inPoint', 'outPoint', 'duration', 'selectedClipIds']) assert.equal(state[key], before[key])
  const again = noWrite(() => apply(session, .2))
  assert.equal(again.changed, false)
  assert.equal(again.feedback.outgoing.clip, state.clips[0]); assert.equal(again.feedback.incoming.clip, state.clips[1])
  noWrite(() => store.getState().endRollEdit(session.token))
})

test('cumulative moves create one checkpoint and repeated boundary pixels do not write', () => {
  const before = store.getState(), session = begin()
  apply(session, .4)
  const history = store.getState().history
  apply(session, -.3)
  assert.equal(store.getState().clips[0].duration, 2.7)
  assert.equal(store.getState().clips[1].startTime, 4.7)
  assert.equal(store.getState().history, history)
  apply(session, 99)
  assert.equal(noWrite(() => apply(session, 101)).changed, false)
  noWrite(() => store.getState().endRollEdit(session.token))
  store.getState().undo()
  assert.deepEqual(store.getState().clips.map(({ duration, startTime, trimStart, trimEnd }) => ({ duration, startTime, trimStart, trimEnd })),
    before.clips.map(({ duration, startTime, trimStart, trimEnd }) => ({ duration, startTime, trimStart, trimEnd })))
})

test('returning to origin restores exact clip and history references, including an existing Redo branch', () => {
  for (const fromUndo of [false, true]) {
    reset()
    if (fromUndo) {
      const prior = begin(); apply(prior, .5); store.getState().endRollEdit(prior.token); store.getState().undo()
      assert.equal(store.getState().canRedo(), true)
    }
    const before = store.getState(), session = begin()
    apply(session, .6); apply(session, 0)
    assert.equal(store.getState().clips, before.clips)
    assert.equal(store.getState().endRollEdit(session.token).ok, true)
    assert.equal(store.getState().history, before.history)
    assert.equal(store.getState().historyIndex, before.historyIndex)
    assert.equal(store.getState().historyLastChangedAt, before.historyLastChangedAt)
    if (fromUndo) assert.equal(store.getState().canRedo(), true)
  }
})

test('stale expected state, stopped tokens and malformed pointer input reject without history or clips writes', () => {
  for (const key of ['clips', 'tracks', 'transitions', 'markers', 'timelineFps', 'timelineSessionId', 'history', 'historyIndex',
    'duration', 'isPlaying', 'selectedClipIds', 'clipCounter', 'markerCounter', 'transitionCounter', 'zoom', 'masterAudioVolume', 'masterAudioInserts']) {
    reset(); const session = begin(), value = store.getState()[key]
    store.setState({ [key]: Array.isArray(value) ? [...value] : typeof value === 'number' ? value + 1 : !value })
    assert.equal(noWrite(() => store.getState().applyRollEdit(session.token, .5)).ok, false, key)
    noWrite(() => store.getState().endRollEdit(session.token))
  }
  reset(); const session = begin()
  for (const delta of [NaN, null, Infinity, '1']) assert.equal(noWrite(() => store.getState().applyRollEdit(session.token, delta)).ok, false)
  noWrite(() => store.getState().endRollEdit(session.token))
  assert.equal(noWrite(() => store.getState().applyRollEdit(session.token, .4)).ok, false)
  assert.equal(noWrite(() => store.getState().endRollEdit(session.token)).ok, false)
})

test('public feedback session and bounds cannot alter private timing or bypass limits', () => {
  const session = begin()
  session.session.clipAOriginalDuration = 100
  session.session.clipBId = 'other'
  session.bounds.maximumDelta = 100
  session.bounds.maximumLimit.label = 'Changed'
  const result = apply(session, 99)
  assert.equal(result.delta, 1.9)
  assert.equal(store.getState().clips[0].duration, 4.9)
  assert.equal(store.getState().clips[1].duration, .1)
  assert.equal(result.bounds.maximumLimit.label, 'Incoming clip minimum duration')
})

test('malformed or unsafe second side refuses before any first-side mutation', () => {
  for (const patch of [{ locked: true }, { syncLocked: true }, { lockMode: 'sync' }, { syncLock: { mode: 'sync' } },
    { trimStart: -1 }, { trimEnd: 5 }, { speed: 0 }, { sourceDuration: null },
    { sourceTimeScale: .5, trimEnd: 5 }, { keyframes: { speed: [{ time: 0, value: 1 }] } },
    { cacheStatus: 'rendering' }, { volumeEnvelope: { version: 7 } }, { metadata: { captionScope: 'timeline' } }]) {
    reset(); store.setState({ clips: [store.getState().clips[0], { ...store.getState().clips[1], ...patch }] })
    assert.equal(noWrite(() => store.getState().beginRollEdit({ clipAId: 'a', clipBId: 'b' })).ok, false, JSON.stringify(patch))
  }
  reset({ isPlaying: true })
  assert.equal(noWrite(() => store.getState().beginRollEdit({ clipAId: 'a', clipBId: 'b' })).ok, false)
})

test('subscriber edits are never adopted as gesture state or overwritten by a later move/end', () => {
  const session = begin(); let externalClips, externalHistory, fired = false
  const off = store.subscribe(state => {
    if (fired) return
    fired = true
    externalClips = state.clips.map(clip => ({ ...clip, name: 'Subscriber edit' }))
    externalHistory = [...state.history]
    store.setState({ clips: externalClips, history: externalHistory })
  })
  const result = store.getState().applyRollEdit(session.token, .5); off()
  assert.equal(result.ok, false)
  assert.equal(result.changed, true)
  assert.equal(store.getState().clips, externalClips)
  assert.equal(noWrite(() => store.getState().applyRollEdit(session.token, 0)).ok, false)
  noWrite(() => store.getState().endRollEdit(session.token))
  assert.equal(store.getState().clips, externalClips)
  assert.equal(store.getState().history, externalHistory)
})

test('a stale end never erases another edit or its history after returning to origin', () => {
  const session = begin(); apply(session, .5); apply(session, 0)
  store.getState().saveToHistory()
  const history = store.getState().history
  noWrite(() => store.getState().endRollEdit(session.token))
  assert.equal(store.getState().history, history)
})

test('compound parents cannot bypass guards, while ordinary child pairs can roll and checkpoint Back', () => {
  const request = { clipIds: ['a', 'b'], name: 'Scene', width: 1920, height: 1080 }
  const preview = store.getState().previewCreateCompound(request)
  assert.equal(preview.ok, true, preview.reason)
  const created = store.getState().applyCreateCompound(request, preview.token)
  const parent = store.getState().clips.find(clip => clip.id === created.clipId)
  store.setState({ clips: [parent, clip({ id: 'other', startTime: parent.startTime + parent.duration })] })
  assert.equal(noWrite(() => store.getState().beginRollEdit({ clipAId: parent.id, clipBId: 'other' })).ok, false)
  store.setState({ clips: [parent] })
  assert.equal(store.getState().openCompound(parent.id).ok, true)
  const session = begin(); apply(session, .5); store.getState().endRollEdit(session.token)
  assert.equal(store.getState().closeCompound().ok, true)
  assert.equal(store.getState().clips[0].compound.document.clips[0].duration, 3.5)
  assert.equal(noWrite(() => store.getState().applyRollEdit(session.token, .6)).ok, false)
})
