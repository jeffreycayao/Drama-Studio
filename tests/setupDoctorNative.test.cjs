const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')
const {
  checkProjectsFolder,
  collectNativeSetupChecks,
  parseNvidiaSmi,
  parseWindowsDisplayRegistry,
  pickPrimaryGpu,
  probeBinaryVersion,
  probeHardware,
  summarizeGpuFeatures,
} = require('../electron/setupDoctor')

const GIB = 1024 ** 3

function fakeSpawn({ stdout = '', code = 0, error = null } = {}) {
  return () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.kill = () => {}
    setImmediate(() => {
      if (error) return child.emit('error', error)
      child.stdout.emit('data', Buffer.from(stdout))
      child.emit('close', code)
    })
    return child
  }
}

test('probeBinaryVersion reads the version token from -version output', async () => {
  const result = await probeBinaryVersion('/bin/ffmpeg', {
    existsSync: () => true,
    spawnImpl: fakeSpawn({ stdout: 'ffmpeg version 6.1.1-static Copyright (c) 2000-2023\nbuilt with gcc' }),
  })
  assert.deepEqual(result, { present: true, ok: true, version: '6.1.1-static', error: null })
})

test('probeBinaryVersion reports a missing binary without spawning', async () => {
  let spawned = false
  const result = await probeBinaryVersion('/missing/ffmpeg', { existsSync: () => false, spawnImpl: () => { spawned = true } })
  assert.equal(result.present, false)
  assert.equal(result.ok, false)
  assert.equal(spawned, false)
})

test('probeBinaryVersion treats a failing binary as present but broken', async () => {
  const exited = await probeBinaryVersion('/bin/ffmpeg', { existsSync: () => true, spawnImpl: fakeSpawn({ code: 1 }) })
  assert.equal(exited.present, true)
  assert.equal(exited.ok, false)
  const blocked = await probeBinaryVersion('/bin/ffmpeg', { existsSync: () => true, spawnImpl: fakeSpawn({ error: new Error('EPERM') }) })
  assert.equal(blocked.error, 'EPERM')
})

test('probeBinaryVersion times out a hung binary', async () => {
  const hung = () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.kill = () => {}
    return child
  }
  const result = await probeBinaryVersion('/bin/ffmpeg', { existsSync: () => true, spawnImpl: hung, timeoutMs: 20 })
  assert.equal(result.ok, false)
  assert.match(result.error, /No response/)
})

test('checkProjectsFolder confirms a writable folder and cleans up its probe file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-doctor-'))
  try {
    const result = await checkProjectsFolder(dir)
    assert.equal(result.configured, true)
    assert.equal(result.exists, true)
    assert.equal(result.writable, true)
    assert.ok(result.freeBytes > 0)
    assert.deepEqual(fs.readdirSync(dir), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('checkProjectsFolder handles unset and missing folders', async () => {
  assert.equal((await checkProjectsFolder('')).configured, false)
  const missing = await checkProjectsFolder(path.join(os.tmpdir(), `ds-missing-${Date.now()}`))
  assert.equal(missing.configured, true)
  assert.equal(missing.exists, false)
  assert.match(missing.error, /no longer exists/)
})

test('parseNvidiaSmi converts MiB to bytes for each GPU', () => {
  const gpus = parseNvidiaSmi('NVIDIA GeForce RTX 3060, 8192, 610.88\r\nNVIDIA RTX A6000, 49140, 610.88\r\n')
  assert.equal(gpus.length, 2)
  assert.deepEqual(gpus[0], { name: 'NVIDIA GeForce RTX 3060', vendor: 'nvidia', vramBytes: 8 * GIB, driver: '610.88', unifiedMemory: false })
  assert.equal(pickPrimaryGpu(gpus).name, 'NVIDIA RTX A6000')
})

test('parseWindowsDisplayRegistry joins adapters across the two reg queries', () => {
  const key = 'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}'
  const memory = [
    `${key}\\0000`,
    '    HardwareInformation.qwMemorySize    REG_QWORD    0x400000000',
    '',
    'End of search: 1 match(es) found.',
  ].join('\r\n')
  const descriptions = [
    `${key}\\0000`,
    '    DriverDesc    REG_SZ    AMD Radeon RX 7600',
    '',
    `${key}\\0001`,
    '    DriverDesc    REG_SZ    Intel(R) UHD Graphics 770',
    '',
    'End of search: 2 match(es) found.',
  ].join('\r\n')
  const gpus = parseWindowsDisplayRegistry(memory, descriptions)
  assert.deepEqual(gpus.map((gpu) => [gpu.name, gpu.vendor, gpu.vramBytes]), [
    ['AMD Radeon RX 7600', 'amd', 16 * GIB],
    ['Intel(R) UHD Graphics 770', 'intel', null],
  ])
  assert.equal(pickPrimaryGpu(gpus).vendor, 'amd')
})

test('probeHardware prefers nvidia-smi and falls back to the Windows registry', async () => {
  const viaSmi = await probeHardware({
    platform: 'win32',
    totalMemBytes: 32 * GIB,
    cpus: [{ model: ' AMD Ryzen 7 5800X ' }, {}],
    run: async (file) => (file === 'nvidia-smi' ? { ok: true, stdout: 'NVIDIA GeForce RTX 4090, 24564, 600.1' } : { ok: false, stdout: '' }),
  })
  assert.equal(viaSmi.primaryGpu.name, 'NVIDIA GeForce RTX 4090')
  assert.equal(viaSmi.cpuModel, 'AMD Ryzen 7 5800X')
  assert.equal(viaSmi.cpuCores, 2)

  const calls = []
  const viaRegistry = await probeHardware({
    platform: 'win32',
    run: async (file, args) => {
      calls.push([file, args.at(-1)])
      if (file === 'nvidia-smi') return { ok: false, stdout: '' }
      if (args.at(-1) === 'DriverDesc') return { ok: true, stdout: 'HKEY_X\\0000\r\n    DriverDesc    REG_SZ    AMD Radeon RX 6800\r\n' }
      return { ok: true, stdout: 'HKEY_X\\0000\r\n    HardwareInformation.qwMemorySize    REG_QWORD    0x400000000\r\n' }
    },
  })
  assert.equal(viaRegistry.primaryGpu.name, 'AMD Radeon RX 6800')
  assert.equal(viaRegistry.primaryGpu.vramBytes, 16 * GIB)
  assert.ok(calls.some(([file]) => file === 'reg'))
})

test('probeHardware treats Apple Silicon memory as unified GPU memory', async () => {
  const result = await probeHardware({
    platform: 'darwin',
    arch: 'arm64',
    totalMemBytes: 32 * GIB,
    run: async () => ({ ok: false, stdout: '' }),
  })
  assert.equal(result.primaryGpu.vendor, 'apple')
  assert.equal(result.primaryGpu.unifiedMemory, true)
  assert.equal(result.primaryGpu.vramBytes, 32 * GIB)
})

test('probeHardware falls back to Chromium GPU vendor ids', async () => {
  const result = await probeHardware({
    platform: 'linux',
    gpuInfo: { gpuDevice: [{ vendorId: 0x1002, deviceId: 0x73bf }] },
    run: async () => ({ ok: false, stdout: '' }),
  })
  assert.equal(result.primaryGpu.vendor, 'amd')
  assert.equal(result.primaryGpu.vramBytes, null)
})

test('summarizeGpuFeatures needs WebGL and GPU compositing for acceleration', () => {
  assert.deepEqual(
    summarizeGpuFeatures({ webgl2: 'enabled', gpu_compositing: 'enabled', video_decode: 'enabled' }),
    { known: true, webgl: true, videoDecode: true, compositing: true, hardwareAccelerated: true },
  )
  assert.equal(summarizeGpuFeatures({ webgl2: 'unavailable_software', gpu_compositing: 'disabled_software' }).hardwareAccelerated, false)
  assert.equal(summarizeGpuFeatures(null).known, false)
})

test('collectNativeSetupChecks survives a throwing runtime resolver and hardware probe', async () => {
  const result = await collectNativeSetupChecks({
    ffmpegPath: '/bin/ffmpeg',
    ffprobePath: '/bin/ffprobe',
    projectsPath: '',
    resolveRife: () => { throw new Error('bad runtime') },
    gpuFeatureStatus: { webgl2: 'enabled', gpu_compositing: 'enabled' },
    probeVersion: async () => ({ present: true, ok: true, version: '6', error: null }),
    hardwareProbe: async () => { throw new Error('probe failed') },
  })
  assert.equal(result.rife.available, false)
  assert.equal(result.rife.error, 'bad runtime')
  assert.equal(result.hardware, null)
  assert.equal(result.gpu.hardwareAccelerated, true)
  assert.equal(result.projects.configured, false)
})
