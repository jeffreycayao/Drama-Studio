import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSfxIndex, searchSfx, listSfxCategories, parseSfxDragPayload, formatBytes } from './sfx.js'
import { validateSfxCatalogUrl, resolveSfxDropToAsset } from '../services/sfxManager.js'

const entry = (id, name, category, tags = [], subCategory = null) => ({ id, name, category, subCategory, tags, duration: 1, fileSize: 1000 })
const entries = [
  entry('door-1', 'Wooden Door Slam', 'Foley', ['door', 'slam', 'wood'], 'Doors'),
  entry('door-2', 'Car Door Close', 'Vehicles', ['car', 'door']),
  entry('step-1', 'Footsteps Gravel', 'Foley', ['footstep', 'walk'], 'Footsteps'),
  entry('boom-1', 'Cinematic Boom', 'Impacts', ['hit', 'trailer']),
  entry('whoosh', 'Fast Whoosh', 'Transitions', ['swish']),
]
const index = buildSfxIndex(entries)

test('every token must match; exact name words rank above tags and fuzzy matches', () => {
  // Same score (exact name word): the shorter name ranks first.
  assert.deepEqual(searchSfx(index, 'door').results.map(item => item.id), ['door-2', 'door-1'])
  assert.deepEqual(searchSfx(index, 'door slam').results.map(item => item.id), ['door-1'])
  assert.deepEqual(searchSfx(index, 'foot').results.map(item => item.id), ['step-1'], 'prefix')
  assert.deepEqual(searchSfx(index, 'ftstps').results.map(item => item.id), ['step-1'], 'subsequence')
  assert.deepEqual(searchSfx(index, 'dr slm').results.map(item => item.id), ['door-1'], 'two-letter abbreviations')
  assert.deepEqual(searchSfx(index, 'wsh').results.map(item => item.id), ['whoosh'])
  assert.deepEqual(searchSfx(index, 'swish').results.map(item => item.id), ['whoosh'], 'tag')
  assert.equal(searchSfx(index, '').total, entries.length)
  assert.equal(searchSfx(index, 'zzzz').total, 0)
})

test('category and subcategory filters, and the category tree', () => {
  assert.deepEqual(searchSfx(index, '', { category: 'Foley' }).results.map(item => item.id).sort(), ['door-1', 'step-1'])
  assert.deepEqual(searchSfx(index, '', { category: 'Foley', subCategory: 'Doors' }).results.map(item => item.id), ['door-1'])
  const tree = listSfxCategories(entries)
  assert.deepEqual(tree.map(node => node.name), ['Foley', 'Impacts', 'Transitions', 'Vehicles'])
  assert.deepEqual(tree[0].subCategories, [{ name: 'Doors', count: 1 }, { name: 'Footsteps', count: 1 }])
})

test('search over a 10k catalog stays fast', () => {
  const big = buildSfxIndex(Array.from({ length: 10000 }, (_, i) => entry(`id-${i}`, `Sound ${i} ${i % 2 ? 'impact' : 'ambience'}`, `Cat ${i % 20}`, ['tag'])))
  const started = performance.now()
  const result = searchSfx(big, 'impact sound')
  assert.equal(result.results.length, 200)
  assert.ok(performance.now() - started < 200)
})

test('drag payloads from other apps or with unsafe ids are rejected', () => {
  assert.deepEqual(parseSfxDragPayload(JSON.stringify({ id: 'door-1', name: 'Door', duration: 2 })), { id: 'door-1', name: 'Door', duration: 2 })
  assert.equal(parseSfxDragPayload('{"id":"../x"}'), null)
  assert.equal(parseSfxDragPayload('not json'), null)
  assert.equal(parseSfxDragPayload(JSON.stringify({ id: 'a', duration: -1 })).duration, 1)
  assert.equal(formatBytes(5.3e9), '5.30 GB')
})

test('catalog URLs: https only, no credentials, no Google Drive; empty disconnects', () => {
  assert.equal(validateSfxCatalogUrl('https://pub-x.r2.dev/sfx/sfx-catalog.json').ok, true)
  assert.equal(validateSfxCatalogUrl('https://huggingface.co/datasets/me/sfx/resolve/main/sfx-catalog.json').ok, true)
  assert.equal(validateSfxCatalogUrl('http://example.com/c.json').ok, false)
  assert.equal(validateSfxCatalogUrl('https://u:p@example.com/c.json').ok, false)
  assert.match(validateSfxCatalogUrl('https://drive.google.com/file/d/x').reason, /Google Drive/)
  assert.deepEqual(validateSfxCatalogUrl('  '), { ok: true, url: '' })
})

function fakeAssets(initial = []) {
  let state = { assets: initial, folders: [] }
  const store = { getState: () => ({ ...state,
    addFolder: folder => { const made = { id: 'f1', ...folder }; state = { ...state, folders: [...state.folders, made] }; return made },
    addAsset: asset => { const made = { id: `a${state.assets.length}`, ...asset }; state = { ...state, assets: [made, ...state.assets] }; return made },
  }) }
  return store
}
const fileSystem = { importAsset: async (project, file, category) => ({ name: 'boom.wav', path: `assets/${category}/boom.wav`, absolutePath: `${project}/assets/${category}/boom.wav`, duration: 1.5, isImported: true }),
  getAbsoluteFileUrl: async file => `file://${file}` }

test('a dropped sound is copied into the project once, into a Sound Effects folder', async () => {
  const store = fakeAssets()
  let resolves = 0
  const deps = { fileSystem, prefetch: async () => { resolves += 1; return { path: '/cache/boom.wav' } } }
  const asset = await resolveSfxDropToAsset({ id: 'boom-1', name: 'Cinematic Boom', duration: 1 }, { projectHandle: '/p', assetsStore: store, deps })
  assert.equal(asset.type, 'audio')
  assert.equal(asset.url, 'file:///p/assets/audio/boom.wav')
  assert.equal(asset.settings.sfx.id, 'boom-1')
  assert.equal(asset.folderId, 'f1')
  const again = await resolveSfxDropToAsset({ id: 'boom-1', name: 'Cinematic Boom' }, { projectHandle: '/p', assetsStore: store, deps })
  assert.equal(again, store.getState().assets[0])
  assert.equal(resolves, 1, 'reused, not downloaded or copied again')
})

test('a project switch during download discards the drop', async () => {
  let current = true
  const deps = { fileSystem, prefetch: async () => { current = false; return { path: '/cache/boom.wav' } } }
  await assert.rejects(resolveSfxDropToAsset({ id: 'boom-1', name: 'B' }, { projectHandle: '/p', assetsStore: fakeAssets(), deps, isCurrent: () => current }), /project changed/)
  await assert.rejects(resolveSfxDropToAsset({ id: 'boom-1' }, { projectHandle: null, assetsStore: fakeAssets(), deps }), /Open a project/)
})

test('prefetch shares only the in-flight request, so a cleared cache is re-resolved', async () => {
  const { prefetchSfx } = await import('../services/sfxManager.js')
  let calls = 0
  globalThis.window = { electronAPI: { sfx: { resolve: async (id) => { calls += 1; return { success: true, id, path: `/cache/${id}.wav` } } } } }
  try {
    const [a, b] = await Promise.all([prefetchSfx('boom'), prefetchSfx('boom')])
    assert.equal(a, b)
    assert.equal(calls, 1, 'concurrent drags share one request')
    await prefetchSfx('boom')
    assert.equal(calls, 2, 'a settled prefetch is not reused')
  } finally { delete globalThis.window }
})
