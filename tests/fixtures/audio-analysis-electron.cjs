// Isolated test host: production analysis IPC/preload, never production main.
const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { Worker } = require('node:worker_threads')
const { createAudioAnalysisService, registerAudioAnalysisHandlers } = require('../../electron/audioAnalysisNative.cjs')

const profile = process.env.DRAMA_STUDIO_TEST_AUDIO_PROFILE
if (!profile || path.dirname(profile) !== os.tmpdir() || !path.basename(profile).startsWith('drama-studio-audio-analysis-')) {
  throw new Error('Launch using scripts/check-audio-analysis.cjs; a fixture-owned temporary profile is required')
}
app.setPath('userData', profile)
const base = new URL(process.env.DRAMA_STUDIO_TEST_URL || 'http://127.0.0.1:5317')
if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1') throw new Error('Loopback Vite required')
const probePackage = require('@derhuerst/ffprobe-static')
const ffmpegPath = process.env.DRAMA_STUDIO_TEST_FFMPEG || require('ffmpeg-static')
const ffprobePath = process.env.DRAMA_STUDIO_TEST_FFPROBE || (typeof probePackage === 'string' ? probePackage : probePackage.path)
for (const binary of [ffmpegPath, ffprobePath]) fs.accessSync(binary, fs.constants.X_OK)

function waveHeader(sampleRate, samples) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + samples * 2, 4); header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(samples * 2, 40)
  return header
}
const wavPath = path.join(profile, 'synthetic-120bpm.wav')
const sampleRate = 24000, sampleCount = sampleRate * 12
const pcm = Buffer.alloc(sampleCount * 2)
for (let i = 0; i < sampleCount; i++) {
  const beatTime = (i / sampleRate) % 0.5
  const sample = beatTime < 0.08 ? 0.8 * Math.sin(2 * Math.PI * 180 * beatTime) * Math.exp(-beatTime * 55) : 0
  pcm.writeInt16LE(Math.round(sample * 32767), i * 2)
}
fs.writeFileSync(wavPath, Buffer.concat([waveHeader(sampleRate, sampleCount), pcm]))
assert.equal(fs.statSync(wavPath).size, 576044, 'same source dimensions as the prior native decoder crash')
const tooLongPath = path.join(profile, 'synthetic-too-long.wav')
fs.writeFileSync(tooLongPath, waveHeader(8000, 601 * 8000))
fs.truncateSync(tooLongPath, 44 + 601 * 8000 * 2)
const noAudioPath = path.join(profile, 'synthetic-no-audio.ppm')
fs.writeFileSync(noAudioPath, 'P3\n1 1\n255\n0 0 0\n')
const invalidPath = path.join(profile, 'synthetic-invalid.wav')
fs.writeFileSync(invalidPath, 'deliberately invalid synthetic media')
const config = { wavPath, tooLongPath, noAudioPath, invalidPath, missingPath: path.join(profile, 'missing.wav'),
  fileUrl: pathToFileURL(wavPath).href, projectPath: profile }

let window, finished = false, holdNext = false, held = null, nativeRequests = 0, nativeReplies = 0
const forbiddenRequests = [], services = []
const sender = event => assert.equal(event.sender, window?.webContents, 'fixture sender')
const finish = (code, result) => {
  if (finished) return
  finished = true
  held?.resolve()
  for (const service of services) service.cancelAll()
  console.log('AUDIO_ANALYSIS_RESULT ' + JSON.stringify({ ...result,
    runtime: { electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, arch: process.arch },
    nativeRequests, nativeReplies, forbiddenRequests, hidden: window ? !window.isVisible() : true,
    source: { sampleRate, channels: 1, duration: 12, bytes: 576044 }, profileIsTemporary: true }))
  app.exit(code)
}
const service = registerAudioAnalysisHandlers({ app, ffmpegPath, ffprobePath, ipcMain: {
  handle(channel, handler) {
    assert.equal(channel, 'media:analyzeAudio')
    ipcMain.handle(channel, async (event, request) => {
      sender(event)
      nativeRequests++
      const shouldHold = holdNext
      holdNext = false
      const result = await handler(event, request)
      nativeReplies++
      if (shouldHold) await new Promise(resolve => { held = { resolve } })
      return result
    })
  },
} })
services.push(service)
ipcMain.handle('audio-fixture:config', event => { sender(event); return config })
ipcMain.handle('audio-fixture:status', event => { sender(event); return { nativeRequests, nativeReplies, held: Boolean(held), hidden: !window.isVisible() } })
ipcMain.handle('audio-fixture:hold-next', event => { sender(event); assert.equal(held, null); holdNext = true; return true })
ipcMain.handle('audio-fixture:release', event => { sender(event); assert.ok(held); held.resolve(); held = null; return true })
// Preferences are read-only/RAM-only. No app filesystem or other IPC handlers.
ipcMain.handle('settings:get', () => null)
ipcMain.handle('settings:set', () => true)
// Waveform paint is unrelated to this regression. Supply synthetic peaks to
// the actual Timeline without registering its production decoder or filesystem.
ipcMain.handle('media:getAudioWaveform', (event, source) => {
  sender(event)
  assert.ok([wavPath, config.missingPath].includes(source), 'waveform remains synthetic-only')
  return { success: true, peaks: Array.from({ length: 96 }, (_, index) => index % 4 === 0 ? 0.8 : 0), duration: 12 }
})
ipcMain.handle('audio-fixture:native-checks', async event => {
  sender(event)
  const request = { source: { absolutePath: wavPath }, options: { includeLoudnessCurve: false } }
  const missingBinary = createAudioAnalysisService({ ffmpegPath: path.join(profile, 'missing-ffmpeg'), ffprobePath })
  services.push(missingBinary)
  const missingResult = await missingBinary.analyze(request)
  assert.equal(missingResult.success, false); assert.match(missingResult.error, /ffmpeg|unavailable|missing/i)

  const timeoutService = createAudioAnalysisService({ ffmpegPath, ffprobePath, jobTimeoutMs: 1 })
  services.push(timeoutService)
  const timedOut = await timeoutService.analyze(request)
  assert.equal(timedOut.success, false); assert.match(timedOut.error, /time|too long/i)
  timeoutService.cancelAll()

  let childStarted, observedChildren = 0
  const childReady = new Promise(resolve => { childStarted = resolve })
  // Observe the real worker's native child notifications without replacing any
  // behavior. Owner destruction must reap FFprobe/FFmpeg as well as the worker.
  class ObservedWorker extends Worker {
    constructor(...args) {
      super(...args)
      this.on('message', message => {
        if (message?.type === 'child-start' && ++observedChildren === 2) childStarted(message.pid)
      })
    }
  }
  const ownerService = createAudioAnalysisService({ ffmpegPath, ffprobePath, WorkerClass: ObservedWorker })
  services.push(ownerService)
  const owner = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  const canceled = ownerService.analyze({ source: { absolutePath: tooLongPath },
    options: { startSeconds: 0, endSeconds: 120, includeLoudnessCurve: false } }, owner.webContents)
  const busy = await ownerService.analyze(request, owner.webContents)
  assert.equal(busy.success, false); assert.match(busy.error, /running|busy|wait/i)
  const childPid = await childReady
  process.kill(childPid, 0) // It is still alive at the actual cancellation point.
  owner.destroy()
  const cancelResult = await canceled
  assert.equal(cancelResult.success, false); assert.match(cancelResult.error, /cancel|closed|destroy/i)
  assert.throws(() => process.kill(childPid, 0), /ESRCH/, 'owner destruction reaps the native child')
  const recovery = await ownerService.analyze(request)
  assert.equal(recovery.success, true, recovery.error)

  // Packaging-shaped gate: analysis CJS worker and dynamic DSP .mjs import must
  // resolve from app.asar, with binaries outside just as electron-builder ships.
  const stage = path.join(profile, 'asar-input')
  for (const relative of ['electron/audioAnalysisNative.cjs', 'electron/audioAnalysisWorker.cjs',
    'electron/audioAnalysisCore.cjs', 'src/utils/audioAnalysisDsp.mjs']) {
    const target = path.join(stage, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.resolve(__dirname, '../..', relative), target)
  }
  const archive = path.join(profile, 'app.asar')
  await require('@electron/asar').createPackage(stage, archive)
  const packaged = require(path.join(archive, 'electron/audioAnalysisNative.cjs')).createAudioAnalysisService({ ffmpegPath, ffprobePath })
  services.push(packaged)
  const packagedResult = await packaged.analyze(request)
  assert.equal(packagedResult.success, true, `asar-shaped native analysis: ${packagedResult.error}`)
  assert.ok(Math.abs(packagedResult.analysis.bpm - 120) < 1)
  packaged.cancelAll()
  return { missingBinary: missingResult.code || true, timeout: timedOut.code || true,
    ownerDestroyed: cancelResult.code || true, nativeChildReaped: true, busy: busy.code || true,
    recoveryBpm: recovery.analysis.bpm, asarBpm: packagedResult.analysis.bpm }
})
ipcMain.on('audio-fixture:result', (event, result) => {
  sender(event)
  if (forbiddenRequests.length) return finish(1, { ...result, success: false, error: 'Unexpected network request' })
  finish(result?.success ? 0 : 1, result)
})
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    preload: path.resolve(__dirname, '../../electron/preload.js'),
  } })
  window.webContents.session.setPreloads([path.join(__dirname, 'audio-analysis-preload.cjs')])
  window.webContents.session.setPermissionRequestHandler((_, __, callback) => callback(false))
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url)
    const allowed = url.origin === base.origin && details.method === 'GET'
      && /^\/(?:@vite\/|@react-refresh|@id\/|@fs\/|src\/|electron\/[^/]+\.mjs|node_modules\/|tests\/fixtures\/audio-analysis-native\.(?:html|jsx)|lang\/(?:languages|lang_en)\.json|favicon\.ico)/.test(url.pathname)
    if (!allowed) forbiddenRequests.push({ url: details.url, method: details.method, type: details.resourceType })
    callback({ cancel: !allowed })
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.on('show', () => finish(1, { success: false, error: 'Fixture became visible' }))
  window.webContents.on('render-process-gone', (_, details) => finish(1, { success: false, error: 'Renderer exited', details }))
  window.webContents.on('console-message', (_, level, message) => { if (level >= 2) console.error(message) })
  await window.loadURL(new URL('/tests/fixtures/audio-analysis-native.html', base).href)
}).catch(error => finish(1, { success: false, error: error.stack || error.message }))
setTimeout(() => finish(1, { success: false, error: 'Hidden native regression timed out' }), 105000)
app.on('window-all-closed', () => { if (!finished) finish(1, { success: false, error: 'Fixture window closed unexpectedly' }) })
