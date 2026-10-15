import { getAudioEqCoefficients } from '../src/utils/audioEq.mjs'

// Coefficients are sample-rate specific. Resample explicitly before applying
// them, after source retiming but before clip gain/fades/envelope and delay.
// No user strings enter the filter expression; absent/bypassed EQ is a no-op.
export function buildAudioEqFilters(eq, requestedSampleRate = 48000) {
  const sampleRate = Number.isFinite(requestedSampleRate)
    ? Math.max(8000, Math.min(192000, Math.round(requestedSampleRate))) : 48000
  const coefficients = getAudioEqCoefficients(eq, sampleRate)
  if (!coefficients.length) return []
  return [`aresample=${sampleRate}`, ...coefficients.map(band =>
    `biquad=${['b0', 'b1', 'b2', 'a0', 'a1', 'a2'].map(key => `${key}=${band[key]}`).join(':')}:precision=f64`)]
}
