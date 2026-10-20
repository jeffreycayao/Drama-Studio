'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { SLICE_FRAMES, createWaveformAccumulator, createWaveformCache } = require('../electron/audioWaveformPeaks.cjs')

// The whole-file computation the main process used before streaming.
function wholeFilePeaks(samples, bucketCount) {
  const frameCount = samples.length / 2
  const bucketSize = Math.max(1, Math.floor(frameCount / bucketCount))
  const peaksLeft = [], peaksRight = [], rms = []
  for (let i = 0; i < bucketCount; i += 1) {
    const start = i * bucketSize
    const end = i === bucketCount - 1 ? frameCount : Math.min(frameCount, start + bucketSize)
    let peakL = 0, peakR = 0, energyL = 0, energyR = 0
    for (let frame = start; frame < end; frame += 1) {
      const left = samples[frame * 2], right = samples[frame * 2 + 1]
      peakL = Math.max(peakL, Math.abs(left))
      peakR = Math.max(peakR, Math.abs(right))
      energyL += left * left
      energyR += right * right
    }
    rms.push(end > start ? Math.min(1, Math.sqrt(Math.max(energyL, energyR) / (end - start))) : 0)
    peaksLeft.push(Math.min(1, peakL))
    peaksRight.push(Math.min(1, peakR))
  }
  return { peaks: peaksLeft.map((v, i) => Math.max(v, peaksRight[i])), channelPeaks: [peaksLeft, peaksRight], rms }
}

function stereoSignal(frames) {
  const samples = new Float32Array(frames * 2)
  for (let f = 0; f < frames; f += 1) {
    samples[f * 2] = Math.sin(f / 7) * (f % 997) / 997
    samples[f * 2 + 1] = Math.cos(f / 3) * 0.5
  }
  return samples
}

// ffmpeg's pipe splits wherever it likes, including inside a sample.
function feed(accumulator, samples, chunkBytes) {
  const bytes = Buffer.from(samples.buffer)
  for (let at = 0; at < bytes.length; at += chunkBytes) accumulator.push(bytes.subarray(at, at + chunkBytes))
}

test('short audio gives exactly the old whole-file result, however the pipe splits it', () => {
  const samples = stereoSignal(10007)
  const expected = wholeFilePeaks(samples, 128)
  for (const chunkBytes of [1, 7, 1000, 65536]) {
    const accumulator = createWaveformAccumulator()
    feed(accumulator, samples, chunkBytes)
    const result = accumulator.finish({ bucketCount: 128, includeRms: true })
    assert.equal(result.frameCount, 10007)
    assert.deepEqual(result.peaks, expected.peaks)
    assert.deepEqual(result.channelPeaks, expected.channelPeaks)
    assert.deepEqual(result.rms, expected.rms)
  }
})

test('long audio is folded into slices and stays within one slice of the exact result', () => {
  const frames = 50000 + 13
  const samples = stereoSignal(frames)
  samples[(31234 * 2) + 1] = -0.99 // one loud click on the right channel
  const accumulator = createWaveformAccumulator({ rawFrameLimit: 4096 })
  feed(accumulator, samples, 4093)
  const result = accumulator.finish({ bucketCount: 256, includeRms: true })
  const expected = wholeFilePeaks(samples, 256)
  assert.equal(result.frameCount, frames)
  const bucketSize = Math.floor(frames / 256)
  const clickBucket = Math.floor(31234 / bucketSize)
  assert.ok(Math.abs(result.channelPeaks[1].indexOf(Math.fround(0.99)) - clickBucket) <= 1)
  // Edges move by under a slice: a bucket's peak is never above its
  // neighbours' exact peaks and never below the peak of its own middle.
  const peakOf = (from, to) => {
    let peak = 0
    for (let f = Math.max(0, from); f < Math.min(frames, to); f += 1) peak = Math.max(peak, Math.abs(samples[f * 2]), Math.abs(samples[f * 2 + 1]))
    return peak
  }
  for (let b = 0; b < 256; b += 1) {
    const start = b * bucketSize
    const end = b === 255 ? frames : start + bucketSize
    assert.ok(result.peaks[b] <= Math.max(...[b - 1, b, b + 1].filter((i) => i >= 0 && i < 256).map((i) => expected.peaks[i])) + 1e-6, `bucket ${b} too high`)
    assert.ok(result.peaks[b] >= peakOf(start + SLICE_FRAMES, end - SLICE_FRAMES) - 1e-6, `bucket ${b} too low`)
    assert.ok(Math.abs(expected.rms[b] - result.rms[b]) < 0.1, `bucket ${b} rms`)
  }
  assert.ok(bucketSize >= SLICE_FRAMES)
})

test('no audio decoded gives null', () => {
  const accumulator = createWaveformAccumulator()
  accumulator.push(Buffer.alloc(5))
  assert.equal(accumulator.finish({ bucketCount: 128 }), null)
})

test('the waveform cache keeps only the most recently used entries', () => {
  const cache = createWaveformCache(2)
  cache.set('a', 1)
  cache.set('b', 2)
  assert.equal(cache.get('a'), 1)
  cache.set('c', 3)
  assert.equal(cache.get('b'), undefined)
  assert.equal(cache.get('a'), 1)
  assert.equal(cache.get('c'), 3)
  assert.equal(cache.size, 2)
})
