import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STARTER_PROMPTS,
  extractBlanks,
  fillBlanks,
  isPackPromptFile,
  normalizeMyPrompt,
  packFileToPrompt,
  parseLibraryFile,
  searchPrompts,
  serializeLibraryFile,
  suggestionsForBlank,
  titleFromText,
} from './promptLibrary.mjs'

test('extractBlanks lists each blank once, ignoring case and spacing', () => {
  const blanks = extractBlanks('Close-up of {Character}, then {character} meets {other_character} in {scene count} scenes. {not a blank because it is far too long to be one at all}')
  assert.deepEqual(blanks.map((item) => item.key), ['character', 'other character', 'scene count'])
  assert.equal(blanks[0].label, 'Character')
})

test('extractBlanks ignores JSON-like braces and empty braces', () => {
  assert.deepEqual(extractBlanks('{"a": 1} {} { } {1st}'), [])
})

test('fillBlanks swaps values and reports the blanks left empty', () => {
  const result = fillBlanks('{character} runs through {location} at {time of day}.', { Character: 'Mara', time_of_day: 'dawn', location: '  ' })
  assert.equal(result.text, 'Mara runs through {location} at dawn.')
  assert.deepEqual(result.missing, ['location'])
})

test('fillBlanks replaces every use of the same blank', () => {
  assert.equal(fillBlanks('{name} and {Name}', { name: 'Ari' }).text, 'Ari and Ari')
})

test('normalizeMyPrompt cleans fields and refuses empty text', () => {
  assert.equal(normalizeMyPrompt({ title: 'x', text: '   ' }), null)
  const prompt = normalizeMyPrompt({ text: 'A rainy rooftop at night\nmore', category: 'SHOT', tags: 'Noir, noir, rain' }, 1000)
  assert.equal(prompt.source, 'mine')
  assert.equal(prompt.category, 'shot')
  assert.deepEqual(prompt.tags, ['noir', 'rain'])
  assert.equal(prompt.title, 'A rainy rooftop at night')
  assert.match(prompt.id, /^mine:/)
  assert.equal(normalizeMyPrompt({ text: 'x', category: 'weird' }).category, 'other')
})

test('normalizeMyPrompt keeps a valid id and replaces a forged one', () => {
  assert.equal(normalizeMyPrompt({ id: 'mine:abcd-1234', text: 'x' }).id, 'mine:abcd-1234')
  assert.notEqual(normalizeMyPrompt({ id: 'starter:shot-closeup', text: 'x' }).id, 'starter:shot-closeup')
})

test('titleFromText uses the first line and shortens long ones', () => {
  assert.equal(titleFromText('\n\n  Hello there  \nsecond'), 'Hello there')
  assert.ok(titleFromText('a'.repeat(100)).endsWith('…'))
  assert.equal(titleFromText(''), 'Untitled prompt')
})

test('library file round-trips and drops bad data instead of throwing', () => {
  const mine = normalizeMyPrompt({ text: 'My prompt', category: 'idea' }, 5)
  const saved = serializeLibraryFile({ prompts: [mine, { ...STARTER_PROMPTS[0] }], favorites: ['starter:shot-closeup', 'starter:shot-closeup'], used: { [mine.id]: 9 } })
  const parsed = parseLibraryFile(saved)
  assert.equal(parsed.prompts.length, 1, 'only the user prompts are written')
  assert.equal(parsed.prompts[0].text, 'My prompt')
  assert.deepEqual(parsed.favorites, ['starter:shot-closeup'])
  assert.deepEqual(parsed.used, { [mine.id]: 9 })
  assert.deepEqual(parseLibraryFile('not json'), { prompts: [], favorites: [], used: {} })
  assert.deepEqual(parseLibraryFile({ prompts: 'x', favorites: {}, used: [] }).prompts, [])
})

test('isPackPromptFile accepts prompt text files but not read-mes or other files', () => {
  assert.ok(isPackPromptFile('prompts/rooftop_scene.txt'))
  assert.ok(isPackPromptFile('style.md'))
  assert.ok(!isPackPromptFile('README.txt'))
  assert.ok(!isPackPromptFile('docs/License.md'))
  assert.ok(!isPackPromptFile('story.fountain'))
  assert.ok(!isPackPromptFile('shots.csv'))
})

test('packFileToPrompt makes a read-only prompt with a stable id', () => {
  const prompt = packFileToPrompt({ slug: 'seedance-kit', packName: 'Seedance Kit', relPath: 'prompts\\negative_video.txt', text: 'flicker, jitter', importedAt: '2026-10-17T00:00:00Z' })
  assert.equal(prompt.id, 'pack:seedance-kit/prompts/negative_video.txt')
  assert.equal(prompt.source, 'pack')
  assert.equal(prompt.category, 'negative')
  assert.equal(prompt.title, 'Negative video')
  assert.deepEqual(prompt.tags, ['seedance kit'])
  assert.equal(packFileToPrompt({ slug: 's', relPath: 'a.txt', text: '  ' }), null)
})

test('searchPrompts ranks title matches first and needs every word', () => {
  const prompts = STARTER_PROMPTS
  const results = searchPrompts(prompts, { query: 'close-up' })
  assert.equal(results[0].id, 'starter:shot-closeup')
  assert.ok(searchPrompts(prompts, { query: 'noir zebra' }).length === 0)
  assert.ok(searchPrompts(prompts, { query: 'music' }).every((item) => item.category === 'music' || /music/i.test(item.title + item.text + item.tags.join(' '))))
})

test('searchPrompts views: favorites, recent, source and category', () => {
  const prompts = STARTER_PROMPTS
  const favorites = ['starter:style-noir']
  const used = { 'starter:shot-action': 2, 'starter:music-song': 5 }
  assert.deepEqual(searchPrompts(prompts, { view: 'favorites', favorites }).map((item) => item.id), ['starter:style-noir'])
  assert.deepEqual(searchPrompts(prompts, { view: 'recent', used }).map((item) => item.id), ['starter:music-song', 'starter:shot-action'])
  assert.ok(searchPrompts(prompts, { view: 'negative' }).every((item) => item.category === 'negative'))
  assert.equal(searchPrompts(prompts, { view: 'mine' }).length, 0)
  const all = searchPrompts(prompts, { favorites, used })
  assert.equal(all[0].id, 'starter:style-noir', 'favorites first')
  assert.equal(all[1].id, 'starter:music-song', 'then most recently used')
})

test('starter prompts have unique ids, known categories and valid blanks', () => {
  const ids = new Set()
  for (const item of STARTER_PROMPTS) {
    assert.ok(!ids.has(item.id), item.id)
    ids.add(item.id)
    assert.match(item.id, /^starter:[a-z0-9-]+$/)
    assert.notEqual(item.category, 'other')
    assert.ok(item.text.length > 20)
    // No unbalanced braces: everything in braces must be a valid blank.
    const braces = item.text.match(/\{[^}]*\}/g) || []
    assert.equal(braces.length, item.text.split('{').length - 1, `${item.id} has an unclosed brace`)
    assert.equal(extractBlanks(item.text).length, new Set(braces.map((b) => b.slice(1, -1).trim().toLowerCase().replace(/[\s_-]+/g, ' '))).size, `${item.id} has an invalid blank`)
  }
  assert.ok(STARTER_PROMPTS.length >= 20)
})

test('suggestionsForBlank offers cast names for character blanks only', () => {
  assert.deepEqual(suggestionsForBlank('character', { castNames: ['Mara', 'Leo'] }), ['Mara', 'Leo'])
  assert.deepEqual(suggestionsForBlank('other character', { castNames: ['Mara'] }), ['Mara'])
  assert.deepEqual(suggestionsForBlank('location', { castNames: ['Mara'] }), [])
})
