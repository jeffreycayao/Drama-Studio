import test from 'node:test'
import assert from 'node:assert/strict'
import { PANEL_WIDTHS_STORAGE_KEY, resolveExportPanelLayout, sanitizeExportPanelWidths } from './exportPanelLayout.mjs'

const approximately = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≈ ${expected}`)

test('width preferences have an isolated stable storage key', () => {
  assert.equal(PANEL_WIDTHS_STORAGE_KEY, 'velorn-export-panel-widths-v1')
})

test('missing or malformed preferences select responsive defaults', () => {
  for (const value of [undefined, null, false, true, 340, '340', [], [300, 240], '{broken', {}]) {
    assert.deepEqual(sanitizeExportPanelWidths(value), { settings: null, queue: null })
  }
  for (const value of [NaN, Infinity, -Infinity, '300', '', false, null, {}, []]) {
    assert.deepEqual(sanitizeExportPanelWidths({ settings: value, queue: value }), { settings: null, queue: null })
  }
})

test('valid finite preferences clamp independently to global bounds without mutation', () => {
  const original = Object.freeze({ settings: 700, queue: -20, other: 1 })
  assert.deepEqual(sanitizeExportPanelWidths(original), { settings: 520, queue: 180 })
  assert.deepEqual(sanitizeExportPanelWidths({ settings: -1, queue: 900 }), { settings: 220, queue: 480 })
  assert.deepEqual(sanitizeExportPanelWidths({ settings: 310.5, queue: 255.25 }), { settings: 310.5, queue: 255.25 })
  assert.deepEqual(sanitizeExportPanelWidths({ settings: 300, queue: '240' }), { settings: 300, queue: null })
  assert.deepEqual(original, { settings: 700, queue: -20, other: 1 })
})

test('invalid or unmeasured containers have safe zero sizes and no handles', () => {
  for (const width of [undefined, null, false, '1200', NaN, Infinity, -Infinity, -1, 0]) {
    assert.deepEqual(resolveExportPanelLayout(width, true, { settings: 520, queue: 480 }), {
      settingsWidth: 0, queueWidth: 0,
      settingsMin: 0, settingsMax: 0, queueMin: 0, queueMax: 0,
      resizeSettings: false, resizeQueue: false,
    })
  }
})

test('responsive default boundaries match existing layout breakpoints', () => {
  for (const [width, settings, queue] of [[801, 238, 192], [1090, 238, 192], [1091, 272, 230],
    [1599, 272, 230], [1600, 296, 258], [1920, 296, 258]]) {
    const result = resolveExportPanelLayout(width, true)
    assert.equal(result.settingsWidth, settings, `settings at ${width}`)
    assert.equal(result.queueWidth, queue, `queue at ${width}`)
    assert.equal(result.resizeSettings, true)
    assert.equal(result.resizeQueue, true)
  }
})

test('stacked containers ignore preferences and disable both handles', () => {
  for (const width of [1, 320, 559, 560]) {
    const result = resolveExportPanelLayout(width, true, { settings: 400, queue: 300 })
    assert.equal(result.settingsWidth, width)
    assert.equal(result.queueWidth, width)
    assert.equal(result.settingsMin, width)
    assert.equal(result.settingsMax, width)
    assert.equal(result.queueMin, width)
    assert.equal(result.queueMax, width)
    assert.equal(result.resizeSettings, false)
    assert.equal(result.resizeQueue, false)
    assert.equal(resolveExportPanelLayout(width, false).queueWidth, 0)
  }
})

test('medium containers keep a 280px preview and put the queue in its own row', () => {
  for (const width of [561, 650, 800]) {
    const defaults = resolveExportPanelLayout(width, true)
    assert.equal(defaults.settingsWidth, 225)
    assert.equal(defaults.queueWidth, width)
    assert.equal(defaults.resizeSettings, true)
    assert.equal(defaults.resizeQueue, false)
    const custom = resolveExportPanelLayout(width, true, { settings: 520, queue: 480 })
    assert.equal(custom.settingsWidth, width - 280 - 6)
    assert.equal(custom.settingsMax, width - 280 - 6)
    assert.equal(custom.queueWidth, width)
    assert.equal(custom.queueMin, width)
    assert.equal(custom.queueMax, width)
    assert.equal(resolveExportPanelLayout(width, false).queueWidth, 0)
  }
})

test('over-budget sidebars shrink their excess proportionally, preserving both minima', () => {
  const result = resolveExportPanelLayout(900, true, { settings: 520, queue: 480 })
  // 900 - 320 preview - 12 handles = 568px; 168px remains above the 400px minima.
  assert.equal(result.settingsWidth, 304)
  assert.equal(result.queueWidth, 264)
  assert.equal(result.settingsWidth + result.queueWidth + 12 + 320, 900)
  const unequal = resolveExportPanelLayout(900, true, { settings: 520, queue: 280 })
  approximately(unequal.settingsWidth, 220 + 168 * 0.75)
  approximately(unequal.queueWidth, 180 + 168 * 0.25)
})

test('a sidebar already at minimum is not reduced or forced to grow when its peer shrinks', () => {
  const result = resolveExportPanelLayout(801, true, { settings: 520, queue: 180 })
  assert.equal(result.queueWidth, 180)
  assert.equal(result.settingsWidth, 801 - 320 - 12 - 180)
  const reverse = resolveExportPanelLayout(801, true, { settings: 220, queue: 480 })
  assert.equal(reverse.settingsWidth, 220)
  assert.equal(reverse.queueWidth, 801 - 320 - 12 - 220)
})

test('closed queue consumes neither width nor divider and frees the settings budget', () => {
  const result = resolveExportPanelLayout(801, false, { settings: 520, queue: 480 })
  assert.equal(result.settingsWidth, 475)
  assert.equal(result.settingsMax, 475)
  assert.equal(result.queueWidth, 0)
  assert.equal(result.queueMin, 0)
  assert.equal(result.queueMax, 0)
  assert.equal(result.resizeQueue, false)
  assert.equal(result.settingsWidth + 6 + 320, 801)
  const roomy = resolveExportPanelLayout(1200, false, { settings: 520, queue: 480 })
  assert.equal(roomy.settingsWidth, 520)
  assert.equal(roomy.settingsMax, 520)
})

test('drag maxima reserve the actual other sidebar and never exceed global bounds', () => {
  const constrained = resolveExportPanelLayout(900, true, { settings: 520, queue: 480 })
  assert.equal(constrained.settingsMax, 900 - 320 - 12 - constrained.queueWidth)
  assert.equal(constrained.queueMax, 900 - 320 - 12 - constrained.settingsWidth)
  const roomy = resolveExportPanelLayout(1600, true, { settings: 300, queue: 250 })
  assert.equal(roomy.settingsMax, 520)
  assert.equal(roomy.queueMax, 480)
})

test('narrowing and closing panels never overwrite preferences, which restore on a wider container', () => {
  const preferences = Object.freeze({ settings: 510, queue: 470 })
  const initial = resolveExportPanelLayout(1800, true, preferences)
  for (const width of [900, 801, 700, 560, 0]) {
    resolveExportPanelLayout(width, true, preferences)
    resolveExportPanelLayout(width, false, preferences)
  }
  assert.deepEqual(preferences, { settings: 510, queue: 470 })
  assert.deepEqual(resolveExportPanelLayout(1800, true, preferences), initial)
  assert.equal(initial.settingsWidth, 510)
  assert.equal(initial.queueWidth, 470)
})

test('all desktop allocations fit the preview budget and expose consistent drag bounds', () => {
  for (const width of [801, 802.5, 900, 1090, 1091, 1280, 1600, 2000]) {
    for (const queueOpen of [false, true]) {
      for (const settings of [null, 220, 300, 520]) {
        for (const queue of [null, 180, 260, 480]) {
          const result = resolveExportPanelLayout(width, queueOpen, { settings, queue })
          const handles = queueOpen ? 12 : 6
          assert.ok(width - result.settingsWidth - result.queueWidth - handles >= 320 - 1e-8)
          assert.ok(result.settingsWidth >= result.settingsMin - 1e-8)
          assert.ok(result.settingsWidth <= result.settingsMax + 1e-8)
          assert.ok(result.queueWidth >= result.queueMin - 1e-8)
          assert.ok(result.queueWidth <= result.queueMax + 1e-8)
          assert.ok(result.settingsMax <= 520)
          assert.ok(result.queueMax <= 480)
        }
      }
    }
  }
})
