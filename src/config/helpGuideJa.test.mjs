import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { HELP_ARTICLES, HELP_ARTICLE_BY_ID, HELP_CATEGORIES } from './helpGuide.js'
import { HELP_JA } from './helpGuideJa/index.js'
import { compareHelpArticleStructure, localizeHelpArticles } from '../utils/helpLocale.mjs'
import { buildHelpIndex, searchHelp } from '../utils/helpSearch.mjs'

test('every Japanese article matches an English one, block for block', () => {
  const problems = []
  for (const [id, translated] of Object.entries(HELP_JA.articles)) {
    const english = HELP_ARTICLE_BY_ID[id]
    if (!english) { problems.push(`${id}: no English article`); continue }
    for (const problem of compareHelpArticleStructure(english, translated)) problems.push(`${id}: ${problem}`)
  }
  assert.deepEqual(problems, [])
})

test('every English article has a Japanese version', () => {
  const missing = HELP_ARTICLES.map((article) => article.id).filter((id) => !HELP_JA.articles[id])
  assert.deepEqual(missing, [])
})

test('every category has a Japanese title and blurb', () => {
  for (const category of HELP_CATEGORIES) {
    assert.ok(HELP_JA.categories[category.id]?.title, category.id)
    assert.ok(HELP_JA.categories[category.id]?.blurb, category.id)
  }
})

test('Japanese search finds articles by Japanese words', () => {
  const index = buildHelpIndex(localizeHelpArticles(HELP_ARTICLES, HELP_JA))
  const top = (query) => searchHelp(index, query)[0]?.article.id
  assert.equal(top('セットアップドクター'), 'setup-doctor')
  assert.equal(top('動画を書き出す'), 'export-video')
  assert.equal(top('字幕を翻訳'), 'translate-captions')
  assert.equal(top('吹き替え'), 'dubbing')
  assert.ok(searchHelp(index, '保存場所').some((result) => result.article.id === 'where-files-are-saved'))
  // English words still work on the Japanese guide.
  assert.equal(top('setup doctor'), 'setup-doctor')
})

test('translations keep the app name and bold markers balanced', () => {
  for (const [id, article] of Object.entries(HELP_JA.articles)) {
    const text = JSON.stringify(article)
    // The lowercase .comfystudio project file name is a kept compatibility name.
    assert.ok(!/ComfyStudio/.test(text), `${id} mentions the old name`)
    for (const block of article.body) {
      const strings = [block.text, ...(block.items || []), ...(block.head || []), ...(block.rows || []).flat()].filter((value) => typeof value === 'string')
      for (const value of strings) assert.equal((value.match(/\*\*/g) || []).length % 2, 0, `${id}: unbalanced ** in "${value.slice(0, 40)}"`)
    }
  }
})

test('every diagram label has a Japanese version, and none are stale', () => {
  const source = readFileSync(new URL('../components/help/HelpVisuals.jsx', import.meta.url), 'utf8')
  const labels = new Set()
  const patterns = [
    /\b(?:title|sub|caption)="([^"]+)"/g,
    /\btr\('([^']+)'\)/g,
    /\b(?:title|sub|label): '([^']+)'/g,
    /^\s+'([^']+)',$/gm,
    /\[\w+, '([^']+)'\]/g,
    /card\([^,]+, '([^']+)'/g,
  ]
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) labels.add(match[1])
  for (const tab of ['Idea Pad', 'Motion Studio', 'Generate', 'Stock']) labels.add(tab)
  // Names that stay as they are in every language.
  const keep = new Set(['ComfyUI', 'project.comfystudio', 'assets/', 'video/', 'images/', 'audio/', 'renders/', 'autosave/', 'cache/'])
  const missing = [...labels].filter((label) => !keep.has(label) && !HELP_JA.visuals[label])
  assert.deepEqual(missing, [])
  const stale = Object.keys(HELP_JA.visuals).filter((key) => !source.includes(key))
  assert.deepEqual(stale, [])
})
