/**
 * SFX library schema (renderer side). The main process validates the catalog
 * at the trust boundary (electron/sfxCatalog.cjs); this module only shapes
 * and searches what main already accepted.
 *
 * @typedef {Object} SfxEntry
 * @property {string} id            Stable id, [A-Za-z0-9._-], unique in the catalog.
 * @property {string} name          Display name.
 * @property {string} category      Top-level category, e.g. "Impacts".
 * @property {string|null} subCategory
 * @property {string[]} tags        Lower-case search tags.
 * @property {number} duration      Seconds.
 * @property {number} fileSize      Bytes (exact; used for size checks and progress).
 * @property {string} remoteUrl     HTTPS URL on the catalog's origin (R2 / Hugging Face CDN).
 * @property {string|null} sha256   Hex digest; verified after download when present.
 * @property {string} format        File extension (wav, mp3, ogg, flac, …).
 * @property {string} localPath     Cache-relative path derived from category + id (never trusted from the catalog).
 * @property {string|null} license
 *
 * @typedef {Object} SfxCatalog
 * @property {1} version
 * @property {string} name
 * @property {string} baseUrl
 * @property {SfxEntry[]} entries
 * @property {number} dropped       Entries rejected by validation.
 *
 * @typedef {Object} SfxDragPayload  Carried as `application/x-drama-sfx`.
 * @property {string} id
 * @property {string} name
 * @property {number} duration
 */

export const SFX_DRAG_TYPE = 'application/x-drama-sfx'
export const SFX_SEARCH_LIMIT = 200

const norm = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
const words = value => norm(value).split(/[^a-z0-9]+/).filter(Boolean)

/** Precompute lower-cased search fields once per catalog load. */
export function buildSfxIndex(entries = []) {
  return entries.map(entry => ({
    entry,
    name: norm(entry.name),
    nameWords: words(entry.name),
    tagWords: (entry.tags || []).flatMap(words),
    categoryWords: [...words(entry.category), ...words(entry.subCategory)],
  }))
}

/** Is `needle` a subsequence of `hay`? ("ftstp" matches "footstep"). */
function subsequence(needle, hay) {
  let index = 0
  for (const char of hay) if (char === needle[index]) index += 1
  return index === needle.length
}

function tokenScore(token, item) {
  let best = 0
  const consider = (list, exact, prefix) => {
    for (const word of list) {
      if (word === token) best = Math.max(best, exact)
      else if (word.startsWith(token)) best = Math.max(best, prefix)
    }
  }
  consider(item.nameWords, 10, 7)
  consider(item.tagWords, 8, 5)
  consider(item.categoryWords, 6, 4)
  if (!best && item.name.includes(token)) best = 3
  // Abbreviations: "dr" → door, "slm" → slam (same first letter, letters in order).
  if (!best && [...item.nameWords, ...item.tagWords].some(word => word[0] === token[0] && subsequence(token, word))) best = 2
  if (!best && token.length >= 3 && subsequence(token, item.name.replace(/\s+/g, ''))) best = 1
  return best
}

/**
 * Fuzzy search: every query token must match (exact word, prefix, substring
 * or subsequence), ranked by match quality, then shorter names.
 * @param {ReturnType<typeof buildSfxIndex>} index
 * @param {string} query
 * @param {{ category?: string|null, subCategory?: string|null, limit?: number }} [filters]
 * @returns {{ results: SfxEntry[], total: number }}
 */
export function searchSfx(index, query, { category = null, subCategory = null, limit = SFX_SEARCH_LIMIT } = {}) {
  const tokens = words(query)
  const scored = []
  for (const item of index) {
    if (category && item.entry.category !== category) continue
    if (subCategory && item.entry.subCategory !== subCategory) continue
    let score = 0
    let matched = true
    for (const token of tokens) {
      const value = tokenScore(token, item)
      if (!value) { matched = false; break }
      score += value
    }
    if (matched) scored.push([score, item])
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].name.length - b[1].name.length || a[1].name.localeCompare(b[1].name))
  return { results: scored.slice(0, limit).map(([, item]) => item.entry), total: scored.length }
}

/** Category tree with counts: [{ name, count, subCategories: [{ name, count }] }]. */
export function listSfxCategories(entries = []) {
  const map = new Map()
  for (const entry of entries) {
    if (!map.has(entry.category)) map.set(entry.category, { name: entry.category, count: 0, subs: new Map() })
    const node = map.get(entry.category)
    node.count += 1
    if (entry.subCategory) node.subs.set(entry.subCategory, (node.subs.get(entry.subCategory) || 0) + 1)
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name)).map(node => ({
    name: node.name, count: node.count,
    subCategories: [...node.subs.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count })),
  }))
}

/** Parse a drag payload defensively (drops can come from other apps). */
export function parseSfxDragPayload(raw) {
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.id)) return null
    const duration = Number(value.duration)
    return { id: value.id, name: typeof value.name === 'string' ? value.name.slice(0, 200) : value.id,
      duration: Number.isFinite(duration) && duration > 0 ? duration : 1 }
  } catch { return null }
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)} GB`
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB`
  if (value >= 1e3) return `${Math.round(value / 1e3)} KB`
  return `${value} B`
}
