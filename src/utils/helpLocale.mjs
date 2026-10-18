// Help Center translations. A language pack holds, per article id, the
// translated title, summary, questions, keywords and body; anything missing
// falls back to the English guide in src/config/helpGuide.js.

/** Language packs that exist, by app language code. */
export const HELP_LANGUAGE_PACKS = Object.freeze(['ja'])

export function helpPackLanguage(language) {
  const code = String(language || '').toLowerCase()
  if (code === 'jp' || code.startsWith('ja')) return 'ja'
  return null
}

/**
 * @param {object[]} articles English articles
 * @param {{ articles?: object }} pack
 * @returns {object[]} articles in pack order, translated where the pack has them.
 *   Searches still match the English questions and keywords.
 */
export function localizeHelpArticles(articles, pack) {
  if (!pack?.articles) return articles
  return articles.map((article) => {
    const translated = pack.articles[article.id]
    if (!translated) return { ...article, translated: false }
    return {
      ...article,
      title: translated.title || article.title,
      summary: translated.summary || article.summary,
      body: Array.isArray(translated.body) ? translated.body : article.body,
      questions: [...(translated.questions || []), ...(article.questions || [])],
      keywords: [...(translated.keywords || []), ...(article.keywords || [])],
      translated: true,
    }
  })
}

export function localizeHelpCategories(categories, pack) {
  if (!pack?.categories) return categories
  return categories.map((category) => ({ ...category, ...(pack.categories[category.id] || {}) }))
}

/** [id, question] pairs for the Help home "Common questions" list. */
export function localizePopularQuestions(popular, pack) {
  if (!pack?.popular) return popular
  return popular.map(([id, question]) => [id, pack.popular[id] || question])
}

/**
 * Structure problems between an English article and its translation: the
 * translation must keep every block, in order, with the same types, visuals,
 * actions, list lengths and table shapes. Returns [] when they match.
 */
export function compareHelpArticleStructure(english, translated) {
  const problems = []
  const source = english?.body || []
  const target = translated?.body || []
  if (!translated?.title) problems.push('missing title')
  if (!translated?.summary) problems.push('missing summary')
  if (source.length !== target.length) {
    problems.push(`body has ${target.length} blocks, English has ${source.length}`)
    return problems
  }
  source.forEach((block, index) => {
    const other = target[index] || {}
    const where = `block ${index} (${block.type})`
    if (other.type !== block.type) { problems.push(`${where}: type ${other.type}`); return }
    if (block.type === 'visual' && other.id !== block.id) problems.push(`${where}: visual ${other.id}`)
    if (block.type === 'action') {
      if (other.action !== block.action) problems.push(`${where}: action ${other.action}`)
      if (!other.label) problems.push(`${where}: missing label`)
    }
    if (Array.isArray(block.items) && (other.items || []).length !== block.items.length) {
      problems.push(`${where}: ${(other.items || []).length} items, English has ${block.items.length}`)
    }
    if (block.type === 'table') {
      if ((other.head || []).length !== block.head.length) problems.push(`${where}: head width`)
      if ((other.rows || []).length !== block.rows.length) problems.push(`${where}: ${(other.rows || []).length} rows, English has ${block.rows.length}`)
      else block.rows.forEach((row, rowIndex) => {
        if ((other.rows[rowIndex] || []).length !== row.length) problems.push(`${where}: row ${rowIndex} width`)
      })
    }
    if (typeof block.text === 'string' && !String(other.text || '').trim()) problems.push(`${where}: missing text`)
  })
  return problems
}
