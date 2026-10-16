import { getClipPlaybackTimingAtTimeline } from './clipPlaybackTiming.js'
import { getSmartReplaceTransitionExtent, getSmartReplaceSourceMetadata } from './smartReplace.mjs'

/** Draft proxies vs hero renders. The mode lives on the clip; generation
 * provenance (workflow, prompt, seed…) lives on the asset, because many
 * clips can share one generated asset. */
export const RENDER_MODES = Object.freeze(['draft', 'hero'])
export const HERO_RESOLUTION_SCALES = Object.freeze([1, 1.5, 2])
export const DEFAULT_HERO_SETTINGS = Object.freeze({ workflowId: null, resolutionScale: 1.5, maxEdge: 3840 })
export const MAX_HERO_JOBS_PER_BATCH = 24
const EPSILON = 1e-6
const finite = value => typeof value === 'number' && Number.isFinite(value)
const positive = value => finite(value) && value > 0
const text = value => typeof value === 'string' ? value.trim() : ''
// Anything the Generate queue has not finished is still "rendering".
const FINISHED_JOB_STATUSES = new Set(['done', 'error', 'cancelled', 'canceled', 'failed'])

function parseResolution(value) {
  if (value && typeof value === 'object' && positive(Number(value.width)) && positive(Number(value.height))) {
    return { width: Math.round(Number(value.width)), height: Math.round(Number(value.height)) }
  }
  const match = /^\s*(\d{2,5})\s*[x×]\s*(\d{2,5})\s*$/i.exec(String(value || ''))
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null
}

const cleanIds = value => Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {})
  .map(([key, id]) => [text(key), text(id)]).filter(([key, id]) => key && id && key.length <= 64 && id.length <= 200))

/** Provenance record stamped on every generated asset at import time. */
export function buildGenerationProvenanceRecord(job = {}, fallbackWorkflowId = '', output = {}) {
  const seed = Number(job.seed)
  const record = {
    version: 1,
    workflowId: text(job.mcpBatch?.requestedWorkflowId) || text(job.workflowId) || text(fallbackWorkflowId) || null,
    workflowLabel: text(job.workflowLabel) || null,
    prompt: typeof job.prompt === 'string' ? job.prompt : '',
    negativePrompt: typeof job.negativePrompt === 'string' ? job.negativePrompt : '',
    seed: Number.isSafeInteger(seed) ? seed : null,
    resolution: parseResolution(job.resolution),
    duration: positive(Number(job.duration)) ? Number(job.duration) : null,
    fps: positive(Number(job.fps)) ? Number(job.fps) : null,
    inputAssetId: text(job.inputAssetId) || null,
    assetFieldIds: cleanIds(job.assetFieldIds),
    referenceAssetIds: [job.referenceAssetId1, job.referenceAssetId2].map(text).filter(Boolean),
    inputFromTimelineFrame: job.inputFromTimelineFrame === true,
    castBound: Boolean(job.cast),
    customWorkflow: Boolean(job.customWorkflow),
    outputIndex: Number.isSafeInteger(output.index) ? output.index : 0,
    outputCount: Number.isSafeInteger(output.count) && output.count > 0 ? output.count : 1,
    renderMode: job.conform?.draftAssetId ? 'hero' : 'draft',
  }
  if (job.conform?.draftAssetId) record.conformOf = text(job.conform.draftAssetId)
  return record
}

/** Normalized provenance, or null for media that was not generated here.
 * Older generated assets (before provenance) keep prompt/seed/resolution but
 * no workflow id; they can still be conformed when the user picks a workflow. */
export function getGenerationProvenance(asset) {
  const record = asset?.settings?.generation
  if (record && typeof record === 'object' && record.version === 1) {
    return { ...record, resolution: parseResolution(record.resolution), assetFieldIds: cleanIds(record.assetFieldIds),
      referenceAssetIds: Array.isArray(record.referenceAssetIds) ? record.referenceAssetIds.map(text).filter(Boolean) : [],
      legacy: false }
  }
  const seed = Number(asset?.settings?.seed)
  if (!asset || asset.isImported !== true || typeof asset.prompt !== 'string' || !Number.isSafeInteger(seed)) return null
  return {
    version: 1, legacy: true, workflowId: null, workflowLabel: null, prompt: asset.prompt, negativePrompt: '', seed,
    resolution: parseResolution(asset.settings?.resolution), duration: positive(Number(asset.settings?.duration)) ? Number(asset.settings.duration) : null,
    fps: positive(Number(asset.settings?.fps)) ? Number(asset.settings.fps) : null,
    inputAssetId: text(asset.settings?.inputAssetId) || null, assetFieldIds: {}, referenceAssetIds: [],
    inputFromTimelineFrame: false, castBound: false, customWorkflow: false, outputIndex: 0, outputCount: 1, renderMode: 'draft',
  }
}

export function getClipRenderMode(clip, asset) {
  if (RENDER_MODES.includes(clip?.renderMode)) return clip.renderMode
  const provenance = getGenerationProvenance(asset)
  return provenance ? (provenance.renderMode === 'hero' ? 'hero' : 'draft') : null
}

export function buildConformRecord(draftAssetId, heroAssetId, conformedAt = Date.now()) {
  return { version: 1, draftAssetId: String(draftAssetId), heroAssetId: String(heroAssetId), conformedAt }
}

/** Hero size: scale, snap to multiples of 16 (latent-friendly), cap the long edge. */
export function scaleHeroResolution(resolution, scale = DEFAULT_HERO_SETTINGS.resolutionScale, maxEdge = DEFAULT_HERO_SETTINGS.maxEdge) {
  const base = parseResolution(resolution)
  if (!base) return null
  const factor = positive(scale) ? Math.min(4, scale) : 1
  let width = base.width * factor, height = base.height * factor
  const cap = positive(maxEdge) ? maxEdge : DEFAULT_HERO_SETTINGS.maxEdge
  const longest = Math.max(width, height)
  if (longest > cap) { width *= cap / longest; height *= cap / longest }
  const snap = value => Math.max(16, Math.floor(value / 16) * 16)
  return { width: snap(width), height: snap(height) }
}

/** Source seconds a clip shows (`visible`) and needs including transition
 * handles (`required`). Same timing math as preview, export and Smart Replace. */
export function computeClipSourceRanges(clip, clips = [], transitions = []) {
  if (!clip || clip.type === 'image') return { ok: true, visible: null, required: null }
  if (!finite(clip.startTime) || !positive(clip.duration)) return { ok: false, reason: 'This clip has invalid timeline timing.' }
  const extent = getSmartReplaceTransitionExtent(clip, clips, transitions)
  if (!extent.ok) return { ok: false, reason: extent.reason }
  const at = (time, nominal) => {
    const timing = getClipPlaybackTimingAtTimeline(clip, time, 0, { useFrameSampling: false, allowHandles: true })
    return nominal ? timing.time : timing.rawTime
  }
  const edges = [at(clip.startTime, true), at(clip.startTime + clip.duration, true)]
  const handles = [at(extent.start, extent.start >= clip.startTime - EPSILON), at(extent.end, extent.end <= clip.startTime + clip.duration + EPSILON)]
  if (![...edges, ...handles].every(finite)) return { ok: false, reason: 'The clip timing could not be evaluated.' }
  return { ok: true,
    visible: { start: Math.min(...edges), end: Math.max(...edges) },
    required: { start: Math.min(...edges, ...handles), end: Math.max(...edges, ...handles) } }
}

const caption = value => value?.role === 'captions' || value?.captionScope || value?.overlayKind === 'captions'

/** Pure conform plan. One entry per draft ASSET (several clips may use it).
 * `getWorkflowInfo(id)` → { label, needsImage, outputType, runnable } | null.
 * `queueJobs` are Generate queue rows ({ status, conformDraftAssetId }). */
export function planProjectConform({ clips = [], tracks = [], transitions = [], assets = [], heroSettings = {},
  getWorkflowInfo = () => null, queueJobs = [], workflowOverrides = {} } = {}) {
  const settings = { ...DEFAULT_HERO_SETTINGS, ...heroSettings }
  const assetsById = new Map(assets.filter(asset => asset?.id).map(asset => [asset.id, asset]))
  const heroByDraft = new Map()
  // Newest hero wins. The bin prepends new assets, so without timestamps the
  // earlier position in the list is the newer one.
  const newer = (a, b) => {
    const ta = Date.parse(a.createdAt || ''), tb = Date.parse(b.createdAt || '')
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta > tb
    return assets.indexOf(a) < assets.indexOf(b)
  }
  for (const asset of assets) {
    const provenance = getGenerationProvenance(asset)
    if (!provenance?.conformOf || provenance.renderMode !== 'hero') continue
    const previous = heroByDraft.get(provenance.conformOf)
    if (!previous || newer(asset, previous)) heroByDraft.set(provenance.conformOf, asset)
  }
  const activeByDraft = new Map()
  for (const job of queueJobs) {
    const draftId = text(job?.conformDraftAssetId)
    if (draftId && !FINISHED_JOB_STATUSES.has(String(job.status || '').toLowerCase())) activeByDraft.set(draftId, job)
  }
  const tracksById = new Map(tracks.map(track => [track.id, track]))
  const entries = new Map()
  let heroClipCount = 0
  for (const clip of clips) {
    if (!['video', 'image'].includes(clip?.type)) continue
    const track = tracksById.get(clip.trackId)
    if (!track || track.type !== 'video' || caption(track) || caption(clip)) continue
    const asset = assetsById.get(clip.assetId)
    const mode = getClipRenderMode(clip, asset)
    if (mode === 'hero') heroClipCount += 1
    if (mode !== 'draft') continue
    let entry = entries.get(clip.assetId)
    if (!entry) {
      entry = { draftAssetId: clip.assetId, draftAsset: asset || null, provenance: getGenerationProvenance(asset),
        clips: [], required: null, blockers: [], job: null, heroAsset: null, status: 'blocked' }
      entries.set(clip.assetId, entry)
    }
    const ranges = computeClipSourceRanges(clip, clips, transitions)
    if (!ranges.ok) entry.blockers.push(`${clip.name || clip.id}: ${ranges.reason}`)
    entry.clips.push({ clipId: clip.id, name: clip.name || clip.id, visible: ranges.visible || null, required: ranges.required || null })
    if (ranges.required) {
      entry.required = entry.required
        ? { start: Math.min(entry.required.start, ranges.required.start), end: Math.max(entry.required.end, ranges.required.end) }
        : { ...ranges.required }
    }
  }
  for (const entry of entries.values()) {
    const { provenance, draftAsset } = entry
    if (!draftAsset) { entry.blockers.push('The draft asset is missing from the project.'); continue }
    entry.heroAsset = heroByDraft.get(entry.draftAssetId) || null
    if (entry.heroAsset) {
      const { sourceDuration } = getSmartReplaceSourceMetadata(entry.heroAsset)
      if (entry.heroAsset.type !== draftAsset.type) entry.blockers.push('The hero render is a different media type.')
      else if (entry.required && positive(sourceDuration) && sourceDuration + EPSILON < entry.required.end) {
        entry.blockers.push(`The hero render is ${sourceDuration.toFixed(2)} s but the edit needs ${entry.required.end.toFixed(2)} s. Re-render or re-trim.`)
      } else { entry.status = 'ready-to-swap'; continue }
    }
    if (activeByDraft.has(entry.draftAssetId)) { entry.status = 'rendering'; entry.queueJob = activeByDraft.get(entry.draftAssetId); continue }
    const job = buildHeroJob(entry, settings, workflowOverrides[entry.draftAssetId], getWorkflowInfo, assetsById)
    entry.blockers.push(...job.blockers)
    if (job.ok && !entry.blockers.length) { entry.job = job.job; entry.status = 'ready-to-render' }
  }
  const list = [...entries.values()]
  return {
    entries: list, heroClipCount,
    draftClipCount: list.reduce((sum, entry) => sum + entry.clips.length, 0),
    renderable: list.filter(entry => entry.status === 'ready-to-render'),
    swappable: list.filter(entry => entry.status === 'ready-to-swap'),
    rendering: list.filter(entry => entry.status === 'rendering'),
    blocked: list.filter(entry => entry.status === 'blocked'),
  }
}

function buildHeroJob(entry, settings, override, getWorkflowInfo, assetsById) {
  const blockers = []
  const { provenance, draftAsset } = entry
  if (!provenance) return { ok: false, blockers: ['No generation record (prompt and seed) for this media.'] }
  const workflowId = text(override) || text(settings.workflowId) || text(provenance.workflowId)
  if (!workflowId) blockers.push('Choose a hero workflow: this older render did not record which workflow made it.')
  if (!text(provenance.prompt)) blockers.push('The draft has no recorded prompt.')
  if (!Number.isSafeInteger(provenance.seed)) blockers.push('The draft has no recorded seed.')
  if (provenance.outputCount > 1) blockers.push('This draft is one of several outputs from one job and cannot be re-rendered on its own.')
  if (provenance.inputFromTimelineFrame) blockers.push('This draft started from a captured timeline frame, which cannot be replayed.')
  if (provenance.castBound) blockers.push('This draft used a Cast lock; re-render it from Generate so the cast binding is applied.')
  if (provenance.customWorkflow && !text(override) && !text(settings.workflowId)) blockers.push('Saved custom workflows cannot be replayed automatically. Choose a hero workflow.')
  const info = workflowId ? getWorkflowInfo(workflowId) : null
  if (workflowId && !info) blockers.push(`Workflow ${workflowId} is not available in this install.`)
  if (info && info.runnable === false) blockers.push(`${info.label || workflowId} is a catalog preview and cannot be queued.`)
  const outputType = draftAsset.type === 'image' ? 'image' : 'video'
  if (info?.outputType && info.outputType !== outputType) blockers.push(`${info.label || workflowId} makes ${info.outputType}, but the draft is ${outputType}.`)
  const assetFieldIds = { ...provenance.assetFieldIds }
  if (info?.needsImage) {
    const inputId = text(assetFieldIds.image) || text(assetFieldIds.inputImage) || text(provenance.inputAssetId)
    if (!inputId) blockers.push('The draft has no recorded input image.')
    else assetFieldIds.image = inputId
  }
  for (const id of Object.values(assetFieldIds)) if (!assetsById.has(id)) blockers.push(`Input asset ${id} is no longer in the project.`)
  const resolution = scaleHeroResolution(provenance.resolution || (draftAsset.width && draftAsset.height
    ? { width: draftAsset.width, height: draftAsset.height } : null), settings.resolutionScale, settings.maxEdge)
  if (!resolution) blockers.push('The draft resolution is unknown.')
  if (outputType === 'video' && !positive(provenance.duration)) blockers.push('The draft duration is unknown.')
  if (blockers.length) return { ok: false, blockers }
  return { ok: true, blockers, job: {
    workflowId, workflowLabel: info?.label || workflowId, outputType,
    prompt: provenance.prompt, negativePrompt: provenance.negativePrompt || '', seed: provenance.seed, resolution,
    // Full draft duration with the same seed: diffusion frame count shapes the
    // whole latent, so a shorter request would not match the draft.
    durationSeconds: outputType === 'video' ? provenance.duration : undefined,
    fps: outputType === 'video' ? (provenance.fps || undefined) : undefined,
    assetFieldIds, promptLabel: `Hero: ${draftAsset.name || entry.draftAssetId}`,
    conform: { draftAssetId: entry.draftAssetId },
  } }
}

/** Swap list for `timelineStore.applyHeroConform`, against the LIVE timeline:
 * every clip that still uses a draft with an imported hero. */
export function buildHeroSwaps(plan, clips) {
  const swaps = []
  for (const entry of plan.swappable) {
    for (const clip of clips) {
      if (clip.assetId === entry.draftAssetId && entry.clips.some(item => item.clipId === clip.id)) {
        swaps.push({ clipId: clip.id, draftAssetId: entry.draftAssetId, asset: entry.heroAsset })
      }
    }
  }
  return swaps
}
