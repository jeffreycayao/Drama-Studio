import { planProjectConform, buildHeroSwaps, MAX_HERO_JOBS_PER_BATCH } from '../utils/projectConform.mjs'

// Stores and the workflow catalog load lazily so the queue/swap logic below
// stays importable from plain Node tests (they use extensionless imports).
const loadStores = async () => {
  const [timeline, assets] = await Promise.all([import('../stores/timelineStore'), import('../stores/assetsStore')])
  return { useTimelineStore: timeline.default, useAssetsStore: assets.default }
}

/** Workflow facts the pure planner needs, from the Generate catalog. */
export async function loadConformWorkflowInfo() {
  const { getWorkflowManifestByWorkflowId } = await import('../config/generateWorkflowCatalog')
  return workflowId => toWorkflowInfo(workflowId, getWorkflowManifestByWorkflowId(workflowId))
}

function toWorkflowInfo(workflowId, manifest) {
  if (!manifest) return null
  return { label: manifest.title || workflowId, needsImage: Boolean(manifest.needsImage),
    outputType: manifest.outputType || null, runnable: manifest.runnable !== false, cloud: manifest.route === 'cloud' }
}

const runAction = async (action, payload) => {
  const { runMcpAction } = await import('./mcpActions')
  return runMcpAction(action, payload)
}

/** Conform-tagged rows from the Generate queue. Never opens the Generate tab:
 * if it has not been mounted, nothing can be rendering. */
export function readConformQueueJobs(timeoutMs = 400) {
  if (typeof window === 'undefined') return Promise.resolve([])
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve([]), timeoutMs)
    window.dispatchEvent(new CustomEvent('comfystudio-mcp-get-generation-queue-status', { detail: {
      includeDone: false, limit: 500,
      respond: (result) => { clearTimeout(timer); resolve(Array.isArray(result?.jobs) ? result.jobs.filter(job => job.conformDraftAssetId) : []) },
    } }))
  })
}

/** Plan against the live stores. Read-only. */
export async function planCurrentConform({ heroSettings, workflowOverrides } = {}) {
  const [{ useTimelineStore, useAssetsStore }, getWorkflowInfo, queueJobs] = await Promise.all([
    loadStores(), loadConformWorkflowInfo(), readConformQueueJobs()])
  const timeline = useTimelineStore.getState()
  return planProjectConform({ clips: timeline.clips, tracks: timeline.tracks, transitions: timeline.transitions,
    assets: useAssetsStore.getState().assets, heroSettings, workflowOverrides, queueJobs, getWorkflowInfo })
}

/** Queue hero renders. The caller must already have the user's explicit
 * approval: this spends GPU time or cloud credits. Batches of 24 go through
 * the same Generate bridge as MCP (dependency, connection and asset checks). */
export async function queueHeroRenders(entries, { runner = runAction } = {}) {
  const jobs = entries.filter(entry => entry.status === 'ready-to-render' && entry.job).map(entry => entry.job)
  if (!jobs.length) throw new Error('No draft clips are ready to render.')
  const queued = []
  for (let index = 0; index < jobs.length; index += MAX_HERO_JOBS_PER_BATCH) {
    const batch = jobs.slice(index, index + MAX_HERO_JOBS_PER_BATCH)
    const result = await runner('queue_prompt_generation_batch', {
      batchId: `conform_${Date.now()}_${index / MAX_HERO_JOBS_PER_BATCH}`,
      jobs: batch.map(job => ({ workflowId: job.workflowId, workflowLabel: job.workflowLabel, outputType: job.outputType,
        prompt: job.prompt, negativePrompt: job.negativePrompt, seed: job.seed, resolution: job.resolution,
        ...(job.durationSeconds ? { durationSeconds: job.durationSeconds } : {}), ...(job.fps ? { fps: job.fps } : {}),
        assetFieldIds: job.assetFieldIds, promptLabel: job.promptLabel, conform: job.conform })),
    })
    queued.push(...(Array.isArray(result?.jobs) ? result.jobs : []))
  }
  return { queuedCount: queued.length, jobs: queued }
}

/** Swap every ready hero onto the clips that still use its draft, as one undo
 * step. Re-plans on the live timeline, so edits made during rendering count. */
export async function swapHeroRenders({ heroSettings, workflowOverrides } = {}) {
  const plan = await planCurrentConform({ heroSettings, workflowOverrides })
  const { useTimelineStore } = await loadStores()
  const swaps = buildHeroSwaps(plan, useTimelineStore.getState().clips)
  if (!swaps.length) return { ok: false, changed: false, reason: 'No hero renders are ready to swap yet.' }
  return useTimelineStore.getState().applyHeroConform({ swaps })
}
