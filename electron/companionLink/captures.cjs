'use strict'

// Media captured in the browser ("Send to Drama Studio"), received in chunks
// (docs/PLAN_AI_BROWSER_WORKSPACE.md, step 1).
//
// capture.begin declares the type, size and sha-256 up front; chunks must then
// arrive in order and are streamed to a temporary file in
// <userData>/companion/inbox while a running sha-256 is kept. capture.end
// checks size and hash, renames the file, writes a small JSON record beside it
// and reports it to the app, which imports it into the open project. Anything
// left half-sent is removed after 10 idle minutes.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { CAPTURE_CHUNK_BYTES, CAPTURE_MIME_TYPES, MAX_CAPTURE_BYTES, isObjectId } = require('./protocol.cjs')

const CAPTURE_IDLE_MS = 10 * 60 * 1000
const MAX_ACTIVE_CAPTURES = 4
const PARTIAL_PREFIX = '.partial-'

const EXTENSION_FOR_MIME = Object.freeze({
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
})

/** A file name safe on every platform, without the extension. */
function safeBaseName(name) {
  const base = String(name || '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
  return base || 'capture'
}

function createCaptureStore({
  inboxDir,
  now = Date.now,
  randomBytes = crypto.randomBytes,
  idleMs = CAPTURE_IDLE_MS,
  fsImpl = fs,
  onCapture = () => {},
  log = () => {},
}) {
  const active = new Map()

  const discard = (captureId) => {
    const entry = active.get(captureId)
    if (!entry) return
    active.delete(captureId)
    try { fsImpl.closeSync(entry.fd) } catch { /* already closed */ }
    try { fsImpl.unlinkSync(entry.partialPath) } catch { /* already gone */ }
  }

  const sweep = () => {
    const current = now()
    for (const [captureId, entry] of active) if (entry.lastActivity + idleMs <= current) discard(captureId)
    // Partials from an earlier run that never finished.
    let names = []
    try { names = fsImpl.readdirSync(inboxDir) } catch { return }
    for (const name of names) {
      if (!name.startsWith(PARTIAL_PREFIX)) continue
      const captureId = name.slice(PARTIAL_PREFIX.length)
      if (active.has(captureId)) continue
      try {
        const stat = fsImpl.statSync(path.join(inboxDir, name))
        if (stat.mtimeMs + idleMs <= current) fsImpl.unlinkSync(path.join(inboxDir, name))
      } catch { /* raced with another sweep */ }
    }
  }

  const fail = (captureId, code) => {
    discard(captureId)
    return { code }
  }

  return {
    begin({ jobId = null, site, prompt = null, mime, bytes, sha256, name, origin }) {
      sweep()
      if (!CAPTURE_MIME_TYPES.includes(mime)) return { code: 'capture-refused' }
      if (!Number.isSafeInteger(bytes) || bytes < 1) return { code: 'capture-refused' }
      if (bytes > MAX_CAPTURE_BYTES) return { code: 'too-large' }
      if (active.size >= MAX_ACTIVE_CAPTURES) return { code: 'capture-refused' }
      fsImpl.mkdirSync(inboxDir, { recursive: true })
      const captureId = randomBytes(12).toString('base64url')
      const partialPath = path.join(inboxDir, `${PARTIAL_PREFIX}${captureId}`)
      const fd = fsImpl.openSync(partialPath, 'wx')
      active.set(captureId, {
        captureId,
        jobId,
        site,
        prompt,
        mime,
        bytes,
        sha256,
        name: safeBaseName(name),
        origin,
        fd,
        partialPath,
        hash: crypto.createHash('sha256'),
        received: 0,
        nextIndex: 0,
        lastActivity: now(),
      })
      return { captureId }
    },

    chunk({ captureId, index, data, origin }) {
      if (!isObjectId(captureId)) return { code: 'capture-refused' }
      const entry = active.get(captureId)
      if (!entry || entry.origin !== origin) return { code: 'capture-refused' }
      if (index !== entry.nextIndex) return fail(captureId, 'capture-corrupt')
      const buffer = Buffer.from(String(data || ''), 'base64')
      if (buffer.length < 1 || buffer.length > CAPTURE_CHUNK_BYTES) return fail(captureId, 'capture-corrupt')
      if (entry.received + buffer.length > entry.bytes) return fail(captureId, 'too-large')
      let written = 0
      while (written < buffer.length) written += fsImpl.writeSync(entry.fd, buffer, written, buffer.length - written)
      entry.hash.update(buffer)
      entry.received += buffer.length
      entry.nextIndex += 1
      entry.lastActivity = now()
      return { ok: true }
    },

    end({ captureId, origin }) {
      if (!isObjectId(captureId)) return { code: 'capture-refused' }
      const entry = active.get(captureId)
      if (!entry || entry.origin !== origin) return { code: 'capture-refused' }
      if (entry.received !== entry.bytes) return fail(captureId, 'capture-corrupt')
      const digest = entry.hash.digest('hex')
      if (digest !== entry.sha256) return fail(captureId, 'capture-corrupt')
      active.delete(captureId)
      try { fsImpl.closeSync(entry.fd) } catch { /* already closed */ }
      const fileName = `${captureId}-${entry.name}${EXTENSION_FOR_MIME[entry.mime]}`
      const filePath = path.join(inboxDir, fileName)
      fsImpl.renameSync(entry.partialPath, filePath)
      const record = {
        version: 1,
        captureId,
        fileName,
        site: entry.site,
        prompt: entry.prompt,
        jobId: entry.jobId,
        mime: entry.mime,
        bytes: entry.bytes,
        sha256: entry.sha256,
        name: entry.name,
        capturedAt: new Date(now()).toISOString(),
        origin: entry.origin,
      }
      fsImpl.writeFileSync(path.join(inboxDir, `${captureId}.json`), JSON.stringify(record, null, 2), 'utf8')
      const result = { ...record, filePath }
      try { onCapture(result) } catch (error) { log(`capture listener failed: ${error?.message || error}`) }
      return { record: result }
    },

    /** Finished captures still waiting to be imported. */
    listInbox() {
      let names = []
      try { names = fsImpl.readdirSync(inboxDir) } catch { return [] }
      const records = []
      for (const name of names) {
        if (!/^[A-Za-z0-9_-]{8,64}\.json$/.test(name)) continue
        try {
          const record = JSON.parse(fsImpl.readFileSync(path.join(inboxDir, name), 'utf8'))
          if (!isObjectId(record?.captureId) || typeof record.fileName !== 'string') continue
          const filePath = path.join(inboxDir, path.basename(record.fileName))
          if (!fsImpl.existsSync(filePath)) continue
          records.push({ ...record, filePath })
        } catch { /* skip a broken record */ }
      }
      return records.sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)))
    },

    /** After the app imported a capture (or the person dismissed it). */
    remove(captureId) {
      if (!isObjectId(captureId)) return false
      const recordPath = path.join(inboxDir, `${captureId}.json`)
      let removed = false
      try {
        const record = JSON.parse(fsImpl.readFileSync(recordPath, 'utf8'))
        const filePath = path.join(inboxDir, path.basename(String(record.fileName || '')))
        if (path.basename(filePath).startsWith(`${captureId}-`)) {
          try { fsImpl.unlinkSync(filePath); removed = true } catch { /* already gone */ }
        }
      } catch { /* no record */ }
      try { fsImpl.unlinkSync(recordPath); removed = true } catch { /* already gone */ }
      return removed
    },

    sweep,
    activeCount: () => active.size,
  }
}

module.exports = { CAPTURE_IDLE_MS, EXTENSION_FOR_MIME, createCaptureStore, safeBaseName }
