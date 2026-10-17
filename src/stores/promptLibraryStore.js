import { create } from 'zustand'
import { normalizeMyPrompt, starterPrompts } from '../utils/promptLibrary.mjs'
import { readLibraryFile, readPackPrompts, writeLibraryFile } from '../services/promptLibraryService'

/**
 * The prompt library: starter prompts, prompts kept from imported packs, and
 * the user's own (the only editable ones). Favorites and "last used" apply to
 * all three. The dialog is opened with openLibrary(): with `onUse` it inserts
 * into the field that opened it; with `draftText` it starts a new prompt from
 * that text (the "Save to library" buttons).
 */
const usePromptLibraryStore = create((set, get) => ({
  loaded: false,
  loading: null,
  error: '',
  starter: starterPrompts(),
  packPrompts: [],
  mine: [],
  favorites: [],
  used: {},

  open: false,
  /** @type {{ onUse?: (text: string, mode: 'replace'|'append') => void, fieldLabel?: string, category?: string, draftText?: string, draftCategory?: string, query?: string, key: number } | null} */
  request: null,

  allPrompts: () => {
    const { mine, packPrompts, starter } = get()
    return [...mine, ...packPrompts, ...starter]
  },

  findPrompt: (id) => get().allPrompts().find((item) => item.id === id) || null,

  load: async ({ force = false } = {}) => {
    if (get().loading) return get().loading
    if (get().loaded && !force) return undefined
    const loading = (async () => {
      try {
        const [file, packPrompts] = await Promise.all([
          readLibraryFile(),
          readPackPrompts().catch(() => []),
        ])
        set({ mine: file.prompts, favorites: file.favorites, used: file.used, packPrompts, loaded: true, error: '' })
      } catch (error) {
        set({ loaded: true, error: error?.message || 'Could not read the prompt library.' })
      } finally {
        set({ loading: null })
      }
    })()
    set({ loading })
    return loading
  },

  persist: async () => {
    const { mine, favorites, used } = get()
    try {
      await writeLibraryFile({ prompts: mine, favorites, used })
      if (get().error) set({ error: '' })
      return true
    } catch (error) {
      set({ error: error?.message || 'Could not save the prompt library.' })
      return false
    }
  },

  /** Add or update one of the user's prompts. Returns the saved prompt. */
  savePrompt: async (draft) => {
    await get().load()
    const now = Date.now()
    const existing = draft?.id ? get().mine.find((item) => item.id === draft.id) : null
    const prompt = normalizeMyPrompt({ ...existing, ...draft, id: existing?.id, createdAt: existing?.createdAt ?? now, updatedAt: now }, now)
    if (!prompt) throw new Error('A prompt needs some text.')
    set((state) => ({
      mine: existing ? state.mine.map((item) => (item.id === existing.id ? prompt : item)) : [prompt, ...state.mine],
    }))
    await get().persist()
    return prompt
  },

  deletePrompt: async (id) => {
    set((state) => ({
      mine: state.mine.filter((item) => item.id !== id),
      favorites: state.favorites.filter((fav) => fav !== id),
    }))
    return get().persist()
  },

  toggleFavorite: async (id) => {
    set((state) => ({
      favorites: state.favorites.includes(id) ? state.favorites.filter((fav) => fav !== id) : [id, ...state.favorites],
    }))
    return get().persist()
  },

  markUsed: async (id) => {
    if (!id) return false
    set((state) => ({ used: { ...state.used, [id]: Date.now() } }))
    return get().persist()
  },

  openLibrary: (request = {}) => {
    set({ open: true, request: { ...request, key: Date.now() } })
    // The user's file is read once; packs are re-read so a pack imported a
    // minute ago shows up without a restart.
    if (!get().loaded) get().load()
    else get().refreshPackPrompts()
  },
  refreshPackPrompts: async () => {
    const packPrompts = await readPackPrompts().catch(() => null)
    if (packPrompts) set({ packPrompts })
  },
  closeLibrary: () => set({ open: false, request: null }),
}))

export default usePromptLibraryStore

/** Open the library from anywhere (commands, menus, help actions). */
export function openPromptLibrary(request) {
  usePromptLibraryStore.getState().openLibrary(request)
}
