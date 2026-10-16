import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeIdeaPadData, IDEA_FIGURES, IDEA_NODE_HELP, IDEA_NODE_KINDS } from '../types/ideaPad.js'
import { addIdeaNode, importScreenplayToIdeaPad, exportIdeaPadToScreenplay, buildExternalFountainPrompt } from './ideaPad.mjs'
import { parseFountain, toFountain } from './screenplayParser.mjs'

const SCRIPT = `Title: The Lost Twin
Author: Test

INT. MANOR KITCHEN - NIGHT

Rain against the window. ROSA scrubs a silver tray.

ROSA
(whispering)
He has my eyes.

DR. KANE
You should not be here.

EXT. GARDEN - DAWN

Rosa runs through the wet grass.

ROSA
Wait!

CUT TO:
`

test('a Fountain script becomes character and scene cards with links', () => {
  let pad = normalizeIdeaPadData({ version: 1, nodes: [], edges: [] })
  pad = addIdeaNode(pad, 'character', { x: 0, y: 0 }, { title: 'Rosa', role: 'protagonist' }).pad
  const play = parseFountain(SCRIPT)
  const { pad: next, created } = importScreenplayToIdeaPad(pad, play, { fileName: 'twin.fountain' })
  assert.deepEqual(created, { characters: 1, reusedCharacters: 1, scenes: 2, skippedScenes: 0 })
  const byKind = kind => next.nodes.filter(node => node.kind === kind)
  assert.deepEqual(byKind('character').map(node => [node.title, node.figure || null]), [['Rosa', null], ['Dr. Kane', 'person']])
  assert.deepEqual(byKind('scene').map(node => [node.title, node.heading, node.order]),
    [['Manor Kitchen', 'INT. MANOR KITCHEN - NIGHT', 1], ['Garden', 'EXT. GARDEN - DAWN', 2]])
  assert.equal(byKind('note')[0].title, 'Script: The Lost Twin')
  const label = (a, b) => next.edges.find(edge => edge.source === a && edge.target === b)?.label
  const [kitchen, garden] = byKind('scene').map(node => node.id)
  const [rosa, kane] = byKind('character').map(node => node.id)
  assert.equal(label(kitchen, garden), 'leads to')
  assert.equal(label(rosa, kitchen), 'appears in')
  assert.equal(label(rosa, garden), 'appears in')
  assert.equal(label(kane, kitchen), 'appears in')
  assert.equal(label(kane, garden), undefined)
  // New cards sit below the existing one, not on top of it.
  assert.ok(Math.min(...next.nodes.filter(node => node.id !== pad.nodes[0].id).map(node => node.position.y)) > 0)
})

test('imported scenes export with their dialogue intact', () => {
  const play = parseFountain(SCRIPT)
  const { pad } = importScreenplayToIdeaPad(normalizeIdeaPadData({ version: 1, nodes: [], edges: [] }), play)
  const exported = exportIdeaPadToScreenplay(pad)
  assert.deepEqual(exported.scenes.map(scene => scene.heading), ['INT. MANOR KITCHEN - NIGHT', 'EXT. GARDEN - DAWN'])
  assert.deepEqual(exported.scenes.map(scene => scene.elements), play.scenes.map(scene => scene.elements))
  const again = parseFountain(toFountain(exported))
  assert.deepEqual(again.characters.sort(), ['DR. KANE', 'ROSA'])
})

test('figures, help text and the scene script survive normalization', () => {
  const pad = normalizeIdeaPadData({ version: 1, nodes: [
    { id: 'c1', kind: 'character', title: 'A', body: '', position: { x: 0, y: 0 }, figure: 'woman' },
    { id: 'c2', kind: 'character', title: 'B', body: '', position: { x: 0, y: 0 }, figure: 'dragon' },
    { id: 's1', kind: 'scene', title: 'S', body: '', position: { x: 0, y: 0 }, fountain: 'ROSA\nHi.' },
    { id: 'n1', kind: 'note', title: 'N', body: '', position: { x: 0, y: 0 }, figure: 'man', fountain: 'x' },
  ], edges: [] })
  assert.equal(pad.nodes[0].figure, 'woman')
  assert.equal(pad.nodes[1].figure, undefined, 'unknown figures are dropped')
  assert.equal(pad.nodes[2].fountain, 'ROSA\nHi.')
  assert.equal(pad.nodes[3].figure, undefined)
  assert.equal(pad.nodes[3].fountain, undefined)
  assert.equal(IDEA_FIGURES.length, 7)
  for (const kind of IDEA_NODE_KINDS) assert.ok(IDEA_NODE_HELP[kind]?.length > 40, kind)
})

test('the external AI prompt asks for plain Fountain and carries the Idea Pad story', () => {
  let pad = normalizeIdeaPadData({ version: 1, nodes: [], edges: [] })
  pad = addIdeaNode(pad, 'character', { x: 0, y: 0 }, { title: 'Rosa', role: 'maid', want: 'the truth' }).pad
  const prompt = buildExternalFountainPrompt(pad, { brief: 'Episode 1 of a twin revenge drama', sceneCount: 6, title: 'The Lost Twin' })
  assert.match(prompt, /Fountain format/)
  assert.match(prompt, /No Markdown, no code fences/)
  assert.match(prompt, /INT\. MOTEL ROOM - NIGHT/)
  assert.match(prompt, /about 6 scenes/)
  assert.match(prompt, /Episode 1 of a twin revenge drama/)
  assert.match(prompt, /Rosa \(maid\); wants: the truth/)
  assert.match(buildExternalFountainPrompt(normalizeIdeaPadData(null)), /Idea Pad is empty/)
  assert.match(buildExternalFountainPrompt(pad, { sceneCount: 999 }), /about 60 scenes/)
})
