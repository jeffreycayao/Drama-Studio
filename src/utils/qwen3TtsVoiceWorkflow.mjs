/**
 * Local text to speech with Qwen3-TTS (TTS-Audio-Suite node pack).
 *
 * The bundled graph (public/workflows/audio_qwen3_tts_voice.json) is:
 *   Qwen3TTSEngineNode ─► UnifiedTTSTextNode ─► SaveAudioMP3
 *   LoadAudio ─► CharacterVoicesNode ─┘ (opt_narrator, clone mode only)
 *
 * Two voice modes:
 * - preset: a built-in CustomVoice speaker. The reference branch is removed.
 * - clone: zero-shot cloning (Base checkpoint) from a short reference clip.
 *   A transcript of the clip gives the best match; without one the engine
 *   falls back to x-vector (speaker embedding only) mode.
 *
 * The engine receives the legacy size value ("1.7B" / "0.6B") as its model.
 * The node pack maps it to the Base checkpoint when no preset is selected and
 * to the CustomVoice checkpoint otherwise, in old and current versions alike.
 */

export const QWEN3_TTS_WORKFLOW_ID = 'qwen3-tts'

export const QWEN3_TTS_VOICE_MODES = Object.freeze({
  preset: 'preset',
  clone: 'clone',
})

export const QWEN3_TTS_ZERO_SHOT_PRESET = 'None (Zero-shot / Custom)'

// Speakers of the Qwen3-TTS CustomVoice checkpoints. Every speaker can say
// any supported language; their own language sounds most natural.
export const QWEN3_TTS_PRESET_VOICES = Object.freeze([
  Object.freeze({ id: 'Ryan', label: 'Ryan', description: 'Dynamic male voice', nativeLanguage: 'English' }),
  Object.freeze({ id: 'Aiden', label: 'Aiden', description: 'Sunny American male voice', nativeLanguage: 'English' }),
  Object.freeze({ id: 'Vivian', label: 'Vivian', description: 'Bright young female voice', nativeLanguage: 'Chinese' }),
  Object.freeze({ id: 'Serena', label: 'Serena', description: 'Warm, gentle young female voice', nativeLanguage: 'Chinese' }),
  Object.freeze({ id: 'Uncle_Fu', label: 'Uncle Fu', description: 'Low, mellow older male voice', nativeLanguage: 'Chinese' }),
  Object.freeze({ id: 'Dylan', label: 'Dylan', description: 'Youthful Beijing male voice', nativeLanguage: 'Chinese' }),
  Object.freeze({ id: 'Eric', label: 'Eric', description: 'Lively Chengdu male voice', nativeLanguage: 'Chinese' }),
  Object.freeze({ id: 'Ono_Anna', label: 'Ono Anna', description: 'Playful female voice', nativeLanguage: 'Japanese' }),
  Object.freeze({ id: 'Sohee', label: 'Sohee', description: 'Warm, emotional female voice', nativeLanguage: 'Korean' }),
])

export const QWEN3_TTS_DEFAULT_PRESET = 'Ryan'

export const QWEN3_TTS_LANGUAGES = Object.freeze([
  'Auto',
  'English',
  'Chinese',
  'Japanese',
  'Korean',
  'German',
  'French',
  'Russian',
  'Portuguese',
  'Spanish',
  'Italian',
])

export const QWEN3_TTS_MODEL_SIZES = Object.freeze(['1.7B', '0.6B'])
export const QWEN3_TTS_DEFAULT_MODEL_SIZE = '1.7B'

const MAX_SEED = 4294967295
const ENGINE_CLASS = 'Qwen3TTSEngineNode'
const TEXT_CLASS = 'UnifiedTTSTextNode'
const VOICE_CLASS = 'CharacterVoicesNode'
const LOAD_AUDIO_CLASS = 'LoadAudio'
const SAVE_CLASSES = new Set(['SaveAudioMP3', 'SaveAudio', 'SaveAudioOpus'])

function cleanString(value) {
  return String(value ?? '').trim()
}

function pickFrom(list, value, fallback) {
  const raw = cleanString(value)
  if (!raw) return fallback
  const match = list.find((entry) => entry.toLowerCase() === raw.toLowerCase())
  return match || fallback
}

export function normalizeQwen3TtsVoicePreset(value) {
  const raw = cleanString(value).replace(/\s+/g, '_')
  const match = QWEN3_TTS_PRESET_VOICES.find((voice) => voice.id.toLowerCase() === raw.toLowerCase())
  return match ? match.id : QWEN3_TTS_DEFAULT_PRESET
}

/**
 * The TTS Text node reads [Name] as a speaker switch (and maps unknown names to
 * other preset speakers) and [pause:1s] as a pause. Caption lines often carry
 * annotations such as [music] or [laughs], which must not change the voice,
 * so square-bracket tags are dropped from the spoken text.
 */
export function stripQwen3TtsSpeechTags(value) {
  return String(value ?? '')
    .replace(/\[[^\]\n]*\]/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
}

export function normalizeQwen3TtsSeed(value) {
  const number = Math.round(Number(value))
  if (!Number.isFinite(number) || number < 1) return 1
  return Math.min(number, MAX_SEED)
}

/**
 * Normalize user/job settings into the shape the workflow binder expects.
 * Unknown values fall back to safe defaults instead of failing.
 */
export function normalizeQwen3TtsOptions(options = {}) {
  const mode = cleanString(options.voiceMode || options.mode).toLowerCase() === QWEN3_TTS_VOICE_MODES.clone
    ? QWEN3_TTS_VOICE_MODES.clone
    : QWEN3_TTS_VOICE_MODES.preset
  const modelSize = pickFrom(QWEN3_TTS_MODEL_SIZES, options.modelSize, QWEN3_TTS_DEFAULT_MODEL_SIZE)
  return {
    text: stripQwen3TtsSpeechTags(options.text),
    voiceMode: mode,
    voicePreset: normalizeQwen3TtsVoicePreset(options.voicePreset),
    referenceText: mode === QWEN3_TTS_VOICE_MODES.clone ? cleanString(options.referenceText) : '',
    language: pickFrom(QWEN3_TTS_LANGUAGES, options.language, 'Auto'),
    // Delivery instructions only reach the 1.7B CustomVoice (preset) model.
    instruct: mode === QWEN3_TTS_VOICE_MODES.preset && modelSize === '1.7B' ? cleanString(options.instruct) : '',
    modelSize,
  }
}

/**
 * Returns a readable reason the request cannot run yet, or null when it can.
 */
export function getQwen3TtsRequestError({ text, voiceMode, hasReferenceAudio } = {}) {
  if (!stripQwen3TtsSpeechTags(text)) return 'Type the line to speak first.'
  if (cleanString(voiceMode).toLowerCase() === QWEN3_TTS_VOICE_MODES.clone && !hasReferenceAudio) {
    return 'Pick a reference voice clip (3 to 30 seconds of clean speech) to clone, or switch to a preset voice.'
  }
  return null
}

function findNodeIds(workflow, classTypes) {
  const wanted = classTypes instanceof Set ? classTypes : new Set([classTypes])
  return Object.entries(workflow)
    .filter(([, node]) => wanted.has(String(node?.class_type || '').trim()))
    .map(([id]) => id)
}

function isLinkTo(value, nodeIds) {
  return Array.isArray(value) && value.length === 2 && nodeIds.has(String(value[0]))
}

/**
 * Bind text, voice and output settings into the bundled Qwen3-TTS graph.
 * Returns a new workflow object; the input is not changed.
 *
 * @param {object} workflow API-format workflow (audio_qwen3_tts_voice.json)
 * @param {object} options
 * @param {string} options.text Line to speak.
 * @param {'preset'|'clone'} [options.voiceMode]
 * @param {string} [options.voicePreset] Preset speaker id (preset mode).
 * @param {string} [options.referenceAudio] Uploaded ComfyUI input filename (clone mode).
 * @param {string} [options.referenceText] What the reference clip says (clone mode).
 * @param {string} [options.language] One of QWEN3_TTS_LANGUAGES.
 * @param {string} [options.instruct] Delivery instruction (1.7B preset voices).
 * @param {string} [options.modelSize] '1.7B' or '0.6B'.
 * @param {number} [options.seed]
 * @param {string} [options.filenamePrefix]
 */
export function buildQwen3TtsVoiceWorkflow(workflow, options = {}) {
  if (!workflow || typeof workflow !== 'object') {
    throw new Error('Qwen3 TTS workflow is missing.')
  }
  const settings = normalizeQwen3TtsOptions(options)
  const referenceAudio = cleanString(options.referenceAudio)
  const requestError = getQwen3TtsRequestError({
    text: settings.text,
    voiceMode: settings.voiceMode,
    hasReferenceAudio: Boolean(referenceAudio),
  })
  if (requestError) throw new Error(requestError)

  const modified = JSON.parse(JSON.stringify(workflow))
  const engineIds = findNodeIds(modified, ENGINE_CLASS)
  const textIds = findNodeIds(modified, TEXT_CLASS)
  if (engineIds.length === 0 || textIds.length === 0) {
    throw new Error('Qwen3 TTS workflow needs a Qwen3TTSEngineNode and a UnifiedTTSTextNode.')
  }

  const isClone = settings.voiceMode === QWEN3_TTS_VOICE_MODES.clone
  if (isClone) {
    const loadIds = findNodeIds(modified, LOAD_AUDIO_CLASS)
    const voiceIds = findNodeIds(modified, VOICE_CLASS)
    if (loadIds.length === 0 || voiceIds.length === 0) {
      throw new Error('Qwen3 TTS workflow needs LoadAudio and CharacterVoicesNode for voice cloning.')
    }
    for (const id of loadIds) modified[id].inputs.audio = referenceAudio
    for (const id of voiceIds) {
      const inputs = modified[id].inputs
      inputs.voice_name = 'none'
      inputs.reference_text = settings.referenceText
    }
  } else {
    // Preset voices need no reference: drop the clone branch and any links to it.
    const removed = new Set([
      ...findNodeIds(modified, LOAD_AUDIO_CLASS),
      ...findNodeIds(modified, VOICE_CLASS),
    ])
    for (const id of removed) delete modified[id]
    for (const node of Object.values(modified)) {
      if (!node?.inputs) continue
      for (const [key, value] of Object.entries(node.inputs)) {
        if (isLinkTo(value, removed)) delete node.inputs[key]
      }
    }
  }

  for (const id of engineIds) {
    const inputs = modified[id].inputs || (modified[id].inputs = {})
    const hasLegacyKey = Object.prototype.hasOwnProperty.call(inputs, 'model_size')
      && !Object.prototype.hasOwnProperty.call(inputs, 'model_variant')
    inputs[hasLegacyKey ? 'model_size' : 'model_variant'] = settings.modelSize
    inputs.voice_preset = isClone ? QWEN3_TTS_ZERO_SHOT_PRESET : settings.voicePreset
    inputs.language = settings.language
    inputs.instruct = settings.instruct
    inputs.x_vector_only_mode = isClone && !settings.referenceText
  }

  for (const id of textIds) {
    const inputs = modified[id].inputs
    inputs.text = settings.text
    inputs.narrator_voice = 'none'
    inputs.seed = normalizeQwen3TtsSeed(options.seed)
  }

  const prefix = cleanString(options.filenamePrefix)
  if (prefix) {
    for (const id of findNodeIds(modified, SAVE_CLASSES)) {
      modified[id].inputs.filename_prefix = prefix
    }
  }

  return modified
}
