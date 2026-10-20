/**
 * Idea Pad: the project's pre-production story graph. Saved in the project
 * file as `ideaPad`. Plain data; React Flow renders it.
 *
 * @typedef {'character'|'arc'|'episode'|'beat'|'scene'|'note'} IdeaNodeKind
 * @typedef {Object} IdeaNode
 * @property {string} id
 * @property {IdeaNodeKind} kind
 * @property {{ x: number, y: number }} position
 * @property {string} title
 * @property {string} body          Free text: profile, synopsis, beat, outline.
 * @property {string} [heading]     Scenes: "INT. MOTEL ROOM - NIGHT".
 * @property {string} [role]        Characters: protagonist, antagonist, …
 * @property {string} [want]        Characters: what they want.
 * @property {string} [wound]       Characters: inner conflict.
 * @property {number} [order]       Episodes/beats/scenes: optional explicit order.
 * @property {IdeaFigure} [figure]  Characters: the figure drawn on the card.
 * @property {string} [fountain]    Scenes: the scene's own Fountain text (imported scripts), used on export.
 * @property {string} [column]      Story Board: the section (act, episode) this card sits in.
 * @property {string} [lane]        Story Board: the plotline row this card sits in.
 *
 * @typedef {'person'|'woman'|'man'|'child'|'elder'|'group'|'creature'} IdeaFigure
 *
 * @typedef {Object} IdeaEdge
 * @property {string} id
 * @property {string} source
 * @property {string} target
 * @property {string} label         Relationship ("loves", "rivals") or "leads to".
 *
 * @typedef {{ id: string, title: string }} IdeaBoardColumn   A story section: Act 1, Episode 2…
 * @typedef {{ id: string, title: string, color?: string }} IdeaBoardLane  A plotline row.
 * @typedef {{ columns: IdeaBoardColumn[], lanes: IdeaBoardLane[] }} IdeaBoard
 *
 * @typedef {{ version: 1, nodes: IdeaNode[], edges: IdeaEdge[], board?: IdeaBoard, viewport?: { x: number, y: number, zoom: number } }} IdeaPadData
 */

export const IDEA_NODE_KINDS = Object.freeze(['character', 'arc', 'episode', 'beat', 'scene', 'note'])
export const IDEA_NODE_LABELS = Object.freeze({
  character: 'Character', arc: 'Story arc', episode: 'Episode', beat: 'Beat', scene: 'Scene', note: 'Note',
})
/** Hover help for each card type (toolbar, cards and the inspector). */
export const IDEA_NODE_HELP = Object.freeze({
  character: 'A person (or creature) in your story. Give them a role, what they want and what holds them back, then link them to other characters with “loves”, “rivals”, “family”…',
  arc: 'A story arc: how a character changes or how a plot thread develops across the story, e.g. “Mia learns to trust again”. Link beats and scenes to it.',
  episode: 'An episode or chapter of a series. Chain episodes with “leads to” to set their order; each becomes a title card in the exported script.',
  beat: 'One story moment or turning point, e.g. “She finds the letter”. Beats linked with “leads to” (or to a scene) export as scene action.',
  scene: 'A screenplay scene with a heading (INT. or EXT., place, time of day). Scenes chained with “leads to” export as the Fountain screenplay.',
  note: 'Free notes: research, ideas, reminders. Notes are not exported.',
})
export const IDEA_FIGURES = Object.freeze(['person', 'woman', 'man', 'child', 'elder', 'group', 'creature'])
export const IDEA_FIGURE_LABELS = Object.freeze({
  person: 'Person', woman: 'Woman', man: 'Man', child: 'Child', elder: 'Elder', group: 'Group', creature: 'Creature',
})
export const RELATIONSHIP_LABELS = Object.freeze(['leads to', 'loves', 'rivals', 'betrays', 'protects', 'hides from', 'family', 'mentor of', 'appears in'])
const MAX_NODES = 2000
const MAX_BOARD_COLUMNS = 40
const MAX_BOARD_LANES = 20
const HEX_COLOR = /^#[0-9a-f]{6}$/i
const MAX_EDGES = 4000
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : ''
const finite = value => typeof value === 'number' && Number.isFinite(value)
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value)

export const createDefaultIdeaPadData = () => ({ version: 1, nodes: [], edges: [] })

/** Tolerant load: bad nodes/edges are dropped, never thrown. */
export function normalizeIdeaPadData(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== 1) return createDefaultIdeaPadData()
  const nodes = []
  const ids = new Set()
  for (const node of Array.isArray(raw.nodes) ? raw.nodes.slice(0, MAX_NODES) : []) {
    if (!node || !safeId(node.id) || ids.has(node.id) || !IDEA_NODE_KINDS.includes(node.kind)) continue
    ids.add(node.id)
    const clean = {
      id: node.id, kind: node.kind,
      position: { x: finite(node.position?.x) ? node.position.x : 0, y: finite(node.position?.y) ? node.position.y : 0 },
      title: text(node.title, 200), body: text(node.body, 8000),
    }
    for (const key of ['heading', 'role', 'want', 'wound']) if (typeof node[key] === 'string') clean[key] = text(node[key], 400)
    if (finite(node.order)) clean.order = node.order
    if (safeId(node.column)) clean.column = node.column
    if (safeId(node.lane)) clean.lane = node.lane
    if (node.kind === 'character' && IDEA_FIGURES.includes(node.figure)) clean.figure = node.figure
    if (node.kind === 'scene' && typeof node.fountain === 'string' && node.fountain.trim()) clean.fountain = text(node.fountain, 20000)
    nodes.push(clean)
  }
  const edges = []
  const edgeIds = new Set()
  for (const edge of Array.isArray(raw.edges) ? raw.edges.slice(0, MAX_EDGES) : []) {
    if (!edge || !safeId(edge.id) || edgeIds.has(edge.id) || !ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue
    edgeIds.add(edge.id)
    edges.push({ id: edge.id, source: edge.source, target: edge.target, label: text(edge.label, 60) || 'leads to' })
  }
  const viewport = raw.viewport && finite(raw.viewport.x) && finite(raw.viewport.y) && finite(raw.viewport.zoom)
    ? { x: raw.viewport.x, y: raw.viewport.y, zoom: raw.viewport.zoom } : undefined
  const board = normalizeIdeaBoard(raw.board)
  return { version: 1, nodes, edges, ...(board ? { board } : {}), ...(viewport ? { viewport } : {}) }
}

/** The Story Board's sections (columns) and plotlines (rows); null when the
 * pad has no board yet or it is unusable. Duplicate or bad ids are dropped. */
export function normalizeIdeaBoard(raw) {
  if (!raw || typeof raw !== 'object') return null
  const pick = (list, max, extra) => {
    const seen = new Set()
    const out = []
    for (const item of Array.isArray(list) ? list.slice(0, max) : []) {
      if (!item || !safeId(item.id) || seen.has(item.id)) continue
      seen.add(item.id)
      out.push({ id: item.id, title: text(item.title, 80) || 'Untitled', ...extra(item) })
    }
    return out
  }
  const columns = pick(raw.columns, MAX_BOARD_COLUMNS, () => ({}))
  const lanes = pick(raw.lanes, MAX_BOARD_LANES, item => (typeof item.color === 'string' && HEX_COLOR.test(item.color) ? { color: item.color.toLowerCase() } : {}))
  if (!columns.length || !lanes.length) return null
  return { columns, lanes }
}
