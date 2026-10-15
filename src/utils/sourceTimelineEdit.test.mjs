import test from 'node:test'
import assert from 'node:assert/strict'
import { planSourceTimelineEdit } from './sourceTimelineEdit.mjs'

const tracks = [
  { id: 'v1', type: 'video' }, { id: 'v2', type: 'video', visible: false, muted: true },
  { id: 'a1', type: 'audio' }, { id: 'a2', type: 'audio', muted: true },
  { id: 'captions', type: 'video', role: 'captions' },
]
const clip = (id, trackId, startTime, duration, extra = {}) => ({
  id, trackId, startTime, duration, type: trackId.startsWith('a') ? 'audio' : 'video',
  trimStart: 0, trimEnd: duration, sourceDuration: 100, sourceTimeScale: 1, speed: 1,
  ...extra,
})
const request = (extra = {}) => ({
  clips: [], tracks, mode: 'insert', fps: 24, startTime: 4, duration: 2,
  newClips: [clip('new-v', 'v1', 4, 2)], clipCounter: 1,
  ...extra,
})
const byId = (result, id) => result.clips.find((item) => item.id === id)
const freezeDeep = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  Object.values(value).forEach(freezeDeep)
  return value
}
const good = (input) => {
  const result = planSourceTimelineEdit(input)
  assert.equal(result.ok, true, result.reason)
  return result
}
const rejected = (input, reason) => {
  const before = structuredClone(input)
  const result = planSourceTimelineEdit(freezeDeep(input))
  assert.equal(result.ok, false)
  assert.match(result.reason, reason)
  assert.equal('clips' in result, false)
  assert.deepEqual(input, before)
  return result
}

test('insert splits every crossing track and shifts all downstream clips and markers', () => {
  const inputs = request({
    clips: [clip('v', 'v1', 1, 8), clip('overlay', 'v2', 2, 6), clip('sound', 'a1', 0, 8), clip('muted', 'a2', 5, 3), clip('before', 'v1', 0, 1)],
    markers: [{ id: 'before', time: 3 }, { id: 'at', time: 4 }, { id: 'after', time: 8 }],
  })
  const result = good(freezeDeep(inputs))
  assert.deepEqual(result.clips.filter((c) => c.trackId === 'v2').map((c) => [c.startTime, c.duration, c.trimStart, c.trimEnd]), [[2, 2, 0, 2], [6, 4, 2, 6]])
  assert.deepEqual(result.clips.filter((c) => c.trackId === 'a1').map((c) => [c.startTime, c.duration, c.trimStart, c.trimEnd]), [[0, 4, 0, 4], [6, 4, 4, 8]])
  assert.equal(byId(result, 'muted').startTime, 7)
  assert.equal(byId(result, 'before'), inputs.clips[4])
  assert.deepEqual(result.markers.map((m) => m.time), [3, 6, 10])
  assert.deepEqual(new Set(result.affectedTrackIds), new Set(['v1', 'v2', 'a1', 'a2']))
  assert.equal(result.splitClipIds.length, 3)
})

test('insert at exact start/end and in an empty gap creates no unnecessary split', () => {
  const result = good(request({ clips: [clip('left', 'v1', 0, 4), clip('right', 'v1', 4, 4), clip('later', 'v2', 9, 1)] }))
  assert.equal(byId(result, 'left').duration, 4)
  assert.equal(byId(result, 'right').startTime, 6)
  assert.equal(byId(result, 'later').startTime, 11)
  assert.equal(result.splitClipIds.length, 0)
  const gap = good(request({ clips: [clip('before', 'v1', 0, 1), clip('after', 'v2', 8, 1)] }))
  assert.equal(byId(gap, 'after').startTime, 10)
})

test('insert at timeline zero shifts the complete sequence, including live captions', () => {
  const captions = clip('caption', 'captions', 0, 8, { type: 'captions', captions: { cues: [{ start: 0, end: 2, text: 'hello' }] } })
  const result = good(request({ startTime: 0, newClips: [clip('new-v', 'v1', 0, 2)], clips: [clip('v', 'v1', 0, 5), captions] }))
  assert.equal(byId(result, 'caption').startTime, 2)
  assert.equal(byId(result, 'caption').captions, captions.captions)
})

test('overwrite retains both side pieces, removes fully covered clips, and preserves later positions', () => {
  const overlay = clip('overlay', 'v2', 1, 8)
  const markers = [{ id: 'm', time: 5 }]
  const result = good(request({ mode: 'overwrite', clips: [clip('spanning', 'v1', 0, 10), clip('covered', 'a1', 4, 2), clip('later', 'v1', 12, 2), overlay], newClips: [clip('new-v', 'v1', 4, 2), clip('new-a', 'a1', 4, 2)], markers }))
  assert.deepEqual(result.clips.filter((c) => c.trackId === 'v1').map((c) => [c.startTime, c.duration]), [[0, 4], [6, 4], [12, 2], [4, 2]])
  assert.deepEqual(result.removedClipIds, ['covered'])
  assert.equal(byId(result, 'overlay'), overlay)
  assert.equal(result.markers, markers)
  assert.deepEqual(new Set(result.affectedTrackIds), new Set(['v1', 'a1']))
})

test('overwrite handles a left tail, right head, exact coverage, and a gap', () => {
  const result = good(request({ mode: 'overwrite', clips: [clip('tail', 'v1', 2, 3), clip('head', 'v1', 5, 3), clip('exact', 'a1', 4, 2), clip('unrelated', 'a2', 4, 2)], newClips: [clip('new-v', 'v1', 4, 2), clip('new-a', 'a1', 4, 2)] }))
  assert.deepEqual([byId(result, 'tail').startTime, byId(result, 'tail').duration, byId(result, 'tail').trimEnd], [2, 2, 2])
  assert.deepEqual([byId(result, 'head').startTime, byId(result, 'head').duration, byId(result, 'head').trimStart], [6, 2, 1])
  assert.equal(byId(result, 'exact'), undefined)
  assert.equal(byId(result, 'unrelated').startTime, 4)
  assert.equal(result.splitClipIds.length, 0)
  const gap = good(request({ mode: 'overwrite', clips: [clip('before', 'v1', 0, 4), clip('after', 'v1', 6, 2)] }))
  assert.equal(gap.clips.length, 3)
  assert.equal(gap.changedClipIds.length, 1)
})

test('append inserts at supplied end without moving unrelated sequence clips or markers', () => {
  const later = clip('later', 'v2', 5, 8)
  const markers = [{ id: 'm', time: 4 }]
  const result = good(request({ mode: 'append', clips: [clip('ending', 'v1', 0, 4), later], markers }))
  assert.equal(byId(result, 'later'), later)
  assert.equal(result.markers, markers)
  assert.equal(result.splitClipIds.length, 0)
  rejected(request({ mode: 'append', clips: [clip('collision', 'a1', 3, 4)], newClips: [clip('new-v', 'v1', 4, 2), clip('new-a', 'a1', 4, 2)] }), /overlaps/)
})

test('append after a completed edge fade or between transition preserves it', () => {
  const edge = { id: 'fade', kind: 'edge', clipId: 'a', edge: 'out', duration: 1 }
  const result = good(request({ mode: 'append', clips: [clip('a', 'v1', 0, 4)], transitions: [edge] }))
  assert.equal(result.transitions[0], edge)
  const transition = between({ editPoint: 2, originalClipAEnd: 2, originalClipBStart: 2 })
  const result2 = good(request({ mode: 'append', clips: [clip('a', 'v1', 0, 2), clip('b', 'v1', 2, 2)], transitions: [transition] }))
  assert.equal(result2.transitions[0], transition)
})

for (const mode of ['insert', 'overwrite']) {
  test(`${mode} rejects affected locked tracks and clips atomically`, () => {
    rejected(request({ mode, tracks: tracks.map((t) => t.id === 'v2' ? { ...t, locked: true } : t), clips: [clip('safe', 'v1', 0, 8), clip('locked', 'v2', 1, 8)], ...(mode === 'overwrite' ? { newClips: [clip('new-v', 'v2', 4, 2)] } : {}) }), /Unlock/)
    for (const lock of [{ locked: true }, { lockMode: 'sync', syncLock: { mode: 'sync', startTime: 0, duration: 8 } }, { syncLock: { mode: 'sync' } }]) {
      rejected(request({ mode, clips: [clip('locked', 'v1', 0, 8, lock)] }), /Unlock/)
    }
  })
}

test('unaffected locked clips are preserved while locked empty destination tracks reject', () => {
  const result = good(request({ clips: [clip('before', 'v2', 0, 4, { locked: true })] }))
  assert.equal(result.clips.length, 2)
  rejected(request({ tracks: tracks.map((t) => t.id === 'v1' ? { ...t, locked: true } : t) }), /Unlock/)
})

test('linked video/audio splits get independent left and right linked groups', () => {
  const inputs = request({ clips: [clip('clip-8', 'v1', 0, 8, { linkGroupId: 'original' }), clip('a', 'a1', 0, 8, { linkGroupId: 'original' })], newClips: [clip('clip-9', 'v1', 4, 2, { linkGroupId: 'source' }), clip('new-a', 'a1', 4, 2, { linkGroupId: 'source' })], clipCounter: 2 })
  const result = good(inputs)
  assert.deepEqual(result.splitClipIds, ['clip-10', 'clip-11'])
  assert.equal(result.clipCounter, 12)
  assert.equal(byId(result, 'clip-8').linkGroupId, 'original')
  assert.equal(byId(result, 'a').linkGroupId, 'original')
  assert.equal(byId(result, 'clip-10').linkGroupId, byId(result, 'clip-11').linkGroupId)
  assert.notEqual(byId(result, 'clip-10').linkGroupId, 'original')
  assert.notEqual(byId(result, 'clip-10').linkGroupId, 'source')
  assert.equal(new Set(result.clips.map((c) => c.id)).size, result.clips.length)
})

test('right split mates remap embedded linked clip metadata without changing left metadata', () => {
  const v = clip('v', 'v1', 0, 8, { linkGroupId: 'g', metadata: { linkedAudioClipId: 'a' } })
  const a = clip('a', 'a1', 0, 8, { linkGroupId: 'g', metadata: { linkedVideoClipId: 'v', embeddedAudioFromVideoAsset: true } })
  const result = good(freezeDeep(request({ clips: [v, a] })))
  const rightV = byId(result, result.splitClipIds[0])
  const rightA = byId(result, result.splitClipIds[1])
  assert.equal(rightA.metadata.linkedVideoClipId, rightV.id)
  assert.equal(rightV.metadata.linkedAudioClipId, rightA.id)
  assert.equal(rightA.metadata.embeddedAudioFromVideoAsset, true)
  assert.equal(byId(result, 'a').metadata.linkedVideoClipId, 'v')
  assert.equal(byId(result, 'v').metadata.linkedAudioClipId, 'a')
})

test('linked overwrite supports aligned pairs but rejects untargeted or asymmetric group damage', () => {
  const linked = [clip('v', 'v1', 0, 8, { linkGroupId: 'group' }), clip('a', 'a1', 0, 8, { linkGroupId: 'group' })]
  const result = good(request({ mode: 'overwrite', clips: linked, newClips: [clip('new-v', 'v1', 4, 2), clip('new-a', 'a1', 4, 2)] }))
  assert.equal(result.splitClipIds.length, 2)
  assert.equal(byId(result, result.splitClipIds[0]).linkGroupId, byId(result, result.splitClipIds[1]).linkGroupId)
  rejected(request({ mode: 'overwrite', clips: linked }), /linked group on other tracks/)
  rejected(request({ clips: [linked[0], { ...linked[1], startTime: 8 }] }), /linked clips differently/)
  rejected(request({ clips: [linked[0], { ...linked[1], duration: 10, trimEnd: 10 }] }), /linked clips differently/)
})

test('linked downstream clips move together without relinking', () => {
  const result = good(request({ clips: [clip('v', 'v1', 6, 2, { linkGroupId: 'g' }), clip('a', 'a1', 7, 2, { linkGroupId: 'g' })] }))
  assert.equal(byId(result, 'v').linkGroupId, 'g')
  assert.equal(byId(result, 'a').startTime - byId(result, 'v').startTime, 1)
})

const between = (extra = {}) => ({ id: 'transition', kind: 'between', clipAId: 'a', clipBId: 'b', duration: 1, editPoint: 10, originalClipAEnd: 10, originalClipBStart: 10, originalClipADuration: 4, originalClipATrimEnd: 4, originalClipBTrimStart: 0, settings: { split: { clipA: 0.5, clipB: 0.5 } }, ...extra })

test('insert translates complete downstream transition relationship and absolute metadata', () => {
  const inputs = request({ clips: [clip('a', 'v1', 6, 4), clip('b', 'v1', 10, 4)], transitions: [between({ startTime: 9.5, endTime: 10.5 })] })
  const result = good(freezeDeep(inputs))
  assert.deepEqual(result.transitions[0], { ...inputs.transitions[0], startTime: 11.5, endTime: 12.5, editPoint: 12, originalClipAEnd: 12, originalClipBStart: 12 })
  assert.equal(result.transitions[0].originalClipATrimEnd, 4)
  assert.equal(result.transitions[0].originalClipADuration, 4)
})

test('legacy between transitions and edge transitions follow whole moves', () => {
  const legacy = between({ kind: undefined })
  const edge = { id: 'edge', kind: 'edge', clipId: 'a', edge: 'in', duration: 1 }
  const result = good(request({ clips: [clip('a', 'v1', 6, 4), clip('b', 'v1', 10, 4)], transitions: [legacy, edge] }))
  assert.equal(result.transitions[0].editPoint, 12)
  assert.deepEqual(result.transitions[1], edge)
})

test('transition ownership rejects partial edits and clip removal without deleting relationships', () => {
  for (const mode of ['insert', 'overwrite']) {
    rejected(request({ mode, clips: [clip('a', 'v1', 0, 10), clip('b', 'v1', 10, 4)], transitions: [between()] }), /transition relationship/)
  }
  rejected(request({ mode: 'overwrite', clips: [clip('a', 'v1', 4, 2)], transitions: [{ id: 'fade', kind: 'edge', clipId: 'a', edge: 'in', duration: 0.5 }] }), /transition relationship/)
})

test('touching transition windows is rejected even on a gap or exact boundary', () => {
  rejected(request({ clips: [clip('a', 'v2', 0, 3), clip('b', 'v2', 5, 3)], transitions: [between({ editPoint: 4, duration: 2 })] }), /transition relationship/)
  rejected(request({ clips: [clip('a', 'v2', 5, 2)], transitions: [{ id: 'edge', kind: 'edge', clipId: 'a', edge: 'in', duration: 1 }], startTime: 5, newClips: [clip('new-v', 'v1', 5, 2)] }), /transition relationship/)
})

test('overwrite and append preserve unrelated transitions on other tracks', () => {
  const transition = between({ editPoint: 4 })
  for (const mode of ['overwrite', 'append']) {
    const result = good(request({ mode, clips: [clip('a', 'v2', 0, 4), clip('b', 'v2', 4, 4)], transitions: [transition] }))
    assert.equal(result.transitions[0], transition)
  }
})

for (const reverse of [false, true]) {
  for (const mode of ['insert', 'overwrite']) {
    test(`${mode} preserves ${reverse ? 'reverse' : 'forward'} constant-speed/timebase source mapping`, () => {
      const original = clip('original', 'v1', 0, 8, { trimStart: 10, trimEnd: 18, sourceTimeScale: 0.5, sourceFps: 48, timelineFps: 24, speed: 2, reverse })
      const result = good(request({ mode, clips: [original] }))
      const right = byId(result, result.splitClipIds[0])
      const from = mode === 'insert' ? 4 : 6
      const sourceAt = (c, local) => c.reverse ? c.trimEnd - local * c.sourceTimeScale * c.speed : c.trimStart + local * c.sourceTimeScale * c.speed
      for (const local of [0, 0.5, 1]) assert.equal(sourceAt(right, local), sourceAt(original, from + local))
      assert.equal(right.sourceFps, 48)
      assert.equal(right.timelineFps, 24)
      assert.equal(right.reverse, reverse)
      assert.equal(right.speed, 2)
    })
  }
}

test('timebase fallback and absent trim bounds preserve source mapping', () => {
  const original = clip('v', 'v1', 0, 8, { sourceTimeScale: undefined, sourceFps: 48, timelineFps: 24, trimStart: 3, trimEnd: undefined, sourceDuration: undefined })
  const result = good(request({ clips: [original] }))
  assert.deepEqual([byId(result, 'v').trimStart, byId(result, 'v').trimEnd], [3, 5])
  const right = byId(result, result.splitClipIds[0])
  assert.deepEqual([right.trimStart, right.trimEnd], [5, 7])
})

test('slices preserve static metadata and clear render/RIFE caches without changing input data', () => {
  const original = clip('v', 'v1', 0, 8, { metadata: { owned: 'media/clip.mp4' }, url: 'blob:media', transform: { opacity: 80 }, adjustments: { exposure: 1 }, effects: [{ id: 'blur', type: 'gaussianBlur', settings: { amount: 2 } }], shapeMask: { type: 'ellipse', width: 30 }, keyframes: { opacity: [] }, cacheStatus: 'cached', cacheProgress: 100, cacheUrl: 'blob:cache', cachePath: 'cache/bake.mp4', cacheKind: 'full', cacheSignature: 'sig', opticalFlowCache: { path: 'cache/rife.mp4', url: 'blob:rife', status: 'ready' } })
  const inputs = freezeDeep(request({ clips: [original] }))
  const before = structuredClone(inputs)
  const result = good(inputs)
  assert.deepEqual(inputs, before)
  for (const piece of result.clips.filter((c) => c.id !== 'new-v')) {
    assert.deepEqual(piece.metadata, original.metadata)
    assert.deepEqual(piece.effects, original.effects)
    assert.deepEqual(piece.shapeMask, original.shapeMask)
    assert.equal(piece.url, original.url)
    assert.equal(piece.cacheStatus, 'none')
    for (const field of ['cacheUrl', 'cachePath', 'cacheKind', 'cacheSignature']) assert.equal(piece[field], null)
    assert.equal(piece.opticalFlowCache, undefined)
  }
})

test('whole downstream moves retain caches and complex clip-local metadata', () => {
  const original = clip('v', 'v1', 8, 8, { cacheUrl: 'blob:bake', cachePath: 'cache/bake.mp4', opticalFlowCache: { path: 'cache/rife.mp4' }, keyframes: { speed: [{ time: 0, value: 1 }] }, effects: [{ type: 'mask', maskAssetId: 'mask' }] })
  const moved = byId(good(request({ clips: [original] })), 'v')
  assert.equal(moved.cacheUrl, original.cacheUrl)
  assert.equal(moved.opticalFlowCache, original.opticalFlowCache)
  assert.equal(moved.keyframes, original.keyframes)
})

for (const extra of [
  { keyframes: { speed: [{ time: 0, value: 1 }] } },
  { keyframes: { opacity: [{ time: 0, value: 50 }] } },
  { shapeMask: { keyframes: [{ time: 0, width: 10 }] } },
  { effects: [{ type: 'mask', maskAssetId: 'mask' }] },
  { effects: [{ type: 'cameraShake', enabled: true }] },
  { effects: [{ type: 'filmGrain', enabled: true }] },
  { effects: [{ type: 'glslDigitalGlitch', enabled: true }] },
  { type: 'captions', captions: { cues: [] } },
  { type: 'text', titleAnimation: { presetId: 'fade' } },
]) {
  test(`unsupported partial timing rejects: ${JSON.stringify(extra)}`, () => {
    rejected(request({ clips: [clip('complex', 'v1', 0, 8, extra)] }), /animated, masked, or live-caption/)
    assert.equal(good(request({ mode: 'overwrite', startTime: 0, duration: 8, newClips: [clip('new-v', 'v1', 0, 8)], clips: [clip('complex', 'v1', 0, 8, extra)] })).removedClipIds[0], 'complex')
  })
}

test('audio fades are retained only on true original edges without restarting or stretching', () => {
  const original = clip('a', 'a1', 0, 10, { fadeIn: 2, fadeOut: 3, gainDb: -4 })
  for (const mode of ['insert', 'overwrite']) {
    const result = good(request({ mode, clips: [original], newClips: [clip('new-a', 'a1', 4, 2)] }))
    const left = byId(result, 'a')
    const right = byId(result, result.splitClipIds[0])
    assert.deepEqual([left.fadeIn, left.fadeOut, left.gainDb], [2, 0, -4])
    assert.deepEqual([right.fadeIn, right.fadeOut, right.gainDb], [0, 3, -4])
  }
})

test('partial edits through audio fades reject, including retained tail/head pieces', () => {
  for (const [startTime, duration, fadeIn, fadeOut] of [[1, 2, 2, 0], [8, 1, 0, 3], [0, 1, 2, 0], [9, 2, 0, 3]]) {
    rejected(request({ mode: 'overwrite', startTime, duration, clips: [clip('a', 'a1', 0, 10, { fadeIn, fadeOut })], newClips: [clip('new-a', 'a1', startTime, duration)] }), /audio fade/)
  }
})

test('source limits, frozen legacy timing, and subframe survivors reject', () => {
  rejected(request({ clips: [clip('v', 'v1', 0, 8, { trimEnd: 3 })] }), /source timing/)
  rejected(request({ clips: [clip('v', 'v1', 0, 8, { trimEnd: 8, sourceDuration: 6 })] }), /source timing/)
  rejected(request({ startTime: 0.01, clips: [clip('v', 'v1', 0, 8)], newClips: [clip('new-v', 'v1', 0.01, 2)] }), /less than one frame/)
})

test('extended static generators can split despite stale finite source or trim durations', () => {
  for (const type of ['image', 'text', 'shape', 'adjustment']) {
    const original = clip('static', 'v2', 0, 12, { type, trimEnd: 5, sourceDuration: 5 })
    const result = good(request({ clips: [original] }))
    assert.equal(byId(result, 'static').duration, 4)
    assert.equal(byId(result, result.splitClipIds[0]).duration, 8)
    assert.equal(byId(result, result.splitClipIds[0]).type, type)
  }
})

test('fractional frame timing stays exact rather than quantizing existing clip boundaries', () => {
  const fps = 30000 / 1001
  const startTime = 100 / fps
  const duration = 17 / fps
  const result = good(request({ fps, startTime, duration, clips: [clip('v', 'v1', 0, 200 / fps)], newClips: [clip('new-v', 'v1', startTime, duration)] }))
  assert.equal(byId(result, 'v').duration, startTime)
  assert.equal(byId(result, result.splitClipIds[0]).startTime, startTime + duration)
  assert.equal(byId(result, 'new-v').duration, duration)
})

test('one-frame edit and one-frame survivor are allowed', () => {
  const result = good(request({ startTime: 1 / 24, duration: 1 / 24, clips: [clip('v', 'v1', 0, 2 / 24)], newClips: [clip('new-v', 'v1', 1 / 24, 1 / 24)] }))
  assert.equal(result.clips.length, 3)
})

test('new clips need valid normal destinations, unique IDs/groups, and matching timing', () => {
  rejected(request({ newClips: [clip('new-v', 'captions', 4, 2)] }), /normal video or audio/)
  rejected(request({ newClips: [clip('new-v', 'missing', 4, 2)] }), /normal video or audio/)
  rejected(request({ newClips: [clip('new-v', 'v1', 4, 2, { type: 'audio' })] }), /normal video or audio/)
  rejected(request({ newClips: [clip('new-v', 'a1', 4, 2, { type: 'image' })] }), /normal video or audio/)
  rejected(request({ newClips: [clip('new-v', 'a1', 4, 2, { type: 'video' })] }), /normal video or audio/)
  rejected(request({ newClips: [clip('new-v', 'v1', 4, 2, { metadata: { captionScope: 'timeline' } })] }), /normal video or audio/)
  rejected(request({ newClips: [clip('new-v', 'v1', 4, 3)] }), /requested edit range/)
  rejected(request({ clips: [clip('new-v', 'v1', 0, 2)] }), /unique clip IDs/)
  rejected(request({ newClips: [clip('n1', 'v1', 4, 2), clip('n2', 'v1', 4, 2)] }), /one new clip/)
  rejected(request({ clips: [clip('v', 'v1', 0, 2, { linkGroupId: 'g' })], newClips: [clip('new-v', 'v1', 4, 2, { linkGroupId: 'g' })] }), /fresh linked group/)
})

test('empty or invalid requests return rejection rather than replacement timeline state', () => {
  for (const extra of [{ newClips: [] }, { mode: 'ripple' }, { startTime: -1 }, { duration: 0 }, { duration: NaN }, { duration: Infinity }, { startTime: Infinity }, { duration: 1 / 1000 }, { clips: null }]) {
    const result = planSourceTimelineEdit(request(extra))
    assert.equal(result.ok, false)
    assert.equal('clips' in result, false)
  }
  rejected(request({ clips: [clip('dup', 'v1', 0, 1), clip('dup', 'a1', 0, 1)] }), /invalid or duplicate/)
  rejected(request({ clips: [clip('v', 'missing', 0, 1)] }), /invalid or duplicate/)
  rejected(request({ transitions: [null] }), /invalid timeline transitions/)
})
