'use strict'

// Wire format between Drama Studio Companion and the desktop app (plan §4).
// It mirrors extensions/companion/src/desktop/contracts.ts (Zod): keep the two
// in step and bump PROTOCOL_VERSION on both sides for a breaking change.
//
// Two framings are used:
// - browser <-> native host: Chrome native messaging (4-byte length in native
//   byte order, then UTF-8 JSON);
// - native host <-> app: one JSON object per line over a per-user pipe.

const NATIVE_HOST_NAME = 'com.dramastudio.companion'
// v2 adds browser jobs, reference reads and media capture. hello and
// handoff.fetch are accepted as v1 or v2, so Companion 0.1.0 keeps working.
const PROTOCOL_VERSION = 2
const V1_REQUEST_TYPES = Object.freeze(['hello', 'handoff.fetch'])

const DESKTOP_ERROR_CODES = Object.freeze([
  'permission-missing',
  'host-missing',
  'app-not-running',
  'not-paired',
  'handoff-expired',
  'handoff-wrong-site',
  'timeout',
  'protocol',
  'job-expired',
  'job-not-found',
  'capture-refused',
  'capture-corrupt',
  'too-large',
])

const HANDOFF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
const OBJECT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/
const EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/([a-p]{32})\/$/
const MAX_PROMPT_CHARS = 200_000
// A captured result's prompt travels in capture.begin; keep it modest.
const MAX_CAPTURE_PROMPT_CHARS = 20_000
// Chrome refuses messages over 1 MB from a native host, so everything sent
// to the browser stays under it (reference reads use small chunks).
const MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024
// The browser may send up to 64 MB per message; capture chunks are 4 MB of
// media (about 5.4 MB as base64), so inbound messages are capped at 12 MB.
const MAX_INBOUND_MESSAGE_BYTES = 12 * 1024 * 1024
const ASSET_CHUNK_BYTES = 512 * 1024
const CAPTURE_CHUNK_BYTES = 4 * 1024 * 1024
const MAX_CAPTURE_BYTES = 1024 * 1024 * 1024
const MAX_REFERENCE_BYTES = 50 * 1024 * 1024
const CAPTURE_MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/wav', 'audio/mp4'])
// 'audio' is a song from a music site (Suno); its words and settings travel
// in params (lyrics, title, custom, instrumental).
const JOB_KINDS = Object.freeze(['image', 'video', 'audio'])
const MAX_LYRICS_CHARS = 5000
const MAX_SONG_TITLE_CHARS = 100
const JOB_STATES = Object.freeze(['filling', 'waiting-user', 'generating', 'stopped', 'failed', 'done'])
const JOB_ASPECTS = Object.freeze(['16:9', '9:16', '1:1', '4:3', '3:4'])
// Used as the reply id when a request had no usable id of its own.
const UNKNOWN_REQUEST_ID = 'unknown-request'

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isRequestId = (value) => typeof value === 'string' && value.length >= 8 && value.length <= 64
const hasExactKeys = (value, keys) => {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}
const isBoundedString = (value, max) => typeof value === 'string' && value.length <= max

function isHandoffToken(value) {
  return typeof value === 'string' && HANDOFF_TOKEN_PATTERN.test(value)
}

const isObjectId = (value) => typeof value === 'string' && OBJECT_ID_PATTERN.test(value)
const isNonNegativeInt = (value) => Number.isSafeInteger(value) && value >= 0

/** Exact keys, where `optional` keys may be left out. */
const hasKeys = (value, required, optional = []) => {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
}

const isBase64Chunk = (value, maxRawBytes) => typeof value === 'string' &&
  value.length > 0 && value.length % 4 === 0 &&
  value.length <= Math.ceil(maxRawBytes / 3) * 4 && BASE64_PATTERN.test(value)

/** `chrome-extension://<id>/` as Chrome passes it to the host, else null. */
function extensionIdFromOrigin(origin) {
  const match = typeof origin === 'string' ? EXTENSION_ORIGIN_PATTERN.exec(origin) : null
  return match ? match[1] : null
}

/**
 * Validates one Companion -> desktop request. Shapes are strict, like the
 * Companion's strictObject schemas: unknown or missing keys are refused.
 * @returns {{ ok: true, request: object } | { ok: false, id: string, code: 'protocol' }}
 */
function parseCompanionRequest(value) {
  const id = isPlainObject(value) && isRequestId(value.id) ? value.id : UNKNOWN_REQUEST_ID
  const refuse = { ok: false, id, code: 'protocol' }
  if (!isPlainObject(value) || id === UNKNOWN_REQUEST_ID) return refuse
  const versionOk = value.protocol === PROTOCOL_VERSION ||
    (value.protocol === 1 && V1_REQUEST_TYPES.includes(value.type))
  if (!versionOk) return refuse
  const base = ['type', 'id', 'protocol']

  if (value.type === 'hello') {
    if (!hasExactKeys(value, [...base, 'extVersion', 'browser'])) return refuse
    if (!isBoundedString(value.extVersion, 32) || !isBoundedString(value.browser, 64)) return refuse
    return { ok: true, request: { type: 'hello', id, extVersion: value.extVersion, browser: value.browser } }
  }
  if (value.type === 'handoff.fetch') {
    if (!hasExactKeys(value, [...base, 'token']) || !isHandoffToken(value.token)) return refuse
    return { ok: true, request: { type: 'handoff.fetch', id, token: value.token } }
  }
  if (value.type === 'job.fetch') {
    if (!hasExactKeys(value, [...base, 'token']) || !isHandoffToken(value.token)) return refuse
    return { ok: true, request: { type: 'job.fetch', id, token: value.token } }
  }
  if (value.type === 'asset.read') {
    if (!hasExactKeys(value, [...base, 'jobId', 'refId', 'offset'])) return refuse
    if (!isObjectId(value.jobId) || !isObjectId(value.refId) || !isNonNegativeInt(value.offset)) return refuse
    return { ok: true, request: { type: 'asset.read', id, jobId: value.jobId, refId: value.refId, offset: value.offset } }
  }
  if (value.type === 'job.update') {
    if (!hasKeys(value, [...base, 'jobId', 'state'], ['reason'])) return refuse
    if (!isObjectId(value.jobId) || !JOB_STATES.includes(value.state)) return refuse
    if (value.reason !== undefined && !isBoundedString(value.reason, 200)) return refuse
    return { ok: true, request: { type: 'job.update', id, jobId: value.jobId, state: value.state, reason: value.reason || '' } }
  }
  if (value.type === 'capture.begin') {
    if (!hasExactKeys(value, [...base, 'jobId', 'site', 'prompt', 'mime', 'bytes', 'sha256', 'name'])) return refuse
    if (value.jobId !== null && !isObjectId(value.jobId)) return refuse
    if (!isBoundedString(value.site, 32) || !value.site) return refuse
    if (value.prompt !== null && !isBoundedString(value.prompt, MAX_CAPTURE_PROMPT_CHARS)) return refuse
    if (!CAPTURE_MIME_TYPES.includes(value.mime) || !SHA256_PATTERN.test(String(value.sha256))) return refuse
    if (!Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_CAPTURE_BYTES) return refuse
    if (!isBoundedString(value.name, 200)) return refuse
    return {
      ok: true,
      request: { type: 'capture.begin', id, jobId: value.jobId, site: value.site, prompt: value.prompt, mime: value.mime, bytes: value.bytes, sha256: value.sha256, name: value.name },
    }
  }
  if (value.type === 'capture.chunk') {
    if (!hasExactKeys(value, [...base, 'captureId', 'index', 'data'])) return refuse
    if (!isObjectId(value.captureId) || !isNonNegativeInt(value.index) || !isBase64Chunk(value.data, CAPTURE_CHUNK_BYTES)) return refuse
    return { ok: true, request: { type: 'capture.chunk', id, captureId: value.captureId, index: value.index, data: value.data } }
  }
  if (value.type === 'capture.end') {
    if (!hasExactKeys(value, [...base, 'captureId']) || !isObjectId(value.captureId)) return refuse
    return { ok: true, request: { type: 'capture.end', id, captureId: value.captureId } }
  }
  // batch.progress / batch.stopped have schemas in the Companion but no
  // desktop side yet (Assisted batch, plan §4 mode 3).
  return refuse
}

const helloReply = (id, { appVersion, paired }) => ({
  type: 'hello.reply',
  id,
  appVersion: String(appVersion || '').slice(0, 32),
  paired: paired === true,
})

const handoffReply = (id, { prompt, site }) => ({ type: 'handoff.reply', id, prompt, site })

const jobReply = (id, { jobId, site, kind, prompt, params, references }) => ({
  type: 'job.reply',
  id,
  jobId,
  site,
  kind,
  prompt,
  params: { ...params },
  references: references.map(({ refId, name, mime, bytes }) => ({ refId, name, mime, bytes })),
})

const assetChunkReply = (id, { jobId, refId, offset, data, done, bytes }) => ({
  type: 'asset.chunk', id, jobId, refId, offset, data, done, bytes,
})

const ackReply = (id) => ({ type: 'ack', id })

const captureReadyReply = (id, { captureId }) => ({ type: 'capture.ready', id, captureId, chunkBytes: CAPTURE_CHUNK_BYTES })

const captureDoneReply = (id, { captureId }) => ({ type: 'capture.done', id, captureId })

const REPLY_TYPES = Object.freeze(['hello.reply', 'handoff.reply', 'job.reply', 'asset.chunk', 'ack', 'capture.ready', 'capture.done', 'error'])

function errorReply(id, code) {
  return {
    type: 'error',
    id: isRequestId(id) ? id : UNKNOWN_REQUEST_ID,
    code: DESKTOP_ERROR_CODES.includes(code) ? code : 'protocol',
  }
}

/** Light check the host applies to app replies before passing them on. */
function isDesktopReplyFor(value, id) {
  return isPlainObject(value) && value.id === id && REPLY_TYPES.includes(value.type)
}

// --- Chrome native-messaging framing ---------------------------------------

function encodeNativeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  if (body.length > MAX_NATIVE_MESSAGE_BYTES) throw new Error('Native message is larger than 1 MB.')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length, 0)
  return Buffer.concat([header, body])
}

/**
 * Streaming decoder for Chrome's framing. Calls onMessage(value) per frame;
 * onError(error) once for an oversized frame or bad JSON, after which it
 * ignores further input (the caller should stop).
 */
function createNativeMessageDecoder({ onMessage, onError, maxBytes = MAX_NATIVE_MESSAGE_BYTES }) {
  let buffered = Buffer.alloc(0)
  let failed = false
  return {
    push(chunk) {
      if (failed) return
      buffered = buffered.length ? Buffer.concat([buffered, chunk]) : Buffer.from(chunk)
      while (buffered.length >= 4) {
        const length = buffered.readUInt32LE(0)
        if (length > maxBytes) {
          failed = true
          onError(new Error(`Native message of ${length} bytes is over the ${maxBytes}-byte limit.`))
          return
        }
        if (buffered.length < 4 + length) return
        const body = buffered.subarray(4, 4 + length)
        buffered = buffered.subarray(4 + length)
        let value
        try {
          value = JSON.parse(body.toString('utf8'))
        } catch (error) {
          failed = true
          onError(error)
          return
        }
        onMessage(value)
      }
    },
  }
}

// --- Line framing (native host <-> app pipe) -------------------------------

const encodeLine = (message) => `${JSON.stringify(message)}\n`

function createLineDecoder({ onMessage, onError, maxBytes = MAX_NATIVE_MESSAGE_BYTES + 4096 }) {
  let pending = ''
  let failed = false
  return {
    push(chunk) {
      if (failed) return
      pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      let newline = pending.indexOf('\n')
      while (newline !== -1) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        if (line.trim()) {
          let value
          try {
            value = JSON.parse(line)
          } catch (error) {
            failed = true
            onError(error)
            return
          }
          onMessage(value)
        }
        newline = pending.indexOf('\n')
      }
      if (Buffer.byteLength(pending, 'utf8') > maxBytes) {
        failed = true
        onError(new Error('Pipe message is over the size limit.'))
      }
    },
  }
}

module.exports = {
  NATIVE_HOST_NAME,
  PROTOCOL_VERSION,
  DESKTOP_ERROR_CODES,
  HANDOFF_TOKEN_PATTERN,
  MAX_PROMPT_CHARS,
  MAX_CAPTURE_PROMPT_CHARS,
  MAX_NATIVE_MESSAGE_BYTES,
  MAX_INBOUND_MESSAGE_BYTES,
  ASSET_CHUNK_BYTES,
  CAPTURE_CHUNK_BYTES,
  MAX_CAPTURE_BYTES,
  MAX_REFERENCE_BYTES,
  CAPTURE_MIME_TYPES,
  JOB_KINDS,
  MAX_LYRICS_CHARS,
  MAX_SONG_TITLE_CHARS,
  JOB_STATES,
  JOB_ASPECTS,
  UNKNOWN_REQUEST_ID,
  isHandoffToken,
  isObjectId,
  isRequestId,
  extensionIdFromOrigin,
  parseCompanionRequest,
  helloReply,
  handoffReply,
  jobReply,
  assetChunkReply,
  ackReply,
  captureReadyReply,
  captureDoneReply,
  errorReply,
  isDesktopReplyFor,
  encodeNativeMessage,
  createNativeMessageDecoder,
  encodeLine,
  createLineDecoder,
}
