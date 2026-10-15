import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { getCurrentPlayAround } from './playAround.mjs'
import { getCurrentPlaybackJump } from './playbackJump.mjs'
import { watchStoreForProjectChanges, TIMELINE_PROJECT_KEYS, markProjectClean, isProjectDirty } from '../services/projectDirtyTracker.js'

const require = createRequire(import.meta.url)
const code = buildSync({ entryPoints: [fileURLToPath(new URL('../stores/timelineStore.js', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'zustand', 'zustand/*'],
}).outputFiles[0].text
const module = { exports: {} }
Function('require', 'module', 'exports', 'localStorage', code)(require, module, module.exports,
  { getItem: () => null, setItem() {}, removeItem() {} })
const store = module.exports.useTimelineStore, initial = store.getState()
let stop
const fixture = () => ({ ...initial,
  clips: [{ id: 'shot', type: 'video', assetId: 'source', name: 'Shot', trackId: 'v1',
    startTime: 0, duration: 10, trimStart: 2, trimEnd: 12, sourceDuration: 20, sourceTimeScale: 1, speed: 1,
    timelineFps: 24, sourceFps: 24, transform: {}, keyframes: {}, effects: [] }],
  tracks: [{ id: 'v1', type: 'video', visible: true }], transitions: [], markers: [], duration: 20,
  timelineSessionId: 5, timelineFps: 24, compoundEditContext: null, playheadPosition: 5.0123456789,
  playheadSeekRevision: 0, playheadSeekIntent: null, playbackJump: null, playbackJumpRevision: 0,
  playbackJumpError: null, playAround: null, playAroundRevision: 0,
  isPlaying: false, playbackRate: -4, shuttleMode: true, loopMode: 'loop-in-out',
  history: [], historyIndex: -1, inPoint: 4, outPoint: 6, selectedClipIds: ['shot'],
})
beforeEach(() => {
  store.setState(fixture())
  stop = watchStoreForProjectChanges(store, TIMELINE_PROJECT_KEYS)
  markProjectClean()
})
afterEach(() => stop())
const noWrite = action => {
  const before = store.getState()
  let count = 0
  const off = store.subscribe(() => count++)
  let result
  try { result = action() } finally { off() }
  assert.equal(count, 0)
  assert.equal(store.getState(), before)
  return result
}
const releaseStart = () => {
  const jump = getCurrentPlaybackJump(store.getState())
  assert.ok(jump)
  assert.equal(store.getState().completePlaybackJump(jump.token), true)
}
const assertNoLateReturn = token => {
  const position = store.getState().playheadPosition
  assert.equal(noWrite(() => store.getState().finishPlayAround(token)), false)
  assert.equal(store.getState().playheadPosition, position)
}

test('start and normal completion preserve document/history/selection and return to the exact original position paused', () => {
  const before = store.getState(), document = before.getProjectData()
  const token = before.startPlayAround()
  const session = getCurrentPlayAround(store.getState())
  assert.equal(session.token, token)
  assert.deepEqual([session.startTime, session.endTime], [3, 7])
  assert.equal(store.getState().playheadPosition, session.startTime)
  assert.equal(store.getState().isPlaying, true)
  assert.equal(store.getState().playbackRate, 1)
  assert.equal(store.getState().shuttleMode, false)
  assert.equal(getCurrentPlaybackJump(store.getState()).targetTime, session.startTime)
  assert.equal(getCurrentPlaybackJump(store.getState()).playbackRate, 1)
  releaseStart()
  store.getState().setPlayheadPosition(6.95, { source: 'transport' })
  assert.equal(store.getState().finishPlayAround(token), true)
  const after = store.getState()
  assert.equal(after.playheadPosition, before.playheadPosition)
  assert.equal(after.isPlaying, false)
  assert.equal(after.playbackRate, before.playbackRate)
  assert.equal(after.shuttleMode, before.shuttleMode)
  assert.equal(after.playAround, null)
  assert.equal(after.playbackJump, null)
  assert.equal(after.playheadSeekIntent.type, 'frame-step')
  assert.equal(after.playheadSeekIntent.targetTime, before.playheadPosition)
  for (const key of ['clips', 'tracks', 'transitions', 'markers', 'history', 'historyIndex',
    'selectedClipIds', 'inPoint', 'outPoint', 'loopMode']) assert.equal(after[key], before[key], key)
  assert.deepEqual(after.getProjectData(), document)
  assert.equal(isProjectDirty(), false)
  assertNoLateReturn(token)
})

test('music audition uses the full exact clip range without changing marks or the document', () => {
  const clip = { ...fixture().clips[0], id: 'music', type: 'audio', trackId: 'a1', startTime: 1, duration: 8 }
  store.setState({ clips: [clip], tracks: [{ id: 'a1', type: 'audio' }], selectedClipIds: ['music'] })
  markProjectClean()
  const before = store.getState(), project = before.getProjectData()
  const token = before.startPlayAround(5, clip)
  assert.deepEqual([store.getState().playAround.startTime, store.getState().playAround.endTime], [1, 9])
  assert.equal(store.getState().finishPlayAround(token), true)
  assert.equal(store.getState().playheadPosition, before.playheadPosition)
  assert.deepEqual(store.getState().getProjectData(), project)
  assert.equal(isProjectDirty(), false)
  for (const invalid of [{ ...clip }, { ...clip, duration: NaN }, fixture().clips[0]]) {
    assert.equal(noWrite(() => store.getState().startPlayAround(5, invalid)), false)
  }
})

test('audition state and counters never appear in project or persisted JSON', () => {
  const before = store.getState().getProjectData()
  const token = store.getState().startPlayAround()
  for (const value of [store.getState().getProjectData(), store.persist.getOptions().partialize(store.getState())]) {
    const json = JSON.stringify(value)
    for (const key of ['playAround', 'playAroundRevision', 'returnTime', 'previousRate', 'previousShuttleMode']) {
      assert.equal(Object.hasOwn(value, key), false, key)
      assert.equal(json.includes(`"${key}":`), false, key)
    }
    assert.equal(json.includes(token), false)
  }
  store.getState().cancelPlayAround(token)
  assert.deepEqual(store.getState().getProjectData(), before)
  assert.equal(isProjectDirty(), false)
})

test('all existing loop modes and prior active playback stay unchanged, and completion always pauses', () => {
  for (const loopMode of ['normal', 'loop', 'loop-in-out', 'loop-selection', 'ping-pong']) {
    store.setState({ ...fixture(), loopMode, isPlaying: true, playbackRate: 0.5, shuttleMode: true })
    const before = store.getState()
    const token = before.startPlayAround()
    for (const key of ['loopMode', 'inPoint', 'outPoint', 'selectedClipIds']) {
      assert.equal(store.getState()[key], before[key], key)
    }
    assert.equal(store.getState().finishPlayAround(token), true)
    assert.equal(store.getState().isPlaying, false)
    assert.equal(store.getState().playbackRate, 0.5)
    assert.equal(store.getState().shuttleMode, true)
    for (const key of ['loopMode', 'inPoint', 'outPoint', 'selectedClipIds']) {
      assert.equal(store.getState()[key], before[key], key)
    }
  }
})

test('retrigger restarts its original center with fresh monotonic audition and decoder tokens', () => {
  const original = store.getState().playheadPosition
  const first = store.getState().startPlayAround()
  const firstSession = store.getState().playAround, firstJump = store.getState().playbackJump
  releaseStart()
  store.getState().setPlayheadPosition(6.25, { source: 'transport' })
  const second = store.getState().startPlayAround()
  assert.notEqual(second, first)
  assert.equal(store.getState().playAroundRevision, 2)
  assert.equal(store.getState().playAround.centerTime, firstSession.centerTime)
  assert.equal(store.getState().playAround.returnTime, original)
  assert.equal(store.getState().playAround.previousRate, -4)
  assert.equal(store.getState().playAround.previousShuttleMode, true)
  assert.notEqual(store.getState().playbackJump.token, firstJump.token)
  assert.equal(noWrite(() => store.getState().completePlaybackJump(firstJump.token)), false)
  assert.equal(noWrite(() => store.getState().finishPlayAround(first)), false)
  assert.equal(noWrite(() => store.getState().cancelPlayAround(first)), false)
  assert.equal(store.getState().finishPlayAround(second), true)
  assert.equal(store.getState().playheadPosition, original)
})

test('explicit center changes audition range while retaining the original return position', () => {
  const original = store.getState().playheadPosition
  const token = store.getState().startPlayAround(9)
  assert.deepEqual([store.getState().playAround.startTime, store.getState().playAround.endTime], [7, 10])
  assert.equal(store.getState().playAround.centerTime, 9)
  assert.equal(store.getState().finishPlayAround(token), true)
  assert.equal(store.getState().playheadPosition, original)
  assert.equal(isProjectDirty(), false)
})

test('empty timeline and invalid centers are no-op rejections without consuming revisions', () => {
  for (const center of [-1, 11, Infinity, NaN, 'invalid']) {
    assert.equal(noWrite(() => store.getState().startPlayAround(center)), false)
  }
  store.setState({ clips: [] })
  assert.equal(noWrite(() => store.getState().startPlayAround()), false)
  assert.equal(store.getState().playAroundRevision, 0)
})

test('explicit navigation, pause, cancellation and loop-mode changes retire the audition without returning', () => {
  for (const action of [() => store.getState().setPlayheadPosition(8),
    () => store.getState().togglePlay(), () => store.getState().shuttlePause(),
    () => store.getState().cancelPlayAround(), () => store.getState().setLoopMode('ping-pong')]) {
    store.setState(fixture())
    const token = store.getState().startPlayAround()
    releaseStart()
    store.getState().setPlayheadPosition(4.25, { source: 'transport' })
    action()
    assert.equal(store.getState().playAround, null)
    assert.notEqual(store.getState().playheadPosition, fixture().playheadPosition)
    assert.equal(store.getState().isPlaying, false)
    assertNoLateReturn(token)
  }
})

test('explicit rate and shuttle commands take ownership and cannot be overwritten by a late return', () => {
  for (const action of [() => store.getState().setPlaybackRate(-2),
    () => store.getState().shuttleForward(), () => store.getState().shuttleReverse(),
    () => store.getState().shuttleSlow('forward'), () => store.getState().shuttleSlow('reverse', true)]) {
    store.setState(fixture())
    const token = store.getState().startPlayAround()
    releaseStart()
    store.getState().setPlayheadPosition(4.25, { source: 'transport' })
    action()
    assert.equal(store.getState().playAround, null)
    assert.equal(store.getState().isPlaying, true)
    const transport = [store.getState().playbackRate, store.getState().shuttleMode]
    assertNoLateReturn(token)
    assert.deepEqual([store.getState().playbackRate, store.getState().shuttleMode], transport)
  }
})

test('decode failure retires the audition without returning or changing editorial state', () => {
  const before = store.getState(), token = before.startPlayAround()
  const target = store.getState().playheadPosition
  const jump = getCurrentPlaybackJump(store.getState())
  assert.equal(store.getState().failPlaybackJump(jump.token, 'Frame unavailable'), true)
  assert.equal(store.getState().playAround, null)
  assert.equal(store.getState().isPlaying, false)
  assert.equal(store.getState().playbackRate, before.playbackRate)
  assert.equal(store.getState().shuttleMode, before.shuttleMode)
  assert.equal(store.getState().playheadPosition, target)
  assert.equal(store.getState().playbackJumpError, 'Frame unavailable')
  for (const key of ['clips', 'tracks', 'transitions', 'history', 'selectedClipIds', 'inPoint', 'outPoint', 'loopMode']) {
    assert.equal(store.getState()[key], before[key], key)
  }
  assert.equal(isProjectDirty(), false)
  assertNoLateReturn(token)
})

test('replaced source/track/transition/session/FPS and point contexts cannot acknowledge an old return', () => {
  for (const patch of [state => ({ clips: state.clips.map(clip => ({ ...clip, assetId: 'replacement' })) }),
    state => ({ tracks: [...state.tracks] }), state => ({ transitions: [...state.transitions] }),
    () => ({ timelineSessionId: 6 }), () => ({ timelineFps: 30 }),
    () => ({ inPoint: 1 }), () => ({ outPoint: 9 }), () => ({ isPlaying: false }),
    () => ({ playbackRate: 2 }), () => ({ shuttleMode: true }), () => ({ playheadPosition: 9 })]) {
    store.setState(fixture())
    const token = store.getState().startPlayAround()
    store.setState(patch(store.getState()))
    assert.equal(getCurrentPlayAround(store.getState()), null)
    assertNoLateReturn(token)
  }
})

test('load, clear and FPS actions invalidate audition tokens without reusing revisions', () => {
  const document = store.getState().getProjectData()
  for (const action of [() => store.getState().loadFromProject(document), () => store.getState().clearProject(),
    () => store.getState().setTimelineFps(30)]) {
    const token = store.getState().startPlayAround(5)
    const revision = store.getState().playAroundRevision
    assert.ok(token)
    action()
    assert.equal(store.getState().playAround, null)
    assert.equal(store.getState().playAroundRevision, revision)
    assertNoLateReturn(token)
    if (!store.getState().clips.length) store.getState().loadFromProject(document)
    const next = store.getState().startPlayAround(5)
    assert.ok(next)
    assert.notEqual(next, token)
    assert.ok(store.getState().playAroundRevision > revision)
    store.getState().cancelPlayAround()
  }
})

test('entering and leaving a compound retires audition ownership without saving a child edit', () => {
  const input = { clipIds: ['shot'], name: 'Scene', width: 1920, height: 1080 }
  const plan = store.getState().previewCreateCompound(input)
  assert.equal(plan.ok, true, plan.reason)
  const created = store.getState().applyCreateCompound(input, plan.token)
  assert.equal(created.ok, true, created.reason)
  markProjectClean()
  const parentToken = store.getState().startPlayAround(5)
  assert.ok(parentToken)
  const parentRevision = store.getState().playAroundRevision
  assert.equal(store.getState().openCompound(created.clipId).ok, true)
  assert.equal(store.getState().playAround, null)
  assertNoLateReturn(parentToken)
  const childToken = store.getState().startPlayAround(5)
  assert.ok(childToken)
  assert.notEqual(childToken, parentToken)
  assert.ok(store.getState().playAroundRevision > parentRevision)
  assert.equal(store.getState().closeCompound().changed, false)
  assert.equal(store.getState().playAround, null)
  assertNoLateReturn(childToken)
  assert.equal(isProjectDirty(), false)
})
