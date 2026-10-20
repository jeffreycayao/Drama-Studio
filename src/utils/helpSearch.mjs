/**
 * Search for the Help Center (`src/config/helpGuide.js`).
 *
 * Pure and dependency-free so it can be unit tested. Ranks articles by where
 * the query words appear (title > the way people ask it > keywords > summary
 * > body), expands everyday words to the app's terms ("dub" also finds
 * "translate", "sfx" finds "sound effects"), and returns a short snippet
 * from the body for the result list.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'at', 'from',
  'how', 'do', 'does', 'did', 'i', 'my', 'me', 'we', 'our', 'you', 'your', 'is', 'are', 'was',
  'be', 'it', 'its', 'this', 'that', 'there', 'can', 'could', 'should', 'what', 'where', 'when',
  'why', 'which', 'who', 'will', 'would', 'get', 'want', 'need', 'make', 'use', 'using', 'please',
])

// Everyday word -> the words the guide uses. Expanded matches count less
// than the word the user typed.
const SYNONYMS = {
  dub: ['dubbing', 'translate', 'language'],
  dubbing: ['dub', 'translate'],
  translate: ['dubbing', 'language'],
  lipsync: ['lip', 'sync'],
  sync: ['lip', 'sync'],
  sfx: ['sound', 'effects'],
  foley: ['sound', 'effects'],
  song: ['music'],
  songs: ['music'],
  soundtrack: ['music'],
  subtitle: ['captions'],
  subtitles: ['captions'],
  caption: ['captions'],
  srt: ['captions', 'subtitle'],
  render: ['export'],
  mp4: ['export'],
  save: ['saved', 'folder'],
  saved: ['save', 'folder'],
  stored: ['saved', 'folder'],
  locally: ['local', 'saved'],
  gpu: ['graphics', 'vram'],
  vram: ['gpu', 'graphics', 'memory'],
  nvidia: ['gpu', 'graphics'],
  pic: ['image'],
  pics: ['image'],
  picture: ['image'],
  photo: ['image'],
  photos: ['image'],
  img: ['image'],
  vid: ['video'],
  clip: ['video', 'clips'],
  t2v: ['text', 'video'],
  i2v: ['image', 'video'],
  t2i: ['text', 'image'],
  animate: ['image', 'video', 'motion'],
  voiceover: ['voice'],
  narration: ['voice'],
  tts: ['voice', 'speech'],
  llm: ['assistant', 'ollama', 'local'],
  chat: ['assistant'],
  chatbot: ['assistant'],
  mcp: ['assistant', 'agents'],
  agent: ['assistant'],
  claude: ['assistant', 'claude'],
  codex: ['assistant', 'codex'],
  folder: ['files', 'saved'],
  files: ['folder', 'saved'],
  download: ['downloaded', 'saved', 'models'],
  downloaded: ['download', 'saved'],
  cost: ['credits', 'cloud'],
  price: ['credits', 'cost'],
  pay: ['credits', 'cost'],
  money: ['credits', 'cost'],
  free: ['local', 'free'],
  crash: ['autosave', 'recover'],
  crashed: ['autosave', 'recover'],
  lost: ['recover', 'autosave'],
  tiktok: ['vertical', 'social'],
  reels: ['vertical', 'social'],
  shorts: ['vertical', 'social'],
  instagram: ['social', 'vertical'],
  slow: ['slow', 'performance'],
  lag: ['playback', 'choppy'],
  error: ['failed'],
  broken: ['failed', 'missing'],
  character: ['cast', 'consistent'],
  face: ['cast', 'character'],
  premiere: ['handoff', 'xml'],
  resolve: ['handoff', 'xml'],
}

/** Lowercase, drop markdown bold and punctuation, collapse whitespace. */
export function normalizeHelpText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\*\*/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function stem(word) {
  if (word.length <= 4) return word
  for (const suffix of ['ing', 'ies', 'es', 'ed', 's']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return suffix === 'ies' ? `${word.slice(0, -3)}y` : word.slice(0, -suffix.length)
    }
  }
  return word
}

export function tokenizeHelpQuery(query) {
  const words = normalizeHelpText(query).split(' ').filter(Boolean)
  const meaningful = words.filter((word) => !STOPWORDS.has(word))
  return [...new Set(meaningful)]
}

function blockText(block) {
  if (!block || typeof block !== 'object') return ''
  if (typeof block.text === 'string') return block.text
  if (Array.isArray(block.items)) return block.items.join(' ')
  if (block.type === 'table') return [...(block.head || []), ...(block.rows || []).flat()].join(' ')
  if (block.type === 'action') return block.label || ''
  return ''
}

/** Plain body sentences, kept for snippets. */
function bodySentences(article) {
  const sentences = []
  for (const block of article.body || []) {
    if (Array.isArray(block.items)) sentences.push(...block.items)
    else if (block.type === 'table') (block.rows || []).forEach((row) => sentences.push(row.join(' — ')))
    else if (typeof block.text === 'string') sentences.push(...block.text.split(/(?<=[.!?])\s+/))
  }
  return sentences.map((sentence) => String(sentence).replace(/\*\*/g, '').trim()).filter(Boolean)
}

function wordSet(text) {
  const words = normalizeHelpText(text).split(' ').filter(Boolean)
  return { words, set: new Set(words.flatMap((word) => [word, stem(word)])) }
}

/** Precompute the searchable fields once per guide. */
export function buildHelpIndex(articles = []) {
  return articles.map((article) => {
    const body = (article.body || []).map(blockText).join(' ')
    return {
      article,
      title: wordSet(article.title),
      questions: wordSet((article.questions || []).join(' ')),
      keywords: wordSet((article.keywords || []).join(' ')),
      summary: wordSet(article.summary),
      body: wordSet(body),
      phraseFields: [normalizeHelpText(article.title), ...(article.questions || []).map(normalizeHelpText)],
      sentences: bodySentences(article),
    }
  })
}

const FIELD_WEIGHTS = [
  ['title', 8, 4],
  ['questions', 6, 3],
  ['keywords', 5, 3],
  ['summary', 3, 1.5],
  ['body', 1.5, 0.5],
]

function fieldScore(field, token, exactWeight, prefixWeight) {
  const stemmed = stem(token)
  if (field.set.has(token) || field.set.has(stemmed)) return exactWeight
  if (token.length >= 3 && field.words.some((word) => word.startsWith(token) || (stemmed.length >= 3 && word.startsWith(stemmed)))) {
    return prefixWeight
  }
  return 0
}

function tokenScore(entry, token) {
  let best = 0
  let total = 0
  for (const [name, exact, prefix] of FIELD_WEIGHTS) {
    const score = fieldScore(entry[name], token, exact, prefix)
    best = Math.max(best, score)
    total += score
  }
  // The best field dominates; other fields add a little so an article about
  // the word beats one that only mentions it.
  return best + (total - best) * 0.25
}

function buildSnippet(entry, tokens) {
  const lowered = tokens.map((token) => stem(token))
  const hit = entry.sentences.find((sentence) => {
    const words = normalizeHelpText(sentence).split(' ')
    return lowered.some((token) => words.some((word) => word.startsWith(token)))
  })
  const text = hit || entry.article.summary || ''
  return text.length > 170 ? `${text.slice(0, 167).trimEnd()}…` : text
}

/**
 * @returns {Array<{ article: object, score: number, snippet: string }>}
 *   best match first; empty for an empty or all-stopword query.
 */
export function searchHelp(index, query, { limit = 12, minRelativeScore = 0.3 } = {}) {
  const tokens = tokenizeHelpQuery(query)
  if (tokens.length === 0) return []
  const phrase = normalizeHelpText(query)
  const results = []
  for (const entry of index) {
    let score = 0
    let matched = 0
    for (const token of tokens) {
      let value = tokenScore(entry, token)
      if (value === 0) {
        const expansions = SYNONYMS[token] || []
        value = Math.max(0, ...expansions.map((alt) => tokenScore(entry, alt))) * 0.6
      }
      if (value > 0) matched += 1
      score += value
    }
    if (matched === 0) continue
    score *= 0.5 + 0.5 * (matched / tokens.length)
    if (phrase.length >= 4 && entry.phraseFields.some((field) => field.includes(phrase))) score += 12
    results.push({ article: entry.article, score, snippet: buildSnippet(entry, tokens) })
  }
  results.sort((left, right) => right.score - left.score || left.article.title.localeCompare(right.article.title))
  // Drop the long tail of articles that only brush one common word.
  const floor = (results[0]?.score || 0) * minRelativeScore
  return results.filter((result) => result.score >= floor).slice(0, limit)
}
