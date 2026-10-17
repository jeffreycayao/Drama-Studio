// Prompt library on disk (desktop build only).
//   userData/prompt-library/library.json  the user's prompts, favorites, last used
//   userData/imported-packs/<slug>/       prompt templates kept from imported packs
//                                         (read only; written by the pack importer)
// In a browser preview there is no disk: the library still works for the
// session with the starter prompts.

import { isPackPromptFile, packFileToPrompt, parseLibraryFile, serializeLibraryFile } from '../utils/promptLibrary.mjs'

const LIBRARY_DIR = 'prompt-library'
const LIBRARY_FILE = 'library.json'
const KEPT_PACKS_DIR = 'imported-packs'
const MAX_PACK_PROMPTS = 500

function api() {
  return typeof window !== 'undefined' ? window.electronAPI : null
}

export function isPromptLibraryOnDisk() {
  const bridge = api()
  return Boolean(bridge?.getAppPath && bridge?.pathJoin && bridge?.readFile && bridge?.writeFile)
}

async function userDataPath(...parts) {
  const bridge = api()
  const userData = await bridge.getAppPath('userData')
  if (!userData) throw new Error('The app data folder is not available.')
  return bridge.pathJoin(userData, ...parts)
}

export async function readLibraryFile() {
  if (!isPromptLibraryOnDisk()) return parseLibraryFile(null)
  const bridge = api()
  const filePath = await userDataPath(LIBRARY_DIR, LIBRARY_FILE)
  const exists = bridge.exists ? await bridge.exists(filePath) : true
  if (!exists) return parseLibraryFile(null)
  const read = await bridge.readFile(filePath, { encoding: 'utf8' })
  return parseLibraryFile(read?.success ? read.data : null)
}

let writeChain = Promise.resolve()

/** Writes are queued so two quick saves never interleave. */
export function writeLibraryFile(state) {
  if (!isPromptLibraryOnDisk()) return Promise.resolve({ ok: true, inMemory: true })
  const text = serializeLibraryFile(state)
  writeChain = writeChain.catch(() => {}).then(async () => {
    const bridge = api()
    const dir = await userDataPath(LIBRARY_DIR)
    if (bridge.createDirectory) await bridge.createDirectory(dir, { recursive: true })
    const filePath = await bridge.pathJoin(dir, LIBRARY_FILE)
    const wrote = await bridge.writeFile(filePath, text, { encoding: 'utf8' })
    if (wrote && wrote.success === false) throw new Error(wrote.error || 'Could not save the prompt library.')
    return { ok: true }
  })
  return writeChain
}

/** Prompt templates kept from imported packs, as read-only library prompts. */
export async function readPackPrompts() {
  const bridge = api()
  if (!isPromptLibraryOnDisk() || !bridge.listDirectory) return []
  const root = await userDataPath(KEPT_PACKS_DIR)
  if (bridge.exists && !(await bridge.exists(root))) return []
  const listing = await bridge.listDirectory(root)
  if (!listing?.success || !Array.isArray(listing.items)) return []
  const prompts = []
  for (const folder of listing.items) {
    if (!folder?.isDirectory || !folder.name) continue
    try {
      const manifestPath = await bridge.pathJoin(root, folder.name, 'pack.json')
      const read = await bridge.readFile(manifestPath, { encoding: 'utf8' })
      if (!read?.success) continue
      const manifest = JSON.parse(read.data)
      for (const rel of Array.isArray(manifest?.files) ? manifest.files : []) {
        const relPath = String(rel || '')
        // pack.json is written by the importer, but never follow a path out of the folder.
        if (!isPackPromptFile(relPath) || relPath.split(/[\\/]/).includes('..')) continue
        const fileRead = await bridge.readFile(await bridge.pathJoin(root, folder.name, relPath), { encoding: 'utf8' })
        if (!fileRead?.success) continue
        const prompt = packFileToPrompt({ slug: folder.name, packName: manifest.name, relPath, text: fileRead.data, importedAt: manifest.importedAt })
        if (prompt) prompts.push(prompt)
        if (prompts.length >= MAX_PACK_PROMPTS) return prompts
      }
    } catch {
      // One unreadable pack never hides the others.
    }
  }
  return prompts
}
