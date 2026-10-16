import { SFX_DRAG_TYPE, parseSfxDragPayload } from '../types/sfx.js'

export { SFX_DRAG_TYPE }
export const SFX_SETTINGS_KEY = 'sfxLibrary'
export const SFX_FOLDER_NAME = 'Sound Effects'
const prefetches = new Map()

const api = () => globalThis.window?.electronAPI?.sfx || null
export const isSfxLibraryAvailable = () => Boolean(api())

const unwrap = (result, fallback) => {
  if (!result?.success) throw new Error(result?.error || fallback)
  return result
}

/** Only HTTPS catalogs (zero-egress object storage such as Cloudflare R2 or a
 * Hugging Face dataset). Google Drive links are refused: no reliable Range
 * support and rewritten download URLs. */
export function validateSfxCatalogUrl(value) {
  const text = String(value || '').trim()
  if (!text) return { ok: true, url: '' }
  let url
  try { url = new URL(text) } catch { return { ok: false, reason: 'Enter a full https:// URL to sfx-catalog.json.' } }
  if (url.protocol !== 'https:') return { ok: false, reason: 'The catalog URL must use https://.' }
  if (url.username || url.password) return { ok: false, reason: 'Do not put credentials in the catalog URL.' }
  if (/(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/i.test(url.hostname)) {
    return { ok: false, reason: 'Google Drive does not support streaming previews. Host the pack on Cloudflare R2 or Hugging Face.' }
  }
  return { ok: true, url: url.href }
}

export async function getSfxSettings() {
  const value = await globalThis.window?.electronAPI?.getSetting?.(SFX_SETTINGS_KEY)
  return value && typeof value === 'object' ? { catalogUrl: typeof value.catalogUrl === 'string' ? value.catalogUrl : '' } : { catalogUrl: '' }
}

export async function saveSfxSettings({ catalogUrl }) {
  const checked = validateSfxCatalogUrl(catalogUrl)
  if (!checked.ok) throw new Error(checked.reason)
  // Keep the active source; saving a catalog URL switches to it.
  const current = await globalThis.window?.electronAPI?.getSetting?.(SFX_SETTINGS_KEY)
  const source = checked.url ? 'url' : (current && typeof current === 'object' && current.source === 'r2-pack' ? 'r2-pack' : 'url')
  const result = await globalThis.window?.electronAPI?.setSetting?.(SFX_SETTINGS_KEY, { catalogUrl: checked.url, source })
  if (result && result.success === false) throw new Error(result.error || 'Could not save the SFX settings.')
  window.dispatchEvent(new Event('drama-sfx-settings-changed'))
  return { catalogUrl: checked.url }
}

export async function loadSfxCatalog({ refresh = false } = {}) {
  if (!api()) return { configured: false, entries: [], unavailable: true }
  return unwrap(await api().getCatalog({ refresh }), 'Could not load the SFX catalog.')
}

export async function getSfxPreviewSource(id) {
  return unwrap(await api().previewSource(id), 'Could not preview this sound.')
}

export async function getSfxStatus(ids) {
  if (!api() || !ids.length) return {}
  return unwrap(await api().status(ids), 'Could not read the SFX cache.').status
}

/** Start downloading as soon as a drag begins; most effects are small, so
 * the file is usually local before the drop. Only the in-flight request is
 * shared: once settled, the next call asks main again (a cheap cache check),
 * so a cleared cache can never hand the drop a deleted path. */
export function prefetchSfx(id) {
  if (prefetches.has(id)) return prefetches.get(id)
  const promise = Promise.resolve(api()?.resolve(id))
    .then(result => unwrap(result, 'The sound effect could not be downloaded.'))
    .finally(() => { if (prefetches.get(id) === promise) prefetches.delete(id) })
  prefetches.set(id, promise)
  return promise
}

export function readSfxDragPayload(dataTransfer) {
  if (!dataTransfer?.types || ![...dataTransfer.types].includes(SFX_DRAG_TYPE)) return null
  return parseSfxDragPayload(dataTransfer.getData(SFX_DRAG_TYPE))
}

export const hasSfxDrag = dataTransfer => Boolean(dataTransfer?.types && [...dataTransfer.types].includes(SFX_DRAG_TYPE))

// Browsers hide custom drag data during dragover (only `types` are visible),
// so the timeline's drop preview reads the in-window drag from here.
let activeDrag = null
export const setActiveSfxDrag = payload => { activeDrag = payload ? { ...payload } : null }
export const getActiveSfxDrag = () => activeDrag

/** Turn a dropped SFX into a project asset. The file is copied into the
 * project (`assets/audio`) so projects stay portable; a sound already
 * imported into this project is reused. `isCurrent()` guards against a
 * project switch while the download was running. */
export async function resolveSfxDropToAsset(payload, { projectHandle, assetsStore, isCurrent = () => true, deps = {} }) {
  if (!payload?.id) throw new Error('This drop is not a sound effect.')
  if (!projectHandle) throw new Error('Open a project before adding sound effects.')
  const store = assetsStore.getState()
  const existing = store.assets.find(asset => asset?.settings?.sfx?.id === payload.id && asset.type === 'audio' && asset.url)
  if (existing) return existing
  const { importAsset, getAbsoluteFileUrl } = deps.fileSystem || await import('./fileSystem')
  const resolved = await (deps.prefetch || prefetchSfx)(payload.id)
  if (!isCurrent()) throw new Error('The project changed while the sound was downloading.')
  const info = await importAsset(projectHandle, resolved.path, 'audio')
  if (!isCurrent()) throw new Error('The project changed while the sound was being imported.')
  const url = info.absolutePath ? await getAbsoluteFileUrl(info.absolutePath) : info.url
  const latest = assetsStore.getState()
  let folder = (latest.folders || []).find(item => item?.name === SFX_FOLDER_NAME && !item.parentId)
  if (!folder && typeof latest.addFolder === 'function') folder = latest.addFolder({ name: SFX_FOLDER_NAME })
  return latest.addAsset({
    ...info,
    url: url || info.url || null,
    name: payload.name || info.name,
    type: 'audio',
    hasAudio: true,
    folderId: folder?.id || null,
    settings: { ...(info.settings || {}), duration: info.duration ?? payload.duration,
      sfx: { id: payload.id, source: 'sfx-library' } },
  })
}

/** Private Cloudflare R2 pack (zip + catalog.tsv). Keys go to main and never come back. */
const r2Api = () => api()?.r2 || null
const r2Call = async (name, fallback, ...args) => {
  if (!r2Api()) throw new Error('The sound-effects pack needs the Drama Studio desktop app.')
  const result = unwrap(await r2Api()[name](...args), fallback)
  if (!result.canceled) window.dispatchEvent(new Event('drama-sfx-settings-changed'))
  return result
}
export const sfxR2 = {
  get: async () => (r2Api() ? unwrap(await r2Api().get(), 'Could not read the R2 settings.') : null),
  save: input => r2Call('save', 'Could not save the R2 settings.', input),
  importKeyFile: () => r2Call('importKeyFile', 'Could not import the key file.'),
  chooseFolder: () => r2Call('chooseFolder', 'Could not change the library folder.'),
  setActive: active => r2Call('setActive', 'Could not switch the sound-effects source.', active),
  forgetKeys: () => r2Call('forgetKeys', 'Could not remove the keys.'),
  openFolder: async () => unwrap(await r2Api().openFolder(), 'Could not open the folder.'),
}

export const sfxPack = {
  start: async () => unwrap(await api().packStart(), 'Could not start the download.').pack,
  pause: async () => unwrap(await api().packPause(), 'Could not pause.').pack,
  resume: async () => unwrap(await api().packResume(), 'Could not resume.').pack,
  cancel: async () => unwrap(await api().packCancel(), 'Could not cancel.').pack,
  status: async () => unwrap(await api().packStatus(), 'Could not read the download status.').pack,
  onProgress: callback => api()?.onPackProgress?.(callback) || (() => {}),
  cacheInfo: async () => unwrap(await api().cacheInfo(), 'Could not read the SFX cache.'),
  clearCache: async () => unwrap(await api().clearCache(), 'Could not clear the SFX cache.'),
}
