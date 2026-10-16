/**
 * Music popover engines beyond ACE-Step, as pure ComfyUI API-format graph
 * builders. Each builder mirrors one bundled workflow file node for node
 * (public/workflows/*.json), so the dependency packs, the bundled file and
 * what actually gets queued cannot drift apart (tests/musicEnginesWorkflows
 * compares them).
 *
 * Node ids and inputs come from ComfyUI 0.41.1 core and its official
 * templates/blueprints:
 *   yue2               blueprints/Text to Music (YuE2).json, comfy_extras/nodes_yue2.py
 *   stable-audio       templates/audio_stable_audio_example.json
 *   minimax-music3-cloud  comfy_api_nodes/nodes_comfy_cloud.py
 *                      (ComfyCloudMiniMaxMusic3TextToAudioNode, beta)
 */

export const MUSIC_ENGINE_IDS = Object.freeze({
  aceStep: 'ace-step',
  yue2: 'yue2',
  stableAudio: 'stable-audio',
  minimaxCloud: 'minimax-music3-cloud',
})

export const YUE2_CHECKPOINT = 'yue2_3b_int8_convrot.safetensors'
export const STABLE_AUDIO_CHECKPOINT = 'stable-audio-open-1.0.safetensors'
export const STABLE_AUDIO_TEXT_ENCODER = 't5-base.safetensors'

/**
 * Popover-facing description of each engine. Durations are what the popover
 * allows, not the node maxima: Stable Audio Open 1.0 is trained on clips up
 * to ~47 s, YuE2 and MiniMax may end a song before max_duration.
 */
export const MUSIC_ENGINES = Object.freeze([
  Object.freeze({
    id: MUSIC_ENGINE_IDS.aceStep,
    label: 'ACE-Step 1.5 (local)',
    workflowId: 'music-gen',
    route: 'local',
    lyrics: 'optional',
    usesBpmKey: true,
    minDuration: 5,
    maxDuration: 240,
    note: '',
  }),
  Object.freeze({
    id: MUSIC_ENGINE_IDS.yue2,
    label: 'YuE2 songs (local)',
    workflowId: 'yue2-song',
    route: 'local',
    lyrics: 'required',
    usesBpmKey: false,
    minDuration: 10,
    maxDuration: 240,
    note: 'Sings your lyrics. The song can end before the requested length. YuE2 weights are CC BY-NC 4.0: non-commercial use only.',
  }),
  Object.freeze({
    id: MUSIC_ENGINE_IDS.stableAudio,
    label: 'Stable Audio Open underscore (local)',
    workflowId: 'stable-audio-underscore',
    route: 'local',
    lyrics: 'none',
    usesBpmKey: false,
    minDuration: 5,
    maxDuration: 47,
    note: 'Instrumental beds up to 47 seconds; loop or extend them on the timeline. Stability AI Community License.',
  }),
  Object.freeze({
    id: MUSIC_ENGINE_IDS.minimaxCloud,
    label: 'MiniMax Music 3 (cloud, beta)',
    workflowId: 'minimax-music3-cloud',
    route: 'cloud',
    lyrics: 'optional',
    usesBpmKey: false,
    minDuration: 5,
    maxDuration: 240,
    note: 'Runs on Comfy Cloud and spends Comfy.org credits, billed by GPU time (about $0.0013 per GPU-second in ComfyUI 0.41.1). The total is not known before the run. Comfy marks this node beta.',
  }),
])

export function getMusicEngine(engineId) {
  return MUSIC_ENGINES.find((engine) => engine.id === engineId) || MUSIC_ENGINES[0]
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export function clampEngineDuration(engineId, value) {
  const engine = getMusicEngine(engineId)
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return clamp(30, engine.minDuration, engine.maxDuration)
  return clamp(Math.round(parsed), engine.minDuration, engine.maxDuration)
}

function safeSeed(seed) {
  const parsed = Number(seed)
  return Number.isFinite(parsed) ? Math.abs(Math.floor(parsed)) : 0
}

/** Local YuE2: ABC score pass, then music tokens, then the YuE2 VAE. */
export function buildYuE2Workflow({ style, lyrics, durationSeconds = 120, seed = 0, filenamePrefix = 'audio/drama_studio_music_yue2' } = {}) {
  const safeStyle = String(style || '').trim()
  const safeLyrics = String(lyrics || '').trim()
  const seedValue = safeSeed(seed)
  const seconds = clampEngineDuration(MUSIC_ENGINE_IDS.yue2, durationSeconds)
  return {
    15: {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: YUE2_CHECKPOINT },
    },
    24: {
      class_type: 'YuE2GenerateABC',
      inputs: {
        style: safeStyle,
        lyrics: safeLyrics,
        seed: seedValue,
        mode: 'full',
        max_abc_tokens: 8192,
        temperature: 0.7,
        top_p: 0.9,
        top_k: 30,
        repetition_penalty: 1.005,
        penalty_window: 100,
        clip: ['15', 1],
      },
    },
    25: {
      class_type: 'YuE2GenerateMusic',
      inputs: {
        style: safeStyle,
        lyrics: safeLyrics,
        abc: ['24', 0],
        seed: seedValue,
        mode: 'full',
        max_duration: seconds,
        temperature: 1,
        top_p: 0.95,
        top_k: 100,
        repetition_penalty: 1.2,
        clip: ['15', 1],
      },
    },
    18: {
      class_type: 'ConditioningZeroOut',
      inputs: { conditioning: ['25', 0] },
    },
    5: {
      class_type: 'EmptyYuE2LatentAudio',
      // Length comes from the generated tokens, not the request.
      inputs: { seconds: ['25', 1], batch_size: 1 },
    },
    8: {
      class_type: 'KSampler',
      inputs: {
        seed: seedValue,
        steps: 32,
        cfg: 1,
        sampler_name: 'dpm_2',
        scheduler: 'sgm_uniform',
        denoise: 1,
        model: ['15', 0],
        positive: ['25', 0],
        negative: ['18', 0],
        latent_image: ['5', 0],
      },
    },
    9: {
      class_type: 'VAEDecodeAudio',
      inputs: { samples: ['8', 0], vae: ['15', 2] },
    },
    40: {
      class_type: 'SaveAudioAdvanced',
      inputs: { filename_prefix: filenamePrefix, format: 'mp3', 'format.quality': 'V0', audio: ['9', 0] },
    },
  }
}

/** Local Stable Audio Open 1.0, the official ComfyUI example graph. */
export function buildStableAudioWorkflow({ prompt, negativePrompt = '', durationSeconds = 30, seed = 0, filenamePrefix = 'audio/drama_studio_music_stableaudio' } = {}) {
  const seedValue = safeSeed(seed)
  return {
    4: {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: STABLE_AUDIO_CHECKPOINT },
    },
    10: {
      class_type: 'CLIPLoader',
      inputs: { clip_name: STABLE_AUDIO_TEXT_ENCODER, type: 'stable_audio', device: 'default' },
    },
    6: {
      class_type: 'CLIPTextEncode',
      inputs: { text: String(prompt || '').trim(), clip: ['10', 0] },
    },
    7: {
      class_type: 'CLIPTextEncode',
      inputs: { text: String(negativePrompt || ''), clip: ['10', 0] },
    },
    11: {
      class_type: 'EmptyLatentAudio',
      inputs: { seconds: clampEngineDuration(MUSIC_ENGINE_IDS.stableAudio, durationSeconds), batch_size: 1 },
    },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed: seedValue,
        steps: 50,
        cfg: 4.98,
        sampler_name: 'dpmpp_3m_sde_gpu',
        scheduler: 'exponential',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['11', 0],
      },
    },
    12: {
      class_type: 'VAEDecodeAudio',
      inputs: { samples: ['3', 0], vae: ['4', 2] },
    },
    19: {
      // The template's SaveAudioMP3 is deprecated in ComfyUI 0.41.1.
      class_type: 'SaveAudioAdvanced',
      inputs: { filename_prefix: filenamePrefix, format: 'mp3', 'format.quality': 'V0', audio: ['12', 0] },
    },
  }
}

/** Cloud MiniMax Music 3 on Comfy Cloud. Empty lyrics = instrumental. */
export function buildMiniMaxMusic3CloudWorkflow({ prompt, lyrics = '', durationSeconds = 120, seed = 0, filenamePrefix = 'audio/drama_studio_music_minimax3' } = {}) {
  return {
    1: {
      class_type: 'ComfyCloudMiniMaxMusic3TextToAudioNode',
      inputs: {
        prompt: String(prompt || '').trim(),
        lyrics: String(lyrics || '').trim(),
        // The node caps the seed at int64.
        seed: Math.min(safeSeed(seed), Number.MAX_SAFE_INTEGER),
        max_duration: clampEngineDuration(MUSIC_ENGINE_IDS.minimaxCloud, durationSeconds),
        audio_quality: 'V0',
      },
    },
    2: {
      class_type: 'SaveAudioAdvanced',
      inputs: { filename_prefix: filenamePrefix, format: 'mp3', 'format.quality': 'V0', audio: ['1', 0] },
    },
  }
}

/**
 * Whether a take is instrumental for this engine. The popover's Instrumental
 * checkbox (stored, default on) only exists for engines with optional lyrics,
 * so a leftover value must not blank YuE2's lyrics or block Generate.
 */
export function resolveEngineInstrumental(engineId, instrumental = false) {
  const engine = getMusicEngine(engineId)
  if (engine.lyrics === 'none') return true
  if (engine.lyrics === 'required') return false
  return Boolean(instrumental)
}

/**
 * Validate a popover request for one engine. Returns { ok, reason? } so the
 * UI can disable Generate with the same message the service would throw.
 */
export function validateMusicEngineRequest(engineId, { tags = '', lyrics = '', instrumental = false } = {}) {
  const engine = getMusicEngine(engineId)
  if (!String(tags || '').trim()) return { ok: false, reason: 'Describe the music first (style, mood, instruments).' }
  // `instrumental` is ignored here on purpose: see resolveEngineInstrumental.
  if (engine.lyrics === 'required' && !String(lyrics || '').trim()) {
    return { ok: false, reason: `${engine.label} sings lyrics. Add lyrics, or pick another engine for an instrumental.` }
  }
  return { ok: true }
}
