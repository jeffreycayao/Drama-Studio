import test from 'node:test'
import assert from 'node:assert/strict'
import { IDEA_PAD_TEMPLATES, applyIdeaPadTemplate } from './ideaPadTemplates.mjs'
import { createDefaultIdeaPadData, normalizeIdeaPadData } from '../types/ideaPad.js'
import { exportIdeaPadToScreenplay, getStoryOrder } from './ideaPad.mjs'

test('both requested templates exist', () => {
  const ids = IDEA_PAD_TEMPLATES.map((template) => template.id)
  assert.ok(ids.includes('three-act-short'))
  assert.ok(ids.includes('micro-drama-episode'))
})

for (const template of IDEA_PAD_TEMPLATES) {
  test(`${template.id}: every card and link survives normalization`, () => {
    const { pad, created } = applyIdeaPadTemplate(createDefaultIdeaPadData(), template.id)
    assert.equal(created.length, template.cards.length)
    assert.equal(pad.nodes.length, template.cards.length)
    assert.equal(pad.edges.length, template.links.length)
    assert.deepEqual(normalizeIdeaPadData(pad), pad)
  })

  test(`${template.id}: story cards come out in order and export`, () => {
    const { pad } = applyIdeaPadTemplate(createDefaultIdeaPadData(), template.id)
    const order = getStoryOrder(pad).map((node) => node.title)
    const storyTitles = template.cards.filter((card) => ['episode', 'beat', 'scene'].includes(card.kind)).map((card) => card.title)
    assert.deepEqual(order, storyTitles)
    const play = exportIdeaPadToScreenplay(pad, { title: 'Test' })
    assert.ok(play.scenes.length > 0)
  })
}

test('applying to a pad with cards places the template beside them', () => {
  const first = applyIdeaPadTemplate(createDefaultIdeaPadData(), 'three-act-short').pad
  const maxX = Math.max(...first.nodes.map((node) => node.position.x))
  const { pad, created } = applyIdeaPadTemplate(first, 'micro-drama-episode')
  assert.equal(pad.nodes.length, first.nodes.length + created.length)
  const added = pad.nodes.filter((node) => created.includes(node.id))
  assert.ok(added.every((node) => node.position.x > maxX))
  assert.equal(new Set(pad.nodes.map((node) => node.id)).size, pad.nodes.length)
})

test('an unknown template changes nothing', () => {
  const { pad, created } = applyIdeaPadTemplate(createDefaultIdeaPadData(), 'nope')
  assert.equal(created.length, 0)
  assert.equal(pad.nodes.length, 0)
})
