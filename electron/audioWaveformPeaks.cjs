'use strict'

/**
 * Timeline waveform peaks, worked out while ffmpeg streams the decoded audio
 * (interleaved stereo f32le: L R L R ...), so a long file never sits in
 * memory whole.
 *
 * Short audio (up to RAW_FRAME_LIMIT frames, about 9 minutes at 8 kHz) is
 * kept and measured exactly. Past that, every SLICE_FRAMES frames are folded
 * into one slice (peak and energy per channel) and the raw sound is dropped:
 * an hour at 8 kHz then needs about 15 MB instead of 460 MB. A slice goes to
 * the bucket its first frame falls in; buckets are then at least 4 slices
 * wide, so an edge moves by under one slice (4 ms at 8 kHz).
 */

const RAW_FRAME_LIMIT = 4 * 1024 * 1024
const SLICE_FRAMES = 32
const BYTES_PER_FRAME = 8

function createWaveformAccumulator({ rawFrameLimit = RAW_FRAME_LIMIT } = {}) {
  let leftover = Buffer.alloc(0)
  let frameCount = 0
  let raw = []
  // Slice mode: growable arrays plus the slice being filled.
  let slices = null
  let sliceCount = 0
  let pl = 0, pr = 0, el = 0, er = 0, inSlice = 0

  const grow = () => {
    for (const key of Object.keys(slices)) {
      const bigger = new Float32Array(slices[key].length * 2)
      bigger.set(slices[key])
      slices[key] = bigger
    }
  }
  const closeSlice = () => {
    if (sliceCount === slices.peakL.length) grow()
    slices.peakL[sliceCount] = pl
    slices.peakR[sliceCount] = pr
    slices.energyL[sliceCount] = el
    slices.energyR[sliceCount] = er
    sliceCount += 1
    pl = pr = el = er = inSlice = 0
  }
  const addToSlices = (samples) => {
    for (let i = 0; i < samples.length; i += 2) {
      const left = samples[i]
      const right = samples[i + 1]
      const ampL = Math.abs(left)
      const ampR = Math.abs(right)
      if (ampL > pl) pl = ampL
      if (ampR > pr) pr = ampR
      el += left * left
      er += right * right
      inSlice += 1
      if (inSlice === SLICE_FRAMES) closeSlice()
    }
  }

  function push(chunk) {
    const bytes = leftover.length ? Buffer.concat([leftover, chunk]) : chunk
    const whole = bytes.length - (bytes.length % BYTES_PER_FRAME)
    leftover = Buffer.from(bytes.subarray(whole))
    if (whole === 0) return
    // Copy into a fresh Float32Array: a Buffer's offset is not always a multiple of 4.
    const samples = new Float32Array(whole / 4)
    Buffer.from(samples.buffer).set(bytes.subarray(0, whole))
    frameCount += whole / BYTES_PER_FRAME
    if (slices) { addToSlices(samples); return }
    raw.push(samples)
    if (frameCount > rawFrameLimit) {
      const size = Math.ceil(frameCount / SLICE_FRAMES) * 2
      slices = { peakL: new Float32Array(size), peakR: new Float32Array(size), energyL: new Float32Array(size), energyR: new Float32Array(size) }
      for (const part of raw) addToSlices(part)
      raw = null
    }
  }

  /** Per-bucket peaks (and RMS when asked); null when no audio was decoded. */
  function finish({ bucketCount, includeRms = false }) {
    if (frameCount <= 0) return null
    const bucketSize = Math.max(1, Math.floor(frameCount / bucketCount))
    const peaksLeft = new Array(bucketCount).fill(0)
    const peaksRight = new Array(bucketCount).fill(0)
    const energyLeft = new Array(bucketCount).fill(0)
    const energyRight = new Array(bucketCount).fill(0)
    const framesIn = new Array(bucketCount).fill(0)
    const last = bucketCount - 1

    if (slices) {
      const lastSliceFrames = inSlice || SLICE_FRAMES
      if (inSlice > 0) closeSlice()
      for (let s = 0; s < sliceCount; s += 1) {
        const b = Math.min(last, Math.floor((s * SLICE_FRAMES) / bucketSize))
        if (slices.peakL[s] > peaksLeft[b]) peaksLeft[b] = slices.peakL[s]
        if (slices.peakR[s] > peaksRight[b]) peaksRight[b] = slices.peakR[s]
        energyLeft[b] += slices.energyL[s]
        energyRight[b] += slices.energyR[s]
        framesIn[b] += s === sliceCount - 1 ? lastSliceFrames : SLICE_FRAMES
      }
    } else {
      let frame = 0
      for (const part of raw) {
        for (let i = 0; i < part.length; i += 2, frame += 1) {
          const b = Math.min(last, Math.floor(frame / bucketSize))
          const left = part[i]
          const right = part[i + 1]
          const ampL = Math.abs(left)
          const ampR = Math.abs(right)
          if (ampL > peaksLeft[b]) peaksLeft[b] = ampL
          if (ampR > peaksRight[b]) peaksRight[b] = ampR
          energyLeft[b] += left * left
          energyRight[b] += right * right
          framesIn[b] += 1
        }
      }
    }

    // True levels (clamped to full scale), no per-file normalization, so
    // quiet material reads quiet.
    for (let b = 0; b < bucketCount; b += 1) {
      peaksLeft[b] = Math.min(1, peaksLeft[b])
      peaksRight[b] = Math.min(1, peaksRight[b])
    }
    const result = {
      peaks: peaksLeft.map((value, b) => Math.max(value, peaksRight[b])),
      channelPeaks: [peaksLeft, peaksRight],
      frameCount,
    }
    if (includeRms) {
      result.rms = framesIn.map((frames, b) => (frames > 0
        ? Math.min(1, Math.sqrt(Math.max(energyLeft[b], energyRight[b]) / frames))
        : 0))
    }
    return result
  }

  return { push, finish }
}

/** Small most-recently-used cache: a long session no longer keeps every waveform. */
function createWaveformCache(limit = 64) {
  const entries = new Map()
  return {
    get(key) {
      if (!entries.has(key)) return undefined
      const value = entries.get(key)
      entries.delete(key)
      entries.set(key, value)
      return value
    },
    set(key, value) {
      entries.delete(key)
      entries.set(key, value)
      while (entries.size > limit) entries.delete(entries.keys().next().value)
    },
    get size() { return entries.size },
  }
}

module.exports = { RAW_FRAME_LIMIT, SLICE_FRAMES, createWaveformAccumulator, createWaveformCache }
