export const AUDIO_EQ_MIN_DB = -12
export const AUDIO_EQ_MAX_DB = 12
export const AUDIO_EQ_DEFAULT_SAMPLE_RATE = 48000
export const DEFAULT_AUDIO_EQ = Object.freeze({
  version: 1, enabled: true, lowCut: false, bassDb: 0, midDb: 0, trebleDb: 0,
})

const gainFields = ['bassDb', 'midDb', 'trebleDb']
const finiteNumber = value => typeof value === 'number' && Number.isFinite(value)

/** Authoring must reject malformed data instead of coercing or clamping an
 * entered setting. Read paths normalize malformed/unknown versions to flat. */
export function validateAudioEq(eq) {
  if (eq == null) return { ok: true, eq: { ...DEFAULT_AUDIO_EQ } }
  if (typeof eq !== 'object' || Array.isArray(eq) || eq.version !== 1
    || typeof eq.enabled !== 'boolean' || typeof eq.lowCut !== 'boolean') {
    return { ok: false, reason: 'The audio EQ settings are invalid. Reopen the clip and try again.' }
  }
  if (gainFields.some(field => !finiteNumber(eq[field]) || eq[field] < AUDIO_EQ_MIN_DB || eq[field] > AUDIO_EQ_MAX_DB)) {
    return { ok: false, reason: 'Bass, Mid, and Treble need a level from -12 to +12 dB.' }
  }
  return { ok: true, eq: {
    version: 1, enabled: eq.enabled, lowCut: eq.lowCut,
    bassDb: eq.bassDb, midDb: eq.midDb, trebleDb: eq.trebleDb,
  } }
}

export function normalizeAudioEq(eq) {
  const validated = validateAudioEq(eq)
  return validated.ok ? validated.eq : { ...DEFAULT_AUDIO_EQ }
}

const sampleRateOf = sampleRate => finiteNumber(sampleRate) && sampleRate >= 1000 && sampleRate <= 768000
  ? sampleRate : AUDIO_EQ_DEFAULT_SAMPLE_RATE

/** Active band definitions, ready for BiquadFilterNode AudioParams.
 * Highpass Q is expressed in dB by Web Audio, unlike peaking's linear Q.
 * Shelves have fixed slope S=1 and ignore their Q AudioParam.
 * https://webaudio.github.io/web-audio-api/#dom-biquadfilternode-q
 */
export function getAudioEqBands(eq, sampleRate = AUDIO_EQ_DEFAULT_SAMPLE_RATE) {
  const normalized = normalizeAudioEq(eq)
  if (!normalized.enabled) return []
  const rate = sampleRateOf(sampleRate)
  const frequency = value => Math.min(value, rate * 0.45)
  const bands = []
  if (normalized.lowCut) bands.push({ id: 'lowCut', type: 'highpass', frequency: frequency(80), Q: 20 * Math.log10(Math.SQRT1_2), gain: 0 })
  if (normalized.bassDb !== 0) bands.push({ id: 'bass', type: 'lowshelf', frequency: frequency(120), Q: 1, gain: normalized.bassDb })
  if (normalized.midDb !== 0) bands.push({ id: 'mid', type: 'peaking', frequency: frequency(1000), Q: 1, gain: normalized.midDb })
  if (normalized.trebleDb !== 0) bands.push({ id: 'treble', type: 'highshelf', frequency: frequency(5000), Q: 1, gain: normalized.trebleDb })
  return bands
}

/** RBJ biquads with a0 normalized to 1. FFmpeg's biquad filter and Web Audio
 * therefore share the same poles/zeros, including Butterworth 80 Hz low cut.
 * Shelving alpha uses S=1; the peaking filter uses Q=1.
 * Formula reference: https://www.w3.org/TR/audio-eq-cookbook/
 * Returns {id,b0,b1,b2,a0,a1,a2} for each active band, in signal-path order.
 */
export function getAudioEqCoefficients(eq, sampleRate = AUDIO_EQ_DEFAULT_SAMPLE_RATE) {
  const rate = sampleRateOf(sampleRate)
  return getAudioEqBands(eq, rate).map(band => {
    const omega = 2 * Math.PI * band.frequency / rate
    const cosine = Math.cos(omega)
    const sine = Math.sin(omega)
    const A = Math.pow(10, band.gain / 40)
    let b0, b1, b2, a0, a1, a2
    if (band.type === 'highpass') {
      const alpha = sine / (2 * Math.SQRT1_2)
      b0 = (1 + cosine) / 2
      b1 = -(1 + cosine)
      b2 = b0
      a0 = 1 + alpha
      a1 = -2 * cosine
      a2 = 1 - alpha
    } else if (band.type === 'peaking') {
      const alpha = sine / (2 * band.Q)
      b0 = 1 + alpha * A
      b1 = -2 * cosine
      b2 = 1 - alpha * A
      a0 = 1 + alpha / A
      a1 = -2 * cosine
      a2 = 1 - alpha / A
    } else {
      const alpha = sine * Math.SQRT1_2 // RBJ shelf slope S=1.
      const beta = 2 * Math.sqrt(A) * alpha
      if (band.type === 'lowshelf') {
        b0 = A * ((A + 1) - (A - 1) * cosine + beta)
        b1 = 2 * A * ((A - 1) - (A + 1) * cosine)
        b2 = A * ((A + 1) - (A - 1) * cosine - beta)
        a0 = (A + 1) + (A - 1) * cosine + beta
        a1 = -2 * ((A - 1) + (A + 1) * cosine)
        a2 = (A + 1) + (A - 1) * cosine - beta
      } else {
        b0 = A * ((A + 1) + (A - 1) * cosine + beta)
        b1 = -2 * A * ((A - 1) + (A + 1) * cosine)
        b2 = A * ((A + 1) + (A - 1) * cosine - beta)
        a0 = (A + 1) - (A - 1) * cosine + beta
        a1 = 2 * ((A - 1) - (A + 1) * cosine)
        a2 = (A + 1) - (A - 1) * cosine - beta
      }
    }
    return { id: band.id, b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a0: 1, a1: a1 / a0, a2: a2 / a0 }
  })
}
