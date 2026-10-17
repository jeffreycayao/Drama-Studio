// Motion Studio review checks on a checked edit plan. Plain rules, no AI:
// each finding says what is wrong in plain words and what to do about it.

const fmt = (seconds) => `${Math.round(seconds)} s`

export function reviewEditPlan(plan, { brief = {}, recipe = null } = {}) {
  const findings = []
  const add = (level, id, text) => findings.push({ level, id, text })
  if (!plan || !plan.cuts?.length) {
    add('error', 'no-shots', 'There are no shots to place. Add footage or images in Elements.')
    return findings
  }
  const total = plan.totalSeconds
  const stills = plan.cuts.filter((cut) => cut.kind === 'image')
  if (stills.length / plan.cuts.length > 0.6 && plan.cuts.length >= 4) {
    add('warn', 'slideshow', `Most shots (${stills.length} of ${plan.cuts.length}) are still images, so it may feel like a slideshow. Add a few video clips, or generate motion from the images in Generate.`)
  }
  const longStill = stills.find((cut) => cut.seconds > 6)
  if (longStill) add('info', 'long-still', 'A still image is held for more than 6 seconds. Shorten it, or give it a slow zoom in the Inspector › Motion.')
  const tiny = plan.cuts.filter((cut) => cut.seconds < 0.8).length
  if (tiny > 2) add('info', 'very-short', `${tiny} shots are under 0.8 seconds, which can feel jumpy outside a music video.`)

  const target = Number(brief.targetSeconds) || 0
  if (target > 0 && recipe?.id !== 'music-video') {
    if (total < target * 0.8) add('warn', 'too-short', `The cut is ${fmt(total)}, shorter than the ${fmt(target)} you asked for. Add more elements, or lower the length in Brief.`)
    if (total > target * 1.25) add('info', 'too-long', `The cut is ${fmt(total)}, longer than the ${fmt(target)} you asked for.`)
  }
  if (plan.music && plan.music.seconds && plan.music.seconds < total - 1) {
    add('warn', 'music-short', 'The music ends before the video does. Pick a longer track, or trim the end in the editor.')
  }
  if (!plan.music && recipe?.roles?.includes('music')) add('info', 'no-music', 'There is no music. Add a song in Elements, or generate one in Generate › Audio.')
  if (plan.overlays.some((overlay) => overlay.text.length > 60)) add('info', 'long-title', 'A title is long for the screen. Shorter titles read better, especially on phones.')
  if (plan.aspect === '9:16' && plan.overlays.length === 0) add('info', 'no-hook', 'Vertical videos do better with a short title or hook in the first seconds.')
  if (plan.voice.length && !plan.captions) add('info', 'no-captions', 'There is speech but no captions. Most people watch muted: add captions with Timeline toolbar › Captions.')
  for (const issue of plan.issues || []) add('info', 'plan-issue', issue)
  return findings
}
