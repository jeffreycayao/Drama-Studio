// Motion Studio contracts (docs/PLAN_MOTION_STUDIO.md). Pure data and
// validation only: no React, no Electron, no model calls.
//
// A production moves through stages:
//   elements → brief → plan (scenes, approval) → edit (edit plan, apply) → review
// The AI writes the plan and the edit plan as JSON; everything here checks
// that JSON against the project's real assets before anything is applied.

export const MOTION_VERSION = 1
export const STAGES = ['elements', 'brief', 'plan', 'edit', 'review']
export const ROLES = ['footage', 'image', 'voice', 'music', 'sfx']
export const ASPECTS = ['16:9', '9:16', '1:1']
export const TRANSITIONS = ['cut', 'dissolve', 'fade', 'dip-to-black']
export const OVERLAY_STYLES = ['title', 'lower-third', 'caption-card']

const PACE_SHOT_SECONDS = { calm: 4.5, steady: 3, energetic: 1.8 }
export const MIN_CUT_SECONDS = 0.5
export const MAX_OVERLAY_CHARS = 90

const question = (id, label, kind, extra = {}) => ({ id, label, kind, ...extra })

/** Built-in recipes. Data, not code: packs may add more later. */
export const RECIPES = [
  {
    id: 'talking-head',
    title: 'Talking head',
    blurb: 'Your own footage of someone speaking, tightened, with b-roll, titles and captions.',
    roles: ['footage', 'image', 'voice', 'music'],
    defaults: { aspect: '16:9', targetSeconds: 60, pace: 'steady', transition: 'cut', music: true },
    questions: [
      question('topic', 'What is the video about?', 'text', { placeholder: 'e.g. Three tips for shooting on a phone' }),
      question('audience', 'Who is it for?', 'text', { placeholder: 'e.g. beginners on YouTube' }),
      question('aspect', 'Shape', 'choice', { options: ASPECTS }),
      question('targetSeconds', 'Length in seconds', 'number', { min: 10, max: 900 }),
      question('mustInclude', 'Anything it must include?', 'text', { optional: true }),
    ],
    director: 'Build a talking-head edit. Keep the speaker footage as the spine in story order. Cut away to b-roll or images only where they support what is said. Open with a short title, add lower-thirds for names or key points, and end on a clear closing line.',
  },
  {
    id: 'documentary-montage',
    title: 'Documentary montage',
    blurb: 'A mood piece cut from your clips and images, paced to music, with a few title cards.',
    roles: ['footage', 'image', 'voice', 'music', 'sfx'],
    defaults: { aspect: '16:9', targetSeconds: 75, pace: 'calm', transition: 'dissolve', music: true },
    questions: [
      question('topic', 'What is the montage about?', 'text', { placeholder: 'e.g. City life in the rain' }),
      question('tone', 'Tone', 'choice', { options: ['elegiac', 'hopeful', 'tense', 'playful'] }),
      question('aspect', 'Shape', 'choice', { options: ASPECTS }),
      question('targetSeconds', 'Length in seconds', 'number', { min: 15, max: 600 }),
      question('mustInclude', 'Anything it must include?', 'text', { optional: true }),
    ],
    director: 'Build a documentary montage. Group shots into 3 to 6 scenes with a clear arc (establish, build, peak, release). Vary shot length with the music, prefer motion footage over stills, and use at most three short title cards.',
  },
  {
    id: 'music-video',
    title: 'Music video',
    blurb: 'Your clips cut to a song, with faster cuts in the chorus and a title at the start.',
    roles: ['footage', 'image', 'music'],
    defaults: { aspect: '16:9', targetSeconds: 0, pace: 'energetic', transition: 'cut', music: true },
    questions: [
      question('topic', 'Song title and artist', 'text', { placeholder: 'e.g. "Neon Rain" by Mara' }),
      question('mood', 'Look and mood', 'text', { placeholder: 'e.g. neon night, handheld, moody' }),
      question('aspect', 'Shape', 'choice', { options: ASPECTS }),
    ],
    director: 'Build a music video. The song is the spine: the edit runs exactly as long as the song. Cut faster in high-energy sections, hold longer shots in quiet ones, and open with a short title card.',
  },
  {
    id: 'social-short',
    title: 'Social short',
    blurb: 'A punchy vertical clip with a hook in the first seconds and bold captions.',
    roles: ['footage', 'image', 'voice', 'music'],
    defaults: { aspect: '9:16', targetSeconds: 30, pace: 'energetic', transition: 'cut', music: true },
    questions: [
      question('topic', 'What is the hook?', 'text', { placeholder: 'e.g. The one camera setting nobody uses' }),
      question('targetSeconds', 'Length in seconds', 'number', { min: 6, max: 90 }),
      question('mustInclude', 'Call to action at the end?', 'text', { optional: true }),
    ],
    director: 'Build a vertical social short. Hook in the first 2 seconds with the most striking shot and a bold title. Keep every shot short, keep the speaker centred, and end on a call to action card.',
  },
]
export const RECIPE_BY_ID = Object.fromEntries(RECIPES.map((recipe) => [recipe.id, recipe]))

const clean = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const num = (value, fallback = NaN) => { const n = Number(value); return Number.isFinite(n) ? n : fallback }
const round = (value) => Math.round(value * 1000) / 1000

/** Duration in seconds of an asset as the app stores it; images have none. */
export function assetDuration(asset) {
  const value = num(asset?.duration ?? asset?.settings?.duration, 0)
  return value > 0 ? value : 0
}

/** Default role for an asset, from its type and name. */
export function guessRole(asset) {
  const type = String(asset?.type || '').toLowerCase()
  const name = String(asset?.name || '').toLowerCase()
  if (type === 'image') return 'image'
  if (type === 'audio') {
    if (/\b(vo|voice|narration|narrator|dialog|dialogue|speech|tts|interview)\b/.test(name)) return 'voice'
    if (/\b(sfx|fx|whoosh|hit|impact|riser|ambience|foley)\b/.test(name)) return 'sfx'
    return 'music'
  }
  return 'footage'
}

/**
 * The element inventory the model sees: only what it needs to plan, keyed by
 * a short ref (e1, e2…) so it never sees or invents file paths.
 */
export function buildInventory(assets = [], roles = {}) {
  return assets
    .filter((asset) => asset && asset.id && ['video', 'audio', 'image'].includes(String(asset.type)))
    .map((asset, index) => ({
      ref: `e${index + 1}`,
      assetId: String(asset.id),
      name: clean(asset.name || asset.id, 80),
      type: String(asset.type),
      role: ROLES.includes(roles[asset.id]) ? roles[asset.id] : guessRole(asset),
      durationSeconds: round(assetDuration(asset)),
      ...(asset.prompt ? { prompt: clean(asset.prompt, 240) } : {}),
    }))
}

/** Pull one JSON object out of a model reply (plain, or inside a ``` fence). */
export function parseModelJson(text) {
  const raw = String(text || '').trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The AI did not return a plan. Try again or pick another model.')
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    throw new Error('The AI returned a plan that could not be read. Try again.')
  }
}

export function normalizeBrief(raw = {}, recipe = RECIPES[0]) {
  const d = recipe.defaults
  const aspect = ASPECTS.includes(raw.aspect) ? raw.aspect : d.aspect
  const target = Math.round(num(raw.targetSeconds, d.targetSeconds))
  return {
    topic: clean(raw.topic, 300),
    audience: clean(raw.audience, 200),
    tone: clean(raw.tone || raw.mood, 120),
    mustInclude: clean(raw.mustInclude, 300),
    aspect,
    targetSeconds: target > 0 ? Math.min(900, Math.max(5, target)) : 0,
    pace: Object.hasOwn(PACE_SHOT_SECONDS, raw.pace) ? raw.pace : d.pace,
  }
}

/**
 * Scenes plan from the model → checked plan. Shots may only use refs from the
 * inventory; anything else is dropped and reported.
 */
export function normalizePlan(raw, inventory) {
  const byRef = new Map(inventory.map((item) => [item.ref, item]))
  const issues = []
  const scenes = (Array.isArray(raw?.scenes) ? raw.scenes : []).slice(0, 24).map((scene, index) => {
    const shots = (Array.isArray(scene?.shots) ? scene.shots : []).slice(0, 40).map((shot) => {
      const ref = clean(shot?.ref || shot?.element, 8)
      if (ref && !byRef.has(ref)) issues.push(`Scene ${index + 1} used an element that is not in the project (${ref}).`)
      return byRef.has(ref) ? { ref, note: clean(shot?.note, 160) } : { ref: null, need: clean(shot?.need || shot?.note, 200) }
    }).filter((shot) => shot.ref || shot.need)
    return {
      id: `s${index + 1}`,
      title: clean(scene?.title, 80) || `Scene ${index + 1}`,
      purpose: clean(scene?.purpose, 240),
      seconds: Math.max(1, Math.min(600, num(scene?.seconds ?? scene?.durationSeconds, 8))),
      overlay: clean(scene?.overlay || scene?.title_card, MAX_OVERLAY_CHARS),
      shots,
    }
  }).filter((scene) => scene.shots.length || scene.overlay)
  if (!scenes.length) issues.push('The plan has no usable scenes.')
  return { title: clean(raw?.title, 80) || 'Motion cut', logline: clean(raw?.logline, 240), scenes, issues }
}

/**
 * Edit plan from the model (or the quick assembler) → checked edit plan.
 * In/out points are clamped to each asset's real length; unknown refs,
 * negative times and too-short cuts are dropped and reported.
 */
export function normalizeEditPlan(raw, inventory, brief = {}) {
  const byRef = new Map(inventory.map((item) => [item.ref, item]))
  const issues = []
  const visual = (item) => item && (item.type === 'video' || item.type === 'image')
  const audio = (item) => item && item.type === 'audio'

  const cuts = []
  for (const [index, cut] of (Array.isArray(raw?.cuts) ? raw.cuts : []).slice(0, 400).entries()) {
    const item = byRef.get(clean(cut?.ref, 8))
    if (!visual(item)) { issues.push(`Cut ${index + 1} does not point at a video or image in the project.`); continue }
    const length = item.durationSeconds
    let inS = Math.max(0, num(cut?.in ?? cut?.inSeconds, 0))
    let outS = num(cut?.out ?? cut?.outSeconds, NaN)
    let seconds = num(cut?.seconds ?? cut?.durationSeconds, NaN)
    if (item.type === 'image') {
      seconds = Number.isFinite(seconds) ? seconds : (Number.isFinite(outS) ? outS - inS : 3)
      inS = 0
    } else {
      if (length > 0) inS = Math.min(inS, Math.max(0, length - MIN_CUT_SECONDS))
      if (!Number.isFinite(outS)) outS = Number.isFinite(seconds) ? inS + seconds : (length || inS + 3)
      if (length > 0) outS = Math.min(outS, length)
      seconds = outS - inS
    }
    if (!(seconds >= MIN_CUT_SECONDS)) { issues.push(`Cut ${index + 1} is shorter than half a second, so it was left out.`); continue }
    cuts.push({
      ref: item.ref,
      assetId: item.assetId,
      kind: item.type,
      inSeconds: round(inS),
      seconds: round(Math.min(seconds, 600)),
      transition: TRANSITIONS.includes(cut?.transition) ? cut.transition : 'cut',
      motion: item.type === 'image' ? (cut?.motion === 'static' ? 'static' : 'slow-zoom') : 'none',
    })
  }

  const total = cuts.reduce((sum, cut) => sum + cut.seconds, 0)
  const overlays = (Array.isArray(raw?.overlays) ? raw.overlays : []).slice(0, 60).map((overlay) => {
    const text = clean(overlay?.text, MAX_OVERLAY_CHARS)
    const start = Math.max(0, num(overlay?.start ?? overlay?.startSeconds, 0))
    const seconds = Math.max(0.5, Math.min(30, num(overlay?.seconds ?? overlay?.durationSeconds, 3)))
    return text && start < Math.max(total, 1)
      ? { text, startSeconds: round(start), seconds: round(Math.min(seconds, Math.max(0.5, total - start))), style: OVERLAY_STYLES.includes(overlay?.style) ? overlay.style : 'title' }
      : null
  }).filter(Boolean)

  const audioCue = (cue, label) => {
    const item = byRef.get(clean(cue?.ref, 8))
    if (!audio(item)) { if (cue?.ref) issues.push(`${label} does not point at an audio file in the project.`); return null }
    const inS = Math.max(0, Math.min(num(cue?.in ?? cue?.inSeconds, 0), Math.max(0, item.durationSeconds - MIN_CUT_SECONDS)))
    const room = item.durationSeconds > 0 ? item.durationSeconds - inS : Infinity
    const seconds = Math.min(num(cue?.seconds, room), room)
    return {
      ref: item.ref,
      assetId: item.assetId,
      startSeconds: round(Math.max(0, num(cue?.start ?? cue?.startSeconds, 0))),
      inSeconds: round(inS),
      seconds: Number.isFinite(seconds) && seconds > 0 ? round(seconds) : null,
    }
  }
  const music = raw?.music ? audioCue(raw.music, 'The music') : null
  const voice = (Array.isArray(raw?.voice) ? raw.voice : []).slice(0, 40).map((cue, i) => audioCue(cue, `Voice line ${i + 1}`)).filter(Boolean)
  const sfx = (Array.isArray(raw?.sfx) ? raw.sfx : []).slice(0, 60).map((cue, i) => audioCue(cue, `Sound ${i + 1}`)).filter(Boolean)

  if (!cuts.length) issues.push('The edit has no usable shots.')
  return {
    version: MOTION_VERSION,
    title: clean(raw?.title, 80) || 'Motion cut',
    aspect: ASPECTS.includes(brief.aspect) ? brief.aspect : '16:9',
    cuts,
    overlays,
    music: music ? { ...music, volumeDb: Math.max(-30, Math.min(0, num(raw.music.volumeDb, -14))), fadeInSeconds: 1, fadeOutSeconds: 2, duck: voice.length > 0 } : null,
    voice,
    sfx,
    captions: Boolean(raw?.captions && voice.length),
    totalSeconds: round(total),
    issues,
  }
}

const MAX_PRODUCTIONS = 50

/** Productions saved with the project (project.motion). Bad data is dropped, never thrown. */
export function normalizeMotionData(raw) {
  const list = Array.isArray(raw?.productions) ? raw.productions : []
  const productions = []
  const seen = new Set()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const id = clean(item.id, 64)
    if (!/^mp-[a-z0-9-]{4,60}$/.test(id) || seen.has(id) || !RECIPE_BY_ID[item.recipeId]) continue
    seen.add(id)
    const elementIds = (Array.isArray(item.elementIds) ? item.elementIds : []).map((value) => clean(value, 128)).filter(Boolean).slice(0, 400)
    const roles = {}
    for (const [assetId, role] of Object.entries(item.roles && typeof item.roles === 'object' ? item.roles : {})) {
      if (ROLES.includes(role) && assetId.length <= 128) roles[assetId] = role
    }
    productions.push({
      id,
      recipeId: item.recipeId,
      title: clean(item.title, 80) || RECIPE_BY_ID[item.recipeId].title,
      createdAt: clean(item.createdAt, 40),
      updatedAt: clean(item.updatedAt, 40),
      stage: STAGES.includes(item.stage) ? item.stage : 'elements',
      elementIds,
      roles,
      answers: item.answers && typeof item.answers === 'object' ? JSON.parse(JSON.stringify(item.answers)) : {},
      plan: item.plan && typeof item.plan === 'object' ? item.plan : null,
      planApproved: item.planApproved === true,
      edit: item.edit && typeof item.edit === 'object' ? item.edit : null,
      applied: item.applied && typeof item.applied === 'object' ? { timelineId: clean(item.applied.timelineId, 128), at: clean(item.applied.at, 40), name: clean(item.applied.name, 120) } : null,
    })
    if (productions.length >= MAX_PRODUCTIONS) break
  }
  return { version: MOTION_VERSION, productions }
}

/**
 * Refs (e1, e2…) follow the order of the ticked elements, so they change when
 * the user ticks or unticks one. Saved plans therefore name assets by id
 * (refsToAssetIds) and get fresh refs when loaded (assetIdsToRefs).
 */
export function refsToAssetIds(value, inventory = []) {
  const byRef = new Map(inventory.map((item) => [item.ref, item.assetId]))
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk)
    if (!node || typeof node !== 'object') return node
    const out = {}
    for (const [key, child] of Object.entries(node)) {
      if (key === 'assetId' && 'ref' in node) continue
      if (key === 'ref') {
        if (child && byRef.has(child)) out.assetId = byRef.get(child)
        else out.ref = null
      } else {
        out[key] = walk(child)
      }
    }
    return out
  }
  return walk(value)
}

export function assetIdsToRefs(value, inventory = []) {
  const byAsset = new Map(inventory.map((item) => [item.assetId, item.ref]))
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk)
    if (!node || typeof node !== 'object') return node
    const out = {}
    for (const [key, child] of Object.entries(node)) {
      if (key === 'assetId' && !('ref' in node)) {
        out.ref = byAsset.get(child) || null
        if (!out.ref && !node.need) out.need = 'An element that is no longer ticked'
      } else {
        out[key] = walk(child)
      }
    }
    return out
  }
  return walk(value)
}

export function newProductionId(now = Date.now()) {
  return `mp-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

/**
 * No-AI assembly: every footage and image element in order, trimmed to fit the
 * target length, with music under it and an opening title. Always valid input
 * for normalizeEditPlan, so it doubles as the fallback when no model is set.
 */
export function quickAssemble(inventory, brief = {}, recipe = RECIPES[0]) {
  const visuals = inventory.filter((item) => item.role === 'footage' || item.role === 'image')
  const musicItem = inventory.find((item) => item.role === 'music')
  const voiceItems = inventory.filter((item) => item.role === 'voice')
  const shotSeconds = PACE_SHOT_SECONDS[brief.pace] || PACE_SHOT_SECONDS[recipe.defaults.pace] || 3
  let target = num(brief.targetSeconds, 0)
  if (recipe.id === 'music-video' && musicItem?.durationSeconds) target = musicItem.durationSeconds
  if (!(target > 0)) target = voiceItems.reduce((sum, item) => sum + item.durationSeconds, 0) || visuals.length * shotSeconds

  const cuts = []
  let total = 0
  for (let pass = 0; visuals.length && total < target - 0.25 && pass < 50; pass += 1) {
    for (const item of visuals) {
      if (total >= target - 0.25) break
      const remaining = target - total
      const offset = item.type === 'video' && item.durationSeconds > shotSeconds ? ((pass * shotSeconds) % Math.max(0.001, item.durationSeconds - shotSeconds)) : 0
      const available = item.type === 'video' ? Math.max(0, item.durationSeconds - offset) : shotSeconds
      const seconds = Math.min(shotSeconds, remaining, available || shotSeconds)
      if (seconds < MIN_CUT_SECONDS) continue
      cuts.push({ ref: item.ref, in: round(offset), seconds: round(seconds), transition: cuts.length ? recipe.defaults.transition : 'cut' })
      total += seconds
    }
  }
  let voiceStart = 0
  const voice = voiceItems.map((item) => { const cue = { ref: item.ref, start: round(voiceStart) }; voiceStart += item.durationSeconds; return cue })
  const opening = clean(brief.topic, MAX_OVERLAY_CHARS)
  return {
    title: opening || recipe.title,
    cuts,
    overlays: opening ? [{ text: opening, start: 0, seconds: Math.min(3, Math.max(1, total / 4)), style: 'title' }] : [],
    music: musicItem ? { ref: musicItem.ref, start: 0, volumeDb: voice.length ? -16 : -8 } : null,
    voice,
    sfx: [],
    captions: voice.length > 0,
  }
}
