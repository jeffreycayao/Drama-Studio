import test from 'node:test'
import assert from 'node:assert/strict'
import { captureBeatMarkerRequest, isBeatMarkerRequestCurrent, buildDetectedBeatMarkers } from './beatMarkers.mjs'

const fixture = () => {
  const clip = { id: 'audio', assetId: 'source', trackId: 'a1', startTime: 10, duration: 4,
    trimStart: 2, trimEnd: 10, speed: 2, sourceTimeScale: 1 }
  const asset = { id: 'source', path: 'assets/music.wav', absolutePath: '/synthetic/project/assets/music.wav', url: 'media://synthetic' }
  const timeline = { clips: [clip], timelineFps: 24, timelineSessionId: 1, compoundEditContext: null }
  const project = { currentProjectHandle: '/synthetic/project', currentTimelineId: 'timeline-a' }
  return { clip, asset, timeline, project, request: captureBeatMarkerRequest(timeline, project, clip, asset) }
}

test('trimmed and retimed beats use range-relative source time, not trimStart twice', () => {
  const { request } = fixture()
  assert.equal(request.startSeconds, 2); assert.equal(request.endSeconds, 10)
  const markers = buildDetectedBeatMarkers(request, { bpm: 120, beats: [0, 1, 2, 8] })
  assert.deepEqual(markers.map(marker => marker.time), [10, 10.5, 11, 14])
  assert.equal(markers[0].label, 'Beats 120 BPM')
  assert.equal(markers[1].label, '')
})

test('source/timeline frame-rate ratio and fractional speed keep correct timeline positions', () => {
  const { clip, asset, timeline, project } = fixture()
  const request = captureBeatMarkerRequest(timeline, project, { ...clip, sourceTimeScale: undefined,
    timelineFps: 24, sourceFps: 48, speed: .5, trimEnd: undefined }, asset)
  assert.equal(request.timeScale, .25)
  assert.equal(request.endSeconds, 3)
  assert.deepEqual(buildDetectedBeatMarkers(request, { beats: [.5, 1] }).map(marker => marker.time), [12, 14])
})

test('bad ranges, reverse and speed ramps refuse before starting analysis', () => {
  const { clip, asset, timeline, project } = fixture()
  for (const patch of [{ reverse: true }, { keyframes: { speed: [{ time: 0, value: 2 }] } },
    { trimStart: -1 }, { trimEnd: 1 }, { duration: 0 }, { startTime: NaN }, { sourceTimeScale: Infinity }]) {
    assert.throws(() => captureBeatMarkerRequest(timeline, project, { ...clip, ...patch }, asset))
  }
  assert.throws(() => captureBeatMarkerRequest(timeline, project, clip, null))
})

test('new timelines/projects/compound contexts and FPS invalidate asynchronous marker writes', () => {
  const { request, timeline, project, asset } = fixture()
  assert.equal(isBeatMarkerRequestCurrent(request, timeline, project, asset), true)
  for (const change of [{ timelineSessionId: 2 }, { compoundEditContext: {} }, { timelineFps: 30 }, { clips: [] }]) {
    assert.equal(isBeatMarkerRequestCurrent(request, { ...timeline, ...change }, project, asset), false)
  }
  for (const change of [{ currentProjectHandle: '/another/project' }, { currentTimelineId: 'timeline-b' }]) {
    assert.equal(isBeatMarkerRequestCurrent(request, timeline, { ...project, ...change }, asset), false)
  }
})

test('clip timing edits/deletion and source relinking invalidate old beat results', () => {
  const { request, timeline, project, asset, clip } = fixture()
  for (const patch of [{ trimStart: 3 }, { trimEnd: 9 }, { startTime: 11 }, { duration: 3 },
    { speed: 1 }, { sourceTimeScale: 2 }, { reverse: true }, { assetId: 'new' },
    { keyframes: { speed: [{ time: 0, value: 2 }] } }]) {
    assert.equal(isBeatMarkerRequestCurrent(request, { ...timeline, clips: [{ ...clip, ...patch }] }, project, asset), false)
  }
  for (const change of [{ absolutePath: '/relinked.wav' }, { path: 'assets/new.wav' }, { url: 'blob:new' }]) {
    assert.equal(isBeatMarkerRequestCurrent(request, timeline, project, { ...asset, ...change }), false)
  }
  assert.equal(isBeatMarkerRequestCurrent(request, timeline, project, null), false)
})

test('unrelated selection, playback, gain, thumbnail and autosave updates do not discard valid results', () => {
  const { request, timeline, project, asset, clip } = fixture()
  assert.equal(isBeatMarkerRequestCurrent(request,
    { ...timeline, playheadPosition: 3, selectedClipIds: [], clips: [{ ...clip, gainDb: -4, cacheProgress: 60 }] },
    { ...project, currentProject: { modified: 'updated' } }, { ...asset, thumbnail: 'new' }), true)
})

test('out-of-range or malformed beats cannot create bad markers; long results are capped', () => {
  const { request } = fixture()
  const input = { beats: [NaN, Infinity, -1, '1', 9, 0, .5], bpm: NaN }
  assert.deepEqual(buildDetectedBeatMarkers(request, input).map(marker => marker.time), [10, 10.25])
  assert.equal(buildDetectedBeatMarkers(request, input)[0].label, 'Beats')
  assert.equal(buildDetectedBeatMarkers(request, { beats: Array.from({ length: 900 }, (_, i) => i / 1000) }).length, 600)
  assert.throws(() => buildDetectedBeatMarkers(request, { beats: [] }), /No steady beat/)
  assert.throws(() => buildDetectedBeatMarkers(request, { error: 'Native decode failed.' }), /Native decode failed/)
})
