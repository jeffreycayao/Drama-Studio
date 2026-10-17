import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RECIPES,
  RECIPE_BY_ID,
  buildInventory,
  guessRole,
  normalizeBrief,
  normalizeEditPlan,
  normalizePlan,
  parseModelJson,
  quickAssemble,
  assetIdsToRefs,
  refsToAssetIds,
} from './contracts.mjs'
import { describeSteps, editPlanToSteps } from './editPlanToSteps.mjs'
import { reviewEditPlan } from './review.mjs'

const ASSETS = [
  { id: 'a-speaker', name: 'Interview take 2.mp4', type: 'video', duration: 42 },
  { id: 'a-broll', name: 'Street broll.mp4', type: 'video', duration: 12 },
  { id: 'a-photo', name: 'Poster.png', type: 'image' },
  { id: 'a-vo', name: 'Narration VO.wav', type: 'audio', duration: 20 },
  { id: 'a-song', name: 'Neon Rain.mp3', type: 'audio', settings: { duration: 30 } },
  { id: 'a-hit', name: 'impact sfx.wav', type: 'audio', duration: 1.2 },
  { id: 'a-text', name: 'Old title', type: 'text' },
]
const inventory = buildInventory(ASSETS)
const ref = (assetId) => inventory.find((item) => item.assetId === assetId).ref

test('recipes are complete and ids unique', () => {
  assert.equal(new Set(RECIPES.map((r) => r.id)).size, RECIPES.length)
  for (const recipe of RECIPES) {
    assert.ok(recipe.title && recipe.blurb && recipe.director)
    assert.ok(recipe.questions.length >= 2)
    assert.ok(['16:9', '9:16', '1:1'].includes(recipe.defaults.aspect))
  }
})

test('inventory: media only, short refs, roles guessed from type and name', () => {
  assert.equal(inventory.length, 6, 'text items are left out')
  assert.deepEqual(inventory.map((item) => item.ref), ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'])
  assert.deepEqual(inventory.map((item) => item.role), ['footage', 'footage', 'image', 'voice', 'music', 'sfx'])
  assert.equal(inventory[4].durationSeconds, 30, 'duration read from settings too')
  assert.equal(guessRole({ type: 'audio', name: 'theme.mp3' }), 'music')
  assert.equal(buildInventory(ASSETS, { 'a-song': 'voice' })[4].role, 'voice', 'the user can override a role')
})

test('parseModelJson reads fenced or plain JSON and explains failures', () => {
  assert.deepEqual(parseModelJson('Here you go:\n```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseModelJson('{"b":2} thanks'), { b: 2 })
  assert.throws(() => parseModelJson('no json here'), /did not return a plan/)
  assert.throws(() => parseModelJson('{"broken": }'), /could not be read/)
})

test('normalizeBrief clamps and falls back to recipe defaults', () => {
  const recipe = RECIPE_BY_ID['social-short']
  assert.deepEqual(normalizeBrief({ topic: '  The hook ', targetSeconds: '2000', aspect: '4:3' }, recipe), {
    topic: 'The hook', audience: '', tone: '', mustInclude: '', aspect: '9:16', targetSeconds: 900, pace: 'energetic',
  })
})

test('normalizePlan keeps only real elements and reports the rest', () => {
  const plan = normalizePlan({
    title: 'Rain', scenes: [
      { title: 'Open', seconds: 6, overlay: 'City in the rain', shots: [{ ref: ref('a-broll') }, { ref: 'e99' }, { need: 'aerial shot of the bridge' }] },
      { title: 'Empty', shots: [] },
    ],
  }, inventory)
  assert.equal(plan.scenes.length, 1)
  assert.deepEqual(plan.scenes[0].shots, [{ ref: 'e2', note: '' }, { ref: null, need: 'aerial shot of the bridge' }])
  assert.match(plan.issues.join(' '), /e99/)
})

test('normalizeEditPlan clamps in/out to the asset and drops bad cuts', () => {
  const plan = normalizeEditPlan({
    title: 'T',
    cuts: [
      { ref: ref('a-broll'), in: 10, out: 30 },          // clamped to 12 s long → 2 s
      { ref: ref('a-photo'), seconds: 4 },                // image
      { ref: ref('a-vo'), in: 0, out: 3 },                // audio is not a shot
      { ref: ref('a-speaker'), in: 5, out: 5.2 },         // too short
      { ref: 'e42', in: 0, out: 2 },                      // unknown
    ],
    overlays: [{ text: 'Hello', start: 0, seconds: 99 }, { text: '', start: 1 }, { text: 'Late', start: 500 }],
    music: { ref: ref('a-song') },
    voice: [{ ref: ref('a-vo'), start: 0 }],
  }, inventory, { aspect: '9:16' })
  assert.deepEqual(plan.cuts.map((c) => [c.ref, c.inSeconds, c.seconds, c.kind]), [['e2', 10, 2, 'video'], ['e3', 0, 4, 'image']])
  assert.equal(plan.totalSeconds, 6)
  assert.deepEqual(plan.overlays, [{ text: 'Hello', startSeconds: 0, seconds: 6, style: 'title' }])
  assert.equal(plan.aspect, '9:16')
  assert.equal(plan.music.duck, true, 'music ducks when there is a voice')
  assert.equal(plan.issues.length, 3)
})

test('editPlanToSteps: golden layout for a small edit', () => {
  const plan = normalizeEditPlan({
    title: 'Rain',
    cuts: [{ ref: ref('a-broll'), in: 1, out: 4 }, { ref: ref('a-photo'), seconds: 3, transition: 'dissolve' }],
    overlays: [{ text: 'City in the rain', start: 0, seconds: 2 }],
    music: { ref: ref('a-song'), volumeDb: -12 },
    voice: [{ ref: ref('a-vo'), start: 0.5 }],
    sfx: [{ ref: ref('a-hit'), start: 3 }],
    captions: true,
  }, inventory, { aspect: '16:9' })
  const { steps, totalSeconds } = editPlanToSteps(plan)
  assert.equal(totalSeconds, 6)
  assert.deepEqual(steps, [
    { op: 'checkpoint', label: 'Before Motion: Rain' },
    { op: 'createTimeline', name: 'Motion: Rain', width: 1920, height: 1080 },
    { op: 'useMainTrack', key: 'main' },
    { op: 'placeClip', key: 'cut-1', track: 'main', assetId: 'a-broll', startSeconds: 0, inSeconds: 1, seconds: 3 },
    { op: 'placeClip', key: 'cut-2', track: 'main', assetId: 'a-photo', startSeconds: 3, seconds: 3 },
    { op: 'transition', between: ['cut-1', 'cut-2'], type: 'dissolve', seconds: 0.5 },
    { op: 'addTrack', key: 'titles', type: 'video', name: 'Titles' },
    { op: 'addText', key: 'title-1', track: 'titles', text: 'City in the rain', style: 'title', startSeconds: 0, seconds: 2 },
    { op: 'addTrack', key: 'voice', type: 'audio', name: 'Voice', mixRole: 'dialogue' },
    { op: 'placeClip', key: 'voice-1', track: 'voice', assetId: 'a-vo', startSeconds: 0.5, inSeconds: 0, seconds: 5.5 },
    { op: 'addTrack', key: 'music', type: 'audio', name: 'Music', mixRole: 'bgm' },
    { op: 'placeClip', key: 'music-1', track: 'music', assetId: 'a-song', startSeconds: 0, inSeconds: 0, seconds: 6 },
    { op: 'audioLevel', clip: 'music-1', gainDb: -12, fadeInSeconds: 1, fadeOutSeconds: 2 },
    { op: 'addTrack', key: 'sfx', type: 'audio', name: 'Sound effects', mixRole: 'sfx' },
    { op: 'placeClip', key: 'sfx-1', track: 'sfx', assetId: 'a-hit', startSeconds: 3, inSeconds: 0, seconds: 1.2 },
    { op: 'duck', optional: true },
    { op: 'captions', optional: true },
  ])
  assert.deepEqual(describeSteps({ steps, totalSeconds }), {
    length: '6 s', shots: 2, titles: 1, transitions: 1, voice: 1, music: true, sfx: 1, ducking: true, captions: true,
  })
})

test('main cuts are back to back: no gaps, no overlaps', () => {
  const plan = normalizeEditPlan(quickAssemble(inventory, { targetSeconds: 20, pace: 'steady' }, RECIPE_BY_ID['documentary-montage']), inventory)
  const { steps } = editPlanToSteps(plan)
  const main = steps.filter((step) => step.op === 'placeClip' && step.track === 'main')
  let cursor = 0
  for (const clip of main) {
    assert.ok(Math.abs(clip.startSeconds - cursor) < 1e-6, `gap or overlap at ${clip.key}`)
    cursor += clip.seconds
  }
  assert.ok(Math.abs(cursor - 20) < 0.3, 'fills the target length')
})

test('quick assembly: music video follows the song length', () => {
  const plan = normalizeEditPlan(quickAssemble(inventory, {}, RECIPE_BY_ID['music-video']), inventory)
  assert.ok(Math.abs(plan.totalSeconds - 30) < 0.3)
  assert.equal(plan.music.assetId, 'a-song')
})

test('quick assembly with no visuals gives an empty edit the review explains', () => {
  const audioOnly = buildInventory(ASSETS.filter((a) => a.type === 'audio'))
  const plan = normalizeEditPlan(quickAssemble(audioOnly, { targetSeconds: 10 }), audioOnly)
  assert.equal(plan.cuts.length, 0)
  assert.throws(() => editPlanToSteps(plan), /no shots/)
  assert.equal(reviewEditPlan(plan)[0].id, 'no-shots')
})

test('review flags slideshow risk, length and missing captions', () => {
  const stills = buildInventory([1, 2, 3, 4, 5].map((n) => ({ id: `p${n}`, name: `p${n}.png`, type: 'image' })).concat([{ id: 'vo', name: 'vo narration.wav', type: 'audio', duration: 30 }]))
  const plan = normalizeEditPlan({ cuts: stills.slice(0, 5).map((s) => ({ ref: s.ref, seconds: 7 })), voice: [{ ref: 'e6' }] }, stills)
  const ids = reviewEditPlan(plan, { brief: { targetSeconds: 60 }, recipe: RECIPE_BY_ID['talking-head'] }).map((f) => f.id)
  for (const id of ['slideshow', 'long-still', 'too-short', 'no-music', 'no-captions']) assert.ok(ids.includes(id), id)
})

test('saved plans survive ticking and unticking elements', () => {
  const all = buildInventory([
    { id: 'a1', name: 'one.mp4', type: 'video', duration: 6 },
    { id: 'a2', name: 'two.mp4', type: 'video', duration: 6 },
    { id: 'a3', name: 'three.mp4', type: 'video', duration: 6 },
  ])
  const saved = refsToAssetIds({ cuts: [{ ref: 'e3', in: 1, seconds: 2 }], scenes: [{ shots: [{ ref: 'e2', note: 'x' }, { ref: null, need: 'drone' }] }] }, all)
  assert.deepEqual(saved.cuts[0], { assetId: 'a3', in: 1, seconds: 2 })
  const fewer = buildInventory([{ id: 'a2', name: 'two.mp4', type: 'video', duration: 6 }, { id: 'a3', name: 'three.mp4', type: 'video', duration: 6 }])
  const loaded = assetIdsToRefs(saved, fewer)
  assert.equal(loaded.cuts[0].ref, 'e2', 'a3 is now e2')
  assert.equal(loaded.scenes[0].shots[0].ref, 'e1')
  assert.equal(loaded.scenes[0].shots[1].need, 'drone')
  const gone = assetIdsToRefs(saved, fewer.slice(0, 1))
  assert.equal(gone.cuts[0].ref, null)
  assert.equal(normalizeEditPlan(gone, fewer.slice(0, 1)).cuts.length, 0)
})
