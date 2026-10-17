import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  QWEN3_TTS_ZERO_SHOT_PRESET,
  buildQwen3TtsVoiceWorkflow,
  getQwen3TtsRequestError,
  normalizeQwen3TtsOptions,
  normalizeQwen3TtsSeed,
  normalizeQwen3TtsVoicePreset,
  stripQwen3TtsSpeechTags,
} from '../src/utils/qwen3TtsVoiceWorkflow.mjs'
import { resolveQwen3TtsWorkflowInputs } from '../src/utils/qwen3TtsWorkflowCompatibility.mjs'

const bundledPath = fileURLToPath(new URL('../public/workflows/audio_qwen3_tts_voice.json', import.meta.url))
const bundled = JSON.parse(fs.readFileSync(bundledPath, 'utf8'))

function nodesOf(workflow, classType) {
  return Object.entries(workflow).filter(([, node]) => node.class_type === classType)
}

function onlyNode(workflow, classType) {
  const nodes = nodesOf(workflow, classType)
  assert.equal(nodes.length, 1, `expected one ${classType}`)
  return nodes[0][1]
}

test('bundled graph wires engine, reference voice, text and MP3 output', () => {
  const engine = onlyNode(bundled, 'Qwen3TTSEngineNode')
  const text = onlyNode(bundled, 'UnifiedTTSTextNode')
  const voice = onlyNode(bundled, 'CharacterVoicesNode')
  const save = onlyNode(bundled, 'SaveAudioMP3')
  onlyNode(bundled, 'LoadAudio')

  assert.equal(engine.inputs.model_variant, '1.7B')
  assert.deepEqual(text.inputs.TTS_engine, [nodesOf(bundled, 'Qwen3TTSEngineNode')[0][0], 0])
  assert.deepEqual(text.inputs.opt_narrator, [nodesOf(bundled, 'CharacterVoicesNode')[0][0], 0])
  assert.deepEqual(voice.inputs.opt_audio_input, [nodesOf(bundled, 'LoadAudio')[0][0], 0])
  assert.deepEqual(save.inputs.audio, [nodesOf(bundled, 'UnifiedTTSTextNode')[0][0], 0])
})

test('preset voice removes the clone branch and every link to it', () => {
  const result = buildQwen3TtsVoiceWorkflow(bundled, {
    text: '  This is not the room I paid for.  ',
    voicePreset: 'aiden',
    language: 'english',
    instruct: 'tired, quiet',
    seed: 42,
    filenamePrefix: 'audio/drama_studio_test',
  })

  assert.equal(nodesOf(result, 'LoadAudio').length, 0)
  assert.equal(nodesOf(result, 'CharacterVoicesNode').length, 0)
  const engine = onlyNode(result, 'Qwen3TTSEngineNode')
  const text = onlyNode(result, 'UnifiedTTSTextNode')
  assert.equal(engine.inputs.voice_preset, 'Aiden')
  assert.equal(engine.inputs.language, 'English')
  assert.equal(engine.inputs.instruct, 'tired, quiet')
  assert.equal(engine.inputs.x_vector_only_mode, false)
  assert.equal(text.inputs.text, 'This is not the room I paid for.')
  assert.equal(text.inputs.seed, 42)
  assert.equal('opt_narrator' in text.inputs, false)
  assert.equal(onlyNode(result, 'SaveAudioMP3').inputs.filename_prefix, 'audio/drama_studio_test')

  const linkedIds = Object.values(result).flatMap((node) => Object.values(node.inputs || {}))
    .filter((value) => Array.isArray(value)).map((value) => String(value[0]))
  for (const id of linkedIds) assert.ok(result[id], `dangling link to node ${id}`)
})

test('clone mode binds the uploaded clip and its transcript to the Base model', () => {
  const result = buildQwen3TtsVoiceWorkflow(bundled, {
    text: 'Nobody pays for the room they actually get.',
    voiceMode: 'clone',
    voicePreset: 'Ryan',
    referenceAudio: 'mara_reference.wav',
    referenceText: '  I was hoping you would pretend you did not. ',
    instruct: 'ignored for cloning',
  })

  const engine = onlyNode(result, 'Qwen3TTSEngineNode')
  assert.equal(engine.inputs.voice_preset, QWEN3_TTS_ZERO_SHOT_PRESET)
  assert.equal(engine.inputs.instruct, '')
  assert.equal(engine.inputs.x_vector_only_mode, false)
  assert.equal(onlyNode(result, 'LoadAudio').inputs.audio, 'mara_reference.wav')
  const voice = onlyNode(result, 'CharacterVoicesNode')
  assert.equal(voice.inputs.voice_name, 'none')
  assert.equal(voice.inputs.reference_text, 'I was hoping you would pretend you did not.')
  assert.ok(Array.isArray(onlyNode(result, 'UnifiedTTSTextNode').inputs.opt_narrator))
})

test('clone without a transcript falls back to speaker-embedding (x-vector) mode', () => {
  const result = buildQwen3TtsVoiceWorkflow(bundled, {
    text: 'Did you hear that?',
    voiceMode: 'clone',
    referenceAudio: 'clip.mp3',
  })
  assert.equal(onlyNode(result, 'Qwen3TTSEngineNode').inputs.x_vector_only_mode, true)
  assert.equal(onlyNode(result, 'CharacterVoicesNode').inputs.reference_text, '')
})

test('drops bracket tags so caption annotations never switch the speaker', () => {
  assert.equal(stripQwen3TtsSpeechTags('[music] Hola.  [Bob] ¿Qué pasa? [laughs]'), 'Hola. ¿Qué pasa?')
  assert.equal(stripQwen3TtsSpeechTags('Line one [pause:2s]\n  line two'), 'Line one\nline two')
  const result = buildQwen3TtsVoiceWorkflow(bundled, { text: '[Alice] Did you hear that?' })
  assert.equal(onlyNode(result, 'UnifiedTTSTextNode').inputs.text, 'Did you hear that?')
})

test('rejects empty text and clone mode without a reference clip', () => {
  assert.throws(() => buildQwen3TtsVoiceWorkflow(bundled, { text: '   ' }), /line to speak/)
  assert.throws(() => buildQwen3TtsVoiceWorkflow(bundled, { text: '[applause]' }), /line to speak/)
  assert.throws(
    () => buildQwen3TtsVoiceWorkflow(bundled, { text: 'Hi', voiceMode: 'clone' }),
    /reference voice clip/,
  )
  assert.equal(getQwen3TtsRequestError({ text: 'Hi', voiceMode: 'clone', hasReferenceAudio: true }), null)
  assert.equal(getQwen3TtsRequestError({ text: 'Hi', voiceMode: 'preset' }), null)
  assert.throws(() => buildQwen3TtsVoiceWorkflow(null, { text: 'Hi' }), /missing/)
  assert.throws(() => buildQwen3TtsVoiceWorkflow({}, { text: 'Hi' }), /Qwen3TTSEngineNode/)
})

test('does not modify the input workflow', () => {
  const before = JSON.stringify(bundled)
  buildQwen3TtsVoiceWorkflow(bundled, { text: 'Hello', voiceMode: 'clone', referenceAudio: 'a.wav' })
  buildQwen3TtsVoiceWorkflow(bundled, { text: 'Hello' })
  assert.equal(JSON.stringify(bundled), before)
})

test('normalizes presets, languages, sizes and seeds to values the node accepts', () => {
  assert.equal(normalizeQwen3TtsVoicePreset('Uncle Fu'), 'Uncle_Fu')
  assert.equal(normalizeQwen3TtsVoicePreset('ono_anna'), 'Ono_Anna')
  assert.equal(normalizeQwen3TtsVoicePreset('Roger (male, american)'), 'Ryan')
  assert.equal(normalizeQwen3TtsSeed(0), 1)
  assert.equal(normalizeQwen3TtsSeed('abc'), 1)
  assert.equal(normalizeQwen3TtsSeed(2 ** 40), 4294967295)

  const small = normalizeQwen3TtsOptions({ text: 'x', modelSize: '0.6b', language: 'Klingon', instruct: 'shout' })
  assert.equal(small.modelSize, '0.6B')
  assert.equal(small.language, 'Auto')
  assert.equal(small.instruct, '', '0.6B models ignore delivery instructions')
  assert.equal(normalizeQwen3TtsOptions({ modelSize: '7B' }).modelSize, '1.7B')
})

test('legacy engine schemas keep working through the model input compatibility pass', () => {
  const built = buildQwen3TtsVoiceWorkflow(bundled, { text: 'Hello', modelSize: '0.6B' })
  const legacyInfo = {
    Qwen3TTSEngineNode: { input: { required: { model_size: [['1.7B', '0.6B']] }, optional: {} } },
  }
  const resolved = resolveQwen3TtsWorkflowInputs(built, legacyInfo)
  const engine = onlyNode(resolved, 'Qwen3TTSEngineNode')
  assert.equal(engine.inputs.model_size, '0.6B')
  assert.equal('model_variant' in engine.inputs, false)

  const legacyWorkflow = JSON.parse(JSON.stringify(bundled))
  const engineEntry = nodesOf(legacyWorkflow, 'Qwen3TTSEngineNode')[0][1]
  delete engineEntry.inputs.model_variant
  engineEntry.inputs.model_size = '1.7B'
  const rebound = onlyNode(buildQwen3TtsVoiceWorkflow(legacyWorkflow, { text: 'Hi', modelSize: '0.6B' }), 'Qwen3TTSEngineNode')
  assert.equal(rebound.inputs.model_size, '0.6B')
  assert.equal('model_variant' in rebound.inputs, false)
})
