'use strict'

// What the app answers on the desktop link. Pure apart from the injected
// store, hand-offs and approval prompt, so tests can drive it directly.
//
// - hello: says whether this browser is paired. An unpaired browser gets
//   paired:false at once (the Companion waits 5 s at most) and the app asks
//   "Allow this browser…?" in the background.
// - handoff.fetch: paired browsers only; each token works once.

const { extensionIdFromOrigin, errorReply, handoffReply, helloReply, parseCompanionRequest } = require('./protocol.cjs')

// After "Don't allow", ask that browser again only after this long.
const DENIED_QUIET_MS = 10 * 60 * 1000

function createCompanionLinkService({ store, handoffs, appVersion, requestApproval, now = Date.now, log = () => {} }) {
  const pendingApprovals = new Map()
  const deniedUntil = new Map()

  /** Shows at most one prompt per browser at a time. */
  function askToPair(origin, { browser = '', extVersion = '' } = {}) {
    if (store.isPaired(origin)) return Promise.resolve(true)
    if (pendingApprovals.has(origin)) return pendingApprovals.get(origin)
    if ((deniedUntil.get(origin) || 0) > now()) return Promise.resolve(false)
    const asking = Promise.resolve()
      .then(() => requestApproval({ origin, extensionId: extensionIdFromOrigin(origin), browser, extVersion }))
      .then((allowed) => {
        if (allowed === true) {
          store.add({ origin, browser, extVersion })
          deniedUntil.delete(origin)
          return true
        }
        deniedUntil.set(origin, now() + DENIED_QUIET_MS)
        return false
      })
      .catch((error) => {
        log(`pairing prompt failed: ${error?.message || error}`)
        return false
      })
      .finally(() => pendingApprovals.delete(origin))
    pendingApprovals.set(origin, asking)
    return asking
  }

  async function handleRequest(raw, { origin } = {}) {
    const parsed = parseCompanionRequest(raw)
    if (!parsed.ok) return errorReply(parsed.id, parsed.code)
    const { request } = parsed
    if (!extensionIdFromOrigin(origin)) return errorReply(request.id, 'protocol')

    if (request.type === 'hello') {
      const paired = store.isPaired(origin)
      if (paired) store.touch(origin, { browser: request.browser, extVersion: request.extVersion })
      else void askToPair(origin, { browser: request.browser, extVersion: request.extVersion })
      return helloReply(request.id, { appVersion, paired })
    }

    // handoff.fetch
    if (!store.isPaired(origin)) {
      void askToPair(origin)
      return errorReply(request.id, 'not-paired')
    }
    const handoff = handoffs.take(request.token)
    if (!handoff) return errorReply(request.id, 'handoff-expired')
    return handoffReply(request.id, { prompt: handoff.prompt, site: handoff.siteId })
  }

  return {
    handleRequest,
    askToPair,
    listPaired: () => store.list(),
    removePaired: (id) => store.remove(String(id || '')),
    /** Pending prompts, for tests and status. */
    pendingApprovalCount: () => pendingApprovals.size,
  }
}

module.exports = { createCompanionLinkService, DENIED_QUIET_MS }
