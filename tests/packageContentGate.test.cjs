'use strict'
// Lean-installer gate (scripts/package-content-gate.cjs): sound packs, model
// weights, archives, source maps and oversized files must not ship.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const asar = require('@electron/asar')
const { checkPackagedResources, MAX_FILE_BYTES } = require('../scripts/package-content-gate.cjs')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-package-gate-'))
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))

async function makeResources(name, appFiles, resourceFiles) {
  const appDir = path.join(tmp, name, 'app')
  const resources = path.join(tmp, name, 'resources')
  for (const [file, bytes] of Object.entries(appFiles)) {
    fs.mkdirSync(path.dirname(path.join(appDir, file)), { recursive: true })
    fs.writeFileSync(path.join(appDir, file), Buffer.alloc(bytes, 1))
  }
  for (const [file, bytes] of Object.entries(resourceFiles)) {
    fs.mkdirSync(path.dirname(path.join(resources, file)), { recursive: true })
    fs.writeFileSync(path.join(resources, file), Buffer.alloc(bytes, 1))
  }
  fs.mkdirSync(resources, { recursive: true })
  await asar.createPackage(appDir, path.join(resources, 'app.asar'))
  return resources
}

test('a lean package passes', async () => {
  const resources = await makeResources('lean', { 'dist/index.html': 100, 'dist/assets/index.js': 3_000_000, 'package.json': 50 },
    { 'workflows/flow.json': 2000, 'bin/ffmpeg.exe': MAX_FILE_BYTES + 10 })
  const result = checkPackagedResources(resources)
  assert.deepEqual(result.problems, [])
  assert.ok(result.largest.some((file) => file.path === 'bin/ffmpeg.exe'), 'bundled tools may exceed the cap')
})

test('packs, models, maps, keys and big media are refused', async () => {
  const resources = await makeResources('heavy', {
    'dist/assets/index.js.map': 100,
    'dist/promo.mp4': MAX_FILE_BYTES + 1,
    'dist/R2_Read_only_keys.txt': 10,
  }, {
    'Drama Studio SFX/files/boom.mp3': 100,
    'packs/viral-sfx-library.zip': 100,
    'models/yue2.safetensors': 100,
  })
  const problems = checkPackagedResources(resources).problems.join('\n')
  for (const needle of ['index.js.map', 'promo.mp4', 'R2_Read_only_keys.txt', 'Drama Studio SFX', 'viral-sfx-library.zip', 'yue2.safetensors']) {
    assert.match(problems, new RegExp(needle.replace(/\./g, '\\.')), needle)
  }
})
