import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { getCurrentPlaybackJump } from './playbackJump.mjs'
import { watchStoreForProjectChanges, TIMELINE_PROJECT_KEYS, markProjectClean, isProjectDirty } from '../services/projectDirtyTracker.js'
import {
  clampExportOverviewFrame,
  exportOverviewFramePercent,
  formatExportOverviewTimecode,
  getExportOverviewBounds,
  getExportOverviewClipSpan,
  getExportOverviewPointerFrame,
  getExportOverviewTicks,
  seekExportOverviewFrame,
} from './exportTimelineOverview.mjs'

test('empty timelines have no picture and no fabricated duration', () => {
  assert.deepEqual(getExportOverviewBounds(), {
    fps: 24, contentFrames: 0, totalFrames: 0, lastFrame: 0,
    startFrame: 0, endFrame: 0, hasContent: false, hasRange: false,
  })
  assert.equal(exportOverviewFramePercent(1, 0), 0)
  assert.equal(clampExportOverviewFrame(900, 0), 0)
  assert.deepEqual(getExportOverviewTicks(0), [0])
  assert.equal(seekExportOverviewFrame(() => { throw new Error('Should not navigate') }, 0, 24, 0), false)
})

test('audio-only and muted content retain their authored extent', () => {
  const clips = [{ type: 'audio', startTime: 2, duration: 5, enabled: false }, { startTime: 1, duration: 2 }]
  const snapshot = structuredClone(clips)
  const result = getExportOverviewBounds({ clips, fps: 24 })
  assert.equal(result.totalFrames, 168)
  assert.equal(result.endFrame, 168)
  assert.equal(result.lastFrame, 167)
  assert.equal(result.hasContent, true)
  assert.deepEqual(clips, snapshot)
})

test('In/Out range is normalized without hiding a legitimate empty export tail', () => {
  const clips = [{ startTime: 0, duration: 4 }]
  const bounds = getExportOverviewBounds({ clips, fps: 24, startFrame: 144, endFrame: 48 })
  assert.equal(bounds.startFrame, 48)
  assert.equal(bounds.endFrame, 144)
  assert.equal(bounds.contentFrames, 96)
  assert.equal(bounds.totalFrames, 144)
  assert.equal(bounds.lastFrame, 143)
  assert.equal(exportOverviewFramePercent(bounds.endFrame, bounds.totalFrames), 100)
  assert.equal(clampExportOverviewFrame(bounds.endFrame, bounds.totalFrames), 143)
})

test('invalid and collapsed bounds remain finite and non-negative', () => {
  const clips = [{ startTime: NaN, duration: 10 }, { startTime: 0, duration: Infinity }, { startTime: 0, duration: -2 }]
  const empty = getExportOverviewBounds({ clips, fps: 0, startFrame: -10, endFrame: NaN })
  assert.equal(empty.totalFrames, 0)
  assert.equal(empty.fps, 24)
  assert.equal(empty.hasRange, false)
  const equal = getExportOverviewBounds({ clips: [{ startTime: 0, duration: 10 }], startFrame: 12, endFrame: 12 })
  assert.equal(equal.hasRange, false)
  assert.equal(equal.totalFrames, 240)
})

test('fractional FPS clips do not gain an extra frame from floating-point error', () => {
  for (const fps of [24, 60, 120, 24000 / 1001, 30000 / 1001, 60000 / 1001]) {
    const clips = [{ startTime: 17 / fps, duration: 101 / fps }]
    const bounds = getExportOverviewBounds({ clips, fps })
    assert.equal(bounds.totalFrames, 118)
    const span = getExportOverviewClipSpan(clips[0], fps, bounds.totalFrames)
    assert.equal(span.startFrame, 17)
    assert.equal(span.endFrame, 118)
    assert.ok(Math.abs(span.left + span.width - 100) < 1e-10)
  }
})

test('clip spans are bounded, preserve gaps, and omit zero-length/outside content', () => {
  assert.deepEqual(getExportOverviewClipSpan({ startTime: 2, duration: 4 }, 24, 240),
    { startFrame: 48, endFrame: 144, left: 20, width: 40 })
  assert.equal(getExportOverviewClipSpan({ startTime: 10, duration: 4 }, 24, 240), null)
  assert.equal(getExportOverviewClipSpan({ startTime: 0, duration: 0 }, 24, 240), null)
  assert.equal(getExportOverviewClipSpan({ startTime: 0, duration: Infinity }, 24, 240), null)
  assert.deepEqual(getExportOverviewClipSpan({ startTime: 8, duration: 4 }, 24, 240),
    { startFrame: 192, endFrame: 240, left: 80, width: 20 })
})

test('pointer positions map the whole overview to pictures, never the exclusive end', () => {
  const rect = { left: 100, width: 400 }
  assert.equal(getExportOverviewPointerFrame(100, rect, 240), 0)
  assert.equal(getExportOverviewPointerFrame(300, rect, 240), 120)
  assert.equal(getExportOverviewPointerFrame(500, rect, 240), 239)
  assert.equal(getExportOverviewPointerFrame(900, rect, 240), 239)
  assert.equal(getExportOverviewPointerFrame(0, rect, 240), 0)
  assert.equal(getExportOverviewPointerFrame(100, { left: 100, width: 0 }, 240), null)
  assert.equal(getExportOverviewPointerFrame(NaN, rect, 240), null)
  assert.equal(getExportOverviewPointerFrame(500, rect, 1), 0)
})

test('ruler includes exclusive boundaries without duplicate frame ticks', () => {
  assert.deepEqual(getExportOverviewTicks(240), [0, 120, 240])
  assert.deepEqual(getExportOverviewTicks(1), [0, 1])
  assert.deepEqual(getExportOverviewTicks(2, 5), [0, 1, 2])
})

test('timecode formats frame-count NDF without fractional-rate drift', () => {
  assert.equal(formatExportOverviewTimecode(0, 24), '00:00:00:00')
  assert.equal(formatExportOverviewTimecode(25, 24), '00:00:01:01')
  assert.equal(formatExportOverviewTimecode(1800, 30000 / 1001), '00:01:00:00')
  assert.equal(formatExportOverviewTimecode(1440, 24000 / 1001), '00:01:00:00')
  assert.equal(formatExportOverviewTimecode(108003, 30000 / 1001), '01:00:00:03')
  assert.equal(formatExportOverviewTimecode(-1, 24), '00:00:00:00')
})

test('scrubbing delegates only to the existing frame-snapped navigation action', () => {
  const calls = []
  const navigate = (...args) => { calls.push(args); return true }
  const fps = 30000 / 1001
  assert.equal(seekExportOverviewFrame(navigate, 300, fps, 300, false), true)
  assert.equal(seekExportOverviewFrame(navigate, 150, fps, 300), true)
  assert.deepEqual(calls, [[299 / fps, { snap: true }], [150 / fps, { snap: true, intent: 'frame-step' }]])
})

// Exercise production navigation with an in-memory store, no media or IPC.
const require = createRequire(import.meta.url)
const storeCode = buildSync({
  entryPoints: [fileURLToPath(new URL('../stores/timelineStore.js', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'zustand', 'zustand/*'],
}).outputFiles[0].text
function createNavigationFixture(isPlaying = false) {
  const module = { exports: {} }
  Function('require', 'module', 'exports', 'localStorage', storeCode)(require, module, module.exports,
    { getItem: () => null, setItem() {}, removeItem() {} })
  const store = module.exports.useTimelineStore
  const fps = 30000 / 1001
  store.setState({
    clips: [{ id: 'clip', trackId: 'v1', type: 'video', startTime: 0, duration: 300 / fps,
      transform: {}, keyframes: {}, effects: [], cacheStatus: 'cached', cachePath: 'cache/existing.webm' }],
    tracks: [{ id: 'v1', type: 'video', visible: true }], transitions: [], markers: [{ id: 'marker', time: 1 }],
    selectedClipIds: ['clip'], selectedMarkerId: 'marker', inPoint: 1, outPoint: 8, zoom: 150,
    timelineFps: fps, timelineSessionId: 9, isPlaying, playbackRate: 1, playheadPosition: 0,
    history: [], historyIndex: -1, compoundEditContext: null,
  })
  return { store, fps }
}

test('overview seeks preserve the real authored document, caches, marks, selection, and Undo', () => {
  const { store, fps } = createNavigationFixture()
  const before = store.getState(), document = before.getProjectData()
  const stop = watchStoreForProjectChanges(store, TIMELINE_PROJECT_KEYS)
  markProjectClean()
  try {
    for (const frame of [0, 9, 150, 300, -50, 149]) {
      seekExportOverviewFrame(store.getState().setPlayheadPosition, frame, fps, 300, false)
    }
    seekExportOverviewFrame(store.getState().setPlayheadPosition, 149, fps, 300)
    const after = store.getState()
    for (const key of ['clips', 'tracks', 'transitions', 'markers', 'history', 'historyIndex', 'selectedClipIds',
      'selectedMarkerId', 'inPoint', 'outPoint', 'zoom', 'isPlaying', 'playbackRate']) {
      assert.equal(after[key], before[key], key)
    }
    assert.deepEqual(after.getProjectData(), document)
    assert.equal(after.playheadPosition, 149 / fps)
    assert.equal(after.playheadSeekIntent.type, 'frame-step')
    assert.equal(isProjectDirty(), false)
  } finally { stop() }
})

test('overview scrubs during playback retain the current target-picture jump barrier', () => {
  const { store, fps } = createNavigationFixture(true)
  seekExportOverviewFrame(store.getState().setPlayheadPosition, 30, fps, 300, false)
  const first = getCurrentPlaybackJump(store.getState())
  assert.equal(first.targetTime, 30 / fps)
  seekExportOverviewFrame(store.getState().setPlayheadPosition, 180, fps, 300, false)
  const latest = getCurrentPlaybackJump(store.getState())
  assert.notEqual(latest.token, first.token)
  seekExportOverviewFrame(store.getState().setPlayheadPosition, 180, fps, 300)
  assert.equal(getCurrentPlaybackJump(store.getState()), latest, 'precise release keeps the same pending decoder target')
  assert.equal(store.getState().isPlaying, true)
  assert.equal(store.getState().setPlayheadPosition(7, { source: 'transport' }), false)
  assert.equal(store.getState().completePlaybackJump(first.token), false)
  assert.equal(store.getState().playheadPosition, 180 / fps)
  assert.equal(store.getState().completePlaybackJump(latest.token), true)
})
