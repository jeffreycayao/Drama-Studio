import { create } from 'zustand'
import { normalizeAudioEq } from '../utils/audioEq.mjs'

// Audition-only state. Never persisted, exported, copied, or added to history.
// Renderers must require preview.clip === currentClip before using preview.eq.
export const useAudioEqPreview = create((set, get) => ({
  clip: null,
  eq: null,
  setPreview: (clip, eq) => {
    if (!clip) return
    set({ clip, eq: { ...normalizeAudioEq(eq) } })
  },
  clearPreview: (expectedClip = null) => {
    const state = get()
    if (expectedClip && state.clip !== expectedClip) return
    if (state.clip === null && state.eq === null) return
    set({ clip: null, eq: null })
  },
}))

export default useAudioEqPreview
