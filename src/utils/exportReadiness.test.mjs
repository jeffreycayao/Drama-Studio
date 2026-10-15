import assert from 'node:assert/strict'
import test from 'node:test'
import { buildExportReadinessPlan, findExportPictureGaps, getExportReadinessFileLocation,
  isExportReadinessContextCurrent, EXPORT_READINESS_WARNING_COPY } from './exportReadiness.mjs'
import { OPTICAL_FLOW_CACHE_VERSION, OPTICAL_FLOW_CACHE_ENGINE, OPTICAL_FLOW_CACHE_MODEL } from './frameSampling.js'

const video = (patch = {}) => ({ id: 'v1', assetId: 'source', type: 'video', trackId: 'v', startTime: 0,
  duration: 4, trimStart: 0, trimEnd: 4, sourceDuration: 8, sourceFps: 24, timelineFps: 24, speed: 1,
  sourceTimeScale: 1, ...patch })
const source = { id: 'source', type: 'video', name: 'Source', path: 'assets/source.mp4', hasAudio: true }
const input = (patch = {}) => ({ clips: [video()], tracks: [{ id: 'v', type: 'video' }, { id: 'a', type: 'audio' }],
  assets: [source], transitions: [], timelineFps: 24, projectHandle: '/project', rangeStart: 0, rangeEnd: 4,
  includeAudio: false, format: 'mp4', ...patch })
const codes = (plan) => plan.warnings.map(warning => warning.code)
const gaps = (plan) => plan.warnings.filter(warning => warning.code.startsWith('picture-')).map(({ time, endTime }) => [time, endTime])
const cache = (patch = {}) => ({ version: OPTICAL_FLOW_CACHE_VERSION, engine: OPTICAL_FLOW_CACHE_ENGINE,
  modelName: OPTICAL_FLOW_CACHE_MODEL, status: 'ready', path: 'cache/rife.mp4', sourceStart: 0, sourceEnd: 8,
  sourceSignature: 'size:mtime', targetFps: 24, ...patch })
const compound = (patch = {}) => ({ id: 'compound', name: 'Opening', type: 'compound', trackId: 'v',
  startTime: 10, duration: 3, trimStart: 2, trimEnd: 5, speed: 1, sourceTimeScale: 1,
  compound: { version: 1, document: { fps: 24, width: 1920, height: 1080, duration: 6,
    clips: [video({ duration: 6, trackId: 'inner' })], tracks: [{ id: 'inner', type: 'video' }], transitions: [] } }, ...patch })

test('coverage merges layered and touching intervals, uses half-open range, and detects blank tail', () => {
  assert.deepEqual(findExportPictureGaps([{ start: 1, end: 4 }, { start: 3, end: 6 }, { start: 6, end: 8 }], 0, 10),
    [{ start: 0, end: 1 }, { start: 8, end: 10 }])
  assert.deepEqual(findExportPictureGaps([{ start: 0, end: 2 }, { start: 2 + 1e-10, end: 4 }], 0, 4, 29.97), [])
  assert.deepEqual(findExportPictureGaps([{ start: 0, end: 4 }], 4, 5), [{ start: 4, end: 5 }])
  assert.deepEqual(findExportPictureGaps([], 2, 2), [])
  assert.deepEqual(gaps(buildExportReadinessPlan(input({ rangeEnd: 6 }))), [[4, 6]])
  assert.ok(codes(buildExportReadinessPlan(input({ rangeEnd: 6 }))).includes('picture-tail'))
})

test('a lower layer covers gaps on upper tracks and input is not mutated', () => {
  const state = input({ clips: [video({ duration: 1 }), video({ id: 'lower', trackId: 'lower', duration: 4 })],
    tracks: [{ id: 'v', type: 'video' }, { id: 'lower', type: 'video' }] })
  const before = structuredClone(state)
  const plan = buildExportReadinessPlan(state)
  assert.deepEqual(gaps(plan), [])
  assert.equal(plan.files.length, 1, 'shared source is checked once')
  assert.deepEqual(state, before)
})

test('disabled, hidden, muted and solo-excluded tracks do not cover picture or require sources', () => {
  for (const patch of [{ clips: [video({ enabled: false })] },
    { tracks: [{ id: 'v', type: 'video', visible: false }] },
    { tracks: [{ id: 'v', type: 'video', muted: true }] },
    { tracks: [{ id: 'v', type: 'video' }, { id: 'other', type: 'video', solo: true }] }]) {
    const plan = buildExportReadinessPlan(input(patch))
    assert.deepEqual(gaps(plan), [[0, 4]])
    assert.equal(plan.files.length, 0)
    assert.ok(!codes(plan).includes('missing-asset'))
  }
})

test('procedural picture needs no asset while images do, and adjustment layers are not picture', () => {
  for (const type of ['text', 'shape', 'captions']) {
    const plan = buildExportReadinessPlan(input({ clips: [video({ type, assetId: null })], assets: [] }))
    assert.deepEqual(plan.warnings, [])
    assert.equal(plan.files.length, 0)
  }
  const image = buildExportReadinessPlan(input({ clips: [video({ type: 'image' })], assets: [] }))
  assert.deepEqual(codes(image), ['missing-asset'])
  const adjustment = buildExportReadinessPlan(input({ clips: [video({ type: 'adjustment', assetId: null })] }))
  assert.deepEqual(gaps(adjustment), [[0, 4]])
})

test('missing media does not become a false picture-gap diagnosis; unused assets are ignored', () => {
  const plan = buildExportReadinessPlan(input({ assets: [] }))
  assert.deepEqual(codes(plan), ['missing-asset'])
  assert.deepEqual(gaps(plan), [])
  assert.equal(buildExportReadinessPlan(input({ assets: [source, { id: 'unused' }] })).warnings.length, 0)
  const missingLocation = buildExportReadinessPlan(input({ assets: [{ ...source, path: null }] }))
  assert.deepEqual(codes(missingLocation), ['missing-location'])
})

test('source locations preserve export precedence and portable absolute/relative paths', () => {
  for (const path of ['/media/a.mp4', 'C:\\Media\\a.mp4', 'C:/Media/a.mp4', '\\\\server\\share\\a.mp4']) {
    assert.deepEqual(getExportReadinessFileLocation({ path }), { path, relative: false })
  }
  assert.deepEqual(getExportReadinessFileLocation({ path: 'assets\\a.mp4' }), { path: 'assets\\a.mp4', relative: true })
  assert.deepEqual(getExportReadinessFileLocation({ absolutePath: '/old/a.mp4', path: 'assets/a.mp4', settings: { sourcePath: '/import.mp4' } }),
    { path: '/old/a.mp4', relative: false })
  for (const path of ['https://host/a.mp4', 'blob:source', 'file:///media/a.mp4', 'data:video/mp4,', 'bad\0name']) {
    assert.equal(getExportReadinessFileLocation({ path }), null)
  }
  assert.equal(getExportReadinessFileLocation({ settings: { sourcePath: '/import.mp4' } }), null)
  assert.deepEqual(codes(buildExportReadinessPlan(input({ assets: [{ ...source, path: null, url: 'blob:media' }] }))), ['media-unverified'])
})

test('audio-only and still formats check only applicable roles', () => {
  const sound = video({ id: 'sound', type: 'audio', trackId: 'a' })
  const state = input({ clips: [video(), sound], format: 'audio', includeAudio: false })
  const plan = buildExportReadinessPlan(state)
  assert.deepEqual(plan.warnings, [])
  assert.equal(plan.files.length, 1)
  assert.equal(plan.files[0].clipId, 'sound')
  for (const format of ['png-seq', 'gif']) {
    assert.ok(!codes(buildExportReadinessPlan(input({ format, includeAudio: true }))).includes('no-audio'))
  }
  assert.ok(codes(buildExportReadinessPlan(input({ includeAudio: true }))).includes('no-audio'),
    'an unsplit video clip is not an audio mix clip')
  assert.deepEqual(gaps(buildExportReadinessPlan(input({ clips: [sound] }))), [[0, 4]])
})

test('audio audibility respects solo/mute, source stream, reverse and master without trusting asset.audioEnabled', () => {
  const sound = video({ type: 'audio', trackId: 'a' })
  for (const patch of [{ clips: [{ ...sound, enabled: false }] }, { clips: [{ ...sound, reverse: true }] },
    { clips: [{ ...sound, audioEnabled: false }] }, { assets: [{ ...source, hasAudio: false }] },
    { tracks: [{ id: 'a', type: 'audio', muted: true }] }, { tracks: [{ id: 'a', type: 'audio', visible: false }] },
    { tracks: [{ id: 'a', type: 'audio', volume: 0 }] },
    { tracks: [{ id: 'a', type: 'audio' }, { id: 'solo', type: 'audio', solo: true }] }]) {
    const plan = buildExportReadinessPlan(input({ clips: [sound], format: 'audio', ...patch }))
    assert.ok(codes(plan).includes('no-audio'))
    assert.equal(plan.files.length, 0)
  }
  const allowed = buildExportReadinessPlan(input({ clips: [sound], format: 'audio', assets: [{ ...source, audioEnabled: false }] }))
  assert.deepEqual(allowed.warnings, [])
  assert.ok(codes(buildExportReadinessPlan(input({ clips: [sound], format: 'audio', masterAudioVolume: 0 }))).includes('master-muted'))
})

test('legacy video on an audio track remains audio, with no Optical Flow or picture checks', () => {
  const plan = buildExportReadinessPlan(input({ clips: [video({ trackId: 'a', frameSampling: 'optical-flow' })], format: 'audio' }))
  assert.deepEqual(plan.warnings, [])
  assert.equal(plan.files.length, 1)
  assert.equal(plan.opticalFlowCount, 0)
})

test('compound children use projected windows and shared asset IDs without mutating authored data', () => {
  const parent = compound(), state = input({ clips: [parent], rangeStart: 10, rangeEnd: 14 })
  const before = structuredClone(state)
  const plan = buildExportReadinessPlan(state)
  assert.deepEqual(gaps(plan), [[13, 14]])
  assert.equal(plan.files[0].time, 10)
  assert.equal(plan.files[0].assetId, 'source')
  assert.match(plan.files[0].clipId, /^compound\//)
  assert.deepEqual(state, before)
  parent.compound.document.clips = [video({ startTime: 5, duration: 1, trackId: 'inner', assetId: 'outside' })]
  const clipped = buildExportReadinessPlan(input({ clips: [parent], rangeStart: 10, rangeEnd: 13 }))
  assert.equal(clipped.files.length, 0, 'children only in hidden handles need no source')
  assert.deepEqual(gaps(clipped), [[10, 13]])
})

test('unsupported compounds are unknown, not asserted blank/silent; hidden compounds produce no warning', () => {
  const parent = compound({ speed: 2 })
  const plan = buildExportReadinessPlan(input({ clips: [parent], rangeStart: 10, rangeEnd: 13, includeAudio: true }))
  assert.deepEqual(codes(plan), ['compound-unverified'])
  const hidden = buildExportReadinessPlan(input({ clips: [{ ...parent, enabled: false }], rangeStart: 10, rangeEnd: 13 }))
  assert.ok(!codes(hidden).includes('compound-unverified'))
  const outside = buildExportReadinessPlan(input({ clips: [parent], rangeStart: 0, rangeEnd: 1 }))
  assert.ok(!codes(outside).includes('compound-unverified'))
})

test('compound audio is included through projected audio tracks', () => {
  const parent = compound()
  parent.compound.document.clips = [video({ type: 'audio', trackId: 'inner', duration: 6 })]
  parent.compound.document.tracks[0].type = 'audio'
  const plan = buildExportReadinessPlan(input({ clips: [parent], rangeStart: 10, rangeEnd: 13, format: 'audio' }))
  assert.deepEqual(plan.warnings, [])
  assert.equal(plan.files.length, 1)
})

test('transition handles count as possible coverage and bring contributor sources into range', () => {
  const plan = buildExportReadinessPlan(input({ clips: [video({ duration: 1 }), video({ id: 'b', startTime: 2, duration: 1, assetId: 'b' })],
    transitions: [{ id: 't', clipAId: 'v1', clipBId: 'b', editPoint: 1.5, duration: 2 }],
    assets: [source, { ...source, id: 'b' }], rangeStart: 1.25, rangeEnd: 1.75 }))
  assert.deepEqual(gaps(plan), [])
  assert.equal(plan.files.length, 2)
  assert.ok(plan.files.every(file => file.time >= 1.25 && file.time < 1.75), 'Inspect stays inside the checked range')
})

test('Optical Flow validates current metadata, cadence and handles but never claims current source signature', () => {
  const optical = video({ frameSampling: 'optical-flow', opticalFlowCache: cache() })
  const good = buildExportReadinessPlan(input({ clips: [optical] }))
  assert.deepEqual(good.warnings, [])
  assert.equal(good.opticalFlowCount, 1)
  assert.deepEqual(good.files[1].location, { path: 'cache/rife.mp4', relative: true })
  for (const patch of [{ version: 'old' }, { engine: 'other' }, { modelName: 'old' }, { status: 'building' },
    { sourceStart: 2 }, { sourceEnd: 2 }, { targetFps: 10 }]) {
    assert.ok(codes(buildExportReadinessPlan(input({ clips: [{ ...optical, opticalFlowCache: cache(patch) }] }))).includes('optical-unready'))
  }
  assert.ok(codes(buildExportReadinessPlan(input({ clips: [{ ...optical, reverse: true }] }))).includes('optical-unready'))
  assert.ok(codes(buildExportReadinessPlan(input({ clips: [{ ...optical, opticalFlowCache: cache({ sourceSignature: null }) }] }))).includes('optical-signature'))
  assert.ok(codes(buildExportReadinessPlan(input({ clips: [{ ...optical, opticalFlowCache: cache({ path: '../elsewhere.mp4' }) }] }))).includes('optical-path'))
  assert.ok(codes(buildExportReadinessPlan(input({ clips: [optical], projectHandle: null }))).includes('optical-unsaved'))
  assert.equal(buildExportReadinessPlan(input({ clips: [{ ...optical, startTime: 10 }] })).opticalFlowCount, 0)
})

test('full render bakes never bypass source checks and review proxies do not claim originals are available', () => {
  const plan = buildExportReadinessPlan(input({ clips: [video({ cacheStatus: 'cached', cacheUrl: 'blob:bake', cachePath: 'cache/bake.webm' })],
    useProxyMedia: true, assets: [{ ...source, proxyStatus: 'ready', proxyPath: 'cache/proxy.mp4' }] }))
  assert.equal(plan.files.length, 1)
  assert.equal(plan.files[0].location.path, 'assets/source.mp4')
  assert.equal(plan.files[0].missingCode, 'missing-proxy-source')
})

test('only used masks are checked; bypassed/parametric masks do not require external media', () => {
  const masked = video({ effects: [{ type: 'mask', enabled: true, maskAssetId: 'mask' }] })
  const assets = [source, { id: 'mask', maskFrames: [{ path: 'assets/m1.png' }, { path: 'assets/m2.png' }] }]
  const plan = buildExportReadinessPlan(input({ clips: [masked], assets }))
  assert.equal(plan.files.length, 3)
  assert.equal(plan.files[1].kind, 'mask')
  assert.equal(plan.files[2].missingCode, 'missing-mask')
  for (const patch of [{ bypass: { mask: true } }, { shapeMask: { shape: 'ellipse' } }, { effects: [{ ...masked.effects[0], enabled: false }] }]) {
    assert.equal(buildExportReadinessPlan(input({ clips: [{ ...masked, ...patch }], assets })).files.length, 1)
  }
  assert.ok(codes(buildExportReadinessPlan(input({ clips: [masked] }))).includes('missing-asset'))
})

test('context guards reject source, session, project, range and rendering-role changes but permit playback', () => {
  const snapshot = input({ timelineId: 'main', timelineSessionId: 1 })
  assert.equal(isExportReadinessContextCurrent(snapshot, { ...snapshot, playheadPosition: 2 }), true)
  for (const patch of [{ assets: [...snapshot.assets] }, { clips: [...snapshot.clips] }, { tracks: [] }, { transitions: [] },
    { timelineId: 'other' }, { timelineSessionId: 2 }, { projectHandle: '/different' }, { rangeStart: 2 }, { rangeEnd: 3 },
    { timelineFps: 29.97 }, { includeAudio: true }, { format: 'audio' }, { useProxyMedia: true }, { masterAudioVolume: 0 }]) {
    assert.equal(isExportReadinessContextCurrent(snapshot, { ...snapshot, ...patch }), false)
  }
  assert.equal(isExportReadinessContextCurrent(null, snapshot), false)
})

test('invalid bounds stay finite and warnings promise neither decode validation nor a perfect export', () => {
  for (const rangeEnd of [0, -1, NaN, Infinity]) {
    const plan = buildExportReadinessPlan(input({ rangeEnd }))
    assert.deepEqual(codes(plan), ['invalid-range'])
    assert.equal(plan.files.length, 0)
  }
  for (const [title, detail] of Object.values(EXPORT_READINESS_WARNING_COPY)) {
    assert.ok(title && detail)
    assert.doesNotMatch(`${title} ${detail}`, /guaranteed|perfect|decode.checked|lossless/i)
  }
})
