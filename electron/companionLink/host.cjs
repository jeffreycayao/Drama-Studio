'use strict'

// The native messaging host (plan §4). Chrome or Edge starts it when the
// Companion calls connectNative('com.dramastudio.companion'), passing the
// extension origin as an argument and talking over stdin/stdout. The host
// holds no state: it proves itself to the running app over the per-user pipe
// and relays each request. When the app is closed it answers app-not-running.
//
// This module is plain Node so tests can drive it with streams; hostMain.cjs
// runs it inside the Drama Studio executable.

const crypto = require('crypto')
const {
  createLineDecoder,
  createNativeMessageDecoder,
  encodeLine,
  encodeNativeMessage,
  errorReply,
  extensionIdFromOrigin,
  isDesktopReplyFor,
  isRequestId,
  MAX_INBOUND_MESSAGE_BYTES,
} = require('./protocol.cjs')
const { createNonce, handshakeProof, isNonce, verifyHandshakeProof } = require('./pairing.cjs')

const CONNECT_TIMEOUT_MS = 1500
const HANDSHAKE_TIMEOUT_MS = 2000
// Under the Companion's 5 s request timeout, so the person sees our answer.
const REPLY_TIMEOUT_MS = 4000

class LinkUnavailableError extends Error {}

/** The extension origin Chrome passes on the command line, else null. */
function findExtensionOrigin(argv) {
  return (argv || []).find((value) => extensionIdFromOrigin(value)) || null
}

/** Opens and authenticates one pipe session to the app. */
async function openAppSession({ connect, secret, origin, randomBytes }) {
  const socket = connect()
  const inbox = []
  const waiters = []
  let closed = false
  const replyWaiters = new Map()

  const failAll = () => {
    closed = true
    while (waiters.length) waiters.shift().reject(new LinkUnavailableError('The app closed the link.'))
    for (const resolve of replyWaiters.values()) resolve(null)
    replyWaiters.clear()
  }
  const decoder = createLineDecoder({
    onMessage: (message) => {
      if (message?.t === 'reply' && replyWaiters.has(message.message?.id)) {
        const resolve = replyWaiters.get(message.message.id)
        replyWaiters.delete(message.message.id)
        resolve(message.message)
        return
      }
      if (waiters.length) waiters.shift().resolve(message)
      else inbox.push(message)
    },
    onError: () => socket.destroy(),
  })
  socket.on('data', (chunk) => decoder.push(chunk))
  socket.on('close', failAll)
  socket.on('error', () => {})

  const nextMessage = (timeoutMs) => {
    if (inbox.length) return Promise.resolve(inbox.shift())
    if (closed) return Promise.reject(new LinkUnavailableError('The app closed the link.'))
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve: (value) => { clearTimeout(timer); resolve(value) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      }
      const timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1)
        reject(new LinkUnavailableError('The app did not answer the handshake.'))
      }, timeoutMs)
      waiters.push(waiter)
    })
  }

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new LinkUnavailableError('Pipe connect timed out.')), CONNECT_TIMEOUT_MS)
      socket.once('connect', () => { clearTimeout(timer); resolve() })
      socket.once('error', (error) => { clearTimeout(timer); reject(new LinkUnavailableError(error?.code || 'Pipe error')) })
    })
    const hostNonce = createNonce(randomBytes)
    socket.write(encodeLine({ t: 'auth', v: 1, nonce: hostNonce }))
    const challenge = await nextMessage(HANDSHAKE_TIMEOUT_MS)
    if (challenge?.t !== 'challenge' || !isNonce(challenge.nonce) ||
      !verifyHandshakeProof(secret, 'app', hostNonce, challenge.nonce, challenge.proof)) {
      throw new LinkUnavailableError('The pipe is not this Drama Studio install.')
    }
    socket.write(encodeLine({ t: 'proof', proof: handshakeProof(secret, 'host', challenge.nonce, hostNonce), origin }))
    const verdict = await nextMessage(HANDSHAKE_TIMEOUT_MS)
    if (verdict?.t !== 'ready') throw new LinkUnavailableError('The app refused the host.')
  } catch (error) {
    socket.destroy()
    throw error instanceof LinkUnavailableError ? error : new LinkUnavailableError(error?.message || 'Link failed')
  }

  return {
    request(message, timeoutMs) {
      if (closed) return Promise.resolve(null)
      return new Promise((resolve) => {
        const timer = setTimeout(() => { replyWaiters.delete(message.id); resolve('timeout') }, timeoutMs)
        replyWaiters.set(message.id, (value) => { clearTimeout(timer); resolve(value) })
        socket.write(encodeLine({ t: 'request', message }))
      })
    },
    get closed() { return closed },
    close: () => socket.end(),
  }
}

/**
 * Runs the host until the browser closes stdin.
 * @param {object} options
 * @param {import('stream').Readable} options.input  Chrome's stdin.
 * @param {(buffer: Buffer) => void} options.writeOutput  Writes to Chrome's stdout.
 * @param {string|null} options.origin  Extension origin from the command line.
 * @param {() => import('net').Socket} options.connect  Opens the app pipe.
 * @param {() => string|null} options.readSecret  The install's link secret.
 * @returns {Promise<number>} exit code
 */
function runCompanionHost({
  input,
  writeOutput,
  origin,
  connect,
  readSecret,
  randomBytes = crypto.randomBytes,
  replyTimeoutMs = REPLY_TIMEOUT_MS,
  log = () => {},
}) {
  let session = null
  let queue = Promise.resolve()

  const reply = (message) => {
    try {
      writeOutput(encodeNativeMessage(message))
    } catch (error) {
      log(`could not write a reply: ${error?.message || error}`)
      writeOutput(encodeNativeMessage(errorReply(message?.id, 'protocol')))
    }
  }

  const ensureSession = async () => {
    if (session && !session.closed) return session
    const secret = readSecret()
    if (!secret) throw new LinkUnavailableError('Drama Studio has not been started on this account yet.')
    session = await openAppSession({ connect, secret, origin, randomBytes })
    return session
  }

  const handle = async (message) => {
    const id = message && typeof message === 'object' && isRequestId(message.id) ? message.id : null
    if (!id) {
      reply(errorReply(null, 'protocol'))
      return
    }
    if (!extensionIdFromOrigin(origin)) {
      reply(errorReply(id, 'protocol'))
      return
    }
    let link
    try {
      link = await ensureSession()
    } catch (error) {
      log(`app link unavailable: ${error?.message || error}`)
      reply(errorReply(id, 'app-not-running'))
      return
    }
    const answer = await link.request(message, replyTimeoutMs)
    if (answer === 'timeout') reply(errorReply(id, 'timeout'))
    else if (answer === null) reply(errorReply(id, 'app-not-running'))
    else if (!isDesktopReplyFor(answer, id)) reply(errorReply(id, 'protocol'))
    else reply(answer)
  }

  return new Promise((resolve) => {
    let finished = false
    const finish = (code) => {
      if (finished) return
      finished = true
      queue.then(() => {
        if (session) session.close()
        resolve(code)
      })
    }
    // Capture chunks from the browser are larger than anything sent back.
    const decoder = createNativeMessageDecoder({
      maxBytes: MAX_INBOUND_MESSAGE_BYTES,
      onMessage: (message) => { queue = queue.then(() => handle(message)).catch(() => {}) },
      onError: (error) => {
        log(`bad message from the browser: ${error?.message || error}`)
        finish(1)
      },
    })
    input.on('data', (chunk) => decoder.push(chunk))
    input.on('end', () => finish(0))
    input.on('close', () => finish(0))
    input.on('error', () => finish(1))
  })
}

module.exports = { runCompanionHost, findExtensionOrigin, LinkUnavailableError, REPLY_TIMEOUT_MS }
