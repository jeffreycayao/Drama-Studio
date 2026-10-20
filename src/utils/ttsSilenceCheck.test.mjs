import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_TTS_DECODE_BYTES,
  SILENT_TTS_ERROR_CODE,
  classifyTtsAudio,
  createSilentTtsError,
  measureTtsAudioBlob,
  peakDbfsFromChannels,
} from './ttsSilenceCheck.mjs'

const fromDb = (db) => 10 ** (db / 20)

function fakeBlob(size) {
  return { size, arrayBuffer: async () => new ArrayBuffer(Math.min(size, 8)) }
}

function fakeContext(buffer, calls = {}) {
  return () => ({
    async decodeAudioData() {
      calls.decoded = (calls.decoded || 0) + 1
      if (buffer instanceof Error) throw buffer
      return buffer
    },
    async close() { calls.closed = (calls.closed || 0) + 1 },
  })
}

function audioBuffer(duration, channels) {
  return { duration, numberOfChannels: channels.length, getChannelData: (c) => channels[c] }
}

test('peak level is measured across every channel', () => {
  const left = new Float32Array([0, 0.001, -0.002])
  const right = new Float32Array([0, -0.5, 0.25])
  assert.ok(Math.abs(peakDbfsFromChannels([left, right]) - 20 * Math.log10(0.5)) < 1e-6)
  assert.equal(peakDbfsFromChannels([new Float32Array(4)]), -Infinity)
  assert.equal(peakDbfsFromChannels([]), -Infinity)
})

test('the live-test failure (1.0 s at -91 dBFS) is classified as silent', () => {
  assert.deepEqual(classifyTtsAudio({ durationSec: 1.0, peakDbfs: -91 }), { silent: true, reason: 'silent' })
  assert.deepEqual(classifyTtsAudio({ durationSec: 1.0, peakDbfs: -Infinity }), { silent: true, reason: 'silent' })
})

test('empty or near-empty clips are classified as empty', () => {
  assert.equal(classifyTtsAudio({ durationSec: 0, peakDbfs: -3 }).reason, 'empty')
  assert.equal(classifyTtsAudio({ durationSec: 0.01, peakDbfs: -3 }).reason, 'empty')
  assert.equal(classifyTtsAudio({}).reason, 'empty')
})

test('normal speech, including short and quiet lines, is not flagged', () => {
  // Durations from the same live test's good lines.
  for (const durationSec of [3.1, 0.86, 3.42]) {
    assert.equal(classifyTtsAudio({ durationSec, peakDbfs: -2 }).silent, false)
  }
  assert.equal(classifyTtsAudio({ durationSec: 0.4, peakDbfs: -35 }).silent, false)
  assert.equal(classifyTtsAudio({ durationSec: 2, peakDbfs: -60 }).silent, false)
})

test('the failure error is readable and tagged', () => {
  const err = createSilentTtsError({ engineLabel: 'Qwen3 TTS', durationSec: 1, peakDbfs: -91.4 })
  assert.equal(err.code, SILENT_TTS_ERROR_CODE)
  assert.match(err.message, /^Qwen3 TTS returned silence instead of speech \(1\.0 s, peak -91 dBFS\)/)
  assert.match(err.message, /retry this line/)
  assert.match(createSilentTtsError({ durationSec: 0, peakDbfs: -Infinity }).message, /\(0\.0 s, no signal\)/)
  const cloud = createSilentTtsError({ engineLabel: 'ElevenLabs', durationSec: 1, peakDbfs: -80, local: false })
  assert.doesNotMatch(cloud.message, /GPU/)
  assert.match(cloud.message, /Retry this line\.$/)
})

test('measuring a decoded clip returns duration and peak', async () => {
  const calls = {}
  const samples = new Float32Array(24000).fill(fromDb(-91))
  const result = await measureTtsAudioBlob(fakeBlob(4000), { createContext: fakeContext(audioBuffer(1, [samples]), calls) })
  assert.equal(result.durationSec, 1)
  assert.ok(Math.abs(result.peakDbfs - -91) < 0.01)
  assert.equal(classifyTtsAudio(result).silent, true)
  assert.equal(calls.closed, 1)
})

test('clips that cannot be checked return null so they import as before', async () => {
  const calls = {}
  const ok = fakeContext(audioBuffer(1, [new Float32Array(10)]), calls)
  assert.equal(await measureTtsAudioBlob(fakeBlob(MAX_TTS_DECODE_BYTES + 1), { createContext: ok }), null)
  assert.equal(calls.decoded, undefined, 'large clips are not decoded')
  assert.equal(await measureTtsAudioBlob(fakeBlob(100), { createContext: fakeContext(new Error('bad')) }), null)
  assert.equal(await measureTtsAudioBlob(fakeBlob(100), {}), null)
  assert.equal(await measureTtsAudioBlob(null, { createContext: ok }), null)
})

test('a zero-byte clip is measured as empty without decoding', async () => {
  const result = await measureTtsAudioBlob(fakeBlob(0), { createContext: () => { throw new Error('not called') } })
  assert.equal(classifyTtsAudio(result).reason, 'empty')
})
