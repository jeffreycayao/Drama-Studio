import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { DEFAULT_AUDIO_EQ } from './audioEq.mjs'
import { buildAudioClipSplitState } from './audioClipSplit.js'

// Exercise the actual store and its imported helpers, including history and
// project normalization. Bundle in memory to resolve the renderer's extensionless
// imports without writing a build artifact or mounting React/the audio engine.
const require = createRequire(import.meta.url)
const compiled = buildSync({
  entryPoints: [fileURLToPath(new URL('../stores/timelineStore.js', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node',
  external: ['react', 'zustand', 'zustand/*'],
}).outputFiles[0].text
const module = { exports: {} }
const storage = { getItem: () => null, setItem() {}, removeItem() {} }
Function('require', 'module', 'exports', 'localStorage', compiled)(require, module, module.exports, storage)
const store = module.exports.useTimelineStore
const initialState = store.getState()
const eq = patch => ({ ...DEFAULT_AUDIO_EQ, ...patch })
const authored = () => eq({ lowCut: true, bassDb: 6, midDb: -3, trebleDb: 2 })
const audio = patch => ({
  id: 'audio', name: 'Audio', trackId: 'audio-1', type: 'audio', assetId: 'tone',
  startTime: 1, duration: 8, trimStart: 2, trimEnd: 10, sourceDuration: 12,
  sourceTimeScale: 1, speed: 1, gainDb: -3, fadeIn: 0.2, fadeOut: 0.3,
  volumeEnvelope: { version: 1, offsetSeconds: 1, points: [{ id: 'p', time: 2, db: -6 }] },
  metadata: { label: 'preserve me' }, ...patch,
})
const asset = { id: 'tone', name: 'Tone', type: 'audio', duration: 12,
  url: 'blob:synthetic', settings: { duration: 12, fps: 24 } }
const tracks = () => [{ id: 'audio-1', name: 'Audio 1', type: 'audio' }]
const reset = (patch = {}) => store.setState({
  ...initialState, clips: [audio()], tracks: tracks(), timelineFps: 24,
  selectedClipIds: ['audio'], history: [], historyIndex: -1,
  clipCounter: 1, transitionCounter: 1, markerCounter: 1,
  ...patch,
})
const current = () => store.getState().clips.find(clip => clip.id === 'audio')
const unchanged = action => {
  const before = store.getState()
  let writes = 0
  const unsubscribe = store.subscribe(() => { writes++ })
  let result
  try { result = action() } finally { unsubscribe() }
  assert.equal(store.getState(), before)
  assert.equal(writes, 0, 'rejection/no-op must not notify subscribers or dirty the document')
  assert.equal(store.getState().history.length, before.history.length)
  return result
}
const reject = action => {
  const result = unchanged(action)
  assert.equal(result.ok, false)
  assert.equal(result.changed, false)
  assert.equal(typeof result.reason, 'string')
  assert.ok(result.reason.length > 0)
}

beforeEach(() => reset())

test('legacy flat reset is a true no-op without densifying the document or creating history', () => {
  for (const value of [undefined, null, DEFAULT_AUDIO_EQ]) {
    assert.deepEqual(unchanged(() => store.getState().updateAudioEq('audio', value)), { ok: true, changed: false })
    assert.equal(Object.hasOwn(current(), 'audioEq'), false)
  }
})

test('strict authoring rejects malformed EQ before any write', () => {
  for (const value of [{}, [], 'bad', eq({ version: 2 }), eq({ enabled: 1 }), eq({ lowCut: 'false' }),
    eq({ bassDb: '6' }), eq({ bassDb: NaN }), eq({ midDb: Infinity }), eq({ trebleDb: 12.01 })]) {
    reject(() => store.getState().updateAudioEq('audio', value))
  }
})

test('one authored EQ edit has one undo step, independent settings, and no unrelated changes', () => {
  const original = current()
  const settings = authored()
  assert.deepEqual(store.getState().updateAudioEq('audio', settings, true, original), { ok: true, changed: true })
  assert.equal(store.getState().history.length, 1)
  const committed = current()
  assert.deepEqual(committed, { ...original, audioEq: settings })
  assert.notEqual(committed.audioEq, settings)
  settings.bassDb = -12
  assert.equal(committed.audioEq.bassDb, 6)
  assert.deepEqual(unchanged(() => store.getState().updateAudioEq('audio', authored())), { ok: true, changed: false })
  assert.equal(store.getState().undo(), true)
  // History restoration normalizes the unrelated optional cache field.
  assert.deepEqual(current(), { ...original, opticalFlowCache: undefined })
  assert.equal(store.getState().redo(), true)
  assert.deepEqual(current(), { ...committed, opticalFlowCache: undefined })
})

test('saveHistory=false changes settings without adding a checkpoint', () => {
  assert.deepEqual(store.getState().updateAudioEq('audio', authored(), false), { ok: true, changed: true })
  assert.deepEqual(current().audioEq, authored())
  assert.equal(store.getState().history.length, 0)
})

test('bypass retains authored values and reset is independently undoable', () => {
  reset({ clips: [audio({ audioEq: authored() })] })
  const bypassed = { ...authored(), enabled: false }
  assert.equal(store.getState().updateAudioEq('audio', bypassed).changed, true)
  assert.deepEqual(current().audioEq, bypassed)
  assert.equal(store.getState().updateAudioEq('audio', null).changed, true)
  assert.deepEqual(current().audioEq, DEFAULT_AUDIO_EQ)
  assert.equal(store.getState().history.length, 2)
  store.getState().undo()
  assert.deepEqual(current().audioEq, bypassed)
  store.getState().undo()
  assert.deepEqual(current().audioEq, authored())
})

test('missing, ambiguous, and stale clip or track identities cannot be edited', () => {
  reject(() => store.getState().updateAudioEq('missing', authored()))
  reject(() => store.getState().updateAudioEq('audio', authored(), true, { ...current() }))
  for (const patch of [
    { clips: [audio(), audio()] }, { tracks: [] }, { tracks: [...tracks(), ...tracks()] },
  ]) {
    reset(patch)
    reject(() => store.getState().updateAudioEq('audio', authored()))
  }
  reset()
  const draftClip = current()
  store.getState().updateClipTrim('audio', { startTime: 2, duration: 7, trimStart: 3, trimEnd: 10 })
  reject(() => store.getState().updateAudioEq('audio', authored(), true, draftClip))
})

test('EQ requires an audio role on an audio track, including legacy video-backed audio', () => {
  for (const type of ['video', 'captions']) {
    reset({ tracks: [{ ...tracks()[0], type }] })
    reject(() => store.getState().updateAudioEq('audio', authored()))
  }
  for (const type of ['image', 'text', 'shape', 'adjustment']) {
    reset({ clips: [audio({ type })] })
    reject(() => store.getState().updateAudioEq('audio', authored()))
  }
  reset({ clips: [audio({ type: 'video' })] })
  assert.equal(store.getState().updateAudioEq('audio', authored()).changed, true)
})

test('all clip and track lock forms reject atomically', () => {
  for (const lock of [{ locked: true }, { syncLocked: true }, { lockMode: 'sync' }, { syncLock: { mode: 'sync' } }]) {
    for (const where of ['clip', 'track']) {
      reset(where === 'clip' ? { clips: [audio(lock)] } : { tracks: [{ ...tracks()[0], ...lock }] })
      reject(() => store.getState().updateAudioEq('audio', authored(), true, current()))
    }
  }
})

test('ordinary Add Clip preserves independent EQ options and leaves legacy clips sparse', () => {
  reset({ clips: [] })
  const settings = authored()
  const added = store.getState().addClip('audio-1', asset, 0, 24, { duration: 2, audioEq: settings })
  assert.deepEqual(added.audioEq, settings)
  assert.notEqual(added.audioEq, settings)
  const legacy = store.getState().addClip('audio-1', asset, 3, 24, { duration: 2 })
  assert.equal(Object.hasOwn(legacy, 'audioEq'), false)
  const malformed = store.getState().addClip('audio-1', asset, 6, 24, { duration: 2, audioEq: { bassDb: 'bad' } })
  assert.deepEqual(malformed.audioEq, DEFAULT_AUDIO_EQ)
})

test('ordinary copy/paste preserves EQ independently but the static attribute snapshot excludes it', () => {
  reset({ clips: [audio({ audioEq: authored() })] })
  store.getState().copySelectedClips()
  const copied = store.getState().copiedClips[0]
  assert.deepEqual(copied.audioEq, authored())
  assert.notEqual(copied.audioEq, current().audioEq)
  assert.equal(Object.hasOwn(store.getState().attributeClipboard.clips[0], 'audioEq'), false)
  store.getState().updateAudioEq('audio', eq({ midDb: 12 }))
  store.getState().pasteClipsAtPlayhead('audio-1', 20, [asset])
  const pasted = store.getState().clips.find(clip => clip.id !== 'audio')
  assert.deepEqual(pasted.audioEq, authored())
  assert.notEqual(pasted.audioEq, copied.audioEq)
  assert.deepEqual(pasted.volumeEnvelope, copied.volumeEnvelope)
  assert.equal(pasted.gainDb, -3)
})

test('project save/load preserves bypassed settings; malformed reads become flat without densifying absent EQ', () => {
  const settings = eq({ enabled: false, lowCut: true, bassDb: 7 })
  reset({ clips: [audio({ audioEq: settings })] })
  const project = JSON.parse(JSON.stringify(store.getState().getProjectData()))
  store.getState().loadFromProject(project, [asset], 24)
  assert.deepEqual(current().audioEq, settings)
  assert.notEqual(current().audioEq, project.clips[0].audioEq)
  assert.equal(store.getState().history.length, 0)
  for (const patch of [{}, { audioEq: { version: 2, bassDb: 8 } }, { type: 'video', audioEq: settings }]) {
    store.getState().loadFromProject({ tracks: tracks(), clips: [audio(patch)] }, [asset], 24)
    assert.equal(current().type, 'audio')
    if (!Object.hasOwn(patch, 'audioEq')) assert.equal(Object.hasOwn(current(), 'audioEq'), false)
    else assert.deepEqual(current().audioEq, patch.type === 'video' ? settings : DEFAULT_AUDIO_EQ)
  }
})

test('head/tail trims, moves, and source slips do not change static EQ', () => {
  reset({ clips: [audio({ audioEq: authored() })] })
  const actions = [
    () => store.getState().updateClipTrim('audio', { startTime: 2, duration: 7, trimStart: 3, trimEnd: 10 }),
    () => store.getState().resizeClip('audio', 6),
    () => store.getState().moveClip('audio', 'audio-1', 20),
    () => store.getState().updateClipTrim('audio', { trimStart: 4, trimEnd: 10 }),
  ]
  for (const action of actions) {
    action()
    assert.deepEqual(current().audioEq, authored())
  }
})

test('real razor flow preserves independent EQ on both pieces through resize/update/add whitelists', () => {
  reset({ clips: [audio({ audioEq: authored() })] })
  const original = current()
  const split = buildAudioClipSplitState(original, tracks()[0], asset, { left: 3, right: 5 })
  store.getState().resizeClip(original.id, 3)
  store.getState().updateClipTrim(original.id, split.leftClipUpdates)
  const right = store.getState().addClip('audio-1', split.asset, original.startTime + 3, 24, {
    duration: 5, trimStart: 5, trimEnd: 10, ...split.rightClipOptions,
  })
  assert.equal(store.getState().clips.length, 2)
  assert.deepEqual(current().audioEq, authored())
  assert.deepEqual(right.audioEq, authored())
  assert.notEqual(current().audioEq, right.audioEq)
  assert.equal(right.volumeEnvelope.offsetSeconds, original.volumeEnvelope.offsetSeconds + 3)
})
