// Starter templates for the Idea Pad, so a new pad is not an empty canvas.
// A template is plain card data laid out on a grid; applying it adds the
// cards (beside any existing ones) and links story cards with "leads to".
import { normalizeIdeaPadData } from '../types/ideaPad.js'
import { addIdeaNode, connectIdeaNodes } from './ideaPad.mjs'

const COLUMN = 260
const ROW = 170

export const IDEA_PAD_TEMPLATES = Object.freeze([
  {
    id: 'three-act-short',
    title: 'Three-act short',
    summary: 'Setup, confrontation and resolution for a 3 to 10 minute short film.',
    cards: [
      { key: 'hero', kind: 'character', col: 0, row: 0, title: 'Protagonist', role: 'protagonist', figure: 'person',
        want: 'What do they want more than anything?', wound: 'What fear or flaw holds them back?' },
      { key: 'rival', kind: 'character', col: 1, row: 0, title: 'Antagonist', role: 'antagonist', figure: 'person',
        want: 'Why do they stand in the way?' },
      { key: 'arc', kind: 'arc', col: 2, row: 0, title: 'How the protagonist changes',
        body: 'Who are they at the start, and who are they by the final scene?' },
      { key: 'b1', kind: 'beat', col: 0, row: 1, title: 'Act 1: Normal world', body: 'Show the protagonist\'s everyday life and what is missing from it.' },
      { key: 'b2', kind: 'beat', col: 1, row: 1, title: 'Inciting incident', body: 'Something happens that they cannot ignore.' },
      { key: 'b3', kind: 'beat', col: 2, row: 1, title: 'Act 2: The plan meets obstacles', body: 'They try to fix it. Each attempt makes things harder.' },
      { key: 'b4', kind: 'beat', col: 3, row: 1, title: 'Midpoint', body: 'A discovery or reversal raises the stakes.' },
      { key: 'b5', kind: 'beat', col: 4, row: 1, title: 'Act 3: All is lost', body: 'The lowest point. The old way of doing things fails.' },
      { key: 'b6', kind: 'beat', col: 5, row: 1, title: 'Climax', body: 'They face the antagonist using what they learned.' },
      { key: 'b7', kind: 'beat', col: 6, row: 1, title: 'Resolution', body: 'The new normal. Echo the opening to show the change.' },
    ],
    links: [
      ['hero', 'rival', 'rivals'],
      ['b1', 'b2'], ['b2', 'b3'], ['b3', 'b4'], ['b4', 'b5'], ['b5', 'b6'], ['b6', 'b7'],
    ],
  },
  {
    id: 'micro-drama-episode',
    title: 'Micro-drama episode',
    summary: 'A 1 to 3 minute vertical episode: a hook in the first seconds, a twist, and a cliffhanger.',
    cards: [
      { key: 'lead', kind: 'character', col: 0, row: 0, title: 'Lead', role: 'protagonist', figure: 'woman',
        want: 'What do they want in this episode?', wound: 'What secret or hurt are they hiding?' },
      { key: 'love', kind: 'character', col: 1, row: 0, title: 'Love interest', role: 'love interest', figure: 'man' },
      { key: 'villain', kind: 'character', col: 2, row: 0, title: 'Villain', role: 'antagonist', figure: 'person',
        want: 'What do they gain if the lead fails?' },
      { key: 'ep', kind: 'episode', col: 0, row: 1, title: 'Episode 1', body: 'One line: what happens and why viewers keep swiping.' },
      { key: 'b1', kind: 'beat', col: 1, row: 1, title: 'Hook (first 3 seconds)', body: 'Open on the most shocking moment: a slap, a reveal, a ring thrown away.' },
      { key: 'b2', kind: 'beat', col: 2, row: 1, title: 'Setup', body: 'Who is this, and what do they stand to lose?' },
      { key: 's1', kind: 'scene', col: 3, row: 1, title: 'The confrontation', heading: 'INT. MANSION - NIGHT', body: 'The villain pushes; the lead takes it, for now.' },
      { key: 'b3', kind: 'beat', col: 4, row: 1, title: 'Twist', body: 'A secret comes out that flips who has the power.' },
      { key: 'b4', kind: 'beat', col: 5, row: 1, title: 'Cliffhanger', body: 'End on a reveal or a question so viewers open the next episode.' },
    ],
    links: [
      ['lead', 'love', 'loves'],
      ['villain', 'lead', 'betrays'],
      ['ep', 'b1'], ['b1', 'b2'], ['b2', 's1'], ['s1', 'b3'], ['b3', 'b4'],
    ],
  },
])

export function getIdeaPadTemplate(id) {
  return IDEA_PAD_TEMPLATES.find((template) => template.id === id) || null
}

/**
 * Add a template's cards to the pad. On a pad that already has cards, the
 * template is placed to the right of them so nothing overlaps.
 * @returns {{ pad, created: string[] }} the new pad and the new card ids
 */
export function applyIdeaPadTemplate(pad, templateId, { origin = null } = {}) {
  const template = getIdeaPadTemplate(templateId)
  let next = normalizeIdeaPadData(pad)
  if (!template) return { pad: next, created: [] }
  let start = origin
  if (!start) {
    start = next.nodes.length
      ? { x: Math.max(...next.nodes.map((node) => node.position.x)) + COLUMN + 140, y: Math.min(...next.nodes.map((node) => node.position.y)) }
      : { x: 0, y: 0 }
  }
  const idByKey = new Map()
  const created = []
  for (const card of template.cards) {
    const { key, kind, col, row, ...fields } = card
    const result = addIdeaNode(next, kind, { x: start.x + col * COLUMN, y: start.y + row * ROW }, fields)
    next = result.pad
    idByKey.set(key, result.node.id)
    created.push(result.node.id)
  }
  for (const [from, to, label = 'leads to'] of template.links) {
    next = connectIdeaNodes(next, idByKey.get(from), idByKey.get(to), label)
  }
  return { pad: next, created }
}
