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
const PROTOCOL_VERSION = 1

const DESKTOP_ERROR_CODES = Object.freeze([
  'permission-missing',
  'host-missing',
  'app-not-running',
  'not-paired',
  'handoff-expired',
  'handoff-wrong-site',
  'timeout',
  'protocol',
])

const HANDOFF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/
const EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/([a-p]{32})\/$/
const MAX_PROMPT_CHARS = 200_000
// Chrome refuses messages over 1 MB from a native host. Requests are capped
// at the same size: nothing the link accepts today is larger (media capture
// will use chunks).
const MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024
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
  if (!isPlainObject(value) || id === UNKNOWN_REQUEST_ID || value.protocol !== PROTOCOL_VERSION) return refuse

  if (value.type === 'hello') {
    if (!hasExactKeys(value, ['type', 'id', 'protocol', 'extVersion', 'browser'])) return refuse
    if (!isBoundedString(value.extVersion, 32) || !isBoundedString(value.browser, 64)) return refuse
    return { ok: true, request: { type: 'hello', id, extVersion: value.extVersion, browser: value.browser } }
  }
  if (value.type === 'handoff.fetch') {
    if (!hasExactKeys(value, ['type', 'id', 'protocol', 'token']) || !isHandoffToken(value.token)) return refuse
    return { ok: true, request: { type: 'handoff.fetch', id, token: value.token } }
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

function errorReply(id, code) {
  return {
    type: 'error',
    id: isRequestId(id) ? id : UNKNOWN_REQUEST_ID,
    code: DESKTOP_ERROR_CODES.includes(code) ? code : 'protocol',
  }
}

/** Light check the host applies to app replies before passing them on. */
function isDesktopReplyFor(value, id) {
  return isPlainObject(value) && value.id === id &&
    (value.type === 'hello.reply' || value.type === 'handoff.reply' || value.type === 'error')
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
  MAX_NATIVE_MESSAGE_BYTES,
  UNKNOWN_REQUEST_ID,
  isHandoffToken,
  isRequestId,
  extensionIdFromOrigin,
  parseCompanionRequest,
  helloReply,
  handoffReply,
  errorReply,
  isDesktopReplyFor,
  encodeNativeMessage,
  createNativeMessageDecoder,
  encodeLine,
  createLineDecoder,
}
