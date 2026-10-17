// Motion Studio: a checked edit plan (contracts.mjs › normalizeEditPlan) →
// ordered timeline steps. Pure and deterministic: the same plan always gives
// the same steps, which the golden tests pin. motionApply.js runs the steps
// through the app's own timeline actions as one checkpointed apply.
//
// Layout of the timeline it builds (top to bottom):
//   Titles  (video, overlay layer: text never cuts the footage)
//   Main    (the new timeline's first video track: cuts back to back, no gaps)
//   Voice   (audio, mix role dialogue)
//   Music   (audio, mix role bgm, ducked under the voice)
//   Sound effects (audio, mix role sfx)

export const ASPECT_SIZES = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
}

const round = (value) => Math.round(value * 1000) / 1000
const TRANSITION_SECONDS = 0.5

export function editPlanToSteps(plan, { timelineName } = {}) {
  if (!plan || !Array.isArray(plan.cuts) || !plan.cuts.length) throw new Error('The edit has no shots to place.')
  const size = ASPECT_SIZES[plan.aspect] || ASPECT_SIZES['16:9']
  const steps = []
  const name = String(timelineName || `Motion: ${plan.title || 'cut'}`).slice(0, 80)

  steps.push({ op: 'checkpoint', label: `Before ${name}` })
  steps.push({ op: 'createTimeline', name, width: size.width, height: size.height })
  steps.push({ op: 'useMainTrack', key: 'main' })

  let cursor = 0
  plan.cuts.forEach((cut, index) => {
    steps.push({
      op: 'placeClip',
      key: `cut-${index + 1}`,
      track: 'main',
      assetId: cut.assetId,
      startSeconds: round(cursor),
      ...(cut.kind === 'video' ? { inSeconds: cut.inSeconds } : {}),
      seconds: cut.seconds,
    })
    cursor += cut.seconds
  })
  const total = round(cursor)

  plan.cuts.forEach((cut, index) => {
    if (index === 0 || cut.transition === 'cut') return
    const before = plan.cuts[index - 1]
    const seconds = round(Math.min(TRANSITION_SECONDS, before.seconds / 3, cut.seconds / 3))
    if (seconds < 0.1) return
    steps.push({ op: 'transition', between: [`cut-${index}`, `cut-${index + 1}`], type: cut.transition === 'fade' ? 'dissolve' : cut.transition, seconds })
  })

  if (plan.overlays.length) {
    steps.push({ op: 'addTrack', key: 'titles', type: 'video', name: 'Titles' })
    plan.overlays.forEach((overlay, index) => {
      steps.push({ op: 'addText', key: `title-${index + 1}`, track: 'titles', text: overlay.text, style: overlay.style, startSeconds: overlay.startSeconds, seconds: overlay.seconds })
    })
  }

  const placeAudio = (trackKey, cues, prefix) => cues.forEach((cue, index) => {
    if (cue.startSeconds >= total) return
    const room = total - cue.startSeconds
    const seconds = cue.seconds ? Math.min(cue.seconds, room) : room
    if (seconds < 0.25) return
    steps.push({ op: 'placeClip', key: `${prefix}-${index + 1}`, track: trackKey, assetId: cue.assetId, startSeconds: cue.startSeconds, inSeconds: cue.inSeconds, seconds: round(seconds) })
  })

  if (plan.voice.length) {
    steps.push({ op: 'addTrack', key: 'voice', type: 'audio', name: 'Voice', mixRole: 'dialogue' })
    placeAudio('voice', plan.voice, 'voice')
  }
  if (plan.music) {
    steps.push({ op: 'addTrack', key: 'music', type: 'audio', name: 'Music', mixRole: 'bgm' })
    placeAudio('music', [{ ...plan.music, seconds: plan.music.seconds || total }], 'music')
    steps.push({ op: 'audioLevel', clip: 'music-1', gainDb: plan.music.volumeDb, fadeInSeconds: plan.music.fadeInSeconds, fadeOutSeconds: plan.music.fadeOutSeconds })
  }
  if (plan.sfx.length) {
    steps.push({ op: 'addTrack', key: 'sfx', type: 'audio', name: 'Sound effects', mixRole: 'sfx' })
    placeAudio('sfx', plan.sfx, 'sfx')
  }
  if (plan.music?.duck && plan.voice.length) steps.push({ op: 'duck', optional: true })
  if (plan.captions) steps.push({ op: 'captions', optional: true })

  return { steps, totalSeconds: total, timelineName: name }
}

/** Plain-language summary of what applying will do, for the preview card. */
export function describeSteps({ steps, totalSeconds }) {
  const count = (op, track) => steps.filter((step) => step.op === op && (!track || step.track === track)).length
  const mins = Math.floor(totalSeconds / 60)
  const secs = Math.round(totalSeconds % 60)
  return {
    length: mins ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs} s`,
    shots: count('placeClip', 'main'),
    titles: count('addText'),
    transitions: count('transition'),
    voice: count('placeClip', 'voice'),
    music: count('placeClip', 'music') > 0,
    sfx: count('placeClip', 'sfx'),
    ducking: steps.some((step) => step.op === 'duck'),
    captions: steps.some((step) => step.op === 'captions'),
  }
}
