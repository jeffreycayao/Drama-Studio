import { create } from 'zustand'

/**
 * Session-only state for the Help Center overlay. `articleId` opens straight
 * to an article (deep link from another part of the app); null opens home.
 * `watchOpen` shows the video tutorials (Help › Watch).
 */
const useHelpStore = create((set) => ({
  open: false,
  articleId: null,
  // Help › Watch: the video tutorials (formerly the Discover tab).
  watchOpen: false,
  openWatch: () => set({ open: false, articleId: null, watchOpen: true }),
  closeWatch: () => set({ watchOpen: false }),
  openHelp: (articleId = null) => set({ open: true, articleId }),
  closeHelp: () => set({ open: false, articleId: null }),
  toggleHelp: () => set((state) => ({ open: !state.open, articleId: null })),
}))

export default useHelpStore
