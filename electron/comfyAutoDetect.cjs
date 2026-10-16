'use strict'

/**
 * Find ComfyUI on this computer, wherever the user installed it. Used by the
 * first-launch ComfyUI setup screen (Drama Studio needs ComfyUI).
 *
 * Looks in, in order:
 *   1. ComfyUI servers already running on the usual local ports (their
 *      /system_stats argv names main.py, which gives the folder).
 *   2. Comfy Desktop's installation list (<appData>/Comfy Desktop/installations.json).
 *   3. The legacy ComfyUI desktop app's base path (<appData>/ComfyUI/config.json).
 *   4. A bounded folder scan: home, Desktop, Documents, Downloads and every
 *      drive root, a few levels deep, skipping system folders. Folder names
 *      don't matter; a folder counts when it holds main.py, nodes.py and comfy/.
 *
 * Main process only. Returns folder paths, never file contents.
 */

const fs = require('fs/promises')
const http = require('http')
const os = require('os')
const path = require('path')

const DEFAULT_PORTS = Object.freeze([8188, 8000, 8189, 8190])
const COMFY_DESKTOP_DIR_NAME = 'Comfy Desktop'
const MAX_CONFIG_BYTES = 1024 * 1024
const DEFAULT_SCAN_DEPTH = 3
const DEFAULT_SCAN_BUDGET_MS = 6000
const DEFAULT_MAX_DIRS = 6000

// Never worth descending into (system, caches, package trees, VCS).
const SKIP_DIR = /^(\$recycle\.bin|system volume information|windows|winsxs|programdata|recovery|perflogs|msocache|config\.msi|appdata|node_modules|\.git|\.svn|\.hg|\.cache|\.venv|venv|site-packages|__pycache__|python_embeded|python_embedded|standalone-env|models|custom_nodes|output|input|temp|tmp|library|proc|sys|dev|snap|usr|bin|sbin|etc|var|boot)$/i

async function isFile(target) {
  try { return (await fs.stat(target)).isFile() } catch { return false }
}

async function isDirectory(target) {
  try { return (await fs.stat(target)).isDirectory() } catch { return false }
}

/** A ComfyUI source folder: main.py + nodes.py + comfy/. */
async function isComfySourceRoot(dir) {
  if (!dir) return false
  const [main, nodes, comfy] = await Promise.all([
    isFile(path.join(dir, 'main.py')),
    isFile(path.join(dir, 'nodes.py')),
    isDirectory(path.join(dir, 'comfy')),
  ])
  return main && nodes && comfy
}

/** The ComfyUI folder at `dir` or directly inside it (portable layout). */
async function resolveComfyRootAt(dir) {
  if (!dir) return ''
  if (await isComfySourceRoot(dir)) return path.resolve(dir)
  const nested = path.join(dir, 'ComfyUI')
  if (await isComfySourceRoot(nested)) return path.resolve(nested)
  return ''
}

async function readSmallJson(file) {
  const stat = await fs.stat(file)
  if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) throw new Error('not a small file')
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

/** Probe http://127.0.0.1:<port>/system_stats; resolves null when nothing answers. */
function probeComfyServer(port, { timeoutMs = 900, host = '127.0.0.1' } = {}) {
  return new Promise((resolve) => {
    let settled = false
    const done = (value) => { if (!settled) { settled = true; resolve(value) } }
    const req = http.get({ host, port, path: '/system_stats', timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) { res.resume(); done(null); return }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
        if (body.length > 256 * 1024) { req.destroy(); done(null) }
      })
      res.on('end', () => {
        try {
          const stats = JSON.parse(body)
          // ComfyUI answers with { system: { os, comfyui_version, argv, ... }, devices: [...] }.
          if (!stats || typeof stats.system !== 'object') { done(null); return }
          const argv = Array.isArray(stats.system.argv) ? stats.system.argv.map(String) : []
          const mainPy = argv.find((arg) => /(^|[\\/])main\.py$/i.test(arg)) || ''
          done({
            port,
            httpBase: `http://${host}:${port}`,
            version: String(stats.system.comfyui_version || ''),
            rootFromArgv: mainPy && path.isAbsolute(mainPy) ? path.dirname(mainPy) : '',
          })
        } catch { done(null) }
      })
    })
    req.on('timeout', () => { req.destroy(); done(null) })
    req.on('error', () => done(null))
  })
}

async function comfyDesktopRoots(appDataDir) {
  if (!appDataDir) return []
  let installations = []
  try { installations = await readSmallJson(path.join(appDataDir, COMFY_DESKTOP_DIR_NAME, 'installations.json')) } catch { return [] }
  if (!Array.isArray(installations)) return []
  const roots = []
  for (const installation of installations) {
    const installPath = typeof installation?.installPath === 'string' ? installation.installPath.trim() : ''
    if (!installPath || !path.isAbsolute(installPath)) continue // remote / cloud entries have no installPath
    const root = await resolveComfyRootAt(installPath)
    if (root) roots.push({ root, source: 'comfy-desktop', label: String(installation?.name || '') })
  }
  return roots
}

async function legacyComfyDesktopRoots(appDataDir) {
  if (!appDataDir) return []
  try {
    const config = await readSmallJson(path.join(appDataDir, 'ComfyUI', 'config.json'))
    const basePath = typeof config?.basePath === 'string' ? config.basePath.trim() : ''
    if (!basePath || !path.isAbsolute(basePath)) return []
    // The old desktop app keeps ComfyUI's code inside itself; basePath holds
    // models/custom_nodes/user, which is what Drama Studio's setup uses.
    const root = await resolveComfyRootAt(basePath)
    if (root) return [{ root, source: 'comfy-desktop-legacy', label: '' }]
    const looksLikeBase = (await isDirectory(path.join(basePath, 'custom_nodes'))) && (await isDirectory(path.join(basePath, 'models')))
    return looksLikeBase ? [{ root: path.resolve(basePath), source: 'comfy-desktop-legacy', label: '' }] : []
  } catch {
    return []
  }
}

async function listWindowsDrives(letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
  const found = []
  await Promise.all([...letters].map(async (letter) => {
    const root = `${letter}:\\`
    if (await isDirectory(root)) found.push(root)
  }))
  return found.sort()
}

/** Default places to scan for this platform. */
async function defaultScanBases({ platform = process.platform, homedir = os.homedir(), drives } = {}) {
  const home = homedir || ''
  const bases = home
    ? [home, path.join(home, 'Desktop'), path.join(home, 'Documents'), path.join(home, 'Downloads')]
    : []
  if (platform === 'win32') bases.push(...(drives || await listWindowsDrives()))
  else if (platform === 'darwin') bases.push('/Applications')
  else bases.push('/opt')
  return [...new Set(bases.map((base) => path.resolve(base)))]
}

/**
 * Breadth-first search for ComfyUI folders under `bases`, bounded by depth,
 * folder count and time so a huge disk can't stall start-up.
 */
async function scanForComfyRoots(bases, { maxDepth = DEFAULT_SCAN_DEPTH, budgetMs = DEFAULT_SCAN_BUDGET_MS, maxDirs = DEFAULT_MAX_DIRS, now = Date.now, homedir = os.homedir() } = {}) {
  const homeKey = homedir ? path.resolve(homedir).toLowerCase() : ''
  const deadline = now() + budgetMs
  const found = []
  const seen = new Set()
  let queue = bases.map((dir) => ({ dir, depth: 0 }))
  let visited = 0
  let truncated = false
  while (queue.length) {
    const next = []
    // One level at a time, in parallel batches.
    for (let i = 0; i < queue.length; i += 32) {
      if (now() > deadline || visited >= maxDirs) { truncated = true; break }
      const batch = queue.slice(i, i + 32)
      await Promise.all(batch.map(async ({ dir, depth }) => {
        const key = dir.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)
        visited += 1
        let entries = []
        try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
        const names = new Set(entries.map((entry) => entry.name))
        if (names.has('main.py') && names.has('nodes.py') && names.has('comfy') && await isComfySourceRoot(dir)) {
          found.push({ root: path.resolve(dir), source: 'scan', label: '' })
          return // don't descend into a ComfyUI folder
        }
        if (depth >= maxDepth) return
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.isSymbolicLink()) continue
          if (SKIP_DIR.test(entry.name)) continue
          // Dot folders in the home folder are app config (.config, .npm, ...).
          if (entry.name.startsWith('.') && path.resolve(dir).toLowerCase() === homeKey) continue
          next.push({ dir: path.join(dir, entry.name), depth: depth + 1 })
        }
      }))
    }
    if (truncated) break
    queue = next
  }
  return { roots: found, visited, truncated }
}

function dedupeRoots(entries) {
  const byKey = new Map()
  for (const entry of entries) {
    if (!entry?.root) continue
    const key = path.resolve(entry.root).toLowerCase()
    if (!byKey.has(key)) byKey.set(key, entry)
  }
  return [...byKey.values()]
}

/**
 * @returns {Promise<{ installs: Array<{root, source, label}>, servers: Array<{port, httpBase, version, rootFromArgv}>, scan: {visited, truncated} }>}
 */
async function findComfyInstallations(options = {}) {
  const {
    platform = process.platform,
    homedir = os.homedir(),
    appDataDir = '',
    ports = DEFAULT_PORTS,
    scanBases,
    drives,
    probe = probeComfyServer,
    scan = true,
    scanOptions = {},
  } = options
  const [servers, desktop, legacy] = await Promise.all([
    Promise.all(ports.map((port) => probe(port))).then((list) => list.filter(Boolean)),
    comfyDesktopRoots(appDataDir),
    legacyComfyDesktopRoots(appDataDir),
  ])
  const fromServers = []
  for (const server of servers) {
    const root = await resolveComfyRootAt(server.rootFromArgv)
    if (root) fromServers.push({ root, source: 'running', label: `port ${server.port}` })
  }
  let scanResult = { roots: [], visited: 0, truncated: false }
  if (scan) {
    const bases = scanBases || await defaultScanBases({ platform, homedir, drives })
    scanResult = await scanForComfyRoots(bases, { homedir, ...scanOptions })
  }
  return {
    installs: dedupeRoots([...fromServers, ...desktop, ...legacy, ...scanResult.roots]),
    servers,
    scan: { visited: scanResult.visited, truncated: scanResult.truncated },
  }
}

module.exports = {
  DEFAULT_PORTS,
  defaultScanBases,
  findComfyInstallations,
  isComfySourceRoot,
  probeComfyServer,
  resolveComfyRootAt,
  scanForComfyRoots,
}
