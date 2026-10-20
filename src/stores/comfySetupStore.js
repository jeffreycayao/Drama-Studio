import { create } from 'zustand'

/**
 * "Cloud only" mode: the user chose to use Drama Studio without ComfyUI
 * (no strong GPU). Editing, captions, translation and export work; features
 * that need ComfyUI ask for it when opened (ComfyRequired.jsx), and
 * `requestSetup()` re-opens the ComfySetupGate over the running app.
 */
const useComfySetupStore = create((set) => ({
  cloudOnly: false,
  // Feature waiting for ComfyUI ({ feature }) while the "needs ComfyUI" dialog shows.
  prompt: null,
  // Bumped to ask ComfySetupGate to run setup over the app.
  setupRequest: 0,
  setCloudOnly: (cloudOnly) => set({ cloudOnly: Boolean(cloudOnly) }),
  showPrompt: (feature) => set({ prompt: { feature: feature || 'This feature' } }),
  dismissPrompt: () => set({ prompt: null }),
  requestSetup: () => set((state) => ({ prompt: null, setupRequest: state.setupRequest + 1 })),
}))

/**
 * Guard for features that need ComfyUI. In cloud-only mode it shows the
 * "needs ComfyUI" dialog and returns false; otherwise returns true.
 */
export function ensureComfyFor(feature) {
  const state = useComfySetupStore.getState()
  if (!state.cloudOnly) return true
  state.showPrompt(feature)
  return false
}

export default useComfySetupStore
