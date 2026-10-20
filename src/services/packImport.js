/**
 * Import pack (renderer side). Main unzips and classifies the pack
 * (electron/packImport.cjs); this file runs the dependency check on its
 * workflows and imports what the user ticked in PackImportDialog:
 *   workflows  → My Workflows › <pack name> (customWorkflowLibrary)
 *   media      → Assets › <pack name>; LUTs → the app LUT library
 *   templates  → kept with the pack's read-me in userData/imported-packs/
 * Code in a pack is never run: main does not even extract it.
 */
import { comfyui } from './comfyui'
import { saveImportedWorkflowToLibrary } from './customWorkflowLibrary'
import { importMediaFiles } from './mediaFileImport'
import { importCubeLutFile } from './lutLibrary'
import { collectUiNodeTypes, scanWorkflowModelReferences } from './templateImporter'
import useAssetsStore from '../stores/assetsStore'
import { apiNodeTypes, summarizeWorkflowCheck } from '../utils/packImportPlan.mjs'

export const OPEN_PACK_IMPORT_EVENT = 'drama-studio-open-pack-import'

const packsApi = () => (typeof window !== 'undefined' ? window.electronAPI?.packs || null : null)

export const isPackImportAvailable = () => Boolean(packsApi())

/** Open the review dialog, optionally on a pack already on disk (a drop). */
export function requestPackImport(filePath = '') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(OPEN_PACK_IMPORT_EVENT, { detail: { filePath: String(filePath || '') } }))
}

export async function choosePack() {
  const api = packsApi()
  if (!api) return { ok: false, code: 'DESKTOP_ONLY' }
  return api.choose()
}

export async function inspectPack(filePath) {
  const api = packsApi()
  if (!api) return { ok: false, code: 'DESKTOP_ONLY' }
  return api.inspect(filePath)
}

export async function discardPack(packId) {
  if (!packId) return
  try { await packsApi()?.discard(packId) } catch { /* temp folder is swept later */ }
}

async function readWorkflowGraph(packId, item) {
  const read = await packsApi().readItem(packId, item.id)
  if (!read?.ok || read.kind !== 'workflow') throw new Error(read?.error || `Could not read ${item.name}.`)
  return read
}

/**
 * The existing dependency check, per pack workflow: node types against the
 * live ComfyUI (as TemplateDetail does) and referenced models against the
 * ComfyUI models folder on disk (as workflowDependencies does).
 * Calls onResult(id, summary) as each workflow is checked.
 */
export async function checkPackWorkflows(pack, { onResult } = {}) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null
  let objectInfo = null
  try { objectInfo = await comfyui.getObjectInfoCached(30000) } catch { objectInfo = null }
  let comfyRootPath = ''
  try { comfyRootPath = String((await api?.getSetting?.('comfyRootPath')) || '').trim() } catch { comfyRootPath = '' }

  for (const item of pack?.workflows || []) {
    let summary
    try {
      const { graph, format } = await readWorkflowGraph(pack.packId, item)
      const nodeTypes = format === 'api' ? apiNodeTypes(graph) : collectUiNodeTypes(graph)
      const models = scanWorkflowModelReferences(format === 'ui' ? graph : null, format === 'api' ? graph : null)
      let diskResults = null
      if (comfyRootPath && models.length && api?.checkWorkflowSetupFiles) {
        try {
          const response = await api.checkWorkflowSetupFiles({
            comfyRootPath,
            files: models.map((model) => ({ filename: model.filename, targetSubdir: model.targetSubdir || '' })),
          })
          if (response?.success && Array.isArray(response.results)) diskResults = response.results
        } catch { diskResults = null }
      }
      summary = summarizeWorkflowCheck({ nodeTypes, objectInfo, models, diskResults })
    } catch (error) {
      summary = { status: 'error', error: error?.message || String(error), missingNodes: [], missingModels: [] }
    }
    onResult?.(item.id, summary)
  }
}

function findOrCreateAssetFolder(name) {
  const store = useAssetsStore.getState()
  const existing = (store.folders || []).find((folder) => !folder.parentId && folder.name === name)
  return existing || store.addFolder({ name })
}

/**
 * Import the ticked items. Returns counts plus the per-item failures; one
 * failure never stops the rest.
 */
export async function importPackSelection(pack, selected, { projectHandle = null, onProgress } = {}) {
  const api = packsApi()
  if (!api) throw new Error('Importing packs is only available in the desktop app.')
  const has = (item) => selected.has(item.id)
  const failed = []
  const done = { workflows: 0, assets: 0, luts: 0, templates: 0 }
  const progress = (step) => { try { onProgress?.(step) } catch { /* UI only */ } }
  const packInfo = {
    name: pack.name,
    author: pack.manifest?.author || '',
    version: pack.manifest?.version || '',
    license: pack.manifest?.license || '',
    source: pack.fileName,
    importedAt: new Date().toISOString(),
  }

  for (const item of (pack.workflows || []).filter(has)) {
    progress(item.title)
    try {
      const { graph, format } = await readWorkflowGraph(pack.packId, item)
      let thumbnail = ''
      if (item.coverId) {
        const cover = await api.readItem(pack.packId, item.coverId)
        if (cover?.ok && cover.kind === 'dataUrl') thumbnail = cover.dataUrl
      }
      await saveImportedWorkflowToLibrary({ title: item.title, graph, format, category: pack.name, pack: packInfo, thumbnail, description: item.description })
      done.workflows += 1
    } catch (error) {
      failed.push({ name: item.name, error: error?.message || String(error) })
    }
  }

  const media = (pack.media || []).filter(has)
  for (const item of media.filter((entry) => entry.mediaType === 'lut')) {
    progress(item.title)
    try {
      const read = await api.readItem(pack.packId, item.id)
      if (!read?.ok) throw new Error(read?.error || 'Could not read the LUT.')
      await importCubeLutFile({ name: item.name, text: async () => read.text })
      done.luts += 1
    } catch (error) {
      failed.push({ name: item.name, error: error?.message || String(error) })
    }
  }

  const assetItems = media.filter((entry) => entry.mediaType !== 'lut')
  if (assetItems.length && projectHandle) {
    progress(pack.name)
    const folder = findOrCreateAssetFolder(pack.name)
    const result = await importMediaFiles(assetItems.map((item) => item.absolutePath), { projectHandle, folderId: folder?.id || null })
    done.assets = result.assets.length
    failed.push(...result.failed)
  }

  const templateIds = (pack.templates || []).filter(has).map((item) => item.id)
  const kept = await api.keep(pack.packId, { itemIds: templateIds, imported: done })
  if (kept?.ok) done.templates = templateIds.length
  else if (templateIds.length) failed.push({ name: 'templates', error: kept?.error || 'Could not keep the templates.' })

  return { ...done, failed, folder: kept?.ok ? kept.folder : '' }
}
