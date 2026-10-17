/**
 * Prompt templates and shot lists that Import pack kept in
 * userData/imported-packs/<slug>/ (see electron/packImport.cjs keep()).
 * Lists them from each folder's pack.json and reads one as text, through the
 * ordinary electronAPI file calls. A missing or broken folder is skipped, a
 * broken pack.json falls back to the template files at the top of the
 * folder, and only paths inside the pack folder are ever read.
 */
import {
  PACK_TEMPLATE_EXTENSIONS,
  extensionOf,
  isSafePackRelativePath,
  packTemplateKindFromName,
  templateFilesFromPackRecord,
  templateTitleFromFileName,
} from '../utils/packShotList.mjs'

const KEPT_PACKS_DIR = 'imported-packs'
const MAX_PACK_JSON_BYTES = 1024 * 1024
export const MAX_PACK_TEMPLATE_BYTES = 5 * 1024 * 1024

const electron = () => (typeof window !== 'undefined' ? window.electronAPI || null : null)

export const isPackTemplatesAvailable = () => {
  const api = electron()
  return Boolean(api?.getAppPath && api?.listDirectory && api?.readFile && api?.pathJoin)
}

async function readSmallText(api, filePath, maxBytes) {
  const info = await api.getFileInfo?.(filePath)
  if (info && info.success === false) return { ok: false, code: 'MISSING' }
  if (info?.info && (!info.info.isFile || Number(info.info.size) > maxBytes)) return { ok: false, code: info.info.isFile ? 'TOO_LARGE' : 'MISSING' }
  const read = await api.readFile(filePath, { encoding: 'utf8' })
  if (!read?.success) return { ok: false, code: 'MISSING' }
  return { ok: true, text: String(read.data ?? '') }
}

async function readPackRecord(api, folder) {
  try {
    const read = await readSmallText(api, await api.pathJoin(folder, 'pack.json'), MAX_PACK_JSON_BYTES)
    if (!read.ok) return null
    const value = JSON.parse(read.text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/** Template files at the top of a folder whose pack.json is missing or broken. */
async function topLevelTemplateFiles(api, folder) {
  const listing = await api.listDirectory(folder)
  const names = (listing?.items || [])
    .filter((item) => item?.isFile && PACK_TEMPLATE_EXTENSIONS.has(extensionOf(item.name)) && item.name !== 'pack.json')
    .map((item) => item.name)
  return templateFilesFromPackRecord(names)
}

/**
 * Every kept pack that has at least one template, newest first.
 * @returns {Promise<Array<{ slug: string, name: string, author: string, importedAt: string,
 *   folder: string, templates: Array<{ rel: string, name: string, title: string, kind: string, packSlug: string }> }>>}
 */
export async function listImportedPackTemplates() {
  const api = electron()
  if (!isPackTemplatesAvailable()) return []
  let root
  try {
    root = await api.pathJoin(await api.getAppPath('userData'), KEPT_PACKS_DIR)
  } catch {
    return []
  }
  const listing = await api.listDirectory(root).catch(() => null)
  if (!listing?.success) return []
  const packs = []
  for (const entry of listing.items || []) {
    if (!entry?.isDirectory || !isSafePackRelativePath(entry.name)) continue
    try {
      const folder = await api.pathJoin(root, entry.name)
      const record = await readPackRecord(api, folder)
      const files = record ? templateFilesFromPackRecord(record.files) : await topLevelTemplateFiles(api, folder)
      const templates = []
      for (const file of files) {
        // Skip what was deleted by hand since the import.
        if (api.pathExists && !(await api.pathExists(await api.pathJoin(folder, file.rel)))) continue
        templates.push({ ...file, title: templateTitleFromFileName(file.name), packSlug: entry.name })
      }
      if (!templates.length) continue
      const manifest = record?.manifest && typeof record.manifest === 'object' ? record.manifest : {}
      packs.push({
        slug: entry.name,
        name: String(record?.name || manifest.name || entry.name).slice(0, 200),
        author: typeof manifest.author === 'string' ? manifest.author.slice(0, 200) : '',
        importedAt: typeof record?.importedAt === 'string' ? record.importedAt : '',
        folder,
        templates,
      })
    } catch {
      // One unreadable folder does not hide the others.
    }
  }
  packs.sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt)) || a.name.localeCompare(b.name))
  return packs
}

/**
 * Read one template as text.
 * @returns {Promise<{ ok: true, text: string, kind: string } | { ok: false, code: 'DESKTOP_ONLY'|'UNSAFE'|'MISSING'|'TOO_LARGE' }>}
 */
export async function readImportedPackTemplate(pack, template) {
  const api = electron()
  if (!isPackTemplatesAvailable()) return { ok: false, code: 'DESKTOP_ONLY' }
  if (!pack?.folder || !isSafePackRelativePath(template?.rel)) return { ok: false, code: 'UNSAFE' }
  try {
    const read = await readSmallText(api, await api.pathJoin(pack.folder, template.rel), MAX_PACK_TEMPLATE_BYTES)
    return read.ok ? { ...read, kind: packTemplateKindFromName(template.name) } : read
  } catch {
    return { ok: false, code: 'MISSING' }
  }
}
