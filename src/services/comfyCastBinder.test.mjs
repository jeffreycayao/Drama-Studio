import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CAST_SLOT_PROFILE,
  applyCastToJob,
  bindCastToWorkflow,
  findCastAdapterTargets,
  getCastSlotProfile,
  inferShotAngle,
  pickAnchor,
  resolveCastBinding,
  resolveWardrobe,
} from './comfyCastBinder.js'
import { findCastMember, normalizeCastData, normalizeClipCastTags } from '../types/cast.js'

const castData = normalizeCastData({
  members: [{
    id: 'cast_mara',
    name: 'Mara',
    aliases: ['Detective Mara', 'mara'],
    identityNotes: 'late 30s, dark curly hair, freckles',
    anchors: { front: 'a_front', threeQuarter: 'a_34', profile: null },
    wardrobes: [
      { id: 'w_trench', name: 'Noir trench', keywords: 'long beige trench coat, grey fedora', referenceAssetId: 'a_trench' },
      { id: 'w_gala', name: 'Gala', keywords: 'emerald satin evening gown', referenceAssetId: null },
    ],
    defaultWardrobeId: 'w_trench',
    sceneWardrobes: { '  The GALA  ': 'w_gala', 'Unknown': 'w_missing' },
  }],
})
const mara = castData.members[0]

function bind(request = {}) {
  const result = resolveCastBinding({ castId: 'cast_mara', ...request }, castData)
  assert.equal(result.ok, true)
  return result.binding
}

test('normalizeCastData drops invalid entries and normalizes scene keys', () => {
  const data = normalizeCastData({ members: [mara, { id: 'cast_mara', name: 'Duplicate' }, { name: 'No id' }, null] })
  assert.equal(data.members.length, 1)
  assert.deepEqual(mara.sceneWardrobes, { 'the gala': 'w_gala' })
  assert.deepEqual(mara.aliases, ['Detective Mara'])
  assert.deepEqual(normalizeCastData(undefined), { version: 1, members: [] })
})

test('findCastMember matches id, name and alias case-insensitively', () => {
  assert.equal(findCastMember(castData, 'cast_mara'), mara)
  assert.equal(findCastMember(castData, 'MARA'), mara)
  assert.equal(findCastMember(castData, 'detective mara'), mara)
  assert.equal(findCastMember(castData, 'Nobody'), null)
})

test('normalizeClipCastTags dedupes members', () => {
  assert.deepEqual(normalizeClipCastTags([{ castId: 'a', wardrobeId: 'w' }, { castId: 'a' }, { castId: '' }, { castId: 'b' }]), [
    { castId: 'a', wardrobeId: 'w' },
    { castId: 'b', wardrobeId: null },
  ])
})

test('inferShotAngle reads profile and three-quarter cues', () => {
  assert.equal(inferShotAngle('Close-up, side profile of Mara at the window'), 'profile')
  assert.equal(inferShotAngle('over-the-shoulder medium shot'), 'threeQuarter')
  assert.equal(inferShotAngle('3/4 view'), 'threeQuarter')
  assert.equal(inferShotAngle('wide establishing shot'), 'front')
})

test('pickAnchor falls back to the nearest available angle', () => {
  assert.deepEqual(pickAnchor(mara, 'profile'), { angle: 'threeQuarter', assetId: 'a_34' })
  assert.deepEqual(pickAnchor(mara, 'front'), { angle: 'front', assetId: 'a_front' })
  assert.deepEqual(pickAnchor(mara, 'front', (id) => id !== 'a_front'), { angle: 'threeQuarter', assetId: 'a_34' })
  assert.equal(pickAnchor(mara, 'front', () => false), null)
})

test('resolveWardrobe prefers explicit, then scene, then default', () => {
  assert.equal(resolveWardrobe(mara, { wardrobeId: 'w_gala' }).id, 'w_gala')
  assert.equal(resolveWardrobe(mara, { scene: 'the gala' }).id, 'w_gala')
  assert.equal(resolveWardrobe(mara, { scene: 'Rooftop' }).id, 'w_trench')
})

test('resolveCastBinding reports missing members', () => {
  assert.equal(resolveCastBinding({ castId: 'ghost' }, castData).ok, false)
  assert.equal(resolveCastBinding(null, castData).ok, false)
})

test('workflow ids map to slot profiles; unknown workflows are prompt-only', () => {
  assert.equal(getCastSlotProfile('image-edit'), CAST_SLOT_PROFILE.EDIT)
  assert.equal(getCastSlotProfile('nano-banana-2'), CAST_SLOT_PROFILE.NANO)
  assert.equal(getCastSlotProfile('seedance2-r2v'), CAST_SLOT_PROFILE.R2V)
  assert.equal(getCastSlotProfile('wan22-i2v'), CAST_SLOT_PROFILE.PROMPT)
})

test('edit profile keeps the scene as the base image and labels roles in order', () => {
  const job = applyCastToJob(
    { workflowId: 'image-edit', prompt: 'Mara lights a cigarette', inputAssetId: 'old_char', referenceAssetId1: 'loc_bar', needsImage: true },
    bind(),
    { replaceAssetIds: ['old_char'] },
  )
  assert.equal(job.inputAssetId, 'loc_bar')
  assert.equal(job.referenceAssetId1, 'a_front')
  assert.equal(job.referenceAssetId2, 'a_trench')
  assert.deepEqual(job.castBinding.roles, ['scene', 'face', 'wardrobe'])
  assert.match(job.prompt, /^Cast lock: Mara\./)
  assert.match(job.prompt, /Image 1 is the scene/)
  assert.match(job.prompt, /Image 2 is the identity reference for Mara/)
  assert.match(job.prompt, /Image 3 shows Mara's outfit \(Noir trench\)/)
  assert.match(job.prompt, /Mara lights a cigarette$/)
})

test('edit profile without a scene uses the face crop as the base', () => {
  const job = applyCastToJob({ workflowId: 'image-edit', prompt: 'portrait' }, bind({ wardrobeId: 'w_gala' }))
  assert.equal(job.inputAssetId, 'a_front')
  assert.equal(job.needsImage, true)
  assert.equal(job.referenceAssetId1, null)
  assert.deepEqual(job.castBinding.roles, ['face'])
  // Gala has no image, so it is carried by keywords only.
  assert.match(job.prompt, /Mara wears: emerald satin evening gown\. This outfit overrides/)
})

test('nano profile orders face, wardrobe, scene across input and reference fields', () => {
  const job = applyCastToJob({ workflowId: 'nano-banana-2', referenceAssetId1: 'old_char', referenceAssetId2: 'loc_bar' }, bind(), { replaceAssetIds: ['old_char'] })
  assert.equal(job.inputAssetId, 'a_front')
  assert.equal(job.assetFieldIds.referenceImage1, 'a_trench')
  assert.equal(job.assetFieldIds.referenceImage2, 'loc_bar')
  assert.equal(job.referenceAssetId1, null)
  assert.deepEqual(job.castBinding.roles, ['face', 'wardrobe', 'scene'])
})

test('reference-to-video fills up to three reference fields', () => {
  const job = applyCastToJob({ workflowId: 'seedance2-r2v', assetFieldIds: { referenceImage1: 'loc_bar' } }, bind())
  assert.deepEqual(job.assetFieldIds, { referenceImage1: 'a_front', referenceImage2: 'a_trench', referenceImage3: 'loc_bar' })
})

test('single-reference and edit-input-only profiles note what they could not carry', () => {
  const minimax = applyCastToJob({ workflowId: 'minimax-h3-r2v', assetFieldIds: { referenceImage1: 'loc_bar' } }, bind())
  assert.deepEqual(minimax.assetFieldIds, { referenceImage1: 'a_front' })
  assert.deepEqual(minimax.castBinding.notes, ['wardrobe-as-keywords', 'scene-dropped'])
  const gpt = applyCastToJob({ workflowId: 'gpt-image-2-edit', inputAssetId: 'loc_bar', needsImage: true }, bind())
  assert.equal(gpt.inputAssetId, 'a_front')
})

test('prompt-only workflows keep their images and add identity text', () => {
  const job = applyCastToJob({ workflowId: 'wan22-i2v', inputAssetId: 'keyframe_1', inputAssetType: 'image', prompt: 'she turns' }, bind())
  assert.equal(job.inputAssetId, 'keyframe_1')
  assert.deepEqual(job.castBinding.notes, ['prompt-only-workflow'])
  assert.match(job.prompt, /Identity notes for Mara: late 30s, dark curly hair, freckles\./)
  assert.match(job.prompt, /Keep Mara's face consistent/)
})

test('a member without anchors still binds by prompt and says so', () => {
  const noAnchors = normalizeCastData({ members: [{ id: 'cast_x', name: 'X', anchors: {} }] })
  const binding = resolveCastBinding({ castId: 'cast_x' }, noAnchors).binding
  const job = applyCastToJob({ workflowId: 'image-edit', inputAssetId: 'loc', prompt: 'p' }, binding)
  assert.equal(job.inputAssetId, 'loc')
  assert.deepEqual(job.castBinding.notes, ['no-anchor'])
})

test('applyCastToJob does not mutate the original job', () => {
  const original = { workflowId: 'seedance2-r2v', assetFieldIds: { referenceImage1: 'x' }, prompt: 'p' }
  applyCastToJob(original, bind())
  assert.deepEqual(original, { workflowId: 'seedance2-r2v', assetFieldIds: { referenceImage1: 'x' }, prompt: 'p' })
})

// A PuLID-FLUX style graph: LoadImage -> ImageScale -> ApplyPulidFlux, plus an IP-Adapter for style.
const pulidGraph = {
  10: { class_type: 'LoadImage', inputs: { image: 'face_placeholder.png' } },
  11: { class_type: 'ImageScale', inputs: { image: ['10', 0], width: 512, height: 512 } },
  12: { class_type: 'ApplyPulidFlux', inputs: { model: ['1', 0], image: ['11', 0], weight: 1 } },
  20: { class_type: 'LoadImage', inputs: { image: 'style_placeholder.png' } },
  21: { class_type: 'IPAdapterAdvanced', inputs: { model: ['12', 0], image: ['20', 0] } },
  30: { class_type: 'KSampler', inputs: { model: ['21', 0] } },
}

test('findCastAdapterTargets traces through pass-through image nodes', () => {
  const targets = findCastAdapterTargets(pulidGraph)
  assert.deepEqual(targets.face, [{ nodeId: '12', classType: 'ApplyPulidFlux', loadImageId: '10' }])
  assert.deepEqual(targets.wardrobe, [{ nodeId: '21', classType: 'IPAdapterAdvanced', loadImageId: '20' }])
  assert.equal(targets.hasAdapters, true)
})

test('bindCastToWorkflow swaps face and wardrobe loaders without mutating the input', () => {
  const { workflow, boundNodes, warnings } = bindCastToWorkflow(pulidGraph, { faceImage: 'mara_front.png', wardrobeImage: 'trench.png' })
  assert.equal(workflow[10].inputs.image, 'mara_front.png')
  assert.equal(workflow[20].inputs.image, 'trench.png')
  assert.equal(pulidGraph[10].inputs.image, 'face_placeholder.png')
  assert.deepEqual(boundNodes.map((node) => node.role), ['face', 'wardrobe'])
  assert.deepEqual(warnings, [])
})

test('a loader shared by face and style adapters keeps the face only', () => {
  const shared = {
    1: { class_type: 'LoadImage', inputs: { image: 'x.png' } },
    2: { class_type: 'ApplyInstantID', inputs: { image: ['1', 0] } },
    3: { class_type: 'IPAdapter', inputs: { image: ['1', 0] } },
  }
  const { workflow, warnings } = bindCastToWorkflow(shared, { faceImage: 'face.png', wardrobeImage: 'outfit.png' })
  assert.equal(workflow[1].inputs.image, 'face.png')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /shares its image with a face adapter/)
})

test('adapters fed by something other than LoadImage are reported, not guessed', () => {
  const graph = {
    1: { class_type: 'VAEDecode', inputs: { samples: ['9', 0] } },
    2: { class_type: 'IPAdapterFaceID', inputs: { image: ['1', 0] } },
  }
  const { workflow, boundNodes, warnings } = bindCastToWorkflow(graph, { faceImage: 'face.png' })
  assert.deepEqual(boundNodes, [])
  assert.deepEqual(workflow, graph)
  assert.match(warnings[0], /IPAdapterFaceID \(node 2\) has no LoadImage/)
})

test('graphs without adapters are left alone', () => {
  const graph = { 1: { class_type: 'LoadImage', inputs: { image: 'a.png' } }, 2: { class_type: 'KSampler', inputs: {} } }
  assert.equal(findCastAdapterTargets(graph).hasAdapters, false)
  assert.deepEqual(bindCastToWorkflow(graph, { faceImage: 'f.png' }).workflow, graph)
})
