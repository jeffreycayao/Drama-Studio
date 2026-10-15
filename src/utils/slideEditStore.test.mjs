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
const trio = () => ['previous', 'middle', 'next'].map((id, index) => ({ id, type: 'video', assetId: `source-${id}`,
  name: id, trackId: 'v', startTime: [2, 5, 7][index], duration: [3, 2, 3][index], trimStart: 2,
  trimEnd: [5, 4, 5][index], sourceDuration: 20, sourceTimeScale: 1, speed: 1, reverse: false, sourceFps: 10, timelineFps: 10 }))
const reset = patch => store.setState({ ...initial, clips: [...trio(), { ...trio()[0], id: 'other', trackId: 'other', startTime: 0, duration: 3 }],
  tracks: [{ id: 'v', type: 'video', name: 'Picture', visible: true }, { id: 'other', type: 'video', name: 'Overlay', visible: true }],
  transitions: [], markers: [{ id: 'm', time: 5 }], selectedClipIds: ['middle'], timelineFps: 10, timelineSessionId: 100,
  playheadPosition: 6, inPoint: 1, outPoint: 8, duration: 60, zoom: 120, isPlaying: false,
  history: [], historyIndex: -1, historyLastChangedAt: 0, rippleEditMode: false, ...patch })
const noWrite = action => {
  const state = store.getState(); let emissions = 0
  const off = store.subscribe(() => emissions++)
  let result
  try { result = action() } finally { off() }
  assert.equal(emissions, 0); assert.equal(store.getState(), state)
  return result
}
const begin = () => {
  const result = noWrite(() => store.getState().beginSlideEdit({ clipId: 'middle' }))
  assert.equal(result.ok, true, result.reason)
  return result
}
const apply = (session, delta) => {
  const result = store.getState().applySlideEdit(session.token, delta)
  assert.equal(result.ok, true, result.reason)
  return result
}
beforeEach(() => reset())
afterEach(() => reset())

test('begin, idle click and close create no writes or history', () => {
  const state = store.getState(), session = begin()
  assert.equal(session.feedback.middle.clip, state.clips[1])
  assert.equal(noWrite(() => apply(session, .01)).changed, false)
  assert.equal(noWrite(() => store.getState().endSlideEdit(session.token)).ok, true)
  assert.equal(state.history.length, 0)
})

test('first effective move publishes all three clips and the single checkpoint in one store emission', () => {
  const before = store.getState(), session = begin(), emissions = []
  const off = store.subscribe(state => emissions.push(state))
  const result = apply(session, .4); off()
  assert.equal(emissions.length, 1)
  const state = emissions[0]
  for (let index = 0; index < 3; index++) assert.notEqual(state.clips[index], before.clips[index])
  assert.equal(state.clips[3], before.clips[3])
  assert.deepEqual(state.clips.slice(0, 3).map(c => [c.startTime, c.duration]), [[2, 3.4], [5.4, 2], [7.4, 2.6]])
  assert.equal(state.history.length, 1)
  assert.deepEqual({ ...state.clips[1], startTime: before.clips[1].startTime }, before.clips[1])
  assert.equal(result.feedback.outgoing.clip, state.clips[0]); assert.equal(result.feedback.middle.clip, state.clips[1]); assert.equal(result.feedback.incoming.clip, state.clips[2])
  for (const key of ['tracks', 'transitions', 'markers', 'playheadPosition', 'inPoint', 'outPoint', 'duration', 'selectedClipIds', 'zoom', 'viewportNavigation', 'viewportNavigationRevision']) assert.equal(state[key], before[key])
  const repeat = noWrite(() => apply(session, .4))
  assert.equal(repeat.changed, false); assert.equal(repeat.feedback.outgoing.clip, state.clips[0]); assert.equal(repeat.feedback.incoming.clip, state.clips[2]); assert.equal(repeat.feedback.middle.clip, state.clips[1])
  noWrite(() => store.getState().endSlideEdit(session.token))
})

test('cumulative moves retain one history checkpoint, boundary repeats are neutral, and Undo/Redo affects the full group', () => {
  const original = store.getState().clips, session = begin()
  apply(session, .4); const history = store.getState().history
  apply(session, -.3)
  assert.equal(store.getState().clips[1].startTime, 4.7)
  assert.equal(store.getState().history, history)
  const result = apply(session, 99)
  assert.equal(result.delta, 2.9)
  assert.equal(noWrite(() => apply(session, 101)).changed, false)
  const last = store.getState().clips
  noWrite(() => store.getState().endSlideEdit(session.token))
  store.getState().undo()
  for (let index = 0; index < 3; index++) for (const key of ['startTime', 'duration', 'trimStart', 'trimEnd']) assert.equal(store.getState().clips[index][key], original[index][key])
  store.getState().redo()
  for (let index = 0; index < 3; index++) for (const key of ['startTime', 'duration', 'trimStart', 'trimEnd']) assert.equal(store.getState().clips[index][key], last[index][key])
})

test('returning to origin restores exact original document/history references and preserves preexisting Redo', () => {
  for (const fromUndo of [false, true]) {
    reset()
    if (fromUndo) { const prior = begin(); apply(prior, .5); store.getState().endSlideEdit(prior.token); store.getState().undo() }
    const before = store.getState(), session = begin()
    apply(session, .7); apply(session, -.8); apply(session, 0)
    assert.equal(store.getState().clips, before.clips)
    assert.equal(store.getState().endSlideEdit(session.token).ok, true)
    for (const key of ['history', 'historyIndex', 'historyLastChangedAt', 'duration', 'transitions']) assert.equal(store.getState()[key], before[key])
    if (fromUndo) assert.equal(store.getState().canRedo(), true)
  }
})

test('multiple or different selected clips refuse while an empty explicit selection remains eligible', () => {
  for (const selectedClipIds of [['middle', 'previous'], ['previous'], ['middle', 'middle']]) {
    reset({ selectedClipIds })
    assert.equal(noWrite(() => store.getState().beginSlideEdit({ clipId: 'middle' })).ok, false)
  }
  reset({ selectedClipIds: [] }); const session = begin()
  noWrite(() => store.getState().endSlideEdit(session.token))
})

test('all captured state changes, consumed tokens and malformed pointer deltas reject without writes', () => {
  for (const key of ['clips', 'tracks', 'transitions', 'markers', 'timelineFps', 'timelineSessionId', 'history', 'historyIndex',
    'duration', 'isPlaying', 'selectedClipIds', 'clipCounter', 'markerCounter', 'transitionCounter', 'zoom', 'masterAudioVolume', 'masterAudioInserts',
    'rippleEditMode', 'snappingEnabled', 'snappingThreshold']) {
    reset(); const session = begin(), value = store.getState()[key]
    store.setState({ [key]: Array.isArray(value) ? [...value] : typeof value === 'number' ? value + 1 : !value })
    assert.equal(noWrite(() => store.getState().applySlideEdit(session.token, .5)).ok, false, key)
    noWrite(() => store.getState().endSlideEdit(session.token))
  }
  reset(); const session = begin()
  for (const delta of [null, NaN, Infinity, '1']) assert.equal(noWrite(() => store.getState().applySlideEdit(session.token, delta)).ok, false)
  noWrite(() => store.getState().endSlideEdit(session.token))
  assert.equal(noWrite(() => store.getState().applySlideEdit(session.token, .4)).ok, false)
  assert.equal(noWrite(() => store.getState().endSlideEdit(session.token)).ok, false)
})

test('public session and bounds cannot redirect clips or expand the private legal range', () => {
  const session = begin()
  session.session.clipId = 'other'; session.session.previousClipId = 'other'; session.session.originalStartTime = 100
  session.session.snapExcludedClipIds.push('other'); session.bounds.maximumDelta = 100
  const result = apply(session, 100)
  assert.equal(result.delta, 2.9); assert.equal(result.session.clipId, 'middle')
  assert.deepEqual(result.session.snapExcludedClipIds, ['previous', 'middle', 'next'])
  assert.equal(store.getState().clips[3].startTime, 0)
})

test('locks, clocks, links, transitions, missing neighbors and malformed identities refuse without normalization', () => {
  for (let index = 0; index < 3; index++) for (const patch of [{ locked: true }, { syncLocked: true }, { sourceDuration: null },
    { sourceTimeScale: .5 }, { trimEnd: 19 }, { keyframes: { speed: [{ time: 0, value: 1 }] } },
    { cacheStatus: 'rendering' }, { metadata: { captionScope: 'timeline' } }]) {
    reset(); const clips = [...store.getState().clips]; clips[index] = { ...clips[index], ...patch }; store.setState({ clips })
    assert.equal(noWrite(() => store.getState().beginSlideEdit({ clipId: 'middle' })).ok, false, `${index} ${JSON.stringify(patch)}`)
  }
  for (const patch of [{ isPlaying: true }, { clips: trio().slice(1) }, { transitions: [{ id: 't', clipAId: 'previous', clipBId: 'middle' }] },
    { clips: trio().map(c => ({ ...c, linkGroupId: 'linked' })) }]) {
    reset(patch); assert.equal(noWrite(() => store.getState().beginSlideEdit({ clipId: 'middle' })).ok, false)
  }
  reset({ clips: [{ ...trio()[1], trackId: undefined }], tracks: [{}] })
  assert.equal(noWrite(() => store.getState().beginSlideEdit({ clipId: 'middle' })).ok, false)
})

test('subscriber edits cannot be adopted into the session or overwritten by subsequent move/end', () => {
  const session = begin(); let externalClips, externalHistory, fired = false
  const off = store.subscribe(state => {
    if (fired) return
    fired = true
    externalClips = state.clips.map(clip => ({ ...clip, name: 'Subscriber edit' }))
    externalHistory = [...state.history]
    store.setState({ clips: externalClips, history: externalHistory })
  })
  const result = store.getState().applySlideEdit(session.token, .5); off()
  assert.equal(result.ok, false); assert.equal(result.changed, true)
  assert.equal(store.getState().clips, externalClips)
  assert.equal(noWrite(() => store.getState().applySlideEdit(session.token, 0)).ok, false)
  noWrite(() => store.getState().endSlideEdit(session.token))
  assert.equal(store.getState().clips, externalClips); assert.equal(store.getState().history, externalHistory)
})

test('an outside history action after origin is never deleted by gesture cleanup', () => {
  const session = begin(); apply(session, .5); apply(session, 0)
  store.getState().saveToHistory()
  const history = store.getState().history
  noWrite(() => store.getState().endSlideEdit(session.token))
  assert.equal(store.getState().history, history)
})

test('ordinary compound children can Slide and persist on Back; compound parents and stale child tokens refuse', () => {
  const request = { clipIds: ['previous', 'middle', 'next'], name: 'Scene', width: 1920, height: 1080 }
  const preview = store.getState().previewCreateCompound(request)
  assert.equal(preview.ok, true, preview.reason)
  const created = store.getState().applyCreateCompound(request, preview.token)
  assert.equal(noWrite(() => store.getState().beginSlideEdit({ clipId: created.clipId })).ok, false)
  assert.equal(store.getState().openCompound(created.clipId).ok, true)
  const session = begin(), originalMiddle = store.getState().clips.find(c => c.id === 'middle')
  apply(session, .4); store.getState().endSlideEdit(session.token)
  const stale = begin()
  assert.equal(store.getState().closeCompound().ok, true)
  const child = store.getState().clips.find(c => c.id === created.clipId).compound.document.clips.find(c => c.id === 'middle')
  assert.equal(child.startTime, originalMiddle.startTime + .4)
  assert.equal(child.duration, originalMiddle.duration); assert.equal(child.trimStart, originalMiddle.trimStart)
  assert.equal(noWrite(() => store.getState().applySlideEdit(stale.token, .5)).ok, false)
})
