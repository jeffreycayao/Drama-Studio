'use strict'

// What the app answers on the desktop link. Pure apart from the injected
// store, hand-offs and approval prompt, so tests can drive it directly.
//
// - hello: says whether this browser is paired. An unpaired browser gets
//   paired:false at once (the Companion waits 5 s at most) and the app asks
//   "Allow this browser…?" in the background.
// - handoff.fetch: paired browsers only; each token works once.

// - job.fetch / asset.read / job.update / capture.*: paired browsers only
//   (protocol v2, docs/PLAN_AI_BROWSER_WORKSPACE.md step 1). A job is bound
//   to the browser that fetched it; a capture to the browser that began it.

const {
  ackReply,
  assetChunkReply,
  captureDoneReply,
  captureReadyReply,
  errorReply,
  extensionIdFromOrigin,
  handoffReply,
  helloReply,
  jobReply,
  parseCompanionRequest,
} = require('./protocol.cjs')

// After "Don't allow", ask that browser again only after this long.
const DENIED_QUIET_MS = 10 * 60 * 1000

function createCompanionLinkService({ store, handoffs, jobs = null, captures = null, appVersion, requestApproval, now = Date.now, log = () => {} }) {
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

    // Everything below needs a browser the person allowed.
    if (!store.isPaired(origin)) {
      void askToPair(origin)
      return errorReply(request.id, 'not-paired')
    }

    if (request.type === 'handoff.fetch') {
      const handoff = handoffs.take(request.token)
      if (!handoff) return errorReply(request.id, 'handoff-expired')
      return handoffReply(request.id, { prompt: handoff.prompt, site: handoff.siteId })
    }

    if (request.type === 'job.fetch' || request.type === 'asset.read' || request.type === 'job.update') {
      if (!jobs) return errorReply(request.id, 'protocol')
      if (request.type === 'job.fetch') {
        const taken = jobs.take(request.token, origin)
        if (taken.code) return errorReply(request.id, taken.code)
        const { job } = taken
        return jobReply(request.id, { jobId: job.jobId, site: job.siteId, kind: job.kind, prompt: job.prompt, params: job.params, references: job.references })
      }
      if (request.type === 'asset.read') {
        const read = jobs.readReference(request.jobId, request.refId, request.offset, origin)
        if (read.code) return errorReply(request.id, read.code)
        return assetChunkReply(request.id, read.chunk)
      }
      const updated = jobs.update(request.jobId, request.state, request.reason, origin)
      if (updated.code) return errorReply(request.id, updated.code)
      return ackReply(request.id)
    }

    // capture.begin / capture.chunk / capture.end
    if (!captures) return errorReply(request.id, 'protocol')
    try {
      return handleCapture(request, origin)
    } catch (error) {
      log(`capture could not be saved: ${error?.message || error}`)
      return errorReply(request.id, 'capture-refused')
    }
  }

  function handleCapture(request, origin) {
    if (request.type === 'capture.begin') {
      // A capture may name a job only if this browser owns it; otherwise it
      // is kept as a plain capture.
      const jobId = request.jobId && jobs && jobs.isJobFor(request.jobId, origin) ? request.jobId : null
      const begun = captures.begin({ ...request, jobId, origin })
      if (begun.code) return errorReply(request.id, begun.code)
      return captureReadyReply(request.id, { captureId: begun.captureId })
    }
    if (request.type === 'capture.chunk') {
      const written = captures.chunk({ captureId: request.captureId, index: request.index, data: request.data, origin })
      if (written.code) return errorReply(request.id, written.code)
      return ackReply(request.id)
    }
    const ended = captures.end({ captureId: request.captureId, origin })
    if (ended.code) return errorReply(request.id, ended.code)
    if (ended.record.jobId && jobs) jobs.update(ended.record.jobId, 'done', '', origin)
    return captureDoneReply(request.id, { captureId: ended.record.captureId })
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
