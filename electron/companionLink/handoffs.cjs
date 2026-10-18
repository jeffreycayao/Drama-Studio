'use strict'

// One-time prompt hand-offs (plan §4, mode 2). "Open in…" stores the prompt
// here and opens https://<site>/#ds=<token>; the Companion on that page asks
// for the token over the desktop link and fills the prompt. Only the token is
// ever in a URL. Tokens live in memory only, for 5 minutes, and are gone
// after the first fetch.

const crypto = require('crypto')
const { MAX_NATIVE_MESSAGE_BYTES, MAX_PROMPT_CHARS, isHandoffToken } = require('./protocol.cjs')

const HANDOFF_TTL_MS = 5 * 60 * 1000
const MAX_PENDING_HANDOFFS = 50

// Prompt sites the Companion can fill (extensions/companion/src/sites/prompt-sites.ts).
// The id is what the Companion checks against the page it is on.
const HANDOFF_SITES = Object.freeze([
  { id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com/' },
  { id: 'gemini', label: 'Gemini', url: 'https://gemini.google.com/app' },
  { id: 'claude', label: 'Claude', url: 'https://claude.ai/new' },
  { id: 'grok', label: 'Grok', url: 'https://grok.com/' },
  { id: 'perplexity', label: 'Perplexity', url: 'https://www.perplexity.ai/' },
  { id: 'manus', label: 'Manus', url: 'https://manus.im/app' },
  { id: 'flow', label: 'Google Flow', url: 'https://flow.google.com/' },
  { id: 'kling', label: 'Kling AI', url: 'https://kling.ai/app/' },
  { id: 'runway', label: 'Runway', url: 'https://app.runwayml.com/' },
  { id: 'hailuo', label: 'Hailuo AI', url: 'https://hailuoai.video/' },
  { id: 'luma', label: 'Luma Dream Machine', url: 'https://dream-machine.lumalabs.ai/' },
  { id: 'pika', label: 'Pika', url: 'https://create.pika.art/' },
  { id: 'midjourney', label: 'Midjourney', url: 'https://www.midjourney.com/imagine' },
  { id: 'ideogram', label: 'Ideogram', url: 'https://ideogram.ai/t/explore' },
  { id: 'leonardo', label: 'Leonardo', url: 'https://app.leonardo.ai/' },
  { id: 'suno', label: 'Suno', url: 'https://suno.com/create' },
].map((site) => Object.freeze(site)))

const findHandoffSite = (siteId) => HANDOFF_SITES.find((site) => site.id === siteId) || null

function buildHandoffUrl(siteId, token) {
  const site = findHandoffSite(siteId)
  if (!site || !isHandoffToken(token)) throw new Error('Unknown site or bad token.')
  return `${site.url}#ds=${token}`
}

class CompanionLinkError extends Error {}

function createHandoffStore({ now = Date.now, ttlMs = HANDOFF_TTL_MS, randomBytes = crypto.randomBytes } = {}) {
  const pending = new Map()

  const prune = () => {
    const current = now()
    for (const [token, entry] of pending) if (entry.expiresAt <= current) pending.delete(token)
    while (pending.size > MAX_PENDING_HANDOFFS) pending.delete(pending.keys().next().value)
  }

  return {
    create({ siteId, prompt }) {
      const site = findHandoffSite(siteId)
      if (!site) throw new CompanionLinkError('Pick one of the listed sites.')
      const text = typeof prompt === 'string' ? prompt : ''
      if (!text.trim()) throw new CompanionLinkError('There is no prompt to send.')
      if (text.length > MAX_PROMPT_CHARS) throw new CompanionLinkError('This prompt is too long to send (200,000 characters at most).')
      // The reply must fit in one native message.
      if (Buffer.byteLength(JSON.stringify(text), 'utf8') > MAX_NATIVE_MESSAGE_BYTES - 1024) {
        throw new CompanionLinkError('This prompt is too large to send in one piece.')
      }
      prune()
      const token = randomBytes(24).toString('base64url')
      const expiresAt = now() + ttlMs
      pending.set(token, { siteId: site.id, prompt: text, expiresAt })
      prune()
      return { token, siteId: site.id, url: buildHandoffUrl(site.id, token), expiresAt }
    },
    /** Returns the hand-off once; any later call (or an expired one) gets null. */
    take(token) {
      if (!isHandoffToken(token)) return null
      const entry = pending.get(token)
      pending.delete(token)
      if (!entry || entry.expiresAt <= now()) return null
      return { siteId: entry.siteId, prompt: entry.prompt }
    },
    size: () => { prune(); return pending.size },
  }
}

module.exports = {
  HANDOFF_TTL_MS,
  HANDOFF_SITES,
  CompanionLinkError,
  findHandoffSite,
  buildHandoffUrl,
  createHandoffStore,
}
