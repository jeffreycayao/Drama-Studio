'use strict'

/**
 * Package content gate: the installer must stay lean. Sound-effect packs,
 * model weights and other large content are downloaded after install
 * (Settings › Sound effects library, workflow setup), never shipped.
 *
 * Checks the packaged app (resources/app.asar plus the other resources) and
 * fails the build when it finds a forbidden file or anything over the size
 * cap. Used by the release afterPack hook and by `npm run exe:latest`.
 */

const fs = require('fs')
const path = require('path')

const MAX_FILE_BYTES = 25 * 1024 * 1024
const FORBIDDEN = [
  { pattern: /(^|[\\/])Drama Studio SFX([\\/]|$)/i, reason: 'the sound-effects library downloads after install' },
  { pattern: /\.(zip|7z|rar)$/i, reason: 'archives (e.g. sound packs) download after install' },
  { pattern: /\.(safetensors|ckpt|gguf|onnx|pth)$/i, reason: 'model weights download through workflow setup' },
  { pattern: /\.map$/i, reason: 'source maps are not shipped' },
  { pattern: /(^|[\\/])R2_[^\\/]*keys?[^\\/]*\.txt$/i, reason: 'credentials must never be packaged' },
]
// Files allowed to exceed the cap: the bundled tools the app runs.
const SIZE_EXEMPT = /(^|[\\/])(ffmpeg|ffprobe)(\.exe)?$|(^|[\\/])bin[\\/]rife[\\/]/i

function walk(dir, base = dir, out = []) {
  let items = []
  try { items = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const item of items) {
    const full = path.join(dir, item.name)
    if (item.isDirectory()) walk(full, base, out)
    else if (item.isFile()) out.push({ path: path.relative(base, full).split(path.sep).join('/'), size: fs.statSync(full).size })
  }
  return out
}

function listAsar(asarPath) {
  const asar = require('@electron/asar')
  return asar.listPackage(asarPath, { isPack: false })
    .map((entry) => entry.replace(/^[\\/]+/, ''))
    .map((entry) => {
      try {
        const stat = asar.statFile(asarPath, entry, false)
        return stat && typeof stat.size === 'number' ? { path: `app.asar/${entry}`, size: stat.size } : null
      } catch { return null }
    })
    .filter(Boolean)
}

/** Returns { problems: string[], totalBytes, asarBytes, largest } for a resources folder. */
function checkPackagedResources(resourcesDir) {
  const problems = []
  const files = walk(resourcesDir).filter((file) => file.path !== 'app.asar')
  const asarPath = path.join(resourcesDir, 'app.asar')
  const asarBytes = fs.existsSync(asarPath) ? fs.statSync(asarPath).size : 0
  if (asarBytes) files.push(...listAsar(asarPath))
  for (const file of files) {
    const rule = FORBIDDEN.find((item) => item.pattern.test(file.path))
    if (rule) problems.push(`${file.path}: ${rule.reason}`)
    else if (file.size > MAX_FILE_BYTES && !SIZE_EXEMPT.test(file.path)) {
      problems.push(`${file.path} is ${(file.size / 1048576).toFixed(1)} MB (cap ${MAX_FILE_BYTES / 1048576} MB); download it after install or shrink it`)
    }
  }
  const largest = [...files].sort((a, b) => b.size - a.size).slice(0, 5)
  return { problems, totalBytes: files.reduce((sum, file) => sum + file.size, 0), asarBytes, largest }
}

function assertPackageContents(resourcesDir, log = console.log) {
  const result = checkPackagedResources(resourcesDir)
  log(`[package-gate] app.asar ${(result.asarBytes / 1048576).toFixed(1)} MB; largest: ${result.largest.map((file) => `${file.path} ${(file.size / 1048576).toFixed(1)} MB`).join(', ')}`)
  if (result.problems.length) {
    throw new Error(`Package content gate failed:\n- ${result.problems.join('\n- ')}`)
  }
  return result
}

module.exports = { MAX_FILE_BYTES, assertPackageContents, checkPackagedResources }
