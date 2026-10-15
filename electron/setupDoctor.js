'use strict'

// Native facts for the Setup Doctor. Everything here is read-only: it probes
// bundled binaries, the projects folder and GPU state, and never installs,
// repairs or deletes anything. The renderer turns these facts into advice.

const fs = require('fs')
const path = require('path')
const { execFile, spawn } = require('child_process')

const VERSION_PROBE_TIMEOUT_MS = 5000

/**
 * Run `<binary> -version` and pull the version token from the first line.
 * Resolves (never rejects) with { present, ok, version, error }.
 */
function probeBinaryVersion(binaryPath, { timeoutMs = VERSION_PROBE_TIMEOUT_MS, spawnImpl = spawn, existsSync = fs.existsSync } = {}) {
  if (!binaryPath) {
    return Promise.resolve({ present: false, ok: false, version: null, error: 'No binary path is configured.' })
  }
  if (!existsSync(binaryPath)) {
    return Promise.resolve({ present: false, ok: false, version: null, error: `Missing at ${binaryPath}` })
  }

  return new Promise((resolve) => {
    let settled = false
    let stdout = ''
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    let child
    try {
      child = spawnImpl(binaryPath, ['-version'], { windowsHide: true })
    } catch (error) {
      finish({ present: true, ok: false, version: null, error: error?.message || String(error) })
      return
    }

    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already gone */ }
      finish({ present: true, ok: false, version: null, error: `No response within ${timeoutMs} ms.` })
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
    child.on('error', (error) => {
      finish({ present: true, ok: false, version: null, error: error?.message || String(error) })
    })
    child.on('close', (code) => {
      const firstLine = stdout.split(/\r?\n/)[0] || ''
      const match = firstLine.match(/version\s+(\S+)/i)
      if (code === 0 && match) {
        finish({ present: true, ok: true, version: match[1], error: null })
      } else {
        finish({ present: true, ok: false, version: null, error: `Exited with code ${code}.` })
      }
    })
  })
}

/**
 * Check that the projects folder exists, accepts writes and has free space.
 * The write test creates and removes one tiny dot-file.
 */
async function checkProjectsFolder(projectsPath, { fsp = fs.promises } = {}) {
  const result = {
    configured: false,
    path: null,
    exists: false,
    writable: false,
    freeBytes: null,
    totalBytes: null,
    error: null,
  }
  if (typeof projectsPath !== 'string' || !projectsPath.trim()) return result
  result.configured = true
  result.path = projectsPath

  try {
    const stats = await fsp.stat(projectsPath)
    result.exists = stats.isDirectory()
    if (!result.exists) {
      result.error = 'The projects location is not a folder.'
      return result
    }
  } catch (error) {
    result.error = error?.code === 'ENOENT' ? 'The projects folder no longer exists.' : (error?.message || String(error))
    return result
  }

  const probePath = path.join(projectsPath, `.drama-studio-write-test-${process.pid}-${Date.now()}`)
  try {
    await fsp.writeFile(probePath, 'ok')
    result.writable = true
  } catch (error) {
    result.error = error?.message || String(error)
  } finally {
    await fsp.rm(probePath, { force: true }).catch(() => {})
  }

  try {
    const stats = await fsp.statfs(projectsPath)
    result.freeBytes = Number(stats.bavail) * Number(stats.bsize)
    result.totalBytes = Number(stats.blocks) * Number(stats.bsize)
  } catch {
    // statfs is best-effort; the report treats unknown space as "not checked".
  }
  return result
}

/** Reduce Chromium's feature-status map to the parts the editor depends on. */
function summarizeGpuFeatures(featureStatus) {
  const status = featureStatus && typeof featureStatus === 'object' ? featureStatus : {}
  const enabled = (key) => typeof status[key] === 'string' && status[key].startsWith('enabled')
  const webgl = enabled('webgl2') || enabled('webgl')
  const videoDecode = enabled('video_decode')
  const compositing = enabled('gpu_compositing')
  return {
    known: Object.keys(status).length > 0,
    webgl,
    videoDecode,
    compositing,
    hardwareAccelerated: webgl && compositing,
  }
}

const HARDWARE_PROBE_TIMEOUT_MS = 4000
const WINDOWS_DISPLAY_CLASS_KEY = 'HKLM\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'
const MIB = 1024 ** 2

/** execFile wrapper that resolves (never rejects) with { ok, stdout }. */
function runCommand(file, args, { timeoutMs = HARDWARE_PROBE_TIMEOUT_MS, execFileImpl = execFile } = {}) {
  return new Promise((resolve) => {
    try {
      execFileImpl(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
        resolve({ ok: !error, stdout: String(stdout || '') })
      })
    } catch {
      resolve({ ok: false, stdout: '' })
    }
  })
}

function vendorFromName(name) {
  const value = String(name || '').toLowerCase()
  if (/nvidia|geforce|quadro|rtx|gtx|tesla/.test(value)) return 'nvidia'
  if (/amd|radeon|ati /.test(value)) return 'amd'
  if (/intel|iris|uhd|arc/.test(value)) return 'intel'
  if (/apple/.test(value)) return 'apple'
  return 'unknown'
}

function vendorFromId(vendorId) {
  return ({ 0x10de: 'nvidia', 0x1002: 'amd', 0x1022: 'amd', 0x8086: 'intel', 0x106b: 'apple' })[Number(vendorId)] || 'unknown'
}

/** Parse `nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits`. */
function parseNvidiaSmi(stdout) {
  return String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, memoryMiB, driver] = line.split(',').map((part) => part.trim())
    const mib = Number(memoryMiB)
    return {
      name: name || 'NVIDIA GPU',
      vendor: 'nvidia',
      vramBytes: Number.isFinite(mib) && mib > 0 ? mib * MIB : null,
      driver: driver || null,
      unifiedMemory: false,
    }
  }).filter((gpu) => gpu.name)
}

/**
 * Join two `reg query /s /v` outputs (qwMemorySize and DriverDesc) by adapter
 * subkey. The 64-bit qwMemorySize is accurate where WMI's AdapterRAM caps at 4 GB.
 */
function parseWindowsDisplayRegistry(memoryOutput, descriptionOutput) {
  const collect = (output, valueName) => {
    const values = new Map()
    let currentKey = null
    for (const rawLine of String(output || '').split(/\r?\n/)) {
      const line = rawLine.trim()
      if (line.startsWith('HKEY_')) { currentKey = line; continue }
      if (!currentKey || !line.startsWith(valueName)) continue
      const parts = line.split(/\s{2,}|\t/).filter(Boolean)
      values.set(currentKey, parts[parts.length - 1])
    }
    return values
  }
  const memory = collect(memoryOutput, 'HardwareInformation.qwMemorySize')
  const descriptions = collect(descriptionOutput, 'DriverDesc')
  const gpus = []
  for (const [key, name] of descriptions) {
    const raw = memory.get(key)
    let vramBytes = null
    if (raw) {
      try {
        const parsed = Number(BigInt(raw))
        vramBytes = parsed > 0 ? parsed : null
      } catch { /* malformed value */ }
    }
    gpus.push({ name, vendor: vendorFromName(name), vramBytes, driver: null, unifiedMemory: false })
  }
  return gpus
}

/** The GPU AI workloads will use: the one with the most dedicated memory. */
function pickPrimaryGpu(gpus) {
  if (!Array.isArray(gpus) || gpus.length === 0) return null
  return [...gpus].sort((a, b) => (Number(b.vramBytes) || 0) - (Number(a.vramBytes) || 0))[0]
}

async function probeHardware({
  platform = process.platform,
  arch = process.arch,
  totalMemBytes = null,
  cpus = [],
  gpuInfo = null,
  run = runCommand,
} = {}) {
  let gpus = []

  const smi = await run('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'])
  if (smi.ok) gpus = parseNvidiaSmi(smi.stdout)

  if (gpus.length === 0 && platform === 'win32') {
    const [memoryOutput, descriptionOutput] = await Promise.all([
      run('reg', ['query', WINDOWS_DISPLAY_CLASS_KEY, '/s', '/v', 'HardwareInformation.qwMemorySize']),
      run('reg', ['query', WINDOWS_DISPLAY_CLASS_KEY, '/s', '/v', 'DriverDesc']),
    ])
    if (descriptionOutput.ok) gpus = parseWindowsDisplayRegistry(memoryOutput.stdout, descriptionOutput.stdout)
  }

  if (gpus.length === 0 && platform === 'darwin' && arch === 'arm64') {
    // Apple Silicon shares system memory with the GPU.
    gpus = [{ name: 'Apple Silicon GPU', vendor: 'apple', vramBytes: totalMemBytes, driver: null, unifiedMemory: true }]
  }

  if (gpus.length === 0 && Array.isArray(gpuInfo?.gpuDevice)) {
    gpus = gpuInfo.gpuDevice.map((device) => ({
      name: device.deviceString || null,
      vendor: vendorFromId(device.vendorId),
      vramBytes: null,
      driver: device.driverVersion || null,
      unifiedMemory: false,
    }))
  }

  return {
    platform,
    arch,
    totalMemBytes,
    cpuModel: cpus?.[0]?.model ? String(cpus[0].model).trim() : null,
    cpuCores: Array.isArray(cpus) ? cpus.length : null,
    gpus,
    primaryGpu: pickPrimaryGpu(gpus),
  }
}

async function collectNativeSetupChecks({
  ffmpegPath,
  ffprobePath,
  projectsPath,
  resolveRife,
  gpuFeatureStatus,
  platform = process.platform,
  arch = process.arch,
  totalMemBytes = null,
  probeVersion = probeBinaryVersion,
  checkFolder = checkProjectsFolder,
  cpus = [],
  gpuInfo = null,
  hardwareProbe = probeHardware,
} = {}) {
  const [ffmpeg, ffprobe, projects, hardware] = await Promise.all([
    probeVersion(ffmpegPath),
    probeVersion(ffprobePath),
    checkFolder(projectsPath),
    hardwareProbe({ platform, arch, totalMemBytes, cpus, gpuInfo }).catch(() => null),
  ])

  let rife = { available: false, error: 'Frame interpolation runtime was not checked.' }
  if (typeof resolveRife === 'function') {
    try {
      const runtime = resolveRife()
      rife = { available: Boolean(runtime?.available), error: runtime?.available ? null : (runtime?.error || null) }
    } catch (error) {
      rife = { available: false, error: error?.message || String(error) }
    }
  }

  return {
    platform,
    arch,
    totalMemBytes,
    ffmpeg,
    ffprobe,
    projects,
    rife,
    gpu: summarizeGpuFeatures(gpuFeatureStatus),
    hardware,
  }
}

module.exports = {
  probeBinaryVersion,
  probeHardware,
  parseNvidiaSmi,
  parseWindowsDisplayRegistry,
  pickPrimaryGpu,
  checkProjectsFolder,
  summarizeGpuFeatures,
  collectNativeSetupChecks,
}
