/**
 * Setup Doctor report builder (pure).
 *
 * Takes the raw facts gathered by services/setupDoctor.js and decides, per
 * workspace area, what is ready, what blocks the user, what is an optional
 * extra, and where this PC is better served by a cloud option than by local
 * AI. Every check carries an i18n key, interpolation variables, optional
 * reasons, and at most one fix action the UI can run. No I/O happens here so
 * the advice is unit-testable.
 */

export const SETUP_STATUS = Object.freeze({
  READY: 'ready',
  NEEDS_ACTION: 'needs-action',
  WARNING: 'warning',
  // This PC is better served by a cloud option than by running AI locally.
  CLOUD: 'cloud',
  OPTIONAL: 'optional',
  UNAVAILABLE: 'unavailable',
})

// Fix actions the UI knows how to run.
export const SETUP_FIX = Object.freeze({
  SETTINGS: 'settings',
  NAVIGATE: 'navigate',
  API_KEY: 'api-key',
  INSTALL_CAPTIONS: 'install-captions',
  INSTALL_BRIDGE: 'install-bridge',
  // Cloud-only users: open the ComfyUI setup screen over the app.
  SETUP_COMFY: 'setup-comfy',
})

export const AI_TIER = Object.freeze({ GOOD: 'good', LIMITED: 'limited', CLOUD: 'cloud', UNKNOWN: 'unknown' })

const GIB = 1024 ** 3
export const LOW_DISK_WARNING_BYTES = 20 * GIB
export const LOW_DISK_BLOCKING_BYTES = 2 * GIB
const MIN_SYSTEM_RAM_BYTES = 16 * GIB

const STATUS_RANK = {
  [SETUP_STATUS.NEEDS_ACTION]: 0,
  [SETUP_STATUS.WARNING]: 1,
  [SETUP_STATUS.CLOUD]: 2,
  [SETUP_STATUS.OPTIONAL]: 3,
  [SETUP_STATUS.UNAVAILABLE]: 4,
  [SETUP_STATUS.READY]: 5,
}

export function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return '—'
  if (value >= GIB) return `${(value / GIB).toFixed(value >= 100 * GIB ? 0 : 1).replace(/\.0$/, '')} GB`
  return `${Math.round(value / 1024 ** 2)} MB`
}

function check(id, status, key, vars = {}, fix = null, reasons = []) {
  return { id, status, key, vars, fix, reasons }
}

// ---------------------------------------------------------------------------
// Local vs cloud AI assessment
//
// Rough, deliberately conservative guidance. A model has to fit in GPU memory
// (VRAM, or unified memory on Apple Silicon) to run at interactive speed;
// whatever spills into system RAM runs many times slower.
// ---------------------------------------------------------------------------

function aiMemoryBytes(gpu, totalMemBytes) {
  if (!gpu) return 0
  // macOS keeps part of unified memory for the system and apps.
  if (gpu.unifiedMemory) return Math.round((Number(totalMemBytes) || 0) * 0.7)
  return Number(gpu.vramBytes) || 0
}

function gpuVars(hardware) {
  const gpu = hardware?.primaryGpu
  return {
    gpu: gpu?.name || 'your GPU',
    vram: formatBytes(gpu?.vramBytes),
    ram: formatBytes(hardware?.totalMemBytes),
    vendor: ({ nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel', apple: 'Apple' })[gpu?.vendor] || 'This',
  }
}

/**
 * Decide whether this PC can run a local LLM (assistant / agent) and local
 * image or video generation, with the reasons behind each verdict.
 * @returns {{ llm, image, video }} each { tier, reasons: [{ key, vars }] }
 */
export function assessLocalAi(hardware) {
  const unknown = { tier: AI_TIER.UNKNOWN, reasons: [] }
  if (!hardware) return { llm: unknown, image: unknown, video: unknown }

  const gpu = hardware.primaryGpu
  const vars = gpuVars(hardware)
  const memGib = aiMemoryBytes(gpu, hardware.totalMemBytes) / GIB
  const totalRam = Number(hardware.totalMemBytes) || 0
  const lowRam = totalRam > 0 && totalRam < MIN_SYSTEM_RAM_BYTES
  const vendor = gpu?.vendor || 'unknown'
  const noGpu = !gpu || memGib < 2
  const vramReason = { key: gpu?.unifiedMemory ? 'setupDoctor.ai.reasons.unifiedMemory' : 'setupDoctor.ai.reasons.vram', vars }
  const reason = (key) => ({ key: `setupDoctor.ai.reasons.${key}`, vars })
  const verdict = (tier, reasons) => ({ tier, reasons })

  // Local assistant / agent (Ollama, LM Studio).
  let llm
  if (noGpu) llm = verdict(AI_TIER.CLOUD, [reason('noGpu')])
  else if (lowRam) llm = verdict(AI_TIER.CLOUD, [reason('lowRam')])
  else if (memGib >= (vendor === 'apple' ? 22 : 12)) llm = verdict(AI_TIER.GOOD, [vramReason])
  else if (memGib >= (vendor === 'apple' ? 11 : 6)) llm = verdict(AI_TIER.LIMITED, [vramReason, reason('smallModels')])
  else llm = verdict(AI_TIER.CLOUD, [vramReason, reason('tooSmallForLlm')])

  // Local image generation (ComfyUI).
  let image
  if (noGpu) image = verdict(AI_TIER.CLOUD, [reason('noGpu')])
  else if (vendor === 'nvidia') {
    if (memGib >= 12) image = verdict(AI_TIER.GOOD, [vramReason])
    else if (memGib >= 6) image = verdict(AI_TIER.LIMITED, [vramReason, reason('imageLimited')])
    else image = verdict(AI_TIER.CLOUD, [vramReason])
  } else if (memGib >= 8) {
    image = verdict(AI_TIER.LIMITED, [reason('noCuda')])
  } else {
    image = verdict(AI_TIER.CLOUD, [vramReason, reason('noCuda')])
  }

  // Local video generation (ComfyUI) is the heaviest workload by far.
  let video
  if (noGpu) video = verdict(AI_TIER.CLOUD, [reason('noGpu')])
  else if (vendor !== 'nvidia') video = verdict(AI_TIER.CLOUD, [reason('noCuda')])
  else if (lowRam) video = verdict(AI_TIER.CLOUD, [reason('lowRam')])
  else if (memGib >= 16) video = verdict(AI_TIER.GOOD, [vramReason])
  else if (memGib >= 12) video = verdict(AI_TIER.LIMITED, [vramReason, reason('videoLimited')])
  else video = verdict(AI_TIER.CLOUD, [vramReason, reason('tooSmallForVideo')])

  return { llm, image, video }
}

const TIER_STATUS = {
  [AI_TIER.GOOD]: SETUP_STATUS.READY,
  [AI_TIER.LIMITED]: SETUP_STATUS.WARNING,
  [AI_TIER.CLOUD]: SETUP_STATUS.CLOUD,
  [AI_TIER.UNKNOWN]: SETUP_STATUS.UNAVAILABLE,
}

function computerChecks(hardware, assessment) {
  const gpu = hardware?.primaryGpu
  const summary = hardware
    ? check('hardware', SETUP_STATUS.READY, gpu ? 'setupDoctor.checks.hardware.summary' : 'setupDoctor.checks.hardware.summaryNoGpu', {
      cpu: hardware.cpuModel || '—',
      cores: hardware.cpuCores || '—',
      ...gpuVars(hardware),
    })
    : check('hardware', SETUP_STATUS.UNAVAILABLE, 'setupDoctor.checks.hardware.unknown')

  const aiCheck = (id, verdict, cloudFix) => check(
    id,
    TIER_STATUS[verdict.tier],
    `setupDoctor.ai.${id}.${verdict.tier}`,
    gpuVars(hardware),
    verdict.tier === AI_TIER.CLOUD ? cloudFix : null,
    verdict.reasons,
  )

  const aiChecks = [
    aiCheck('local-llm', assessment.llm, { type: SETUP_FIX.SETTINGS, target: 'agents', key: 'setupDoctor.fix.cloudAssistant' }),
    aiCheck('local-image', assessment.image, { type: SETUP_FIX.API_KEY, key: 'setupDoctor.fix.addKey' }),
    aiCheck('local-video', assessment.video, { type: SETUP_FIX.API_KEY, key: 'setupDoctor.fix.addKey' }),
  ]
  // Shared reasons (e.g. the VRAM explanation) read once; later checks keep only their own.
  const shown = new Set()
  for (const item of aiChecks) {
    if (item.status === SETUP_STATUS.READY) continue
    item.reasons = item.reasons.filter((reason) => !shown.has(reason.key))
    item.reasons.forEach((reason) => shown.add(reason.key))
  }
  return [summary, ...aiChecks]
}

// ---------------------------------------------------------------------------
// Workspace checks
// ---------------------------------------------------------------------------

function projectsFolderCheck(projects) {
  const fix = { type: SETUP_FIX.SETTINGS, target: 'storage', key: 'setupDoctor.fix.chooseFolder' }
  if (!projects?.configured) return check('projects-folder', SETUP_STATUS.NEEDS_ACTION, 'setupDoctor.checks.projectsFolder.missing', {}, fix)
  const vars = { path: projects.path || '' }
  if (!projects.exists) return check('projects-folder', SETUP_STATUS.NEEDS_ACTION, 'setupDoctor.checks.projectsFolder.gone', vars, fix)
  if (!projects.writable) return check('projects-folder', SETUP_STATUS.NEEDS_ACTION, 'setupDoctor.checks.projectsFolder.readOnly', vars, fix)

  const free = Number(projects.freeBytes)
  if (projects.freeBytes != null && Number.isFinite(free)) {
    const spaceVars = { ...vars, free: formatBytes(free) }
    if (free < LOW_DISK_BLOCKING_BYTES) return check('projects-folder', SETUP_STATUS.NEEDS_ACTION, 'setupDoctor.checks.projectsFolder.diskFull', spaceVars, fix)
    if (free < LOW_DISK_WARNING_BYTES) return check('projects-folder', SETUP_STATUS.WARNING, 'setupDoctor.checks.projectsFolder.diskLow', spaceVars, fix)
    return check('projects-folder', SETUP_STATUS.READY, 'setupDoctor.checks.projectsFolder.ready', spaceVars)
  }
  return check('projects-folder', SETUP_STATUS.READY, 'setupDoctor.checks.projectsFolder.readyNoSpace', vars)
}

function binaryCheck(id, probe, name) {
  if (probe?.ok) return check(id, SETUP_STATUS.READY, 'setupDoctor.checks.binary.ready', { name, version: probe.version || '' })
  const key = probe?.present ? 'setupDoctor.checks.binary.broken' : 'setupDoctor.checks.binary.missing'
  return check(id, SETUP_STATUS.NEEDS_ACTION, key, { name, error: probe?.error || '' })
}

function gpuCheck(gpu) {
  if (!gpu?.known) return check('gpu', SETUP_STATUS.UNAVAILABLE, 'setupDoctor.checks.gpu.unknown')
  if (gpu.hardwareAccelerated) {
    return check('gpu', SETUP_STATUS.READY, gpu.videoDecode ? 'setupDoctor.checks.gpu.ready' : 'setupDoctor.checks.gpu.readyNoDecode')
  }
  return check('gpu', SETUP_STATUS.WARNING, 'setupDoctor.checks.gpu.software')
}

function captionCheck(engine) {
  if (!engine || engine.platformSupported === false) {
    return check('caption-engine', SETUP_STATUS.UNAVAILABLE, 'setupDoctor.checks.captions.unsupported')
  }
  const install = { type: SETUP_FIX.INSTALL_CAPTIONS, key: 'setupDoctor.fix.installCaptions' }
  if (!engine.binaryPath) return check('caption-engine', SETUP_STATUS.NEEDS_ACTION, 'setupDoctor.checks.captions.noEngine', {}, install)
  const modelCount = Array.isArray(engine.models) ? engine.models.length : 0
  if (modelCount === 0) return check('caption-engine', SETUP_STATUS.NEEDS_ACTION, 'setupDoctor.checks.captions.noModel', {}, install)
  return check('caption-engine', SETUP_STATUS.READY, 'setupDoctor.checks.captions.ready', { count: modelCount })
}

function generationChecks(facts) {
  const comfyOk = Boolean(facts.comfy?.ok)
  const cloudKey = Boolean(facts.cloudKeyConfigured)
  const endpoint = { endpoint: facts.comfy?.httpBase || '' }
  const connectionFix = { type: SETUP_FIX.SETTINGS, target: 'connection', key: 'setupDoctor.fix.connection' }
  const checks = []

  if (comfyOk) {
    checks.push(check('comfy-connection', SETUP_STATUS.READY, 'setupDoctor.checks.comfy.ready', endpoint))
  } else if (facts.cloudOnly) {
    // Chosen on the setup screen: not a problem, just not set up yet.
    checks.push(check('comfy-connection', SETUP_STATUS.OPTIONAL, 'setupDoctor.checks.comfy.cloudOnly', endpoint,
      { type: SETUP_FIX.SETUP_COMFY, key: 'setupDoctor.fix.setupComfy' }))
  } else if (cloudKey) {
    checks.push(check('comfy-connection', SETUP_STATUS.OPTIONAL, 'setupDoctor.checks.comfy.offlineCloudOk', endpoint, connectionFix))
  } else if (facts.localVideoTier === AI_TIER.CLOUD) {
    // Local generation would not run well on this PC: steer to cloud rather than ComfyUI setup.
    checks.push(check('comfy-connection', SETUP_STATUS.NEEDS_ACTION, 'setupDoctor.checks.comfy.offlineUseCloud', endpoint,
      { type: SETUP_FIX.API_KEY, key: 'setupDoctor.fix.addKey' }))
  } else {
    checks.push(check('comfy-connection', SETUP_STATUS.NEEDS_ACTION, 'setupDoctor.checks.comfy.offline', endpoint, connectionFix))
  }

  checks.push(cloudKey
    ? check('cloud-key', SETUP_STATUS.READY, 'setupDoctor.checks.cloudKey.ready')
    : check('cloud-key', SETUP_STATUS.OPTIONAL, 'setupDoctor.checks.cloudKey.missing', {}, { type: SETUP_FIX.API_KEY, key: 'setupDoctor.fix.addKey' }))

  // The bridge only matters once a local ComfyUI is reachable.
  if (comfyOk && facts.bridge) {
    checks.push(facts.bridge.installed
      ? check('comfy-bridge', SETUP_STATUS.READY, 'setupDoctor.checks.bridge.ready')
      : check('comfy-bridge', SETUP_STATUS.OPTIONAL, 'setupDoctor.checks.bridge.missing', {}, { type: SETUP_FIX.INSTALL_BRIDGE, key: 'setupDoctor.fix.installBridge' }))
  }

  const launcherConfigured = Boolean(String(facts.launcher?.launcherScript || facts.launcher?.macAppPath || '').trim())
  checks.push(launcherConfigured
    ? check('comfy-launcher', SETUP_STATUS.READY, 'setupDoctor.checks.launcher.ready')
    : check('comfy-launcher', SETUP_STATUS.OPTIONAL, 'setupDoctor.checks.launcher.missing', {}, { type: SETUP_FIX.SETTINGS, target: 'launcher', key: 'setupDoctor.fix.launcher' }))

  return checks
}

function accelerationChecks(facts) {
  const checks = []
  checks.push(facts.rife?.available
    ? check('optical-flow', SETUP_STATUS.READY, 'setupDoctor.checks.opticalFlow.ready')
    : check('optical-flow', SETUP_STATUS.WARNING, 'setupDoctor.checks.opticalFlow.missing', { error: facts.rife?.error || '' }))

  if (facts.platform === 'win32' && facts.rtx) {
    checks.push(facts.rtx.ready
      ? check('rtx-upscale', SETUP_STATUS.READY, 'setupDoctor.checks.rtx.ready')
      : check('rtx-upscale', facts.rtx.installAvailable ? SETUP_STATUS.OPTIONAL : SETUP_STATUS.UNAVAILABLE, 'setupDoctor.checks.rtx.missing'))
  }
  return checks
}

function agentCheck(mcp) {
  if (mcp?.running) return check('mcp', SETUP_STATUS.READY, 'setupDoctor.checks.mcp.ready', { url: mcp.url || '' })
  return check('mcp', SETUP_STATUS.OPTIONAL, 'setupDoctor.checks.mcp.stopped', { error: mcp?.error || '' }, { type: SETUP_FIX.SETTINGS, target: 'agents', key: 'setupDoctor.fix.agents' })
}

function worstStatus(checks) {
  return checks.reduce((worst, item) => (STATUS_RANK[item.status] < STATUS_RANK[worst] ? item.status : worst), SETUP_STATUS.READY)
}

function area(id, required, checks) {
  const visible = checks.filter(Boolean)
  return { id, required, status: worstStatus(visible), checks: visible }
}

/**
 * Build the Setup Doctor report.
 * @param {Object} facts - output of gatherSetupFacts()
 * @returns {{ areas: Array, summary: Object, assessment: Object }}
 */
export function buildSetupReport(facts = {}) {
  const native = facts.native || {}
  const assessment = assessLocalAi(native.hardware)
  const areas = [
    area('computer', false, computerChecks(native.hardware, assessment)),
    area('editing', true, [
      projectsFolderCheck(native.projects),
      binaryCheck('ffmpeg', native.ffmpeg, 'FFmpeg'),
      binaryCheck('ffprobe', native.ffprobe, 'FFprobe'),
      gpuCheck(native.gpu),
    ]),
    area('captions', false, [captionCheck(facts.captionEngine)]),
    area('generation', false, generationChecks({ ...facts, localVideoTier: assessment.video.tier })),
    area('stock', false, [
      facts.pexelsConfigured
        ? check('pexels', SETUP_STATUS.READY, 'setupDoctor.checks.pexels.ready')
        : check('pexels', SETUP_STATUS.OPTIONAL, 'setupDoctor.checks.pexels.missing', {}, { type: SETUP_FIX.SETTINGS, target: 'stock', key: 'setupDoctor.fix.stock' }),
    ]),
    area('acceleration', false, accelerationChecks({ ...facts, platform: native.platform, rife: native.rife })),
    area('agents', false, [agentCheck(facts.mcp)]),
  ]

  const allChecks = areas.flatMap((item) => item.checks)
  const count = (status) => allChecks.filter((item) => item.status === status).length
  const summary = {
    total: allChecks.length,
    ready: count(SETUP_STATUS.READY),
    needsAction: count(SETUP_STATUS.NEEDS_ACTION),
    warnings: count(SETUP_STATUS.WARNING),
    cloud: count(SETUP_STATUS.CLOUD),
    optional: count(SETUP_STATUS.OPTIONAL),
    // Editing/export is the core workspace; anything blocking there is urgent.
    blocking: areas.some((item) => item.required && item.status === SETUP_STATUS.NEEDS_ACTION),
  }
  return { areas, summary, assessment }
}
