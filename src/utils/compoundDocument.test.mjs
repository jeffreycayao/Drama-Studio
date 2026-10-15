import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCreateCompoundPlan, validateCompoundDocument, getCompoundDocumentExtent, sanitizeCompoundChildren } from './compoundDocument.mjs'

const tracks = () => [{ id: 'v1', type: 'video' }, { id: 'v2', type: 'video' }, { id: 'a1', type: 'audio', volume: 75, pan: -20 }]
const clip = (patch = {}) => ({ id: 'c1', type: 'video', trackId: 'v1', startTime: 3, duration: 4,
  trimStart: 2, trimEnd: 6, sourceDuration: 20, sourceTimeScale: 1, speed: 1, ...patch })
const input = patch => ({ clips: [clip(), clip({ id: 'a', type: 'audio', trackId: 'a1', startTime: 4, duration: 2 })],
  tracks: tracks(), clipIds: ['c1', 'a'], fps: 24, width: 1920, height: 1080, clipCounter: 1, ...patch })

test('create preserves authored child metadata, local timing, track mix, and caller immutability', () => {
  const original = input()
  original.clips[0] = clip({ effects: [{ type: 'mask', points: [1, 2] }], keyframes: { scaleX: [{ time: 2, value: 130 }] }, speedRamp: { enabled: true } })
  const before = structuredClone(original)
  const result = buildCreateCompoundPlan(original)
  assert.equal(result.ok, true, result.reason)
  assert.deepEqual(original, before)
  const parent = result.compoundClip
  assert.equal(parent.startTime, 3)
  assert.equal(parent.duration, 4)
  assert.equal(parent.sourceDuration, 4)
  assert.deepEqual(parent.compound.document.clips.map(item => item.startTime), [0, 1])
  assert.deepEqual(parent.compound.document.clips[0].effects, original.clips[0].effects)
  assert.notEqual(parent.compound.document.clips[0].effects, original.clips[0].effects)
  assert.equal(parent.compound.document.tracks[1].volume, 75)
  assert.equal(parent.compound.document.masterAudioVolume, 100)
  assert.deepEqual(parent.compound.document.masterAudioInserts, [])
})

test('allocates unique IDs, preserves unrelated parent instances, and supports audio-only/legacy audio roles', () => {
  const other = clip({ id: 'clip-1', startTime: 30 })
  const result = buildCreateCompoundPlan(input({ clips: [other, clip({ type: 'video', trackId: 'a1' })], clipIds: ['c1'] }))
  assert.equal(result.ok, true)
  assert.equal(result.compoundClip.id, 'clip-2')
  assert.equal(result.clips[0], other)
  assert.equal(result.compoundClip.compound.document.clips[0].type, 'audio')
})

test('rejects partial linked groups, transitions, locks, live jobs, and inactive destinations', () => {
  const cases = [
    input({ clips: [clip({ linkGroupId: 'g' }), clip({ id: 'mate', linkGroupId: 'g', trackId: 'a1', type: 'audio' })], clipIds: ['c1'] }),
    input({ transitions: [{ id: 't', clipId: 'c1' }] }),
    input({ clips: [clip({ locked: true })], clipIds: ['c1'] }),
    input({ clips: [clip({ syncLock: { mode: 'sync' } })], clipIds: ['c1'] }),
    input({ clips: [clip({ opticalFlowCache: { status: 'rendering' } })], clipIds: ['c1'] }),
    input({ tracks: tracks().map(track => ({ ...track, solo: true })) }),
    input({ tracks: tracks().map(track => ({ ...track, muted: true })) }),
    input({ tracks: tracks().map(track => ({ ...track, visible: false })) }),
    input({ tracks: tracks().map(track => ({ ...track, inserts: [{ enabled: true }] })) }),
  ]
  for (const value of cases) assert.equal(buildCreateCompoundPlan(value).ok, false)
})

test('rejects interleaved visual layers but preserves unrelated tracks and non-overlapping clips', () => {
  const selected = [clip(), clip({ id: 'bottom', trackId: 'v2' })]
  const value = input({ clips: [...selected, clip({ id: 'unselected', trackId: 'v1', startTime: 4 })], clipIds: ['c1', 'bottom'] })
  assert.equal(buildCreateCompoundPlan(value).ok, false)
  value.clips[2].startTime = 20
  assert.equal(buildCreateCompoundPlan(value).ok, true)
})

test('rejects nested, captions, adjustment, matte, and backdrop-dependent blend semantics', () => {
  for (const patch of [{ type: 'compound' }, { type: 'adjustment' }, { settings: { captionScope: 'timeline' } },
    { trackMatte: { trackId: 'v2' } }, { compositeLowerLayers: 'off' }, { transform: { blendMode: 'multiply' } }]) {
    assert.equal(buildCreateCompoundPlan(input({ clips: [clip(patch)], clipIds: ['c1'] })).ok, false)
  }
})

test('validator catches malformed documents and allows empty edited documents without shrinking source extent', () => {
  const document = buildCreateCompoundPlan(input()).compoundClip.compound.document
  assert.equal(validateCompoundDocument(document).ok, true)
  assert.equal(validateCompoundDocument({ ...document, clips: [] }).ok, true)
  for (const patch of [{ fps: NaN }, { width: 0 }, { masterAudioVolume: 90 }, { transitions: [{ id: 't' }] },
    { tracks: [...document.tracks, document.tracks[0]] }, { clips: [clip({ startTime: -1 })] }]) {
    assert.equal(validateCompoundDocument({ ...document, ...patch }).ok, false)
  }
  assert.equal(getCompoundDocumentExtent({ ...document, clips: [] }, 4), 4)
  assert.equal(getCompoundDocumentExtent({ ...document, clips: [clip({ startTime: 7, duration: 2 })] }, 4), 9)
})

test('recursive sanitation visits children and fails closed for malformed compound documents', () => {
  const parent = buildCreateCompoundPlan(input()).compoundClip
  const result = sanitizeCompoundChildren(parent, child => ({ ...child, cacheUrl: null }))
  assert.equal(result.compound.document.clips[0].cacheUrl, null)
  assert.equal(parent.compound.document.clips[0].cacheUrl, undefined)
  assert.throws(() => sanitizeCompoundChildren({ ...parent, compound: { version: 2 } }, item => item))
})
