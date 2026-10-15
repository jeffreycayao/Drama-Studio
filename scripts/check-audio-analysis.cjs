// Synthetic-only native regression. Never launches electron/main.js, opens a
// project, plays media, or contacts providers. The Electron host owns a fresh
// temporary profile and remains hidden and sandboxed throughout the check.
// VELORN_TEST_URL=http://127.0.0.1:5317 VELORN_TEST_ELECTRON_BINARY=... \
// VELORN_TEST_FFMPEG=... VELORN_TEST_FFPROBE=... node scripts/check-audio-analysis.cjs
// Add --serve to own an isolated loopback Vite server as well.
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { stripVTControlCharacters } = require('node:util')

const root = path.resolve(__dirname, '..')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const ready = url => new Promise(resolve => {
  const request = http.get(url, response => { response.resume(); resolve(response.statusCode === 200) })
  request.on('error', () => resolve(false))
  request.setTimeout(500, () => request.destroy())
})
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  for (let i = 0; i < 30 && child.exitCode === null && child.signalCode === null; i++) await delay(100)
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  for (let i = 0; i < 20 && child.exitCode === null && child.signalCode === null; i++) await delay(100)
}
async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--serve')) throw new Error('Usage: node scripts/check-audio-analysis.cjs [--serve]')
  const base = new URL(process.env.VELORN_TEST_URL || 'http://127.0.0.1:5317')
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password) {
    throw new Error('Use a separately started loopback Vite server')
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-audio-analysis-'))
  const env = { ...process.env, VELORN_TEST_URL: base.origin, VELORN_TEST_AUDIO_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  let server, fixture
  const interrupt = () => { fixture?.kill(); server?.kill(); process.exitCode = 130 }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try {
    if (process.argv.includes('--serve')) {
      const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js')
      server = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', base.port || '80', '--strictPort', '--clearScreen', 'false'],
        { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      let output = '', launchError
      server.once('error', error => { launchError = error })
      server.stdout.on('data', data => { output = (output + data).slice(-8000); process.stdout.write(data) })
      server.stderr.on('data', data => process.stderr.write(data))
      const deadline = Date.now() + 30000
      while (!(stripVTControlCharacters(output).includes(base.origin) && await ready(new URL('/tests/fixtures/audio-analysis-native.html', base)))) {
        if (launchError) throw launchError
        if (server.exitCode !== null || server.signalCode !== null) throw new Error('Isolated Vite server exited before readiness')
        if (Date.now() > deadline) throw new Error('Isolated Vite readiness timed out')
        await delay(100)
      }
    }
    const executable = process.env.VELORN_TEST_ELECTRON_BINARY || require('electron')
    fixture = spawn(executable, [path.join(root, 'tests/fixtures/audio-analysis-electron.cjs')],
      { cwd: root, env, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true })
    let output = ''
    fixture.stdout.on('data', data => { output = (output + data).slice(-96000); process.stdout.write(data) })
    const code = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { fixture.kill(); reject(new Error('Isolated audio-analysis process timed out')) }, 120000)
      fixture.once('error', error => { clearTimeout(timeout); reject(error) })
      fixture.once('close', (code, signal) => { clearTimeout(timeout); resolve(signal || code) })
    })
    if (code !== 0) throw new Error(`Isolated audio-analysis check failed (${code})`)
    const line = output.split(/\r?\n/).find(line => line.startsWith('AUDIO_ANALYSIS_RESULT '))
    if (!line || JSON.parse(line.slice('AUDIO_ANALYSIS_RESULT '.length)).success !== true) {
      throw new Error('Electron exited without a successful fixture result; use an unpacked Electron executable')
    }
  } finally {
    await stop(fixture)
    await stop(server)
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
    // Only this exact mkdtemp-owned synthetic profile is eligible for cleanup.
    if (path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('velorn-audio-analysis-')) {
      fs.rmSync(profile, { recursive: true, force: true })
    }
  }
}
main().catch(error => { console.error(error.stack || error); process.exitCode ||= 1 })
