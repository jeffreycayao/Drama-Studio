import assert from 'node:assert/strict'
import test from 'node:test'
import { createAudioEqChain } from '../src/services/audioEqChain.js'
import { DEFAULT_AUDIO_EQ } from '../src/utils/audioEq.mjs'

function fakeContext() {
  const nodes = []
  const param = () => ({ value: 0, events: [],
    setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]) },
    cancelScheduledValues(time) { this.events.push(['cancel', time]) },
    setTargetAtTime(value, time, constant) { this.value = value; this.events.push(['target', value, time, constant]) },
  })
  const node = kind => {
    const value = { kind, gain: param(), frequency: param(), Q: param(), destinations: [], disconnects: 0,
      connect(to) { assert.ok(to); this.destinations.push(to) },
      disconnect() { this.disconnects++; this.destinations = [] },
    }
    nodes.push(value)
    return value
  }
  return { sampleRate: 48000, currentTime: 2, nodes,
    createGain: () => node('gain'), createBiquadFilter: () => node('filter'),
  }
}

test('EQ chain uses stable stereo-capable nodes and exact initial params', () => {
  const context = fakeContext()
  const eq = { ...DEFAULT_AUDIO_EQ, bassDb: 6, midDb: -3, trebleDb: 2, lowCut: true }
  const chain = createAudioEqChain(context, eq)
  const filters = context.nodes.filter(node => node.kind === 'filter')
  assert.equal(filters.length, 4)
  assert.deepEqual(filters.map(node => node.type), ['highpass', 'lowshelf', 'peaking', 'highshelf'])
  assert.deepEqual(filters.map(node => node.frequency.value), [80, 120, 1000, 5000])
  assert.ok(Math.abs(filters[0].Q.value + 3.0102999566) < 1e-8)
  assert.deepEqual(filters.slice(1).map(node => node.gain.value), [6, -3, 2])
  assert.notEqual(chain.input, chain.output)
  assert.ok(context.nodes.every(node => node.channelCountMode === undefined), 'do not force/downmix channels')
})

test('live changes smooth only changed parameters without rebuilding or rescheduling identical values', () => {
  const context = fakeContext()
  const chain = createAudioEqChain(context, DEFAULT_AUDIO_EQ)
  const count = context.nodes.length
  const bass = context.nodes.find(node => node.type === 'lowshelf')
  chain.update({ ...DEFAULT_AUDIO_EQ, bassDb: 8 })
  assert.deepEqual(bass.gain.events.slice(-2), [['cancel', 2], ['target', 8, 2, 0.01]])
  const events = bass.gain.events.length
  chain.update({ ...DEFAULT_AUDIO_EQ, bassDb: 8 })
  assert.equal(bass.gain.events.length, events)
  assert.equal(context.nodes.length, count)
  chain.update({ ...DEFAULT_AUDIO_EQ, enabled: false, bassDb: 8 })
  assert.equal(bass.gain.value, 8, 'bypass retains filter settings')
  assert.equal(context.nodes.length, count)
})

test('malformed data restores flat; disposing disconnects every node once and blocks updates', () => {
  const context = fakeContext()
  const chain = createAudioEqChain(context, { ...DEFAULT_AUDIO_EQ, trebleDb: 12 })
  const treble = context.nodes.find(node => node.type === 'highshelf')
  chain.update({ trebleDb: 'bad' })
  assert.equal(treble.gain.value, 0)
  chain.dispose(); chain.dispose()
  assert.ok(context.nodes.every(node => node.disconnects === 1))
  const before = treble.gain.events.length
  chain.update({ ...DEFAULT_AUDIO_EQ, trebleDb: 10 })
  assert.equal(treble.gain.events.length, before)
})
