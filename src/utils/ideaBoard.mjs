/**
 * Idea Pad Story Board: the structured view of a story, the way writers'
 * plotting tools lay it out. Columns are story sections (acts, episodes),
 * rows are plotlines (main plot, subplot, a character's arc), and beat and
 * scene cards sit in the cells. Reading the board left to right is the
 * story order. Pure functions over the Idea Pad data (src/types/ideaPad.js);
 * every function returns a new, normalized pad.
 */
import { normalizeIdeaPadData, IDEA_NODE_LABELS } from '../types/ideaPad.js'

/** Card kinds that live on the board. Characters, arcs and notes stay off it. */
export const BOARD_KINDS = Object.freeze(['beat', 'scene', 'episode'])

export const LANE_COLORS = Object.freeze(['#d5fa00', '#6cc5c9', '#f2b84b', '#f08a73', '#b7aaf0', '#8fd07a'])

export const DEFAULT_IDEA_BOARD = Object.freeze({
  columns: [{ id: 'act-1', title: 'Act 1 · Setup' }, { id: 'act-2', title: 'Act 2 · Conflict' }, { id: 'act-3', title: 'Act 3 · Resolution' }],
  lanes: [{ id: 'main-plot', title: 'Main plot', color: LANE_COLORS[0] }],
})

const isBoardCard = (node) => BOARD_KINDS.includes(node.kind)

function uniqueId(prefix, taken) {
  for (let n = taken.size + 1; ; n += 1) {
    const id = `${prefix}-${n}`
    if (!taken.has(id)) return id
  }
}

const allIds = (pad) => new Set([
  ...pad.nodes.map((node) => node.id),
  ...pad.edges.map((edge) => edge.id),
  ...(pad.board?.columns || []).map((column) => column.id),
  ...(pad.board?.lanes || []).map((lane) => lane.id),
])

/** The pad with a board (the default three acts and one plotline if it had none). */
export function ensureBoard(input) {
  const pad = normalizeIdeaPadData(input)
  if (pad.board) return pad
  return normalizeIdeaPadData({ ...pad, board: { columns: DEFAULT_IDEA_BOARD.columns.map((c) => ({ ...c })), lanes: DEFAULT_IDEA_BOARD.lanes.map((l) => ({ ...l })) } })
}

/** Is this card placed in a real cell of the board? */
export function isPlaced(pad, node) {
  const board = pad.board
  return Boolean(board && node.column && node.lane
    && board.columns.some((column) => column.id === node.column)
    && board.lanes.some((lane) => lane.id === node.lane))
}

const byOrder = (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.position.x - b.position.x || a.position.y - b.position.y

/** Cards in one cell, in order. */
export function cellCards(input, columnId, laneId) {
  const pad = normalizeIdeaPadData(input)
  return pad.nodes.filter((node) => isBoardCard(node) && node.column === columnId && node.lane === laneId).sort(byOrder)
}

/** Story cards not on the board yet (older pads, imports, AI cards). */
export function unsortedCards(input) {
  const pad = normalizeIdeaPadData(input)
  return pad.nodes.filter((node) => isBoardCard(node) && !isPlaced(pad, node)).sort(byOrder)
}

/** Renumber `order` inside one cell so it reads 1, 2, 3… */
function renumberCell(nodes, columnId, laneId) {
  const inCell = nodes.filter((node) => isBoardCard(node) && node.column === columnId && node.lane === laneId).sort(byOrder)
  const orderById = new Map(inCell.map((node, index) => [node.id, index + 1]))
  return nodes.map((node) => (orderById.has(node.id) ? { ...node, order: orderById.get(node.id) } : node))
}

/**
 * Put a card in a cell at `index` (0 = first; past the end = last). Moving
 * within the same cell reorders it. Unknown cells or cards change nothing.
 */
export function moveCardToCell(input, nodeId, columnId, laneId, index = Infinity) {
  const pad = ensureBoard(input)
  const node = pad.nodes.find((item) => item.id === nodeId)
  if (!node || !isBoardCard(node)) return pad
  if (!pad.board.columns.some((c) => c.id === columnId) || !pad.board.lanes.some((l) => l.id === laneId)) return pad
  const from = { column: node.column, lane: node.lane }
  const others = cellCards(pad, columnId, laneId).filter((item) => item.id !== nodeId)
  const at = Math.max(0, Math.min(Number.isFinite(index) ? index : others.length, others.length))
  const ordered = [...others.slice(0, at), node, ...others.slice(at)]
  const orderById = new Map(ordered.map((item, position) => [item.id, position + 1]))
  let nodes = pad.nodes.map((item) => (item.id === nodeId
    ? { ...item, column: columnId, lane: laneId, order: orderById.get(item.id) }
    : orderById.has(item.id) ? { ...item, order: orderById.get(item.id) } : item))
  if (from.column && from.lane && (from.column !== columnId || from.lane !== laneId)) nodes = renumberCell(nodes, from.column, from.lane)
  return normalizeIdeaPadData({ ...pad, nodes })
}

/** Add a new beat or scene at the end of a cell. Returns { pad, node }. */
export function addBoardCard(input, kind, columnId, laneId, patch = {}) {
  const pad = ensureBoard(input)
  const kindOk = BOARD_KINDS.includes(kind) ? kind : 'beat'
  const taken = allIds(pad)
  const id = uniqueId(kindOk, taken)
  const columnIndex = Math.max(0, pad.board.columns.findIndex((c) => c.id === columnId))
  const count = cellCards(pad, columnId, laneId).length
  const node = {
    id, kind: kindOk, column: columnId, lane: laneId, order: count + 1,
    // A sensible spot on the relationship map too.
    position: { x: columnIndex * 300 + count * 20, y: 400 + count * 40 },
    title: patch.title ?? `New ${IDEA_NODE_LABELS[kindOk].toLowerCase()}`,
    body: patch.body ?? '',
    ...(kindOk === 'scene' ? { heading: patch.heading ?? 'INT. LOCATION - DAY' } : {}),
  }
  const next = normalizeIdeaPadData({ ...pad, nodes: [...pad.nodes, node] })
  return { pad: next, node: next.nodes.find((item) => item.id === id) }
}

/** Remove a card from the board (it goes back to Unsorted, nothing is deleted). */
export function unplaceCard(input, nodeId) {
  const pad = normalizeIdeaPadData(input)
  const node = pad.nodes.find((item) => item.id === nodeId)
  if (!node) return pad
  const nodes = pad.nodes.map((item) => {
    if (item.id !== nodeId) return item
    const { column: _column, lane: _lane, ...rest } = item
    return rest
  })
  return normalizeIdeaPadData({ ...pad, nodes: node.column && node.lane ? renumberCell(nodes, node.column, node.lane) : nodes })
}

/* ---------- sections (columns) and plotlines (rows) ---------- */

export function addColumn(input, title = '') {
  const pad = ensureBoard(input)
  const id = uniqueId('section', allIds(pad))
  const columns = [...pad.board.columns, { id, title: title.trim() || `Section ${pad.board.columns.length + 1}` }]
  return normalizeIdeaPadData({ ...pad, board: { ...pad.board, columns } })
}

export function addLane(input, title = '') {
  const pad = ensureBoard(input)
  const id = uniqueId('plotline', allIds(pad))
  const color = LANE_COLORS[pad.board.lanes.length % LANE_COLORS.length]
  const lanes = [...pad.board.lanes, { id, title: title.trim() || `Plotline ${pad.board.lanes.length + 1}`, color }]
  return normalizeIdeaPadData({ ...pad, board: { ...pad.board, lanes } })
}

export function renameColumn(input, columnId, title) {
  const pad = ensureBoard(input)
  const columns = pad.board.columns.map((c) => (c.id === columnId ? { ...c, title: String(title || '').slice(0, 80) || c.title } : c))
  return normalizeIdeaPadData({ ...pad, board: { ...pad.board, columns } })
}

export function renameLane(input, laneId, title) {
  const pad = ensureBoard(input)
  const lanes = pad.board.lanes.map((l) => (l.id === laneId ? { ...l, title: String(title || '').slice(0, 80) || l.title } : l))
  return normalizeIdeaPadData({ ...pad, board: { ...pad.board, lanes } })
}

/** Move a section left (-1) or right (+1). */
export function moveColumn(input, columnId, delta) {
  const pad = ensureBoard(input)
  const columns = [...pad.board.columns]
  const from = columns.findIndex((c) => c.id === columnId)
  const to = from + delta
  if (from < 0 || to < 0 || to >= columns.length) return pad
  const [column] = columns.splice(from, 1)
  columns.splice(to, 0, column)
  return normalizeIdeaPadData({ ...pad, board: { ...pad.board, columns } })
}

/** Remove a section or plotline; its cards go to Unsorted. The last one stays. */
export function removeColumn(input, columnId) {
  const pad = ensureBoard(input)
  if (pad.board.columns.length <= 1) return pad
  const columns = pad.board.columns.filter((c) => c.id !== columnId)
  const nodes = pad.nodes.map((node) => {
    if (node.column !== columnId) return node
    const { column: _column, lane: _lane, ...rest } = node
    return rest
  })
  return normalizeIdeaPadData({ ...pad, nodes, board: { ...pad.board, columns } })
}

export function removeLane(input, laneId) {
  const pad = ensureBoard(input)
  if (pad.board.lanes.length <= 1) return pad
  const lanes = pad.board.lanes.filter((l) => l.id !== laneId)
  const nodes = pad.nodes.map((node) => {
    if (node.lane !== laneId) return node
    const { column: _column, lane: _lane, ...rest } = node
    return rest
  })
  return normalizeIdeaPadData({ ...pad, nodes, board: { ...pad.board, lanes } })
}

/**
 * Board reading order: section by section; inside a section, by position in
 * the cell, then plotline from top to bottom. Only placed cards.
 */
export function boardStoryOrder(input) {
  const pad = normalizeIdeaPadData(input)
  if (!pad.board) return []
  const columnIndex = new Map(pad.board.columns.map((c, i) => [c.id, i]))
  const laneIndex = new Map(pad.board.lanes.map((l, i) => [l.id, i]))
  return pad.nodes
    .filter((node) => isBoardCard(node) && isPlaced(pad, node))
    .sort((a, b) => columnIndex.get(a.column) - columnIndex.get(b.column)
      || (a.order ?? Infinity) - (b.order ?? Infinity)
      || laneIndex.get(a.lane) - laneIndex.get(b.lane))
}

/* ---------- who is in a card ---------- */

/** Character ids linked to a card with "appears in". */
export function cardCast(input, nodeId) {
  const pad = normalizeIdeaPadData(input)
  const characters = new Set(pad.nodes.filter((node) => node.kind === 'character').map((node) => node.id))
  return pad.edges
    .filter((edge) => edge.label === 'appears in' && (edge.source === nodeId || edge.target === nodeId))
    .map((edge) => (edge.source === nodeId ? edge.target : edge.source))
    .filter((id) => characters.has(id))
}

/** Add or remove a character from a card (an "appears in" link). */
export function toggleCardCast(input, nodeId, characterId) {
  const pad = normalizeIdeaPadData(input)
  const linked = (edge) => edge.label === 'appears in'
    && ((edge.source === characterId && edge.target === nodeId) || (edge.source === nodeId && edge.target === characterId))
  if (pad.edges.some(linked)) return normalizeIdeaPadData({ ...pad, edges: pad.edges.filter((edge) => !linked(edge)) })
  if (!pad.nodes.some((n) => n.id === nodeId) || !pad.nodes.some((n) => n.id === characterId && n.kind === 'character')) return pad
  const id = uniqueId('edge', allIds(pad))
  return normalizeIdeaPadData({ ...pad, edges: [...pad.edges, { id, source: characterId, target: nodeId, label: 'appears in' }] })
}
