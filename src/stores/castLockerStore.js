import { create } from 'zustand'

/**
 * Session-only UI state for the Cast & Wardrobe Locker. The cast registry
 * itself lives in the project (projectStore get/setCastData); this store only
 * remembers whether the drawer is open and which member, if any, is locked
 * onto new generations. The lock is cleared when another project opens.
 */
const useCastLockerStore = create((set) => ({
  open: false,
  focusCastId: null,
  /** @type {{ castId: string, wardrobeId: string|null } | null} */
  activeLock: null,
  lockProjectKey: null,

  openDrawer: (castId = null) => set({ open: true, focusCastId: castId }),
  closeDrawer: () => set({ open: false }),
  setActiveLock: (lock, projectKey = null) => set({
    activeLock: lock?.castId ? { castId: lock.castId, wardrobeId: lock.wardrobeId || null } : null,
    lockProjectKey: lock?.castId ? projectKey : null,
  }),
  clearActiveLock: () => set({ activeLock: null, lockProjectKey: null }),
}))

export default useCastLockerStore
