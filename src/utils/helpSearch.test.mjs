import test from 'node:test'
import assert from 'node:assert/strict'
import { HELP_ARTICLES, HELP_CATEGORIES, HELP_FEATURED_IDS } from '../config/helpGuide.js'
import { buildHelpIndex, normalizeHelpText, searchHelp, tokenizeHelpQuery } from './helpSearch.mjs'

const index = buildHelpIndex(HELP_ARTICLES)
const topId = (query) => searchHelp(index, query)[0]?.article.id
const topIds = (query, count = 3) => searchHelp(index, query).slice(0, count).map((result) => result.article.id)

// Kept in sync with HelpVisuals.jsx and HelpCenter's action handlers.
const KNOWN_VISUALS = new Set([
  'big-picture', 'screen-map', 'project-folder', 'generation-flow', 'local-vs-cloud', 'pc-tiers',
  'image-to-video', 'consistency-path', 'editing-flow', 'assistant-flow',
])
const KNOWN_ACTION = /^(openGettingStarted|startTour|palette|openSettings:[a-z-]+|command:[a-z.-]+)$/

test('guide data is consistent', () => {
  const ids = HELP_ARTICLES.map((article) => article.id)
  assert.equal(new Set(ids).size, ids.length, 'article ids are unique')
  const categories = new Set(HELP_CATEGORIES.map((category) => category.id))
  for (const article of HELP_ARTICLES) {
    assert.ok(categories.has(article.category), `${article.id} has a known category`)
    assert.ok(article.title && article.summary, `${article.id} has a title and summary`)
    assert.ok(Array.isArray(article.body) && article.body.length > 0, `${article.id} has a body`)
    for (const related of article.related || []) assert.ok(ids.includes(related), `${article.id} → ${related} exists`)
    for (const block of article.body) {
      if (block.type === 'visual') assert.ok(KNOWN_VISUALS.has(block.id), `visual ${block.id}`)
      if (block.type === 'action') assert.match(block.action, KNOWN_ACTION)
      if (block.type === 'table') for (const row of block.rows) assert.equal(row.length, block.head.length, `${article.id} table row width`)
    }
  }
  for (const category of categories) assert.ok(HELP_ARTICLES.some((article) => article.category === category), `${category} has articles`)
  for (const id of HELP_FEATURED_IDS) assert.ok(ids.includes(id), `featured ${id}`)
})

test('normalizing and tokenizing', () => {
  assert.equal(normalizeHelpText('**Lip-sync** to 9:16!'), 'lip sync to 9 16')
  assert.deepEqual(tokenizeHelpQuery('Where do my videos go?'), ['videos', 'go'])
  assert.deepEqual(tokenizeHelpQuery('how do I'), [])
  assert.deepEqual(searchHelp(index, '   '), [])
})

test('everyday questions find the right article', () => {
  assert.equal(topId('is it saved locally'), 'where-files-are-saved')
  assert.equal(topId('where do my generated videos go'), 'where-files-are-saved')
  assert.equal(topId('animate a picture'), 'image-to-video')
  assert.equal(topId('text to video'), 'text-to-video')
  assert.equal(topId('local vs cloud'), 'local-vs-cloud')
  assert.equal(topId('can the assistant edit'), 'assistant-overview')
  assert.equal(topId('ollama'), 'assistant-setup')
  assert.equal(topId('remove vocals'), 'vocal-extract')
  assert.equal(topId('comfyui offline'), 'comfyui-wont-connect')
  assert.ok(topIds('dub my video into spanish').includes('dubbing'))
  assert.equal(topId('clone my voice'), 'voices')
  assert.ok(topIds('free text to speech').includes('voices'))
  assert.ok(topIds('sfx').includes('sound-effects'))
  assert.ok(topIds('subtitles').includes('captions'))
  assert.ok(topIds('how much vram do i need').includes('can-my-pc-run-ai'))
  assert.equal(topId('someone sent me a zip pack'), 'import-packs')
  assert.ok(topIds('chrome extension').includes('import-packs'))
})

test('prefixes and plurals still match', () => {
  assert.ok(topIds('captio').includes('captions'))
  assert.ok(topIds('keyframes').includes('keyframes'))
})

test('results carry a snippet and are ordered by score', () => {
  const results = searchHelp(index, 'lip sync')
  assert.ok(results.length > 0)
  assert.ok(results.every((result) => typeof result.snippet === 'string' && result.snippet.length > 0))
  for (let i = 1; i < results.length; i += 1) assert.ok(results[i - 1].score >= results[i].score)
  assert.ok(results.every((result) => result.snippet.length <= 171))
})

test('nonsense finds nothing', () => {
  assert.deepEqual(searchHelp(index, 'zzqx'), [])
})
