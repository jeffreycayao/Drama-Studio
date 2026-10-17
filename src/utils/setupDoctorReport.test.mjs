import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AI_TIER,
  SETUP_FIX,
  SETUP_STATUS,
  assessLocalAi,
  buildSetupReport,
  formatBytes,
} from './setupDoctorReport.js'

const GIB = 1024 ** 3

function hardware({ vendor = 'nvidia', vram = 8, ram = 32, name = 'Test GPU', unified = false, gpu = true } = {}) {
  return {
    platform: 'win32',
    totalMemBytes: ram * GIB,
    cpuModel: 'Test CPU',
    cpuCores: 16,
    primaryGpu: gpu ? { name, vendor, vramBytes: unified ? ram * GIB : vram * GIB, unifiedMemory: unified } : null,
  }
}

function tiers(hw) {
  const result = assessLocalAi(hw)
  return { llm: result.llm.tier, image: result.image.tier, video: result.video.tier }
}

function healthyNative(overrides = {}) {
  return {
    platform: 'win32',
    projects: { configured: true, path: 'D:/Projects', exists: true, writable: true, freeBytes: 500 * GIB },
    ffmpeg: { present: true, ok: true, version: '6.1' },
    ffprobe: { present: true, ok: true, version: '6.1' },
    gpu: { known: true, hardwareAccelerated: true, videoDecode: true },
    rife: { available: true },
    hardware: hardware({ vram: 24 }),
    ...overrides,
  }
}

function findCheck(report, id) {
  return report.areas.flatMap((area) => area.checks).find((item) => item.id === id)
}

test('8 GB NVIDIA card: small local LLMs and images, video goes to the cloud', () => {
  assert.deepEqual(tiers(hardware({ vram: 8 })), { llm: AI_TIER.LIMITED, image: AI_TIER.LIMITED, video: AI_TIER.CLOUD })
})

test('24 GB NVIDIA card runs everything locally', () => {
  assert.deepEqual(tiers(hardware({ vram: 24 })), { llm: AI_TIER.GOOD, image: AI_TIER.GOOD, video: AI_TIER.GOOD })
})

test('12 GB NVIDIA card: good assistant and images, limited video', () => {
  assert.deepEqual(tiers(hardware({ vram: 12 })), { llm: AI_TIER.GOOD, image: AI_TIER.GOOD, video: AI_TIER.LIMITED })
})

test('no dedicated GPU sends every AI workload to the cloud with a reason', () => {
  const result = assessLocalAi(hardware({ gpu: false }))
  for (const verdict of [result.llm, result.image, result.video]) {
    assert.equal(verdict.tier, AI_TIER.CLOUD)
    assert.equal(verdict.reasons[0].key, 'setupDoctor.ai.reasons.noGpu')
  }
})

test('integrated graphics with tiny shared memory counts as no GPU', () => {
  assert.deepEqual(tiers(hardware({ vendor: 'intel', vram: 1 })), { llm: AI_TIER.CLOUD, image: AI_TIER.CLOUD, video: AI_TIER.CLOUD })
})

test('low system RAM rules out the local assistant and video even with a good GPU', () => {
  const result = assessLocalAi(hardware({ vram: 16, ram: 8 }))
  assert.equal(result.llm.tier, AI_TIER.CLOUD)
  assert.equal(result.llm.reasons[0].key, 'setupDoctor.ai.reasons.lowRam')
  assert.equal(result.video.tier, AI_TIER.CLOUD)
})

test('AMD GPU: local assistant fine, CUDA-centric video goes to the cloud', () => {
  const result = assessLocalAi(hardware({ vendor: 'amd', vram: 16 }))
  assert.equal(result.llm.tier, AI_TIER.GOOD)
  assert.equal(result.image.tier, AI_TIER.LIMITED)
  assert.equal(result.video.tier, AI_TIER.CLOUD)
  assert.equal(result.video.reasons[0].key, 'setupDoctor.ai.reasons.noCuda')
})

test('Apple Silicon uses ~70% of unified memory for models', () => {
  assert.equal(assessLocalAi(hardware({ vendor: 'apple', unified: true, ram: 32 })).llm.tier, AI_TIER.GOOD)
  assert.equal(assessLocalAi(hardware({ vendor: 'apple', unified: true, ram: 16 })).llm.tier, AI_TIER.LIMITED)
  assert.equal(assessLocalAi(hardware({ vendor: 'apple', unified: true, ram: 8 })).llm.tier, AI_TIER.CLOUD)
})

test('unknown hardware is reported as unknown, not as cloud', () => {
  assert.deepEqual(tiers(null), { llm: AI_TIER.UNKNOWN, image: AI_TIER.UNKNOWN, video: AI_TIER.UNKNOWN })
})

test('cloud verdicts carry a fix and map to the cloud status', () => {
  const report = buildSetupReport({ native: healthyNative({ hardware: hardware({ gpu: false }) }) })
  const llm = findCheck(report, 'local-llm')
  assert.equal(llm.status, SETUP_STATUS.CLOUD)
  assert.deepEqual(llm.fix, { type: SETUP_FIX.SETTINGS, target: 'agents', key: 'setupDoctor.fix.cloudAssistant' })
  assert.equal(findCheck(report, 'local-video').fix.type, SETUP_FIX.API_KEY)
  assert.equal(report.summary.cloud, 3)
})

test('cloud only: ComfyUI offline is optional and offers setup', () => {
  const report = buildSetupReport({ native: healthyNative(), comfy: { ok: false }, cloudOnly: true })
  const comfy = findCheck(report, 'comfy-connection')
  assert.equal(comfy.status, SETUP_STATUS.OPTIONAL)
  assert.equal(comfy.key, 'setupDoctor.checks.comfy.cloudOnly')
  assert.equal(comfy.fix.type, SETUP_FIX.SETUP_COMFY)
  const online = buildSetupReport({ native: healthyNative(), comfy: { ok: true }, cloudOnly: true })
  assert.equal(findCheck(online, 'comfy-connection').status, SETUP_STATUS.READY, 'a running ComfyUI is simply ready')
})

test('missing projects folder blocks the core workspace', () => {
  const report = buildSetupReport({ native: healthyNative({ projects: { configured: false } }) })
  const editing = report.areas.find((area) => area.id === 'editing')
  assert.equal(editing.status, SETUP_STATUS.NEEDS_ACTION)
  assert.equal(report.summary.blocking, true)
  assert.equal(findCheck(report, 'projects-folder').fix.target, 'storage')
})

test('disk space thresholds: warn under 20 GB, block under 2 GB', () => {
  const at = (freeGib) => findCheck(buildSetupReport({
    native: healthyNative({ projects: { configured: true, path: 'D:/P', exists: true, writable: true, freeBytes: freeGib * GIB } }),
  }), 'projects-folder')
  assert.equal(at(100).status, SETUP_STATUS.READY)
  assert.equal(at(10).status, SETUP_STATUS.WARNING)
  assert.equal(at(1).status, SETUP_STATUS.NEEDS_ACTION)
  assert.equal(at(1).key, 'setupDoctor.checks.projectsFolder.diskFull')
})

test('broken bundled FFmpeg is a blocking problem with its error', () => {
  const report = buildSetupReport({ native: healthyNative({ ffmpeg: { present: true, ok: false, error: 'Exited with code 1.' } }) })
  const ffmpeg = findCheck(report, 'ffmpeg')
  assert.equal(ffmpeg.status, SETUP_STATUS.NEEDS_ACTION)
  assert.equal(ffmpeg.key, 'setupDoctor.checks.binary.broken')
  assert.equal(ffmpeg.vars.error, 'Exited with code 1.')
  assert.equal(report.summary.blocking, true)
})

test('offline ComfyUI on a PC unfit for local video steers to a cloud key', () => {
  const report = buildSetupReport({ native: healthyNative({ hardware: hardware({ vram: 8 }) }), comfy: { ok: false, httpBase: 'http://127.0.0.1:8188' } })
  const comfy = findCheck(report, 'comfy-connection')
  assert.equal(comfy.key, 'setupDoctor.checks.comfy.offlineUseCloud')
  assert.equal(comfy.fix.type, SETUP_FIX.API_KEY)
})

test('offline ComfyUI on a capable PC points at connection settings', () => {
  const report = buildSetupReport({ native: healthyNative(), comfy: { ok: false } })
  const comfy = findCheck(report, 'comfy-connection')
  assert.equal(comfy.key, 'setupDoctor.checks.comfy.offline')
  assert.equal(comfy.fix.target, 'connection')
})

test('a saved cloud key makes an offline ComfyUI optional', () => {
  const report = buildSetupReport({ native: healthyNative(), comfy: { ok: false }, cloudKeyConfigured: true })
  assert.equal(findCheck(report, 'comfy-connection').status, SETUP_STATUS.OPTIONAL)
  assert.equal(report.areas.find((area) => area.id === 'generation').status, SETUP_STATUS.OPTIONAL)
})

test('the ComfyUI bridge check only appears once ComfyUI is reachable', () => {
  const offline = buildSetupReport({ native: healthyNative(), comfy: { ok: false }, bridge: { installed: false } })
  assert.equal(findCheck(offline, 'comfy-bridge'), undefined)
  const online = buildSetupReport({ native: healthyNative(), comfy: { ok: true, httpBase: 'x' }, bridge: { installed: false } })
  assert.equal(findCheck(online, 'comfy-bridge').fix.type, SETUP_FIX.INSTALL_BRIDGE)
})

test('caption engine without a model offers the install fix', () => {
  const report = buildSetupReport({ native: healthyNative(), captionEngine: { platformSupported: true, binaryPath: '/bin/whisper', models: [] } })
  const captions = findCheck(report, 'caption-engine')
  assert.equal(captions.key, 'setupDoctor.checks.captions.noModel')
  assert.equal(captions.fix.type, SETUP_FIX.INSTALL_CAPTIONS)
})

test('a fully set up capable PC has nothing to fix', () => {
  const report = buildSetupReport({
    native: healthyNative(),
    captionEngine: { platformSupported: true, binaryPath: '/bin/whisper', models: [{ id: 'base' }] },
    comfy: { ok: true, httpBase: 'http://127.0.0.1:8188' },
    cloudKeyConfigured: true,
    pexelsConfigured: true,
    bridge: { installed: true },
    launcher: { launcherScript: 'C:/ComfyUI/run.bat' },
    mcp: { running: true, url: 'http://127.0.0.1:8787/mcp' },
  })
  assert.equal(report.summary.needsAction, 0)
  assert.equal(report.summary.warnings, 0)
  assert.equal(report.summary.blocking, false)
  assert.equal(report.summary.ready, report.summary.total)
})

test('formatBytes renders GB with sensible precision', () => {
  assert.equal(formatBytes(8 * GIB), '8 GB')
  assert.equal(formatBytes(31.9 * GIB), '31.9 GB')
  assert.equal(formatBytes(512 * GIB), '512 GB')
  assert.equal(formatBytes(300 * 1024 ** 2), '300 MB')
  assert.equal(formatBytes(null), '—')
})

test('a shared reason is shown once across the AI checks', () => {
  const report = buildSetupReport({ native: healthyNative({ hardware: hardware({ vram: 8 }) }) })
  const reasonKeys = ['local-llm', 'local-image', 'local-video'].map((id) => findCheck(report, id).reasons.map((reason) => reason.key))
  assert.deepEqual(reasonKeys, [
    ['setupDoctor.ai.reasons.vram', 'setupDoctor.ai.reasons.smallModels'],
    ['setupDoctor.ai.reasons.imageLimited'],
    ['setupDoctor.ai.reasons.tooSmallForVideo'],
  ])
})
