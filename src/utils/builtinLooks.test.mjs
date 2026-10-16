import assert from 'node:assert/strict'
import test from 'node:test'
import { BUILTIN_LOOKS, buildBuiltinLutEntries, buildLookLutRgba8, isBuiltinLutId, lookSwatchGradient } from './builtinLooks.js'

const sample = (entry, r, g, b) => {
  const n = entry.size
  const index = (r + g * n + b * n * n) * 4
  return Array.from(entry.rgba8.slice(index, index + 4))
}

test('14 looks become 17³ RGBA8 LUTs with stable builtin ids', () => {
  const entries = buildBuiltinLutEntries()
  assert.equal(entries.length, 14)
  assert.equal(new Set(entries.map(entry => entry.id)).size, 14)
  for (const entry of entries) {
    assert.ok(isBuiltinLutId(entry.id), entry.id)
    assert.equal(entry.size, 17)
    assert.equal(entry.rgba8.length, 17 ** 3 * 4)
    assert.ok(entry.builtin)
  }
  assert.equal(isBuiltinLutId('lut-mine-123'), false)
})

test('layout is red-fastest, like imported .cube LUTs', () => {
  const identity = { fn: (r, g, b) => [r, g, b] }
  const entry = { size: 3, rgba8: buildLookLutRgba8(identity, 3) }
  assert.deepEqual(sample(entry, 2, 0, 0), [255, 0, 0, 255])
  assert.deepEqual(sample(entry, 0, 2, 0), [0, 255, 0, 255])
  assert.deepEqual(sample(entry, 0, 0, 2), [0, 0, 255, 255])
})

test('looks do what their names say', () => {
  const byId = Object.fromEntries(buildBuiltinLutEntries().map(entry => [entry.id.replace('builtin-', ''), entry]))
  const [r, g, b] = sample(byId.bw, 16, 4, 2) // saturated orange → grey
  assert.ok(r === g && g === b)
  const [sr, , sb] = sample(byId.sepia, 8, 8, 8) // mid grey → warm brown
  assert.ok(sr > sb + 40)
  const [wr, , wb] = sample(byId.warm, 8, 8, 8)
  const [cr, , cb] = sample(byId.cool, 8, 8, 8)
  assert.ok(wr > wb && cb > cr)
  for (const value of sample(byId.bw, 16, 16, 16).slice(0, 3)) assert.ok(value > 250, 'white stays white')
  for (const look of BUILTIN_LOOKS) assert.match(lookSwatchGradient(look), /^linear-gradient\(90deg, rgb\(/)
})
