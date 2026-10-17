import test from 'node:test'
import assert from 'node:assert/strict'
import {
  apiNodeTypes,
  countPackSelection,
  dragMayCarryPack,
  findDroppedPack,
  initialPackSelection,
  isPackFileName,
  packErrorKey,
  shortList,
  summarizeWorkflowCheck,
} from './packImportPlan.mjs'

const pack = {
  workflows: [{ id: 'i0' }, { id: 'i1' }],
  templates: [{ id: 'i2' }],
  media: [{ id: 'i3', mediaType: 'image' }, { id: 'i4', mediaType: 'lut' }, { id: 'i5', mediaType: 'audio' }],
}

test('default selection skips media that cannot land without a project', () => {
  assert.deepEqual([...initialPackSelection(pack, { hasProject: true })], ['i0', 'i1', 'i2', 'i3', 'i4', 'i5'])
  assert.deepEqual([...initialPackSelection(pack, { hasProject: false })], ['i0', 'i1', 'i2', 'i4'])
})

test('counts by destination ignore media that cannot be imported now', () => {
  const all = new Set(['i0', 'i1', 'i2', 'i3', 'i4', 'i5'])
  assert.deepEqual(countPackSelection(pack, all, { hasProject: true }), { workflows: 2, templates: 1, assets: 2, luts: 1, total: 6 })
  assert.deepEqual(countPackSelection(pack, all, { hasProject: false }), { workflows: 2, templates: 1, assets: 0, luts: 1, total: 4 })
  assert.equal(countPackSelection(pack, new Set()).total, 0)
})

test('dependency summary: ready, missing, offline', () => {
  const objectInfo = { KSampler: {}, SaveVideo: {} }
  assert.deepEqual(summarizeWorkflowCheck({ nodeTypes: ['KSampler'], objectInfo }), { status: 'ready', missingNodes: [], missingModels: [] })
  assert.deepEqual(
    summarizeWorkflowCheck({ nodeTypes: ['KSampler', 'SeedanceChain'], objectInfo, models: [{ filename: 'a.safetensors' }, { filename: 'b.safetensors' }], diskResults: [{ exists: true }, { exists: false }] }),
    { status: 'missing', missingNodes: ['SeedanceChain'], missingModels: ['b.safetensors'] },
  )
  assert.equal(summarizeWorkflowCheck({ nodeTypes: ['X'], objectInfo: null }).status, 'offline')
  assert.equal(summarizeWorkflowCheck({ nodeTypes: [], objectInfo: null, models: [{ filename: 'm.gguf' }], diskResults: [{ exists: false }] }).status, 'missing')
})

test('drops and names', () => {
  assert.ok(isPackFileName('Kit.ZIP'))
  assert.ok(isPackFileName('noir.dspack'))
  assert.ok(!isPackFileName('clip.mp4'))
  const files = [{ name: 'a.mp4' }, { name: 'kit.zip' }]
  assert.equal(findDroppedPack({ files }).name, 'kit.zip')
  assert.equal(findDroppedPack({ files: [{ name: 'a.png' }] }), null)
  assert.ok(dragMayCarryPack({ items: [{ kind: 'file', type: 'application/x-zip-compressed' }] }))
  assert.ok(!dragMayCarryPack({ items: [{ kind: 'file', type: 'video/mp4' }] }))
})

test('small helpers', () => {
  assert.deepEqual(apiNodeTypes({ 1: { class_type: 'A' }, 2: { class_type: 'B' }, 3: { class_type: 'A' } }), ['A', 'B'])
  assert.equal(shortList(['a', 'b', 'c', 'd', 'e']), 'a, b, c +2')
  assert.equal(shortList(['a']), 'a')
  assert.equal(packErrorKey('ZIP_BOMB'), 'ZIP_BOMB')
  assert.equal(packErrorKey('WHATEVER'), 'generic')
})
