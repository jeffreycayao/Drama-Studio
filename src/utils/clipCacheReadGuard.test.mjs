import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  getClipCacheReadKey, createClipCacheReadRequest, isClipCacheReadCurrent,
  createClipSourceRequest, isClipSourceRequestCurrent,
} from './clipCacheReadGuard.mjs'

const clip = () => ({ id: 'shot', type: 'video', assetId: 'old', url: 'blob:old',
  startTime: 0, duration: 2, trimStart: 1, trimEnd: 3, sourceDuration: 4,
  sourceFps: 24, timelineFps: 24, sourceTimeScale: 1, speed: 1,
  cacheStatus: 'cached', cachePath: 'cache/old.webm', cacheKind: 'full', cacheSignature: 'old-signature' })
const timeline = value => ({ clips: [value], timelineSessionId: 1 })

test('disk read identity includes source, edit, cache and timeline session, not the resolved URL', () => {
  const original = clip()
  const request = createClipCacheReadRequest(original, 1, '/project')
  assert.equal(isClipCacheReadCurrent(request, timeline({ ...original, cacheUrl: 'blob:loaded', cacheProgress: 100 }), '/project'), true)
  for (const changes of [
    { assetId: 'new' }, { url: 'blob:new' }, { trimStart: 2 }, { trimEnd: 4 },
    { duration: 3 }, { sourceDuration: 7 }, { sourceFps: 60 }, { timelineFps: 30 },
    { sourceTimeScale: 0.5 }, { speed: 0.5 }, { reverse: true }, { frameSampling: 'optical-flow' },
    { cachePath: 'cache/new.webm' }, { cacheKind: 'mask' }, { cacheSignature: 'new-signature' },
    { cacheStatus: 'none' }, { cachePath: null },
  ]) assert.equal(isClipCacheReadCurrent(request, timeline({ ...original, ...changes }), '/project'), false, JSON.stringify(changes))
  assert.equal(isClipCacheReadCurrent(request, { ...timeline(original), timelineSessionId: 2 }, '/project'), false)
  assert.equal(isClipCacheReadCurrent(request, timeline(original), '/other'), false)
  assert.equal(isClipCacheReadCurrent(request, { ...timeline(original), clips: [original, original] }, '/project'), false)
  assert.equal(isClipCacheReadCurrent(request, { ...timeline(original), clips: [] }, '/project'), false)
  assert.equal(createClipCacheReadRequest(original, 1, null), null)
  assert.equal(getClipCacheReadKey({ ...original, cacheStatus: 'invalid' }, 1), null)
})

test('render jobs stay attached to their captured source and session', () => {
  const original = clip()
  const request = createClipSourceRequest(original, 1, '/project')
  assert.equal(isClipSourceRequestCurrent(request, timeline({ ...original, cacheStatus: 'rendering' }), '/project'), true)
  for (const changes of [{ assetId: 'new' }, { url: 'blob:new' }, { trimStart: 2 }, { type: 'image' }]) {
    assert.equal(isClipSourceRequestCurrent(request, timeline({ ...original, ...changes }), '/project'), false)
  }
  assert.equal(isClipSourceRequestCurrent(request, { ...timeline(original), timelineSessionId: 2 }, '/project'), false)
  assert.equal(isClipSourceRequestCurrent(request, timeline(original), '/other'), false)
})

// Exercise the actual async service body, replacing only its imported runtime
// boundaries. Deferred I/O proves old-source results cannot attach after a swap;
// no project directories, media or real Electron bridge are touched.
const serviceBody = readFileSync(new URL('../services/clipRenderCache.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '')
  .replace(/export /g, '')
  .replaceAll("await import('./fileSystem')", '({ getProjectFileUrl: resolveProjectFileUrl })')
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function harness({ initialHandle = '/project', exists, getUrl, render } = {}) {
  let state = timeline(clip())
  let handle = initialHandle
  const writes = []
  const methods = {
    setCacheStatus(...args) { writes.push(['status', ...args]); state = { ...state, clips: state.clips.map(c => c.id === args[0] ? { ...c, cacheStatus: args[1], cacheProgress: args[2] } : c) } },
    setCacheUrl(...args) { writes.push(['url', ...args]); state = { ...state, clips: state.clips.map(c => c.id === args[0] ? { ...c, cacheUrl: args[1], cachePath: args[2], cacheKind: args[3], cacheSignature: args[4], cacheStatus: 'cached' } : c) } },
  }
  const window = { electronAPI: { isElectron: true,
    pathJoin: async (...parts) => parts.join('/'), exists: exists || (async () => true), createDirectory: async () => {},
  } }
  const load = new Function('useTimelineStore', 'useProjectStore', 'window', 'resolveProjectFileUrl', 'exportTimeline', 'getClipBakeSignature',
    'createClipCacheReadRequest', 'isClipCacheReadCurrent', 'createClipSourceRequest', 'isClipSourceRequestCurrent',
    `${serviceBody}\nreturn { hydrateClipRenderCaches, renderClipToCache };`)
  const service = load({ getState: () => ({ ...state, ...methods }) },
    { getState: () => ({ currentProjectHandle: handle, getCurrentTimelineSettings: () => ({ width: 16, height: 16, fps: 24 }) }) },
    window, getUrl || (async () => 'blob:resolved'), render || (async () => {}), () => 'bake-signature',
    createClipCacheReadRequest, isClipCacheReadCurrent, createClipSourceRequest, isClipSourceRequestCurrent)
  return { ...service, writes, state: () => state, setHandle: value => { handle = value },
    change: patch => { state = { ...state, clips: state.clips.map(c => ({ ...c, ...patch })) } },
    setSession: value => { state = { ...state, timelineSessionId: value } },
  }
}

test('normal hydration retains full-bake metadata while resolving its URL', async () => {
  const h = harness()
  await h.hydrateClipRenderCaches('/project')
  assert.deepEqual(h.writes, [['url', 'shot', 'blob:resolved', 'cache/old.webm', 'full', 'old-signature']])
})

test('hydration supports project-load ordering before the new handle is published', async () => {
  const h = harness({ initialHandle: '/previous' })
  await h.hydrateClipRenderCaches('/project')
  assert.equal(h.writes.length, 1)
})

test('missing-file result cannot clear replacement cache state', async () => {
  const pending = deferred(), entered = deferred()
  const h = harness({ exists: async () => { entered.resolve(); return pending.promise } })
  const work = h.hydrateClipRenderCaches('/project')
  await entered.promise
  h.change({ assetId: 'new', url: 'blob:new', cacheStatus: 'none', cachePath: null })
  pending.resolve(false)
  await work
  assert.deepEqual(h.writes, [])
})

for (const scenario of ['replacement', 'cleared-cache', 'timeline-switch', 'project-switch', 'new-project-published']) {
  test(`delayed hydration URL guards ${scenario}`, async () => {
    const pending = deferred(), entered = deferred()
    const h = harness({ initialHandle: '/previous', getUrl: async () => { entered.resolve(); return pending.promise } })
    const work = h.hydrateClipRenderCaches('/project')
    await entered.promise
    if (scenario === 'replacement') h.change({ assetId: 'new', url: 'blob:new' })
    if (scenario === 'cleared-cache') h.change({ cacheStatus: 'none', cachePath: null })
    if (scenario === 'timeline-switch') h.setSession(2)
    if (scenario === 'project-switch') h.setHandle('/elsewhere')
    if (scenario === 'new-project-published') h.setHandle('/project')
    pending.resolve('blob:old-cache')
    await work
    assert.equal(h.writes.length, scenario === 'new-project-published' ? 1 : 0)
  })
}

test('normal render completion writes the current full bake once', async () => {
  const h = harness({ render: async (_, progress) => progress({ progress: 50 }) })
  const result = await h.renderClipToCache('shot')
  assert.equal(result.url, 'blob:resolved')
  assert.equal(h.writes.filter(write => write[0] === 'url').length, 1)
  assert.deepEqual(h.writes.at(-1).slice(3), [result.cachePath, 'full', 'bake-signature'])
})

for (const failure of [false, true]) {
  test(`old-source render ${failure ? 'failure' : 'completion'} and progress cannot touch replacement`, async () => {
    const pending = deferred(), entered = deferred()
    let progress
    const h = harness({ render: async (_, callback) => { progress = callback; entered.resolve(); return pending.promise } })
    const work = h.renderClipToCache('shot')
    await entered.promise
    h.change({ assetId: 'new', url: 'blob:new', cacheStatus: 'none', cachePath: null })
    const before = h.writes.length
    progress({ progress: 90 })
    if (failure) {
      pending.reject(new Error('old render failed'))
      await assert.rejects(work, /old render failed/)
    } else {
      pending.resolve()
      assert.equal(await work, null)
    }
    assert.equal(h.writes.length, before)
    assert.equal(h.state().clips[0].assetId, 'new')
  })
}
