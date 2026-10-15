export const ELEVENLABS_TTS_WORKFLOW_ID = 'elevenlabs-tts'
export const SHORT_FILM_VIDEO_WORKFLOW_ID = 'ltx23-i2v'
export const SHORT_FILM_DIALOGUE_VIDEO_WORKFLOW_ID = 'short-film-dialogue-ltx23-ia2v'

export const SHORT_FILM_KEYFRAME_WORKFLOW_OPTIONS = Object.freeze([
  {
    id: 'image-edit',
    label: 'Qwen Image Edit',
    runtimeLabel: 'Local',
    description: 'Fully local keyframes. Uses the best character or location reference image as the edit source.',
  },
  {
    id: 'nano-banana-2',
    label: 'Nano Banana 2',
    runtimeLabel: 'Cloud',
    description: 'Cloud keyframes. Can generate from the shot prompt and optional character/location references.',
  },
])

export const SHORT_FILM_VIDEO_RESOLUTION_OPTIONS = Object.freeze([
  { id: '720p', label: '720p' },
  { id: '1080p', label: '1080p' },
])

export const SHORT_FILM_DIALOGUE_MOUTH_GUIDANCE = [
  'The speaking character keeps their mouth clearly visible and starts talking immediately.',
  'Their mouth opens enough to read the words, with lips, jaw, cheeks, and chin visibly shaping each syllable in sync with the dialogue.',
  'Avoid closed-mouth mumbling, tiny lip motion, or overly subtle facial movement while keeping the acting natural and believable.',
].join(' ')

export function buildShortFilmDialogueMotionPrompt(speaker = 'The character') {
  const name = String(speaker || 'The character').trim() || 'The character'
  return `${name} speaks the line with clear mouth-opening performance: lips, jaw, cheeks, and chin visibly shape the words in sync with the dialogue, not tiny or closed-mouth mumbling. Hold continuity with the previous shot.`
}

export function strengthenShortFilmDialogueMotionPrompt(motion = '') {
  const text = String(motion || '').trim()
  if (!text) return SHORT_FILM_DIALOGUE_MOUTH_GUIDANCE
  return text
    .replace(/performs the line naturally/gi, 'speaks the line with clearly visible mouth movement')
    .replace(/subtle facial motion/gi, 'clear mouth-opening speech movement')
    .replace(/subtle facial performance/gi, 'clear speech-shaped facial performance')
}

export function buildShortFilmVideoPrompt({
  title = 'Short Film',
  shot = null,
  character = null,
  location = null,
  dialogue = null,
  usesAudio = false,
} = {}) {
  if (usesAudio) {
    const visual = [
      shot?.type ? `${shot.type} of ${character?.name || 'the speaking character'}` : `Shot of ${character?.name || 'the speaking character'}`,
      location?.name ? `inside ${location.name}` : '',
      location?.description || '',
      character?.visualNotes || '',
      shot?.keyframe || '',
      SHORT_FILM_DIALOGUE_MOUTH_GUIDANCE,
      strengthenShortFilmDialogueMotionPrompt(shot?.motion || ''),
    ].map((part) => String(part || '').trim()).filter(Boolean).join(', ')
    const sounds = [
      character?.voiceNotes || '',
      'Speaker is close to camera with a natural conversational tone.',
      location?.name ? `Quiet ${location.name} ambience.` : 'Quiet room ambience.',
    ].map((part) => String(part || '').trim()).filter(Boolean).join(' ')
    return [
      `[VISUAL]: ${visual}`,
      '',
      `[SPEECH]: ${character?.name ? `${character.name} says exactly: ` : ''}"${dialogue?.text || ''}"`,
      '',
      `[SOUNDS]: ${sounds}`,
    ].join('\n')
  }

  const parts = [
    'Animate this keyframe into a cinematic short-film shot.',
    `Project: ${title}.`,
    shot?.scene ? `Scene: ${shot.scene}.` : '',
    shot?.title ? `Shot: ${shot.title}.` : '',
    shot?.type ? `Shot type: ${shot.type}.` : '',
    location?.name ? `Location: ${location.name}. ${location.description || ''}` : '',
    character?.name ? `Character visible: ${character.name}. ${character.visualNotes || ''}` : '',
    dialogue?.text ? `Dialogue being performed: "${dialogue.text}"` : '',
    shot?.keyframe ? `Opening keyframe intent: ${shot.keyframe}` : '',
    `Motion prompt: ${shot?.motion || 'Subtle natural character motion and camera movement.'}`,
    'No dialogue audio is attached. Keep the motion natural, cinematic, and grounded in the first frame.',
    'Avoid subtitles, captions, text overlays, watermarks, logo marks, heavy morphing, or changing the character identity.',
  ]
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join('\n')
}
