import test from 'node:test'
import assert from 'node:assert/strict'
import { getCommandTargetClip } from './commandTargetClip.mjs'

const tracks = [{ id: 'v1', type: 'video' }, { id: 'a1', type: 'audio' }]
const video = { id: 'c1', trackId: 'v1', type: 'video', linkGroupId: 'g1' }
const audio = { id: 'c2', trackId: 'a1', type: 'audio', linkGroupId: 'g1' }
const other = { id: 'c3', trackId: 'a1', type: 'audio' }

test('one selected clip is the target', () => {
  assert.equal(getCommandTargetClip({ clips: [video, audio], tracks, selectedClipIds: ['c2'] }), audio)
})

test('a linked video/audio pair targets its video side, in either order', () => {
  assert.equal(getCommandTargetClip({ clips: [video, audio], tracks, selectedClipIds: ['c1', 'c2'] }), video)
  assert.equal(getCommandTargetClip({ clips: [video, audio], tracks, selectedClipIds: ['c2', 'c1'] }), video)
})

test('unlinked or larger selections have no single target', () => {
  assert.equal(getCommandTargetClip({ clips: [video, other], tracks, selectedClipIds: ['c1', 'c3'] }), null)
  assert.equal(getCommandTargetClip({ clips: [video, audio, other], tracks, selectedClipIds: ['c1', 'c2', 'c3'] }), null)
  assert.equal(getCommandTargetClip({ clips: [], tracks, selectedClipIds: [] }), null)
})
