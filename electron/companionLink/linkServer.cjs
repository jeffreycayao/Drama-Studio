'use strict'

// App side of the per-user pipe. Each native host connects, both sides prove
// they hold this install's link secret (pairing.cjs), and then the host relays
// Companion requests to handleRequest. Nothing is answered before the
// handshake, and a connection that does not finish it in time is dropped.

const crypto = require('crypto')
const fs = require('fs')
const net = require('net')
const { createLineDecoder, encodeLine, errorReply, extensionIdFromOrigin } = require('./protocol.cjs')
const { createNonce, handshakeProof, isNonce, verifyHandshakeProof } = require('./pairing.cjs')

const HANDSHAKE_TIMEOUT_MS = 3000
const IDLE_TIMEOUT_MS = 2 * 60 * 1000
const MAX_CONNECTIONS = 16

function createCompanionLinkServer({
  pipePath,
  getSecret,
  handleRequest,
  log = () => {},
  randomBytes = crypto.randomBytes,
  handshakeTimeoutMs = HANDSHAKE_TIMEOUT_MS,
}) {
  let server = null
  const sockets = new Set()

  const onConnection = (socket) => {
    if (sockets.size >= MAX_CONNECTIONS) {
      socket.destroy()
      return
    }
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.setTimeout(IDLE_TIMEOUT_MS, () => socket.destroy())

    let state = 'auth'
    let hostNonce = null
    let appNonce = null
    let origin = null
    const handshakeTimer = setTimeout(() => { if (state !== 'ready') socket.destroy() }, handshakeTimeoutMs)
    socket.on('close', () => clearTimeout(handshakeTimer))
    const send = (message) => { if (!socket.destroyed) socket.write(encodeLine(message)) }
    const refuse = (reason) => {
      log(`refused a link connection: ${reason}`)
      send({ t: 'denied' })
      socket.end()
      state = 'closed'
    }

    const decoder = createLineDecoder({
      onError: () => socket.destroy(),
      onMessage: (message) => {
        if (state === 'auth') {
          if (message?.t !== 'auth' || message.v !== 1 || !isNonce(message.nonce)) return refuse('bad hello')
          const secret = getSecret()
          if (!secret) return refuse('no secret')
          hostNonce = message.nonce
          appNonce = createNonce(randomBytes)
          state = 'proof'
          send({ t: 'challenge', nonce: appNonce, proof: handshakeProof(secret, 'app', hostNonce, appNonce) })
          return
        }
        if (state === 'proof') {
          const secret = getSecret()
          if (message?.t !== 'proof' || !secret || !verifyHandshakeProof(secret, 'host', appNonce, hostNonce, message.proof)) {
            return refuse('bad proof')
          }
          if (!extensionIdFromOrigin(message.origin)) return refuse('no extension origin')
          origin = message.origin
          state = 'ready'
          clearTimeout(handshakeTimer)
          send({ t: 'ready' })
          return
        }
        if (state !== 'ready' || message?.t !== 'request') return
        const request = message.message
        Promise.resolve()
          .then(() => handleRequest(request, { origin }))
          .catch((error) => {
            log(`link request failed: ${error?.message || error}`)
            return errorReply(request?.id, 'protocol')
          })
          .then((reply) => send({ t: 'reply', message: reply }))
      },
    })
    socket.on('data', (chunk) => decoder.push(chunk))
  }

  return {
    pipePath,
    start() {
      if (server) return Promise.resolve({ listening: true, pipePath })
      if (process.platform !== 'win32') {
        // A socket file left behind by a crash would block listen().
        try { fs.unlinkSync(pipePath) } catch { /* not there */ }
      }
      return new Promise((resolve) => {
        const candidate = net.createServer(onConnection)
        candidate.once('error', (error) => {
          // EADDRINUSE: another Drama Studio window already owns the link.
          log(`link pipe not started: ${error?.code || error?.message || error}`)
          resolve({ listening: false, pipePath, error: error?.code || 'error' })
        })
        candidate.listen(pipePath, () => {
          if (process.platform !== 'win32') {
            try { fs.chmodSync(pipePath, 0o600) } catch { /* best effort */ }
          }
          server = candidate
          resolve({ listening: true, pipePath })
        })
      })
    },
    stop() {
      for (const socket of sockets) socket.destroy()
      sockets.clear()
      if (!server) return Promise.resolve()
      const closing = server
      server = null
      return new Promise((resolve) => closing.close(() => resolve()))
    },
    get listening() { return Boolean(server) },
  }
}

module.exports = { createCompanionLinkServer }
