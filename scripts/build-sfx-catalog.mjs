#!/usr/bin/env node
// Build sfx-catalog.json from a local folder of sound effects, for publishing
// to zero-egress HTTPS storage (Cloudflare R2, a Hugging Face dataset).
//
//   node scripts/build-sfx-catalog.mjs <folder> --base-url https://pub-x.r2.dev/sfx/ [--out sfx-catalog.json] [--name "Drama Studio SFX"]
//
// Layout: <folder>/<Category>/<SubCategory?>/<file>.wav. Tags come from the
// file name words plus an optional "<file>.tags.txt" (comma separated).
// Each entry gets size, SHA-256 and duration (from ffprobe-static). Upload the
// folder unchanged so remoteUrl = baseUrl + relative path.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const AUDIO = new Set(['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aac', '.opus', '.aif', '.aiff'])
const args = process.argv.slice(2)
const option = (name, fallback = null) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback }
const root = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : null
const baseUrl = option('--base-url')
const out = path.resolve(option('--out', 'sfx-catalog.json'))
if (!root || !baseUrl || !/^https:\/\//.test(baseUrl)) {
  console.error('Usage: node scripts/build-sfx-catalog.mjs <folder> --base-url https://host/path/ [--out file] [--name name]')
  process.exit(1)
}
let ffprobe = null
try {
  const probe = require('@derhuerst/ffprobe-static') // exports the binary path (string)
  ffprobe = typeof probe === 'string' ? probe : probe?.path || null
} catch { /* duration falls back to 0 */ }
if (!ffprobe) console.warn('ffprobe-static not found: durations will be 0.')

const slug = value => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100)
const words = value => value.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 1)

function probeDuration(file) {
  if (!ffprobe) return 0
  const result = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' })
  const value = Number(String(result.stdout).trim())
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0
}

async function sha256(file) {
  const hash = crypto.createHash('sha256')
  await new Promise((resolve, reject) => fs.createReadStream(file).on('data', chunk => hash.update(chunk)).on('end', resolve).on('error', reject))
  return hash.digest('hex')
}

async function* walk(dir) {
  for (const item of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name)
    if (item.isDirectory()) yield* walk(full)
    else if (AUDIO.has(path.extname(item.name).toLowerCase())) yield full
  }
}

const entries = [], ids = new Set()
for await (const file of walk(root)) {
  const relative = path.relative(root, file).split(path.sep)
  const [category = 'Misc', ...rest] = relative.length > 1 ? relative : ['Misc', ...relative]
  const subCategory = rest.length > 1 ? rest[0] : null
  const base = path.basename(file, path.extname(file))
  let id = slug(`${category}-${subCategory || ''}-${base}`) || crypto.randomUUID()
  for (let n = 2; ids.has(id); n += 1) id = `${slug(`${category}-${base}`)}-${n}`
  ids.add(id)
  const tagFile = file.replace(/\.[^.]+$/, '.tags.txt')
  const extraTags = fs.existsSync(tagFile) ? (await fsp.readFile(tagFile, 'utf8')).split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean) : []
  const stat = await fsp.stat(file)
  entries.push({
    id, name: base.replace(/[_-]+/g, ' ').trim(), category, subCategory,
    tags: [...new Set([...words(base), ...extraTags])].slice(0, 32),
    duration: probeDuration(file), fileSize: stat.size,
    remoteUrl: relative.map(encodeURIComponent).join('/'), sha256: await sha256(file),
  })
  if (entries.length % 250 === 0) console.log(`${entries.length} files…`)
}
const catalog = { version: 1, name: option('--name', 'Drama Studio SFX'), baseUrl, generatedAt: new Date().toISOString(), entries }
await fsp.writeFile(out, JSON.stringify(catalog))
const bytes = entries.reduce((sum, entry) => sum + entry.fileSize, 0)
console.log(`Wrote ${entries.length} entries (${(bytes / 1e9).toFixed(2)} GB of audio) to ${out} (${(fs.statSync(out).size / 1e6).toFixed(2)} MB).`)
