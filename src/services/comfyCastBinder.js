/**
 * Cast binder: turns a cast lock into concrete workflow inputs.
 *
 * Mode A (reference slots) runs when a job is created. It routes the face
 * anchor, the wardrobe reference and any scene reference into the image slots
 * the target workflow actually reads, then prepends a role-labelled prompt
 * block so the model takes identity from one image and clothing from another.
 * The existing upload code and modify*Workflow() functions do the rest.
 *
 * Mode B (adapter nodes) runs on the final API graph just before queueing. If
 * a custom or imported graph contains PuLID / InstantID / IP-Adapter FaceID
 * nodes, the LoadImage feeding their face input is pointed at the uploaded
 * anchor. These adapters embed only the detected face, so clothing never leaks
 * into identity.
 *
 * Everything here is pure: no I/O, no store access.
 */

import { CAST_ANGLES, findCastMember, normalizeSceneKey } from '../types/cast.js'

// How each bundled workflow consumes images. See docs/CAST_LOCKER_DESIGN.md.
export const CAST_SLOT_PROFILE = Object.freeze({
  EDIT: 'edit', // edit input + referenceAssetId1/2 (Qwen Image Edit, Seedream edit)
  NANO: 'nano', // ordered reference list: input, referenceImage1, referenceImage2
  EDIT_INPUT_ONLY: 'edit-input-only', // only the edit input (GPT Image 2 edit)
  R2V: 'r2v', // assetFieldIds.referenceImage1..3 (Seedance 2 reference-to-video)
  SINGLE_REF: 'single-ref', // assetFieldIds.referenceImage1 only (MiniMax H3)
  PROMPT: 'prompt', // no image slots: identity and outfit go into the prompt
})

const WORKFLOW_PROFILES = {
  'image-edit': CAST_SLOT_PROFILE.EDIT,
  'image-edit-model-product': CAST_SLOT_PROFILE.EDIT,
  'seedream-5-lite-image-edit': CAST_SLOT_PROFILE.EDIT,
  'nano-banana-2': CAST_SLOT_PROFILE.NANO,
  'nano-banana-pro': CAST_SLOT_PROFILE.NANO,
  'gpt-image-2-edit': CAST_SLOT_PROFILE.EDIT_INPUT_ONLY,
  'seedance2-r2v': CAST_SLOT_PROFILE.R2V,
  'seedance2-mini-r2v': CAST_SLOT_PROFILE.R2V,
  'minimax-h3-r2v': CAST_SLOT_PROFILE.SINGLE_REF,
}

export function getCastSlotProfile(workflowId) {
  return WORKFLOW_PROFILES[workflowId] || CAST_SLOT_PROFILE.PROMPT
}

/** Guess the camera angle from shot type / prompt text. Defaults to front. */
export function inferShotAngle(...texts) {
  const text = texts.filter(Boolean).join(' ').toLowerCase()
  if (/\b(profile|side[- ]on|side view|side angle)\b/.test(text)) return 'profile'
  if (/\b(three[- ]quarter|3\/4|45[- ]?(°|deg|degree)|over[- ]the[- ]shoulder|ots)\b/.test(text)) return 'threeQuarter'
  return 'front'
}

const ANGLE_FALLBACKS = {
  front: ['front', 'threeQuarter', 'profile'],
  threeQuarter: ['threeQuarter', 'front', 'profile'],
  profile: ['profile', 'threeQuarter', 'front'],
}

/** Closest available anchor for the requested angle. */
export function pickAnchor(member, angle = 'front', assetExists = () => true) {
  const order = ANGLE_FALLBACKS[CAST_ANGLES.includes(angle) ? angle : 'front']
  for (const candidate of order) {
    const assetId = member?.anchors?.[candidate]
    if (assetId && assetExists(assetId)) return { angle: candidate, assetId }
  }
  return null
}

/** Explicit wardrobe, else the scene's wardrobe, else the default. */
export function resolveWardrobe(member, { wardrobeId = null, scene = '' } = {}) {
  const wardrobes = member?.wardrobes || []
  const byId = (id) => wardrobes.find((wardrobe) => wardrobe.id === id) || null
  return byId(wardrobeId)
    || byId(member?.sceneWardrobes?.[normalizeSceneKey(scene)])
    || byId(member?.defaultWardrobeId)
    || null
}

/**
 * Resolve a job's cast request against the project's cast registry.
 * @param {import('../types/cast.js').JobCastRequest} request
 * @returns {{ ok: true, binding: Object } | { ok: false, error: string }}
 */
export function resolveCastBinding(request, castData, { assetExists = () => true } = {}) {
  if (!request?.castId) return { ok: false, error: 'No cast member was selected.' }
  const member = findCastMember(castData, request.castId)
  if (!member) return { ok: false, error: 'That cast member no longer exists in this project.' }
  const anchor = pickAnchor(member, request.angle || 'front', assetExists)
  const wardrobe = resolveWardrobe(member, request)
  const wardrobeAssetId = wardrobe?.referenceAssetId && assetExists(wardrobe.referenceAssetId) ? wardrobe.referenceAssetId : null
  return {
    ok: true,
    binding: {
      castId: member.id,
      castName: member.name,
      identityNotes: member.identityNotes,
      requestedAngle: request.angle || 'front',
      anchorAngle: anchor?.angle || null,
      faceAssetId: anchor?.assetId || null,
      wardrobeId: wardrobe?.id || null,
      wardrobeName: wardrobe?.name || '',
      wardrobeKeywords: wardrobe?.keywords || '',
      wardrobeAssetId,
    },
  }
}

const ROLE_LINES = {
  face: (b, n) => `Image ${n} is the identity reference for ${b.castName}: match their face shape, eyes, nose, mouth, skin tone, hair and apparent age exactly. Ignore the clothing, background and lighting in that image.`,
  wardrobe: (b, n) => `Image ${n} shows ${b.castName}'s outfit${b.wardrobeName ? ` (${b.wardrobeName})` : ''}: dress them in exactly this outfit. Ignore any face or body in that image.`,
  scene: (_b, n) => `Image ${n} is the scene: keep its location, layout and lighting.`,
}

/**
 * Prompt block that tells the model which image carries which role.
 * @param {Object} binding  from resolveCastBinding
 * @param {Array<'face'|'wardrobe'|'scene'>} roles  image order as the workflow receives them
 */
export function buildCastPromptBlock(binding, roles = []) {
  const lines = [`Cast lock: ${binding.castName}.`]
  roles.forEach((role, index) => lines.push(ROLE_LINES[role](binding, index + 1)))
  if (binding.identityNotes) lines.push(`Identity notes for ${binding.castName}: ${binding.identityNotes}.`)
  if (binding.wardrobeKeywords) {
    lines.push(`${binding.castName} wears: ${binding.wardrobeKeywords}. This outfit overrides any clothing mentioned elsewhere.`)
  }
  if (!roles.includes('face')) lines.push(`Keep ${binding.castName}'s face consistent with earlier shots.`)
  return lines.join('\n')
}

const REFERENCE_FIELDS = ['referenceImage1', 'referenceImage2', 'referenceImage3', 'referenceImage4']

/**
 * Mode A: route anchors into the job's image slots and label them in the prompt.
 * `replaceAssetIds` lists references the cast supersedes (e.g. a Short Film
 * character's old single reference). Returns a new job; the input is untouched.
 */
export function applyCastToJob(job, binding, { replaceAssetIds = [] } = {}) {
  const profile = getCastSlotProfile(job.workflowId)
  const face = binding.faceAssetId
  const wardrobe = binding.wardrobeAssetId
  const fields = { ...(job.assetFieldIds || {}) }

  // Whatever image the job already carried that the cast does not replace is the scene.
  const superseded = new Set([...replaceAssetIds, face, wardrobe].filter(Boolean))
  const existing = [
    job.inputAssetType === 'video' ? null : job.inputAssetId,
    job.referenceAssetId1,
    job.referenceAssetId2,
    ...REFERENCE_FIELDS.map((field) => fields[field]),
  ].filter((id) => id && !superseded.has(id))
  const scene = existing[0] || null

  const next = { ...job, assetFieldIds: fields }
  let slots = [] // [{ role, assetId }] in the order the workflow sees them

  const useAsInput = (assetId) => {
    next.needsImage = true
    next.inputAssetType = 'image'
    next.inputFromTimelineFrame = false
    next.inputAssetId = assetId
    next.inputAssetName = ''
  }

  if (face) {
    switch (profile) {
      case CAST_SLOT_PROFILE.EDIT: {
        // Edit models compose around the base image: a scene keeps the shot
        // wide; without one the face crop becomes the base.
        slots = [scene ? { role: 'scene', assetId: scene } : null, { role: 'face', assetId: face }, wardrobe ? { role: 'wardrobe', assetId: wardrobe } : null].filter(Boolean)
        useAsInput(slots[0].assetId)
        next.referenceAssetId1 = slots[1]?.assetId || null
        next.referenceAssetId2 = slots[2]?.assetId || null
        break
      }
      case CAST_SLOT_PROFILE.NANO: {
        slots = [{ role: 'face', assetId: face }, wardrobe ? { role: 'wardrobe', assetId: wardrobe } : null, scene ? { role: 'scene', assetId: scene } : null].filter(Boolean)
        useAsInput(face)
        fields.referenceImage1 = slots[1]?.assetId
        fields.referenceImage2 = slots[2]?.assetId
        next.referenceAssetId1 = null
        next.referenceAssetId2 = null
        break
      }
      case CAST_SLOT_PROFILE.EDIT_INPUT_ONLY:
        slots = [{ role: 'face', assetId: face }]
        useAsInput(face)
        break
      case CAST_SLOT_PROFILE.R2V:
        slots = [{ role: 'face', assetId: face }, wardrobe ? { role: 'wardrobe', assetId: wardrobe } : null, scene ? { role: 'scene', assetId: scene } : null].filter(Boolean)
        REFERENCE_FIELDS.slice(0, 3).forEach((field, index) => { fields[field] = slots[index]?.assetId })
        break
      case CAST_SLOT_PROFILE.SINGLE_REF:
        slots = [{ role: 'face', assetId: face }]
        fields.referenceImage1 = face
        break
      default:
        break
    }
  }
  for (const field of REFERENCE_FIELDS) if (!fields[field]) delete fields[field]

  const roles = slots.map((slot) => slot.role)
  const slotted = Boolean(face) && profile !== CAST_SLOT_PROFILE.PROMPT
  next.prompt = [buildCastPromptBlock(binding, roles), job.prompt].filter(Boolean).join('\n\n')
  next.castBinding = {
    ...binding,
    profile,
    roles,
    // Notes the UI can show: what could not be bound and why. Prompt-only
    // workflows keep their own images, so nothing there counts as dropped.
    notes: [
      !face ? 'no-anchor' : null,
      face && profile === CAST_SLOT_PROFILE.PROMPT ? 'prompt-only-workflow' : null,
      slotted && wardrobe && !roles.includes('wardrobe') ? 'wardrobe-as-keywords' : null,
      slotted && scene && !roles.includes('scene') ? 'scene-dropped' : null,
    ].filter(Boolean),
  }
  return next
}

// ---------------------------------------------------------------------------
// Mode B: identity adapter nodes in custom / imported API graphs
// ---------------------------------------------------------------------------

/** Node classes whose `image` input takes the face (by class_type, never node id). */
export const FACE_ADAPTER_CLASSES = Object.freeze([
  'ApplyPulid',
  'ApplyPulidAdvanced',
  'ApplyPulidFlux',
  'ApplyInstantID',
  'ApplyInstantIDAdvanced',
  'IPAdapterFaceID',
  'IPAdapterFaceIDKolors',
])

/** Style adapters that can carry the wardrobe reference. */
export const WARDROBE_ADAPTER_CLASSES = Object.freeze(['IPAdapterAdvanced', 'IPAdapter'])

const IMAGE_INPUT_KEYS = ['image', 'images', 'pixels']
const MAX_TRACE_HOPS = 6

function isLink(value) {
  return Array.isArray(value) && value.length === 2 && (typeof value[0] === 'string' || typeof value[0] === 'number')
}

/** Walk upstream through pass-through image nodes to the LoadImage that feeds `link`. */
function traceToLoadImage(workflow, link) {
  let current = link
  for (let hop = 0; hop < MAX_TRACE_HOPS && isLink(current); hop += 1) {
    const nodeId = String(current[0])
    const node = workflow[nodeId]
    if (!node) return null
    if (node.class_type === 'LoadImage') return nodeId
    const nextKey = IMAGE_INPUT_KEYS.find((key) => isLink(node.inputs?.[key]))
    current = nextKey ? node.inputs[nextKey] : null
  }
  return null
}

/** Find which LoadImage nodes feed face and wardrobe adapters. */
export function findCastAdapterTargets(workflow) {
  const face = []
  const wardrobe = []
  const unresolved = []
  for (const [nodeId, node] of Object.entries(workflow || {})) {
    const isFace = FACE_ADAPTER_CLASSES.includes(node?.class_type)
    const isWardrobe = WARDROBE_ADAPTER_CLASSES.includes(node?.class_type)
    if (!isFace && !isWardrobe) continue
    const loadImageId = traceToLoadImage(workflow, node.inputs?.image)
    if (!loadImageId) {
      unresolved.push({ nodeId, classType: node.class_type })
      continue
    }
    ;(isFace ? face : wardrobe).push({ nodeId, classType: node.class_type, loadImageId })
  }
  return { face, wardrobe, unresolved, hasAdapters: face.length + wardrobe.length + unresolved.length > 0 }
}

/**
 * Mode B: point adapter LoadImage nodes at the uploaded cast images.
 * @param {Object} workflow  ComfyUI API graph (not mutated)
 * @param {{ faceImage?: string, wardrobeImage?: string }} uploaded  ComfyUI input filenames
 */
export function bindCastToWorkflow(workflow, { faceImage = '', wardrobeImage = '' } = {}) {
  const targets = findCastAdapterTargets(workflow)
  const result = JSON.parse(JSON.stringify(workflow || {}))
  const boundNodes = []
  const warnings = targets.unresolved.map(({ nodeId, classType }) => `${classType} (node ${nodeId}) has no LoadImage feeding its image input; left unchanged.`)

  const faceLoaders = new Set()
  if (faceImage) {
    for (const target of targets.face) {
      result[target.loadImageId].inputs.image = faceImage
      faceLoaders.add(target.loadImageId)
      boundNodes.push({ ...target, role: 'face' })
    }
  }
  if (wardrobeImage) {
    for (const target of targets.wardrobe) {
      if (faceLoaders.has(target.loadImageId)) {
        warnings.push(`${target.classType} (node ${target.nodeId}) shares its image with a face adapter; wardrobe not bound there.`)
        continue
      }
      result[target.loadImageId].inputs.image = wardrobeImage
      boundNodes.push({ ...target, role: 'wardrobe' })
    }
  }
  return { workflow: result, boundNodes, warnings, targets }
}
