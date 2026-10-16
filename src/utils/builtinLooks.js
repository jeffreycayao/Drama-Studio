/**
 * Built-in color filters ("looks"), CapCut-style one-click grades. Each look
 * is a small color function turned into a 3D LUT at startup and registered
 * in the LUT library under a stable `builtin-*` id, so clips reference them
 * like imported .cube LUTs (clip.adjustments.lut = { lutId, amount }) and
 * every machine renders them the same way, in preview and export.
 */

export const BUILTIN_LUT_PREFIX = 'builtin-'
const SIZE = 17

const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value)
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const mix = (a, b, t) => a + (b - a) * t
const saturate = ([r, g, b], amount) => {
  const y = luma(r, g, b)
  return [mix(y, r, amount), mix(y, g, amount), mix(y, b, amount)]
}
const contrast = (value, amount, pivot = 0.5) => (value - pivot) * amount + pivot
const sCurve = value => value * value * (3 - 2 * value)
const lift = (value, black, white = 1) => black + value * (white - black)

/** Look definitions: id, name, a swatch hint, and (r, g, b) → [r, g, b] in 0..1. */
export const BUILTIN_LOOKS = Object.freeze([
  { id: 'bw', name: 'Black & White', fn: (r, g, b) => { const y = luma(r, g, b); return [y, y, y] } },
  { id: 'noir', name: 'Noir', fn: (r, g, b) => { const y = clamp01(contrast(sCurve(luma(r, g, b)), 1.25)); return [y, y, y] } },
  { id: 'sepia', name: 'Sepia', fn: (r, g, b) => { const y = luma(r, g, b); return [y * 1.07 + 0.04, y * 0.9 + 0.03, y * 0.66] } },
  { id: 'vintage', name: 'Vintage', fn: (r, g, b) => {
    const [sr, sg, sb] = saturate([r, g, b], 0.65)
    return [lift(contrast(sr, 0.85), 0.08, 0.96) + 0.03, lift(contrast(sg, 0.85), 0.07, 0.93), lift(contrast(sb, 0.85), 0.1, 0.84)]
  } },
  { id: 'warm', name: 'Warm', fn: (r, g, b) => [r * 1.06 + 0.02, g * 1.01, b * 0.88] },
  { id: 'cool', name: 'Cool', fn: (r, g, b) => [r * 0.9, g * 0.99, b * 1.08 + 0.02] },
  { id: 'teal-orange', name: 'Teal & Orange', fn: (r, g, b) => {
    const y = luma(r, g, b)
    // Shadows toward teal, highlights / skin toward orange.
    const shadow = 1 - y, high = y
    const out = [r + 0.1 * high - 0.06 * shadow, g + 0.02 * high + 0.03 * shadow, b - 0.1 * high + 0.08 * shadow]
    return saturate(out, 1.15).map(value => contrast(value, 1.08))
  } },
  { id: 'vivid', name: 'Vivid', fn: (r, g, b) => saturate([r, g, b], 1.45).map(value => contrast(value, 1.1)) },
  { id: 'faded', name: 'Faded', fn: (r, g, b) => saturate([r, g, b], 0.8).map(value => lift(contrast(value, 0.8), 0.1, 0.94)) },
  { id: 'cinematic', name: 'Cinematic', fn: (r, g, b) => {
    const graded = saturate([r, g, b], 0.85).map(value => sCurve(clamp01(contrast(value, 1.05))))
    const y = luma(...graded)
    return [graded[0] + 0.03 * y, graded[1] + 0.01, graded[2] + 0.05 * (1 - y)]
  } },
  { id: 'golden-hour', name: 'Golden Hour', fn: (r, g, b) => saturate([r * 1.1 + 0.04, g * 1.03 + 0.02, b * 0.8], 1.1) },
  { id: 'moonlight', name: 'Moonlight', fn: (r, g, b) => {
    const [sr, sg, sb] = saturate([r, g, b], 0.4)
    return [sr * 0.78, sg * 0.88 + 0.01, sb * 1.05 + 0.06]
  } },
  { id: 'pastel', name: 'Pastel', fn: (r, g, b) => saturate([r, g, b], 0.7).map(value => lift(value, 0.12, 1)) },
  { id: 'cyberpunk', name: 'Cyberpunk', fn: (r, g, b) => {
    const y = luma(r, g, b)
    return saturate([r + 0.12 * y, g * 0.85, b + 0.18 * (1 - y) + 0.05], 1.3).map(value => contrast(value, 1.1))
  } },
])

/** RGBA8 3D LUT for one look (red-fastest, like cubeLutToRgba8). */
export function buildLookLutRgba8(look, size = SIZE) {
  const out = new Uint8Array(size * size * size * 4)
  let i = 0
  for (let bi = 0; bi < size; bi += 1) {
    for (let gi = 0; gi < size; gi += 1) {
      for (let ri = 0; ri < size; ri += 1) {
        const [r, g, b] = look.fn(ri / (size - 1), gi / (size - 1), bi / (size - 1))
        out[i] = Math.round(clamp01(r) * 255)
        out[i + 1] = Math.round(clamp01(g) * 255)
        out[i + 2] = Math.round(clamp01(b) * 255)
        out[i + 3] = 255
        i += 4
      }
    }
  }
  return out
}

/** Registry entries ({ id, name, size, rgba8, builtin: true }) for every look. */
export function buildBuiltinLutEntries(size = SIZE) {
  return BUILTIN_LOOKS.map(look => ({
    id: `${BUILTIN_LUT_PREFIX}${look.id}`, name: look.name, size, rgba8: buildLookLutRgba8(look, size), builtin: true,
  }))
}

export const isBuiltinLutId = id => typeof id === 'string' && id.startsWith(BUILTIN_LUT_PREFIX)

/** A CSS gradient showing the look applied to a few reference colors (for swatches). */
export function lookSwatchGradient(look) {
  const refs = [[0.85, 0.55, 0.42], [0.3, 0.55, 0.75], [0.95, 0.9, 0.8], [0.2, 0.25, 0.2]]
  const stops = refs.map(([r, g, b], index) => {
    const [rr, gg, bb] = look.fn(r, g, b).map(value => Math.round(clamp01(value) * 255))
    return `rgb(${rr},${gg},${bb}) ${Math.round((index / (refs.length - 1)) * 100)}%`
  })
  return `linear-gradient(90deg, ${stops.join(', ')})`
}
