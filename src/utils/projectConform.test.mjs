import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildGenerationProvenanceRecord, getGenerationProvenance, getClipRenderMode, scaleHeroResolution,
  computeClipSourceRanges, planProjectConform, buildHeroSwaps,
} from './projectConform.mjs'
import { queueHeroRenders } from '../services/projectConformer.js'

const workflows = {
  'wan22-i2v': { label: 'WAN i2v', needsImage: true, outputType: 'video', runnable: true },
  'ltx23-t2v': { label: 'LTX t2v', needsImage: false, outputType: 'video', runnable: true },
  'z-image-turbo': { label: 'Z Image', needsImage: false, outputType: 'image', runnable: true },
}
const getWorkflowInfo = id => workflows[id] || null
const generation = (patch = {}) => buildGenerationProvenanceRecord({ workflowId: 'wan22-i2v', prompt: 'a red fox', negativePrompt: 'blur',
  seed: 1234, resolution: { width: 832, height: 480 }, duration: 5, fps: 16, inputAssetId: 'key', ...patch })
const draft = (id = 'draft', patch = {}) => ({ id, name: id, type: 'video', url: `blob:${id}`, duration: 5, fps: 16,
  isImported: true, prompt: 'a red fox', settings: { seed: 1234, duration: 5, fps: 16, generation: generation() }, ...patch })
const key = { id: 'key', type: 'image', url: 'blob:key' }
const clip = (id, patch = {}) => ({ id, name: id, type: 'video', trackId: 'v1', assetId: 'draft', startTime: 0, duration: 2,
  trimStart: 1, trimEnd: 3, sourceDuration: 5, sourceFps: 16, timelineFps: 24, sourceTimeScale: 1, speed: 1, ...patch })
const tracks = [{ id: 'v1', type: 'video' }, { id: 'a1', type: 'audio' }]

test('provenance records the replayable generation inputs only', () => {
  const record = buildGenerationProvenanceRecord({ workflowId: 'wan22-i2v', prompt: 'p', seed: 7, resolution: { width: 832, height: 480 },
    duration: 5, fps: 16, assetFieldIds: { image: 'key', '': 'x', other: 42 }, conform: { draftAssetId: 'd' }, mcpBatch: { requestedWorkflowId: '' } })
  assert.equal(record.workflowId, 'wan22-i2v')
  assert.deepEqual(record.assetFieldIds, { image: 'key' }, 'non-string ids are dropped, never coerced')
  assert.equal(record.renderMode, 'hero')
  assert.equal(record.conformOf, 'd')
  assert.equal(buildGenerationProvenanceRecord({ seed: 1.5 }).seed, null)
})

test('legacy generated assets keep prompt/seed but need a workflow; imported media is not generated', () => {
  const legacy = getGenerationProvenance({ isImported: true, prompt: 'p', settings: { seed: 5, resolution: '1280x720', duration: 5 } })
  assert.equal(legacy.legacy, true)
  assert.equal(legacy.workflowId, null)
  assert.deepEqual(legacy.resolution, { width: 1280, height: 720 })
  assert.equal(getGenerationProvenance({ isImported: true, name: 'phone.mp4', settings: {} }), null)
  assert.equal(getClipRenderMode({}, { settings: {} }), null)
  assert.equal(getClipRenderMode({}, draft()), 'draft')
  assert.equal(getClipRenderMode({ renderMode: 'hero' }, draft()), 'hero')
})

test('hero resolution scales, snaps to 16 and caps the long edge', () => {
  assert.deepEqual(scaleHeroResolution({ width: 832, height: 480 }, 1.5), { width: 1248, height: 720 })
  assert.deepEqual(scaleHeroResolution('1920x1080', 2, 3840), { width: 3840, height: 2160 })
  assert.deepEqual(scaleHeroResolution({ width: 2000, height: 1000 }, 2, 3840), { width: 3840, height: 1920 })
  assert.equal(scaleHeroResolution(null, 2), null)
})

test('visible range ignores trimmed handles; required range adds transition handles', () => {
  const a = clip('a', { startTime: 0, duration: 2, trimStart: 1, trimEnd: 3 })
  const b = clip('b', { startTime: 2, duration: 2, trimStart: 1, trimEnd: 3 })
  const transitions = [{ id: 't', clipAId: 'a', clipBId: 'b', duration: 0.5, editPoint: 2, settings: { alignment: 'center' } }]
  const ranges = computeClipSourceRanges(a, [a, b], transitions)
  assert.deepEqual(ranges.visible, { start: 1, end: 3 })
  assert.ok(Math.abs(ranges.required.end - 3.25) < 1e-9)
  assert.equal(ranges.required.start, 1)
  assert.equal(computeClipSourceRanges({ ...a, type: 'image' }).visible, null)
})

test('plan dedupes clips by draft asset and builds a full-duration hero job with the stored seed', () => {
  const clips = [clip('c1'), clip('c2', { startTime: 5, duration: 2.5, trimStart: 2, trimEnd: 4.5 })]
  const plan = planProjectConform({ clips, tracks, assets: [draft(), key], getWorkflowInfo })
  assert.equal(plan.entries.length, 1)
  const [entry] = plan.renderable
  assert.equal(entry.clips.length, 2)
  assert.deepEqual(entry.required, { start: 1, end: 4.5 })
  assert.deepEqual(entry.job, { workflowId: 'wan22-i2v', workflowLabel: 'WAN i2v', outputType: 'video', prompt: 'a red fox',
    negativePrompt: 'blur', seed: 1234, resolution: { width: 1248, height: 720 }, durationSeconds: 5, fps: 16,
    assetFieldIds: { image: 'key' }, promptLabel: 'Hero: draft', conform: { draftAssetId: 'draft' } })
})

test('blockers: missing keyframe, timeline-frame input, cast lock, multi-output, unknown workflow, legacy without override', () => {
  const run = (asset, { assets = [], ...extra } = {}) => planProjectConform({ clips: [clip('c1')], tracks, assets: [asset, ...assets], getWorkflowInfo, ...extra }).entries[0]
  assert.match(run(draft()).blockers.join(' '), /no longer in the project/)
  for (const [patch, pattern] of [[{ inputFromTimelineFrame: true }, /timeline frame/], [{ cast: { castId: 'x' } }, /Cast lock/],
    [{ workflowId: 'missing' }, /not available/]]) {
    assert.match(run(draft('draft', { settings: { generation: generation(patch) } }), { assets: [key] }).blockers.join(' '), pattern)
  }
  const multi = { ...draft(), settings: { generation: buildGenerationProvenanceRecord({ workflowId: 'wan22-i2v', prompt: 'p', seed: 1,
    resolution: { width: 64, height: 64 }, duration: 5, inputAssetId: 'key' }, '', { index: 1, count: 8 }) } }
  assert.match(run(multi, { assets: [key] }).blockers.join(' '), /several outputs/)
  const legacy = { ...draft(), settings: { seed: 3, duration: 5, resolution: '832x480' } }
  assert.match(run(legacy, { assets: [key] }).blockers.join(' '), /Choose a hero workflow/)
  const resolved = run(legacy, { assets: [key], workflowOverrides: { draft: 'ltx23-t2v' } })
  assert.equal(resolved.status, 'ready-to-render')
  assert.equal(resolved.job.workflowId, 'ltx23-t2v')
})

test('rendering and ready-to-swap states come from the queue and the imported hero asset', () => {
  const assets = [draft(), key]
  const rendering = planProjectConform({ clips: [clip('c1')], tracks, assets, getWorkflowInfo,
    queueJobs: [{ status: 'running', conformDraftAssetId: 'draft' }, { status: 'done', conformDraftAssetId: 'other' }] })
  assert.equal(rendering.rendering.length, 1)
  const hero = { id: 'hero', type: 'video', url: 'blob:hero', duration: 5, fps: 24,
    settings: { generation: generation({ conform: { draftAssetId: 'draft' } }) } }
  const ready = planProjectConform({ clips: [clip('c1')], tracks, assets: [...assets, hero], getWorkflowInfo })
  assert.equal(ready.swappable[0].heroAsset, hero)
  assert.deepEqual(buildHeroSwaps(ready, [clip('c1'), clip('other', { assetId: 'x' })]), [{ clipId: 'c1', draftAssetId: 'draft', asset: hero }])
  const short = { ...hero, duration: 2 }
  assert.match(planProjectConform({ clips: [clip('c1')], tracks, assets: [...assets, short], getWorkflowInfo }).entries[0].blockers.join(' '), /needs 3.00 s/)
})

test('hero clips, captions tracks, audio and non-generated media are not drafts', () => {
  const plan = planProjectConform({ clips: [clip('h', { renderMode: 'hero' }), clip('cap', { trackId: 'cap' }),
    clip('own', { assetId: 'own' })], tracks: [...tracks, { id: 'cap', type: 'video', role: 'captions' }],
  assets: [draft(), key, { id: 'own', type: 'video', settings: {} }], getWorkflowInfo })
  assert.equal(plan.entries.length, 0)
  assert.equal(plan.heroClipCount, 1)
})

test('queueing sends batches of 24 through the Generate bridge and never sends blocked entries', async () => {
  const calls = []
  const entries = Array.from({ length: 30 }, (_, index) => ({ status: 'ready-to-render', job: { workflowId: 'ltx23-t2v', prompt: `p${index}`,
    seed: index, resolution: { width: 64, height: 64 }, durationSeconds: 5, fps: 24, assetFieldIds: {}, conform: { draftAssetId: `d${index}` } } }))
  entries.push({ status: 'blocked', job: null })
  const result = await queueHeroRenders(entries, { runner: async (action, payload) => {
    calls.push([action, payload.jobs.length])
    return { jobs: payload.jobs.map((job, index) => ({ id: `${payload.batchId}-${index}` })) }
  } })
  assert.deepEqual(calls, [['queue_prompt_generation_batch', 24], ['queue_prompt_generation_batch', 6]])
  assert.equal(result.queuedCount, 30)
  await assert.rejects(queueHeroRenders([{ status: 'blocked' }], { runner: async () => ({}) }), /No draft clips/)
})

test('the newest hero render wins: by createdAt, else by bin order (new assets are prepended)', () => {
  const hero = (id, createdAt) => ({ id, type: 'video', url: `blob:${id}`, duration: 5, fps: 24, ...(createdAt ? { createdAt } : {}),
    settings: { generation: generation({ conform: { draftAssetId: 'draft' } }) } })
  const byTime = planProjectConform({ clips: [clip('c1')], tracks, getWorkflowInfo,
    assets: [hero('old', '2026-10-01T00:00:00Z'), hero('new', '2026-10-02T00:00:00Z'), draft(), key] })
  assert.equal(byTime.swappable[0].heroAsset.id, 'new')
  const byOrder = planProjectConform({ clips: [clip('c1')], tracks, getWorkflowInfo, assets: [hero('newest'), hero('older'), draft(), key] })
  assert.equal(byOrder.swappable[0].heroAsset.id, 'newest')
})
