'use strict'
// SFX library: catalog cache, on-demand downloads and the offline pack.
// Runs in the Electron main process. Downloads stream to `<file>.part` with
// HTTP Range resume, a streaming SHA-256 and a hard size cap, then rename
// atomically. The renderer never chooses URLs or paths: it passes entry ids.

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const http = require('http')
const https = require('https')
const {
  MAX_CATALOG_BYTES, MAX_FILE_BYTES, cachePathFor, getAllowedOrigins, isAllowedUrl, validateCatalog, isAllowedProtocol,
} = require('./sfxCatalog.cjs')
const { createPublicLookup } = require('./publicLookup.cjs')

const SETTINGS_KEY = 'sfxLibrary'
const PACK_CONCURRENCY = 3
const MAX_ON_DEMAND = 4
const MAX_REDIRECTS = 3
const IDLE_TIMEOUT_MS = 30000
const PROGRESS_INTERVAL_MS = 250

class SfxError extends Error {
  constructor(message, code) { super(message); this.code = code }
}

const abortError = () => new SfxError('Download paused or canceled.', 'ABORTED')

/** One GET with optional Range. Resolves the response after redirects that
 * pass `canFollow`. Rejects on timeout, abort, or a disallowed redirect.
 * Every hop resolves through createPublicLookup, so a public name that
 * points at a private or loopback address is refused at connect time. */
function request(url, { headers = {}, signal, canFollow, options, lookup }, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return }
    const target = new URL(url)
    const client = target.protocol === 'https:' ? https : http
    const pinned = lookup || createPublicLookup({ allowLoopback: Boolean(options?.allowLoopback) })
    const req = client.get(target, {
      headers: { 'User-Agent': 'DramaStudio-SFX/1', 'Accept-Encoding': 'identity', ...headers },
      lookup: pinned,
      // A pooled socket opened without this lookup must not be reused.
      agent: false,
    }, (res) => {
      const status = res.statusCode || 0
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume()
        const next = new URL(res.headers.location, target)
        if (redirects >= MAX_REDIRECTS || !isAllowedProtocol(next, options) || !canFollow(next)) {
          reject(new SfxError('The download redirected to a location that is not allowed.', 'REDIRECT_BLOCKED'))
          return
        }
        request(next.href, { headers, signal, canFollow, options, lookup: pinned }, redirects + 1).then(resolve, reject)
        return
      }
      resolve({ res, url: target.href })
    })
    req.setTimeout(IDLE_TIMEOUT_MS, () => req.destroy(new SfxError('The download timed out.', 'TIMEOUT')))
    req.on('error', (error) => reject(signal?.aborted ? abortError()
      : error?.code === 'PRIVATE_ADDRESS' ? new SfxError('The download address points to a private or local network address.', 'PRIVATE_ADDRESS')
      : error))
    signal?.addEventListener('abort', () => req.destroy(abortError()), { once: true })
  })
}

async function hashFile(file, hash) {
  await new Promise((resolve, reject) => {
    fs.createReadStream(file).on('data', chunk => hash.update(chunk)).on('end', resolve).on('error', reject)
  })
}

/** Download one entry to `dest`. Resumes `dest.part` with Range when the
 * server honours it, restarts when it does not. Verifies size and SHA-256. */
async function downloadEntry(entry, dest, { signal, onBytes = () => {}, allowedOrigins, options }) {
  const part = `${dest}.part`
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  const limit = Math.min(MAX_FILE_BYTES, Math.ceil(entry.fileSize * 1.01) + 1024)
  // Off-origin redirects (CDN edges, Hugging Face storage) are only followed
  // when a SHA-256 pins the content; otherwise stay on the catalog origins.
  const canFollow = next => Boolean(entry.sha256) || allowedOrigins.has(next.origin)
  let offset = 0
  try { offset = (await fsp.stat(part)).size } catch { offset = 0 }
  if (offset > limit) { await fsp.rm(part, { force: true }); offset = 0 }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const headers = offset > 0 ? { Range: `bytes=${offset}-` } : {}
    const { res } = await request(entry.remoteUrl, { headers, signal, canFollow, options })
    const status = res.statusCode || 0
    if (status === 416 && offset > 0) {
      // Range beyond the end: either the part is already complete, or stale.
      res.resume()
      if (offset === entry.fileSize) break
      await fsp.rm(part, { force: true }); offset = 0; continue
    }
    if (status !== 200 && status !== 206) {
      res.resume()
      throw new SfxError(`The server answered HTTP ${status}.`, 'HTTP_STATUS')
    }
    if (status === 200 && offset > 0) offset = 0 // Range ignored: start over.
    if (status === 206) {
      // Only append when the server resumes exactly where the part file ends.
      const match = /^bytes (\d+)-\d+\/(?:\d+|\*)$/.exec(String(res.headers['content-range'] || '').trim())
      if (!match || Number(match[1]) !== offset) {
        res.resume()
        await fsp.rm(part, { force: true })
        offset = 0
        if (attempt === 0) continue
        throw new SfxError('The server resumed the download at the wrong position.', 'BAD_RANGE')
      }
    }
    const declared = Number(res.headers['content-length'])
    if (Number.isFinite(declared) && offset + declared > limit) {
      res.resume()
      throw new SfxError('The file is larger than the catalog says.', 'TOO_LARGE')
    }
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(part, { flags: offset > 0 ? 'a' : 'w' })
      let written = offset
      const fail = (error) => { res.destroy(); out.destroy(); reject(error) }
      res.on('data', (chunk) => {
        written += chunk.length
        if (written > limit) { fail(new SfxError('The file is larger than the catalog says.', 'TOO_LARGE')); return }
        onBytes(chunk.length)
      })
      res.on('error', error => fail(signal?.aborted ? abortError() : error))
      res.on('aborted', () => fail(signal?.aborted ? abortError() : new SfxError('The connection closed early.', 'ABORTED_REMOTE')))
      out.on('error', fail)
      out.on('finish', resolve)
      res.pipe(out)
    })
    break
  }
  const size = (await fsp.stat(part)).size
  if (size !== entry.fileSize) {
    // A short file can be resumed next time; a long one is corrupt.
    if (size > entry.fileSize) await fsp.rm(part, { force: true })
    throw new SfxError(`Downloaded ${size} of ${entry.fileSize} bytes.`, 'SIZE_MISMATCH')
  }
  if (entry.sha256) {
    const hash = crypto.createHash('sha256')
    await hashFile(part, hash)
    if (hash.digest('hex') !== entry.sha256) {
      await fsp.rm(part, { force: true })
      throw new SfxError('The downloaded file failed its SHA-256 check and was deleted.', 'HASH_MISMATCH')
    }
  }
  await fsp.rename(part, dest)
  return dest
}

async function readBody(url, { limit, options, allowedOrigins }) {
  const { res } = await request(url, { canFollow: next => allowedOrigins.has(next.origin), options })
  if (res.statusCode !== 200) { res.resume(); throw new SfxError(`The catalog server answered HTTP ${res.statusCode}.`, 'HTTP_STATUS') }
  const chunks = []
  let size = 0
  for await (const chunk of res) {
    size += chunk.length
    if (size > limit) { res.destroy(); throw new SfxError('The SFX catalog is too large.', 'TOO_LARGE') }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function writeAtomic(file, text) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fsp.writeFile(temp, text, 'utf8')
  await fsp.rename(temp, file)
}

function createSfxLibrary({ cacheDir, readSettings = async () => ({}), emit = () => {}, allowLoopback = false, statfs = fsp.statfs } = {}) {
  const options = { allowLoopback }
  const catalogFile = path.join(cacheDir, 'sfx-catalog.json')
  let catalog = null
  const byId = new Map()
  const inflight = new Map()
  let onDemandActive = 0
  const onDemandWaiters = []
  const pack = { state: 'idle', total: 0, completed: 0, failed: 0, bytesTotal: 0, bytesDone: 0, errors: [], controllers: new Map(), queue: [], lastEmit: 0, generation: 0 }

  const settings = async () => {
    const all = await readSettings()
    const value = all && typeof all === 'object' ? all[SETTINGS_KEY] : null
    return value && typeof value === 'object' ? value : {}
  }

  function adopt(next) {
    catalog = next
    byId.clear()
    for (const entry of next.entries) byId.set(entry.id, entry)
    return next
  }

  async function loadCached(catalogUrl) {
    try {
      const raw = JSON.parse(await fsp.readFile(catalogFile, 'utf8'))
      if (raw?.catalogUrl !== catalogUrl) return null
      return validateCatalog(raw.source, catalogUrl, options)
    } catch { return null }
  }

  /** Validated catalog for the configured URL; cached on disk. */
  async function getCatalog({ refresh = false } = {}) {
    const { catalogUrl } = await settings()
    if (typeof catalogUrl !== 'string' || !catalogUrl.trim()) {
      return { configured: false, entries: [], dropped: 0, warning: null }
    }
    const url = catalogUrl.trim()
    if (!refresh && catalog?.catalogUrl === new URL(url).href) return { configured: true, ...catalog, warning: null }
    if (!refresh) {
      const cached = await loadCached(url)
      if (cached) return { configured: true, ...adopt(cached), warning: null }
    }
    try {
      const allowedOrigins = getAllowedOrigins(url, null, options)
      if (!allowedOrigins.size) throw new SfxError('The SFX catalog URL must use https.', 'BAD_URL')
      const source = JSON.parse(await readBody(url, { limit: MAX_CATALOG_BYTES, options, allowedOrigins }))
      const validated = validateCatalog(source, url, options)
      await writeAtomic(catalogFile, JSON.stringify({ catalogUrl: url, fetchedAt: new Date().toISOString(), source }))
      return { configured: true, ...adopt(validated), warning: null }
    } catch (error) {
      const cached = await loadCached(url)
      if (cached) return { configured: true, ...adopt(cached), warning: `Using the saved catalog: ${error.message}` }
      throw error
    }
  }

  async function entryFor(id) {
    if (typeof id !== 'string') throw new SfxError('Unknown sound effect.', 'UNKNOWN')
    if (!catalog) await getCatalog()
    const entry = byId.get(id)
    if (!entry) throw new SfxError('This sound effect is not in the catalog.', 'UNKNOWN')
    return entry
  }

  const destFor = entry => cachePathFor(cacheDir, entry)
  const isCached = async entry => {
    try { return (await fsp.stat(destFor(entry))).size === entry.fileSize } catch { return false }
  }

  function download(entry, { signal, onBytes } = {}) {
    // One transfer per id: drag, preview-cache and the pack share it.
    if (inflight.has(entry.id)) return inflight.get(entry.id)
    const allowedOrigins = new Set(catalog?.allowedOrigins || [])
    const job = downloadEntry(entry, destFor(entry), { signal, onBytes, allowedOrigins, options })
      .finally(() => inflight.delete(entry.id))
    inflight.set(entry.id, job)
    return job
  }

  /** Local file for an id, downloading it first if needed. */
  async function resolve(id) {
    const entry = await entryFor(id)
    if (await isCached(entry)) return { id, path: destFor(entry), cached: true }
    if (inflight.has(id)) {
      // Joining a pack transfer: if the pack is paused mid-file, that abort
      // must not fail this request, so fall through and download it here.
      try { return { id, path: await inflight.get(id), cached: false } } catch (error) { if (error?.code !== 'ABORTED') throw error }
    }
    // On-demand downloads have their own slots so a drag never waits behind the pack.
    if (onDemandActive >= MAX_ON_DEMAND) await new Promise(done => onDemandWaiters.push(done))
    onDemandActive += 1
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (await isCached(entry)) return { id, path: destFor(entry), cached: true }
        try { return { id, path: await download(entry), cached: false } } catch (error) {
          if (error?.code !== 'ABORTED' || attempt) throw error
        }
      }
      throw new SfxError('The download was interrupted.', 'ABORTED')
    } finally {
      onDemandActive -= 1
      onDemandWaiters.shift()?.()
    }
  }

  async function status(ids) {
    const list = Array.isArray(ids) ? ids.slice(0, 500) : []
    const result = {}
    for (const id of list) {
      const entry = byId.get(id)
      result[id] = entry ? (inflight.has(id) ? 'downloading' : (await isCached(entry) ? 'cached' : 'remote')) : 'unknown'
    }
    return result
  }

  /** Preview source: the cached file when present, else the remote URL
   * (Chromium's media stack streams it with Range requests). */
  async function previewSource(id) {
    const entry = await entryFor(id)
    if (await isCached(entry)) return { cached: true, path: destFor(entry) }
    return { cached: false, url: entry.remoteUrl }
  }

  function packStatus() {
    const { controllers, queue, lastEmit, generation, ...rest } = pack
    return { ...rest, errors: pack.errors.slice(-20), active: [...controllers.keys()], remaining: queue.length + controllers.size }
  }
  function emitPack(force = false) {
    const now = Date.now()
    if (!force && now - pack.lastEmit < PROGRESS_INTERVAL_MS) return
    pack.lastEmit = now
    emit('sfx:pack:progress', packStatus())
  }

  async function runPackWorkers() {
    // Each start/resume is a new generation; workers from an earlier one
    // (still unwinding after a pause) stop and never count aborts as failures.
    const gen = ++pack.generation
    const live = () => pack.state === 'running' && pack.generation === gen
    const worker = async () => {
      while (live() && pack.queue.length) {
        const entry = pack.queue.shift()
        if (await isCached(entry)) { pack.completed += 1; pack.bytesDone += entry.fileSize; emitPack(); continue }
        const controller = new AbortController()
        pack.controllers.set(entry.id, controller)
        let partBefore = 0
        try { partBefore = (await fsp.stat(`${destFor(entry)}.part`)).size } catch { partBefore = 0 }
        let counted = 0
        try {
          if (inflight.has(entry.id)) await inflight.get(entry.id)
          else await download(entry, { signal: controller.signal, onBytes: bytes => { counted += bytes; pack.bytesDone += bytes; emitPack() } })
          pack.completed += 1
          pack.bytesDone += Math.max(0, entry.fileSize - counted - partBefore) + partBefore
        } catch (error) {
          pack.bytesDone -= counted
          if (error?.code === 'ABORTED' && !live()) {
            pack.queue.unshift(entry) // Paused or canceled: retry later.
          } else {
            pack.failed += 1
            pack.errors.push({ id: entry.id, message: error?.message || String(error) })
          }
        } finally {
          pack.controllers.delete(entry.id)
          emitPack()
        }
      }
    }
    await Promise.all(Array.from({ length: PACK_CONCURRENCY }, worker))
    if (live() && !pack.controllers.size) { pack.state = pack.failed ? 'done-with-errors' : 'done'; emitPack(true) }
  }

  async function packStart() {
    if (pack.state === 'running') return packStatus()
    await getCatalog()
    const remaining = []
    let bytesDone = 0
    for (const entry of catalog.entries) {
      if (await isCached(entry)) bytesDone += entry.fileSize
      else remaining.push(entry)
    }
    const bytesTotal = catalog.entries.reduce((sum, entry) => sum + entry.fileSize, 0)
    const needed = remaining.reduce((sum, entry) => sum + entry.fileSize, 0)
    try {
      await fsp.mkdir(cacheDir, { recursive: true })
      const stats = await statfs(cacheDir)
      const free = Number(stats.bavail) * Number(stats.bsize)
      if (Number.isFinite(free) && free < needed * 1.05 + 256 * 1024 * 1024) {
        throw new SfxError(`Not enough free disk space: the pack needs ${(needed / 1e9).toFixed(1)} GB.`, 'NO_SPACE')
      }
    } catch (error) { if (error?.code === 'NO_SPACE') throw error }
    Object.assign(pack, { state: 'running', total: catalog.entries.length, completed: catalog.entries.length - remaining.length,
      failed: 0, bytesTotal, bytesDone, errors: [], queue: remaining })
    emitPack(true)
    runPackWorkers().catch(error => { pack.state = 'error'; pack.errors.push({ id: null, message: error.message }); emitPack(true) })
    return packStatus()
  }

  function packPause() {
    if (pack.state !== 'running') return packStatus()
    pack.state = 'paused'
    pack.generation += 1
    for (const controller of pack.controllers.values()) controller.abort()
    emitPack(true)
    return packStatus()
  }

  function packResume() {
    if (pack.state !== 'paused') return packStatus()
    pack.state = 'running'
    emitPack(true)
    runPackWorkers().catch(error => { pack.state = 'error'; pack.errors.push({ id: null, message: error.message }); emitPack(true) })
    return packStatus()
  }

  async function packCancel() {
    const active = [...pack.controllers.keys()]
    pack.state = 'canceled'
    pack.generation += 1
    for (const controller of pack.controllers.values()) controller.abort()
    // Let aborted streams close, then drop their partial files.
    await Promise.allSettled(active.map(id => inflight.get(id)).filter(Boolean))
    await Promise.all(active.map(id => byId.get(id)).filter(Boolean).map(entry => fsp.rm(`${destFor(entry)}.part`, { force: true })))
    pack.queue = []
    emitPack(true)
    return packStatus()
  }

  async function cacheInfo() {
    let bytes = 0, files = 0
    const walk = async (dir) => {
      let items = []
      try { items = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const item of items) {
        const full = path.join(dir, item.name)
        if (item.isDirectory()) await walk(full)
        else if (!item.name.endsWith('.part') && item.name !== 'sfx-catalog.json') { files += 1; bytes += (await fsp.stat(full)).size }
      }
    }
    await walk(cacheDir)
    return { cacheDir, files, bytes }
  }

  async function clearCache() {
    if (pack.state === 'running' || inflight.size) throw new SfxError('Wait for downloads to finish or pause them first.', 'BUSY')
    const items = await fsp.readdir(cacheDir, { withFileTypes: true }).catch(() => [])
    for (const item of items) {
      if (item.isDirectory()) await fsp.rm(path.join(cacheDir, item.name), { recursive: true, force: true })
    }
    return cacheInfo()
  }

  return { getCatalog, resolve, status, previewSource, packStart, packPause, packResume, packCancel, packStatus, cacheInfo, clearCache,
    _internal: { downloadEntry, entryFor } }
}

const message = error => ({ success: false, error: error?.message || String(error), code: error?.code || null })

/** IPC surface. Arguments are ids and flags only. */
function registerSfxLibraryIpc(ipcMain, library, { toFileUrl } = {}) {
  const handle = (channel, fn) => ipcMain.handle(channel, async (_event, ...args) => {
    try { return { success: true, ...(await fn(...args)) } } catch (error) { return message(error) }
  })
  handle('sfx:getCatalog', async (opts) => library.getCatalog({ refresh: opts?.refresh === true }))
  handle('sfx:resolve', async (id) => library.resolve(String(id || '')))
  handle('sfx:status', async (ids) => ({ status: await library.status(ids) }))
  handle('sfx:previewSource', async (id) => {
    const source = await library.previewSource(String(id || ''))
    return source.cached ? { cached: true, url: toFileUrl ? toFileUrl(source.path) : source.path } : source
  })
  handle('sfx:pack:start', async () => ({ pack: await library.packStart() }))
  handle('sfx:pack:pause', async () => ({ pack: await library.packPause() }))
  handle('sfx:pack:resume', async () => ({ pack: await library.packResume() }))
  handle('sfx:pack:cancel', async () => ({ pack: await library.packCancel() }))
  handle('sfx:pack:status', async () => ({ pack: await library.packStatus() }))
  handle('sfx:cache:info', async () => library.cacheInfo())
  handle('sfx:cache:clear', async () => library.clearCache())
}

module.exports = { createSfxLibrary, registerSfxLibraryIpc, downloadEntry, SfxError, SETTINGS_KEY, isAllowedUrl }
