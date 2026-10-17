/**
 * search_help: the user Help Center (src/config/helpGuide.js) for AI agents,
 * so how-to answers come from the same plain-language guide users read.
 * Read-only.
 */

import { HELP_ARTICLE_BY_ID, HELP_ARTICLES, HELP_CATEGORIES } from '../config/helpGuide'
import { buildHelpIndex, searchHelp } from '../utils/helpSearch.mjs'

let index = null
const CATEGORY_TITLES = Object.fromEntries(HELP_CATEGORIES.map((category) => [category.id, category.title]))

const strip = (text) => String(text ?? '').replace(/\*\*/g, '')

/** Plain text of one article, the way a user reads it (diagrams and buttons omitted). */
export function helpArticleToText(article) {
  const lines = [`# ${article.title}`, strip(article.summary), '']
  for (const block of article.body || []) {
    if (block.type === 'p') lines.push(strip(block.text), '')
    else if (block.type === 'steps') lines.push(...block.items.map((item, i) => `${i + 1}. ${strip(item)}`), '')
    else if (block.type === 'list') lines.push(...block.items.map((item) => `- ${strip(item)}`), '')
    else if (['tip', 'note', 'warn'].includes(block.type)) lines.push(`${block.type === 'tip' ? 'Tip' : block.type === 'warn' ? 'Heads up' : 'Note'}: ${strip(block.text)}`, '')
    else if (block.type === 'table') {
      lines.push(block.head.map(strip).join(' | '))
      lines.push(...block.rows.map((row) => row.map(strip).join(' | ')), '')
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function handleSearchHelp(payload = {}) {
  if (!index) index = buildHelpIndex(HELP_ARTICLES)
  const articleId = String(payload.articleId || '').trim()
  if (articleId) {
    const article = HELP_ARTICLE_BY_ID[articleId]
    if (!article) throw new Error(`No Help article "${articleId}". Search with a query instead.`)
    return { action: 'search_help', articles: [{ id: article.id, topic: CATEGORY_TITLES[article.category], text: helpArticleToText(article) }] }
  }
  const query = String(payload.query || '').trim()
  if (!query) {
    return {
      action: 'search_help',
      message: 'Pass a query (for example "export subtitles") or an articleId.',
      topics: HELP_CATEGORIES.map((category) => ({ topic: category.title, articles: HELP_ARTICLES.filter((a) => a.category === category.id).map((a) => ({ id: a.id, title: a.title })) })),
    }
  }
  const limit = Math.max(1, Math.min(5, Number(payload.limit) || 3))
  const results = searchHelp(index, query, { limit })
  if (results.length === 0) {
    return { action: 'search_help', articles: [], message: 'The Help Center has no article for this. Say so, and suggest Help (F1) or Settings > Send Feedback.' }
  }
  return {
    action: 'search_help',
    articles: results.map((result, position) => ({
      id: result.article.id,
      topic: CATEGORY_TITLES[result.article.category],
      // Full text for the best matches, titles for the rest.
      ...(position < 2 ? { text: helpArticleToText(result.article) } : { title: result.article.title, summary: result.article.summary }),
    })),
  }
}
