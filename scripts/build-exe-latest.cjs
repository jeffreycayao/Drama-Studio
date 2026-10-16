#!/usr/bin/env node
'use strict'

/**
 * Local Windows test build: `npm run exe:latest`.
 *
 * 1. `npm run build` (bumps the patch version, see bump-version.cjs).
 * 2. Packages ONE unsigned portable exe into release/.
 * 3. Deletes every older build in release/ (old exes, blockmaps, win-unpacked).
 * 4. Launches the new exe.
 *
 * This is not a release: no Azure signing, nothing is published, and the RIFE
 * smooth-motion runtime is only included when it is staged in
 * build/rife-runtime (CI builds it; without it the app reports the engine as
 * missing and everything else works). Releases go through GitHub Actions, see
 * docs/AI_RELEASE_HANDOFF.md.
 *
 * Flags: --skip-build (package the current dist/), --no-launch,
 * --replace-running (close a running Drama Studio build before launching;
 * otherwise the new exe is built but not launched, so unsaved work in the
 * open copy is not lost).
 */

const fs = require('fs')
const path = require('path')
const { spawn, spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const RELEASE_DIR = path.join(ROOT, 'release')
const args = new Set(process.argv.slice(2))

function fail(message) {
  console.error(`[exe:latest] ${message}`)
  process.exit(1)
}

function readPackage() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
}

// Drama Studio builds started from release/ (the portable exe and the copy it
// unpacks to %TEMP%). Dev runs (node_modules/electron) are not matched.
function findRunningBuilds() {
  const script = [
    "$release = [IO.Path]::GetFullPath($env:DS_RELEASE_DIR).TrimEnd('\\') + '\\'",
    'Get-CimInstance Win32_Process | Where-Object {',
    "  $_.ExecutablePath -and ($_.ExecutablePath.StartsWith($release, [StringComparison]::OrdinalIgnoreCase) -or $_.Name -eq 'Drama Studio.exe')",
    '} | ForEach-Object { "$($_.ProcessId)|$($_.ExecutablePath)" }',
  ].join('\n')
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    env: { ...process.env, DS_RELEASE_DIR: RELEASE_DIR },
  })
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pid, exePath] = line.split('|')
      return { pid: Number(pid), exePath }
    })
    .filter((entry) => Number.isInteger(entry.pid) && entry.pid > 0)
}

/** Close running builds when --replace-running is given. Returns false when
 * an older build is still open (so the new one is built but not launched). */
function stopRunningBuilds() {
  const running = findRunningBuilds()
  if (!running.length) return true
  if (!args.has('--replace-running')) {
    console.log(`[exe:latest] Drama Studio is still running (${running.length} process${running.length === 1 ? '' : 'es'}); it is left open so no unsaved work is lost. Close it and start the new exe, or rerun with --replace-running.`)
    return false
  }
  for (const { pid, exePath } of running) {
    console.log(`[exe:latest] Closing ${exePath} (pid ${pid})`)
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  }
  return true
}

function runNpmBuild() {
  console.log('[exe:latest] npm run build')
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(npm, ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) fail('npm run build failed.')
}

function localBuilderConfig(pkg) {
  const config = JSON.parse(JSON.stringify(pkg.build || {}))
  config.win = { ...(config.win || {}), target: [{ target: 'portable', arch: ['x64'] }] }
  delete config.win.azureSignOptions
  const rifeStaged = fs.existsSync(path.join(ROOT, 'build', 'rife-runtime', 'win-x64', 'rife'))
  if (!rifeStaged) {
    // The runtime gates require the CI-built RIFE runtime; skip them and RIFE
    // but still organize licenses and run the content gate.
    delete config.beforePack
    config.afterPack = 'scripts/electron-builder-after-pack-local.cjs'
    config.extraResources = (config.extraResources || []).filter((entry) => !String(entry?.from || entry).includes('rife-runtime'))
    console.log('[exe:latest] RIFE runtime not staged: building without smooth-motion.')
  }
  return config
}

async function packagePortable(pkg) {
  const builder = require('electron-builder')
  // A config object is merged over package.json "build" (so deleted hooks and
  // signing would come back); a config file replaces it.
  const configDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ds-exe-latest-'))
  const configPath = path.join(configDir, 'electron-builder.local.json')
  fs.writeFileSync(configPath, JSON.stringify(localBuilderConfig(pkg), null, 2))
  let artifacts
  try {
    artifacts = await builder.build({
      projectDir: ROOT,
      targets: builder.Platform.WINDOWS.createTarget(['portable'], builder.Arch.x64),
      config: configPath,
      publish: 'never',
    })
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true })
  }
  const exe = artifacts.map((file) => path.resolve(file)).find((file) => /\.exe$/i.test(file))
  if (!exe || !fs.existsSync(exe)) fail('electron-builder did not produce a portable exe.')
  return exe
}

// Build output electron-builder leaves in release/. Anything else there (for
// example the "Drama Studio SFX" library next to the portable exe) is kept.
const BUILD_ARTIFACT = /^(Drama-Studio-.+\.(exe|blockmap|zip|7z|dmg|AppImage|deb)|[^/\\]+-unpacked|builder-debug\.yml|builder-effective-config\.yaml|latest[^/\\]*\.yml)$/i

// Keep only the new exe: remove older exes, blockmaps, update yml files and
// the unpacked folder (it holds another Drama Studio.exe).
function removeOldBuilds(keepExe) {
  if (!fs.existsSync(RELEASE_DIR)) return
  for (const name of fs.readdirSync(RELEASE_DIR)) {
    const full = path.join(RELEASE_DIR, name)
    if (path.resolve(full).toLowerCase() === keepExe.toLowerCase()) continue
    if (!BUILD_ARTIFACT.test(name)) continue
    try {
      fs.rmSync(full, { recursive: true, force: true })
      console.log(`[exe:latest] Deleted release/${name}`)
    } catch (error) {
      // A running copy locks its exe; it goes on the next run once closed.
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error?.code)) throw error
      console.log(`[exe:latest] Kept release/${name}: it is in use (close it and run again to remove it).`)
    }
  }
}

async function main() {
  if (process.platform !== 'win32') fail('exe:latest builds the Windows exe; run it on Windows.')
  if (!args.has('--skip-build')) runNpmBuild()
  const pkg = readPackage()
  const exe = await packagePortable(pkg)
  // Same lean-installer gate as releases (the afterPack hook is skipped here
  // when the RIFE runtime is not staged).
  require('./package-content-gate.cjs').assertPackageContents(path.join(RELEASE_DIR, 'win-unpacked', 'resources'))
  removeOldBuilds(exe)
  const sizeMb = (fs.statSync(exe).size / 1024 / 1024).toFixed(0)
  console.log(`[exe:latest] Drama Studio ${pkg.version}: ${exe} (${sizeMb} MB)`)
  if (args.has('--no-launch')) return
  if (!stopRunningBuilds()) return
  const child = spawn(exe, [], { detached: true, stdio: 'ignore', cwd: path.dirname(exe) })
  child.unref()
  console.log(`[exe:latest] Launched (pid ${child.pid}).`)
}

main().catch((error) => fail(error?.stack || error?.message || String(error)))
