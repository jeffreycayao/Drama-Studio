import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
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
beforeEach(() => {
  store.setState({ ...initial, clips: [{ id: 'shot', type: 'video', assetId: 'source', name: 'Shot', trackId: 'v1',
    startTime: 0, duration: 10, trimStart: 2, trimEnd: 12, sourceDuration: 20, sourceTimeScale: 1, speed: 1,
    timelineFps: 24, sourceFps: 24, transform: {}, keyframes: {}, effects: [] }],
    tracks: [{ id: 'v1', type: 'video', visible: true }], transitions: [], markers: [], duration: 20,
    timelineSessionId: 5, timelineFps: 24, compoundEditContext: null, playheadPosition: 8,
    playheadSeekRevision: 0, playheadSeekIntent: null, playbackJump: null, playbackJumpRevision: 0,
    playbackJumpError: null, isPlaying: true, playbackRate: 1, history: [], historyIndex: -1,
    inPoint: null, outPoint: null, selectedClipIds: ['shot'] })
  stop = watchStoreForProjectChanges(store, TIMELINE_PROJECT_KEYS)
  markProjectClean()
})
afterEach(() => stop())
const jump = target => {
  store.getState().setPlayheadPosition(target, { snap: true })
  return getCurrentPlaybackJump(store.getState())
}
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

test('user jumps hold transport and preserve the document, history, selection and dirty state', () => {
  const before = store.getState(), document = before.getProjectData()
  const request = jump(3.125)
  assert.ok(request)
  assert.equal(request.targetTime, 3.125)
  assert.equal(store.getState().isPlaying, true)
  noWrite(() => store.getState().setPlayheadPosition(3.25, { source: 'transport' }))
  for (const key of ['clips', 'tracks', 'transitions', 'markers', 'history', 'historyIndex', 'selectedClipIds']) {
    assert.equal(store.getState()[key], before[key], key)
  }
  assert.deepEqual(store.getState().getProjectData(), document)
  assert.equal(isProjectDirty(), false)
  const persisted = store.persist.getOptions().partialize(store.getState())
  for (const key of ['playbackJump', 'playbackJumpRevision', 'playbackJumpError']) {
    assert.equal(key in document, false)
    assert.equal(key in persisted, false)
  }
})

test('newest target wins and only its current token can release playback', () => {
  const first = jump(2), latest = jump(6)
  assert.notEqual(first.token, latest.token)
  assert.equal(noWrite(() => store.getState().completePlaybackJump(first.token)), false)
  assert.equal(noWrite(() => store.getState().failPlaybackJump(first.token, 'old failure')), false)
  assert.equal(store.getState().completePlaybackJump(latest.token), true)
  assert.equal(store.getState().playbackJump, null)
  assert.equal(noWrite(() => store.getState().completePlaybackJump(latest.token)), false)
  store.getState().setPlayheadPosition(6.05, { source: 'transport' })
  assert.equal(store.getState().playheadPosition, 6.05)
  assert.equal(store.getState().playbackJump, null)
})

test('same-target pending press/release reuses its decoder token and bounded deadline', () => {
  const first = jump(3)
  const same = jump(3)
  assert.equal(same, first)
  assert.equal(same.requestedAt, first.requestedAt)
  store.getState().completePlaybackJump(first.token)
  assert.notEqual(jump(3).token, first.token, 'a new request after completion is a fresh handoff')
})

test('normal clock ticks and cuts stay continuous; only loop discontinuities make requests', () => {
  store.getState().setPlayheadPosition(9, { source: 'transport' })
  assert.equal(store.getState().playbackJump, null)
  store.getState().setPlayheadPosition(0, { source: 'transport', discontinuity: true })
  assert.equal(getCurrentPlaybackJump(store.getState()).targetTime, 0)
})

test('failure pauses with a transient error, and explicit navigation clears that error', () => {
  const request = jump(2)
  assert.equal(store.getState().failPlaybackJump(request.token, 'The requested media is unavailable.'), true)
  assert.equal(store.getState().isPlaying, false)
  assert.equal(store.getState().playbackJump, null)
  assert.equal(store.getState().playbackJumpError, 'The requested media is unavailable.')
  assert.equal(store.getState().playheadPosition, 2)
  assert.equal(isProjectDirty(), false)
  noWrite(() => store.getState().setPlayheadPosition(9, { source: 'transport' }))
  jump(3)
  assert.equal(store.getState().playbackJump, null, 'paused navigation creates no playback hold')
  assert.equal(store.getState().playbackJumpError, null)
})

test('pause invalidates pending work and old acknowledgements cannot affect a retry', () => {
  const old = jump(2)
  store.getState().shuttlePause()
  assert.equal(store.getState().playbackJump, null)
  assert.equal(noWrite(() => store.getState().completePlaybackJump(old.token)), false)
  store.getState().togglePlay()
  const next = jump(2)
  assert.notEqual(next.token, old.token)
  store.getState().togglePlay()
  assert.equal(store.getState().playbackJump, null)
})

test('Play and J/L retry a failed target with a fresh token/deadline; ordinary Play remains continuous', () => {
  store.getState().shuttlePause()
  store.getState().togglePlay()
  assert.equal(store.getState().playbackJump, null)
  for (const restart of [() => store.getState().togglePlay(), () => store.getState().shuttleForward(),
    () => store.getState().shuttleReverse(), () => store.getState().shuttleSlow('forward')]) {
    store.getState().setPlayheadPosition(3.02)
    const old = getCurrentPlaybackJump(store.getState())
    store.setState({ playbackJump: { ...old, requestedAt: 1 } })
    store.getState().failPlaybackJump(old.token, 'Decoder did not become ready.')
    restart()
    const retry = getCurrentPlaybackJump(store.getState())
    assert.ok(retry)
    assert.equal(retry.targetTime, 3.02)
    assert.notEqual(retry.token, old.token)
    assert.ok(retry.requestedAt > 1)
    assert.equal(store.getState().playbackJumpError, null)
    assert.equal(noWrite(() => store.getState().completePlaybackJump(old.token)), false)
    store.getState().completePlaybackJump(retry.token)
  }
})

test('changing shuttle rate reissues a pending target without releasing its clock hold', () => {
  let previous = jump(2)
  for (const action of [() => store.getState().setPlaybackRate(-1), () => store.getState().shuttleForward(),
    () => store.getState().shuttleReverse(), () => store.getState().shuttleSlow('forward')]) {
    action()
    const request = getCurrentPlaybackJump(store.getState())
    assert.ok(request)
    assert.equal(request.targetTime, 2)
    assert.equal(request.playbackRate, store.getState().playbackRate)
    assert.notEqual(request.token, previous.token)
    assert.equal(noWrite(() => store.getState().completePlaybackJump(previous.token)), false)
    previous = request
  }
})

test('load, clear and FPS changes invalidate pending requests without token reuse', () => {
  const document = store.getState().getProjectData()
  for (const action of [() => store.getState().loadFromProject(document), () => store.getState().clearProject(),
    () => store.getState().setTimelineFps(30)]) {
    store.setState({ isPlaying: true })
    const previous = jump(2)
    action()
    assert.equal(store.getState().playbackJump, null)
    assert.equal(noWrite(() => store.getState().completePlaybackJump(previous.token)), false)
    store.setState({ isPlaying: true })
    assert.notEqual(jump(2).token, previous.token)
  }
})

test('entering and leaving a compound retires pending tokens without authoring child changes', () => {
  store.getState().shuttlePause()
  const input = { clipIds: ['shot'], name: 'Scene', width: 1920, height: 1080 }
  const plan = store.getState().previewCreateCompound(input)
  assert.equal(plan.ok, true, plan.reason)
  const created = store.getState().applyCreateCompound(input, plan.token)
  assert.equal(created.ok, true, created.reason)
  markProjectClean()
  store.getState().togglePlay()
  const parentRequest = jump(3)
  assert.equal(store.getState().openCompound(created.clipId).ok, true)
  assert.equal(store.getState().playbackJump, null)
  assert.equal(noWrite(() => store.getState().completePlaybackJump(parentRequest.token)), false)
  store.setState({ isPlaying: true })
  const childRequest = jump(2)
  assert.notEqual(childRequest.token, parentRequest.token)
  assert.equal(store.getState().closeCompound().changed, false)
  assert.equal(store.getState().playbackJump, null)
  assert.equal(noWrite(() => store.getState().completePlaybackJump(childRequest.token)), false)
  assert.equal(isProjectDirty(), false)
})

test('direct state replacements cannot acknowledge a request from another context', () => {
  for (const patch of [{ timelineSessionId: 6 }, { playbackRate: -1 },
    { timelineFps: 30 }, { playheadPosition: 7 }, { isPlaying: false }]) {
    const request = jump(2)
    const before = store.getState()
    store.setState(patch)
    assert.equal(getCurrentPlaybackJump(store.getState()), null)
    assert.equal(noWrite(() => store.getState().completePlaybackJump(request.token)), false)
    store.setState(before)
  }
})
