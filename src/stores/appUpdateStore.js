/**
 * App update state, mirrored from the main process (electron/appUpdater.cjs).
 * The update notice and Settings › Updates both read it; `init` subscribes once.
 */
import { create } from 'zustand'
import useProjectStore from './projectStore'

const api = () => (typeof window !== 'undefined' ? window.electronAPI?.updates : null)

const useAppUpdateStore = create((set, get) => ({
  update: null,
  dismissedVersion: null,
  busy: false,
  initialized: false,

  init: () => {
    const updates = api()
    if (!updates || get().initialized) return
    set({ initialized: true })
    updates.onState((update) => set({ update }))
    updates.getState().then((update) => set({ update })).catch(() => {})
  },

  check: async () => {
    const updates = api()
    if (!updates) return
    set({ busy: true, dismissedVersion: null })
    try { set({ update: await updates.check() }) } finally { set({ busy: false }) }
  },

  download: async () => {
    const updates = api()
    if (!updates) return
    set({ update: await updates.download() })
  },

  setAutoDownload: async (value) => {
    const updates = api()
    if (!updates) return
    set({ update: await updates.setAutoDownload(value) })
  },

  /** Saves the open project first, then quits into the installer. */
  installNow: async () => {
    const updates = api()
    if (!updates) return
    set({ busy: true })
    try {
      const { currentProject, saveProject } = useProjectStore.getState()
      if (currentProject) await saveProject()
      await updates.install()
    } finally {
      set({ busy: false })
    }
  },

  dismiss: () => set({ dismissedVersion: get().update?.latestVersion || null }),
}))

export default useAppUpdateStore
