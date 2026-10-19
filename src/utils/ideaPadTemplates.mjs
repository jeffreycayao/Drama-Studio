/**
 * Idea Pad starter templates: a ready-made story skeleton the creator fills
 * in instead of an empty board. Plain data in the Idea Pad format
 * (src/types/ideaPad.js). Each template brings its own Story Board: sections
 * as columns, plotlines as rows, and every beat placed in its cell, so the
 * story order and the screenplay export work straight away.
 */
import { normalizeIdeaPadData } from '../types/ideaPad.js'

const GAP = 280

function build(prefix, { characters = [], arc = null, board, beats = [], notes = [], relations = [] }) {
  const nodes = []
  const edges = []
  const id = (kind, index) => `${prefix}_${kind}_${index + 1}`
  characters.forEach((character, index) => {
    nodes.push({ id: id('character', index), kind: 'character', position: { x: index * GAP, y: 0 }, ...character })
  })
  if (arc) nodes.push({ id: id('arc', 0), kind: 'arc', position: { x: characters.length * GAP, y: 0 }, ...arc })
  const cellCounts = new Map()
  beats.forEach(({ column, lane, ...beat }, index) => {
    const cell = `${column}|${lane}`
    const order = (cellCounts.get(cell) || 0) + 1
    cellCounts.set(cell, order)
    nodes.push({ id: id('beat', index), kind: 'beat', position: { x: index * GAP, y: 240 }, column, lane, order, ...beat })
  })
  notes.forEach((note, index) => {
    nodes.push({ id: id('note', index), kind: 'note', position: { x: index * GAP, y: -200 }, ...note })
  })
  relations.forEach(([from, to, label], index) => {
    edges.push({ id: `${prefix}_edge_rel_${index + 1}`, source: id('character', from), target: id('character', to), label })
  })
  if (arc && characters.length) {
    edges.push({ id: `${prefix}_edge_arc`, source: id('character', 0), target: id('arc', 0), label: 'appears in' })
  }
  return normalizeIdeaPadData({ version: 1, nodes, edges, board })
}

export const IDEA_PAD_TEMPLATES = Object.freeze([
  {
    id: 'three-act-short',
    title: 'Three-act short',
    description: 'A 3 to 10 minute short film: two characters, three acts, the main plot and how the hero changes.',
    build: () => build('three_act', {
      characters: [
        { title: 'Your hero', role: 'protagonist', figure: 'person', want: 'What do they want more than anything?', wound: 'What holds them back?', body: 'Who they are in one or two lines.' },
        { title: 'The obstacle', role: 'antagonist', figure: 'person', want: 'What do they want that clashes with the hero?', body: 'A person, a rule or a force that stands in the way.' },
      ],
      arc: { title: 'How the hero changes', body: 'Start: what the hero believes. End: what they believe now.' },
      board: {
        columns: [{ id: 'act-1', title: 'Act 1 · Setup' }, { id: 'act-2', title: 'Act 2 · Conflict' }, { id: 'act-3', title: 'Act 3 · Resolution' }],
        lanes: [{ id: 'main-plot', title: 'Main plot', color: '#d5fa00' }, { id: 'hero-change', title: 'How the hero changes', color: '#6cc5c9' }],
      },
      beats: [
        { title: 'Opening image', body: 'Show the hero’s ordinary world in one strong picture.', column: 'act-1', lane: 'main-plot' },
        { title: 'Inciting incident', body: 'Something happens that the hero cannot ignore.', column: 'act-1', lane: 'main-plot' },
        { title: 'The decision', body: 'The hero chooses to act. This ends Act 1.', column: 'act-1', lane: 'main-plot' },
        { title: 'The flaw', body: 'What the hero believes at the start, and why it will fail them.', column: 'act-1', lane: 'hero-change' },
        { title: 'Rising obstacles', body: 'Each try makes things harder.', column: 'act-2', lane: 'main-plot' },
        { title: 'Midpoint twist', body: 'A reveal that changes what the hero is fighting for.', column: 'act-2', lane: 'main-plot' },
        { title: 'All is lost', body: 'The lowest point. The old way of doing things fails.', column: 'act-2', lane: 'main-plot' },
        { title: 'The lesson', body: 'What the hero finally understands.', column: 'act-2', lane: 'hero-change' },
        { title: 'Climax', body: 'The hero faces the obstacle using what they learned.', column: 'act-3', lane: 'main-plot' },
        { title: 'Final image', body: 'Mirror the opening image to show how things changed.', column: 'act-3', lane: 'main-plot' },
      ],
      relations: [[0, 1, 'rivals']],
    }),
  },
  {
    id: 'micro-drama-episode',
    title: 'Micro-drama episode',
    description: 'One 1 to 2 minute vertical episode: a hook, a twist and a cliffhanger, with romance and a secret running underneath.',
    build: () => build('micro_drama', {
      characters: [
        { title: 'The lead', role: 'protagonist', figure: 'woman', want: 'What they want this episode', wound: 'The secret or hurt they carry', body: 'Name, age and one striking detail.' },
        { title: 'The love interest', role: 'love interest', figure: 'man', want: 'What they want from the lead', body: 'Charming, but hiding something?' },
        { title: 'The schemer', role: 'antagonist', figure: 'person', want: 'What they gain if the lead fails', body: 'A rival, an ex or a family member.' },
      ],
      board: {
        columns: [{ id: 'hook', title: 'Hook · first 3 seconds' }, { id: 'middle', title: 'Middle' }, { id: 'ending', title: 'Cliffhanger' }],
        lanes: [{ id: 'main-plot', title: 'Main plot', color: '#d5fa00' }, { id: 'romance', title: 'Romance', color: '#f08a73' }, { id: 'secret', title: 'The secret', color: '#b7aaf0' }],
      },
      beats: [
        { title: 'The hook', body: 'Open on a slap, a secret, a shock. Make the viewer stay.', column: 'hook', lane: 'main-plot' },
        { title: 'Set-up', body: 'Who wants what, in two or three quick lines.', column: 'middle', lane: 'main-plot' },
        { title: 'A spark', body: 'A look or a touch between the lead and the love interest.', column: 'middle', lane: 'romance' },
        { title: 'Twist', body: 'A reveal that flips the situation.', column: 'middle', lane: 'secret' },
        { title: 'Escalation', body: 'The pressure doubles: a threat, a deadline, a witness.', column: 'middle', lane: 'main-plot' },
        { title: 'Cliffhanger', body: 'End on a question that makes them watch the next episode.', column: 'ending', lane: 'main-plot' },
      ],
      notes: [
        { title: 'Format', body: 'Vertical 9:16, 60 to 120 seconds, few locations, big emotions, fast cuts.' },
      ],
      relations: [[0, 1, 'loves'], [2, 0, 'rivals'], [1, 2, 'hides from']],
    }),
  },
])

/** A fresh Idea Pad for a template id, or null for an unknown id. */
export function buildIdeaPadTemplate(templateId) {
  const template = IDEA_PAD_TEMPLATES.find((entry) => entry.id === templateId)
  return template ? template.build() : null
}
