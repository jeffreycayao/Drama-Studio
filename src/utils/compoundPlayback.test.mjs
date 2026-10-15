import assert from 'node:assert/strict'
import test from 'node:test'
import { getCompoundRenderState, getClipPlaybackWindow, isClipInPlaybackWindow } from './compoundPlayback.mjs'
import { getClipPlaybackTimeAtTimeline } from './clipPlaybackTiming.js'
import { getAnimatedTransform } from './keyframes.js'
import { getAudioVolumeEnvelopeGain } from './audioVolumeEnvelope.mjs'
import { selectAudioPreviewCandidates, getAudioSourceTimeAtTimeline } from './audioPreviewScheduling.js'
import { countExpectedAudioMixClips } from '../../electron/audioMixEligibility.mjs'

const child = (patch = {}) => ({ id: 'child', assetId: 'media', type: 'video', trackId: 'v',
  startTime: 0, duration: 6, trimStart: 2, trimEnd: 8, sourceDuration: 12,
  sourceFps: 24, timelineFps: 24, sourceTimeScale: 1, speed: 1,
  transform: { positionX: 0, opacity: 100 },
  keyframes: { positionX: [{ time: 0, value: 0, easing: 'easeInOut' }, { time: 6, value: 600 }] }, ...patch })
const parent = (patch = {}) => ({ id: 'parent', type: 'compound', name: 'Intro', trackId: 'root',
  startTime: 10, duration: 3, trimStart: 2, trimEnd: 5, sourceDuration: 6, speed: 1, sourceTimeScale: 1,
  compound: { version: 1, document: { fps: 24, width: 1920, height: 1080, duration: 6,
    clips: [child()], tracks: [{ id: 'v', type: 'video', visible: true }], transitions: [] } }, ...patch })
const state = (clip = parent()) => ({ clips: [clip], tracks: [{ id: 'above', type: 'video', visible: true },
  { id: 'root', type: 'video', visible: true }, { id: 'below', type: 'video', visible: true }, { id: 'audio', type: 'audio' }],
  transitions: [], timelineFps: 24, playheadPosition: 10,
  getActiveClipsAtTime(time, snapshot) { return snapshot.clips.filter(clip => isClipInPlaybackWindow(clip, time)) },
  getTransitionAtTime(time, snapshot) { return { time, snapshot } },
})
const leaf = output => output.clips.find(clip => clip.compoundParentId === 'parent')

test('ordinary states pass through exactly and compound expansion never changes project data', () => {
  const ordinary = { clips: [child()] }
  assert.equal(getCompoundRenderState(ordinary), ordinary)
  const input = state(), original = structuredClone({ clips: input.clips, tracks: input.tracks })
  const output = getCompoundRenderState(input)
  assert.deepEqual({ clips: input.clips, tracks: input.tracks }, original)
  assert.equal(output.compoundRenderErrors.length, 0)
  assert.equal(output.clips.some(clip => clip.type === 'compound'), false)
  assert.equal(leaf(output).startTime, 8)
  assert.equal(leaf(output).duration, 6)
  assert.equal(leaf(output).trimStart, 2)
  assert.equal(leaf(output).trimEnd, 8)
  assert.deepEqual(getClipPlaybackWindow(leaf(output)), { start: 10, end: 13 })
  assert.equal(output.getTimelineEndTime(), 13, 'hidden child handles do not extend the program')
})

test('one container stack position, unique namespaces, and unchanged outer clips', () => {
  const first = parent(), second = parent({ id: 'second', startTime: 20 })
  const outside = child({ id: 'outside', trackId: 'above', startTime: 8 })
  const input = state(first); input.clips.push(second, outside)
  const output = getCompoundRenderState(input)
  assert.equal(new Set(output.clips.map(clip => clip.id)).size, output.clips.length)
  assert.equal(new Set(output.tracks.map(track => track.id)).size, output.tracks.length)
  assert.equal(output.clips.find(clip => clip.id === 'outside'), outside)
  const rootIndex = output.tracks.findIndex(track => track.id === 'root')
  assert.ok(output.tracks.findIndex(track => track.id === leaf(output).trackId) < rootIndex)
  assert.equal(output.tracks[0].id, 'above')
  assert.equal(output.tracks[rootIndex + 1].id, 'below')
})

test('playhead changes reuse leaf identity but authored edits and windows invalidate projection', () => {
  const input = state(), a = getCompoundRenderState(input), b = getCompoundRenderState({ ...input, playheadPosition: 12 })
  assert.equal(a.clips, b.clips); assert.equal(a.tracks, b.tracks)
  assert.equal(b.playheadPosition, 12)
  assert.equal(getCompoundRenderState(b), b)
  const c = getCompoundRenderState({ ...input, clips: [{ ...input.clips[0], trimStart: 3 }] })
  assert.notEqual(a.clips, c.clips)
  assert.equal(leaf(c).startTime, 7)
  assert.equal(a.getActiveClipsAtTime(9).length, 0)
  assert.equal(a.getActiveClipsAtTime(10).length, 1)
  assert.equal(a.getActiveClipsAtTime(13).length, 0)
  assert.equal(a.getTransitionAtTime(10).snapshot, a)
})

test('outer head/tail trims preserve every original animation and retime sample', () => {
  for (const speed of [0.25, 1, 2]) for (const reverse of [false, true]) for (const ramp of [false, true]) {
    const original = child({ speed, reverse, keyframes: { ...child().keyframes,
      ...(ramp ? { speed: [{ time: 0, value: 0.2 }, { time: 2, value: 3 }, { time: 6, value: 0.5 }] } : {}) } })
    const p = parent(); p.compound.document.clips = [original]
    const expanded = leaf(getCompoundRenderState(state(p)))
    for (let time = 10; time < 13; time += 1 / 24) {
      const sourceTime = time - p.startTime + p.trimStart
      assert.ok(Math.abs(getClipPlaybackTimeAtTimeline(expanded, time) - getClipPlaybackTimeAtTimeline(original, sourceTime)) < 1e-9)
      assert.deepEqual(getAnimatedTransform(expanded, time - expanded.startTime), getAnimatedTransform(original, sourceTime - original.startTime))
    }
  }
})

test('audio uses the outer window while retaining original source, envelope and fade clocks', () => {
  const sound = child({ type: 'audio', trackId: 'a', fadeIn: 4, fadeOut: 2,
    volumeEnvelope: { version: 1, offsetSeconds: 0, points: [{ id: 'a', time: 0, db: 0 }, { id: 'b', time: 6, db: -12 }] } })
  const p = parent(); p.compound.document.clips = [sound]; p.compound.document.tracks = [{ id: 'a', type: 'audio', volume: 70, pan: -25 }]
  const output = getCompoundRenderState(state(p)), audio = leaf(output)
  const candidates = time => selectAudioPreviewCandidates({ clips: output.clips, tracks: output.tracks, playheadPosition: time })
  assert.equal(candidates(9)[0].active, false)
  assert.equal(candidates(9)[0].prepareTimelineTime, 10)
  assert.equal(candidates(10)[0].active, true)
  assert.equal(candidates(13)[0].active, false)
  assert.equal(audio.fadeIn, 4)
  assert.equal(audio.fadeOut, 2)
  assert.equal(getAudioSourceTimeAtTimeline(audio, 11), getAudioSourceTimeAtTimeline(sound, 3))
  assert.equal(getAudioVolumeEnvelopeGain(audio, 11 - audio.startTime), getAudioVolumeEnvelopeGain(sound, 3))
  assert.equal(countExpectedAudioMixClips([audio], 8, 10), 0)
  assert.equal(countExpectedAudioMixClips([audio], 10, 11), 1)
  assert.equal(countExpectedAudioMixClips([audio], 13, 14), 0)
  assert.equal(output.tracks.find(track => track.id === audio.trackId).volume, 70)
})

test('wholly clipped children have an empty window, not missing-media export failures', () => {
  const p = parent(); p.compound.document.clips = [child({ startTime: 5, duration: 1 })]
  const output = getCompoundRenderState(state(p)), c = leaf(output)
  assert.deepEqual(getClipPlaybackWindow(c), { start: 13, end: 13 })
  assert.equal(output.getActiveClipsAtTime(13).length, 0)
  assert.equal(countExpectedAudioMixClips([{ ...c, type: 'audio' }], 0, 100), 0)
})

test('child source caches never become editable virtual render jobs', () => {
  const p = parent(); p.compound.document.clips = [child({ cacheStatus: 'cached', cacheUrl: 'blob:bake', cachePath: 'cache/bake.webm',
    opticalFlowCache: { status: 'ready', path: 'cache/rife.mp4', url: 'blob:rife' } })]
  const output = getCompoundRenderState(state(p)), c = leaf(output)
  assert.equal(c.cacheStatus, 'none'); assert.equal(c.cacheUrl, null); assert.equal(c.cachePath, null)
  assert.equal(c.opticalFlowCache.url, 'blob:rife')
  assert.equal(p.compound.document.clips[0].cacheUrl, 'blob:bake')
})

test('invalid nested documents and unsupported parent edits produce visible errors', () => {
  for (const mutate of [p => { p.compound.version = 2 }, p => { p.compound.document.clips[0].type = 'compound' },
    p => { p.compound.document.transitions.push({ id: 't' }) }, p => { p.compound.document.clips[0].transform.blendMode = 'screen' },
    p => { p.speed = 2 }, p => { p.transform = { positionX: 100 } }, p => { p.compound.document.tracks = [] }]) {
    const p = parent(); mutate(p)
    const output = getCompoundRenderState(state(p))
    assert.ok(output.compoundRenderErrors.length > 0)
    assert.equal(output.clips.length, 0)
  }
})
