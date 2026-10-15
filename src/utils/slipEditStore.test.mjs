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
const clip = patch => ({ id: 'clip', type: 'video', assetId: 'source', name: 'Take', trackId: 'v', startTime: 2,
  duration: 3, trimStart: 2, trimEnd: 5, sourceDuration: 10, speed: 1, reverse: false, sourceTimeScale: 1,
  timelineFps: 10, sourceFps: 10, ...patch })
const reset = patch => store.setState({ ...initial, clips: [clip(), clip({ id: 'neighbor', startTime: 5 })],
  tracks: [{ id: 'v', type: 'video' }], transitions: [], markers: [{ id: 'marker-1', time: 6 }],
  selectedClipIds: ['clip'], playheadPosition: 4, inPoint: 1, outPoint: 8, duration: 60, timelineFps: 10,
  history: [], historyIndex: -1, historyLastChangedAt: 0, ...patch })
const noWrite = action => {
  const state = store.getState(); let count = 0
  const off = store.subscribe(() => count++)
  let result
  try { result = action() } finally { off() }
  assert.equal(count, 0); assert.equal(store.getState(), state)
  return result
}
const begin = () => {
  const result = noWrite(() => store.getState().beginSlipEdit({ clipId: 'clip' }))
  assert.equal(result.ok, true, result.reason)
  return result
}
const apply = (session, delta) => {
  const result = store.getState().applySlipEdit(session.token, delta)
  assert.equal(result.ok, true, result.reason)
  return result
}
beforeEach(() => reset())
afterEach(() => reset())

test('begin/idle/close never write; first changed move publishes target source trims and one checkpoint atomically', () => {
  const before = store.getState(), session = begin()
  assert.equal(noWrite(() => apply(session, .01)).changed, false)
  let states = []; const off = store.subscribe(state => states.push(state))
  const result = apply(session, .15); off()
  assert.equal(states.length, 1)
  const state = states[0]
  assert.notEqual(state.clips[0], before.clips[0]); assert.equal(state.clips[1], before.clips[1])
  assert.equal(state.clips[0].trimStart, 2.2); assert.equal(state.clips[0].trimEnd, 5.2)
  assert.equal(state.history.length, 1)
  assert.equal(result.feedback.first.clip, state.clips[0]); assert.equal(result.feedback.last.clip, state.clips[0])
  for (const key of ['tracks', 'transitions', 'markers', 'playheadPosition', 'inPoint', 'outPoint', 'duration', 'selectedClipIds']) assert.equal(state[key], before[key])
  const repeat = noWrite(() => apply(session, .2))
  assert.equal(repeat.changed, false)
  assert.equal(repeat.feedback.first.clip, state.clips[0]); assert.equal(repeat.feedback.last.clip, state.clips[0])
  noWrite(() => store.getState().endSlipEdit(session.token))
})

test('moves are cumulative from original source range, boundary repeats are no-op, and one Undo restores the take', () => {
  const before = store.getState(), session = begin()
  apply(session, .4); const history = store.getState().history
  apply(session, -.3)
  assert.equal(store.getState().clips[0].trimStart, 1.7)
  assert.equal(store.getState().clips[0].trimEnd, 4.7)
  assert.equal(store.getState().history, history)
  apply(session, 99)
  assert.equal(noWrite(() => apply(session, 101)).changed, false)
  noWrite(() => store.getState().endSlipEdit(session.token))
  store.getState().undo()
  assert.equal(store.getState().clips[0].trimStart, before.clips[0].trimStart)
  assert.equal(store.getState().clips[0].trimEnd, before.clips[0].trimEnd)
  store.getState().redo()
  assert.equal(store.getState().clips[0].trimEnd, 10)
})

test('return to origin restores exact document/history references and preserves a preexisting Redo branch', () => {
  for (const fromUndo of [false, true]) {
    reset()
    if (fromUndo) {
      const prior = begin(); apply(prior, .5); store.getState().endSlipEdit(prior.token); store.getState().undo()
      assert.equal(store.getState().canRedo(), true)
    }
    const before = store.getState(), session = begin()
    apply(session, .6); apply(session, 0)
    assert.equal(store.getState().clips, before.clips)
    assert.equal(store.getState().endSlipEdit(session.token).ok, true)
    assert.equal(store.getState().history, before.history)
    assert.equal(store.getState().historyIndex, before.historyIndex)
    assert.equal(store.getState().historyLastChangedAt, before.historyLastChangedAt)
    if (fromUndo) assert.equal(store.getState().canRedo(), true)
  }
})

test('all bound state changes, consumed tokens and malformed pointer deltas refuse without writes', () => {
  for (const key of ['clips', 'tracks', 'transitions', 'markers', 'timelineFps', 'timelineSessionId', 'history', 'historyIndex',
    'duration', 'isPlaying', 'selectedClipIds', 'clipCounter', 'markerCounter', 'transitionCounter', 'zoom', 'masterAudioVolume', 'masterAudioInserts']) {
    reset(); const session = begin(), value = store.getState()[key]
    store.setState({ [key]: Array.isArray(value) ? [...value] : typeof value === 'number' ? value + 1 : !value })
    assert.equal(noWrite(() => store.getState().applySlipEdit(session.token, .5)).ok, false, key)
    noWrite(() => store.getState().endSlipEdit(session.token))
  }
  reset(); const session = begin()
  for (const delta of [NaN, null, Infinity, '1']) assert.equal(noWrite(() => store.getState().applySlipEdit(session.token, delta)).ok, false)
  noWrite(() => store.getState().endSlipEdit(session.token))
  assert.equal(noWrite(() => store.getState().applySlipEdit(session.token, .4)).ok, false)
  assert.equal(noWrite(() => store.getState().endSlipEdit(session.token)).ok, false)
})

test('public session/bounds cannot redirect or expand a private edit; explicit target remains selection-independent', () => {
  store.setState({ selectedClipIds: ['neighbor'] })
  const session = begin()
  session.session.clipId = 'neighbor'; session.session.originalTrimStart = 100; session.session.timeScale = 100
  session.bounds.maximumDelta = 100
  const result = apply(session, 99)
  assert.equal(result.delta, 5)
  assert.equal(store.getState().clips[0].trimStart, 7)
  assert.equal(store.getState().clips[0].trimEnd, 10)
  assert.equal(store.getState().clips[1].trimStart, 2)
})

test('unsupported target and unknown/noncanonical source clocks refuse before history or metadata normalization', () => {
  for (const patch of [{ type: 'image' }, { type: 'text' }, { type: 'shape' }, { type: 'adjustment' },
    { locked: true }, { syncLocked: true }, { lockMode: 'sync' }, { syncLock: { mode: 'sync' } },
    { trimStart: -1 }, { trimEnd: 4 }, { speed: 0 }, { sourceDuration: null },
    { sourceTimeScale: .5, trimEnd: 3.5 }, { keyframes: { speed: [{ time: 0, value: 1 }] } },
    { reverse: true, keyframes: { speed: [{ time: 0, value: 1 }] } }, { cacheStatus: 'rendering' }, { metadata: { captionScope: 'timeline' } }]) {
    reset(); store.setState({ clips: [{ ...store.getState().clips[0], ...patch }, store.getState().clips[1]] })
    assert.equal(noWrite(() => store.getState().beginSlipEdit({ clipId: 'clip' })).ok, false, JSON.stringify(patch))
  }
  reset({ isPlaying: true })
  assert.equal(noWrite(() => store.getState().beginSlipEdit({ clipId: 'clip' })).ok, false)
  reset({ transitions: [{ id: 't', clipId: 'clip', kind: 'edge', edge: 'out' }] })
  assert.equal(noWrite(() => store.getState().beginSlipEdit({ clipId: 'clip' })).ok, false)
  reset(); store.setState({ clips: store.getState().clips.map(clip => ({ ...clip, linkGroupId: 'link' })) })
  assert.equal(noWrite(() => store.getState().beginSlipEdit({ clipId: 'clip' })).ok, false)
})

test('subscriber edits cannot be adopted by the gesture or overwritten on a later move/end', () => {
  const session = begin(); let externalClips, externalHistory, fired = false
  const off = store.subscribe(state => {
    if (fired) return
    fired = true
    externalClips = state.clips.map(clip => ({ ...clip, name: 'Subscriber edit' }))
    externalHistory = [...state.history]
    store.setState({ clips: externalClips, history: externalHistory })
  })
  const result = store.getState().applySlipEdit(session.token, .5); off()
  assert.equal(result.ok, false); assert.equal(result.changed, true)
  assert.equal(store.getState().clips, externalClips)
  assert.equal(noWrite(() => store.getState().applySlipEdit(session.token, 0)).ok, false)
  noWrite(() => store.getState().endSlipEdit(session.token))
  assert.equal(store.getState().clips, externalClips); assert.equal(store.getState().history, externalHistory)
})

test('an unrelated history edit after returning to origin is never removed by Slip cleanup', () => {
  const session = begin(); apply(session, .5); apply(session, 0)
  store.getState().saveToHistory()
  const history = store.getState().history
  noWrite(() => store.getState().endSlipEdit(session.token))
  assert.equal(store.getState().history, history)
})

test('compound parents cannot bypass guards; ordinary child media can Slip and persist through Back', () => {
  const request = { clipIds: ['clip'], name: 'Scene', width: 1920, height: 1080 }
  const preview = store.getState().previewCreateCompound(request)
  assert.equal(preview.ok, true, preview.reason)
  const created = store.getState().applyCreateCompound(request, preview.token)
  assert.equal(noWrite(() => store.getState().beginSlipEdit({ clipId: created.clipId })).ok, false)
  assert.equal(store.getState().openCompound(created.clipId).ok, true)
  const session = begin(); apply(session, .5)
  store.getState().endSlipEdit(session.token)
  const stale = begin()
  assert.equal(store.getState().closeCompound().ok, true)
  assert.equal(store.getState().clips.find(clip => clip.id === created.clipId).compound.document.clips[0].trimStart, 2.5)
  assert.equal(noWrite(() => store.getState().applySlipEdit(stale.token, .5)).ok, false)
})

test('source sparse trims are not materialized by begin/click but canonical fallback media can slip', () => {
  reset({ clips: [clip({ trimStart: undefined, trimEnd: 3 })] })
  const before = store.getState(), session = begin()
  assert.equal(before.clips[0].trimStart, undefined)
  assert.equal(noWrite(() => apply(session, 0)).feedback.first.clip, before.clips[0])
  apply(session, .4)
  assert.equal(store.getState().clips[0].trimStart, .4)
  assert.equal(store.getState().clips[0].trimEnd, 3.4)
})
