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
 *
 * @typedef {Object} IdeaEdge
 * @property {string} id
 * @property {string} source
 * @property {string} target
 * @property {string} label         Relationship ("loves", "rivals") or "leads to".
 *
 * @typedef {{ version: 1, nodes: IdeaNode[], edges: IdeaEdge[], viewport?: { x: number, y: number, zoom: number } }} IdeaPadData
 */

export const IDEA_NODE_KINDS = Object.freeze(['character', 'arc', 'episode', 'beat', 'scene', 'note'])
export const IDEA_NODE_LABELS = Object.freeze({
  character: 'Character', arc: 'Story arc', episode: 'Episode', beat: 'Beat', scene: 'Scene', note: 'Note',
})
export const RELATIONSHIP_LABELS = Object.freeze(['leads to', 'loves', 'rivals', 'betrays', 'protects', 'hides from', 'family', 'mentor of', 'appears in'])
const MAX_NODES = 2000
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
  return { version: 1, nodes, edges, ...(viewport ? { viewport } : {}) }
}
