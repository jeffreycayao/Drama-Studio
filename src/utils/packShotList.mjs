/**
 * Templates kept by Import pack (userData/imported-packs/<slug>/), turned
 * into Short Film input. Pure and deterministic; the renderer service reads
 * the files, this decides what they are:
 *   .csv / .tsv (and JSON arrays of rows) → shots for the Shot Plan
 *   .fountain                             → the screenplay
 *   .txt / .md                            → the screenplay or the premise
 * Nothing in a template is run; it only ever becomes text in a field.
 *
 * @typedef {{ id: string, scene: string, title: string, type: string,
 *   locationSlug: string, characterSlug: string, dialogueId: string,
 *   keyframe: string, motion: string, duration: number }} ShortFilmShot
 */

export const PACK_TEMPLATE_MAX_SHOTS = 300
export const PACK_TEMPLATE_DEFAULT_DURATION = 5

const SHOT_LIST_EXTENSIONS = new Set(['csv', 'tsv'])
const SCRIPT_EXTENSIONS = new Set(['fountain', 'spmd'])
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown'])
export const PACK_TEMPLATE_EXTENSIONS = new Set([...SHOT_LIST_EXTENSIONS, ...SCRIPT_EXTENSIONS, ...TEXT_EXTENSIONS, 'json'])

// Column names creators use, compared after lowercasing and dropping
// punctuation ("Shot #" → "shot", "Keyframe Prompt" → "keyframe prompt").
const FIELD_ALIASES = {
  label: ['shot', 'shot no', 'shot number', 'shot num', 'no', 'number', 'num', 'id', 'index'],
  title: ['title', 'name', 'shot title', 'shot name', 'heading', 'beat', 'summary'],
  keyframe: ['prompt', 'description', 'desc', 'shot description', 'scene description', 'keyframe', 'keyframe prompt',
    'image prompt', 'still prompt', 'start frame', 'first frame', 'visual', 'visuals', 'action', 'image', 'text', 'positive', 'positive prompt'],
  motion: ['motion', 'motion prompt', 'video prompt', 'movement', 'animation', 'i2v prompt', 'video'],
  camera: ['camera', 'camera movement', 'camera move', 'lens', 'framing'],
  duration: ['duration', 'length', 'seconds', 'secs', 'sec', 'time', 'len', 'duration s', 'length s', 'duration sec', 'duration seconds'],
  type: ['type', 'shot type', 'size', 'shot size', 'angle'],
  scene: ['scene', 'scene name', 'scene title', 'sequence'],
  location: ['location', 'setting', 'place', 'loc', 'location slug'],
  character: ['character', 'characters', 'cast', 'subject', 'characters visible', 'character slug'],
}
const FIELD_BY_ALIAS = new Map(Object.entries(FIELD_ALIASES).flatMap(([field, aliases]) => aliases.map((alias) => [alias, field])))
const CONTENT_FIELDS = new Set(['title', 'keyframe', 'motion'])

export const normalizeColumnName = (name) => String(name || '')
  .replace(/^﻿/, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

export const fieldForColumn = (name) => FIELD_BY_ALIAS.get(normalizeColumnName(name)) || ''

export const extensionOf = (name) => {
  const match = /\.([^./\\]+)$/.exec(String(name || ''))
  return match ? match[1].toLowerCase() : ''
}

const compact = (value, maxLength = 900) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`
}

/** Tab for .tsv; otherwise whichever of , ; or tab the header line uses most. */
export function detectDelimiter(text, fileName = '') {
  if (extensionOf(fileName) === 'tsv') return '\t'
  const firstLine = String(text || '').replace(/^﻿/, '').split(/\r?\n/, 1)[0] || ''
  const counts = [',', ';', '\t'].map((delimiter) => [delimiter, firstLine.split(delimiter).length - 1])
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ','
}

/**
 * RFC 4180-style rows: quoted fields, "" escapes, line breaks inside quotes,
 * CRLF or LF, a leading BOM. Blank lines are dropped.
 */
export function parseDelimited(text, delimiter = ',') {
  const source = String(text || '').replace(/^﻿/, '')
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1 } else quoted = false
      } else field += char
      continue
    }
    if (char === '"' && field.trim() === '') { quoted = true; field = ''; continue }
    if (char === delimiter) { row.push(field); field = ''; continue }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    field += char
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
    .map((cells) => cells.map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell !== ''))
}

/** "4", "4s", "4 sec", "0:04", "1.5" → whole seconds, 1–30. */
export function parseDurationSeconds(value, fallback = PACK_TEMPLATE_DEFAULT_DURATION) {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return fallback
  const clock = /^(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(text)
  const parsed = clock ? Number(clock[1]) * 60 + Number(clock[2]) : Number((/(\d+(?:[.,]\d+)?)/.exec(text) || [])[1]?.replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.max(1, Math.min(30, Math.round(parsed)))
}

const inferShotType = (text) => {
  const value = String(text || '').toLowerCase()
  if (/\b(drone|aerial|establishing|wide|epic)\b/.test(value)) return 'wide'
  if (/\b(close-up|close up|closeup|portrait|ecu|mcu)\b/.test(value)) return 'close-up'
  if (/\b(insert|detail)\b/.test(value)) return 'insert'
  if (/\breaction\b/.test(value)) return 'reaction'
  if (/\bcutaway\b/.test(value)) return 'cutaway'
  if (/\b(two[\s-]?shot)\b/.test(value)) return 'two-shot'
  return 'shot'
}

const findBy = (entries, value) => {
  const wanted = String(value || '').trim().toLowerCase()
  if (!wanted) return null
  const slugged = wanted.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return entries.find((entry) => (
    String(entry?.slug || '').toLowerCase() === wanted
    || String(entry?.slug || '').toLowerCase() === slugged
    || String(entry?.name || '').trim().toLowerCase() === wanted
  )) || null
}

const isNumberLabel = (value) => /^(?:shot\s*)?#?\s*\d+[a-z]?$/i.test(String(value || '').trim())

/**
 * Rows keyed by field (label, title, keyframe, motion, camera, duration,
 * type, scene, location, character) → Short Film shots. Rows with nothing to
 * film are skipped. Locations and characters are matched to the cast by slug
 * or name; an unknown location falls back to the first one.
 *
 * @returns {{ shots: ShortFilmShot[], skippedRows: number, truncated: boolean,
 *   unmatchedLocations: string[], unmatchedCharacters: string[] }}
 */
export function rowsToShots(rows, { locations = [], characters = [], sceneLabel = '', maxShots = PACK_TEMPLATE_MAX_SHOTS } = {}) {
  const fallbackLocation = String(locations[0]?.slug || '')
  const unmatchedLocations = new Set()
  const unmatchedCharacters = new Set()
  const shots = []
  let skippedRows = 0
  let truncated = false
  for (const row of Array.isArray(rows) ? rows : []) {
    const get = (field) => compact(row?.[field])
    const label = get('label')
    const prompt = get('keyframe')
    const motionText = get('motion')
    const camera = get('camera')
    let title = compact(get('title'), 120)
    if (!title && label && !isNumberLabel(label)) title = compact(label, 120)
    if (!prompt && !title && !motionText) { skippedRows += 1; continue }
    if (shots.length >= maxShots) { truncated = true; break }
    const number = shots.length + 1
    if (!title) title = prompt ? compact(prompt, 60) : `Shot ${number}`

    const locationText = get('location')
    const location = findBy(locations, locationText)
    if (locationText && !location) unmatchedLocations.add(locationText)
    // "james, mara" → the first cast member that matches.
    const characterNames = get('character').split(/[,;/&]|\band\b/i).map((name) => name.trim()).filter(Boolean)
    const character = characterNames.map((name) => findBy(characters, name)).find(Boolean) || null
    for (const name of characterNames) {
      if (!findBy(characters, name) && !/^(none|n\/a|-)$/i.test(name)) unmatchedCharacters.add(name)
    }

    const keyframe = prompt || title
    shots.push({
      id: `shot-${String(number).padStart(3, '0')}`,
      scene: compact(get('scene'), 120) || sceneLabel || 'Shot list',
      title,
      type: compact(get('type'), 40).toLowerCase() || inferShotType(`${title} ${prompt}`),
      locationSlug: location?.slug || fallbackLocation,
      characterSlug: character?.slug || '',
      dialogueId: '',
      keyframe,
      motion: compact([camera, motionText || prompt || title].filter(Boolean).join('. ')),
      duration: parseDurationSeconds(get('duration')),
    })
  }
  return {
    shots,
    skippedRows,
    truncated,
    unmatchedLocations: [...unmatchedLocations],
    unmatchedCharacters: [...unmatchedCharacters],
  }
}

/**
 * Delimited text → rows keyed by field. A first row with at least one known
 * content column (prompt, description, title, motion…) is the header.
 * Without one: one column is the prompt; with more, the first is the shot
 * label, the second the prompt and a numeric third the length.
 */
export function shotRowsFromDelimited(text, fileName = '') {
  const table = parseDelimited(text, detectDelimiter(text, fileName))
  if (!table.length) return { rows: [], columns: [], ignoredColumns: [], hasHeader: false }
  const headerFields = table[0].map(fieldForColumn)
  const hasHeader = headerFields.some((field) => CONTENT_FIELDS.has(field))
  if (hasHeader) {
    const used = new Set()
    // The first column for a field wins ("Prompt" and "Description" → prompt).
    const fields = headerFields.map((field) => {
      if (!field || used.has(field)) return ''
      used.add(field)
      return field
    })
    const rows = table.slice(1).map((cells) => Object.fromEntries(
      fields.map((field, index) => [field, cells[index] ?? '']).filter(([field]) => field),
    ))
    return {
      rows,
      columns: table[0].filter((_, index) => fields[index]),
      ignoredColumns: table[0].filter((name, index) => !fields[index] && String(name).trim()),
      hasHeader: true,
    }
  }
  const rows = table.map((cells) => {
    if (cells.length === 1) return { keyframe: cells[0] }
    const row = { label: cells[0], keyframe: cells[1] }
    if (cells.length > 2 && /^\s*\d+(?:[.,]\d+)?\s*(?:s|sec|secs|seconds)?\s*$/i.test(cells[2])) row.duration = cells[2]
    return row
  })
  return { rows, columns: [], ignoredColumns: [], hasHeader: false }
}

/** JSON array of rows (or { shots | rows | items: [...] }, or prompts as strings) → rows keyed by field. */
export function shotRowsFromJson(value) {
  const list = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' ? (value.shots || value.rows || value.items || value.shotList || null) : null)
  if (!Array.isArray(list) || !list.length) return null
  const rows = []
  for (const entry of list) {
    if (typeof entry === 'string') { rows.push({ keyframe: entry }); continue }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const row = {}
    for (const [key, raw] of Object.entries(entry)) {
      const field = fieldForColumn(key)
      if (!field || field in row) continue
      if (typeof raw === 'string' || typeof raw === 'number') row[field] = String(raw)
      else if (Array.isArray(raw) && raw.every((item) => typeof item === 'string')) row[field] = raw.join(', ')
    }
    rows.push(row)
  }
  return rows.some((row) => row.keyframe || row.title || row.motion) ? rows : null
}

/** A prompt-style JSON template ({ "prompt": "…" }) → its text, else ''. */
function textFromJson(value) {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  for (const key of ['prompt', 'text', 'description', 'premise', 'idea', 'positive']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key]
  }
  return ''
}

/**
 * What a kept template can become in Short Film.
 * @returns {{ kind: 'shots', shots: ShortFilmShot[], columns: string[], ignoredColumns: string[],
 *     skippedRows: number, truncated: boolean, unmatchedLocations: string[], unmatchedCharacters: string[] }
 *   | { kind: 'script' | 'text', text: string }
 *   | { kind: 'unsupported', reason: 'empty' | 'format' | 'no-shots' }}
 */
export function interpretPackTemplate(fileName, text, options = {}) {
  const ext = extensionOf(fileName)
  const source = String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  if (!source.trim()) return { kind: 'unsupported', reason: 'empty' }
  if (SHOT_LIST_EXTENSIONS.has(ext)) {
    const parsed = shotRowsFromDelimited(source, fileName)
    const result = rowsToShots(parsed.rows, options)
    if (!result.shots.length) return { kind: 'unsupported', reason: 'no-shots' }
    return { kind: 'shots', columns: parsed.columns, ignoredColumns: parsed.ignoredColumns, ...result }
  }
  if (SCRIPT_EXTENSIONS.has(ext)) return { kind: 'script', text: source.trim() }
  if (TEXT_EXTENSIONS.has(ext)) return { kind: 'text', text: source.trim() }
  if (ext === 'json') {
    let value
    try { value = JSON.parse(source) } catch { return { kind: 'unsupported', reason: 'format' } }
    const rows = shotRowsFromJson(value)
    if (rows) {
      const result = rowsToShots(rows, options)
      if (result.shots.length) return { kind: 'shots', columns: [], ignoredColumns: [], ...result }
    }
    const prompt = textFromJson(value).trim()
    return prompt ? { kind: 'text', text: prompt } : { kind: 'unsupported', reason: 'format' }
  }
  return { kind: 'unsupported', reason: 'format' }
}

/** Kind shown in the picker before a file is read. */
export function packTemplateKindFromName(fileName) {
  const ext = extensionOf(fileName)
  if (SHOT_LIST_EXTENSIONS.has(ext)) return 'shots'
  if (SCRIPT_EXTENSIONS.has(ext)) return 'script'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  if (ext === 'json') return 'json'
  return ''
}

/**
 * A path from pack.json is only used if it stays inside the pack folder:
 * relative, no "..", no drive letter, no control characters.
 */
export function isSafePackRelativePath(rel) {
  const text = String(rel || '')
  if (!text || text.length > 400 || /[\x00-\x1f]/.test(text)) return false
  if (/^[\\/]/.test(text) || /^[A-Za-z]:/.test(text)) return false
  const parts = text.split(/[\\/]/)
  return parts.every((part) => part !== '' && part !== '.' && part !== '..')
}

const README_NAME = /^(readme|read[\s_-]*me|about|instructions|使い方|説明|お読みください)(\.[a-z0-9]+)?$/i

/** pack.json "files" → the templates Short Film can use (not the read-me). */
export function templateFilesFromPackRecord(files) {
  const seen = new Set()
  const result = []
  for (const rel of Array.isArray(files) ? files : []) {
    if (typeof rel !== 'string' || !isSafePackRelativePath(rel)) continue
    const name = rel.split(/[\\/]/).pop()
    if (README_NAME.test(name) || !PACK_TEMPLATE_EXTENSIONS.has(extensionOf(name))) continue
    const key = rel.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ rel, name, kind: packTemplateKindFromName(name) })
  }
  return result
}

/** "seedance_long-shot_v2.csv" → "seedance long-shot v2". */
export const templateTitleFromFileName = (name) => String(name || '')
  .split(/[\\/]/).pop()
  .replace(/\.[^.]+$/, '')
  .replace(/_+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim() || 'Untitled'
