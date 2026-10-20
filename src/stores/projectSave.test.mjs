// Saving the project while the user keeps editing (audit findings 1 and 2):
// edits made while a save waits for the disk must stay unsaved and in memory.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const require = createRequire(import.meta.url)
// One bundle, so the stores and the dirty tracker share their state.
const code = buildSync({
  stdin: {
    contents: [
      "export { default as useProjectStore } from './projectStore.js'",
      "export { useTimelineStore } from './timelineStore.js'",
      "export { useAssetsStore } from './assetsStore.js'",
      "export * from '../services/projectDirtyTracker.js'",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('.', import.meta.url)),
    loader: 'js',
  },
  bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'zustand', 'zustand/*'],
  loader: { '.js': 'jsx' }, logLevel: 'silent',
}).outputFiles[0].text

const writes = []
let pathJoinGate = null
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true } }
window.electronAPI = {
  isElectron: true,
  pathJoin: async (...parts) => { if (pathJoinGate) await pathJoinGate; return parts.join('/') },
  writeFile: async (filePath, data) => { writes.push({ filePath, data }); return { success: true } },
  createDirectory: async () => ({ success: true }),
  listDirectory: async () => ({ success: true, items: [] }),
}
const storage = { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.localStorage = storage
const module = { exports: {} }
Function('require', 'module', 'exports', 'localStorage', 'window', code)(require, module, module.exports, storage, window)
const { useProjectStore, useTimelineStore, useAssetsStore, attachProjectDirtyWatchers, isProjectDirty, markProjectClean } = module.exports
attachProjectDirtyWatchers({ timelineStore: useTimelineStore, assetsStore: useAssetsStore, projectStore: useProjectStore })

const projectFile = () => JSON.parse(writes.filter((w) => w.filePath.endsWith('project.comfystudio')).at(-1).data)
const clipIds = () => useTimelineStore.getState().clips.map((clip) => clip.id)

function openProject() {
  useProjectStore.setState({
    currentProjectHandle: 'C:/Projects/Demo',
    currentProject: { name: 'Demo', timelines: [{ id: 't1', name: 'Timeline 1' }] },
    currentTimelineId: 't1',
    recentProjects: [],
  })
  useTimelineStore.setState({ clips: [] })
  markProjectClean()
}

test('edits made while a save is writing stay unsaved and are not overwritten', async () => {
  openProject()
  useTimelineStore.setState({ clips: [{ id: 'a' }] })
  assert.equal(isProjectDirty(), true)

  let open
  pathJoinGate = new Promise((resolve) => { open = resolve })
  const saving = useProjectStore.getState().saveProject({}, { thumbnail: false })
  // While the save waits for the disk: a new clip, and a new timeline.
  useTimelineStore.setState({ clips: [{ id: 'a' }, { id: 'b' }] })
  useProjectStore.setState((s) => ({ currentProject: { ...s.currentProject, timelines: [...s.currentProject.timelines, { id: 't2', name: 'Timeline 2' }] } }))
  open()
  pathJoinGate = null
  assert.equal(await saving, true)

  assert.deepEqual(projectFile().timelines[0].clips.map((c) => c.id), ['a'], 'the file holds what was gathered')
  assert.equal(isProjectDirty(), true, 'the later edits are still unsaved')
  assert.deepEqual(useProjectStore.getState().currentProject.timelines.map((t) => t.id), ['t1', 't2'], 'the new timeline was not overwritten')
  assert.deepEqual(clipIds(), ['a', 'b'])

  assert.equal(await useProjectStore.getState().saveProject({}, { thumbnail: false }), true)
  assert.equal(isProjectDirty(), false)
  const saved = projectFile()
  assert.deepEqual(saved.timelines.map((t) => t.id), ['t1', 't2'])
  assert.deepEqual(saved.timelines[0].clips.map((c) => c.id), ['a', 'b'])
})

test('closing the project while a save writes leaves it closed', async () => {
  openProject()
  useTimelineStore.setState({ clips: [{ id: 'c' }] })
  let open
  pathJoinGate = new Promise((resolve) => { open = resolve })
  const saving = useProjectStore.getState().saveProject({}, { thumbnail: false })
  useProjectStore.setState({ currentProject: null, currentProjectHandle: null, currentTimelineId: null })
  open()
  pathJoinGate = null
  await saving
  assert.equal(useProjectStore.getState().currentProject, null, 'no half-project appears')
  assert.equal(useProjectStore.getState().currentProjectHandle, null)
})

test('backups are spaced out, so the 10 kept cover more than a few minutes', async () => {
  openProject()
  useProjectStore.setState({ currentProjectHandle: 'C:/Projects/Backups' })
  const backups = () => writes.filter((w) => w.filePath.startsWith('C:/Projects/Backups/autosave/')).length
  for (let i = 0; i < 4; i += 1) {
    useTimelineStore.setState({ clips: [{ id: `s${i}` }] })
    assert.equal(await useProjectStore.getState().saveProject({}, { thumbnail: false }), true)
  }
  assert.equal(writes.filter((w) => w.filePath === 'C:/Projects/Backups/project.comfystudio').length, 4, 'every save writes the project')
  assert.equal(backups(), 1, 'but only one backup within five minutes')
})

test('a save with nothing changed in the meantime leaves the project clean', async () => {
  openProject()
  useTimelineStore.setState({ clips: [{ id: 'x' }] })
  assert.equal(await useProjectStore.getState().saveProject({}, { thumbnail: false }), true)
  assert.equal(isProjectDirty(), false)
  assert.deepEqual(projectFile().timelines[0].clips.map((c) => c.id), ['x'])
})
