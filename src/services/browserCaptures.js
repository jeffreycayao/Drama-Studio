/**
 * Browser captures → project assets (docs/PLAN_AI_BROWSER_WORKSPACE.md, step 1).
 *
 * The Companion sends a picture or video the person chose with "Send to
 * Drama Studio"; the desktop link checks it and keeps it in its inbox. This
 * bridge imports each one into the open project, in "AI Sites/<Site>", with
 * the prompt that made it, then clears it from the inbox. Captures that
 * arrive with no project open wait there and are imported when one opens.
 */
import useAssetsStore from '../stores/assetsStore'
import useProjectStore from '../stores/projectStore'
import useBrowserJobsStore from '../stores/browserJobsStore'
import { importMediaFiles } from './mediaFileImport'
import { captureFolderPath, captureSiteLabel } from '../utils/browserCaptureFolders.mjs'

function linkApi() {
  return typeof window !== 'undefined' ? window.electronAPI?.companionLink || null : null
}

// Same chain-of-folders logic as the ComfyUI auto-import.
function ensureAssetFolderPath(segments) {
  let parentId = null
  for (const segment of segments) {
    const { folders = [], addFolder } = useAssetsStore.getState()
    const key = segment.toLowerCase()
    let folder = folders.find((entry) => (entry?.parentId || null) === parentId && String(entry?.name || '').trim().toLowerCase() === key)
    if (!folder) folder = addFolder({ name: segment, parentId })
    parentId = folder?.id || parentId
  }
  return parentId
}

const handled = new Set()
let queue = Promise.resolve()
let waitingNoticeShown = false

async function importCapture(record) {
  const api = linkApi()
  if (!api || !record?.captureId || !record.filePath || handled.has(record.captureId)) return
  const projectHandle = useProjectStore.getState().currentProjectHandle
  const label = captureSiteLabel(record.site)
  if (!projectHandle) {
    if (!waitingNoticeShown) {
      waitingNoticeShown = true
      useBrowserJobsStore.getState().pushNotice({ title: `Received from ${label}`, detail: 'It will be added when you open a project.' })
    }
    return
  }
  handled.add(record.captureId)
  try {
    const folderId = ensureAssetFolderPath(captureFolderPath(record.site))
    const { assets, failed } = await importMediaFiles([record.filePath], {
      projectHandle,
      folderId,
      isCurrent: () => useProjectStore.getState().currentProjectHandle === projectHandle,
    })
    const asset = assets[0]
    if (!asset) throw new Error(failed[0]?.error || 'The file could not be added.')
    const prompt = typeof record.prompt === 'string' ? record.prompt : ''
    // The inbox file starts with its capture id; show the name it came with.
    const extension = /\.[a-z0-9]{2,5}$/i.exec(String(record.fileName || ''))?.[0] || ''
    const name = record.name ? `${record.name}${extension}` : asset.name
    useAssetsStore.getState().updateAsset(asset.id, {
      name,
      ...(prompt ? { prompt } : {}),
      settings: {
        ...(asset.settings || {}),
        browserCapture: { site: record.site, prompt, capturedAt: record.capturedAt || null, jobId: record.jobId || null },
      },
    })
    await api.inboxRemove(record.captureId)
    useBrowserJobsStore.getState().pushNotice({ tone: 'success', title: `Added from ${label}`, detail: `${name} is in AI Sites › ${label}.` })
  } catch (error) {
    // Left in the inbox; the next project open tries again.
    handled.delete(record.captureId)
    useBrowserJobsStore.getState().pushNotice({ tone: 'error', title: `Could not add the file from ${label}`, detail: error?.message || 'Try again from the browser.' })
  }
}

const enqueue = (record) => {
  queue = queue.then(() => importCapture(record)).catch(() => {})
  return queue
}

async function importInbox() {
  const api = linkApi()
  if (!api?.inbox) return
  const result = await api.inbox().catch(() => null)
  for (const record of result?.captures || []) enqueue(record)
}

/** Starts the bridge; returns a function that stops it. */
export function startBrowserCaptures() {
  const api = linkApi()
  if (!api?.onCapture) return () => {}
  const stops = []
  stops.push(api.onCapture((record) => enqueue(record)))
  if (api.onJobUpdate) stops.push(api.onJobUpdate((job) => useBrowserJobsStore.getState().applyJobUpdate(job)))
  let lastHandle = useProjectStore.getState().currentProjectHandle
  stops.push(useProjectStore.subscribe((state) => {
    const handle = state.currentProjectHandle
    if (handle === lastHandle) return
    lastHandle = handle
    if (handle) {
      waitingNoticeShown = false
      importInbox()
    }
  }))
  if (lastHandle) importInbox()
  return () => stops.forEach((stop) => { try { stop?.() } catch { /* ignore */ } })
}
