'use strict'

/**
 * FFmpeg helpers for timeline lip-sync (sync.so). The renderer plans which
 * source seconds a clip uses (src/utils/lipSyncPlan.mjs); these handlers cut
 * exactly that video range and build a dialogue track of the same length, so
 * the cloud job is billed only for the seconds the edit needs and the result
 * lines up frame for frame with the original source range.
 *
 * Outputs go to a temp folder; nothing in the project is modified here.
 */

const MAX_SEGMENT_SECONDS = 600 // sync.so rejects inputs longer than 10 minutes.

const seconds = (value) => {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : 0
}
const fmt = (value) => Math.max(0, Number(value) || 0).toFixed(6)

function sanitizeBaseName(value, fallback) {
  const cleaned = String(value || '')
    .replace(/\.[a-zA-Z0-9]{1,8}$/, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || fallback
}

/** Video-only H.264 cut of [startSeconds, startSeconds + durationSeconds]. */
function buildVideoSegmentArgs({ inputPath, outputPath, startSeconds, durationSeconds }) {
  return [
    '-y', '-v', 'error',
    '-ss', fmt(startSeconds),
    '-i', inputPath,
    '-t', fmt(durationSeconds),
    '-map', '0:v:0',
    '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputPath,
  ]
}

/**
 * Dialogue WAV of exactly totalSeconds: optional leading silence, then
 * durationSeconds of the source from startSeconds, then silence to the end.
 */
function buildPaddedAudioArgs({ inputPath, outputPath, startSeconds, durationSeconds, leadingSilenceSeconds = 0, totalSeconds }) {
  const delayMs = Math.round(Math.max(0, Number(leadingSilenceSeconds) || 0) * 1000)
  const filters = []
  if (delayMs > 0) filters.push(`adelay=delays=${delayMs}:all=1`)
  filters.push(`apad=whole_dur=${fmt(totalSeconds)}`)
  return [
    '-y', '-v', 'error',
    '-ss', fmt(startSeconds),
    '-t', fmt(durationSeconds),
    '-i', inputPath,
    '-vn',
    '-af', filters.join(','),
    '-t', fmt(totalSeconds),
    '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le',
    outputPath,
  ]
}

function validateSegmentRequest(options = {}, { requireTotal = false } = {}) {
  const start = Math.max(0, Number(options.startSeconds) || 0)
  const duration = seconds(options.durationSeconds)
  if (duration <= 0.001) return { ok: false, error: 'Segment duration is zero.' }
  if (duration > MAX_SEGMENT_SECONDS) return { ok: false, error: 'Segments longer than 10 minutes are not supported.' }
  if (!requireTotal) return { ok: true, start, duration }
  const total = seconds(options.totalSeconds)
  const lead = Math.max(0, Number(options.leadingSilenceSeconds) || 0)
  if (total <= 0.001 || total > MAX_SEGMENT_SECONDS) return { ok: false, error: 'Invalid dialogue length.' }
  if (lead + duration > total + 0.05) return { ok: false, error: 'Dialogue does not fit inside the video segment.' }
  return { ok: true, start, duration, total, lead }
}

function runFfmpeg({ spawn, ffmpegPath, args, timeoutMs }) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; proc.kill('SIGKILL') }, timeoutMs)
    proc.stderr.on('data', (data) => { stderr += data.toString() })
    proc.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, error: err.message }) })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) resolve({ ok: false, error: `FFmpeg timed out after ${Math.round(timeoutMs / 1000)}s` })
      else if (code === 0) resolve({ ok: true })
      else resolve({ ok: false, error: stderr.trim() || `FFmpeg exited with code ${code}` })
    })
  })
}

function registerLipSyncMediaIpc(ipcMain, { getFfmpegPath, spawn, fs, path, tempRoot, resolveMediaInputPath }) {
  const prepare = async (options, fallbackName, ext) => {
    const ffmpegPath = getFfmpegPath()
    if (!ffmpegPath) return { error: 'FFmpeg binary not available.' }
    const inputPath = resolveMediaInputPath(String(options?.inputPath || ''))
    if (!inputPath) return { error: 'Missing media input path.' }
    try { await fs.stat(inputPath) } catch (err) { return { error: `Media file not found: ${err.message}` } }
    const dir = path.join(tempRoot(), 'drama-lipsync')
    await fs.mkdir(dir, { recursive: true })
    const base = sanitizeBaseName(options?.outputName, fallbackName)
    return { ffmpegPath, inputPath, outputPath: path.join(dir, `${base}_${Date.now()}.${ext}`) }
  }
  const timeoutOf = (options) => Math.max(30000, Math.min(600000, Math.round(Number(options?.timeoutMs) || 300000)))

  ipcMain.handle('media:trimVideoSegment', async (event, options = {}) => {
    const check = validateSegmentRequest(options)
    if (!check.ok) return { success: false, error: check.error }
    const ctx = await prepare(options, 'lipsync_video', 'mp4').catch((err) => ({ error: err.message }))
    if (ctx.error) return { success: false, error: ctx.error }
    const result = await runFfmpeg({ spawn, ffmpegPath: ctx.ffmpegPath, timeoutMs: timeoutOf(options),
      args: buildVideoSegmentArgs({ inputPath: ctx.inputPath, outputPath: ctx.outputPath, startSeconds: check.start, durationSeconds: check.duration }) })
    if (!result.ok) {
      try { await fs.unlink(ctx.outputPath) } catch (_) { /* ignore */ }
      return { success: false, error: result.error }
    }
    return { success: true, outputPath: ctx.outputPath, duration: check.duration }
  })

  ipcMain.handle('media:padAudioSegment', async (event, options = {}) => {
    const check = validateSegmentRequest(options, { requireTotal: true })
    if (!check.ok) return { success: false, error: check.error }
    const ctx = await prepare(options, 'lipsync_dialogue', 'wav').catch((err) => ({ error: err.message }))
    if (ctx.error) return { success: false, error: ctx.error }
    const result = await runFfmpeg({ spawn, ffmpegPath: ctx.ffmpegPath, timeoutMs: timeoutOf(options),
      args: buildPaddedAudioArgs({ inputPath: ctx.inputPath, outputPath: ctx.outputPath, startSeconds: check.start,
        durationSeconds: check.duration, leadingSilenceSeconds: check.lead, totalSeconds: check.total }) })
    if (!result.ok) {
      try { await fs.unlink(ctx.outputPath) } catch (_) { /* ignore */ }
      return { success: false, error: result.error }
    }
    return { success: true, outputPath: ctx.outputPath, duration: check.total }
  })
}

module.exports = {
  MAX_SEGMENT_SECONDS,
  buildVideoSegmentArgs,
  buildPaddedAudioArgs,
  validateSegmentRequest,
  registerLipSyncMediaIpc,
}
