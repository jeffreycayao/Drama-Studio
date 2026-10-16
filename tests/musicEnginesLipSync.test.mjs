// Static verification of the YuE2 / Stable Audio Open / MiniMax Music 3 (Comfy
// Cloud) / sync.so lip-sync workflows against node schemas transcribed from
// ComfyUI 0.41.1 (tests/fixtures/comfyui-0.41.1-audio-lipsync-object-info.json),
// through the app's real dependency checker, plus the lip-sync planner and the
// Smart Replace swap it feeds. Nothing here talks to a real ComfyUI.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import {
  MUSIC_ENGINES, buildMiniMaxMusic3CloudWorkflow, buildStableAudioWorkflow, buildYuE2Workflow,
  clampEngineDuration, resolveEngineInstrumental, validateMusicEngineRequest,
} from '../src/utils/musicEngines.mjs'
import {
  SEGMENT_MARGIN_SECONDS, buildLipSyncWorkflow, canLipSyncClip, listLipSyncAudioCandidates, planLipSync,
} from '../src/utils/lipSyncPlan.mjs'
import { buildSmartReplacePlan } from '../src/utils/smartReplace.mjs'

const require = createRequire(import.meta.url)
const root = new URL('..', import.meta.url)
const readJson = (rel) => JSON.parse(fs.readFileSync(new URL(rel, root), 'utf8'))
const OBJECT_INFO = readJson('tests/fixtures/comfyui-0.41.1-audio-lipsync-object-info.json')

const WORKFLOWS = {
  'yue2-song': 'music_yue2_t2m.json',
  'stable-audio-underscore': 'audio_stable_audio_open_underscore.json',
  'minimax-music3-cloud': 'api_minimax_music3_t2a.json',
  'sync-lipsync': 'api_sync_so_lip_sync.json',
}
const CLOUD = new Set(['minimax-music3-cloud', 'sync-lipsync'])

// ---------------------------------------------------------------------------
// A ComfyUI-style /prompt validator over /object_info schemas: node classes
// exist, required inputs are present, no unknown inputs, combo values are in
// their option lists, numbers in range, and every link points at an existing
// output of a matching type. DynamicCombo sub-inputs use "key.sub" names.
function specOptions(spec) {
  if (Array.isArray(spec?.[0])) return spec[0]
  if (spec?.[0] === 'COMBO') return spec[1]?.options || []
  return null
}
function specType(spec) {
  if (Array.isArray(spec?.[0])) return 'COMBO'
  return spec?.[0]
}
function effectiveInputs(schema, values) {
  const required = { ...(schema.input?.required || {}) }
  const optional = { ...(schema.input?.optional || {}) }
  for (const [name, spec] of Object.entries({ ...schema.input?.required })) {
    if (spec[0] !== 'COMFY_DYNAMICCOMBO_V3') continue
    const option = spec[1].options.find((item) => item.key === values[name])
    required[name] = ['COMBO', { options: spec[1].options.map((item) => item.key) }]
    for (const [sub, subSpec] of Object.entries(option?.inputs?.required || {})) required[`${name}.${sub}`] = subSpec
  }
  return { required, optional }
}
function validatePrompt(workflow, objectInfo) {
  const errors = []
  for (const [id, node] of Object.entries(workflow)) {
    const schema = objectInfo[node.class_type]
    if (!schema) { errors.push(`${id}: unknown class ${node.class_type}`); continue }
    const { required, optional } = effectiveInputs(schema, node.inputs)
    for (const name of Object.keys(required)) if (!(name in node.inputs)) errors.push(`${id} ${node.class_type}: missing ${name}`)
    for (const [name, value] of Object.entries(node.inputs)) {
      const spec = required[name] || optional[name]
      if (!spec) { errors.push(`${id} ${node.class_type}: unknown input ${name}`); continue }
      if (Array.isArray(value)) {
        const [fromId, slot] = value
        const from = workflow[fromId]
        const outType = from && objectInfo[from.class_type]?.output?.[slot]
        if (!outType) errors.push(`${id}.${name}: link to missing output ${fromId}[${slot}]`)
        else if (outType !== specType(spec)) errors.push(`${id}.${name}: ${outType} into ${specType(spec)}`)
        continue
      }
      const options = specOptions(spec)
      if (options && !options.includes(value)) errors.push(`${id}.${name}: ${JSON.stringify(value)} not in options`)
      const type = specType(spec)
      if (type === 'INT' || type === 'FLOAT') {
        if (typeof value !== 'number' || (type === 'INT' && !Number.isInteger(value))) errors.push(`${id}.${name}: not ${type}`)
        if (spec[1]?.min != null && value < spec[1].min) errors.push(`${id}.${name}: below min`)
        if (spec[1]?.max != null && value > spec[1].max) errors.push(`${id}.${name}: above max`)
      }
      if (type === 'STRING' && typeof value !== 'string') errors.push(`${id}.${name}: not a string`)
    }
  }
  if (!Object.values(workflow).some((node) => objectInfo[node.class_type]?.output_node)) errors.push('no output node')
  return errors
}
const topology = (workflow) => Object.fromEntries(Object.entries(workflow).map(([id, node]) => [id, {
  class_type: node.class_type,
  keys: Object.keys(node.inputs).sort(),
  links: Object.fromEntries(Object.entries(node.inputs).filter(([, v]) => Array.isArray(v))),
}]))

for (const [workflowId, file] of Object.entries(WORKFLOWS)) {
  test(`${file} validates against the ComfyUI 0.41.1 schemas`, () => {
    assert.deepEqual(validatePrompt(readJson(`public/workflows/${file}`), OBJECT_INFO), [])
  })
}

test('the validator catches the mistakes it is meant to catch', () => {
  const wf = readJson('public/workflows/music_yue2_t2m.json')
  wf['25'].inputs.mode = 'off'
  delete wf['24'].inputs.penalty_window
  wf['5'].inputs.seconds = ['24', 0]
  const errors = validatePrompt(wf, OBJECT_INFO)
  assert.ok(errors.some((e) => e.includes('mode')))
  assert.ok(errors.some((e) => e.includes('missing penalty_window')))
  assert.ok(errors.some((e) => e.includes('STRING into FLOAT')))
})

test('music engine builders queue exactly the bundled graphs', () => {
  const cases = [
    ['music_yue2_t2m.json', buildYuE2Workflow({ style: 'folk', lyrics: '[verse]\nla', durationSeconds: 90, seed: 7 })],
    ['audio_stable_audio_open_underscore.json', buildStableAudioWorkflow({ prompt: 'ambient pads', durationSeconds: 30, seed: 7 })],
    ['api_minimax_music3_t2a.json', buildMiniMaxMusic3CloudWorkflow({ prompt: 'pop', lyrics: '', durationSeconds: 60, seed: 7 })],
  ]
  for (const [file, built] of cases) {
    assert.deepEqual(topology(built), topology(readJson(`public/workflows/${file}`)), file)
    assert.deepEqual(validatePrompt(built, OBJECT_INFO), [], file)
    const save = Object.values(built).find((node) => /^SaveAudio/.test(node.class_type))
    assert.match(save.inputs.filename_prefix, /^audio\/drama_studio_music_/, 'auto-import must skip app-owned outputs')
  }
})

test('engine limits and request checks', () => {
  assert.equal(clampEngineDuration('stable-audio', 120), 47)
  assert.equal(clampEngineDuration('yue2', 1), 10)
  assert.equal(buildStableAudioWorkflow({ prompt: 'x', durationSeconds: 300 })['11'].inputs.seconds, 47)
  assert.equal(validateMusicEngineRequest('yue2', { tags: 'folk', lyrics: '' }).ok, false)
  // The popover stores instrumental = true by default and hides the checkbox
  // for YuE2, so a leftover true must not block a song (found in a real run).
  assert.equal(validateMusicEngineRequest('yue2', { tags: 'folk', lyrics: 'la', instrumental: true }).ok, true)
  assert.equal(resolveEngineInstrumental('yue2', true), false)
  assert.equal(resolveEngineInstrumental('stable-audio', false), true)
  assert.equal(resolveEngineInstrumental('ace-step', true), true)
  assert.equal(resolveEngineInstrumental('minimax-music3-cloud', false), false)
  assert.equal(validateMusicEngineRequest('stable-audio', { tags: 'pads', instrumental: false }).ok, true)
  assert.equal(validateMusicEngineRequest('minimax-music3-cloud', { tags: '' }).ok, false)
  assert.deepEqual(MUSIC_ENGINES.filter((e) => e.route === 'cloud').map((e) => e.id), ['minimax-music3-cloud'])
})

// ---------------------------------------------------------------------------
// The real checker and registry, bundled with a stubbed ComfyUI client.
const STUBS = {
  './comfyui': `let key = 'test-key'; const queued = []
    export const comfyui = { getComfyOrgApiKey: async () => key, getObjectInfo: async () => ({}),
      queuePrompt: async (wf) => { queued.push(wf); return 'prompt-' + queued.length } }
    export const __setKey = (k) => { key = k }; export const __queued = queued; export default comfyui`,
  './fileSystem': 'export const importAsset = async () => ({}); export const isElectron = () => false',
  '../stores/assetsStore': 'const s = { getState: () => ({ assets: [], folders: [] }) }; export default s; export const useAssetsStore = s',
  '../stores/projectStore': 'const s = { getState: () => ({}) }; export default s; export const useProjectStore = s',
  './comfyPromptGuard': 'export const markPromptHandledByApp = () => {}',
}
async function bundle(entry) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(entry, root))], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /^stub:comfyui$/ }, () => ({ path: './comfyui', namespace: 'stub' }))
      b.onResolve({ filter: /^(\.\/comfyui|\.\/fileSystem|\.\.\/stores\/assetsStore|\.\.\/stores\/projectStore|\.\/comfyPromptGuard)$/ }, (args) => ({ path: args.path, namespace: 'stub' }))
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }))
    } }],
  })
  const mod = { exports: {} }
  // Background pollers must not keep the test process alive.
  const unrefInterval = (fn, ms) => { const timer = setInterval(fn, ms); timer.unref?.(); return timer }
  Function('require', 'module', 'exports', 'setInterval', result.outputFiles[0].text)(require, mod, mod.exports, unrefInterval)
  return mod.exports
}
const wiring = await bundle('tests/fixtures/musicEnginesWiringEntry.mjs')
const realFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  const match = String(url).match(/workflows\/(.+\.json)$/)
  if (!match) return realFetch(url)
  const body = fs.readFileSync(new URL(`public/workflows/${match[1]}`, root), 'utf8')
  return { ok: true, status: 200, json: async () => JSON.parse(body) }
}

for (const workflowId of Object.keys(WORKFLOWS)) {
  test(`dependency checker: ${workflowId} is ready on ComfyUI 0.41.1 and reports what is missing`, async () => {
    wiring.__setKey('test-key')
    const ready = await wiring.checkWorkflowDependencies(workflowId, { objectInfo: OBJECT_INFO, comfyRootPath: '' })
    assert.equal(ready.hasPack, true)
    assert.equal(ready.status, 'ready', JSON.stringify(ready.missingNodes.concat(ready.missingModels)))

    const pack = ready.pack
    const workflow = readJson(`public/workflows/${WORKFLOWS[workflowId]}`)
    const classes = new Set(Object.values(workflow).map((node) => node.class_type))
    for (const node of pack.requiredNodes) assert.ok(classes.has(node.classType), `${node.classType} is not in the graph`)
    for (const model of pack.requiredModels) {
      assert.ok(Object.values(workflow).some((node) => node.class_type === model.classType && node.inputs[model.inputKey] === model.filename), model.filename)
      const recipe = wiring.getModelInstallInfo(model)
      assert.ok(recipe.downloadUrl.startsWith('https://huggingface.co/'), model.filename)
      assert.ok(recipe.sizeBytes > 1e8 && /^[0-9a-f]{64}$/.test(recipe.sha256), model.filename)
    }

    const older = { ...OBJECT_INFO }
    delete older[pack.requiredNodes[0].classType]
    const missing = await wiring.checkWorkflowDependencies(workflowId, { objectInfo: older, comfyRootPath: '' })
    assert.equal(missing.status, 'missing')
    assert.equal(missing.missingNodes[0].classType, pack.requiredNodes[0].classType)
    assert.equal(wiring.getNodeInstallInfo(pack.requiredNodes[0].classType).kind, 'core')

    if (pack.requiredModels.length) {
      const noModels = structuredClone(OBJECT_INFO)
      // A list without the file (an empty list means "cannot enumerate").
      noModels.CheckpointLoaderSimple.input.required.ckpt_name[0] = ['some_other_model.safetensors']
      const result = await wiring.checkWorkflowDependencies(workflowId, { objectInfo: noModels, comfyRootPath: '' })
      assert.ok(result.missingModels.some((m) => m.classType === 'CheckpointLoaderSimple'))
    }
    if (CLOUD.has(workflowId)) {
      assert.equal(ready.hasPriceMetadata, true)
      wiring.__setKey('')
      const noKey = await wiring.checkWorkflowDependencies(workflowId, { objectInfo: OBJECT_INFO, comfyRootPath: '' })
      assert.equal(noKey.missingAuth, true)
      assert.equal(noKey.status, 'missing')
      wiring.__setKey('test-key')
    }
  })
}

test('registry, Generate catalog and setup gallery wiring', () => {
  for (const [workflowId, file] of Object.entries(WORKFLOWS)) {
    assert.ok(wiring.BUILTIN_WORKFLOWS.some((w) => w.id === workflowId && w.file === file), workflowId)
    assert.match(wiring.BUILTIN_WORKFLOW_PATHS[workflowId], new RegExp(`workflows/${file.replace('.', '\\.')}$`))
    const entry = wiring.GENERATE_WORKFLOW_CATALOG.find((item) => item.workflowId === workflowId)
    assert.ok(entry, `${workflowId} catalog entry`)
    assert.equal(entry.route, CLOUD.has(workflowId) ? 'cloud' : 'local')
    // They run from the Music popover / Timeline, never from Conform or Generate's form.
    assert.equal(entry.runnable, false)
    assert.ok(entry.runsFrom)
    assert.equal(wiring.getWorkflowHardwareInfo(workflowId)?.runtime, CLOUD.has(workflowId) ? 'cloud' : 'local')
  }
})

test('cloud music needs explicit approval; the default engine is unchanged', async () => {
  await assert.rejects(wiring.queueMusicGeneration({ tags: 'pop', engine: 'minimax-music3-cloud' }), /spends Comfy\.org credits/)
  assert.equal(wiring.__queued.length, 0)
  await assert.rejects(wiring.queueMusicGeneration({ tags: 'folk', engine: 'yue2', lyrics: '' }), /sings lyrics/)
  const before = wiring.__queued.length
  const jobs = await wiring.queueMusicGeneration({ tags: 'pop', engine: 'minimax-music3-cloud', allowCloudSpend: true, variations: 1, seed: 3 })
  assert.equal(jobs[0].engine, 'minimax-music3-cloud')
  assert.equal(wiring.__queued[before]['1'].class_type, 'ComfyCloudMiniMaxMusic3TextToAudioNode')
  await wiring.queueMusicGeneration({ tags: 'lofi', variations: 1, seed: 1 })
  assert.equal(wiring.__queued.at(-1)['94'].class_type, 'TextEncodeAceStepAudio1.5')
})

test('YuE2 keeps its lyrics when the popover still has Instrumental on', async () => {
  const lyrics = '[verse]\nMorning light on the kitchen floor'
  const [job] = await wiring.queueMusicGeneration({ tags: 'indie folk', engine: 'yue2', lyrics, instrumental: true, variations: 1, seed: 4 })
  assert.equal(job.engine, 'yue2')
  const graph = wiring.__queued.at(-1)
  assert.equal(graph['24'].inputs.lyrics, lyrics)
  assert.equal(graph['25'].inputs.lyrics, lyrics)
})

test('takes without a seed get a random one, not seed 0', async () => {
  const seeds = new Set()
  for (let i = 0; i < 4; i += 1) {
    const [job] = await wiring.queueMusicGeneration({ tags: 'pads', engine: 'stable-audio', variations: 1 })
    seeds.add(job.seed)
    assert.equal(wiring.__queued.at(-1)['3'].inputs.seed, job.seed)
  }
  assert.ok(seeds.size > 1, `seeds: ${[...seeds]}`)
  const [fixed] = await wiring.queueMusicGeneration({ tags: 'pads', engine: 'stable-audio', variations: 1, seed: 0 })
  assert.equal(fixed.seed, 0, 'an explicit seed 0 is kept')
})

// ---------------------------------------------------------------------------
// Lip-sync planning, workflow fill and the Smart Replace swap.
const tracks = [
  { id: 'v1', type: 'video', name: 'V1' },
  { id: 'a1', type: 'audio', name: 'Camera' },
  { id: 'dia', type: 'audio', name: 'Dialogue', mixRole: 'dialogue' },
]
const assets = {
  src: { id: 'src', type: 'video', duration: 20, fps: 24, url: 'blob:src' },
  line: { id: 'line', type: 'audio', duration: 6, url: 'blob:line' },
  cam: { id: 'cam', type: 'audio', duration: 20, url: 'blob:cam' },
}
const getAsset = (id) => assets[id] || null
const shot = { id: 'shot', trackId: 'v1', type: 'video', assetId: 'src', name: 'Shot', startTime: 10, duration: 4,
  trimStart: 5, trimEnd: 9, sourceDuration: 20, sourceFps: 24, timelineFps: 24, speed: 1, linkGroupId: 'g1', url: 'blob:src' }
const camAudio = { id: 'cam-a', trackId: 'a1', type: 'audio', assetId: 'cam', startTime: 10, duration: 4, trimStart: 5, trimEnd: 9, linkGroupId: 'g1' }
const dialogue = { id: 'line-a', trackId: 'dia', type: 'audio', assetId: 'line', startTime: 11, duration: 6, trimStart: 0, trimEnd: 6 }

test('lip-sync plan: source range with margin, dialogue offset and padding, cost', () => {
  const clips = [shot, camAudio, dialogue]
  const candidates = listLipSyncAudioCandidates({ clips, tracks, clipId: 'shot' })
  assert.deepEqual(candidates.map((c) => c.clipId), ['line-a', 'cam-a'], 'dialogue track first, linked camera audio last')
  const plan = planLipSync({ clips, tracks, transitions: [], getAsset, clipId: 'shot', audioClipId: 'line-a' })
  assert.equal(plan.ok, true, plan.reason)
  assert.equal(plan.video.startSeconds, 5 - SEGMENT_MARGIN_SECONDS)
  assert.equal(plan.segmentSeconds, 4 + 2 * SEGMENT_MARGIN_SECONDS)
  assert.equal(plan.sourceInSeconds, SEGMENT_MARGIN_SECONDS)
  // Window is timeline 9.75–14.25; the line starts at 11, so 1.25 s of silence first.
  assert.equal(plan.audio.leadingSilenceSeconds, 1.25)
  assert.equal(plan.audio.startSeconds, 0)
  assert.equal(plan.audio.durationSeconds, 3.25)
  assert.equal(plan.audio.totalSeconds, plan.segmentSeconds)
  assert.equal(plan.estimatedUsd, 0.86)
})

test('lip-sync plan refuses what it cannot line up', () => {
  const base = { tracks, transitions: [], getAsset, clipId: 'shot', audioClipId: 'line-a' }
  assert.match(planLipSync({ ...base, clips: [{ ...shot, speed: 2 }, dialogue] }).reason, /retimed/)
  assert.match(planLipSync({ ...base, clips: [{ ...shot, reverse: true }, dialogue] }).reason, /reverse/)
  assert.match(planLipSync({ ...base, clips: [shot, { ...dialogue, startTime: 30 }] }).reason, /does not overlap/)
  assert.match(planLipSync({ ...base, clips: [{ ...shot, locked: true }, dialogue] }).reason, /Unlock/)
  assert.equal(canLipSyncClip({ ...shot, speed: 1.5 }, tracks[0]), false)
  assert.equal(canLipSyncClip(shot, tracks[0]), true)
  assert.equal(canLipSyncClip(camAudio, tracks[1]), false)
})

test('lip-sync plan covers transition handles', () => {
  const next = { ...shot, id: 'next', startTime: 14, trimStart: 12, trimEnd: 16, linkGroupId: undefined }
  const transitions = [{ id: 't', clipAId: 'shot', clipBId: 'next', duration: 1, kind: 'dissolve', type: 'dissolve' }]
  const plan = planLipSync({ clips: [shot, next, dialogue], tracks, transitions, getAsset, clipId: 'shot', audioClipId: 'line-a' })
  assert.equal(plan.ok, true, plan.reason)
  assert.equal(plan.video.startSeconds + plan.segmentSeconds, 9 + 0.5 + SEGMENT_MARGIN_SECONDS)
})

test('the lip-synced take swaps in through Smart Replace, even a frame short', () => {
  const clips = [shot, camAudio, dialogue]
  const plan = planLipSync({ clips, tracks, transitions: [], getAsset, clipId: 'shot', audioClipId: 'line-a' })
  const take = { id: 'take', type: 'video', url: 'blob:take', fps: 24, duration: plan.segmentSeconds - 1 / 24 }
  const swap = buildSmartReplacePlan({ clips, tracks, transitions: [], clipId: 'shot', asset: take, sourceInSeconds: plan.sourceInSeconds, timelineFps: 24 })
  assert.equal(swap.ok, true, swap.reason)
  assert.equal(swap.updates.assetId, 'take')
  assert.equal(swap.updates.trimStart, SEGMENT_MARGIN_SECONDS)
  assert.equal(swap.updates.trimEnd, SEGMENT_MARGIN_SECONDS + 4)
})

test('lip-sync workflow fill keeps the bundled graph valid', () => {
  const template = readJson('public/workflows/api_sync_so_lip_sync.json')
  const filled = buildLipSyncWorkflow(template, { videoName: 'lipsync_source.mp4', audioName: 'lipsync_dialogue.wav', seed: 5,
    filenamePrefix: 'video/drama_studio_lipsync_x', followActiveSpeaker: true })
  assert.deepEqual(validatePrompt(filled, OBJECT_INFO), [])
  assert.equal(filled['8'].inputs['model.speaker_selection'], 'auto-detect')
  assert.equal(filled['8'].inputs['model.sync_mode'], 'cut_off')
  assert.equal(template['8'].inputs['model.speaker_selection'], 'default', 'template is not mutated')
})

test('lip-sync FFmpeg arguments', () => {
  const { buildVideoSegmentArgs, buildPaddedAudioArgs, validateSegmentRequest } = require('../electron/lipSyncMedia.cjs')
  const video = buildVideoSegmentArgs({ inputPath: 'in.mov', outputPath: 'out.mp4', startSeconds: 4.75, durationSeconds: 4.5 })
  assert.deepEqual(video.slice(video.indexOf('-ss'), video.indexOf('-ss') + 2), ['-ss', '4.750000'])
  assert.ok(video.includes('-an') && video.includes('libx264'))
  const audio = buildPaddedAudioArgs({ inputPath: 'line.wav', outputPath: 'o.wav', startSeconds: 0, durationSeconds: 3.25, leadingSilenceSeconds: 1.25, totalSeconds: 4.5 })
  assert.equal(audio[audio.indexOf('-af') + 1], 'adelay=delays=1250:all=1,apad=whole_dur=4.500000')
  assert.equal(audio[audio.lastIndexOf('-t') + 1], '4.500000')
  assert.equal(validateSegmentRequest({ startSeconds: 0, durationSeconds: 3, leadingSilenceSeconds: 2, totalSeconds: 4 }, { requireTotal: true }).ok, false)
  assert.equal(validateSegmentRequest({ durationSeconds: 700 }).ok, false)
})
