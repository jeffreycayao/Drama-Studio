/**
 * Idea Pad starter templates: a ready-made story skeleton the creator fills
 * in instead of an empty canvas. Plain data in the Idea Pad format
 * (src/types/ideaPad.js); beats are chained with "leads to" so the story
 * order and the screenplay export work straight away.
 */
import { normalizeIdeaPadData } from '../types/ideaPad.js'

const BEAT_GAP = 280

function build(prefix, { characters = [], arc = null, episode = null, beats = [], notes = [], relations = [] }) {
  const nodes = []
  const edges = []
  const id = (kind, index) => `${prefix}_${kind}_${index + 1}`
  characters.forEach((character, index) => {
    nodes.push({ id: id('character', index), kind: 'character', position: { x: index * BEAT_GAP, y: 0 }, ...character })
  })
  if (arc) nodes.push({ id: id('arc', 0), kind: 'arc', position: { x: characters.length * BEAT_GAP, y: 0 }, ...arc })
  let previous = null
  if (episode) {
    previous = id('episode', 0)
    nodes.push({ id: previous, kind: 'episode', position: { x: -BEAT_GAP, y: 240 }, order: 0, ...episode })
  }
  beats.forEach((beat, index) => {
    const beatId = id('beat', index)
    nodes.push({ id: beatId, kind: 'beat', position: { x: index * BEAT_GAP, y: 240 }, order: index + 1, ...beat })
    if (previous) edges.push({ id: `${prefix}_edge_flow_${index + 1}`, source: previous, target: beatId, label: 'leads to' })
    previous = beatId
  })
  notes.forEach((note, index) => {
    nodes.push({ id: id('note', index), kind: 'note', position: { x: index * BEAT_GAP, y: -200 }, ...note })
  })
  relations.forEach(([from, to, label], index) => {
    edges.push({ id: `${prefix}_edge_rel_${index + 1}`, source: id('character', from), target: id('character', to), label })
  })
  if (arc && nodes.some((node) => node.id === id('character', 0))) {
    edges.push({ id: `${prefix}_edge_arc`, source: id('character', 0), target: id('arc', 0), label: 'appears in' })
  }
  return normalizeIdeaPadData({ version: 1, nodes, edges })
}

export const IDEA_PAD_TEMPLATES = Object.freeze([
  {
    id: 'three-act-short',
    title: 'Three-act short',
    description: 'A 3 to 10 minute short film: two characters, an arc and eight beats from opening image to final image.',
    build: () => build('three_act', {
      characters: [
        { title: 'Your hero', role: 'protagonist', figure: 'person', want: 'What do they want more than anything?', wound: 'What holds them back?', body: 'Who they are in one or two lines.' },
        { title: 'The obstacle', role: 'antagonist', figure: 'person', want: 'What do they want that clashes with the hero?', body: 'A person, a rule or a force that stands in the way.' },
      ],
      arc: { title: 'How the hero changes', body: 'Start: what the hero believes. End: what they believe now.' },
      beats: [
        { title: 'Act 1 · Opening image', body: 'Show the hero’s ordinary world in one strong picture.' },
        { title: 'Act 1 · Inciting incident', body: 'Something happens that the hero cannot ignore.' },
        { title: 'Act 1 · The decision', body: 'The hero chooses to act. This ends Act 1.' },
        { title: 'Act 2 · Rising obstacles', body: 'Each try makes things harder.' },
        { title: 'Act 2 · Midpoint twist', body: 'A reveal that changes what the hero is fighting for.' },
        { title: 'Act 2 · All is lost', body: 'The lowest point. The old way of doing things fails.' },
        { title: 'Act 3 · Climax', body: 'The hero faces the obstacle using what they learned.' },
        { title: 'Act 3 · Final image', body: 'Mirror the opening image to show how things changed.' },
      ],
      relations: [[0, 1, 'rivals']],
    }),
  },
  {
    id: 'micro-drama-episode',
    title: 'Micro-drama episode',
    description: 'One 1 to 2 minute vertical episode: a hook in the first seconds, a twist and a cliffhanger.',
    build: () => build('micro_drama', {
      characters: [
        { title: 'The lead', role: 'protagonist', figure: 'woman', want: 'What they want this episode', wound: 'The secret or hurt they carry', body: 'Name, age and one striking detail.' },
        { title: 'The love interest', role: 'love interest', figure: 'man', want: 'What they want from the lead', body: 'Charming, but hiding something?' },
        { title: 'The schemer', role: 'antagonist', figure: 'person', want: 'What they gain if the lead fails', body: 'A rival, an ex or a family member.' },
      ],
      episode: { title: 'Episode 1', body: 'One line: what happens in this episode.' },
      beats: [
        { title: 'Hook (first 3 seconds)', body: 'Open on a slap, a secret, a shock. Make the viewer stay.' },
        { title: 'Set-up', body: 'Who wants what, in two or three quick lines.' },
        { title: 'Twist', body: 'A reveal that flips the situation.' },
        { title: 'Escalation', body: 'The pressure doubles: a threat, a deadline, a witness.' },
        { title: 'Cliffhanger', body: 'End on a question that makes them watch the next episode.' },
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
