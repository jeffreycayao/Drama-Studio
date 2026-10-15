import { getAudioEqBands, normalizeAudioEq } from '../utils/audioEq.mjs'

// One reusable graph for preview and OfflineAudioContext. Keep the filter
// nodes alive during audition so dragging does not reset their delay state.
// Native export uses the matching RBJ coefficients from audioEq.mjs.
export function createAudioEqChain(context, initialEq) {
  const input = context.createGain()
  const output = context.createGain()
  const dry = context.createGain()
  const wet = context.createGain()
  const lowCutDry = context.createGain()
  const lowCutWet = context.createGain()
  const lowCutSum = context.createGain()
  const nodes = [input, output, dry, wet, lowCutDry, lowCutWet, lowCutSum]
  const filters = new Map()
  const bands = getAudioEqBands({ version: 1, enabled: true, lowCut: true,
    bassDb: 1, midDb: 1, trebleDb: 1 }, context.sampleRate)
  for (const band of bands) {
    const node = context.createBiquadFilter()
    node.type = band.type
    node.frequency.value = band.frequency
    node.Q.value = band.Q
    node.gain.value = 0
    nodes.push(node)
    filters.set(band.id, node)
  }
  input.connect(dry)
  dry.connect(output)
  input.connect(lowCutDry)
  lowCutDry.connect(lowCutSum)
  input.connect(filters.get('lowCut'))
  filters.get('lowCut').connect(lowCutWet)
  lowCutWet.connect(lowCutSum)
  let tail = lowCutSum
  for (const id of ['bass', 'mid', 'treble']) {
    tail.connect(filters.get(id))
    tail = filters.get(id)
  }
  tail.connect(wet)
  wet.connect(output)

  let previous = null
  let disposed = false
  const set = (param, value, immediate) => {
    const now = context.currentTime
    if (immediate) {
      param.setValueAtTime(value, now)
    } else {
      // setTargetAtTime starts from the current computed value. Unlike a
      // graph rebuild, this makes repeated drags and bypass changes smooth.
      param.cancelScheduledValues(now)
      param.setTargetAtTime(value, now, 0.01)
    }
  }
  const update = value => {
    if (disposed) return
    const eq = normalizeAudioEq(value)
    const immediate = previous === null
    if (immediate || previous.enabled !== eq.enabled) {
      set(dry.gain, eq.enabled ? 0 : 1, immediate)
      set(wet.gain, eq.enabled ? 1 : 0, immediate)
    }
    if (immediate || previous.lowCut !== eq.lowCut) {
      set(lowCutDry.gain, eq.lowCut ? 0 : 1, immediate)
      set(lowCutWet.gain, eq.lowCut ? 1 : 0, immediate)
    }
    for (const id of ['bass', 'mid', 'treble']) {
      const key = `${id}Db`
      if (immediate || previous[key] !== eq[key]) set(filters.get(id).gain, eq[key], immediate)
    }
    previous = eq
  }
  update(initialEq)
  return {
    input, output, update,
    dispose() {
      if (disposed) return
      disposed = true
      for (const node of nodes) {
        try { node.disconnect() } catch (_) { /* Context may already be closed. */ }
      }
    },
  }
}
