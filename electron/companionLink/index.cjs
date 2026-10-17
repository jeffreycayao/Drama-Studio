'use strict'

// Desktop side of the Drama Studio Companion link (docs/PLAN_BROWSER_EXTENSIONS.md §4),
// wired into electron/main.js: the per-user pipe server, pairing, "Open in…"
// hand-offs, host registration, and the Settings › Browser IPC.

const path = require('path')
const { createCompanionLinkServer } = require('./linkServer.cjs')
const { createCompanionLinkService } = require('./linkService.cjs')
const { HANDOFF_SITES, CompanionLinkError, createHandoffStore, findHandoffSite } = require('./handoffs.cjs')
const { JOB_SITES, createJobStore, findJobSite } = require('./jobs.cjs')
const { createCaptureStore } = require('./captures.cjs')
const { companionPipePath, createPairedBrowserStore, currentUsername, ensurePairingSecret, readPairingSecret } = require('./pairing.cjs')
const {
  RELEASE_EXTENSION_IDS,
  isValidExtensionId,
  parseExtensionIdList,
  readDevelopmentExtensionIds,
  registerNativeHost,
  resolveAllowedExtensionIds,
  writeDevelopmentExtensionIds,
} = require('./registration.cjs')

/** "Allow this browser…?" as a native dialog the page cannot answer for the person. */
function createApprovalPrompt({ dialog, getParentWindow }) {
  return async ({ extensionId, browser, extVersion }) => {
    const parent = getParentWindow()
    if (parent) {
      if (parent.isMinimized()) parent.restore()
      parent.flashFrame(true)
    }
    const who = [browser || 'A browser', extVersion ? `Drama Studio Companion ${extVersion}` : 'Drama Studio Companion'].join(' · ')
    const options = {
      type: 'question',
      buttons: ['Allow', 'Don’t allow'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: 'Drama Studio Companion',
      message: 'Allow this browser to send files to Drama Studio?',
      detail: `${who}\nExtension ID: ${extensionId}\n\nAn allowed browser can fill prompts you send from Drama Studio and, later, send generated images and videos back. You can remove it at any time in Settings › Browser.`,
    }
    try {
      const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options)
      return response === 0
    } finally {
      if (parent && !parent.isDestroyed()) parent.flashFrame(false)
    }
  }
}

function createCompanionLink({
  userDataDir,
  appVersion,
  execPath,
  appPath = null,
  requestApproval,
  openExternal,
  onChange = () => {},
  onJobUpdate = () => {},
  onCapture = () => {},
  env = process.env,
  platform = process.platform,
  log = () => {},
}) {
  const store = createPairedBrowserStore({ userDataDir })
  const handoffs = createHandoffStore()
  const jobs = createJobStore({ onUpdate: onJobUpdate })
  const captures = createCaptureStore({ inboxDir: path.join(userDataDir, 'companion', 'inbox'), onCapture, log })
  let sweepTimer = null
  const service = createCompanionLinkService({
    store,
    handoffs,
    jobs,
    captures,
    appVersion,
    log,
    requestApproval: async (details) => {
      const allowed = await requestApproval(details)
      if (allowed) setImmediate(onChange)
      return allowed
    },
  })
  const pipePath = companionPipePath({ platform, username: currentUsername(), userDataDir })
  const server = createCompanionLinkServer({
    pipePath,
    getSecret: () => readPairingSecret(userDataDir),
    handleRequest: service.handleRequest,
    log,
  })
  let serverState = { listening: false, error: 'not-started' }
  let registration = { registered: false, reason: 'not-started' }

  const allowedExtensionIds = () => resolveAllowedExtensionIds({
    development: readDevelopmentExtensionIds(userDataDir),
    env: env.DS_COMPANION_EXTENSION_IDS || '',
  })

  async function refreshRegistration() {
    try {
      registration = await registerNativeHost({ userDataDir, execPath, appPath, extensionIds: allowedExtensionIds(), platform })
    } catch (error) {
      registration = { registered: false, reason: 'error', errors: [error?.message || String(error)] }
    }
    if (registration.errors?.length) log(`host registration incomplete: ${registration.errors.join(', ')}`)
    return registration
  }

  function status() {
    const development = readDevelopmentExtensionIds(userDataDir)
    const fromEnv = parseExtensionIdList(env.DS_COMPANION_EXTENSION_IDS || '')
    return {
      supported: platform === 'win32',
      listening: serverState.listening === true,
      serverError: serverState.listening ? null : serverState.error || null,
      registered: registration.registered === true,
      browsers: registration.browsers || [],
      extensionIds: [
        ...RELEASE_EXTENSION_IDS.map((id) => ({ id, source: 'release' })),
        ...development.filter((id) => !RELEASE_EXTENSION_IDS.includes(id)).map((id) => ({ id, source: 'development' })),
        ...fromEnv.filter((id) => !RELEASE_EXTENSION_IDS.includes(id) && !development.includes(id)).map((id) => ({ id, source: 'environment' })),
      ],
      paired: service.listPaired(),
    }
  }

  return {
    pipePath,
    service,
    handoffs,
    jobs,
    captures,
    async start() {
      ensurePairingSecret(userDataDir)
      serverState = await server.start()
      await refreshRegistration()
      captures.sweep()
      sweepTimer = setInterval(() => captures.sweep(), 60 * 1000)
      sweepTimer.unref?.()
      return status()
    },
    stop: () => {
      if (sweepTimer) clearInterval(sweepTimer)
      sweepTimer = null
      return server.stop()
    },
    status,
    removePaired(id) {
      const removed = service.removePaired(id)
      return { removed, ...status() }
    },
    async addDevelopmentExtensionId(value) {
      const id = String(value || '').trim().toLowerCase()
      if (!isValidExtensionId(id)) throw new CompanionLinkError('An extension ID is 32 letters from a to p (see chrome://extensions with Developer mode on).')
      writeDevelopmentExtensionIds(userDataDir, [...readDevelopmentExtensionIds(userDataDir), id])
      await refreshRegistration()
      return status()
    },
    async removeDevelopmentExtensionId(value) {
      const id = String(value || '').trim().toLowerCase()
      writeDevelopmentExtensionIds(userDataDir, readDevelopmentExtensionIds(userDataDir).filter((item) => item !== id))
      await refreshRegistration()
      return status()
    },
    /** "Open in…": a one-time hand-off, opened in the default browser. */
    async openIn({ siteId, prompt }) {
      const handoff = handoffs.create({ siteId, prompt })
      await openExternal(handoff.url)
      return { siteId: handoff.siteId, label: findHandoffSite(handoff.siteId).label, expiresAt: handoff.expiresAt }
    },
    /** A browser job: prompt, settings and reference files, opened on the AI site. */
    async createJob({ siteId, kind, prompt, params, references }) {
      const created = jobs.create({ siteId, kind, prompt, params, references })
      await openExternal(created.url)
      return { jobId: created.jobId, siteId: created.siteId, label: findJobSite(created.siteId).label, expiresAt: created.expiresAt }
    },
    listJobs: () => ({ jobs: jobs.list() }),
    listInbox: () => ({ captures: captures.listInbox() }),
    removeFromInbox: (captureId) => ({ removed: captures.remove(captureId) }),
  }
}

function registerCompanionLinkIpc(ipcMain, link) {
  const handle = (channel, fn) => ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { success: true, ...(await fn(...args)) }
    } catch (error) {
      // CompanionLinkError text is written for the person; anything else is not.
      return { success: false, error: error instanceof CompanionLinkError ? error.message : 'The browser link could not do that.' }
    }
  })
  handle('companionLink:status', async () => link.status())
  handle('companionLink:sites', async () => ({ sites: HANDOFF_SITES.map(({ id, label }) => ({ id, label })) }))
  handle('companionLink:removePaired', async (id) => link.removePaired(typeof id === 'string' ? id : ''))
  handle('companionLink:addExtensionId', async (id) => link.addDevelopmentExtensionId(typeof id === 'string' ? id : ''))
  handle('companionLink:removeExtensionId', async (id) => link.removeDevelopmentExtensionId(typeof id === 'string' ? id : ''))
  handle('companionLink:openIn', async (request) => link.openIn({
    siteId: typeof request?.siteId === 'string' ? request.siteId : '',
    prompt: typeof request?.prompt === 'string' ? request.prompt : '',
  }))
  handle('companionLink:jobSites', async () => ({ sites: JOB_SITES.map(({ id, label, kinds }) => ({ id, label, kinds: [...kinds] })) }))
  handle('companionLink:createJob', async (request) => link.createJob({
    siteId: typeof request?.siteId === 'string' ? request.siteId : '',
    kind: typeof request?.kind === 'string' ? request.kind : '',
    prompt: typeof request?.prompt === 'string' ? request.prompt : '',
    params: request?.params && typeof request.params === 'object' ? request.params : {},
    references: Array.isArray(request?.references)
      ? request.references.map((item) => ({ path: typeof item?.path === 'string' ? item.path : '', name: typeof item?.name === 'string' ? item.name : '' }))
      : [],
  }))
  handle('companionLink:jobs', async () => link.listJobs())
  handle('companionLink:inbox', async () => link.listInbox())
  handle('companionLink:inboxRemove', async (captureId) => link.removeFromInbox(typeof captureId === 'string' ? captureId : ''))
}

module.exports = { createCompanionLink, createApprovalPrompt, registerCompanionLinkIpc }
