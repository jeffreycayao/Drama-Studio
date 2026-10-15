export const AUDIO_VOLUME_ENVELOPE_MIN_DB = -60
export const AUDIO_VOLUME_ENVELOPE_MAX_DB = 12
export const AUDIO_VOLUME_ENVELOPE_MAX_POINTS = 128

const emptyEnvelope = () => ({ version: 1, offsetSeconds: 0, points: [] })
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value)
const failure = reason => ({ ok: false, reason })

/** Strict authoring validation. Coordinates stay unbounded by clip duration so
 * hidden points survive reversible trims. Never coerce text into audio values. */
export function validateAudioVolumeEnvelope(envelope) {
  if (envelope == null) return { ok: true, envelope: emptyEnvelope() }
  if (!isObject(envelope) || envelope.version !== 1 || !isFiniteNumber(envelope.offsetSeconds) || !Array.isArray(envelope.points)) {
    return failure('The volume envelope is invalid. Reopen the clip and try again.')
  }
  if (envelope.points.length > AUDIO_VOLUME_ENVELOPE_MAX_POINTS) return failure(`A volume envelope supports up to ${AUDIO_VOLUME_ENVELOPE_MAX_POINTS} points.`)
  const ids = new Set()
  const times = new Set()
  const points = []
  for (const point of envelope.points) {
    if (!isObject(point) || typeof point.id !== 'string' || !point.id.trim() || ids.has(point.id)
      || !isFiniteNumber(point.time) || times.has(point.time) || !isFiniteNumber(point.db)
      || point.db < AUDIO_VOLUME_ENVELOPE_MIN_DB || point.db > AUDIO_VOLUME_ENVELOPE_MAX_DB) {
      return failure('Volume points need unique IDs and times, with a level from -60 to +12 dB.')
    }
    ids.add(point.id)
    times.add(point.time)
    points.push({ id: point.id, time: point.time, db: point.db })
  }
  points.sort((a, b) => a.time - b.time)
  // Two individually finite coordinates can still overflow during interpolation.
  if (points.length > 1 && !Number.isFinite(points.at(-1).time - points[0].time)) {
    return failure('Volume point times are outside the supported time range.')
  }
  return { ok: true, envelope: { version: 1, offsetSeconds: envelope.offsetSeconds, points } }
}

/** Read paths fail neutral on malformed project data; authoring uses the strict
 * validator above to reject it without replacing state or creating history. */
export function normalizeAudioVolumeEnvelope(envelope) {
  const result = validateAudioVolumeEnvelope(envelope)
  return result.ok ? result.envelope : emptyEnvelope()
}

export function getAudioVolumeEnvelopeDb(clip, localTime) {
  const { points, offsetSeconds } = normalizeAudioVolumeEnvelope(clip?.volumeEnvelope)
  if (!points.length) return 0
  const coordinate = (isFiniteNumber(localTime) ? localTime : 0) + offsetSeconds
  if (coordinate <= points[0].time) return points[0].db
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index]
    if (coordinate <= right.time) {
      const left = points[index - 1]
      return left.db + (right.db - left.db) * ((coordinate - left.time) / (right.time - left.time))
    }
  }
  return points.at(-1).db
}

export function getAudioVolumeEnvelopeGain(clip, localTime) {
  return Math.pow(10, getAudioVolumeEnvelopeDb(clip, localTime) / 20)
}

/** Return an envelope VALUE for a retained piece, not a clip update object.
 * Timeline head trimming/splitting advances the coordinate; moves and slips do
 * not. Retain every point, including points outside the visible new piece. */
export function shiftAudioVolumeEnvelope(clip, delta) {
  if (clip?.volumeEnvelope == null) return undefined
  const envelope = normalizeAudioVolumeEnvelope(clip.volumeEnvelope)
  const shifted = envelope.offsetSeconds + (isFiniteNumber(delta) ? delta : 0)
  return { ...envelope, offsetSeconds: Number.isFinite(shifted) ? shifted : envelope.offsetSeconds }
}

const numeric = value => Object.is(value, -0) ? '0' : String(value)

/** Linear GAIN expression for FFmpeg. Each segment contributes one saturated
 * linear dB ramp; the flat sum avoids a deeply nested 128-point if-expression.
 * Point IDs and unchecked strings never enter the filter expression. */
export function buildAudioVolumeEnvelopeExpression(clip, localTimeExpression = 't') {
  const { points, offsetSeconds } = normalizeAudioVolumeEnvelope(clip?.volumeEnvelope)
  if (!points.length) return '1'
  const expression = String(localTimeExpression).trim()
  // The caller may provide t plus numeric arithmetic for an export range offset,
  // but cannot inject FFmpeg functions, quotes, separators, or other variables.
  const tokens = expression.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|t|[()+\-*/]/g)
  if (!tokens || tokens.join('') !== expression.replace(/\s/g, '')) throw new Error('Invalid volume envelope local-time expression.')
  const time = `((${expression})+(${numeric(offsetSeconds)}))`
  const terms = [numeric(points[0].db)]
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1]
    const right = points[index]
    const delta = right.db - left.db
    if (delta === 0) continue
    terms.push(`(${numeric(delta)})*min(1,max(0,(${time}-(${numeric(left.time)}))/(${numeric(right.time - left.time)})))`)
  }
  return `pow(10,(${terms.join('+')})/20)`
}
