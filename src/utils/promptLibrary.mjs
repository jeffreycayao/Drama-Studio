// Prompt library: plain data and pure helpers (no React, no Electron).
//
// Three sources are merged into one list:
//   starter  built in (STARTER_PROMPTS), read-only
//   pack     prompt templates kept from imported packs, read-only
//   mine     prompts the user saved; the only ones that can be edited
// Favorites and "last used" are stored by id for every source, so a starter
// or pack prompt can be starred without copying it.
//
// Blanks are written {like this}. fillBlanks() swaps them for values; a blank
// with no value is left as it was, so nothing silently disappears.

export const PROMPT_LIBRARY_VERSION = 1
export const MAX_PROMPT_TEXT = 20000
export const MAX_PROMPT_TITLE = 120
export const MAX_MY_PROMPTS = 2000
const MAX_TAGS = 12
const MAX_TAG_LENGTH = 32

export const PROMPT_CATEGORIES = [
  { id: 'idea', label: 'Ideas and loglines' },
  { id: 'outline', label: 'Stories and outlines' },
  { id: 'shot', label: 'Shots (image and video)' },
  { id: 'style', label: 'Styles and camera' },
  { id: 'character', label: 'Characters' },
  { id: 'voice', label: 'Voices and dialogue' },
  { id: 'music', label: 'Music' },
  { id: 'sound', label: 'Sound effects' },
  { id: 'negative', label: 'Things to avoid' },
  { id: 'other', label: 'Other' },
]
const CATEGORY_IDS = new Set(PROMPT_CATEGORIES.map((item) => item.id))

export function categoryLabel(id) {
  return PROMPT_CATEGORIES.find((item) => item.id === id)?.label || 'Other'
}

const BLANK_PATTERN = /\{([A-Za-z][A-Za-z0-9 _-]{0,39})\}/g

function blankKey(name) {
  return String(name || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ')
}

/** The blanks in a prompt, in order of first use: [{ key, label }]. */
export function extractBlanks(text) {
  const seen = new Map()
  for (const match of String(text || '').matchAll(BLANK_PATTERN)) {
    const key = blankKey(match[1])
    if (key && !seen.has(key)) seen.set(key, { key, label: match[1].trim() })
  }
  return [...seen.values()]
}

/**
 * Replace {blanks} with values (looked up case- and spacing-insensitively).
 * Returns the text and the blanks still empty.
 */
export function fillBlanks(text, values = {}) {
  const lookup = new Map()
  for (const [name, value] of Object.entries(values || {})) {
    const clean = String(value ?? '').trim()
    if (clean) lookup.set(blankKey(name), clean)
  }
  const missing = new Set()
  const filled = String(text || '').replace(BLANK_PATTERN, (whole, name) => {
    const value = lookup.get(blankKey(name))
    if (value) return value
    missing.add(name.trim())
    return whole
  })
  return { text: filled, missing: [...missing] }
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max)
}

function cleanTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',')
  const seen = new Set()
  const result = []
  for (const tag of list) {
    const clean = String(tag || '').trim().toLowerCase().slice(0, MAX_TAG_LENGTH)
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    result.push(clean)
    if (result.length >= MAX_TAGS) break
  }
  return result
}

export function normalizeCategory(value) {
  const id = String(value || '').trim().toLowerCase()
  return CATEGORY_IDS.has(id) ? id : 'other'
}

/** A prompt the user saved, cleaned up. Returns null when it has no text. */
export function normalizeMyPrompt(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null
  const text = cleanText(raw.text, MAX_PROMPT_TEXT)
  if (!text) return null
  const id = /^mine:[a-z0-9-]{4,64}$/.test(String(raw.id || '')) ? String(raw.id) : newPromptId(now)
  const title = cleanText(raw.title, MAX_PROMPT_TITLE) || titleFromText(text)
  const createdAt = Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : now
  return {
    id,
    title,
    text,
    category: normalizeCategory(raw.category),
    tags: cleanTags(raw.tags),
    source: 'mine',
    createdAt,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : createdAt,
  }
}

let idCounter = 0
export function newPromptId(now = Date.now()) {
  idCounter = (idCounter + 1) % 1679616
  const random = Math.floor(Math.random() * 1679616).toString(36).padStart(4, '0')
  return `mine:${now.toString(36)}-${idCounter.toString(36)}${random}`
}

export function titleFromText(text) {
  const firstLine = String(text || '').split('\n').map((line) => line.trim()).find(Boolean) || 'Untitled prompt'
  return firstLine.length > 60 ? `${firstLine.slice(0, 57).trimEnd()}…` : firstLine
}

/** The saved library file → { prompts, favorites, used }. Bad data is dropped, never thrown. */
export function parseLibraryFile(raw) {
  let data = raw
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw) } catch { data = null }
  }
  const prompts = []
  const ids = new Set()
  for (const item of Array.isArray(data?.prompts) ? data.prompts : []) {
    const prompt = normalizeMyPrompt(item)
    if (!prompt || ids.has(prompt.id)) continue
    ids.add(prompt.id)
    prompts.push(prompt)
    if (prompts.length >= MAX_MY_PROMPTS) break
  }
  const favorites = [...new Set((Array.isArray(data?.favorites) ? data.favorites : []).map(String).filter((id) => id.length <= 300))]
  const used = {}
  for (const [id, at] of Object.entries(data?.used && typeof data.used === 'object' ? data.used : {})) {
    if (id.length <= 300 && Number.isFinite(Number(at))) used[id] = Number(at)
  }
  return { prompts, favorites, used }
}

export function serializeLibraryFile({ prompts = [], favorites = [], used = {} } = {}) {
  // Keep only the 200 most recent "used" stamps.
  const recent = Object.entries(used).sort((a, b) => b[1] - a[1]).slice(0, 200)
  return JSON.stringify({
    version: PROMPT_LIBRARY_VERSION,
    prompts: prompts.filter((item) => item?.source === 'mine').map(({ id, title, text, category, tags, createdAt, updatedAt }) => ({ id, title, text, category, tags, createdAt, updatedAt })),
    favorites: [...new Set(favorites)],
    used: Object.fromEntries(recent),
  }, null, 2)
}

const PROMPT_FILE_PATTERN = /\.(txt|md|prompt)$/i
const README_PATTERN = /(^|\/)(read[ _-]?me|license|licence|changelog)(\.[a-z]+)?$/i

/** Is a kept pack file a prompt template the library should list? */
export function isPackPromptFile(relPath) {
  const rel = String(relPath || '').replace(/\\/g, '/')
  return PROMPT_FILE_PATTERN.test(rel) && !README_PATTERN.test(rel)
}

function guessCategory(name) {
  const value = String(name || '').toLowerCase()
  if (/negative|avoid/.test(value)) return 'negative'
  if (/style|camera|lens|look|grade/.test(value)) return 'style'
  if (/character|cast|face|wardrobe/.test(value)) return 'character'
  if (/music|song|lyric/.test(value)) return 'music'
  if (/sfx|sound|foley/.test(value)) return 'sound'
  if (/voice|dialog|line/.test(value)) return 'voice'
  if (/idea|logline|hook|premise/.test(value)) return 'idea'
  if (/outline|story|episode|plot|script/.test(value)) return 'outline'
  return 'shot'
}

function titleFromFileName(relPath) {
  const base = String(relPath || '').replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '')
  const words = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Pack prompt'
}

/** A kept pack template → a read-only library prompt. */
export function packFileToPrompt({ slug, packName, relPath, text, importedAt }) {
  const body = cleanText(text, MAX_PROMPT_TEXT)
  if (!slug || !relPath || !body) return null
  const rel = String(relPath).replace(/\\/g, '/')
  return {
    id: `pack:${slug}/${rel}`,
    title: titleFromFileName(rel),
    text: body,
    category: guessCategory(rel),
    tags: cleanTags([packName]),
    source: 'pack',
    packName: String(packName || slug),
    createdAt: Date.parse(importedAt) || 0,
    updatedAt: Date.parse(importedAt) || 0,
  }
}

function tokens(value) {
  return String(value || '').toLowerCase().split(/[^a-z0-9À-￿]+/).filter((word) => word.length > 1)
}

/**
 * Filter and rank prompts.
 * view: 'all' | 'favorites' | 'recent' | 'mine' | 'pack' | 'starter' | a category id.
 * With no query, favorites come first, then the most recently used, then by title.
 */
export function searchPrompts(prompts, { query = '', view = 'all', favorites = [], used = {} } = {}) {
  const favoriteSet = new Set(favorites)
  let list = Array.isArray(prompts) ? prompts.filter(Boolean) : []
  if (view === 'favorites') list = list.filter((item) => favoriteSet.has(item.id))
  else if (view === 'recent') list = list.filter((item) => used[item.id])
  else if (view === 'mine' || view === 'pack' || view === 'starter') list = list.filter((item) => item.source === view)
  else if (CATEGORY_IDS.has(view)) list = list.filter((item) => item.category === view)

  const words = tokens(query)
  if (!words.length) {
    return [...list].sort((a, b) => {
      if (view === 'recent') return (used[b.id] || 0) - (used[a.id] || 0)
      const fav = Number(favoriteSet.has(b.id)) - Number(favoriteSet.has(a.id))
      if (fav) return fav
      const recent = (used[b.id] || 0) - (used[a.id] || 0)
      if (recent) return recent
      return a.title.localeCompare(b.title)
    })
  }

  const scored = []
  for (const item of list) {
    const title = tokens(item.title)
    const tags = (item.tags || []).flatMap(tokens)
    const category = tokens(categoryLabel(item.category))
    const text = new Set(tokens(item.text))
    let score = 0
    let matched = 0
    for (const word of words) {
      let best = 0
      if (title.some((t) => t === word)) best = 6
      else if (title.some((t) => t.startsWith(word))) best = 4
      if (tags.some((t) => t.startsWith(word)) || category.some((t) => t.startsWith(word))) best = Math.max(best, 3)
      if (!best && [...text].some((t) => t.startsWith(word))) best = 1
      if (best) matched += 1
      score += best
    }
    if (matched < words.length) continue
    if (favoriteSet.has(item.id)) score += 0.5
    scored.push({ item, score })
  }
  return scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title)).map((entry) => entry.item)
}

/** Suggested values for a blank, e.g. cast names for {character}. */
export function suggestionsForBlank(key, { castNames = [] } = {}) {
  if (/^(other |second |main )?(character|hero|heroine|villain|lead|name|person|actor|cast|protagonist|antagonist)( \d+)?$/.test(key)) return castNames.slice(0, 20)
  return []
}

const starter = (id, category, title, text, tags = []) => ({ id: `starter:${id}`, title, text, category, tags, source: 'starter', createdAt: 0, updatedAt: 0 })

/** Built-in starter prompts, in plain words. Ids are stable: favorites point at them. */
export const STARTER_PROMPTS = [
  starter('idea-loglines', 'idea', 'Ten loglines for a genre', 'Give me 10 one-sentence loglines for a {genre} short drama. Each one needs a clear hero, what they want, and what stands in their way. Mix familiar setups with one surprising twist each.', ['brainstorm', 'logline']),
  starter('idea-hooks', 'idea', 'Scroll-stopping opening hooks', 'Write 8 opening hooks for a vertical micro-drama about {topic}. Each hook is the first 3 seconds: one shocking line of dialogue or one striking image. Keep each under 15 words.', ['hook', 'short form', 'vertical']),
  starter('idea-twists', 'idea', 'Twists for my story', 'Here is my story so far: {story}. Suggest 6 twists that change what the audience believes, from small to huge. For each, say which earlier scene should plant the clue.', ['twist', 'plot']),
  starter('idea-series', 'idea', 'Series idea from one premise', 'Turn this premise into a series idea: {premise}. Give a title, a one-line pitch, the main cast of 4 with one secret each, and 5 episode ideas that each end on a cliffhanger.', ['series', 'episodes']),
  starter('outline-episode', 'outline', 'Episode outline in scenes', 'Outline episode {episode number} of {series title} in {scene count} short scenes. For each scene give the place, who is there, what happens, and the last line or image that pulls us into the next scene.', ['episode', 'scenes']),
  starter('outline-three-act', 'outline', 'Three-act short film', 'Write a three-act outline for a {length}-minute short film about {topic}. Act 1: setup and the moment everything changes. Act 2: rising trouble and the low point. Act 3: the choice and the ending. Keep it to one paragraph per act.', ['short film', 'structure']),
  starter('outline-fountain', 'outline', 'Script scene in screenplay format', 'Write this scene as a screenplay in Fountain format: {scene description}. Characters: {characters}. Keep the dialogue short and natural, with one action line between exchanges.', ['screenplay', 'fountain', 'script']),
  starter('shot-establishing', 'shot', 'Establishing shot', 'Wide establishing shot of {location} at {time of day}, {weather}. Cinematic, natural light, deep focus, the place feels {mood}. No people in the foreground.', ['wide', 'location']),
  starter('shot-closeup', 'shot', 'Emotional close-up', 'Close-up of {character}, {emotion} expression, eyes catching soft window light, shallow depth of field, background softly blurred, film grain, 85mm lens.', ['close-up', 'portrait']),
  starter('shot-two-shot', 'shot', 'Two characters talking', 'Medium two-shot of {character} and {other character} facing each other in {location}, tense conversation, over-the-shoulder framing, warm practical lights, cinematic color.', ['dialogue', 'conversation']),
  starter('shot-action', 'shot', 'Action moment (video)', '{character} {action} through {location}. Handheld camera follows from behind, fast but readable motion, motion blur on the background, dramatic lighting. 5 seconds.', ['action', 'video', 'motion']),
  starter('shot-product', 'shot', 'Product hero shot', 'Hero shot of {product} on {surface}, soft studio light from the left, clean reflections, slow 360-degree turn, premium commercial look, plain {color} background.', ['product', 'ad', 'commercial']),
  starter('shot-push-in', 'shot', 'Slow push-in reveal (video)', 'Slow push-in on {subject} in {location}. The camera moves gently forward over 6 seconds while {detail} is revealed. Moody lighting, steady motion, no cuts.', ['camera move', 'video', 'reveal']),
  starter('style-noir', 'style', 'Film noir look', 'black and white film noir, hard side light, deep shadows, venetian blind shadows on the wall, smoke in the air, 1940s styling, high contrast', ['noir', 'black and white']),
  starter('style-kdrama', 'style', 'Soft romantic drama look', 'soft romantic drama look, warm pastel colors, gentle backlight, light bloom, clean modern city interiors, shallow depth of field, dreamy and bright', ['romance', 'drama', 'pastel']),
  starter('style-anime', 'style', 'Anime film style', 'hand-drawn anime film style, painted backgrounds, soft cel shading, expressive eyes, vivid sky, cinematic composition', ['anime', 'animation']),
  starter('style-handheld', 'style', 'Documentary handheld', 'documentary style, handheld camera, natural available light, slight shake, real locations, muted colors, 35mm lens', ['documentary', 'realistic']),
  starter('character-sheet', 'character', 'Character reference sheet', 'Character reference sheet for {character}: {age}, {look}. Full body front view, side view and back view on a plain light grey background, same outfit in every view, neutral pose, even studio lighting.', ['reference', 'consistency', 'cast']),
  starter('character-profile', 'character', 'Character profile', 'Create a character profile for {character} in a {genre} story: age, look, how they talk, what they want, what they fear, a secret, and one habit that shows who they are. Keep it short.', ['profile', 'writing']),
  starter('character-outfit', 'character', 'Outfit change', 'Same person as the reference image, now wearing {outfit}, in {location}. Keep the face, hair and body exactly the same. Natural pose, full body, soft light.', ['wardrobe', 'outfit', 'reference']),
  starter('voice-narrator', 'voice', 'Narrator voice description', 'A {age} {gender} narrator with a {tone} voice, speaking slowly and clearly, warm and close to the microphone, like a late-night storyteller.', ['narration', 'voice design']),
  starter('voice-lines', 'voice', 'Rewrite lines to sound natural', 'Rewrite these lines so they sound natural when spoken out loud by {character}, who is {personality}. Keep each line short and keep the meaning: {lines}', ['dialogue', 'rewrite']),
  starter('music-score', 'music', 'Background score', '{mood} cinematic background score, {instruments}, slow build, no vocals, {tempo} tempo, suits a {genre} scene', ['score', 'instrumental']),
  starter('music-song', 'music', 'Song with vocals', '{genre} song, {mood}, {vocal type} vocals, catchy chorus, about {topic}', ['song', 'vocals']),
  starter('sound-ambience', 'sound', 'Room or place ambience', 'Ambience of {location}: {details}. Steady and quiet enough to sit under dialogue, no music.', ['ambience', 'background']),
  starter('sound-impact', 'sound', 'Dramatic hit', 'Deep cinematic impact hit with a long tail, for a dramatic reveal, punchy low end, no music.', ['hit', 'reveal', 'trailer']),
  starter('negative-clean', 'negative', 'Clean image (things to avoid)', 'blurry, low quality, extra fingers, distorted hands, deformed face, text, watermark, logo, cropped head, duplicate people', ['quality']),
  starter('negative-video', 'negative', 'Clean video (things to avoid)', 'flicker, jitter, morphing faces, warped hands, sudden cuts, text, watermark, frozen frames, low resolution', ['video', 'quality']),
]

export function starterPrompts() {
  return STARTER_PROMPTS.map((item) => ({ ...item, tags: [...item.tags] }))
}
