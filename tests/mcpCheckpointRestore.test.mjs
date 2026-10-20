import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// Runs the unchanged restore handler from mcpActions.js against synthetic
// stores, like tests/audioAnalysisMcp.test.mjs.
const source = readFileSync(new URL('../src/services/mcpActions.js', import.meta.url), 'utf8')
const start = source.indexOf('async function handleRestoreProjectCheckpoint(payload = {}) {')
const end = source.indexOf('\nfunction ', start + 1)
assert.ok(start >= 0 && end > start)
const createHandler = Function('MCP_PROJECT_CHECKPOINTS', 'useProjectStore', 'useAssetsStore', 'useTimelineStore', 'safeClone',
  source.slice(start, end) + '\nreturn handleRestoreProjectCheckpoint')

function fixture(openProject) {
  const project = { handle: openProject, current: { name: openProject } }
  const checkpoint = (id, handle) => [id, {
    id,
    label: id,
    projectHandle: handle,
    currentTimelineId: 't1',
    project: { name: handle, timelines: [{ id: 't1', fps: 24 }] },
    assetsState: { assets: [], folders: [] },
  }]
  const checkpoints = new Map([checkpoint('cp-a', '/projects/A'), checkpoint('cp-b', '/projects/B'), checkpoint('cp-a2', '/projects/A')])
  const store = (state) => ({ getState: () => state, setState: (patch) => Object.assign(state, patch) })
  const projectState = { currentProjectHandle: openProject, currentProject: project.current, saveProject: async () => {} }
  const timelineState = { loadFromProject: () => {} }
  const handler = createHandler(checkpoints, store(projectState), store({}), store(timelineState), (value) => structuredClone(value))
  return { handler, projectState }
}

test('restoring a checkpoint from another project is refused and leaves the open project alone', async () => {
  const { handler, projectState } = fixture('/projects/B')
  await assert.rejects(handler({ checkpointId: 'cp-a', previewOnly: false }), /belongs to another project/)
  assert.equal(projectState.currentProjectHandle, '/projects/B')
  assert.deepEqual(projectState.currentProject, { name: '/projects/B' })
})

test('without an id, the latest checkpoint of the open project is used', async () => {
  const { handler } = fixture('/projects/B')
  assert.equal((await handler({})).checkpoint.id, 'cp-b')
  const other = fixture('/projects/A')
  assert.equal((await other.handler({})).checkpoint.id, 'cp-a2')
})

test('a checkpoint of the open project restores', async () => {
  const { handler, projectState } = fixture('/projects/A')
  const result = await handler({ checkpointId: 'cp-a', previewOnly: false })
  assert.equal(result.success, true)
  assert.equal(projectState.currentProjectHandle, '/projects/A')
})

test('a project with no checkpoints says so', async () => {
  const { handler } = fixture('/projects/C')
  await assert.rejects(handler({}), /No MCP project checkpoints exist for the open project/)
})
