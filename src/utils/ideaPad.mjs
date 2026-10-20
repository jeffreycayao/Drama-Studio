/** Idea Pad logic: node creation, story order, screenplay export and the AI
 * collaborator prompts/parsers. Pure; the workspace component and the LLM
 * call live elsewhere. */
import { normalizeIdeaPadData, IDEA_NODE_LABELS } from '../types/ideaPad.js'
import { extractJsonObject } from './llmJson.mjs'
import { parseFountain, parseSceneHeading, toFountain } from './screenplayParser.mjs'
import { boardStoryOrder } from './ideaBoard.mjs'

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

/** Story nodes (episodes, beats, scenes) in reading order. Cards placed on
 * the Story Board come first, in board order (section by section). The rest
 * follow "leads to" links from their starts; unlinked cards fall back to
 * explicit order, then left-to-right, top-to-bottom on the canvas. Cycles
 * cannot loop. */
export function getStoryOrder(pad) {
  const normalized = normalizeIdeaPadData(pad)
  const placed = boardStoryOrder(normalized)
  if (!placed.length) return linkStoryOrder(normalized)
  const placedIds = new Set(placed.map(node => node.id))
  const rest = linkStoryOrder({ ...normalized, nodes: normalized.nodes.filter(node => !placedIds.has(node.id)) })
  return [...placed, ...rest]
}

function linkStoryOrder({ nodes, edges }) {
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
    // Imported scenes keep their own Fountain (dialogue and all); the card
    // body is then only a summary.
    if (node.kind === 'scene' && node.fountain) {
      elements.push(...parseFountain(node.fountain).scenes.flatMap(item => item.elements))
      scenes.push({ ...parseSceneHeading(heading), heading, elements })
      continue
    }
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

const IMPORT_MAX_SCENES = 400
const IMPORT_MAX_APPEARANCES = 800
const CARD_W = 260
const CARD_H = 170

/** "DR. KANE" → "Dr. Kane" (names stay readable on cards). */
const titleCase = value => String(value || '').toLowerCase().replace(/(^|[\s.'-])(\p{L})/gu, (_, sep, char) => sep + char.toUpperCase())

/**
 * Add a parsed screenplay to the pad: one character card per speaking
 * character (existing cards with the same name are reused), one scene card
 * per scene chained with "leads to", and "appears in" links from each
 * character to the scenes they speak in. Cards land below what is already
 * on the canvas. Scene cards keep the scene's own Fountain for export.
 */
export function importScreenplayToIdeaPad(input, screenplay, { fileName = '' } = {}) {
  const pad = normalizeIdeaPadData(input)
  const used = new Set([...pad.nodes, ...pad.edges].map(item => item.id))
  let counter = used.size + 1
  const id = prefix => {
    let next = `${prefix}-${counter}`
    while (used.has(next)) { counter += 1; next = `${prefix}-${counter}` }
    used.add(next); counter += 1
    return next
  }
  const top = pad.nodes.length ? Math.max(...pad.nodes.map(node => node.position.y)) + CARD_H + 80 : 0
  const left = pad.nodes.length ? Math.min(...pad.nodes.map(node => node.position.x)) : 0
  const nodes = [...pad.nodes]
  const edges = [...pad.edges]
  const scenes = (screenplay?.scenes || []).slice(0, IMPORT_MAX_SCENES)

  // Who speaks where.
  const spokenIn = new Map()
  scenes.forEach((scene, index) => {
    for (const element of scene.elements || []) {
      if (element.type !== 'dialogue' || !element.character) continue
      const key = element.character.trim().toUpperCase()
      if (!spokenIn.has(key)) spokenIn.set(key, new Set())
      spokenIn.get(key).add(index)
    }
  })
  const names = [...new Set([...(screenplay?.characters || []).map(name => String(name).trim().toUpperCase()), ...spokenIn.keys()])].filter(Boolean)

  let row = top
  if (screenplay?.title) {
    const page = Object.entries(screenplay.titlePage || {}).filter(([key]) => key !== 'title').map(([key, value]) => `${titleCase(key)}: ${value}`)
    nodes.push({ id: id('note'), kind: 'note', position: { x: left, y: row }, title: `Script: ${screenplay.title}`.slice(0, 200),
      body: [fileName ? `Imported from ${fileName}.` : '', ...page].filter(Boolean).join('\n').slice(0, 8000) })
    row += CARD_H
  }

  const characterIds = new Map()
  let created = 0
  let reused = 0
  names.forEach(name => {
    const existing = pad.nodes.find(node => node.kind === 'character' && node.title.trim().toUpperCase() === name)
    if (existing) { characterIds.set(name, existing.id); reused += 1; return }
    const count = spokenIn.get(name)?.size || 0
    const nodeId = id('character')
    characterIds.set(name, nodeId)
    nodes.push({ id: nodeId, kind: 'character', figure: 'person', title: titleCase(name).slice(0, 200),
      position: { x: left + (created % 6) * CARD_W, y: row + Math.floor(created / 6) * CARD_H },
      body: count ? `Speaks in ${count} scene${count === 1 ? '' : 's'}.` : '' })
    created += 1
  })
  if (created) row += Math.ceil(created / 6) * CARD_H + 40

  const sceneIds = []
  scenes.forEach((scene, index) => {
    const nodeId = id('scene')
    sceneIds.push(nodeId)
    const firstAction = (scene.elements || []).find(element => element.type === 'action')?.text || ''
    const fountain = toFountain({ scenes: [{ ...scene, heading: '', number: null }] }, { includeTitlePage: false }).trim()
    nodes.push({
      id: nodeId, kind: 'scene', order: index + 1,
      title: titleCase(scene.location || scene.heading || `Scene ${index + 1}`).slice(0, 200) || `Scene ${index + 1}`,
      heading: String(scene.heading || '').slice(0, 400),
      body: firstAction.slice(0, 280),
      ...(fountain ? { fountain: fountain.slice(0, 20000) } : {}),
      position: { x: left + (index % 5) * CARD_W, y: row + Math.floor(index / 5) * CARD_H },
    })
    if (index > 0) edges.push({ id: id('edge'), source: sceneIds[index - 1], target: nodeId, label: 'leads to' })
  })

  let appearances = 0
  for (const [name, sceneIndexes] of spokenIn) {
    const characterId = characterIds.get(name)
    if (!characterId) continue
    for (const index of sceneIndexes) {
      if (appearances >= IMPORT_MAX_APPEARANCES) break
      edges.push({ id: id('edge'), source: characterId, target: sceneIds[index], label: 'appears in' })
      appearances += 1
    }
  }

  return {
    pad: normalizeIdeaPadData({ ...pad, nodes, edges }),
    created: { characters: created, reusedCharacters: reused, scenes: scenes.length, skippedScenes: Math.max(0, (screenplay?.scenes?.length || 0) - scenes.length) },
  }
}

/**
 * A prompt to paste into an external AI (ChatGPT, Claude, Gemini…) that
 * returns a Fountain screenplay Drama Studio can import, built from the brief
 * and whatever is already on the Idea Pad.
 */
export function buildExternalFountainPrompt(input, { brief = '', sceneCount = 8, title = '' } = {}) {
  const pad = normalizeIdeaPadData(input)
  const scenes = Math.max(1, Math.min(60, Math.round(Number(sceneCount) || 8)))
  const story = pad.nodes.length ? buildStoryContext(pad) : '(The Idea Pad is empty: invent the characters and the story from the brief.)'
  return [
    'You are a professional screenwriter. Write a screenplay in Fountain format (fountain.io) that I will import into a video editor.',
    '',
    `What to write: ${String(brief || '').trim() || 'a short, visual micro-drama episode with a strong hook and a cliffhanger.'}`,
    `Length: about ${scenes} scene${scenes === 1 ? '' : 's'}.`,
    ...(title ? [`Title: ${title}`] : []),
    '',
    'Format rules (follow exactly, the file is parsed by a program):',
    '1. Reply with the Fountain text only. No Markdown, no code fences, no notes before or after it.',
    '2. Start with a title page: "Title: …", "Credit: Written by", "Author: …", then one blank line.',
    '3. Start every scene with a scene heading on its own line after a blank line: INT. or EXT., the place, " - ", the time of day. Example: INT. MOTEL ROOM - NIGHT',
    '4. Write action as short present-tense sentences describing only what we see and hear.',
    '5. Put each character name in CAPITALS on its own line, then the dialogue on the next line. Parentheticals such as (whispering) go on their own line between the name and the dialogue.',
    '6. Keep character names spelled the same every time. Use the names below when they fit.',
    '7. Transitions such as CUT TO: are in capitals, on their own line, ending with a colon.',
    '',
    'Story so far, from my Idea Pad:',
    story,
    '',
    'When you are done I will save your reply as a .fountain file.',
  ].join('\n')
}
