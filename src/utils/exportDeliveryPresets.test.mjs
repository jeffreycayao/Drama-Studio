import test from 'node:test'
import assert from 'node:assert/strict'
import { DELIVERY_PRESETS, resolveDeliveryPresetSettings, resolveDeliveryResolution } from './exportDeliveryPresets.mjs'

test('five distinct recommendations expose stable IDs and accurate descriptions', () => {
  assert.deepEqual(DELIVERY_PRESETS.map((preset) => preset.id), [
    'youtube-1080p', 'youtube-4k', 'h264-master', 'prores-master', 'review-copy',
  ])
  for (const preset of DELIVERY_PRESETS) {
    assert.ok(preset.label)
    assert.ok(preset.summary)
    assert.ok(Object.isFrozen(preset))
    assert.ok(Object.isFrozen(preset.settings))
    assert.doesNotMatch(preset.summary, /lossless|archival|10.bit/i)
  }
  assert.match(DELIVERY_PRESETS[0].summary, /never enlarges/)
  assert.match(DELIVERY_PRESETS[1].summary, /never enlarges/)
  assert.match(DELIVERY_PRESETS[3].summary, /Large, editing-friendly/)
})

test('all recommendations explicitly reset common delivery choices, not filename or range', () => {
  for (const preset of DELIVERY_PRESETS) {
    const settings = resolveDeliveryPresetSettings(preset, { width: 1920, height: 1080, fps: 28 })
    assert.equal(settings.audioCodec, 'aac')
    assert.equal(settings.useHardwareEncoder, false)
    assert.equal(settings.fps, 'project')
    assert.equal(settings.includeAudio, true)
    assert.equal(settings.audioSampleRate, 48000)
    assert.equal(settings.audioChannels, 2)
    assert.equal(settings.normalizeAudio, false)
    assert.equal(settings.keyframeMode, 'auto')
    assert.equal(settings.useDirectFramePipe, true)
    assert.equal(settings.postProcessUpscale, 'none')
    assert.equal(settings.transparent, false)
    assert.equal(settings.audioBitrateKbps, preset.id === 'review-copy' ? 160 : 320)
    assert.equal(settings.useProxyMedia, preset.id === 'review-copy')
    assert.equal(settings.preset, preset.id === 'review-copy' ? 'veryfast' : 'medium')
    for (const field of ['filename', 'range', 'width', 'height', 'timeline', 'currentProject']) {
      assert.equal(field in settings, false, `${preset.id} must not author ${field}`)
    }
  }
})

test('master and review presets carry their specified codec, quality, and resolution choices', () => {
  const h264 = resolveDeliveryPresetSettings('h264-master')
  assert.equal(h264.format, 'mp4')
  assert.equal(h264.videoCodec, 'h264')
  assert.equal(h264.qualityMode, 'crf')
  assert.equal(h264.crf, 16)
  assert.equal(h264.resolution, 'project')
  const prores = resolveDeliveryPresetSettings('prores-master')
  assert.equal(prores.format, 'prores')
  assert.equal(prores.videoCodec, 'prores')
  assert.equal(prores.proresProfile, '3')
  assert.equal(prores.resolution, 'project')
  const review = resolveDeliveryPresetSettings('review-copy')
  assert.equal(review.format, 'mp4')
  assert.equal(review.videoCodec, 'h264')
  assert.equal(review.qualityMode, 'crf')
  assert.equal(review.crf, 24)
  assert.equal(review.resolution, 'timeline-half')
})

test('only the new resolution modes are resolved', () => {
  for (const mode of [undefined, null, '', 'project', 'timeline-half', 'custom', 'youtube-4k']) {
    assert.equal(resolveDeliveryResolution(mode, { width: 1920, height: 1080, fps: 24 }), null)
  }
  for (const preset of [null, undefined, '', 'unknown', {}, { settings: null }, { settings: [] }]) {
    assert.equal(resolveDeliveryPresetSettings(preset), null)
  }
})

test('landscape HD and UHD fit their caps without enlarging smaller timelines', () => {
  assert.deepEqual(resolveDeliveryResolution('youtube-hd', { width: 3840, height: 2160, fps: 28 }),
    { width: 1920, height: 1080, fps: 28 })
  assert.deepEqual(resolveDeliveryResolution('youtube-uhd', { width: 7680, height: 4320, fps: 60 }),
    { width: 3840, height: 2160, fps: 60 })
  for (const mode of ['youtube-hd', 'youtube-uhd']) {
    assert.deepEqual(resolveDeliveryResolution(mode, { width: 1280, height: 720, fps: 28 }),
      { width: 1280, height: 720, fps: 28 })
  }
})

test('portrait swaps the HD and UHD bounds instead of stretching into landscape', () => {
  assert.deepEqual(resolveDeliveryResolution('youtube-hd', { width: 2160, height: 3840, fps: 30 }),
    { width: 1080, height: 1920, fps: 30 })
  assert.deepEqual(resolveDeliveryResolution('youtube-uhd', { width: 4320, height: 7680, fps: 60 }),
    { width: 2160, height: 3840, fps: 60 })
  assert.deepEqual(resolveDeliveryResolution('youtube-uhd', { width: 720, height: 1280, fps: 24 }),
    { width: 720, height: 1280, fps: 24 })
})

test('square and ultrawide timelines fit without cropping or stretching', () => {
  assert.deepEqual(resolveDeliveryResolution('youtube-hd', { width: 4096, height: 4096, fps: 24 }),
    { width: 1080, height: 1080, fps: 24 })
  assert.deepEqual(resolveDeliveryResolution('youtube-uhd', { width: 4096, height: 4096, fps: 24 }),
    { width: 2160, height: 2160, fps: 24 })
  assert.deepEqual(resolveDeliveryResolution('youtube-hd', { width: 5120, height: 2160, fps: 24 }),
    { width: 1920, height: 810, fps: 24 })
  assert.deepEqual(resolveDeliveryResolution('youtube-uhd', { width: 5120, height: 2160, fps: 24 }),
    { width: 3840, height: 1620, fps: 24 })
})

test('odd dimensions round down to even source bounds rather than upscaling a pixel', () => {
  for (const mode of ['youtube-hd', 'youtube-uhd']) {
    assert.deepEqual(resolveDeliveryResolution(mode, { width: 1281, height: 721, fps: 24 }),
      { width: 1280, height: 720, fps: 24 })
    assert.deepEqual(resolveDeliveryResolution(mode, { width: 3, height: 3, fps: 24 }),
      { width: 2, height: 2, fps: 24 })
  }
  assert.deepEqual(resolveDeliveryResolution('youtube-uhd', { width: 3841, height: 2161, fps: 24 }),
    { width: 3840, height: 2160, fps: 24 })
})

test('invalid timeline sizes and FPS fall back safely without non-finite output', () => {
  for (const timeline of [undefined, null, {}, false, [], { width: 0, height: 0 }, { width: 1, height: 1 },
    { width: NaN, height: 1080 }, { width: Infinity, height: 1080 }, { width: 1920, height: -1 },
    { width: '1920', height: '1080' }]) {
    assert.deepEqual(resolveDeliveryResolution('youtube-hd', timeline), { width: 1920, height: 1080, fps: 24 })
  }
  for (const fps of [0, -1, NaN, Infinity, null, '60']) {
    assert.deepEqual(resolveDeliveryResolution('youtube-hd', { width: 1280, height: 720, fps }),
      { width: 1280, height: 720, fps: 24 })
  }
})

test('fractional and unusual project frame rates are preserved exactly', () => {
  for (const fps of [23.976, 24000 / 1001, 28, 29.97, 30000 / 1001, 30, 60000 / 1001, 120]) {
    assert.equal(resolveDeliveryResolution('youtube-hd', { width: 1920, height: 1080, fps }).fps, fps)
    assert.equal(resolveDeliveryResolution('youtube-uhd', { width: 3840, height: 2160, fps }).fps, fps)
    assert.equal(resolveDeliveryPresetSettings('youtube-1080p', { width: 1920, height: 1080, fps }).fps, 'project')
  }
})

test('YouTube bitrates follow every actual-size tier, including 28fps and fractional high rates', () => {
  const tiers = [
    [640, 360, 1000, 1500], [854, 480, 2500, 4000], [1280, 720, 5000, 7500],
    [1920, 1080, 8000, 12000], [2560, 1440, 16000, 24000], [3840, 2160, 45000, 68000],
  ]
  for (const [width, height, normal, high] of tiers) {
    for (const fps of [24, 28, 30000 / 1001, 30, 30.001, 60000 / 1001, 120]) {
      const settings = resolveDeliveryPresetSettings('youtube-4k', { width, height, fps })
      assert.equal(settings.bitrateKbps, fps > 30 ? high : normal, `${width}×${height} @ ${fps}`)
      assert.equal(settings.qualityMode, 'bitrate')
      assert.equal(settings.resolution, 'youtube-uhd')
      assert.equal(resolveDeliveryPresetSettings('youtube-4k', { width: height, height: width, fps }).bitrateKbps,
        settings.bitrateKbps, 'portrait uses the same size tier')
    }
  }
})

test('YouTube 4K on HD remains HD bitrate and the HD cap reduces a UHD bitrate', () => {
  assert.equal(resolveDeliveryPresetSettings('youtube-4k', { width: 1920, height: 1080, fps: 28 }).bitrateKbps, 8000)
  assert.equal(resolveDeliveryPresetSettings('youtube-4k', { width: 1920, height: 1080, fps: 60 }).bitrateKbps, 12000)
  assert.equal(resolveDeliveryPresetSettings('youtube-1080p', { width: 3840, height: 2160, fps: 28 }).bitrateKbps, 8000)
  assert.equal(resolveDeliveryPresetSettings('youtube-1080p', { width: 3840, height: 2160, fps: 60 }).bitrateKbps, 12000)
})

test('materializing presets never mutates definitions, timeline, or existing legacy choices', () => {
  const timeline = Object.freeze({ width: 3840, height: 2160, fps: 60000 / 1001, name: 'Untouched' })
  const snapshot = structuredClone(DELIVERY_PRESETS)
  for (const preset of DELIVERY_PRESETS) {
    const first = resolveDeliveryPresetSettings(preset, timeline)
    const second = resolveDeliveryPresetSettings(preset.id, timeline)
    assert.notEqual(first, preset.settings)
    assert.notEqual(first, second)
    assert.deepEqual(first, second)
    first.audioChannels = 1
  }
  assert.deepEqual(DELIVERY_PRESETS, snapshot)
  assert.deepEqual(timeline, { width: 3840, height: 2160, fps: 60000 / 1001, name: 'Untouched' })
  const legacy = Object.freeze({ id: 'old-custom', settings: Object.freeze({ resolution: 'project', useHardwareEncoder: true, crf: 21 }) })
  assert.deepEqual(resolveDeliveryPresetSettings(legacy, timeline), legacy.settings)
  assert.notEqual(resolveDeliveryPresetSettings(legacy, timeline), legacy.settings)
})

test('fit results remain finite, positive, even, and no larger than a valid source', () => {
  for (const mode of ['youtube-hd', 'youtube-uhd']) {
    for (const [width, height] of [[2, 2], [3, 7], [321, 241], [854, 480], [1919, 1079],
      [1921, 1081], [2161, 3841], [3840, 2160], [7680, 4320], [100000, 1000], [1000, 100000]]) {
      const output = resolveDeliveryResolution(mode, { width, height, fps: 28 })
      assert.ok(Number.isFinite(output.width) && Number.isFinite(output.height))
      assert.ok(output.width >= 2 && output.height >= 2)
      assert.equal(output.width % 2, 0)
      assert.equal(output.height % 2, 0)
      assert.ok(output.width <= width && output.height <= height)
      const normalizedWidth = Math.floor(width / 2) * 2
      const normalizedHeight = Math.floor(height / 2) * 2
      const longCap = mode === 'youtube-uhd' ? 3840 : 1920
      const shortCap = mode === 'youtube-uhd' ? 2160 : 1080
      const portrait = normalizedHeight > normalizedWidth
      const nominalScale = Math.min(1, (portrait ? shortCap : longCap) / normalizedWidth,
        (portrait ? longCap : shortCap) / normalizedHeight)
      // Independent even rounding can remove less than two pixels per axis.
      assert.ok(Math.abs(output.width - normalizedWidth * nominalScale) < 2.01)
      assert.ok(Math.abs(output.height - normalizedHeight * nominalScale) < 2.01)
    }
  }
})
