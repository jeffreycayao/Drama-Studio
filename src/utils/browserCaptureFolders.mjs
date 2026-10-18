// Where a browser capture lands in the project bin: "AI Sites/<Site>".
// Kept free of stores so node tests can import it.

export const AI_SITES_FOLDER = 'AI Sites'

const SITE_LABELS = Object.freeze({
  'grok-imagine': 'Grok',
  grok: 'Grok',
  gemini: 'Gemini',
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  perplexity: 'Perplexity',
  manus: 'Manus',
  'google-flow': 'Google Flow',
  flow: 'Google Flow',
  kling: 'Kling',
  runway: 'Runway',
  hailuo: 'Hailuo',
  luma: 'Luma',
  pika: 'Pika',
  'chatgpt-images': 'ChatGPT',
  'gemini-images': 'Gemini',
  midjourney: 'Midjourney',
  ideogram: 'Ideogram',
  leonardo: 'Leonardo',
})

/** A readable folder name for the site a capture came from. */
export function captureSiteLabel(site) {
  const id = String(site || '').trim().toLowerCase()
  if (SITE_LABELS[id]) return SITE_LABELS[id]
  const words = id.replace(/[^a-z0-9]+/g, ' ').trim()
  if (!words) return 'Other'
  return words.split(' ').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ').slice(0, 40)
}

export function captureFolderPath(site) {
  return [AI_SITES_FOLDER, captureSiteLabel(site)]
}
