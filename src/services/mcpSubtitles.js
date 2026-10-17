/**
 * MCP tools for subtitle files and caption languages:
 *   export_subtitles         write .srt / .vtt into the project's renders folder
 *   translate_captions       translate a live captions clip (background job)
 *   get_caption_translation  poll that job / read its translated lines
 *   set_caption_language     list, show or remove language versions
 *
 * Translation can outlast the MCP request timeout, so it runs as a job, like
 * transcribe_captions. Nothing on the timeline changes until an apply call.
 */

import useProjectStore from '../stores/projectStore'
import useTimelineStore from '../stores/timelineStore'
import {
  ORIGINAL_VERSION_KEY,
  applyCaptionTranslation,
  defaultSubtitleBaseName,
  deleteCaptionVersion,
  findLiveCaptionsClip,
  getClipCaptionVersions,
  planSubtitleFiles,
  sanitizeSubtitleBaseName,
  showCaptionVersion,
  translateCaptionsClip,
  writeSubtitleFiles,
} from './subtitleService'
import { SUBTITLE_LANGUAGES } from '../utils/subtitles.mjs'

const FORMATS = { srt: ['srt'], vtt: ['vtt'], both: ['srt', 'vtt'] }

function exportRange(range) {
  if (range !== 'inout') return null
  const { inPoint, outPoint } = useTimelineStore.getState()
  if (!Number.isFinite(inPoint) || !Number.isFinite(outPoint) || inPoint === outPoint) {
    throw new Error('No In/Out range is set on the timeline. Use range "full" or set In and Out points first.')
  }
  return { start: Math.min(inPoint, outPoint), end: Math.max(inPoint, outPoint) }
}

export async function handleExportSubtitles(payload = {}) {
  const formats = FORMATS[payload.format || 'srt']
  if (!formats) throw new Error('format must be "srt", "vtt" or "both".')
  const languages = payload.languages === 'all' ? 'all' : 'active'
  const range = exportRange(payload.range)
  const projectHandle = useProjectStore.getState().currentProjectHandle
  if (typeof projectHandle !== 'string') throw new Error('Open a project in the Drama Studio desktop app first.')
  const bridge = globalThis.window?.electronAPI
  const renders = await bridge.pathJoin(projectHandle, 'renders')
  const baseName = sanitizeSubtitleBaseName(payload.fileName || defaultSubtitleBaseName())
  const basePath = await bridge.pathJoin(renders, baseName)

  const files = await planSubtitleFiles({ formats, languages, range })
  const planned = files.map((file) => ({
    format: file.format,
    language: file.label,
    cueCount: file.cueCount,
    path: `${basePath}${file.suffix}.${file.format}`,
  }))
  if (files.every((file) => file.cueCount === 0)) {
    throw new Error('This timeline has no captions to save. Add captions first (transcribe_captions, then generate_captions).')
  }
  if (payload.previewOnly !== false) {
    return {
      previewOnly: true,
      action: 'export_subtitles',
      message: `Would write ${planned.filter((file) => file.cueCount).length} subtitle file(s) into the project's renders folder. Nothing was written.`,
      files: planned,
      sample: files[0]?.content.split('\n').slice(0, 12).join('\n') || '',
    }
  }
  await bridge.createDirectory?.(renders)
  const written = await writeSubtitleFiles({ basePath, formats, languages, range })
  return {
    success: true,
    action: 'export_subtitles',
    message: `Saved ${written.paths.length} subtitle file(s).`,
    paths: written.paths,
    cueCount: written.cueCount,
  }
}

// ---------------------------------------------------------------- translation jobs

const jobs = new Map()
let jobCounter = 0

function resolveLanguage(value) {
  const text = String(value || '').trim()
  if (!text) throw new Error('targetLanguage is required, for example "Spanish" or "es".')
  const lower = text.toLowerCase()
  const known = SUBTITLE_LANGUAGES.find((item) => item.code.toLowerCase() === lower || item.label.toLowerCase() === lower || item.native?.toLowerCase() === lower)
  if (known) return { code: known.code, label: known.label }
  const code = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'custom'
  return { code, label: text }
}

function summarizeJob(job, { includeCues = true } = {}) {
  return {
    jobId: job.id,
    status: job.status,
    clipId: job.clipId,
    targetLanguage: job.target,
    from: job.sourceLabel || null,
    progress: job.progress,
    model: job.model || null,
    applied: job.applied,
    error: job.error || null,
    cueCount: job.cues?.length || 0,
    ...(includeCues && job.cues ? { cues: job.cues.map(({ id, start, end, text }) => ({ id, start, end, text })) } : {}),
  }
}

function applyJob(job, cueOverrides = null) {
  const cues = Array.isArray(cueOverrides) && cueOverrides.length
    ? job.cues.map((cue) => {
      const override = cueOverrides.find((item) => item.id === cue.id)
      return override && typeof override.text === 'string' && override.text.trim() ? { ...cue, text: override.text.trim() } : cue
    })
    : job.cues
  applyCaptionTranslation(job.clipId, { key: job.target.code, label: job.target.label, cues, translatedFrom: job.sourceKey })
  job.applied = true
}

export function handleTranslateCaptions(payload = {}) {
  const previewOnly = payload.previewOnly !== false

  // Apply a finished job (optionally with corrected lines).
  if (payload.jobId) {
    const job = jobs.get(payload.jobId)
    if (!job) throw new Error(`No translation job "${payload.jobId}". Start one with translate_captions.`)
    if (job.status !== 'done') return { ...summarizeJob(job, { includeCues: false }), message: job.status === 'failed' ? `The translation failed: ${job.error}` : 'The translation is still running. Poll get_caption_translation.' }
    if (previewOnly) return { previewOnly: true, action: 'translate_captions', ...summarizeJob(job), message: 'Translated lines below. Call translate_captions with this jobId and previewOnly false to apply them.' }
    if (job.applied) return { success: true, action: 'translate_captions', ...summarizeJob(job, { includeCues: false }), message: 'This translation is already applied.' }
    applyJob(job, payload.cues)
    return { success: true, action: 'translate_captions', ...summarizeJob(job, { includeCues: false }), message: `${job.target.label} captions are now shown on the timeline. The original is kept (set_caption_language switches back). Undo with Ctrl+Z.` }
  }

  const target = resolveLanguage(payload.targetLanguage)
  const clip = findLiveCaptionsClip(payload.clipId || null)
  if (!clip) throw new Error('There are no live captions on this timeline. Create them first with transcribe_captions and generate_captions.')

  // The Assistant's Apply button repeats the preview call with previewOnly
  // false. Reuse that preview's job instead of paying for a second translation.
  if (!previewOnly) {
    const pending = [...jobs.values()].reverse().find((job) => !job.applied && job.clipId === clip.id
      && job.target.code === target.code && (job.status === 'running' || job.status === 'done'))
    if (pending?.status === 'done') {
      applyJob(pending, payload.cues)
      return { success: true, action: 'translate_captions', ...summarizeJob(pending, { includeCues: false }), message: `${pending.target.label} captions are now shown on the timeline. The original is kept. Undo with Ctrl+Z.` }
    }
    if (pending?.status === 'running') {
      pending.autoApply = true
      return { success: true, action: 'translate_captions', ...summarizeJob(pending, { includeCues: false }), message: `Still translating into ${pending.target.label}; the captions switch over as soon as it finishes.` }
    }
  }

  if (jobs.size > 0 && [...jobs.values()].some((job) => job.status === 'running')) {
    throw new Error('A caption translation is already running. Poll get_caption_translation, then try again.')
  }
  jobCounter += 1
  const job = {
    id: `caption-translation-${jobCounter}`,
    status: 'running',
    clipId: clip.id,
    target,
    sourceKey: payload.sourceVersion || null,
    sourceLabel: null,
    progress: { done: 0, total: 0 },
    autoApply: !previewOnly,
    applied: false,
    cues: null,
    error: null,
    model: null,
  }
  jobs.set(job.id, job)
  translateCaptionsClip({
    clipId: clip.id,
    targetLanguage: target,
    sourceKey: job.sourceKey,
    onProgress: (progress) => { job.progress = progress },
  }).then((outcome) => {
    job.cues = outcome.cues
    job.sourceKey = outcome.sourceKey
    job.sourceLabel = outcome.sourceLabel
    job.model = outcome.model
    job.status = 'done'
    if (job.autoApply) {
      try { applyJob(job) } catch (error) { job.error = error?.message || String(error) }
    }
  }).catch((error) => {
    job.status = 'failed'
    job.error = error?.message || String(error)
  })

  return {
    ...(previewOnly ? { previewOnly: true } : {}),
    action: 'translate_captions',
    ...summarizeJob(job, { includeCues: false }),
    message: previewOnly
      ? `Translating the captions into ${target.label} with the Assistant model. Nothing changes on the timeline. Poll get_caption_translation with jobId "${job.id}", show the user the lines, then call translate_captions with that jobId and previewOnly false to apply.`
      : `Translating the captions into ${target.label}; they will be applied when done. Poll get_caption_translation with jobId "${job.id}".`,
  }
}

export function handleGetCaptionTranslation(payload = {}) {
  const job = payload.jobId ? jobs.get(payload.jobId) : [...jobs.values()].pop()
  if (!job) return { status: 'none', message: 'No caption translation has been started in this session.' }
  return { ...summarizeJob(job, { includeCues: payload.includeCues !== false }), message: job.status === 'running' ? `Translating: ${job.progress.done} of ${job.progress.total || '?'} lines.` : undefined }
}

// ---------------------------------------------------------------- languages

export function handleSetCaptionLanguage(payload = {}) {
  const clip = findLiveCaptionsClip(payload.clipId || null)
  if (!clip) throw new Error('There are no live captions on this timeline.')
  const listing = () => getClipCaptionVersions(clip.id).versions.map(({ key, label, isActive, cues, translatedFrom }) => ({ key, label, shown: isActive, cueCount: cues.length, translatedFrom }))
  const requested = payload.language ? String(payload.language).trim() : ''
  if (!requested) return { action: 'set_caption_language', clipId: clip.id, languages: listing(), message: 'Language versions on the captions clip. Pass "language" (a key from this list) to show one.' }

  const versions = listing()
  const lower = requested.toLowerCase()
  const match = versions.find((version) => version.key.toLowerCase() === lower || version.label.toLowerCase() === lower)
    || (lower === 'original' ? versions.find((version) => version.key === ORIGINAL_VERSION_KEY) : null)
  if (!match) throw new Error(`No "${requested}" version on the captions clip. Available: ${versions.map((version) => version.key).join(', ')}.`)

  const remove = payload.remove === true
  if (payload.previewOnly === true) {
    return { previewOnly: true, action: 'set_caption_language', clipId: clip.id, languages: versions, message: remove ? `Would remove the ${match.label} version.` : `Would show the ${match.label} captions.` }
  }
  if (remove) deleteCaptionVersion(clip.id, match.key)
  else showCaptionVersion(clip.id, match.key)
  return { success: true, action: 'set_caption_language', clipId: clip.id, languages: listing(), message: remove ? `Removed the ${match.label} version.` : `${match.label} captions are shown now.` }
}
