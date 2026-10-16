import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeIdeaPadData } from '../types/ideaPad.js'
import { addIdeaNode, connectIdeaNodes, removeIdeaNodes, getStoryOrder, exportIdeaPadToScreenplay, buildIdeaAiPrompt, applyIdeaAiResponse, buildStoryContext } from './ideaPad.mjs'
import { toFountain, parseFountain } from './screenplayParser.mjs'

function storyPad() {
  let pad = normalizeIdeaPadData({ version: 1, nodes: [], edges: [] })
  const add = (kind, x, y, patch) => { const result = addIdeaNode(pad, kind, { x, y }, patch); pad = result.pad; return result.node.id }
  const maya = add('character', 0, 300, { title: 'Maya', role: 'protagonist', want: 'to get home', wound: 'abandoned as a child' })
  const danny = add('character', 0, 450, { title: 'Danny', role: 'ex' })
  add('arc', 0, -200, { title: 'Last Bus Home' })
  // Canvas order is deliberately wrong; links decide.
  const s2 = add('scene', 100, 0, { title: 'Parking lot', heading: 'EXT. PARKING LOT - NIGHT', body: 'A headlight flickers.' })
  const s1 = add('scene', 600, 0, { title: 'Motel', heading: 'int. motel room - night', body: 'Rain on the window.' })
  const beat = add('beat', 600, 150, { title: 'Phone buzzes', body: 'Unknown number' })
  const free = add('beat', 900, 0, { title: 'Bus arrives', body: 'Doors hiss open.' })
  pad = connectIdeaNodes(pad, s1, s2)
  pad = connectIdeaNodes(pad, s2, free)
  pad = connectIdeaNodes(pad, s1, beat, 'contains')
  pad = connectIdeaNodes(pad, maya, s1, 'appears in')
  pad = connectIdeaNodes(pad, maya, danny, 'hides from')
  return { pad, ids: { maya, danny, s1, s2, beat, free } }
}

test('normalizer drops invalid nodes, dangling edges, self-links and unsafe ids', () => {
  const pad = normalizeIdeaPadData({ version: 1, nodes: [
    { id: 'a', kind: 'scene', position: { x: 1, y: 2 }, title: 'A' }, { id: 'a', kind: 'beat' }, { id: '../x', kind: 'note' },
    { id: 'b', kind: 'villain' }, { id: 'c', kind: 'note', position: { x: 'x' }, title: 5 }],
  edges: [{ id: 'e1', source: 'a', target: 'c' }, { id: 'e2', source: 'a', target: 'a' }, { id: 'e3', source: 'a', target: 'zz' }] })
  assert.deepEqual(pad.nodes.map(node => node.id), ['a', 'c'])
  assert.deepEqual(pad.nodes[1].position, { x: 0, y: 0 })
  assert.equal(pad.nodes[1].title, '')
  assert.deepEqual(pad.edges, [{ id: 'e1', source: 'a', target: 'c', label: 'leads to' }])
  assert.deepEqual(normalizeIdeaPadData(null), { version: 1, nodes: [], edges: [] })
})

test('story order follows "leads to" links, not canvas position, and survives cycles', () => {
  const { pad, ids } = storyPad()
  assert.deepEqual(getStoryOrder(pad).map(node => node.id), [ids.s1, ids.s2, ids.free, ids.beat])
  const looped = connectIdeaNodes(pad, ids.free, ids.s1)
  assert.equal(getStoryOrder(looped).length, 4)
})

test('export: scenes with attached beats and cast, free beats as scenes, valid Fountain', () => {
  const { pad } = storyPad()
  const play = exportIdeaPadToScreenplay(pad)
  assert.equal(play.title, 'Last Bus Home')
  assert.deepEqual(play.scenes.map(scene => scene.heading), ['INT. MOTEL ROOM - NIGHT', 'EXT. PARKING LOT - NIGHT', 'BUS ARRIVES'])
  assert.deepEqual(play.scenes[0].elements.map(item => item.text), ['Rain on the window.', 'Phone buzzes: Unknown number', 'Featuring: MAYA.'])
  const fountain = toFountain(play)
  const reparsed = parseFountain(fountain)
  assert.deepEqual(reparsed.scenes.map(scene => scene.heading), ['INT. MOTEL ROOM - NIGHT', 'EXT. PARKING LOT - NIGHT', 'BUS ARRIVES'])
  assert.match(fountain, /^Title: Last Bus Home/)
})

test('removing a card removes its links', () => {
  const { pad, ids } = storyPad()
  const next = removeIdeaNodes(pad, [ids.s1])
  assert.ok(!next.edges.some(edge => edge.source === ids.s1 || edge.target === ids.s1))
})

test('AI prompts carry the story bible; replies become linked cards', () => {
  const { pad, ids } = storyPad()
  const context = buildStoryContext(pad, ids.maya)
  assert.match(context, /Maya \(protagonist\); wants: to get home; inner conflict: abandoned as a child/)
  assert.match(context, /Maya hides from Danny/)
  assert.match(buildIdeaAiPrompt('conflict', pad, ids.maya), /deepen the focus character/)
  const twists = applyIdeaAiResponse('twists', pad, ids.s1, 'Here you go: {"ideas":[{"title":"Danny is the driver","body":"He has been following her."},{"title":"","body":"x"},{"title":"Wrong motel"}]}')
  assert.equal(twists.ok, true)
  assert.equal(twists.created.length, 2)
  assert.ok(twists.pad.edges.some(edge => edge.source === ids.s1 && edge.label === 'twist'))
  const expanded = applyIdeaAiResponse('expand', pad, ids.beat, '```json\n{"heading":"int. bus - night","title":"On the bus","outline":"Maya sits at the back."}\n```')
  assert.equal(expanded.ok, true)
  const scene = expanded.pad.nodes.find(node => node.id === expanded.created[0])
  assert.equal(scene.kind, 'scene')
  assert.equal(scene.heading, 'INT. BUS - NIGHT')
  assert.equal(applyIdeaAiResponse('expand', pad, ids.beat, 'sorry').ok, false)
  assert.equal(applyIdeaAiResponse('twists', pad, 'missing', '{}').ok, false)
})
