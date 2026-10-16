/** Idea Pad logic: node creation, story order, screenplay export and the AI
 * collaborator prompts/parsers. Pure; the workspace component and the LLM
 * call live elsewhere. */
import { normalizeIdeaPadData, IDEA_NODE_LABELS } from '../types/ideaPad.js'
import { extractJsonObject } from './llmJson.mjs'
import { parseSceneHeading } from './screenplayParser.mjs'

const STORY_KINDS = new Set(['episode', 'beat', 'scene'])
const HEADING = /^(?:INT\.?\/EXT|INT\/EXT|I\/E|EXT\.?\/INT|INT|EXT|EST)[.\s]/i

export function newIdeaId(prefix, pad) {
  const used = new Set([...(pad?.nodes || []), ...(pad?.edges || [])].map(item => item.id))
  for (let n = (pad?.nodes?.length || 0) + (pad?.edges?.length || 0) + 1; ; n += 1) {
    const id = `${prefix}-${n}`
    if (!used.has(id)) return id
  }
}

export function addIdeaNode(pad, kind, position = { x: 0, y: 0 }, patch = {}) {
  const current = normalizeIdeaPadData(pad)
  const node = { id: newIdeaId(kind, current), kind, position: { x: position.x || 0, y: position.y || 0 },
    title: patch.title ?? `New ${IDEA_NODE_LABELS[kind]?.toLowerCase() || 'card'}`, body: patch.body ?? '', ...patch }
  return { pad: normalizeIdeaPadData({ ...current, nodes: [...current.nodes, node] }), node }
}

export function connectIdeaNodes(pad, source, target, label = 'leads to') {
  const current = normalizeIdeaPadData(pad)
  if (source === target || current.edges.some(edge => edge.source === source && edge.target === target && edge.label === label)) return current
  return normalizeIdeaPadData({ ...current, edges: [...current.edges, { id: newIdeaId('edge', current), source, target, label }] })
}

export function removeIdeaNodes(pad, ids) {
  const current = normalizeIdeaPadData(pad)
  const drop = new Set(ids)
  return normalizeIdeaPadData({ ...current, nodes: current.nodes.filter(node => !drop.has(node.id)),
    edges: current.edges.filter(edge => !drop.has(edge.source) && !drop.has(edge.target)) })
}

const byCanvas = (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.position.x - b.position.x || a.position.y - b.position.y

/** Story nodes (episodes, beats, scenes) in reading order: follow "leads to"
 * links from their starts; unlinked cards fall back to explicit order, then
 * left-to-right, top-to-bottom on the canvas. Cycles cannot loop. */
export function getStoryOrder(pad) {
  const { nodes, edges } = normalizeIdeaPadData(pad)
  const story = nodes.filter(node => STORY_KINDS.has(node.kind))
  const ids = new Set(story.map(node => node.id))
  const next = new Map(), incoming = new Map()
  for (const edge of edges) {
    if (edge.label !== 'leads to' || !ids.has(edge.source) || !ids.has(edge.target)) continue
    if (!next.has(edge.source)) next.set(edge.source, [])
    next.get(edge.source).push(edge.target)
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1)
  }
  const byId = new Map(story.map(node => [node.id, node]))
  const visited = new Set(), order = []
  const walk = (id) => {
    if (visited.has(id)) return
    visited.add(id)
    order.push(byId.get(id))
    for (const target of (next.get(id) || []).map(item => byId.get(item)).sort(byCanvas)) walk(target.id)
  }
  for (const start of story.filter(node => !incoming.has(node.id)).sort(byCanvas)) walk(start.id)
  for (const rest of story.sort(byCanvas)) walk(rest.id) // nodes only reachable through a cycle
  return order
}

const neighbors = (pad, id, label) => pad.edges
  .filter(edge => (!label || edge.label === label) && (edge.source === id || edge.target === id))
  .map(edge => pad.nodes.find(node => node.id === (edge.source === id ? edge.target : edge.source)))
  .filter(Boolean)
// Beats attached to a scene by any link other than the "leads to" sequence.
const attachedBeats = (pad, sceneId) => pad.edges
  .filter(edge => edge.label !== 'leads to' && (edge.source === sceneId || edge.target === sceneId))
  .map(edge => pad.nodes.find(node => node.id === (edge.source === sceneId ? edge.target : edge.source)))
  .filter(Boolean)

/** Export the connected story as a screenplay model (see screenplayParser):
 * scene cards become scenes (heading + outline), beats attached to a scene
 * become its action, free beats become their own scenes, and characters
 * linked with "appears in" are listed. */
export function exportIdeaPadToScreenplay(input, { title = null } = {}) {
  const pad = normalizeIdeaPadData(input)
  const order = getStoryOrder(pad)
  const ownedBeats = new Set()
  for (const scene of order.filter(node => node.kind === 'scene')) {
    for (const node of attachedBeats(pad, scene.id)) if (node.kind === 'beat') ownedBeats.add(node.id)
  }
  const scenes = []
  for (const node of order) {
    if (node.kind === 'episode') {
      scenes.push({ heading: '', intExt: null, location: '', timeOfDay: null, number: null,
        elements: [{ type: 'centered', text: node.title.toUpperCase() }, ...(node.body.trim() ? [{ type: 'action', text: node.body.trim() }] : [])] })
      continue
    }
    if (node.kind === 'beat' && ownedBeats.has(node.id)) continue
    const rawHeading = (node.heading || '').trim() || node.title.trim()
    const heading = HEADING.test(`${rawHeading} `) ? rawHeading.toUpperCase() : rawHeading.toUpperCase()
    const elements = []
    if (node.body.trim()) elements.push({ type: 'action', text: node.body.trim() })
    if (node.kind === 'scene') {
      const beats = getStoryOrder({ ...pad, nodes: attachedBeats(pad, node.id).filter(item => item.kind === 'beat'), edges: pad.edges })
      for (const beat of beats) elements.push({ type: 'action', text: [beat.title, beat.body].map(part => part.trim()).filter(Boolean).join(': ') })
      const cast = neighbors(pad, node.id, 'appears in').filter(item => item.kind === 'character').map(item => item.title.toUpperCase())
      if (cast.length) elements.push({ type: 'action', text: `Featuring: ${cast.join(', ')}.` })
    }
    scenes.push({ ...parseSceneHeading(heading), heading, elements })
  }
  const arc = pad.nodes.find(node => node.kind === 'arc')
  const characters = pad.nodes.filter(node => node.kind === 'character').map(node => node.title.toUpperCase())
  return { title: title || arc?.title || null, titlePage: {}, scenes, characters, format: 'fountain' }
}

/** Compact story bible for prompts (bounded size). */
export function buildStoryContext(input, focusId = null) {
  const pad = normalizeIdeaPadData(input)
  const line = node => `- [${IDEA_NODE_LABELS[node.kind]}] ${node.title}${node.role ? ` (${node.role})` : ''}${node.want ? `; wants: ${node.want}` : ''}${node.wound ? `; inner conflict: ${node.wound}` : ''}${node.body ? `: ${node.body.slice(0, 300)}` : ''}`
  const relations = pad.edges.filter(edge => edge.label !== 'leads to').slice(0, 60).map(edge => {
    const a = pad.nodes.find(node => node.id === edge.source), b = pad.nodes.find(node => node.id === edge.target)
    return a && b ? `- ${a.title} ${edge.label} ${b.title}` : null
  }).filter(Boolean)
  const parts = ['Characters:', ...pad.nodes.filter(node => node.kind === 'character').map(line),
    'Arcs and episodes:', ...pad.nodes.filter(node => ['arc', 'episode'].includes(node.kind)).map(line),
    'Story so far (in order):', ...getStoryOrder(pad).filter(node => node.kind !== 'episode').map(line),
    ...(relations.length ? ['Relationships:', ...relations] : [])]
  const focus = pad.nodes.find(node => node.id === focusId)
  if (focus) parts.push('', `Focus card:${line(focus).slice(1)}`)
  return parts.join('\n').slice(0, 6000)
}

export const IDEA_AI_SYSTEM = 'You are a story editor for serialized micro-dramas, music videos and cinematic shorts. Be specific, visual and concise. Reply with ONE JSON object only.'

export const IDEA_AI_ACTIONS = Object.freeze({
  twists: { label: 'Suggest plot twists', kinds: ['arc', 'episode', 'beat', 'scene'] },
  conflict: { label: 'Deepen character conflict', kinds: ['character'] },
  expand: { label: 'Expand beat into scene outline', kinds: ['beat'] },
})

export function buildIdeaAiPrompt(action, input, focusId) {
  const context = buildStoryContext(input, focusId)
  if (action === 'twists') return `${context}\n\nSuggest 3 surprising but earned plot twists for the focus card. Reply as {"ideas":[{"title": short, "body": 1-2 sentences}]}.`
  if (action === 'conflict') return `${context}\n\nGive 3 ways to deepen the focus character's conflict (inner want vs need, a relationship under pressure, a secret). Reply as {"ideas":[{"title": short, "body": 1-2 sentences}]}.`
  if (action === 'expand') return `${context}\n\nExpand the focus beat into one filmable scene. Reply as {"heading": "INT./EXT. LOCATION - TIME", "title": short, "outline": 3-6 sentences of action and key dialogue moments}.`
  throw new Error('Unknown Idea Pad action.')
}

/** Parse the reply and apply it: ideas become note cards linked to the focus
 * card; an expanded beat becomes a scene card linked after it. */
export function applyIdeaAiResponse(action, input, focusId, replyText) {
  const pad = normalizeIdeaPadData(input)
  const focus = pad.nodes.find(node => node.id === focusId)
  if (!focus) return { ok: false, reason: 'The selected card no longer exists.' }
  const data = extractJsonObject(replyText)
  if (!data) return { ok: false, reason: 'The model did not answer in the expected format. Try again.' }
  if (action === 'expand') {
    const outline = typeof data.outline === 'string' ? data.outline.trim() : ''
    if (!outline) return { ok: false, reason: 'The model returned an empty scene outline.' }
    const heading = typeof data.heading === 'string' && HEADING.test(`${data.heading.trim()} `) ? data.heading.trim().toUpperCase() : ''
    const added = addIdeaNode(pad, 'scene', { x: focus.position.x + 300, y: focus.position.y }, {
      title: String(data.title || focus.title).slice(0, 200), heading, body: outline.slice(0, 8000) })
    return { ok: true, pad: connectIdeaNodes(added.pad, focus.id, added.node.id, 'leads to'), created: [added.node.id] }
  }
  const ideas = (Array.isArray(data.ideas) ? data.ideas : []).filter(item => item && typeof item.title === 'string' && item.title.trim()).slice(0, 5)
  if (!ideas.length) return { ok: false, reason: 'The model returned no ideas.' }
  let next = pad
  const created = []
  ideas.forEach((idea, index) => {
    const added = addIdeaNode(next, 'note', { x: focus.position.x + 300, y: focus.position.y + index * 130 - (ideas.length - 1) * 65 }, {
      title: idea.title.trim().slice(0, 200), body: String(idea.body || '').trim().slice(0, 8000) })
    next = connectIdeaNodes(added.pad, focus.id, added.node.id, action === 'twists' ? 'twist' : 'conflict')
    created.push(added.node.id)
  })
  return { ok: true, pad: next, created }
}
