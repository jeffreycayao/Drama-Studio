import test from 'node:test'
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
const clip = (id, trackId, startTime, duration, patch = {}) => ({ id, trackId, startTime, duration,
  type: trackId.startsWith('a') ? 'audio' : 'video', assetId: id, trimStart: 0, trimEnd: duration,
  sourceDuration: 100, sourceTimeScale: 1, timelineFps: 24, sourceFps: 24, speed: 1, ...patch })

test('tightenTrackGaps applies one undoable checkpoint and undo restores every clip', () => {
  store.setState({ ...initial,
    tracks: [{ id: 'v', name: 'Video 1', type: 'video' }, { id: 'a1', name: 'Audio 1', type: 'audio' }],
    clips: [clip('v1', 'v', 0, 2, { linkGroupId: 'p1' }), clip('d1', 'a1', 0, 2, { linkGroupId: 'p1' }),
      clip('v2', 'v', 3, 2, { linkGroupId: 'p2' }), clip('d2', 'a1', 3, 2, { linkGroupId: 'p2' })],
    transitions: [], timelineFps: 24, history: [], historyIndex: -1 })
  const before = store.getState().clips.map(c => [c.id, c.startTime])
  const states = [], off = store.subscribe(state => states.push(state))
  const result = store.getState().tightenTrackGaps({ trackId: 'a1', keepGapSeconds: 0.25 })
  off()
  assert.equal(result.ok, true)
  assert.equal(result.changed, true)
  assert.equal('clips' in result, false)
  assert.equal(states.length, 1, 'one atomic publish')
  assert.deepEqual(store.getState().clips.map(c => [c.id, c.startTime]), [['v1', 0], ['d1', 0], ['v2', 2.25], ['d2', 2.25]])
  store.getState().undo()
  assert.deepEqual(store.getState().clips.map(c => [c.id, c.startTime]), before)
})
