// Native audio analysis accepts local media only. All decode and DSP work runs
// in a disposable worker; only the small analysis summary crosses IPC.
const path = require('path')
const fs = require('fs/promises')
const { fileURLToPath } = require('url')
const { spawn } = require('child_process')

const AUDIO_ANALYSIS_LIMITS = Object.freeze({
  sampleRate: 24000,
  maxSeconds: 600,
  maxChannels: 2,
  probeTimeoutMs: 15000,
  decodeTimeoutMs: 90000,
  jobTimeoutMs: 150000,
  maxProbeBytes: 64 * 1024,
  maxStderrBytes: 8192,
})

function analysisError(code, message) {
  return Object.assign(new Error(message), { code })
}

function resolveAudioAnalysisSource(source, { platform = process.platform } = {}) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw analysisError('AUDIO_ANALYSIS_INVALID_SOURCE', 'Choose a local audio or video file to analyze.')
  }
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  let input = [source.absolutePath, source.path, source.url].find((value) => typeof value === 'string' && value.trim())
  if (!input || input.includes('\0') || input.length > 32768) {
    throw analysisError('AUDIO_ANALYSIS_INVALID_SOURCE', 'No readable local file was provided for audio analysis.')
  }
  try {
    if (/^comfystudio:\/\//i.test(input)) {
      input = decodeURIComponent(input.slice('comfystudio://'.length))
    } else if (/^file:/i.test(input)) {
      const url = new URL(input)
      if (platform !== 'win32' && url.hostname && url.hostname !== 'localhost') throw new Error('Unsupported file host')
      // fileURLToPath follows the host OS; parse Windows drive/UNC URLs
      // explicitly for portable contract tests. UNC remains a filesystem
      // source on Windows, matching the existing file-read behavior.
      input = platform === 'win32'
        ? (url.hostname && url.hostname !== 'localhost'
            ? `\\\\${url.hostname}${decodeURIComponent(url.pathname).replace(/\//g, '\\')}`
            : decodeURIComponent(url.pathname).replace(/^\/([a-z]:\/)/i, '$1').replace(/\//g, '\\'))
        : fileURLToPath(url)
    }
  } catch {
    throw analysisError('AUDIO_ANALYSIS_INVALID_SOURCE', 'The local media URL is invalid.')
  }
  const isWindowsDrive = platform === 'win32' && /^[a-z]:[\\/]/i.test(input)
  const isWindowsUnc = (value) => platform === 'win32' && /^[\\/]{2}[^\\/?\.][^\\/]*[\\/][^\\/]+(?:[\\/]|$)/.test(value)
  if ((!isWindowsDrive && /^[a-z][a-z0-9+.-]*:/i.test(input)) || (/^[\\/]{2}/.test(input) && !isWindowsUnc(input)) || input.includes('\0')) {
    throw analysisError('AUDIO_ANALYSIS_INVALID_SOURCE', 'Audio analysis supports local files only; remote URLs are not supported.')
  }
  if (pathApi.isAbsolute(input)) {
    if (platform === 'win32' && !isWindowsDrive && !isWindowsUnc(input)) {
      throw analysisError('AUDIO_ANALYSIS_INVALID_SOURCE', 'Audio analysis needs a fully qualified local file path.')
    }
    return pathApi.normalize(input)
  }
  const projectPath = source.projectPath
  if (typeof projectPath !== 'string' || !pathApi.isAbsolute(projectPath) || projectPath.includes('\0') ||
      (platform === 'win32' ? !/^[a-z]:[\\/]/i.test(projectPath) && !isWindowsUnc(projectPath) : /^[\\/]{2}/.test(projectPath))) {
    throw analysisError('AUDIO_ANALYSIS_INVALID_SOURCE', 'Project-relative audio needs an absolute project folder path.')
  }
  // Project-owned paths are portable, including projects last saved on
  // Windows. Preserve literal absolute filenames; normalize relative paths.
  return pathApi.resolve(projectPath, input.replace(/\\/g, '/'))
}

function normalizeAudioAnalysisOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw analysisError('AUDIO_ANALYSIS_INVALID_OPTIONS', 'Invalid audio analysis options.')
  }
  const finiteOption = (name, fallback, min, max) => {
    const value = options[name] === undefined ? fallback : options[name]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw analysisError('AUDIO_ANALYSIS_INVALID_OPTIONS', `Invalid audio analysis ${name}.`)
    }
    return value
  }
  const startSeconds = finiteOption('startSeconds', 0, 0, Number.MAX_SAFE_INTEGER)
  const endSeconds = options.endSeconds === undefined ? undefined : finiteOption('endSeconds', undefined, 0, Number.MAX_SAFE_INTEGER)
  if (endSeconds !== undefined && endSeconds <= startSeconds) {
    throw analysisError('AUDIO_ANALYSIS_INVALID_OPTIONS', 'The audio analysis range must end after it starts.')
  }
  if (endSeconds !== undefined && endSeconds - startSeconds > AUDIO_ANALYSIS_LIMITS.maxSeconds) {
    throw analysisError('AUDIO_ANALYSIS_TOO_LONG', 'Audio analysis is limited to 10 minutes. Select a shorter range and try again.')
  }
  if (options.includeLoudnessCurve !== undefined && typeof options.includeLoudnessCurve !== 'boolean') {
    throw analysisError('AUDIO_ANALYSIS_INVALID_OPTIONS', 'Audio analysis includeLoudnessCurve must be a boolean.')
  }
  return {
    startSeconds,
    endSeconds,
    includeLoudnessCurve: options.includeLoudnessCurve !== false,
    maxCurvePoints: Math.round(finiteOption('maxCurvePoints', 400, 20, 1000)),
    silenceThresholdDb: finiteOption('silenceThresholdDb', -45, -160, 0),
    minSilenceSeconds: finiteOption('minSilenceSeconds', 0.35, 0, 600),
  }
}

function resolveAudioAnalysisSources(source, { platform = process.platform } = {}) {
  // A moved portable project can retain an obsolete absolutePath. Prefer its
  // current project-owned path, then try the legacy local fallbacks.
  const candidates = []
  let lastError
  for (const value of [source?.path, source?.absolutePath, source?.url]) {
    if (typeof value !== 'string' || !value.trim()) continue
    try {
      const resolved = resolveAudioAnalysisSource({ path: value, projectPath: source.projectPath }, { platform })
      if (!candidates.includes(resolved)) candidates.push(resolved)
    } catch (error) { lastError = error }
  }
  if (!candidates.length) throw lastError || analysisError('AUDIO_ANALYSIS_INVALID_SOURCE', 'No readable local file was provided for audio analysis.')
  return candidates
}

function createAnalysisProcessState(onProcess = () => {}) {
  return {
    cancelled: false,
    activeProcess: null,
    onProcess,
    cancel() {
      this.cancelled = true
      try { this.activeProcess?.kill('SIGKILL') } catch { /* Already exited. */ }
    },
  }
}

function assertNotCancelled(state) {
  if (state.cancelled) throw analysisError('AUDIO_ANALYSIS_CANCELLED', 'Audio analysis was cancelled.')
}

function runBoundedProcess(binary, args, { state, timeoutMs, maxBytes, onData, spawnProcess = spawn }) {
  assertNotCancelled(state)
  return new Promise((resolve, reject) => {
    let child
    let timer
    let stderr = Buffer.alloc(0)
    let bytes = 0
    let failure = null
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (state.activeProcess === child) state.activeProcess = null
      if (child?.pid) state.onProcess('end', child.pid)
      error ? reject(error) : resolve()
    }
    const abort = (error) => {
      failure ||= error
      try { child.kill('SIGKILL') } catch { /* Close/error completes cleanup. */ }
    }
    try {
      child = spawnProcess(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
      state.activeProcess = child
      if (child.pid) state.onProcess('start', child.pid)
    } catch (error) {
      finish(analysisError('AUDIO_ANALYSIS_NATIVE_UNAVAILABLE', `Could not start audio analysis: ${error.message}`))
      return
    }
    timer = setTimeout(() => abort(analysisError('AUDIO_ANALYSIS_TIMEOUT', 'Audio analysis timed out. Try a shorter range.')), timeoutMs)
    child.stdout.on('data', (chunk) => {
      if (failure || state.cancelled) return
      bytes += chunk.length
      if (bytes > maxBytes) {
        abort(analysisError('AUDIO_ANALYSIS_OUTPUT_LIMIT', 'Audio analysis exceeded its safe output limit. Try a shorter range.'))
        return
      }
      try { onData(chunk) } catch (error) { abort(error) }
    })
    child.stderr.on('data', (chunk) => {
      // Keep only a bounded tail, even for corrupt/noisy inputs.
      stderr = Buffer.concat([stderr, chunk.subarray(-AUDIO_ANALYSIS_LIMITS.maxStderrBytes)]).subarray(-AUDIO_ANALYSIS_LIMITS.maxStderrBytes)
    })
    child.on('error', (error) => finish(analysisError('AUDIO_ANALYSIS_NATIVE_UNAVAILABLE', `Could not start audio analysis: ${error.message}`)))
    child.on('close', (code) => {
      if (state.cancelled) return finish(analysisError('AUDIO_ANALYSIS_CANCELLED', 'Audio analysis was cancelled.'))
      if (failure) return finish(failure)
      if (code !== 0) return finish(analysisError('AUDIO_ANALYSIS_DECODE_FAILED', `Could not decode this audio source. ${stderr.toString().trim() || `Native decoder exited with code ${code}.`}`))
      finish()
    })
  })
}

function buildAudioProbeArgs(inputPath) {
  return ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-select_streams', 'a:0',
    '-show_entries', 'stream=channels,duration:format=duration', '-of', 'json', '-i', inputPath]
}

function buildAudioDecodeArgs(inputPath, { startSeconds, durationSeconds, channels }) {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1', '-protocol_whitelist', 'file,pipe']
  if (startSeconds > 0) args.push('-ss', String(startSeconds))
  args.push('-i', inputPath, '-map', '0:a:0', '-vn', '-sn', '-dn', '-t', String(durationSeconds),
    '-filter_threads', '1', '-af', channels === 1 ? 'pan=mono|c0=c0' : 'pan=stereo|c0=c0|c1=c1',
    '-ac', String(channels), '-ar', String(AUDIO_ANALYSIS_LIMITS.sampleRate), '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1')
  return args
}

async function decodeAnalysisAudio({ inputPath, inputPaths = [inputPath], options, ffmpegPath, ffprobePath, state, spawnProcess }) {
  assertNotCancelled(state)
  for (const [label, binary] of [['FFmpeg', ffmpegPath], ['FFprobe', ffprobePath]]) {
    if (!binary || typeof binary !== 'string') throw analysisError('AUDIO_ANALYSIS_NATIVE_UNAVAILABLE', `${label} is unavailable. Reinstall Drama Studio to restore audio analysis.`)
    try { await fs.access(binary) } catch { throw analysisError('AUDIO_ANALYSIS_NATIVE_UNAVAILABLE', `${label} is missing. Reinstall Drama Studio to restore audio analysis.`) }
  }
  let resolvedPath
  for (const candidate of inputPaths) {
    try { if ((await fs.stat(candidate)).isFile()) { resolvedPath = candidate; break } } catch { /* Try portable/legacy local fallbacks. */ }
  }
  if (!resolvedPath) throw analysisError('AUDIO_ANALYSIS_SOURCE_MISSING', 'The audio source is missing or cannot be read. Relink the file and try again.')
  inputPath = resolvedPath
  const chunks = []
  await runBoundedProcess(ffprobePath, buildAudioProbeArgs(inputPath), {
    state, timeoutMs: AUDIO_ANALYSIS_LIMITS.probeTimeoutMs, maxBytes: AUDIO_ANALYSIS_LIMITS.maxProbeBytes,
    onData: (chunk) => chunks.push(chunk), spawnProcess,
  })
  let metadata
  try { metadata = JSON.parse(Buffer.concat(chunks).toString()) } catch { throw analysisError('AUDIO_ANALYSIS_DECODE_FAILED', 'Could not read audio metadata from this source.') }
  const stream = metadata.streams?.[0]
  if (!stream || !Number.isInteger(Number(stream.channels)) || Number(stream.channels) < 1) {
    throw analysisError('AUDIO_ANALYSIS_NO_AUDIO', 'This source does not contain a readable audio track.')
  }
  const channels = Math.min(AUDIO_ANALYSIS_LIMITS.maxChannels, Number(stream.channels))
  const durations = [stream.duration, metadata.format?.duration].map(Number)
  const sourceDuration = durations.find((value) => Number.isFinite(value) && value > 0)
  const endSeconds = options.endSeconds === undefined ? sourceDuration : Math.min(options.endSeconds, sourceDuration ?? Infinity)
  const selectedDuration = endSeconds === undefined ? undefined : Math.max(0, endSeconds - options.startSeconds)
  if (selectedDuration !== undefined && selectedDuration > AUDIO_ANALYSIS_LIMITS.maxSeconds) {
    throw analysisError('AUDIO_ANALYSIS_TOO_LONG', 'Audio analysis is limited to 10 minutes. Select a shorter range and try again.')
  }
  if (selectedDuration !== undefined && selectedDuration < 0.25) {
    throw analysisError('AUDIO_ANALYSIS_TOO_SHORT', 'Audio range is too short to analyze (under 0.25s).')
  }
  const sampleRate = AUDIO_ANALYSIS_LIMITS.sampleRate
  // If duration is unknown, one extra sample detects over-limit inputs rather
  // than silently reporting a truncated 10-minute analysis as complete.
  const decodeDuration = selectedDuration ?? (AUDIO_ANALYSIS_LIMITS.maxSeconds + 1 / sampleRate)
  const frameLimit = Math.ceil((selectedDuration ?? AUDIO_ANALYSIS_LIMITS.maxSeconds) * sampleRate)
  const planes = Array.from({ length: channels }, () => new Float32Array(frameLimit))
  const frameBytes = channels * 4
  let frames = 0
  let remainder = Buffer.alloc(0)
  await runBoundedProcess(ffmpegPath, buildAudioDecodeArgs(inputPath, {
    startSeconds: options.startSeconds, durationSeconds: decodeDuration, channels,
  }), {
    state, timeoutMs: AUDIO_ANALYSIS_LIMITS.decodeTimeoutMs,
    maxBytes: (frameLimit + 1) * frameBytes,
    spawnProcess,
    onData: (chunk) => {
      // Deinterleave as bytes arrive: no whole-source Buffer, PCM concatenation,
      // or duplicate decoded audio is ever allocated in the renderer or main.
      const data = remainder.length ? Buffer.concat([remainder, chunk]) : chunk
      const completeBytes = data.length - (data.length % frameBytes)
      for (let offset = 0; offset < completeBytes; offset += frameBytes) {
        if (frames >= frameLimit) throw analysisError('AUDIO_ANALYSIS_TOO_LONG', 'Audio exceeds the analysis range limit. Select a shorter range and try again.')
        for (let channel = 0; channel < channels; channel += 1) planes[channel][frames] = data.readFloatLE(offset + channel * 4)
        frames += 1
      }
      remainder = Buffer.from(data.subarray(completeBytes))
    },
  })
  assertNotCancelled(state)
  if (remainder.length) throw analysisError('AUDIO_ANALYSIS_DECODE_FAILED', 'Audio decoding returned incomplete samples.')
  if (frames < sampleRate * 0.25) throw analysisError('AUDIO_ANALYSIS_TOO_SHORT', 'Audio range is too short to analyze (under 0.25s).')
  return {
    sampleRate,
    length: frames,
    numberOfChannels: Number(stream.channels),
    getChannelData: (index) => planes[index].subarray(0, frames),
  }
}

module.exports = {
  AUDIO_ANALYSIS_LIMITS, analysisError, resolveAudioAnalysisSource, resolveAudioAnalysisSources, normalizeAudioAnalysisOptions,
  createAnalysisProcessState, runBoundedProcess, buildAudioProbeArgs, buildAudioDecodeArgs, decodeAnalysisAudio,
}
