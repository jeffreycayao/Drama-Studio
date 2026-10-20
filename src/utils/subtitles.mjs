/**
 * Subtitle files (SRT / WebVTT), caption language versions and the pure
 * parts of caption translation. No DOM, store or network access, so every
 * rule here is unit tested (subtitles.test.mjs).
 *
 * Caption cues are `{ id, start, end, text }` in seconds. A live captions
 * clip (`clip.type === 'captions'`) keeps them in its own source time;
 * `collectTimelineSubtitleCues` maps them onto the timeline.
 *
 * Language versions live on the captions payload:
 *   captions.cues           the version being shown (what the renderer draws)
 *   captions.activeVersion  key of that version ('original' when unset)
 *   captions.versions       { [key]: { label, cues, translatedFrom?, updatedAt } }
 * `captions.cues` always wins for the active key, so edits made through the
 * normal cue tools are never lost when switching languages.
 */

export const ORIGINAL_VERSION_KEY = 'original'

export const SUBTITLE_FORMATS = Object.freeze({
  srt: { id: 'srt', label: 'SRT', extension: 'srt' },
  vtt: { id: 'vtt', label: 'WebVTT', extension: 'vtt' },
})

/** Common target languages. `code` is used in file names (BCP 47). */
export const SUBTITLE_LANGUAGES = Object.freeze([
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)', native: 'Português' },
  { code: 'fr', label: 'French', native: 'Français' },
  { code: 'de', label: 'German', native: 'Deutsch' },
  { code: 'it', label: 'Italian', native: 'Italiano' },
  { code: 'ja', label: 'Japanese', native: '日本語' },
  { code: 'ko', label: 'Korean', native: '한국어' },
  { code: 'zh-Hans', label: 'Chinese (Simplified)', native: '简体中文' },
  { code: 'zh-Hant', label: 'Chinese (Traditional)', native: '繁體中文' },
  { code: 'fil', label: 'Filipino', native: 'Filipino' },
  { code: 'id', label: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'vi', label: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'th', label: 'Thai', native: 'ไทย' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'ar', label: 'Arabic', native: 'العربية' },
  { code: 'ru', label: 'Russian', native: 'Русский' },
  { code: 'tr', label: 'Turkish', native: 'Türkçe' },
  { code: 'nl', label: 'Dutch', native: 'Nederlands' },
  { code: 'pl', label: 'Polish', native: 'Polski' },
])

const MIN_CUE_SECONDS = 0.05

// ---------------------------------------------------------------- formats

/** `HH:MM:SS,mmm` (SRT) or `HH:MM:SS.mmm` (WebVTT). Rounds to the millisecond. */
export function formatSubtitleTimestamp(seconds, { separator = ',' } = {}) {
  const totalMs = Math.max(0, Math.round((Number(seconds) || 0) * 1000))
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const secs = Math.floor((totalMs % 60_000) / 1000)
  const ms = totalMs % 1000
  const pad = (value, size = 2) => String(value).padStart(size, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}${separator}${pad(ms, 3)}`
}

function cleanCueText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    // A literal arrow on its own would be read as a timing line by players.
    .replace(/-->/g, '→')
}

/**
 * Drop empty cues, fix bad times, sort by start. Cues keep their order of
 * appearance; overlaps are allowed (both formats support them).
 */
export function prepareSubtitleCues(cues = []) {
  return (Array.isArray(cues) ? cues : [])
    .map((cue, index) => {
      const start = Math.max(0, Number(cue?.start) || 0)
      const rawEnd = Number(cue?.end)
      const end = Number.isFinite(rawEnd) && rawEnd - start >= MIN_CUE_SECONDS ? rawEnd : start + Math.max(MIN_CUE_SECONDS, 1)
      return { index, start, end, text: cleanCueText(cue?.text) }
    })
    .filter((cue) => cue.text)
    .sort((left, right) => left.start - right.start || left.index - right.index)
    .map(({ start, end, text }) => ({ start, end, text }))
}

export function buildSrt(cues = []) {
  const prepared = prepareSubtitleCues(cues)
  return prepared
    .map((cue, index) => `${index + 1}\n${formatSubtitleTimestamp(cue.start)} --> ${formatSubtitleTimestamp(cue.end)}\n${cue.text}\n`)
    .join('\n')
}

function escapeVttText(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function buildWebVtt(cues = [], { language } = {}) {
  const prepared = prepareSubtitleCues(cues)
  const header = language ? `WEBVTT\nLanguage: ${language}\n` : 'WEBVTT\n'
  const body = prepared
    .map((cue, index) => `${index + 1}\n${formatSubtitleTimestamp(cue.start, { separator: '.' })} --> ${formatSubtitleTimestamp(cue.end, { separator: '.' })}\n${escapeVttText(cue.text)}\n`)
    .join('\n')
  return body ? `${header}\n${body}` : header
}

export function buildSubtitleFile(format, cues, options = {}) {
  if (format === 'vtt') return buildWebVtt(cues, options)
  if (format === 'srt') return buildSrt(cues)
  throw new Error(`Unknown subtitle format "${format}". Use srt or vtt.`)
}

/** Safe file name part for a version key ("pt-BR" stays, odd keys collapse). */
export function subtitleFileSuffix(key) {
  if (!key || key === ORIGINAL_VERSION_KEY) return ''
  const cleaned = String(key).replace(/[^A-Za-z0-9-]/g, '').slice(0, 24)
  return cleaned ? `.${cleaned}` : ''
}

// ---------------------------------------------------------------- versions

function versionLabelFor(key, stored) {
  if (stored?.label) return stored.label
  if (key === ORIGINAL_VERSION_KEY) return 'Original'
  return SUBTITLE_LANGUAGES.find((language) => language.code === key)?.label || key
}

/**
 * @returns {{ activeKey: string, versions: Array<{ key, label, cues, isActive, translatedFrom }> }}
 *   the active version first is NOT guaranteed; order is original, then by
 *   creation (object insertion order).
 */
export function getCaptionVersions(captions) {
  const activeKey = captions?.activeVersion || ORIGINAL_VERSION_KEY
  const stored = captions?.versions && typeof captions.versions === 'object' ? captions.versions : {}
  const keys = [...new Set([ORIGINAL_VERSION_KEY, ...Object.keys(stored), activeKey])]
  const versions = keys
    .map((key) => {
      const isActive = key === activeKey
      const cues = isActive ? (Array.isArray(captions?.cues) ? captions.cues : []) : (Array.isArray(stored[key]?.cues) ? stored[key].cues : null)
      if (!cues) return null
      return { key, label: versionLabelFor(key, stored[key]), cues, isActive, translatedFrom: stored[key]?.translatedFrom || null }
    })
    .filter(Boolean)
  return { activeKey, versions }
}

function snapshotActive(captions, now) {
  const activeKey = captions?.activeVersion || ORIGINAL_VERSION_KEY
  const stored = { ...(captions?.versions || {}) }
  stored[activeKey] = {
    ...(stored[activeKey] || {}),
    label: versionLabelFor(activeKey, stored[activeKey]),
    cues: Array.isArray(captions?.cues) ? captions.cues : [],
    updatedAt: now,
  }
  return stored
}

/** Add (or replace) a language version; by default it becomes the one shown. */
export function addCaptionVersion(captions, { key, label, cues, translatedFrom = null, activate = true, now = new Date().toISOString() }) {
  if (!key || key === ORIGINAL_VERSION_KEY) throw new Error('A translated version needs its own language key.')
  if (!Array.isArray(cues) || cues.length === 0) throw new Error('A caption version needs at least one cue.')
  const versions = snapshotActive(captions, now)
  versions[key] = { label: label || versionLabelFor(key, null), cues, translatedFrom, updatedAt: now }
  return activate
    ? { ...captions, versions, activeVersion: key, cues }
    : { ...captions, versions }
}

/** Show another language version. Throws for an unknown key. */
export function switchCaptionVersion(captions, key, { now = new Date().toISOString() } = {}) {
  const activeKey = captions?.activeVersion || ORIGINAL_VERSION_KEY
  if (key === activeKey) return captions
  const versions = snapshotActive(captions, now)
  const target = versions[key]
  if (!target || !Array.isArray(target.cues)) throw new Error(`There is no "${key}" caption version on this clip.`)
  return { ...captions, versions, activeVersion: key, cues: target.cues }
}

/** Remove a translated version. The original cannot be removed; removing the
 * shown version switches back to the original first. */
export function removeCaptionVersion(captions, key, options = {}) {
  if (key === ORIGINAL_VERSION_KEY) throw new Error('The original captions cannot be removed.')
  let next = captions
  if ((captions?.activeVersion || ORIGINAL_VERSION_KEY) === key) next = switchCaptionVersion(captions, ORIGINAL_VERSION_KEY, options)
  const versions = { ...(next.versions || {}) }
  delete versions[key]
  return { ...next, versions }
}

// ---------------------------------------------------------------- timeline

function clipRate(clip) {
  const speed = Number(clip?.speed)
  return Number.isFinite(speed) && speed > 0 ? speed : 1
}

/**
 * Cues of every enabled caption clip on a visible track, in timeline time.
 * - live captions clips (`type: 'captions'`) use `clip.captions` (or the
 *   version named by `versionKey`, falling back to the shown one)
 * - baked caption overlays (an asset with `settings.captionTranscriptPath`)
 *   use cues the caller loaded from their sidecar: `sidecarCues[assetId]`
 * `range` ({ start, end }) shifts cues so the range start is 0 and drops or
 * trims cues outside it, matching an In/Out export.
 */
export function collectTimelineSubtitleCues({ clips = [], tracks = [], sidecarCues = {}, versionKey = null, range = null } = {}) {
  // A hidden caption track is not in the picture, so it is not in the file either.
  const hiddenTracks = new Set(tracks.filter((track) => track?.visible === false).map((track) => track.id))
  const out = []
  for (const clip of clips) {
    if (!clip || clip.enabled === false || hiddenTracks.has(clip.trackId)) continue
    let sourceCues = null
    if (clip.type === 'captions') {
      if (versionKey) {
        const version = getCaptionVersions(clip.captions).versions.find((item) => item.key === versionKey)
        sourceCues = version ? version.cues : clip.captions?.cues
      } else {
        sourceCues = clip.captions?.cues
      }
    } else if (clip.assetId && Array.isArray(sidecarCues[clip.assetId])) {
      sourceCues = sidecarCues[clip.assetId]
    }
    if (!Array.isArray(sourceCues) || sourceCues.length === 0) continue
    const rate = clipRate(clip)
    const trimStart = Number(clip.trimStart) || 0
    const clipStart = Number(clip.startTime) || 0
    const clipDuration = Math.max(0, Number(clip.duration) || 0)
    const visibleSourceEnd = trimStart + clipDuration * rate
    for (const cue of sourceCues) {
      const cueStart = Number(cue?.start) || 0
      const cueEnd = Number(cue?.end) || cueStart
      const fromSource = Math.max(cueStart, trimStart)
      const toSource = Math.min(cueEnd, visibleSourceEnd)
      if (toSource - fromSource < MIN_CUE_SECONDS) continue
      out.push({
        start: clipStart + (fromSource - trimStart) / rate,
        end: clipStart + (toSource - trimStart) / rate,
        text: cue?.text,
      })
    }
  }
  let cues = out
  if (range && Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start) {
    cues = out
      .map((cue) => ({ ...cue, start: Math.max(cue.start, range.start), end: Math.min(cue.end, range.end) }))
      .filter((cue) => cue.end - cue.start >= MIN_CUE_SECONDS)
      .map((cue) => ({ ...cue, start: cue.start - range.start, end: cue.end - range.start }))
  }
  return prepareSubtitleCues(cues)
}

/** Language versions available across the timeline's live captions clips. */
export function listTimelineCaptionVersions(clips = []) {
  const seen = new Map()
  for (const clip of clips) {
    if (clip?.type !== 'captions' || clip.enabled === false) continue
    for (const version of getCaptionVersions(clip.captions).versions) {
      if (!seen.has(version.key)) seen.set(version.key, { key: version.key, label: version.label, isActive: version.isActive })
    }
  }
  return [...seen.values()]
}

// ---------------------------------------------------------------- translation

/** Comfortable reading speed: about 17 characters per second, never under 12. */
export function maxCharsForCue(cue) {
  const seconds = Math.max(0.5, (Number(cue?.end) || 0) - (Number(cue?.start) || 0))
  return Math.max(12, Math.round(seconds * 17))
}

/** Split cues into batches small enough for local models. */
export function chunkCuesForTranslation(cues = [], { maxCues = 30, maxChars = 2400 } = {}) {
  const batches = []
  let current = []
  let chars = 0
  for (const cue of cues) {
    const length = String(cue?.text || '').length
    if (current.length > 0 && (current.length >= maxCues || chars + length > maxChars)) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(cue)
    chars += length
  }
  if (current.length) batches.push(current)
  return batches
}

export const TRANSLATION_SYSTEM_PROMPT = [
  'You translate video subtitles.',
  'Reply with JSON only: an array of objects {"i": number, "text": string}, one per input line, same "i" values, same order.',
  'Keep the meaning and tone. Keep names, brands and numbers as they are. Keep line breaks ("\\n") where they help reading.',
  'Each line has a "max" character budget so it can be read in time: stay at or under it, shortening wording if needed.',
  'Never merge, split, skip or add lines. Do not add notes or explanations.',
].join(' ')

export function buildTranslationPrompt(batch, { targetLanguage, sourceLanguage = null } = {}) {
  if (!targetLanguage) throw new Error('Choose a language to translate into.')
  const lines = batch.map((cue, index) => ({ i: index, text: String(cue?.text || ''), max: maxCharsForCue(cue) }))
  return [
    `Translate these subtitle lines${sourceLanguage ? ` from ${sourceLanguage}` : ''} into ${targetLanguage}.`,
    'Input:',
    JSON.stringify(lines),
  ].join('\n')
}

function extractJsonArray(text) {
  const raw = String(text || '').trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : raw
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')
  if (start === -1 || end <= start) throw new Error('The model did not return a list of translated lines.')
  return JSON.parse(candidate.slice(start, end + 1))
}

/**
 * Translated texts for one batch, in batch order. Throws when lines are
 * missing so the caller can retry instead of shifting text onto the wrong
 * timing.
 */
export function parseTranslationReply(text, batch) {
  let parsed
  try {
    parsed = extractJsonArray(text)
  } catch (error) {
    throw new Error(`Could not read the translation: ${error.message}`)
  }
  if (!Array.isArray(parsed)) throw new Error('The model did not return a list of translated lines.')
  const byIndex = new Map()
  parsed.forEach((item, position) => {
    if (typeof item === 'string') byIndex.set(position, item)
    else if (item && typeof item.text === 'string') byIndex.set(Number.isInteger(item.i) ? item.i : position, item.text)
  })
  const texts = batch.map((_, index) => byIndex.get(index))
  const missing = texts.filter((value) => typeof value !== 'string' || !value.trim()).length
  if (missing > 0) throw new Error(`The translation skipped ${missing} of ${batch.length} lines.`)
  return texts.map((value) => cleanCueText(value))
}

/** New cues with translated text: same ids, timing and styling. */
export function applyTranslatedTexts(cues, texts) {
  if (texts.length !== cues.length) throw new Error('Translated lines do not match the captions.')
  return cues.map((cue, index) => ({ ...cue, text: texts[index] }))
}

/**
 * Translate every cue with `ask({ system, prompt })` (returns the model's
 * text). Batches are retried once. `onProgress({ done, total })` after each
 * batch; `signal` (AbortSignal) stops between batches.
 */
export async function translateCues(cues, { ask, targetLanguage, sourceLanguage = null, onProgress, signal, batchOptions } = {}) {
  if (typeof ask !== 'function') throw new Error('No translation model is available.')
  const source = Array.isArray(cues) ? cues.filter((cue) => String(cue?.text || '').trim()) : []
  if (source.length === 0) throw new Error('There are no caption lines to translate.')
  const batches = chunkCuesForTranslation(source, batchOptions)
  const texts = []
  let done = 0
  for (const batch of batches) {
    if (signal?.aborted) throw new Error('Translation cancelled.')
    const prompt = buildTranslationPrompt(batch, { targetLanguage, sourceLanguage })
    let batchTexts = null
    let lastError = null
    for (let attempt = 0; attempt < 2 && !batchTexts; attempt += 1) {
      try {
        const reply = await ask({ system: TRANSLATION_SYSTEM_PROMPT, prompt })
        batchTexts = parseTranslationReply(reply, batch)
      } catch (error) {
        lastError = error
        if (signal?.aborted) throw new Error('Translation cancelled.')
      }
    }
    if (!batchTexts) throw lastError || new Error('Translation failed.')
    texts.push(...batchTexts)
    done += batch.length
    onProgress?.({ done, total: source.length })
  }
  return applyTranslatedTexts(source, texts)
}
