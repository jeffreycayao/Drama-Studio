/**
 * Subtitle files and caption translation for the open project.
 *
 * Pure rules (formats, timing, versions, translation batching) live in
 * utils/subtitles.mjs; this module reads the stores, loads baked-caption
 * sidecars, writes files through the desktop bridge and asks the Assistant
 * model to translate. Shared by the Export tab, the timeline clip menu, the
 * translate dialog and the MCP tools.
 */

import useTimelineStore from '../stores/timelineStore'
import useAssetsStore from '../stores/assetsStore'
import useProjectStore from '../stores/projectStore'
import { loadCaptionSidecar } from './captionProject'
import { askStoryAssistant, cancelStoryAssistant } from './storyAssistant'
import {
  ORIGINAL_VERSION_KEY,
  SUBTITLE_FORMATS,
  addCaptionVersion,
  buildSubtitleFile,
  collectTimelineSubtitleCues,
  getCaptionVersions,
  listTimelineCaptionVersions,
  removeCaptionVersion,
  subtitleFileSuffix,
  switchCaptionVersion,
  translateCues,
} from '../utils/subtitles.mjs'

export { ORIGINAL_VERSION_KEY, SUBTITLE_FORMATS }

function api() {
  return globalThis.window?.electronAPI || null
}

export function sanitizeSubtitleBaseName(value) {
  return String(value || 'DramaStudio_Captions')
    .trim()
    .replace(/\.(srt|vtt)$/i, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    // No leading dots: "." or ".." would point at the folder above.
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 120)
    || 'DramaStudio_Captions'
}

/** `<project>_<timeline>`, the same default name the XML hand-off uses. */
export function defaultSubtitleBaseName() {
  const { currentProject, currentTimelineId } = useProjectStore.getState()
  const timeline = currentProject?.timelines?.find((item) => item.id === currentTimelineId)
  return sanitizeSubtitleBaseName(`${currentProject?.name || 'Untitled'}_${timeline?.name || 'Timeline'}`)
}

/** Cues for baked caption overlays (rendered videos with a .caption.json sidecar). */
async function loadOverlaySidecarCues(clips) {
  const projectHandle = useProjectStore.getState().currentProjectHandle
  const { getAssetById } = useAssetsStore.getState()
  const out = {}
  if (!projectHandle) return out
  for (const clip of clips) {
    if (!clip?.assetId || clip.type === 'captions' || out[clip.assetId]) continue
    const asset = getAssetById?.(clip.assetId)
    const path = asset?.settings?.captionScope || asset?.settings?.sourceAssetId ? asset?.settings?.captionTranscriptPath : null
    if (!path) continue
    try {
      const sidecar = await loadCaptionSidecar(projectHandle, path)
      if (Array.isArray(sidecar?.cues)) out[clip.assetId] = sidecar.cues
    } catch (error) {
      console.warn('[subtitles] Could not read a caption sidecar:', path, error)
    }
  }
  return out
}

/** Every language version present on the timeline's live captions. */
export function getTimelineCaptionLanguages() {
  return listTimelineCaptionVersions(useTimelineStore.getState().clips || [])
}

/**
 * @param {{ versionKey?: string|null, range?: {start:number,end:number}|null }} options
 * @returns {Promise<{ cues: Array, cueCount: number }>}
 */
export async function collectSubtitleCues({ versionKey = null, range = null } = {}) {
  const { clips = [], tracks = [] } = useTimelineStore.getState()
  const sidecarCues = await loadOverlaySidecarCues(clips)
  const cues = collectTimelineSubtitleCues({ clips, tracks, sidecarCues, versionKey, range })
  return { cues, cueCount: cues.length }
}

/** Plan the files a save would write (no writing). */
export async function planSubtitleFiles({ formats = ['srt'], languages = 'active', range = null } = {}) {
  const wanted = formats.filter((format) => SUBTITLE_FORMATS[format])
  if (wanted.length === 0) throw new Error('Choose SRT, WebVTT or both.')
  const versions = getTimelineCaptionLanguages()
  const versionKeys = languages === 'all' && versions.length > 1
    ? versions.map((version) => version.key)
    : [null]
  const files = []
  for (const versionKey of versionKeys) {
    const { cues } = await collectSubtitleCues({ versionKey, range })
    const label = versionKey ? versions.find((version) => version.key === versionKey)?.label : versions.find((version) => version.isActive)?.label
    for (const format of wanted) {
      files.push({
        format,
        versionKey,
        label: label || 'Captions',
        suffix: versionKey ? subtitleFileSuffix(versionKey) : '',
        cueCount: cues.length,
        content: buildSubtitleFile(format, cues, { language: versionKey && versionKey !== ORIGINAL_VERSION_KEY ? versionKey : undefined }),
      })
    }
  }
  return files
}

/**
 * Write subtitle files next to `basePath` (a full path without extension),
 * e.g. `C:\\renders\\Film` → `Film.srt`, `Film.es.srt`.
 * @returns {Promise<{ paths: string[], cueCount: number }>}
 */
export async function writeSubtitleFiles({ basePath, formats, languages, range } = {}) {
  const bridge = api()
  if (!bridge?.writeFile) throw new Error('Saving subtitle files needs the Drama Studio desktop app.')
  if (!basePath) throw new Error('No place to save the subtitle file.')
  const files = await planSubtitleFiles({ formats, languages, range })
  if (files.every((file) => file.cueCount === 0)) {
    throw new Error('This timeline has no captions to save. Add captions first (timeline toolbar › Captions).')
  }
  const paths = []
  for (const file of files) {
    if (file.cueCount === 0) continue
    const path = `${basePath}${file.suffix}.${SUBTITLE_FORMATS[file.format].extension}`
    const result = await bridge.writeFile(path, file.content, { encoding: 'utf8' })
    if (result?.success === false) throw new Error(result.error || `Could not write ${path}.`)
    paths.push(path)
  }
  return { paths, cueCount: Math.max(...files.map((file) => file.cueCount)) }
}

/** Strip the extension a save dialog returns. */
export function stripSubtitleExtension(path) {
  return String(path || '').replace(/\.(srt|vtt|mp4|mov|webm|m4a|mp3|wav|gif)$/i, '')
}

/** Ask where to save, then write. Returns null when the user cancels. */
export async function saveSubtitlesWithDialog({ format = 'srt', languages = 'active', range = null, baseName = defaultSubtitleBaseName() } = {}) {
  const bridge = api()
  if (!bridge?.saveFileDialog) throw new Error('Saving subtitle files needs the Drama Studio desktop app.')
  const projectHandle = useProjectStore.getState().currentProjectHandle
  let defaultPath = `${baseName}.${format === 'vtt' ? 'vtt' : 'srt'}`
  if (typeof projectHandle === 'string') {
    const renders = await bridge.pathJoin(projectHandle, 'renders')
    await bridge.createDirectory?.(renders)
    defaultPath = await bridge.pathJoin(renders, defaultPath)
  }
  const extension = format === 'vtt' ? 'vtt' : 'srt'
  const chosen = await bridge.saveFileDialog({
    title: 'Save subtitles',
    defaultPath,
    filters: [{ name: extension === 'vtt' ? 'WebVTT subtitles' : 'SRT subtitles', extensions: [extension] }],
  })
  if (!chosen) return null
  return writeSubtitleFiles({
    basePath: stripSubtitleExtension(chosen),
    formats: format === 'both' ? ['srt', 'vtt'] : [extension],
    languages,
    range,
  })
}

// ---------------------------------------------------------------- versions

export function findLiveCaptionsClip(clipId = null) {
  const clips = useTimelineStore.getState().clips || []
  if (clipId) {
    const clip = clips.find((item) => item.id === clipId)
    if (!clip) throw new Error(`No clip found with id "${clipId}".`)
    if (clip.type !== 'captions') throw new Error('That clip is not a captions clip. Pick the clip on the Captions track.')
    return clip
  }
  return clips.find((item) => item.type === 'captions' && Array.isArray(item.captions?.cues) && item.captions.cues.length) || null
}

function updateCaptionsPayload(clipId, update) {
  const store = useTimelineStore.getState()
  const clip = store.clips.find((item) => item.id === clipId)
  if (!clip || clip.type !== 'captions') throw new Error('The captions clip is no longer on the timeline.')
  const nextCaptions = update(clip.captions || {})
  store.saveToHistory?.()
  useTimelineStore.setState({
    clips: useTimelineStore.getState().clips.map((item) => (item.id === clipId ? { ...item, captions: nextCaptions } : item)),
  })
  return nextCaptions
}

export function getClipCaptionVersions(clipId) {
  const clip = findLiveCaptionsClip(clipId)
  return clip ? getCaptionVersions(clip.captions) : { activeKey: ORIGINAL_VERSION_KEY, versions: [] }
}

/** Add a translated version and show it. One undo step. */
export function applyCaptionTranslation(clipId, { key, label, cues, translatedFrom }) {
  return updateCaptionsPayload(clipId, (captions) => addCaptionVersion(captions, { key, label, cues, translatedFrom }))
}

/** Show another language version. One undo step. */
export function showCaptionVersion(clipId, key) {
  return updateCaptionsPayload(clipId, (captions) => switchCaptionVersion(captions, key))
}

export function deleteCaptionVersion(clipId, key) {
  return updateCaptionsPayload(clipId, (captions) => removeCaptionVersion(captions, key))
}

// ---------------------------------------------------------------- translation

/**
 * Translate a live captions clip's shown (or chosen) version. Does not
 * change the clip; apply the result with applyCaptionTranslation.
 * @returns {Promise<{ clipId, sourceKey, sourceLabel, cues, model }>}
 */
export async function translateCaptionsClip({ clipId = null, targetLanguage, sourceKey = null, onProgress, signal, ask } = {}) {
  const clip = findLiveCaptionsClip(clipId)
  if (!clip) throw new Error('There are no captions on this timeline yet. Add captions first (timeline toolbar › Captions).')
  const { activeKey, versions } = getCaptionVersions(clip.captions)
  const source = versions.find((version) => version.key === (sourceKey || activeKey)) || versions.find((version) => version.isActive)
  if (!source?.cues?.length) throw new Error('The captions clip has no lines to translate.')
  const requestIds = new Set()
  let model = null
  const askModel = ask || (async ({ system, prompt }) => {
    const requestId = `caption-translate-${Date.now()}-${requestIds.size}`
    requestIds.add(requestId)
    const { text, target } = await askStoryAssistant({ system, prompt, requestId })
    model = target?.label ? `${target.label}${target.model ? ` · ${target.model}` : ''}` : null
    return text
  })
  const onAbort = () => requestIds.forEach((id) => cancelStoryAssistant(id))
  signal?.addEventListener?.('abort', onAbort)
  try {
    const cues = await translateCues(source.cues, {
      ask: askModel,
      targetLanguage: targetLanguage?.label || targetLanguage,
      sourceLanguage: source.key === ORIGINAL_VERSION_KEY ? null : source.label,
      onProgress,
      signal,
    })
    return { clipId: clip.id, sourceKey: source.key, sourceLabel: source.label, cues, model }
  } finally {
    signal?.removeEventListener?.('abort', onAbort)
  }
}
