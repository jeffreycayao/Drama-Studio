import { create } from 'zustand'

// Exact-identity, owner-bound audition only. Not project data or export input.
export const useAudioDuckingPreview = create((set, get) => ({
  clip: null, envelope: null, token: null,
  setPreview(clip, envelope, token) { set({ clip, envelope, token }) },
  clearPreview(token) {
    if (get().token !== token) return
    set({ clip: null, envelope: null, token: null })
  },
}))
