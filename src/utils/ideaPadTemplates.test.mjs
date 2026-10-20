import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeIdeaPadData } from '../types/ideaPad.js'
import { getStoryOrder } from './ideaPad.mjs'
import { IDEA_PAD_TEMPLATES, buildIdeaPadTemplate } from './ideaPadTemplates.mjs'

test('every template survives a save and load unchanged', () => {
  for (const template of IDEA_PAD_TEMPLATES) {
    const pad = buildIdeaPadTemplate(template.id)
    assert.ok(pad.nodes.length > 0, template.id)
    assert.ok(pad.board, template.id)
    assert.deepEqual(normalizeIdeaPadData(JSON.parse(JSON.stringify(pad))), pad, template.id)
  }
})

test('three-act short reads act by act', () => {
  const pad = buildIdeaPadTemplate('three-act-short')
  const order = getStoryOrder(pad)
  assert.equal(order[0].title, 'Opening image')
  assert.equal(order.at(-1).title, 'Final image')
  assert.deepEqual(pad.board.columns.map((column) => column.id), ['act-1', 'act-2', 'act-3'])
  assert.equal(pad.nodes.filter((node) => node.kind === 'character').length, 2)
})

test('micro-drama episode opens on the hook and ends on the cliffhanger', () => {
  const pad = buildIdeaPadTemplate('micro-drama-episode')
  const order = getStoryOrder(pad)
  assert.equal(order[0].title, 'The hook')
  assert.equal(order.at(-1).title, 'Cliffhanger')
  assert.equal(pad.board.lanes.length, 3)
  assert.ok(pad.nodes.filter((node) => node.kind === 'beat').every((node) => node.column && node.lane))
  assert.ok(pad.edges.some((edge) => edge.label === 'loves'))
})

test('unknown template ids give nothing', () => {
  assert.equal(buildIdeaPadTemplate('nope'), null)
})
