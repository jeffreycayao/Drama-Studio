'use strict'

/**
 * Stock-media downloads for the Stock tab (main process). Some providers'
 * file hosts send no CORS headers (NASA) or reject browser requests
 * (Pixabay's CDN), so the renderer asks main to fetch the file.
 *
 * Only https URLs on public hosts are fetched: the hostname text is checked
 * and, through createPublicLookup, every address it resolves to, on every
 * redirect hop (Openverse results come from arbitrary hosts, so there is no
 * host allowlist). Only image/* or video/* responses are kept, size is capped, and the
 * file lands in a temp folder that the renderer then imports into the project.
 * Old temp files are pruned on each call.
 */

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const https = require('https')
const { isAllowedProtocol } = require('./sfxCatalog.cjs')
const { createPublicLookup } = require('./publicLookup.cjs')

const MAX_REDIRECTS = 5
const IDLE_TIMEOUT_MS = 30000
const MAX_BYTES = { photo: 150 * 1024 * 1024, video: 4 * 1024 * 1024 * 1024 }
const KEEP_MS = 24 * 60 * 60 * 1000
const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/tiff': 'tif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv', 'video/quicktime': 'mov', 'application/ogg': 'ogv',
}

class StockDownloadError extends Error {
  constructor(message, code) { super(message); this.code = code }
}

function safeStem(value) {
  return String(value || 'stock').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'stock'
}

function get(url, { request = https.get, lookup = createPublicLookup(), redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let target
    try { target = new URL(url) } catch { reject(new StockDownloadError('The download address is not valid.', 'BAD_URL')); return }
    if (!isAllowedProtocol(target) || target.username || target.password) {
      reject(new StockDownloadError('Stock downloads must use https on a public host.', 'BAD_URL'))
      return
    }
    // agent: false so a pooled socket opened without this lookup is never reused.
    const req = request(target, { headers: { 'User-Agent': 'DramaStudio-Stock/1', Accept: 'image/*,video/*;q=0.9,*/*;q=0.5' }, lookup, agent: false }, (res) => {
      const status = res.statusCode || 0
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume()
        if (redirects >= MAX_REDIRECTS) { reject(new StockDownloadError('Too many redirects.', 'REDIRECTS')); return }
        get(new URL(res.headers.location, target).href, { request, lookup, redirects: redirects + 1 }).then(resolve, reject)
        return
      }
      resolve(res)
    })
    req.setTimeout(IDLE_TIMEOUT_MS, () => req.destroy(new StockDownloadError('The download timed out.', 'TIMEOUT')))
    req.on('error', (error) => reject(error?.code === 'PRIVATE_ADDRESS'
      ? new StockDownloadError('Stock downloads must use https on a public host.', 'BAD_URL')
      : error))
  })
}

async function pruneOld(dir, now = Date.now()) {
  const items = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const item of items) {
    const full = path.join(dir, item.name)
    const stat = await fsp.stat(full).catch(() => null)
    if (stat && now - stat.mtimeMs > KEEP_MS) await fsp.rm(full, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Download one stock file into `tempDir`. Returns { path, mime, bytes }.
 * @param {{ url: string, provider: string, id: string, mediaType: 'photo'|'video' }} input
 */
async function downloadStockFile(input, { tempDir, request, lookup } = {}) {
  const mediaType = input?.mediaType === 'video' ? 'video' : 'photo'
  const limit = MAX_BYTES[mediaType]
  await fsp.mkdir(tempDir, { recursive: true })
  await pruneOld(tempDir)
  const res = await get(String(input?.url || ''), { request, lookup })
  const status = res.statusCode || 0
  if (status !== 200) { res.resume(); throw new StockDownloadError(`The stock site answered HTTP ${status}.`, 'HTTP_STATUS') }
  const mime = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  const wanted = mediaType === 'video' ? /^(video\/|application\/ogg$)/ : /^image\//
  if (!wanted.test(mime)) { res.resume(); throw new StockDownloadError(`Expected ${mediaType === 'video' ? 'a video' : 'an image'} but got ${mime || 'an unknown file type'}.`, 'BAD_TYPE') }
  const declared = Number(res.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) { res.resume(); throw new StockDownloadError('The file is too large to import.', 'TOO_LARGE') }
  const ext = EXT_BY_MIME[mime] || (mediaType === 'video' ? 'mp4' : 'jpg')
  // One folder per download keeps the plain <provider>_<id> name for the project copy.
  const dest = path.join(tempDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, `${safeStem(input?.provider)}_${safeStem(input?.id)}.${ext}`)
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  const part = `${dest}.part`
  let bytes = 0
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(part)
    const fail = (error) => { res.destroy(); out.destroy(); fsp.rm(part, { force: true }).catch(() => {}); reject(error) }
    res.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > limit) fail(new StockDownloadError('The file is too large to import.', 'TOO_LARGE'))
    })
    res.on('error', fail)
    res.on('aborted', () => fail(new StockDownloadError('The connection closed early.', 'ABORTED')))
    out.on('error', fail)
    out.on('finish', resolve)
    res.pipe(out)
  })
  if (!bytes) { await fsp.rm(part, { force: true }); throw new StockDownloadError('The stock site sent an empty file.', 'EMPTY') }
  await fsp.rename(part, dest)
  return { path: dest, mime, bytes }
}

function registerStockDownloadIpc(ipcMain, { tempDir }) {
  ipcMain.handle('stock:download', async (_event, input) => {
    try {
      return { success: true, ...(await downloadStockFile(input && typeof input === 'object' ? input : {}, { tempDir: tempDir() })) }
    } catch (error) {
      return { success: false, error: error?.message || String(error), code: error?.code || null }
    }
  })
}

module.exports = { StockDownloadError, downloadStockFile, registerStockDownloadIpc }
