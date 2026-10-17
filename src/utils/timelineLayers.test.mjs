import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getMainVideoTrack, isTrackRangeFree, pickClipLayer, insertLayerTrack, resolveClipLayer,
  layerMovedClips, pruneEmptyAutoLayers, packMagneticTrack,
} from './timelineLayers.mjs'

const video = (id, patch = {}) => ({ id, name: id, type: 'video', locked: false, visible: true, muted: false, ...patch })
const audio = (id, patch = {}) => ({ id, name: id, type: 'audio', locked: false, visible: true, muted: false, ...patch })
const clip = (id, trackId, startTime, duration, patch = {}) => ({ id, trackId, startTime, duration, ...patch })

test('main video track is the bottom-most non-captions video track', () => {
  const tracks = [video('captions', { role: 'captions' }), video('video-2'), video('video-1'), audio('audio-1')]
  assert.equal(getMainVideoTrack(tracks).id, 'video-1')
  assert.equal(getMainVideoTrack([audio('audio-1')]), null)
})

test('range check ignores touching edges and listed clips', () => {
  const clips = [clip('a', 'v', 0, 5), clip('b', 'v', 10, 5)]
  assert.equal(isTrackRangeFree(clips, 'v', 5, 5), true, 'edges touch, no overlap')
  assert.equal(isTrackRangeFree(clips, 'v', 4, 2), false)
  assert.equal(isTrackRangeFree(clips, 'v', 4, 2, ['a']), true)
  assert.equal(isTrackRangeFree(clips, 'other', 0, 100), true)
})

test('the reported case: text over a single video track gets a new layer above it', () => {
  const tracks = [video('video-1'), audio('audio-1')]
  const clips = [clip('sas', 'video-1', 0, 105)]
  const pick = pickClipLayer({ tracks, clips, startTime: 38, duration: 5, mode: 'overlay', targetTrackId: 'video-1' })
  assert.deepEqual(pick, { create: { type: 'video', beforeTrackId: 'video-1' } })
  const placed = resolveClipLayer({ tracks, clips, startTime: 38, duration: 5, mode: 'overlay' })
  assert.equal(placed.trackId, 'video-2')
  assert.deepEqual(placed.tracks.map(t => t.id), ['video-2', 'video-1', 'audio-1'])
  assert.equal(placed.createdTrack.autoLayer, true)
  assert.equal(placed.createdTrack.name, 'Video 2')
})

test('overlay reuses a free overlay layer and never the main track, even when it is free', () => {
  const tracks = [video('video-2'), video('video-1'), audio('audio-1')]
  const clips = [clip('main', 'video-1', 0, 10), clip('title', 'video-2', 0, 3)]
  assert.deepEqual(pickClipLayer({ tracks, clips, startTime: 5, duration: 2, mode: 'overlay' }), { trackId: 'video-2' })
  // Past the end of everything: still an overlay layer, not the main track.
  assert.deepEqual(pickClipLayer({ tracks, clips, startTime: 50, duration: 2, mode: 'overlay' }), { trackId: 'video-2' })
  // Only the main track exists and it is empty at that time: a layer is still created.
  assert.deepEqual(pickClipLayer({ tracks: [video('video-1')], clips: [], startTime: 0, duration: 2, mode: 'overlay' }),
    { create: { type: 'video', beforeTrackId: 'video-1' } })
})

test('overlay goes above the top-most clip in the range, skipping locked or hidden layers', () => {
  const tracks = [video('video-4'), video('video-3', { locked: true }), video('video-2'), video('video-1')]
  const clips = [clip('main', 'video-1', 0, 10), clip('broll', 'video-2', 2, 4)]
  assert.deepEqual(pickClipLayer({ tracks, clips, startTime: 3, duration: 2, mode: 'overlay' }), { trackId: 'video-4' })
  const hidden = tracks.map(t => (t.id === 'video-4' ? { ...t, visible: false } : t))
  assert.deepEqual(pickClipLayer({ tracks: hidden, clips, startTime: 3, duration: 2, mode: 'overlay' }),
    { create: { type: 'video', beforeTrackId: 'video-2' } })
})

test('overlay keeps the captions track on top and never uses it', () => {
  const tracks = [video('captions', { role: 'captions' }), video('video-1')]
  const clips = [clip('main', 'video-1', 0, 10), clip('cap', 'captions', 0, 10)]
  const placed = resolveClipLayer({ tracks, clips, startTime: 1, duration: 2, mode: 'overlay' })
  assert.deepEqual(placed.tracks.map(t => t.id), ['captions', 'video-2', 'video-1'])
})

test('overlay honours an explicit free overlay track', () => {
  const tracks = [video('video-3'), video('video-2'), video('video-1')]
  const clips = [clip('main', 'video-1', 0, 10)]
  assert.deepEqual(pickClipLayer({ tracks, clips, startTime: 1, duration: 2, mode: 'overlay', targetTrackId: 'video-3' }), { trackId: 'video-3' })
})

test('free placement keeps the target when free, else the layer above, else a new one next to it', () => {
  const tracks = [video('video-2'), video('video-1'), audio('audio-1'), audio('audio-2')]
  const clips = [clip('a', 'video-1', 0, 10), clip('m', 'audio-1', 0, 10)]
  assert.deepEqual(pickClipLayer({ tracks, clips, startTime: 12, duration: 2, family: 'video', targetTrackId: 'video-1' }), { trackId: 'video-1' })
  assert.deepEqual(pickClipLayer({ tracks, clips, startTime: 5, duration: 2, family: 'video', targetTrackId: 'video-1' }), { trackId: 'video-2' })
  const busy = [...clips, clip('b', 'video-2', 4, 4)]
  assert.deepEqual(pickClipLayer({ tracks, clips: busy, startTime: 5, duration: 2, family: 'video', targetTrackId: 'video-1' }),
    { create: { type: 'video', beforeTrackId: 'video-1' } })
  assert.deepEqual(pickClipLayer({ tracks, clips, startTime: 5, duration: 2, family: 'audio', targetTrackId: 'audio-1' }), { trackId: 'audio-2' })
  const audioBusy = [...clips, clip('n', 'audio-2', 0, 10)]
  assert.deepEqual(pickClipLayer({ tracks, clips: audioBusy, startTime: 5, duration: 2, family: 'audio', targetTrackId: 'audio-1' }),
    { create: { type: 'audio', afterTrackId: 'audio-1' } })
})

test('free placement refuses the captions track and wrong families', () => {
  const tracks = [video('captions', { role: 'captions' }), video('video-1')]
  const clips = [clip('cap', 'captions', 0, 10)]
  assert.equal(pickClipLayer({ tracks, clips, startTime: 1, duration: 1, targetTrackId: 'captions' }).trackId, null)
  assert.equal(pickClipLayer({ tracks, clips, startTime: 1, duration: 1, family: 'audio', targetTrackId: 'video-1' }).trackId, null)
})

test('new layer ids continue the numbering and audio layers go below their target', () => {
  const tracks = [video('video-1'), video('video-7'), audio('audio-1'), audio('audio-3')]
  const { tracks: next, track } = insertLayerTrack(tracks, { type: 'audio', afterTrackId: 'audio-1' })
  assert.equal(track.id, 'audio-4')
  assert.equal(track.channels, 'stereo')
  assert.deepEqual(next.map(t => t.id), ['video-1', 'video-7', 'audio-1', 'audio-4', 'audio-3'])
  assert.equal(insertLayerTrack(tracks, { type: 'video', beforeTrackId: 'video-1' }).track.id, 'video-8')
})

test('moved clips that land on another clip go to a free layer; others stay', () => {
  const tracks = [video('video-1'), audio('audio-1')]
  const clips = [clip('a', 'video-1', 0, 10), clip('b', 'video-1', 4, 3), clip('c', 'video-1', 20, 3)]
  const result = layerMovedClips({ tracks, clips, movedClipIds: ['b', 'c'] })
  assert.deepEqual(result.relocated, [{ clipId: 'b', fromTrackId: 'video-1', toTrackId: 'video-2' }])
  assert.equal(result.clips.find(c => c.id === 'a').startTime, 0, 'nothing is cut')
  assert.equal(result.clips.find(c => c.id === 'a').duration, 10)
  assert.equal(result.clips.find(c => c.id === 'c').trackId, 'video-1')
  assert.deepEqual(result.tracks.map(t => t.id), ['video-2', 'video-1', 'audio-1'])
})

test('two moved clips stacking on the same spot each find their own layer', () => {
  const tracks = [video('video-1')]
  const clips = [clip('a', 'video-1', 0, 10), clip('b', 'video-1', 2, 3), clip('c', 'video-1', 3, 3)]
  const result = layerMovedClips({ tracks, clips, movedClipIds: ['b', 'c'] })
  const trackOf = id => result.clips.find(c => c.id === id).trackId
  assert.notEqual(trackOf('b'), 'video-1')
  assert.notEqual(trackOf('c'), 'video-1')
  assert.notEqual(trackOf('b'), trackOf('c'))
})

test('captions-track clips are left to overwrite rules', () => {
  const tracks = [video('captions', { role: 'captions' }), video('video-1')]
  const clips = [clip('c1', 'captions', 0, 4), clip('c2', 'captions', 2, 4)]
  assert.deepEqual(layerMovedClips({ tracks, clips, movedClipIds: ['c2'] }).unresolvedIds, ['c2'])
})

test('empty auto layers are pruned; main, captions, user tracks and last-of-type stay', () => {
  const tracks = [
    video('captions', { role: 'captions' }), video('video-3', { autoLayer: true }), video('video-2'),
    video('video-1', { autoLayer: true }), audio('audio-1', { autoLayer: true }), audio('audio-2', { autoLayer: true }),
  ]
  const pruned = pruneEmptyAutoLayers(tracks, [clip('x', 'audio-2', 0, 1)])
  assert.deepEqual(pruned.map(t => t.id), ['captions', 'video-2', 'video-1', 'audio-2'])
  const unchanged = [video('video-1'), audio('audio-1')]
  assert.equal(pruneEmptyAutoLayers(unchanged, []), unchanged, 'same array when nothing changes')
})

test('magnetic packing closes gaps from zero and linked audio follows', () => {
  const clips = [
    clip('v1', 'main', 2, 3, { linkGroupId: 'g1' }), clip('a1', 'aud', 2, 3, { linkGroupId: 'g1' }),
    clip('v2', 'main', 9, 4), clip('title', 'over', 9, 2),
  ]
  const packed = packMagneticTrack({ clips, trackId: 'main', fps: 24 })
  assert.equal(packed.ok, true)
  const at = id => packed.clips.find(c => c.id === id).startTime
  assert.equal(at('v1'), 0)
  assert.equal(at('a1'), 0)
  assert.equal(at('v2'), 3)
  assert.equal(at('title'), 9, 'overlays stay where they are')
})

test('magnetic packing inserts a dropped clip and keeps transition overlaps', () => {
  const clips = [clip('a', 'main', 0, 10), clip('b', 'main', 9.5, 5), clip('drop', 'main', 4, 2)]
  const packed = packMagneticTrack({ clips, trackId: 'main', fps: 24, priorityClipIds: ['drop'] })
  const at = id => packed.clips.find(c => c.id === id).startTime
  assert.equal(at('a'), 0)
  assert.equal(at('drop'), 10, 'dropped inside a clip goes after it')
  assert.equal(at('b'), 12, 'the overlap between a and b is not kept once something sits between them')
  const tie = packMagneticTrack({ clips: [clip('a', 'main', 0, 5), clip('drop', 'main', 0, 2)], trackId: 'main', priorityClipIds: ['drop'] })
  assert.equal(tie.clips.find(c => c.id === 'drop').startTime, 0, 'a tie puts the dropped clip first')
  const transition = packMagneticTrack({ clips: [clip('a', 'main', 1, 10), clip('b', 'main', 10.5, 5)], trackId: 'main', fps: 24 })
  assert.equal(transition.clips.find(c => c.id === 'b').startTime, 9.5, 'existing overlap preserved')
})

test('magnetic packing refuses when a linked clip would collide', () => {
  const clips = [
    clip('v1', 'main', 5, 3, { linkGroupId: 'g' }), clip('a1', 'aud', 5, 3, { linkGroupId: 'g' }),
    clip('music', 'aud', 0, 4),
  ]
  const packed = packMagneticTrack({ clips, trackId: 'main', fps: 24 })
  assert.equal(packed.ok, false)
})
