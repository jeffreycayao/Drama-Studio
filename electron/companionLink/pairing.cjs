'use strict'

// Per-install link secret, the host <-> app handshake proofs, the pipe name,
// and the list of browsers the person allowed (Settings › Browser).
//
// Everything lives in <userData>/companion/, written by the main process
// only; the generic settings IPC cannot read or change it.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { extensionIdFromOrigin } = require('./protocol.cjs')

const COMPANION_DIR_NAME = 'companion'
const SECRET_FILE_NAME = 'link-secret'
const PAIRED_FILE_NAME = 'paired-browsers.json'
const SECRET_PATTERN = /^[0-9a-f]{64}$/
const MAX_PAIRED_BROWSERS = 32

const companionDir = (userDataDir) => path.join(userDataDir, COMPANION_DIR_NAME)

/** The host and the app must agree on this, so both call it. */
function currentUsername() {
  try {
    return require('os').userInfo().username
  } catch {
    return process.env.USERNAME || process.env.USER || ''
  }
}

/**
 * Per-user pipe the native host uses to reach the running app. On Windows
 * the pipe namespace is machine-wide, so the handshake below, not the name,
 * is what keeps other processes out.
 */
function companionPipePath({ platform = process.platform, username = '', userDataDir = '' } = {}) {
  if (platform === 'win32') {
    const safeUser = String(username).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64) || 'user'
    return `\\\\.\\pipe\\drama-studio-companion-${safeUser}`
  }
  return path.join(companionDir(userDataDir), 'link.sock')
}

function readPairingSecret(userDataDir, { readFileSync = fs.readFileSync } = {}) {
  try {
    const value = readFileSync(path.join(companionDir(userDataDir), SECRET_FILE_NAME), 'utf8').trim()
    return SECRET_PATTERN.test(value) ? value : null
  } catch {
    return null
  }
}

/** Creates the secret on first run; later runs reuse it. */
function ensurePairingSecret(userDataDir, { randomBytes = crypto.randomBytes } = {}) {
  const existing = readPairingSecret(userDataDir)
  if (existing) return existing
  const dir = companionDir(userDataDir)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, SECRET_FILE_NAME)
  const secret = randomBytes(32).toString('hex')
  try {
    fs.writeFileSync(filePath, secret, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    return secret
  } catch (error) {
    // Another instance won the race (or a broken file is in the way).
    const raced = readPairingSecret(userDataDir)
    if (raced) return raced
    if (error?.code !== 'EEXIST') throw error
    fs.writeFileSync(filePath, secret, { encoding: 'utf8', mode: 0o600 })
    return secret
  }
}

// --- Handshake --------------------------------------------------------------
// host -> app  { t: 'auth', v: 1, nonce: hostNonce }
// app  -> host { t: 'challenge', nonce: appNonce, proof: P('app', hostNonce, appNonce) }
// host -> app  { t: 'proof', proof: P('host', appNonce, hostNonce), origin }
// app  -> host { t: 'ready' } | { t: 'denied' }
// Each side proves it knows the secret without sending it, so a process that
// squats on the pipe name learns nothing and the host refuses to talk to it.

const createNonce = (randomBytes = crypto.randomBytes) => randomBytes(16).toString('hex')

function handshakeProof(secret, role, first, second) {
  return crypto.createHmac('sha256', secret).update(`ds-companion-v1\n${role}\n${first}\n${second}`).digest('hex')
}

function verifyHandshakeProof(secret, role, first, second, proof) {
  if (typeof proof !== 'string' || !/^[0-9a-f]{64}$/.test(proof)) return false
  const expected = Buffer.from(handshakeProof(secret, role, first, second), 'hex')
  return crypto.timingSafeEqual(expected, Buffer.from(proof, 'hex'))
}

const isNonce = (value) => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value)

// --- Paired browsers ----------------------------------------------------------

/** Plain text for the approval prompt and Settings: no control characters. */
const cleanLabel = (value, max) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)

/**
 * Browsers are paired by the Companion's extension origin: each store
 * listing has its own ID, so Chrome and Edge pair separately. (A hand-off
 * request carries no browser name, so the origin is the only key both
 * requests share.)
 */
function createPairedBrowserStore({ userDataDir, now = Date.now, randomBytes = crypto.randomBytes }) {
  const filePath = path.join(companionDir(userDataDir), PAIRED_FILE_NAME)
  let cache = null

  const load = () => {
    if (cache) return cache
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      const browsers = Array.isArray(parsed?.browsers) ? parsed.browsers : []
      cache = browsers.filter((entry) => entry && typeof entry.id === 'string' && extensionIdFromOrigin(entry.origin))
    } catch {
      cache = []
    }
    return cache
  }

  const save = () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const temporary = `${filePath}.${process.pid}.tmp`
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, browsers: cache }, null, 2), { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(temporary, filePath)
  }

  const publicRecord = (entry) => ({
    id: entry.id,
    extensionId: extensionIdFromOrigin(entry.origin),
    browser: entry.browser,
    extVersion: entry.extVersion,
    pairedAt: entry.pairedAt,
    lastSeenAt: entry.lastSeenAt,
  })

  return {
    filePath,
    list: () => load().map(publicRecord),
    isPaired: (origin) => load().some((entry) => entry.origin === origin),
    add({ origin, browser, extVersion }) {
      if (!extensionIdFromOrigin(origin)) throw new Error('Not a Companion extension origin.')
      const existing = load().find((entry) => entry.origin === origin)
      if (existing) return publicRecord(existing)
      const stamp = new Date(now()).toISOString()
      const entry = {
        id: randomBytes(8).toString('hex'),
        origin,
        browser: cleanLabel(browser, 64) || 'Browser',
        extVersion: cleanLabel(extVersion, 32),
        pairedAt: stamp,
        lastSeenAt: stamp,
      }
      cache = [...load(), entry].slice(-MAX_PAIRED_BROWSERS)
      save()
      return publicRecord(entry)
    },
    /** Records the latest browser/version label; written at most hourly. */
    touch(origin, { browser, extVersion } = {}) {
      const entry = load().find((item) => item.origin === origin)
      if (!entry) return
      const nextBrowser = cleanLabel(browser, 64) || entry.browser
      const nextVersion = cleanLabel(extVersion, 32) || entry.extVersion
      const stale = now() - Date.parse(entry.lastSeenAt || 0) > 60 * 60 * 1000
      if (!stale && nextBrowser === entry.browser && nextVersion === entry.extVersion) return
      Object.assign(entry, { browser: nextBrowser, extVersion: nextVersion, lastSeenAt: new Date(now()).toISOString() })
      try { save() } catch { /* a missed timestamp is harmless */ }
    },
    remove(id) {
      const before = load()
      const next = before.filter((entry) => entry.id !== id)
      if (next.length === before.length) return false
      cache = next
      save()
      return true
    },
  }
}

module.exports = {
  COMPANION_DIR_NAME,
  companionDir,
  currentUsername,
  companionPipePath,
  readPairingSecret,
  ensurePairingSecret,
  createNonce,
  isNonce,
  handshakeProof,
  verifyHandshakeProof,
  cleanLabel,
  createPairedBrowserStore,
}
