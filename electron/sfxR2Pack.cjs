'use strict'

/**
 * Sound-effects pack from a private Cloudflare R2 bucket (main process).
 *
 * The pack is one zip (e.g. sfx/viral-sfx-library.zip) plus an optional
 * catalog.tsv. Install = signed, resumable download of the zip, extraction of
 * the audio files into <library folder>/files, and a local catalog built from
 * the TSV and the files on disk. After that the library works offline: the
 * R2 keys are only needed to download or update the pack.
 *
 * Trust boundary: the zip and the TSV are untrusted. Paths are validated
 * (relative, no "..", audio extensions only) and every write is checked to
 * stay inside the library folder; sizes are capped. The renderer only sees
 * ids, display fields and file paths main derived itself.
 */

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const yauzl = require('yauzl')
const { AUDIO_EXTENSIONS, MAX_FILE_BYTES, SFX_ID_PATTERN } = require('./sfxCatalog.cjs')
const r2 = require('./r2Client.cjs')

const PACK_FILE = 'pack.json'
const CATALOG_FILE = 'sfx-local-catalog.json'
const TSV_FILE = 'catalog.tsv'
const FILES_DIR = 'files'
const STAGING_DIR = 'files.extracting'
const DOWNLOAD_DIR = '.download'
const MAX_ZIP_BYTES = 64 * 1024 * 1024 * 1024
const MAX_ENTRIES = 100000
const MAX_TSV_BYTES = 32 * 1024 * 1024
const PROGRESS_INTERVAL_MS = 250
const SCAN_MAX_DEPTH = 8
const BAD_SEGMENT = /[\x00-\x1f<>:"|?*]/

class PackError extends Error {
  constructor(message, code) { super(message); this.code = code }
}

/** A safe relative audio path ("impact/door/slam.mp3") or null. */
function safeRelativeAudioPath(value) {
  const text = String(value || '').replace(/\\/g, '/').trim().replace(/^\.\/+/, '')
  if (!text || text.length > 400 || text.startsWith('/') || /^[A-Za-z]:/.test(text)) return null
  const parts = text.split('/')
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || part.length > 128 || BAD_SEGMENT.test(part)) return null
    if (part.startsWith('.') || part === '__MACOSX') return null
  }
  const ext = path.posix.extname(parts[parts.length - 1]).slice(1).toLowerCase()
  return AUDIO_EXTENSIONS.has(ext) ? parts.join('/') : null
}

/** Absolute path for a relative one; throws if it would leave `root`. */
function resolveInside(root, relative) {
  const base = path.resolve(root)
  const full = path.resolve(base, ...String(relative).split('/'))
  if (full !== base && !full.startsWith(base + path.sep)) throw new PackError('A sound-effect path escapes the library folder.', 'BAD_PATH')
  return full
}

const clip = (value, max) => {
  const text = typeof value === 'string' ? value.trim() : ''
  return text ? text.slice(0, max) : ''
}

/** catalog.tsv → Map(lower-case relative path → metadata). Header-driven. */
function parseCatalogTsv(text) {
  const rows = String(text || '').split(/\r?\n/)
  const header = (rows.shift() || '').split('\t').map((name) => name.trim().toLowerCase())
  const col = (name) => header.indexOf(name)
  const at = { id: col('id'), file: col('file'), category: col('category'), duration: col('durationseconds'),
    tags: col('tags'), description: col('description'), shape: col('shape'), tone: col('tone') }
  const byPath = new Map()
  if (at.file < 0) return byPath
  for (const row of rows) {
    if (!row.trim() || byPath.size >= MAX_ENTRIES) continue
    const cells = row.split('\t')
    const rel = safeRelativeAudioPath(cells[at.file])
    if (!rel) continue
    const tags = [
      ...String(cells[at.tags] || '').split(','),
      cells[at.shape] || '', cells[at.tone] || '',
    ].map((tag) => clip(tag, 48).toLowerCase()).filter(Boolean)
    const duration = Number(cells[at.duration])
    byPath.set(rel.toLowerCase(), {
      id: at.id >= 0 ? clip(cells[at.id], 128) : '',
      category: at.category >= 0 ? clip(cells[at.category], 64) : '',
      duration: Number.isFinite(duration) && duration >= 0 && duration <= 3600 ? duration : null,
      tags: [...new Set(tags)].slice(0, 32),
      description: at.description >= 0 ? clip(cells[at.description], 300) : '',
    })
  }
  return byPath
}

function prettyName(rel) {
  const base = path.posix.basename(rel, path.posix.extname(rel)).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : rel
}

/** "3D Box Ease In: 1.06s warm accent…" → "3D Box Ease In". */
function nameFromDescription(description) {
  const head = String(description || '').split(':')[0].trim()
  return head && head.length <= 120 && head !== description ? head : ''
}

async function scanAudioFiles(root) {
  const files = []
  const walk = async (dir, prefix, depth) => {
    if (depth > SCAN_MAX_DEPTH || files.length >= MAX_ENTRIES) return
    let items = []
    try { items = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const item of items) {
      if (files.length >= MAX_ENTRIES) return
      const rel = prefix ? `${prefix}/${item.name}` : item.name
      if (item.isDirectory()) { await walk(path.join(dir, item.name), rel, depth + 1); continue }
      if (!item.isFile()) continue
      const safe = safeRelativeAudioPath(rel)
      if (!safe) continue
      const stat = await fsp.stat(path.join(dir, item.name)).catch(() => null)
      if (stat && stat.size > 0) files.push({ rel: safe, size: stat.size })
    }
  }
  await walk(root, '', 0)
  return files
}

/**
 * Local catalog from the extracted files, enriched by catalog.tsv. Folders
 * group the sounds: first folder = category, second = sub-folder. A single
 * wrapper folder in the zip ("viral-sfx-library/…") is ignored.
 */
async function buildLocalCatalog(libraryDir, tsvText = '') {
  const filesRoot = path.join(libraryDir, FILES_DIR)
  const files = await scanAudioFiles(filesRoot)
  const meta = parseCatalogTsv(tsvText)
  const tops = new Set(files.map((file) => file.rel.split('/')[0]))
  const wrapper = tops.size === 1 && files.every((file) => file.rel.includes('/')) ? [...tops][0] : ''
  const entries = []
  const seen = new Set()
  let matched = 0
  for (const file of files) {
    const logical = wrapper && file.rel.startsWith(`${wrapper}/`) ? file.rel.slice(wrapper.length + 1) : file.rel
    const info = meta.get(logical.toLowerCase()) || meta.get(file.rel.toLowerCase()) || null
    if (info) matched += 1
    const parts = logical.split('/')
    let id = info?.id && SFX_ID_PATTERN.test(info.id) ? info.id : ''
    if (!id || seen.has(id)) id = `sfx-${crypto.createHash('sha1').update(file.rel).digest('hex').slice(0, 16)}`
    seen.add(id)
    const ext = path.posix.extname(file.rel).slice(1).toLowerCase()
    entries.push({
      id,
      name: nameFromDescription(info?.description) || prettyName(file.rel),
      category: info?.category || (parts.length > 1 ? parts[0] : 'misc'),
      subCategory: parts.length > 2 ? parts[1] : null,
      tags: info?.tags || [],
      description: info?.description || '',
      duration: info?.duration ?? 0,
      fileSize: file.size,
      format: ext,
      localPath: file.rel,
      remoteUrl: null,
      sha256: null,
      license: null,
    })
  }
  // Variants often share a description title ("3D Box" for box.mp3 and
  // box-v2.mp3); within a folder, fall back to the file name for those.
  const seenNames = new Map()
  for (const entry of entries) {
    const key = `${entry.category}\u0000${entry.subCategory || ''}\u0000${entry.name.toLowerCase()}`
    seenNames.set(key, (seenNames.get(key) || 0) + 1)
  }
  for (const entry of entries) {
    const key = `${entry.category}\u0000${entry.subCategory || ''}\u0000${entry.name.toLowerCase()}`
    if (seenNames.get(key) > 1) entry.name = prettyName(entry.localPath)
  }
  entries.sort((a, b) => a.category.localeCompare(b.category) || String(a.subCategory || '').localeCompare(String(b.subCategory || ''))
    || a.name.localeCompare(b.name))
  return { version: 1, name: 'Sound effects pack', source: 'r2-pack', entries, dropped: 0, matched, generatedAt: new Date().toISOString() }
}

async function readJson(file) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')) } catch { return null }
}
async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fsp.writeFile(temp, JSON.stringify(value), 'utf8')
  await fsp.rename(temp, file)
}

/** Signed, resumable download of one object to `dest`. */
async function downloadObject(config, key, dest, { size, etag, signal, onBytes = () => {} }) {
  const part = `${dest}.part`
  const partMeta = `${part}.json`
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  let offset = 0
  const previous = await readJson(partMeta)
  try { offset = (await fsp.stat(part)).size } catch { offset = 0 }
  // A different object version (or size) makes the partial file useless.
  if (offset && (!previous || previous.etag !== etag || previous.size !== size || offset > size)) {
    await fsp.rm(part, { force: true }); offset = 0
  }
  await writeJsonAtomic(partMeta, { key, etag, size })
  if (offset > 0) onBytes(offset, true)
  if (offset < size) {
    const res = await r2.r2Request(config, { method: 'GET', key, headers: offset ? { Range: `bytes=${offset}-` } : {}, signal })
    const status = res.statusCode || 0
    if (status !== 200 && status !== 206) { res.resume(); throw new PackError(r2.describeR2Status(status), 'HTTP_STATUS') }
    if (status === 200 && offset) { offset = 0; onBytes(0, true) }
    if (status === 206) {
      const match = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(String(res.headers['content-range'] || '').trim())
      if (!match || Number(match[1]) !== offset) { res.resume(); await fsp.rm(part, { force: true }); throw new PackError('R2 resumed at the wrong position; start the download again.', 'BAD_RANGE') }
    }
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(part, { flags: offset ? 'a' : 'w' })
      let written = offset
      const fail = (error) => { res.destroy(); out.destroy(); reject(error) }
      res.on('data', (chunk) => {
        written += chunk.length
        if (written > size) { fail(new PackError('The download is larger than R2 reported.', 'TOO_LARGE')); return }
        onBytes(chunk.length, false)
      })
      res.on('error', (error) => fail(signal?.aborted ? new PackError('Download paused or canceled.', 'ABORTED') : error))
      res.on('aborted', () => fail(new PackError(signal?.aborted ? 'Download paused or canceled.' : 'The connection closed early.', signal?.aborted ? 'ABORTED' : 'ABORTED_REMOTE')))
      out.on('error', fail)
      out.on('finish', resolve)
      res.pipe(out)
    })
  }
  const got = (await fsp.stat(part)).size
  if (got !== size) throw new PackError(`Downloaded ${got} of ${size} bytes; resume to finish.`, 'SIZE_MISMATCH')
  await fsp.rename(part, dest)
  await fsp.rm(partMeta, { force: true })
  return dest
}

const openZip = (file) => new Promise((resolve, reject) => {
  yauzl.open(file, { lazyEntries: true, autoClose: true, strictFileNames: false, validateEntrySizes: true }, (error, zip) => (error ? reject(error) : resolve(zip)))
})

/**
 * Extract the audio files of `zipFile` into `destDir`. Non-audio entries and
 * unsafe paths are skipped and counted. Returns { extracted, skipped }.
 */
async function extractAudioZip(zipFile, destDir, { signal, onEntry = () => {} } = {}) {
  const zip = await openZip(zipFile)
  if (zip.entryCount > MAX_ENTRIES) { zip.close(); throw new PackError('The pack has too many files.', 'TOO_MANY') }
  let extracted = 0
  let skipped = 0
  await new Promise((resolve, reject) => {
    const finish = (error) => { try { zip.close() } catch { /* already closed */ } ; if (error) reject(error); else resolve() }
    zip.on('error', finish)
    zip.on('end', () => finish())
    zip.on('entry', (entry) => {
      if (signal?.aborted) { finish(new PackError('Extraction canceled.', 'ABORTED')); return }
      const rel = /\/$/.test(entry.fileName) ? null : safeRelativeAudioPath(entry.fileName)
      if (!rel || entry.uncompressedSize > MAX_FILE_BYTES) {
        if (!/\/$/.test(entry.fileName)) skipped += 1
        onEntry({ extracted, skipped, total: zip.entryCount })
        zip.readEntry()
        return
      }
      let target
      try { target = resolveInside(destDir, rel) } catch (error) { finish(error); return }
      zip.openReadStream(entry, (error, stream) => {
        if (error) { finish(error); return }
        fsp.mkdir(path.dirname(target), { recursive: true }).then(() => {
          const temp = `${target}.part`
          const out = fs.createWriteStream(temp)
          stream.on('error', (streamError) => { out.destroy(); finish(streamError) })
          out.on('error', finish)
          out.on('finish', () => {
            fsp.rename(temp, target).then(() => {
              extracted += 1
              onEntry({ extracted, skipped, total: zip.entryCount })
              zip.readEntry()
            }, finish)
          })
          stream.pipe(out)
        }, finish)
      })
    })
    zip.readEntry()
  })
  return { extracted, skipped }
}

/**
 * R2 pack source. `getConfig()` returns the decrypted, normalized R2 config
 * plus { objectKey, catalogKey } or null; `getLibraryDir()` the folder.
 */
function createR2PackSource({ getConfig, getLibraryDir, emit = () => {}, statfs = fsp.statfs }) {
  let catalog = null
  let catalogDir = ''
  const byId = new Map()
  const job = { state: 'idle', phase: '', bytesTotal: 0, bytesDone: 0, total: 0, completed: 0, failed: 0, skipped: 0,
    errors: [], message: '', controller: null, lastEmit: 0, running: null }

  const status = () => {
    const { controller, lastEmit, running, ...rest } = job
    return { ...rest, source: 'r2-pack', errors: job.errors.slice(-5) }
  }
  const emitStatus = (force = false) => {
    const now = Date.now()
    if (!force && now - job.lastEmit < PROGRESS_INTERVAL_MS) return
    job.lastEmit = now
    emit('sfx:pack:progress', status())
  }

  function adopt(next, dir) {
    catalog = next
    catalogDir = dir
    byId.clear()
    for (const entry of next.entries) byId.set(entry.id, entry)
    return next
  }

  async function installedInfo(dir) {
    const pack = await readJson(path.join(dir, PACK_FILE))
    return pack && typeof pack === 'object' ? pack : null
  }

  async function getCatalog({ refresh = false } = {}) {
    const dir = await getLibraryDir()
    const config = await getConfig().catch(() => null)
    const pack = await installedInfo(dir)
    const base = { configured: true, source: 'r2-pack', libraryDir: dir, hasKeys: Boolean(config), installed: Boolean(pack),
      installedAt: pack?.installedAt || null, packBytes: pack?.size || null, warning: null }
    if (!pack) {
      catalog = null; byId.clear()
      let remoteBytes = null
      if (config && refresh) remoteBytes = await r2.headObject(config, config.objectKey).then((head) => head.size, () => null)
      return { ...base, entries: [], dropped: 0, remoteBytes }
    }
    if (!refresh && catalog && catalogDir === dir) return { ...base, ...catalog }
    let cached = refresh ? null : await readJson(path.join(dir, CATALOG_FILE))
    if (!cached || !Array.isArray(cached.entries)) {
      const tsv = await fsp.readFile(path.join(dir, TSV_FILE), 'utf8').catch(() => '')
      cached = await buildLocalCatalog(dir, tsv)
      await writeJsonAtomic(path.join(dir, CATALOG_FILE), cached)
    }
    return { ...base, ...adopt(cached, dir) }
  }

  async function entryPath(id) {
    if (typeof id !== 'string') throw new PackError('Unknown sound effect.', 'UNKNOWN')
    if (!catalog) await getCatalog()
    const entry = byId.get(id)
    if (!entry) throw new PackError('This sound effect is not in the pack.', 'UNKNOWN')
    const file = resolveInside(path.join(catalogDir, FILES_DIR), entry.localPath)
    try { await fsp.access(file) } catch { throw new PackError('This sound is missing from the library folder. Reinstall the pack.', 'MISSING') }
    return file
  }

  async function install() {
    if (job.running) return status()
    const config = await getConfig()
    if (!config) throw new PackError('Add the R2 access keys first (Settings › Sound effects library).', 'NO_KEYS')
    const dir = await getLibraryDir()
    const head = await r2.headObject(config, config.objectKey)
    if (!Number.isSafeInteger(head.size) || head.size <= 0 || head.size > MAX_ZIP_BYTES) throw new PackError('R2 reported an unexpected pack size.', 'BAD_SIZE')
    await fsp.mkdir(dir, { recursive: true })
    const stats = await statfs(dir).catch(() => null)
    const free = stats ? Number(stats.bavail) * Number(stats.bsize) : Infinity
    const zipPath = path.join(dir, DOWNLOAD_DIR, path.posix.basename(config.objectKey))
    const already = await fsp.stat(`${zipPath}.part`).then((s) => s.size, () => 0)
    // Room for the rest of the zip plus the extracted files (zip deleted after).
    const needed = (head.size - already) + head.size * 1.05 + 256 * 1024 * 1024
    if (free < needed) throw new PackError(`Not enough free space in ${dir}: the pack needs about ${(needed / 1e9).toFixed(1)} GB. Choose another library folder.`, 'NO_SPACE')

    const controller = new AbortController()
    Object.assign(job, { state: 'running', phase: 'download', bytesTotal: head.size, bytesDone: 0, total: 0, completed: 0, failed: 0,
      skipped: 0, errors: [], message: 'Downloading the sound-effects pack…', controller })
    emitStatus(true)
    job.running = (async () => {
      try {
        await downloadObject(config, config.objectKey, zipPath, { size: head.size, etag: head.etag, signal: controller.signal,
          onBytes: (bytes, absolute) => { job.bytesDone = absolute ? bytes : job.bytesDone + bytes; emitStatus() } })
        job.phase = 'extract'; job.message = 'Unpacking sounds…'; emitStatus(true)
        const staging = path.join(dir, STAGING_DIR)
        await fsp.rm(staging, { recursive: true, force: true })
        const result = await extractAudioZip(zipPath, staging, { signal: controller.signal,
          onEntry: ({ extracted, skipped, total }) => { job.completed = extracted; job.skipped = skipped; job.total = total; emitStatus() } })
        if (!result.extracted) throw new PackError('The pack contained no audio files.', 'EMPTY')
        let tsv = ''
        if (config.catalogKey) {
          tsv = await r2.getObjectText(config, config.catalogKey, { limit: MAX_TSV_BYTES }).catch((error) => {
            job.errors.push({ id: null, message: `catalog.tsv not loaded (${error.message}); names come from file names.` })
            return ''
          })
        }
        // Swap the new files in, then drop the old ones and the zip.
        const filesDir = path.join(dir, FILES_DIR)
        const old = path.join(dir, `${FILES_DIR}.old`)
        await fsp.rm(old, { recursive: true, force: true })
        await fsp.rename(filesDir, old).catch(() => {})
        await fsp.rename(staging, filesDir)
        await fsp.rm(old, { recursive: true, force: true })
        if (tsv) await fsp.writeFile(path.join(dir, TSV_FILE), tsv, 'utf8')
        const built = await buildLocalCatalog(dir, tsv)
        await writeJsonAtomic(path.join(dir, CATALOG_FILE), built)
        await writeJsonAtomic(path.join(dir, PACK_FILE), { bucket: config.bucket, objectKey: config.objectKey, etag: head.etag,
          size: head.size, installedAt: new Date().toISOString(), fileCount: built.entries.length })
        await fsp.rm(path.join(dir, DOWNLOAD_DIR), { recursive: true, force: true })
        adopt(built, dir)
        Object.assign(job, { state: 'done', phase: '', message: `Installed ${built.entries.length} sounds.`, completed: built.entries.length })
      } catch (error) {
        if (error?.code === 'ABORTED' && job.state === 'paused') return
        if (error?.code === 'ABORTED' && job.state === 'canceled') return
        job.state = 'error'
        job.errors.push({ id: null, message: error?.message || String(error) })
        job.message = error?.message || 'The pack could not be installed.'
      } finally {
        job.controller = null
        job.running = null
        emitStatus(true)
      }
    })()
    return status()
  }

  async function pause() {
    if (job.state !== 'running' || job.phase !== 'download') return status()
    job.state = 'paused'
    job.message = 'Paused. Resume continues where it stopped.'
    job.controller?.abort()
    await job.running
    return status()
  }

  async function cancel() {
    const dir = await getLibraryDir()
    const wasRunning = job.state === 'running'
    job.state = 'canceled'
    job.message = 'Canceled.'
    job.controller?.abort()
    if (wasRunning) await job.running
    await fsp.rm(path.join(dir, DOWNLOAD_DIR), { recursive: true, force: true })
    await fsp.rm(path.join(dir, STAGING_DIR), { recursive: true, force: true })
    emitStatus(true)
    return status()
  }

  async function remove() {
    if (job.running) throw new PackError('Wait for the download to finish or cancel it first.', 'BUSY')
    const dir = await getLibraryDir()
    for (const name of [FILES_DIR, `${FILES_DIR}.old`, STAGING_DIR, DOWNLOAD_DIR, CATALOG_FILE, TSV_FILE, PACK_FILE]) {
      await fsp.rm(path.join(dir, name), { recursive: true, force: true })
    }
    catalog = null; byId.clear()
    Object.assign(job, { state: 'idle', phase: '', message: 'Pack removed.', completed: 0, total: 0, bytesDone: 0, bytesTotal: 0, errors: [] })
    emitStatus(true)
    return cacheInfo()
  }

  async function cacheInfo() {
    const dir = await getLibraryDir()
    const pack = await installedInfo(dir)
    const files = await scanAudioFiles(path.join(dir, FILES_DIR))
    return { cacheDir: dir, files: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0), installed: Boolean(pack) }
  }

  return {
    getCatalog,
    resolve: async (id) => ({ id, path: await entryPath(id), cached: true }),
    status: async (ids) => {
      if (!catalog) await getCatalog().catch(() => null)
      return Object.fromEntries((Array.isArray(ids) ? ids.slice(0, 500) : []).map((id) => [id, byId.has(id) ? 'cached' : 'unknown']))
    },
    previewSource: async (id) => ({ cached: true, path: await entryPath(id) }),
    packStart: install,
    packPause: pause,
    packResume: install,
    packCancel: cancel,
    packStatus: status,
    cacheInfo,
    clearCache: remove,
    isBusy: () => Boolean(job.running),
  }
}

/**
 * One SFX surface for the IPC layer: the R2 pack when settings say
 * `sfxLibrary.source === 'r2-pack'`, else the catalog-URL library.
 */
function createSfxSourceRouter({ urlLibrary, r2Pack, readSettings }) {
  let lastSource = 'url'
  const pick = async () => {
    const settings = await readSettings().catch(() => ({}))
    lastSource = settings?.sfxLibrary?.source === 'r2-pack' ? 'r2-pack' : 'url'
    return lastSource === 'r2-pack' ? r2Pack : urlLibrary
  }
  const call = (name) => async (...args) => (await pick())[name](...args)
  return {
    getCatalog: call('getCatalog'),
    resolve: call('resolve'),
    status: call('status'),
    previewSource: call('previewSource'),
    packStart: call('packStart'),
    packPause: call('packPause'),
    packResume: call('packResume'),
    packCancel: call('packCancel'),
    packStatus: () => (lastSource === 'r2-pack' || r2Pack.isBusy() ? r2Pack.packStatus() : urlLibrary.packStatus()),
    cacheInfo: call('cacheInfo'),
    clearCache: call('clearCache'),
  }
}

module.exports = {
  CATALOG_FILE,
  FILES_DIR,
  PACK_FILE,
  PackError,
  buildLocalCatalog,
  createR2PackSource,
  createSfxSourceRouter,
  downloadObject,
  extractAudioZip,
  parseCatalogTsv,
  resolveInside,
  safeRelativeAudioPath,
}
