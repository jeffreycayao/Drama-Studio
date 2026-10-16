/**
 * Timeline lip-sync with the sync.so partner node (ComfyUI core,
 * comfy_api_nodes/nodes_sync_so.py). The plan comes from
 * utils/lipSyncPlan.mjs; this module cuts the video range and dialogue with
 * FFmpeg (main process), uploads both to ComfyUI, runs the bundled
 * api_sync_so_lip_sync.json, and imports the result as a new video asset.
 *
 * It never touches the timeline. The caller swaps the result in through
 * timelineStore.previewSmartReplace / applySmartReplace, so the change is one
 * undo step and keeps trims, transitions and linked audio.
 *
 * Paid: sync.so bills per output second. runLipSync refuses to queue unless
 * the caller passes allowCloudSpend: true after the person confirmed.
 */

import comfyui from './comfyui'
import { BUILTIN_WORKFLOW_PATHS } from '../config/workflowRegistry'
import { checkWorkflowDependencies } from './workflowDependencies'
import { importAsset, isElectron } from './fileSystem'
import { markPromptHandledByApp } from './comfyPromptGuard'
import { useAssetsStore } from '../stores/assetsStore'
import { useProjectStore } from '../stores/projectStore'
import { LIPSYNC_WORKFLOW_ID, buildLipSyncWorkflow } from '../utils/lipSyncPlan.mjs'

const POLL_INTERVAL_MS = 3000
// Comfy's sync.so node polls the service every 10 s; long clips take a while.
const JOB_TIMEOUT_MS = 45 * 60 * 1000
const VIDEO_EXT_RE = /\.(mp4|webm|mov|mkv)$/i

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function safeToken(value, fallback) {
  const cleaned = String(value || '').replace(/\.[a-zA-Z0-9]{1,8}$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  return cleaned || fallback
}

async function readTempFile(filePath, name, type) {
  const result = await window.electronAPI.readFileAsBuffer(filePath)
  if (!result?.success) throw new Error(result?.error || 'Could not read the prepared lip-sync input.')
  return new File([result.data], name, { type })
}

function findVideoOutput(entry) {
  for (const nodeOut of Object.values(entry?.outputs || {})) {
    for (const items of Object.values(nodeOut || {})) {
      if (!Array.isArray(items)) continue
      for (const item of items) {
        const filename = String(item?.filename || '')
        if (VIDEO_EXT_RE.test(filename) && String(item?.type || 'output') === 'output') {
          return { filename, subfolder: item.subfolder || '', type: 'output' }
        }
      }
    }
  }
  return null
}

function executionError(entry) {
  if (String(entry?.status?.status_str || '').toLowerCase() !== 'error') return null
  const messages = Array.isArray(entry?.status?.messages) ? entry.status.messages : []
  const detail = messages
    .filter((message) => Array.isArray(message) && message[0] === 'execution_error')
    .map((message) => message?.[1]?.exception_message || '')
    .filter(Boolean)
    .join('; ')
  return detail || 'ComfyUI reported an execution error.'
}

async function waitForResult(promptId, onStatus) {
  const startedAt = Date.now()
  let failures = 0
  while (Date.now() - startedAt < JOB_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS)
    try {
      const history = await comfyui.getHistory(promptId)
      failures = 0
      const entry = history?.[promptId]
      if (!entry) {
        onStatus({ status: 'running', message: `sync.so is working… ${Math.round((Date.now() - startedAt) / 1000)}s` })
        continue
      }
      const error = executionError(entry)
      if (error) throw new Error(error)
      const output = findVideoOutput(entry)
      if (output) return output
    } catch (error) {
      if (error instanceof Error && !/fetch|network|Failed to/i.test(error.message)) throw error
      failures += 1
      if (failures >= 10) throw new Error('Lost connection to ComfyUI while waiting for the lip-sync result.')
    }
  }
  throw new Error('The lip-sync job timed out. It may still finish in ComfyUI; check its queue.')
}

/**
 * @param {object} options
 * @param {ReturnType<import('../utils/lipSyncPlan.mjs').planLipSync>} options.plan
 * @param {boolean} options.allowCloudSpend  true only after the person confirmed the cost
 * @param {boolean} [options.followActiveSpeaker]
 * @param {(status: {status: string, message: string}) => void} [options.onStatus]
 * @returns {Promise<{ asset: object, promptId: string }>}
 */
export async function runLipSync({ plan, allowCloudSpend = false, followActiveSpeaker = false, onStatus = () => {} } = {}) {
  if (!plan?.ok) throw new Error(plan?.reason || 'Nothing to lip-sync.')
  if (allowCloudSpend !== true) throw new Error('sync.so lip-sync spends Comfy.org credits. Confirm the cost first.')
  if (!isElectron() || !window.electronAPI?.trimVideoSegment) throw new Error('Lip-sync needs the Drama Studio desktop app (FFmpeg).')
  const projectHandle = useProjectStore.getState().currentProjectHandle
  if (!projectHandle) throw new Error('Open a project before lip-syncing.')

  const { getAssetById } = useAssetsStore.getState()
  const videoAsset = getAssetById(plan.video.assetId)
  const audioAsset = getAssetById(plan.audio.assetId)
  if (!videoAsset?.absolutePath || !audioAsset?.absolutePath) {
    throw new Error('Lip-sync needs the clip’s video and the dialogue as local files in this project.')
  }

  onStatus({ status: 'checking', message: 'Checking sync.so setup…' })
  const deps = await checkWorkflowDependencies(LIPSYNC_WORKFLOW_ID)
  if (deps?.missingAuth) throw new Error('sync.so lip-sync needs a Comfy.org API key. Add it in Settings.')
  if ((deps?.missingNodes || []).length) throw new Error('This ComfyUI has no sync.so Lip Sync node. Update ComfyUI first.')
  if (deps?.status === 'error') throw new Error(deps.error || 'Could not reach ComfyUI.')

  const base = safeToken(videoAsset.name, 'clip')
  onStatus({ status: 'preparing', message: 'Cutting the clip and dialogue…' })
  const video = await window.electronAPI.trimVideoSegment({
    inputPath: videoAsset.absolutePath,
    startSeconds: plan.video.startSeconds,
    durationSeconds: plan.video.durationSeconds,
    outputName: `${base}_lipsync_src`,
  })
  if (!video?.success) throw new Error(video?.error || 'Could not cut the video segment.')
  const audio = await window.electronAPI.padAudioSegment({
    inputPath: audioAsset.absolutePath,
    startSeconds: plan.audio.startSeconds,
    durationSeconds: plan.audio.durationSeconds,
    leadingSilenceSeconds: plan.audio.leadingSilenceSeconds,
    totalSeconds: plan.audio.totalSeconds,
    outputName: `${base}_lipsync_dialogue`,
  })
  if (!audio?.success) throw new Error(audio?.error || 'Could not prepare the dialogue audio.')

  onStatus({ status: 'uploading', message: 'Uploading to ComfyUI…' })
  const stamp = Date.now()
  const videoUpload = await comfyui.uploadFile(await readTempFile(video.outputPath, `drama_studio_lipsync_src_${stamp}.mp4`, 'video/mp4'))
  const audioUpload = await comfyui.uploadFile(await readTempFile(audio.outputPath, `drama_studio_lipsync_dialogue_${stamp}.wav`, 'audio/wav'))

  const response = await fetch(BUILTIN_WORKFLOW_PATHS[LIPSYNC_WORKFLOW_ID])
  if (!response.ok) throw new Error('Could not load the bundled lip-sync workflow.')
  const workflow = buildLipSyncWorkflow(await response.json(), {
    videoName: videoUpload?.subfolder ? `${videoUpload.subfolder}/${videoUpload.name}` : (videoUpload?.name || `drama_studio_lipsync_src_${stamp}.mp4`),
    audioName: audioUpload?.subfolder ? `${audioUpload.subfolder}/${audioUpload.name}` : (audioUpload?.name || `drama_studio_lipsync_dialogue_${stamp}.wav`),
    seed: Math.floor(Math.random() * 2147483647),
    filenamePrefix: `video/drama_studio_lipsync_${base}_${stamp}`,
    followActiveSpeaker,
  })

  onStatus({ status: 'queued', message: 'Queued on sync.so…' })
  const promptId = await comfyui.queuePrompt(workflow)
  if (!promptId) throw new Error('ComfyUI did not accept the lip-sync job.')
  markPromptHandledByApp(promptId)

  const output = await waitForResult(promptId, onStatus)
  onStatus({ status: 'importing', message: 'Importing the lip-synced take…' })
  const file = await comfyui.downloadVideo(output.filename, output.subfolder, output.type)
  const assetInfo = await importAsset(projectHandle, file, 'video')
  const asset = useAssetsStore.getState().addAsset({
    ...assetInfo,
    name: `${videoAsset.name || 'Clip'} (lip-sync)`,
    type: 'video',
    url: URL.createObjectURL(file),
    isImported: true,
    folderId: videoAsset.folderId ?? null,
    promptId,
    lipSync: {
      workflowId: LIPSYNC_WORKFLOW_ID,
      provider: 'sync.so',
      sourceAssetId: videoAsset.id,
      dialogueAssetId: audioAsset.id,
      sourceStartSeconds: plan.video.startSeconds,
      durationSeconds: plan.segmentSeconds,
      promptId,
      importedAt: new Date().toISOString(),
    },
  })
  if (!asset?.id) throw new Error('The lip-synced take could not be added to the project.')
  onStatus({ status: 'done', message: 'Lip-synced take imported.' })
  return { asset, promptId }
}
