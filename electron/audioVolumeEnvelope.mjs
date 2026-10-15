import { buildAudioVolumeEnvelopeExpression, normalizeAudioVolumeEnvelope } from '../src/utils/audioVolumeEnvelope.mjs'

// Evaluate at audio-sample time, after atrim/asetpts/atempo and before adelay.
// val(ch) with c=same preserves mono/stereo and applies one envelope to each
// channel. Only validated numbers enter the expression; IDs/user text do not.
export function buildAudioVolumeEnvelopeFilter(clip, clipOffset = 0) {
  const envelope = normalizeAudioVolumeEnvelope(clip?.volumeEnvelope)
  if (!envelope.points.length) return null
  const offset = Number.isFinite(Number(clipOffset)) ? Number(clipOffset) : 0
  const expression = buildAudioVolumeEnvelopeExpression({ volumeEnvelope: envelope }, `t+(${offset})`)
  return `aeval='val(ch)*(${expression})':c=same`
}
