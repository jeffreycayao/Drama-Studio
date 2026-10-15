/**
 * Cast & Wardrobe Locker schema.
 *
 * A cast member anchors facial identity with up to three head-and-shoulders
 * crops (front, three-quarter, profile) and keeps clothing in separate,
 * switchable wardrobe profiles. Keeping the two apart is what lets a costume
 * change without the face drifting. All image references are project asset
 * ids, so the registry stays portable with the project folder.
 *
 * Stored in the project file as `cast` (see projectStore get/setCastData).
 */

export const CAST_SCHEMA_VERSION = 1

/** @typedef {'front' | 'threeQuarter' | 'profile'} CastAngle */
export const CAST_ANGLES = Object.freeze(['front', 'threeQuarter', 'profile'])

/**
 * @typedef {Object} WardrobeProfile
 * @property {string} id
 * @property {string} name            e.g. "Noir trench"
 * @property {string} keywords        costume prompt keywords
 * @property {string|null} referenceAssetId  outfit image (headless or flat-lay)
 */

/**
 * @typedef {Object} CastMember
 * @property {string} id
 * @property {string} name
 * @property {string[]} aliases       other names to match (e.g. Short Film character names)
 * @property {string} identityNotes   face/hair/age notes only, never clothing
 * @property {Record<CastAngle, string|null>} anchors  asset id per angle
 * @property {WardrobeProfile[]} wardrobes
 * @property {string|null} defaultWardrobeId
 * @property {Record<string, string>} sceneWardrobes  normalized scene key -> wardrobe id
 */

/**
 * @typedef {Object} CastData
 * @property {number} version
 * @property {CastMember[]} members
 */

/**
 * Tag on a timeline clip: which cast member appears and in which outfit.
 * @typedef {Object} ClipCastTag
 * @property {string} castId
 * @property {string|null} wardrobeId
 */

/**
 * What a generation job asks for. Only castId is required.
 * @typedef {Object} JobCastRequest
 * @property {string} castId
 * @property {string|null} [wardrobeId]
 * @property {CastAngle|null} [angle]
 * @property {string} [scene]
 */

const MAX_NAME = 80
const MAX_NOTES = 600
const MAX_KEYWORDS = 400
const MAX_MEMBERS = 64
const MAX_WARDROBES = 24

export function createCastId(prefix = 'cast') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function cleanId(value) {
  const id = String(value ?? '').trim()
  return /^[\w.-]{1,120}$/.test(id) ? id : ''
}

/** Scene names compare case- and spacing-insensitively. */
export function normalizeSceneKey(scene) {
  return cleanText(scene, 120).toLowerCase()
}

export function createDefaultCastData() {
  return { version: CAST_SCHEMA_VERSION, members: [] }
}

/** @returns {WardrobeProfile|null} */
export function normalizeWardrobe(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = cleanId(raw.id)
  if (!id) return null
  return {
    id,
    name: cleanText(raw.name, MAX_NAME) || 'Outfit',
    keywords: cleanText(raw.keywords, MAX_KEYWORDS),
    referenceAssetId: cleanId(raw.referenceAssetId) || null,
  }
}

/** @returns {CastMember|null} */
export function normalizeCastMember(raw) {
  if (!raw || typeof raw !== 'object') return null
  const id = cleanId(raw.id)
  const name = cleanText(raw.name, MAX_NAME)
  if (!id || !name) return null

  const anchors = {}
  for (const angle of CAST_ANGLES) anchors[angle] = cleanId(raw.anchors?.[angle]) || null

  const seen = new Set()
  const wardrobes = []
  for (const item of Array.isArray(raw.wardrobes) ? raw.wardrobes : []) {
    const wardrobe = normalizeWardrobe(item)
    if (!wardrobe || seen.has(wardrobe.id)) continue
    seen.add(wardrobe.id)
    wardrobes.push(wardrobe)
    if (wardrobes.length >= MAX_WARDROBES) break
  }

  const sceneWardrobes = {}
  for (const [scene, wardrobeId] of Object.entries(raw.sceneWardrobes || {})) {
    const key = normalizeSceneKey(scene)
    if (key && seen.has(wardrobeId)) sceneWardrobes[key] = wardrobeId
  }

  const aliases = [...new Set((Array.isArray(raw.aliases) ? raw.aliases : [])
    .map((alias) => cleanText(alias, MAX_NAME))
    .filter((alias) => alias && alias.toLowerCase() !== name.toLowerCase()))].slice(0, 8)

  return {
    id,
    name,
    aliases,
    identityNotes: cleanText(raw.identityNotes, MAX_NOTES),
    anchors,
    wardrobes,
    defaultWardrobeId: seen.has(raw.defaultWardrobeId) ? raw.defaultWardrobeId : (wardrobes[0]?.id || null),
    sceneWardrobes,
  }
}

/** Accepts anything (legacy projects have no `cast`) and returns valid CastData. */
export function normalizeCastData(raw) {
  const data = createDefaultCastData()
  const seen = new Set()
  for (const item of Array.isArray(raw?.members) ? raw.members : []) {
    const member = normalizeCastMember(item)
    if (!member || seen.has(member.id)) continue
    seen.add(member.id)
    data.members.push(member)
    if (data.members.length >= MAX_MEMBERS) break
  }
  return data
}

/** @returns {ClipCastTag[]} */
export function normalizeClipCastTags(tags) {
  const seen = new Set()
  const result = []
  for (const tag of Array.isArray(tags) ? tags : []) {
    const castId = cleanId(tag?.castId)
    if (!castId || seen.has(castId)) continue
    seen.add(castId)
    result.push({ castId, wardrobeId: cleanId(tag?.wardrobeId) || null })
  }
  return result
}

/** Find a member by id, then by name or alias (case-insensitive). */
export function findCastMember(castData, idOrName) {
  const members = castData?.members || []
  const needle = String(idOrName ?? '').trim()
  if (!needle) return null
  const byId = members.find((member) => member.id === needle)
  if (byId) return byId
  const lower = needle.toLowerCase()
  return members.find((member) => member.name.toLowerCase() === lower
    || member.aliases.some((alias) => alias.toLowerCase() === lower)) || null
}
