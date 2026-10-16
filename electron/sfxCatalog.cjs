'use strict'
// SFX catalog validation at the main-process trust boundary. A downloaded
// catalog is untrusted input: it decides which URLs main fetches and where
// files land, so ids, URLs, sizes and hashes are validated here, never in the
// renderer. File paths are derived from the id, never taken from the catalog.

const path = require('path')

const SFX_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const SEGMENT_PATTERN = /[^A-Za-z0-9._ -]+/g
const AUDIO_EXTENSIONS = new Set(['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac', 'opus', 'aif', 'aiff'])
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const MAX_FILE_BYTES = 200 * 1024 * 1024
const MAX_ENTRIES = 100000
const MAX_CATALOG_BYTES = 32 * 1024 * 1024

const str = (value, max) => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null

function isLoopbackHost(hostname) {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1'
}

/** https only; plain http only for loopback when explicitly allowed (tests). */
function isAllowedProtocol(url, { allowLoopback = false } = {}) {
  if (url.protocol === 'https:') return true
  return allowLoopback && url.protocol === 'http:' && isLoopbackHost(url.hostname)
}

function parseUrl(value, base) {
  try { return new URL(value, base) } catch { return null }
}

/** Origins a catalog may download from: its own and its declared baseUrl. */
function getAllowedOrigins(catalogUrl, baseUrl, options = {}) {
  const origins = new Set()
  for (const value of [catalogUrl, baseUrl]) {
    const url = value ? parseUrl(value) : null
    if (url && isAllowedProtocol(url, options) && !url.username && !url.password) origins.add(url.origin)
  }
  return origins
}

function isAllowedUrl(value, allowedOrigins, options = {}) {
  const url = typeof value === 'string' ? parseUrl(value) : value
  return Boolean(url && isAllowedProtocol(url, options) && !url.username && !url.password && allowedOrigins.has(url.origin))
}

function safeSegment(value, fallback) {
  const cleaned = String(value || '').replace(SEGMENT_PATTERN, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 64)
  return cleaned || fallback
}

/** Cache location for an entry. Throws if it would escape the cache root. */
function cachePathFor(cacheDir, entry) {
  const root = path.resolve(cacheDir)
  const file = path.resolve(root, safeSegment(entry.category, 'misc'), `${entry.id}.${entry.format}`)
  if (!file.startsWith(root + path.sep)) throw new Error('SFX cache path escapes the cache folder.')
  return file
}

function validateEntry(raw, { baseUrl, allowedOrigins, options }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const id = typeof raw.id === 'string' && SFX_ID_PATTERN.test(raw.id) ? raw.id : null
  const name = str(raw.name, 200)
  const category = str(raw.category, 64)
  if (!id || !name || !category) return null
  const remote = typeof raw.remoteUrl === 'string' ? parseUrl(raw.remoteUrl, baseUrl || undefined) : null
  if (!remote || !isAllowedUrl(remote, allowedOrigins, options)) return null
  const ext = path.posix.extname(remote.pathname).slice(1).toLowerCase()
  const format = AUDIO_EXTENSIONS.has(String(raw.format || '').toLowerCase()) ? String(raw.format).toLowerCase() : ext
  if (!AUDIO_EXTENSIONS.has(format)) return null
  const fileSize = Number(raw.fileSize)
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_FILE_BYTES) return null
  const duration = Number(raw.duration)
  if (!Number.isFinite(duration) || duration < 0 || duration > 3600) return null
  const sha256 = typeof raw.sha256 === 'string' && SHA256_PATTERN.test(raw.sha256.toLowerCase()) ? raw.sha256.toLowerCase() : null
  const tags = Array.isArray(raw.tags)
    ? [...new Set(raw.tags.map(tag => str(tag, 48)).filter(Boolean).map(tag => tag.toLowerCase()))].slice(0, 32)
    : []
  return {
    id, name, category, subCategory: str(raw.subCategory, 64), tags, duration, fileSize, format,
    remoteUrl: remote.href, sha256, license: str(raw.license, 128),
    // The catalog's localPath is only a hint; the real path is derived.
    localPath: `${safeSegment(category, 'misc')}/${id}.${format}`,
  }
}

/** Validate a parsed catalog. Bad entries are dropped and counted. */
function validateCatalog(json, catalogUrl, options = {}) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('The SFX catalog is not a JSON object.')
  if (json.version !== 1) throw new Error('Unsupported SFX catalog version.')
  if (!Array.isArray(json.entries)) throw new Error('The SFX catalog has no entries.')
  if (json.entries.length > MAX_ENTRIES) throw new Error(`The SFX catalog has more than ${MAX_ENTRIES} entries.`)
  const catalog = parseUrl(catalogUrl)
  if (!catalog || !isAllowedProtocol(catalog, options)) throw new Error('The SFX catalog URL must use https.')
  const baseCandidate = typeof json.baseUrl === 'string' ? parseUrl(json.baseUrl, catalog.href) : null
  const baseUrl = baseCandidate && isAllowedProtocol(baseCandidate, options) ? baseCandidate.href : catalog.href
  const allowedOrigins = getAllowedOrigins(catalog.href, baseUrl, options)
  const entries = [], seen = new Set()
  let dropped = 0
  for (const raw of json.entries) {
    const entry = validateEntry(raw, { baseUrl, allowedOrigins, options })
    if (!entry || seen.has(entry.id)) { dropped += 1; continue }
    seen.add(entry.id)
    entries.push(entry)
  }
  return {
    version: 1, name: str(json.name, 120) || 'Sound effects', baseUrl, catalogUrl: catalog.href,
    generatedAt: str(json.generatedAt, 64), entries, dropped, allowedOrigins: [...allowedOrigins],
  }
}

module.exports = {
  SFX_ID_PATTERN, AUDIO_EXTENSIONS, MAX_FILE_BYTES, MAX_CATALOG_BYTES,
  isAllowedProtocol, isAllowedUrl, getAllowedOrigins, cachePathFor, validateCatalog, validateEntry, safeSegment,
}
