import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeIdeaPadData } from '../types/ideaPad.js'
import { addIdeaNode, connectIdeaNodes, exportIdeaPadToScreenplay, getStoryOrder } from './ideaPad.mjs'
import {
  addBoardCard, addColumn, addLane, boardStoryOrder, cardCast, cellCards, ensureBoard, moveCardToCell,
  moveColumn, removeColumn, removeLane, renameColumn, toggleCardCast, unplaceCard, unsortedCards,
} from './ideaBoard.mjs'

const empty = () => normalizeIdeaPadData({ version: 1, nodes: [], edges: [] })

test('a pad without a board gets three acts and a main plot', () => {
  const pad = ensureBoard(empty())
  assert.deepEqual(pad.board.columns.map((column) => column.id), ['act-1', 'act-2', 'act-3'])
  assert.equal(pad.board.lanes.length, 1)
  assert.deepEqual(ensureBoard(pad), pad, 'a pad that has a board keeps it')
})

test('cards added to cells read section by section', () => {
  let pad = ensureBoard(empty())
  const a = addBoardCard(pad, 'beat', 'act-2', 'main-plot', { title: 'Middle' }); pad = a.pad
  const b = addBoardCard(pad, 'scene', 'act-1', 'main-plot', { title: 'Start' }); pad = b.pad
  const c = addBoardCard(pad, 'beat', 'act-3', 'main-plot', { title: 'End' }); pad = c.pad
  assert.deepEqual(boardStoryOrder(pad).map((node) => node.title), ['Start', 'Middle', 'End'])
  assert.equal(b.node.heading, 'INT. LOCATION - DAY')
})

test('moving a card reorders its new cell and closes the gap in the old one', () => {
  let pad = ensureBoard(empty())
  const ids = []
  for (const title of ['One', 'Two', 'Three']) { const r = addBoardCard(pad, 'beat', 'act-1', 'main-plot', { title }); pad = r.pad; ids.push(r.node.id) }
  pad = moveCardToCell(pad, ids[2], 'act-1', 'main-plot', 0)
  assert.deepEqual(cellCards(pad, 'act-1', 'main-plot').map((n) => n.title), ['Three', 'One', 'Two'])
  pad = moveCardToCell(pad, ids[0], 'act-2', 'main-plot')
  assert.deepEqual(cellCards(pad, 'act-1', 'main-plot').map((n) => n.order), [1, 2])
  assert.deepEqual(cellCards(pad, 'act-2', 'main-plot').map((n) => n.title), ['One'])
  assert.deepEqual(moveCardToCell(pad, ids[0], 'nope', 'main-plot'), pad, 'an unknown section changes nothing')
})

test('plotlines interleave inside a section by position', () => {
  let pad = addLane(ensureBoard(empty()), 'Romance')
  const lane2 = pad.board.lanes[1].id
  pad = addBoardCard(pad, 'beat', 'act-1', 'main-plot', { title: 'A1' }).pad
  pad = addBoardCard(pad, 'beat', 'act-1', lane2, { title: 'R1' }).pad
  pad = addBoardCard(pad, 'beat', 'act-1', 'main-plot', { title: 'A2' }).pad
  assert.deepEqual(boardStoryOrder(pad).map((n) => n.title), ['A1', 'R1', 'A2'])
})

test('removing a section or plotline sends its cards to Unsorted, never deletes them', () => {
  let pad = ensureBoard(empty())
  pad = addBoardCard(pad, 'beat', 'act-3', 'main-plot', { title: 'Keep me' }).pad
  pad = removeColumn(pad, 'act-3')
  assert.equal(pad.board.columns.length, 2)
  assert.deepEqual(unsortedCards(pad).map((n) => n.title), ['Keep me'])
  assert.equal(removeLane(pad, 'main-plot').board.lanes.length, 1, 'the last plotline stays')
})

test('sections can be renamed, added and reordered', () => {
  let pad = addColumn(ensureBoard(empty()), 'Epilogue')
  pad = renameColumn(pad, 'act-1', 'Cold open')
  pad = moveColumn(pad, pad.board.columns.at(-1).id, -1)
  assert.deepEqual(pad.board.columns.map((c) => c.title), ['Cold open', 'Act 2 · Conflict', 'Epilogue', 'Act 3 · Resolution'])
})

test('older pads keep their linked order; placed cards come first', () => {
  let pad = empty()
  const first = addIdeaNode(pad, 'scene', { x: 0, y: 0 }, { title: 'Linked 1' }); pad = first.pad
  const second = addIdeaNode(pad, 'scene', { x: 500, y: 0 }, { title: 'Linked 2' }); pad = second.pad
  pad = connectIdeaNodes(pad, first.node.id, second.node.id)
  assert.deepEqual(getStoryOrder(pad).map((n) => n.title), ['Linked 1', 'Linked 2'])
  pad = ensureBoard(pad)
  assert.equal(unsortedCards(pad).length, 2)
  pad = moveCardToCell(pad, second.node.id, 'act-1', 'main-plot')
  assert.deepEqual(getStoryOrder(pad).map((n) => n.title), ['Linked 2', 'Linked 1'])
  pad = unplaceCard(pad, second.node.id)
  assert.equal(unsortedCards(pad).length, 2)
})

test('who is in a card: add and remove characters', () => {
  let pad = ensureBoard(empty())
  const hero = addIdeaNode(pad, 'character', { x: 0, y: 0 }, { title: 'Mia' }); pad = hero.pad
  const card = addBoardCard(pad, 'scene', 'act-1', 'main-plot'); pad = card.pad
  pad = toggleCardCast(pad, card.node.id, hero.node.id)
  assert.deepEqual(cardCast(pad, card.node.id), [hero.node.id])
  const play = exportIdeaPadToScreenplay(pad)
  assert.match(play.scenes[0].elements.at(-1).text, /MIA/)
  pad = toggleCardCast(pad, card.node.id, hero.node.id)
  assert.deepEqual(cardCast(pad, card.node.id), [])
})

test('a broken board in a saved project is dropped, cards survive', () => {
  const pad = normalizeIdeaPadData({ version: 1, nodes: [{ id: 'beat-1', kind: 'beat', title: 'x', column: 'gone', lane: 'gone', position: { x: 0, y: 0 } }], edges: [], board: { columns: [], lanes: [{ id: 'a', title: 'A' }] } })
  assert.equal(pad.board, undefined)
  assert.equal(pad.nodes.length, 1)
})
