import test from 'node:test'
import assert from 'node:assert/strict'
import { canSplitActiveTrackAtPlayhead, getActiveTrackSplitTarget } from './timelineSplitTarget.mjs'

const makeClip = (overrides = {}) => ({
  id: 'first', type: 'audio', trackId: 'a1', startTime: 0, duration: 10,
  ...overrides,
})
const makeState = (overrides = {}) => ({
  activeTrackId: 'a1', playheadPosition: 5, timelineFps: 24,
  tracks: [{ id: 'a1', type: 'audio' }, { id: 'v1', type: 'video' }],
  clips: [makeClip()], selectedClipIds: [],
  ...overrides,
})

for (const type of ['audio', 'video']) {
  test(`${type}: target follows repeated split snapshots and seeks without changing track or selection`, () => {
    const trackId = type === 'audio' ? 'a1' : 'v1'
    const original = makeClip({ type, trackId })
    let state = makeState({ activeTrackId: trackId, clips: [original] })
    assert.equal(getActiveTrackSplitTarget(state), original)

    const left = { ...original, duration: 5 }
    const right = { ...original, id: 'right', startTime: 5, duration: 5 }
    state = { ...state, clips: [left, right] }
    assert.equal(getActiveTrackSplitTarget(state), null, 'the new cut boundary is unavailable')
    assert.equal(canSplitActiveTrackAtPlayhead(state), false)

    state = { ...state, playheadPosition: 7 }
    assert.equal(getActiveTrackSplitTarget(state), right, 'seek alone re-enables the right segment')
    assert.equal(canSplitActiveTrackAtPlayhead(state), true)

    const middle = { ...right, duration: 2 }
    const last = { ...right, id: 'last', startTime: 7, duration: 3 }
    state = { ...state, clips: [left, middle, last] }
    assert.equal(canSplitActiveTrackAtPlayhead(state), false, 'the second cut also disables at its boundary')
    assert.equal(getActiveTrackSplitTarget({ ...state, playheadPosition: 8 }), last)
    assert.equal(getActiveTrackSplitTarget({ ...state, playheadPosition: 6 }), middle)
    assert.equal(getActiveTrackSplitTarget({ ...state, playheadPosition: 2 }), left)
    assert.deepEqual(state.selectedClipIds, [])
    assert.equal(state.activeTrackId, trackId)
  })
}

test('current playhead determines the command target even when enablement stays true between clips', () => {
  const first = makeClip({ duration: 4 })
  const second = makeClip({ id: 'second', startTime: 6, duration: 4 })
  const state = makeState({ clips: [first, second], playheadPosition: 2 })
  assert.equal(canSplitActiveTrackAtPlayhead(state), true)
  assert.equal(getActiveTrackSplitTarget(state), first)
  const later = { ...state, playheadPosition: 8 }
  assert.equal(canSplitActiveTrackAtPlayhead(later), true)
  assert.equal(getActiveTrackSplitTarget(later), second, 'no stale enabled-button target')
})

test('selection does not retarget Split; changing active track does', () => {
  const audio = makeClip()
  const video = makeClip({ id: 'video', type: 'video', trackId: 'v1' })
  const state = makeState({ clips: [audio, video], selectedClipIds: ['video'] })
  assert.equal(getActiveTrackSplitTarget(state), audio)
  assert.equal(getActiveTrackSplitTarget({ ...state, selectedClipIds: [] }), audio)
  assert.equal(getActiveTrackSplitTarget({ ...state, activeTrackId: 'v1' }), video)
})

test('cut boundaries, outside positions and gaps are unavailable', () => {
  const state = makeState({ clips: [makeClip({ duration: 4 }), makeClip({ id: 'second', startTime: 6, duration: 4 })] })
  for (const playheadPosition of [-1, 0, 4, 5, 6, 10, 11, NaN, Infinity]) {
    assert.equal(getActiveTrackSplitTarget({ ...state, playheadPosition }), null, String(playheadPosition))
    assert.equal(canSplitActiveTrackAtPlayhead({ ...state, playheadPosition }), false)
  }
})

test('enablement matches frame-quantized splitting near boundaries and for fractional FPS', () => {
  for (const timelineFps of [24, 30, 60, 24000 / 1001, 30000 / 1001]) {
    const clip = makeClip({ startTime: 10 / timelineFps, duration: 10 / timelineFps })
    const state = makeState({ clips: [clip], timelineFps })
    for (const frame of [10, 10.2, 19.8, 20]) {
      assert.equal(canSplitActiveTrackAtPlayhead({ ...state, playheadPosition: frame / timelineFps }), false)
    }
    for (const frame of [10.6, 11, 19, 19.4]) {
      assert.equal(getActiveTrackSplitTarget({ ...state, playheadPosition: frame / timelineFps }), clip)
    }
  }
})

test('missing active tracks, compounds, locked clips and locked tracks cannot be split', () => {
  for (const override of [
    { activeTrackId: null }, { activeTrackId: 'missing' }, { tracks: [] }, { clips: [] },
    { clips: [makeClip({ type: 'compound' })] },
    { clips: [makeClip({ locked: true })] },
    { clips: [makeClip({ lockMode: 'sync', syncLock: { mode: 'sync' } })] },
    { tracks: [{ id: 'a1', type: 'audio', locked: true }] },
  ]) {
    assert.equal(canSplitActiveTrackAtPlayhead(makeState(override)), false)
    assert.equal(getActiveTrackSplitTarget(makeState(override)), null)
  }
})

test('enablement reacts to lock changes without requiring clip-array replacement', () => {
  const state = makeState()
  assert.equal(canSplitActiveTrackAtPlayhead(state), true)
  const locked = { ...state, tracks: [{ ...state.tracks[0], locked: true }, state.tracks[1]] }
  assert.equal(locked.clips, state.clips)
  assert.equal(canSplitActiveTrackAtPlayhead(locked), false)
  assert.equal(canSplitActiveTrackAtPlayhead({ ...locked, tracks: state.tracks }), true)
})

test('Boolean selector remains identical through interior playback ticks and selection-only updates', () => {
  const state = makeState()
  const initial = canSplitActiveTrackAtPlayhead(state)
  for (let frame = 1; frame < 240; frame++) {
    assert.equal(canSplitActiveTrackAtPlayhead({ ...state, playheadPosition: frame / 24 }), initial)
  }
  assert.equal(canSplitActiveTrackAtPlayhead({ ...state, selectedClipIds: ['first'] }), initial)
  assert.notEqual(canSplitActiveTrackAtPlayhead({ ...state, playheadPosition: 10 }), initial)
})

test('target resolution is read-only, including linked clips and child timelines', () => {
  const target = Object.freeze(makeClip({ linkGroupId: 'linked' }))
  const partner = Object.freeze(makeClip({ id: 'partner', trackId: 'v1', type: 'video', linkGroupId: 'linked', locked: true }))
  const state = Object.freeze(makeState({
    clips: Object.freeze([target, partner]),
    selectedClipIds: Object.freeze(['partner']),
    compoundEditContext: { clipId: 'parent-compound' },
  }))
  const before = JSON.stringify(state)
  assert.equal(getActiveTrackSplitTarget(state), target, 'active-track split does not target linked partners')
  assert.equal(canSplitActiveTrackAtPlayhead(state), true)
  assert.equal(JSON.stringify(state), before)
})
