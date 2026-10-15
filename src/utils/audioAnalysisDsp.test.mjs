import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeAudioBuffer } from './audioAnalysisDsp.mjs'

function audioBuffer(channels, sampleRate = 24000) {
  return { sampleRate, numberOfChannels: channels.length, length: channels[0].length,
    duration: channels[0].length / sampleRate, getChannelData: channel => channels[channel] }
}
function pulseTrain(bpm, duration = 12, sampleRate = 24000) {
  const samples = new Float32Array(duration * sampleRate)
  for (let time = 0.25; time < duration; time += 60 / bpm) {
    const start = Math.round(time * sampleRate)
    for (let i = 0; i < 0.08 * sampleRate && start + i < samples.length; i++) {
      const t = i / sampleRate
      samples[start + i] = Math.exp(-t * 65) * (0.75 * Math.sin(2 * Math.PI * 80 * t) + 0.25 * Math.sin(2 * Math.PI * 2000 * t))
    }
  }
  return audioBuffer([samples], sampleRate)
}

test('decoder-independent DSP recovers generated 120 BPM without any browser globals', () => {
  const result = analyzeAudioBuffer(pulseTrain(120))
  assert.ok(Math.abs(result.bpm - 120) < 1, 'Recovered BPM: ' + result.bpm)
  assert.ok(result.beatConfidence > 0.4)
  assert.ok(result.beats.length >= 22)
  assert.ok(result.onsets.length >= 20)
  assert.equal(result.sampleRate, 24000)
  assert.equal(result.channels, 1)
  assert.equal(result.duration, 12)
  assert.ok(Number.isFinite(result.loudness.integratedLufsApprox))
})

test('source buffer trims preserve range-relative beats and do not mutate PCM', () => {
  const buffer = pulseTrain(120, 18)
  const before = buffer.getChannelData(0).slice()
  const result = analyzeAudioBuffer(buffer, { startSeconds: 6, endSeconds: 18, includeLoudnessCurve: false })
  assert.equal(result.duration, 12)
  assert.ok(Math.abs(result.bpm - 120) < 1)
  assert.ok(result.beats.every(time => time >= 0 && time <= 12))
  assert.ok(result.beats[0] < 0.6)
  assert.equal('loudnessCurve' in result, false)
  assert.deepEqual(buffer.getChannelData(0), before)
})

test('silence/loudness summary and bounded curves preserve existing result fields', () => {
  const samples = new Float32Array(24000 * 4)
  for (let i = 24000; i < 24000 * 3; i++) samples[i] = 0.25 * Math.sin(2 * Math.PI * 1000 * i / 24000)
  const result = analyzeAudioBuffer(audioBuffer([samples, samples]), { maxCurvePoints: 20 })
  assert.deepEqual(result.silences, [{ start: 0, end: 1, duration: 1 }, { start: 3, end: 4, duration: 1 }])
  assert.equal(result.channels, 2)
  assert.equal(result.loudness.peakDb, -12)
  assert.equal(result.loudnessCurve.length, 20)
  assert.equal(result.beatsTruncated, false)
  assert.equal(result.onsetsTruncated, false)
})

test('silent or too-short sources return useful results without manufacturing beats', () => {
  const silent = analyzeAudioBuffer(audioBuffer([new Float32Array(24000)]))
  assert.equal(silent.bpm, null)
  assert.deepEqual(silent.beats, [])
  assert.equal(silent.loudness.integratedLufsApprox, null)
  const short = analyzeAudioBuffer(audioBuffer([new Float32Array(2400)]))
  assert.equal(short.duration, 0.1)
  assert.match(short.error, /too short/)
})
