import assert from 'node:assert/strict'
import test from 'node:test'
import { runExportReadinessCheck, createExportReadinessChecker, resolveExportReadinessPath } from './exportReadiness.mjs'
import { buildExportReadinessPlan } from '../utils/exportReadiness.mjs'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() }
const file = (i = 0, patch = {}) => ({ clipId: `clip${i}`, name: `Clip ${i}`, time: i, kind: 'source',
  location: { path: `assets/${i}.mp4`, relative: true }, missingCode: 'missing-source', ...patch })
const plan = (files = [file()]) => ({ files, warnings: [], projectHandle: '/project', rangeStart: 0, rangeEnd: 10 })
const api = (exists = async () => true) => ({ pathJoin: async (...parts) => parts.join('/'), exists })

test('joins portable relative paths but preserves absolute Windows, UNC and POSIX source paths', async () => {
  assert.equal(await resolveExportReadinessPath({ path: 'assets\\a.mp4', relative: true }, '/project', api()), '/project/assets/a.mp4')
  for (const path of ['/media/a.mp4', 'C:\\Media\\a.mp4', '\\\\server\\share\\a.mp4']) {
    assert.equal(await resolveExportReadinessPath({ path, relative: false }, '/project', api()), path)
  }
  assert.equal(await resolveExportReadinessPath({ path: 'assets/a.mp4', relative: true }, null, api()), null)
  assert.equal(await resolveExportReadinessPath({ path: 'assets/a.mp4', relative: true }, { kind: 'directory' }, api()), null)
})

test('checks only existence, deduplicates repeated paths and reports missing/cache/mask roles accurately', async () => {
  const seen = []
  const bridge = api(async path => { seen.push(path); return !path.endsWith('missing.mp4') })
  bridge.getFileInfo = () => assert.fail('must not read metadata')
  bridge.getFileUrlDirect = () => assert.fail('must not open media')
  const files = [file(), file(1, { location: file().location }), file(2, {
    location: { path: 'cache/missing.mp4', relative: true }, kind: 'optical-flow', missingCode: 'missing-optical',
  }), file(3, { location: { path: 'mask/missing.mp4', relative: true }, kind: 'mask', missingCode: 'missing-mask' })]
  const input = plan(files), original = structuredClone(input)
  const result = await runExportReadinessCheck(input, { api: bridge })
  assert.equal(seen.length, 3)
  assert.equal(result.checkedFileCount, 3)
  assert.deepEqual(result.warnings.map(item => item.code), ['missing-optical', 'missing-mask'])
  assert.deepEqual(input, original)
})

test('missing bridge, unsupported project handles, throws and non-boolean IPC responses are unverified, not missing', async () => {
  for (const bridge of [undefined, {}, api(async () => { throw Error('IPC unavailable') }), api(async () => ({ success: true })),
    { ...api(), pathJoin: async () => { throw Error('cannot resolve') } }]) {
    const result = await runExportReadinessCheck(plan(), { api: bridge })
    assert.deepEqual(result.warnings.map(item => item.code), ['file-unverified'])
    assert.equal(result.unverifiedFileCount, 1)
  }
  const result = await runExportReadinessCheck({ ...plan(), projectHandle: null }, { api: api() })
  assert.deepEqual(result.warnings.map(item => item.code), ['file-unverified'])
})

test('a missing absolute record is not silently passed by a different project-relative copy', async () => {
  const input = buildExportReadinessPlan({ clips: [{ id: 'c', type: 'image', assetId: 'a', trackId: 'v', startTime: 0, duration: 1 }],
    tracks: [{ id: 'v', type: 'video' }], assets: [{ id: 'a', absolutePath: '/old/a.png', path: 'assets/a.png' }],
    projectHandle: '/project', rangeStart: 0, rangeEnd: 1, includeAudio: false })
  const seen = []
  const result = await runExportReadinessCheck(input, { api: api(async path => { seen.push(path); return path === '/project/assets/a.png' }) })
  assert.deepEqual(seen, ['/old/a.png'])
  assert.deepEqual(result.warnings.map(item => item.code), ['missing-source'])
})

test('many mask-frame failures group into one useful warning per clip and role', async () => {
  const files = Array.from({ length: 12 }, (_, i) => file(i, { clipId: 'same', time: 0, kind: 'mask', missingCode: 'missing-mask' }))
  const result = await runExportReadinessCheck(plan(files), { api: api(async () => false) })
  assert.equal(result.warnings.length, 1)
  assert.equal(result.warnings[0].occurrences, 12)
})

test('bounded workers never exceed four in-flight existence checks, even with a larger requested limit', async () => {
  let live = 0, max = 0, count = 0
  const pending = []
  const bridge = api(() => {
    live += 1; max = Math.max(max, live); count += 1
    const step = deferred(); pending.push(step)
    return step.promise.then(() => { live -= 1; return true })
  })
  const result = runExportReadinessCheck(plan(Array.from({ length: 13 }, (_, i) => file(i))), { api: bridge, concurrency: 99 })
  await flush()
  assert.equal(count, 4)
  while (count < 13 || live) {
    pending.splice(0).forEach(step => step.resolve())
    await flush()
  }
  assert.equal((await result).warnings.length, 0)
  assert.equal(max, 4)
})

test('abort resolves promptly, stops scheduling and discards in-flight results', async () => {
  const control = new AbortController(), gate = deferred()
  let count = 0
  const result = runExportReadinessCheck(plan(Array.from({ length: 20 }, (_, i) => file(i))), {
    api: api(() => { count += 1; return gate.promise }), signal: control.signal,
  })
  await flush()
  assert.equal(count, 4)
  control.abort()
  assert.equal(await result, null)
  gate.resolve(false)
  await flush()
  assert.equal(count, 4)
})

test('source/timeline context changes discard late results and stop further scheduling', async () => {
  let current = true, count = 0
  const gate = deferred()
  const result = runExportReadinessCheck(plan([file(), file(1), file(2)]), {
    api: api(() => { count += 1; return gate.promise }), concurrency: 1, isCurrent: () => current,
  })
  await flush(); current = false; gate.resolve(true)
  assert.equal(await result, null)
  assert.equal(count, 1)
})

test('a context observed stale cannot become valid again by restoring older state', async () => {
  let calls = 0
  const result = await runExportReadinessCheck(plan([file(), file(1)]), {
    api: api(), concurrency: 1, isCurrent: () => ++calls !== 3,
  })
  assert.equal(result, null)
  assert.equal(calls, 3)
})

test('Refresh supersedes a previous generation, and cleanup cancel prevents publishing', async () => {
  const gate = deferred(), seen = []
  const checker = createExportReadinessChecker({ api: api(path => {
    seen.push(path); return path.endsWith('0.mp4') ? gate.promise : Promise.resolve(true)
  }) })
  const old = checker.run(plan([file()]))
  await flush()
  const latest = checker.run(plan([file(1)]))
  assert.equal(await old, null)
  assert.deepEqual((await latest).warnings, [])
  gate.resolve(false); await flush()
  assert.equal(seen.length, 2)
  const pending = checker.run(plan([file(2)]))
  checker.cancel()
  assert.equal(await pending, null)
})

test('already cancelled/stale plans perform no bridge calls, and empty plans resolve without work', async () => {
  const controller = new AbortController(); controller.abort()
  const bridge = api(() => assert.fail('no exists calls expected'))
  assert.equal(await runExportReadinessCheck(plan(), { api: bridge, signal: controller.signal }), null)
  assert.equal(await runExportReadinessCheck(plan(), { api: bridge, isCurrent: () => false }), null)
  assert.deepEqual((await runExportReadinessCheck(plan([]), { api: bridge })).warnings, [])
})
