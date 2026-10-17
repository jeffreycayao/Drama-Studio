'use strict'

// Browser jobs (docs/PLAN_AI_BROWSER_WORKSPACE.md, step 1). Drama Studio
// creates a job (prompt, settings, reference files) and opens the AI site
// with #dsjob=<token>. The Companion on that page fetches the job once with
// the token, then reads the references in chunks and reports progress.
//
// - The token works once and only for 5 minutes; only it is in a URL.
// - The job then lives for 60 minutes, bound to the browser that fetched it:
//   reference reads and updates from any other browser are refused.
// - References are image or video files the person picked, checked here
//   (type, size, still a regular file) before anything is sent.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  ASSET_CHUNK_BYTES,
  JOB_ASPECTS,
  JOB_KINDS,
  JOB_STATES,
  MAX_PROMPT_CHARS,
  MAX_REFERENCE_BYTES,
  isHandoffToken,
  isObjectId,
} = require('./protocol.cjs')
const { CompanionLinkError } = require('./handoffs.cjs')

const JOB_TOKEN_TTL_MS = 5 * 60 * 1000
const JOB_TTL_MS = 60 * 60 * 1000
const MAX_JOBS = 50
const MAX_REFERENCES = 8

// AI sites a job can open. The Companion has an adapter for each one; keep
// the ids in step with extensions/companion/src/sites/job-sites.ts.
const JOB_SITES = Object.freeze([
  { id: 'grok-imagine', label: 'Grok Imagine', url: 'https://grok.com/imagine', kinds: ['image', 'video'] },
].map((site) => Object.freeze(site)))

const REFERENCE_TYPES = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
})

const findJobSite = (siteId) => JOB_SITES.find((site) => site.id === siteId) || null

function cleanParams(params) {
  const value = params && typeof params === 'object' ? params : {}
  const clean = {}
  if (value.aspect !== undefined && value.aspect !== null && value.aspect !== '') {
    if (!JOB_ASPECTS.includes(value.aspect)) throw new CompanionLinkError('Pick one of the listed aspect ratios.')
    clean.aspect = value.aspect
  }
  if (value.durationSeconds !== undefined && value.durationSeconds !== null && value.durationSeconds !== '') {
    const seconds = Number(value.durationSeconds)
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) throw new CompanionLinkError('Length must be 1 to 60 seconds.')
    clean.durationSeconds = seconds
  }
  return clean
}

function createJobStore({
  now = Date.now,
  randomBytes = crypto.randomBytes,
  tokenTtlMs = JOB_TOKEN_TTL_MS,
  jobTtlMs = JOB_TTL_MS,
  fsImpl = fs,
  onUpdate = () => {},
} = {}) {
  const jobs = new Map()
  const tokens = new Map()

  const newId = (bytes) => randomBytes(bytes).toString('base64url')

  const prune = () => {
    const current = now()
    for (const [token, entry] of tokens) if (entry.expiresAt <= current) tokens.delete(token)
    for (const [jobId, job] of jobs) if (job.expiresAt <= current) jobs.delete(jobId)
    while (jobs.size > MAX_JOBS) jobs.delete(jobs.keys().next().value)
  }

  const summary = (job) => ({
    jobId: job.jobId,
    siteId: job.siteId,
    kind: job.kind,
    prompt: job.prompt,
    params: { ...job.params },
    references: job.references.map(({ refId, name, mime, bytes }) => ({ refId, name, mime, bytes })),
    state: job.state,
    reason: job.reason,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt,
  })

  function checkReference(entry, index) {
    const filePath = typeof entry?.path === 'string' ? entry.path : ''
    if (!filePath || !path.isAbsolute(filePath)) throw new CompanionLinkError('A reference file could not be found.')
    const mime = REFERENCE_TYPES[path.extname(filePath).toLowerCase()]
    if (!mime) throw new CompanionLinkError('References must be PNG, JPEG, WebP or GIF images, or MP4, WebM or MOV videos.')
    let stat
    try {
      stat = fsImpl.statSync(filePath)
    } catch {
      throw new CompanionLinkError('A reference file could not be found.')
    }
    if (!stat.isFile()) throw new CompanionLinkError('A reference file could not be found.')
    if (stat.size < 1 || stat.size > MAX_REFERENCE_BYTES) throw new CompanionLinkError('Each reference file must be 50 MB or smaller.')
    const fallbackName = path.basename(filePath)
    const name = String(entry?.name || fallbackName).replace(/[\u0000-\u001f]/g, '').slice(0, 200) || `reference-${index + 1}`
    return { refId: newId(9), name, mime, bytes: stat.size, path: filePath }
  }

  function findJob(jobId, origin) {
    prune()
    if (!isObjectId(jobId)) return { code: 'job-not-found' }
    const job = jobs.get(jobId)
    if (!job) return { code: 'job-expired' }
    if (!job.origin || job.origin !== origin) return { code: 'job-not-found' }
    return { job }
  }

  return {
    /** Called by the app: validates everything before a URL is made. */
    create({ siteId, kind, prompt, params, references = [] }) {
      const site = findJobSite(siteId)
      if (!site) throw new CompanionLinkError('Pick one of the listed sites.')
      if (!JOB_KINDS.includes(kind) || !site.kinds.includes(kind)) throw new CompanionLinkError(`${site.label} cannot make that kind of result.`)
      const text = typeof prompt === 'string' ? prompt : ''
      if (!text.trim()) throw new CompanionLinkError('There is no prompt to send.')
      if (text.length > MAX_PROMPT_CHARS) throw new CompanionLinkError('This prompt is too long to send (200,000 characters at most).')
      // The job.reply must fit in one native message.
      if (Buffer.byteLength(JSON.stringify(text), 'utf8') > 900 * 1024) throw new CompanionLinkError('This prompt is too large to send in one piece.')
      const list = Array.isArray(references) ? references : []
      if (list.length > MAX_REFERENCES) throw new CompanionLinkError(`Send ${MAX_REFERENCES} reference files at most.`)
      const checked = list.map(checkReference)
      prune()
      const current = now()
      const job = {
        jobId: newId(12),
        siteId: site.id,
        kind,
        prompt: text,
        params: cleanParams(params),
        references: checked,
        state: 'queued',
        reason: '',
        origin: null,
        createdAt: current,
        updatedAt: current,
        expiresAt: current + jobTtlMs,
      }
      const token = newId(24)
      jobs.set(job.jobId, job)
      tokens.set(token, { jobId: job.jobId, expiresAt: current + tokenTtlMs })
      prune()
      onUpdate(summary(job))
      return { jobId: job.jobId, token, siteId: site.id, url: `${site.url}#dsjob=${token}`, expiresAt: current + tokenTtlMs }
    },

    /** The Companion's job.fetch: once per token; binds the job to that browser. */
    take(token, origin) {
      prune()
      if (!isHandoffToken(token)) return { code: 'job-expired' }
      const entry = tokens.get(token)
      tokens.delete(token)
      if (!entry || entry.expiresAt <= now()) return { code: 'job-expired' }
      const job = jobs.get(entry.jobId)
      if (!job) return { code: 'job-expired' }
      job.origin = origin
      job.state = 'sent'
      job.updatedAt = now()
      onUpdate(summary(job))
      return { job: summary(job) }
    },

    /** One chunk of a reference file, read at `offset`. */
    readReference(jobId, refId, offset, origin) {
      const found = findJob(jobId, origin)
      if (found.code) return found
      const reference = found.job.references.find((item) => item.refId === refId)
      if (!reference) return { code: 'job-not-found' }
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > reference.bytes) return { code: 'protocol' }
      let stat
      try {
        stat = fsImpl.statSync(reference.path)
      } catch {
        return { code: 'job-not-found' }
      }
      // The file changed since the job was made: refuse rather than send a mix.
      if (!stat.isFile() || stat.size !== reference.bytes) return { code: 'job-not-found' }
      const length = Math.min(ASSET_CHUNK_BYTES, reference.bytes - offset)
      const buffer = Buffer.alloc(length)
      let read = 0
      if (length > 0) {
        const fd = fsImpl.openSync(reference.path, 'r')
        try {
          while (read < length) {
            const n = fsImpl.readSync(fd, buffer, read, length - read, offset + read)
            if (n <= 0) break
            read += n
          }
        } finally {
          fsImpl.closeSync(fd)
        }
      }
      if (read !== length) return { code: 'job-not-found' }
      return {
        chunk: {
          jobId,
          refId,
          offset,
          data: buffer.toString('base64'),
          done: offset + length >= reference.bytes,
          bytes: reference.bytes,
        },
      }
    },

    /** The Companion's job.update. */
    update(jobId, state, reason, origin) {
      const found = findJob(jobId, origin)
      if (found.code) return found
      if (!JOB_STATES.includes(state)) return { code: 'protocol' }
      const { job } = found
      job.state = state
      job.reason = typeof reason === 'string' ? reason.slice(0, 200) : ''
      job.updatedAt = now()
      onUpdate(summary(job))
      return { job: summary(job) }
    },

    /** Whether a capture may name this job (same browser, still alive). */
    isJobFor(jobId, origin) {
      return !findJob(jobId, origin).code
    },

    list() {
      prune()
      return [...jobs.values()].map(summary).sort((a, b) => b.createdAt - a.createdAt)
    },

    size: () => { prune(); return jobs.size },
  }
}

module.exports = {
  JOB_SITES,
  JOB_TOKEN_TTL_MS,
  JOB_TTL_MS,
  MAX_REFERENCES,
  REFERENCE_TYPES,
  findJobSite,
  createJobStore,
}
