import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const require = createRequire(import.meta.url)
const code = buildSync({
  stdin: { contents: `import assets from './src/stores/assetsStore'; import project from './src/stores/projectStore'; import timeline from './src/stores/timelineStore'; export { assets, project, timeline };`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)) },
  bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', external: ['react', 'zustand', 'zustand/*'],
}).outputFiles[0].text
const output = { exports: {} }
Function('require', 'module', 'exports', 'localStorage', code)(require, output, output.exports, { getItem: () => null, setItem() {}, removeItem() {} })
const { assets, project, timeline } = output.exports
const initial = { assets: assets.getState(), project: project.getState(), timeline: timeline.getState() }
const compound = (id, clips) => ({ id, type: 'compound', trackId: 'v', startTime: 0, duration: 4, trimStart: 0, trimEnd: 4, sourceDuration: 4,
  compound: { version: 1, document: { fps: 24, width: 1920, height: 1080, duration: 4,
    tracks: [{ id: 'v', type: 'video' }], transitions: [],
    clips: clips.map((clip, index) => ({ id: `${id}-child-${index}`, type: 'video', trackId: 'v', startTime: 0, duration: 4,
      trimStart: 0, trimEnd: 4, sourceDuration: 4, ...clip })),
  } } })
afterEach(() => {
  assets.setState(initial.assets, true)
  project.setState(initial.project, true)
  timeline.setState(initial.timeline, true)
})
const noAssetWrite = action => {
  const before = assets.getState()
  let writes = 0
  const stop = assets.subscribe(() => { writes++ })
  const result = action()
  stop()
  assert.equal(result.ok, false)
  assert.equal(assets.getState(), before)
  assert.equal(writes, 0)
}

test('all stores initialize together and direct removal keeps compound media without a write', () => {
  assets.setState({ assets: [{ id: 'protected' }, { id: 'ordinary' }] })
  timeline.setState({ clips: [compound('compound', [{ assetId: 'protected' }]), { assetId: 'ordinary' }] })
  noAssetWrite(() => assets.getState().removeAsset('protected'))
  assert.equal(assets.getState().removeAsset('ordinary').ok, true)
  assert.deepEqual(assets.getState().assets.map(asset => asset.id), ['protected'])
})

test('folder removal fails atomically when a nested folder contains a compound source', () => {
  assets.setState({ assets: [{ id: 'protected', folderId: 'child' }, { id: 'unused', folderId: 'parent' }], folders: [{ id: 'parent' }, { id: 'child', parentId: 'parent' }] })
  timeline.setState({ clips: [compound('compound', [{ effects: [{ settings: { maskAssetId: 'protected' } }] }])] })
  noAssetWrite(() => assets.getState().removeFolder('parent'))
  timeline.setState({ clips: [] })
  assert.equal(assets.getState().removeFolder('parent').ok, true)
  assert.equal(assets.getState().assets.length, 0)
  assert.equal(assets.getState().folders.length, 0)
})

test('guard sees other timelines and fresh child edits while Contents is open', () => {
  assets.setState({ assets: [{ id: 'other-source' }, { id: 'child-source' }, { id: 'sibling-source' }] })
  project.setState({ currentTimelineId: 'main', currentProject: { timelines: [{ id: 'main', clips: [] }, { id: 'other', clips: [compound('other', [{ assetId: 'other-source' }])] }] } })
  timeline.setState({ tracks: [{ id: 'v', type: 'video' }], clips: [compound('open', [{ assetId: 'child-source' }]), compound('sibling', [{ assetId: 'sibling-source' }])] })
  assert.equal(timeline.getState().openCompound('open').ok, true)
  for (const id of ['other-source', 'child-source', 'sibling-source']) noAssetWrite(() => assets.getState().removeAsset(id))
})
