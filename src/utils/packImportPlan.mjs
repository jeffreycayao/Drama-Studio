/**
 * Pure helpers for the Import pack review (PackImportDialog.jsx): what is
 * ticked by default, what a selection adds up to, and what the dependency
 * check found. No React, no Electron.
 */

export const PACK_FILE_PATTERN = /\.(zip|dspack)$/i
export const PACK_ZIP_MIME_TYPES = Object.freeze(['application/zip', 'application/x-zip-compressed', 'application/x-zip'])

export const isPackFileName = (name) => PACK_FILE_PATTERN.test(String(name || ''))

/** Does a drag (during dragover, names unknown) look like it carries a zip? */
export function dragMayCarryPack(dataTransfer) {
  const items = Array.from(dataTransfer?.items || [])
  return items.some((item) => item?.kind === 'file' && PACK_ZIP_MIME_TYPES.includes(String(item.type || '').toLowerCase()))
}

/** The first .zip / .dspack among dropped files, or null. Read it synchronously in the drop handler. */
export function findDroppedPack(dataTransfer) {
  return Array.from(dataTransfer?.files || []).find((file) => isPackFileName(file?.name)) || null
}

/** Ticked by default: every workflow and template; media when it can land (LUTs always can). */
export function initialPackSelection(pack, { hasProject = false } = {}) {
  const ids = new Set()
  for (const item of pack?.workflows || []) ids.add(item.id)
  for (const item of pack?.templates || []) ids.add(item.id)
  for (const item of pack?.media || []) if (hasProject || item.mediaType === 'lut') ids.add(item.id)
  return ids
}

/** Can this media item be imported right now? */
export const canImportMediaItem = (item, { hasProject = false } = {}) => hasProject || item?.mediaType === 'lut'

/** What a selection adds up to, by destination. */
export function countPackSelection(pack, selected, { hasProject = false } = {}) {
  const has = (item) => selected?.has?.(item.id)
  const media = (pack?.media || []).filter((item) => has(item) && canImportMediaItem(item, { hasProject }))
  const counts = {
    workflows: (pack?.workflows || []).filter(has).length,
    templates: (pack?.templates || []).filter(has).length,
    assets: media.filter((item) => item.mediaType !== 'lut').length,
    luts: media.filter((item) => item.mediaType === 'lut').length,
  }
  return { ...counts, total: counts.workflows + counts.templates + counts.assets + counts.luts }
}

/** Unique API-prompt class types. */
export function apiNodeTypes(graph) {
  const types = new Set()
  for (const node of Object.values(graph || {})) {
    const type = String(node?.class_type || '').trim()
    if (type) types.add(type)
  }
  return Array.from(types)
}

/**
 * Summarize one workflow's dependency check.
 *   objectInfo: ComfyUI /object_info, or null when ComfyUI is not reachable
 *   models: [{ filename }] referenced by the workflow
 *   diskResults: [{ exists }] in the same order, or null when the models
 *                folder could not be checked
 * status: 'ready' | 'missing' | 'offline'
 */
export function summarizeWorkflowCheck({ nodeTypes = [], objectInfo = null, models = [], diskResults = null }) {
  const missingNodes = objectInfo ? nodeTypes.filter((type) => !objectInfo[type]) : []
  const missingModels = Array.isArray(diskResults)
    ? models.filter((model, index) => diskResults[index] && diskResults[index].exists === false).map((model) => model.filename)
    : []
  if (missingNodes.length || missingModels.length) return { status: 'missing', missingNodes, missingModels }
  return { status: objectInfo ? 'ready' : 'offline', missingNodes, missingModels }
}

/** Short list for one line of UI: "A, B, C +2". */
export function shortList(values, max = 3) {
  const list = Array.from(values || [])
  return list.length > max ? `${list.slice(0, max).join(', ')} +${list.length - max}` : list.join(', ')
}

const ERROR_CODES = new Set(['UNSAFE_PATH', 'ZIP_BOMB', 'TOO_MANY_FILES', 'TOO_BIG', 'NOT_ZIP', 'NOT_FOUND', 'EMPTY', 'EXPIRED'])

/** i18n key under packImport.errors for an importer error code. */
export const packErrorKey = (code) => (ERROR_CODES.has(code) ? code : 'generic')
