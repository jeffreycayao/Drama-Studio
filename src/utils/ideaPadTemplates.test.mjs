import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeIdeaPadData } from '../types/ideaPad.js'
import { getStoryOrder } from './ideaPad.mjs'
import { IDEA_PAD_TEMPLATES, buildIdeaPadTemplate } from './ideaPadTemplates.mjs'

test('every template survives a save and load unchanged', () => {
  for (const template of IDEA_PAD_TEMPLATES) {
    const pad = buildIdeaPadTemplate(template.id)
    assert.ok(pad.nodes.length > 0, template.id)
    assert.deepEqual(normalizeIdeaPadData(JSON.parse(JSON.stringify(pad))), pad, template.id)
  }
})

test('three-act short reads in act order', () => {
  const pad = buildIdeaPadTemplate('three-act-short')
  const titles = getStoryOrder(pad).map((node) => node.title)
  assert.equal(titles[0], 'Act 1 · Opening image')
  assert.equal(titles.at(-1), 'Act 3 · Final image')
  assert.equal(pad.nodes.filter((node) => node.kind === 'character').length, 2)
})

test('micro-drama episode starts with the episode and ends on the cliffhanger', () => {
  const pad = buildIdeaPadTemplate('micro-drama-episode')
  const order = getStoryOrder(pad)
  assert.equal(order[0].kind, 'episode')
  assert.equal(order.at(-1).title, 'Cliffhanger')
  assert.ok(pad.edges.some((edge) => edge.label === 'loves'))
})

test('unknown template ids give nothing', () => {
  assert.equal(buildIdeaPadTemplate('nope'), null)
})
