'use strict'

/**
 * Collect every license the packaged app ships into one `licenses` folder
 * instead of loose files next to Drama Studio.exe:
 *
 *   licenses/
 *     README.txt                    what is here
 *     electron/LICENSE.txt          Electron (MIT)
 *     chromium/LICENSES.chromium.html
 *     ffmpeg/                       FFmpeg + FFprobe license and build notes
 *     third-party/THIRD-PARTY-NOTICES.txt   every npm package in the app
 *
 * The FFmpeg files also stay next to the binaries in resources/bin, where the
 * release gate and the GPL notice require them. Runs from the afterPack hook.
 */

const fs = require('fs')
const path = require('path')

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i

/** Bundled renderer libraries (Vite inlines them into dist/) plus main-process deps. */
function shippedPackageRoots(projectDir) {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'))
  const renderer = ['@xyflow/react', 'clsx', 'driver.js', 'html2canvas', 'jsonata', 'jspdf', 'lucide-react', 'mp4box', 'react', 'react-dom', 'zustand']
  return [...new Set([...Object.keys(pkg.dependencies || {}), ...renderer])]
}

/** Transitive runtime closure of `roots` resolved from node_modules. */
function collectPackages(projectDir, roots) {
  const seen = new Map()
  const queue = roots.map((name) => ({ name, from: projectDir }))
  while (queue.length) {
    const { name, from } = queue.shift()
    let dir = from
    let found = null
    // Node resolution: walk up node_modules folders.
    for (;;) {
      const candidate = path.join(dir, 'node_modules', name)
      if (fs.existsSync(path.join(candidate, 'package.json'))) { found = candidate; break }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    if (!found || seen.has(found)) continue
    const meta = JSON.parse(fs.readFileSync(path.join(found, 'package.json'), 'utf8'))
    seen.set(found, { name: meta.name || name, version: meta.version || '', license: typeof meta.license === 'string' ? meta.license : (meta.license?.type || ''), dir: found })
    for (const dep of Object.keys({ ...(meta.dependencies || {}), ...(meta.optionalDependencies || {}) })) queue.push({ name: dep, from: found })
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function licenseText(dir) {
  let names = []
  try { names = fs.readdirSync(dir) } catch { return '' }
  const file = names.find((name) => LICENSE_FILE.test(name))
  return file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : ''
}

function buildThirdPartyNotices(projectDir) {
  const packages = collectPackages(projectDir, shippedPackageRoots(projectDir))
  const blocks = packages.map((item) => [
    '='.repeat(78),
    `${item.name}@${item.version}${item.license ? `  (${item.license})` : ''}`,
    '='.repeat(78),
    licenseText(item.dir) || `License: ${item.license || 'see the package'}`,
  ].join('\n'))
  return {
    count: packages.length,
    text: `Drama Studio includes the following open-source packages.\n\n${blocks.join('\n\n')}\n`,
  }
}

const README = `Licenses for software included with Drama Studio

LICENSE.txt    Drama Studio's license: GNU General Public License v3.0
NOTICE.txt     Drama Studio copyright and attribution notices
electron/      Electron, the desktop runtime (MIT)
chromium/      Chromium and its components, bundled with Electron
ffmpeg/        FFmpeg and FFprobe, used for media import and export
               (also kept next to the programs in resources/bin)
third-party/   Open-source packages used by Drama Studio itself

Drama Studio(TM) itself is licensed under the GNU General Public License
v3.0 only (GPL-3.0-only); see LICENSE.txt and NOTICE.txt. The folders
cover the third-party components listed above.
`

function moveIfPresent(from, to) {
  if (!fs.existsSync(from)) return false
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.renameSync(from, to)
  return true
}

function copyIfPresent(from, to) {
  if (!fs.existsSync(from)) return false
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
  return true
}

/**
 * Organize licenses in a packaged app folder.
 * @param {{ appOutDir: string, resourcesDir: string, projectDir: string, licensesDir?: string, log?: Function }} options
 *   licensesDir defaults to <appOutDir>/licenses (Windows/Linux); macOS passes
 *   the app's Resources folder so the notices ship inside the .app.
 */
function organizeLicenses({ appOutDir, resourcesDir, projectDir, licensesDir, log = console.log }) {
  const root = licensesDir || path.join(appOutDir, 'licenses')
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, 'README.txt'), README)
  // Drama Studio's own GPL text and copyright notices must ship with every copy.
  for (const [from, to] of [['LICENSE', 'LICENSE.txt'], ['NOTICE', 'NOTICE.txt']]) {
    if (!copyIfPresent(path.join(projectDir, from), path.join(root, to))) throw new Error(`[licenses] ${from} is missing from ${projectDir}`)
  }
  // electron-builder puts these next to the executable (Windows/Linux) or in
  // the app folder; move them so the install folder stays tidy.
  for (const dir of [appOutDir, resourcesDir]) {
    moveIfPresent(path.join(dir, 'LICENSE.electron.txt'), path.join(root, 'electron', 'LICENSE.txt'))
    moveIfPresent(path.join(dir, 'LICENSES.chromium.html'), path.join(root, 'chromium', 'LICENSES.chromium.html'))
  }
  const bin = path.join(resourcesDir, 'bin')
  let items = []
  try { items = fs.readdirSync(bin) } catch { items = [] }
  for (const name of items.filter((item) => /\.(LICENSE|README)$/i.test(item))) copyIfPresent(path.join(bin, name), path.join(root, 'ffmpeg', name))
  const notices = buildThirdPartyNotices(projectDir)
  fs.mkdirSync(path.join(root, 'third-party'), { recursive: true })
  fs.writeFileSync(path.join(root, 'third-party', 'THIRD-PARTY-NOTICES.txt'), notices.text)
  log(`[licenses] organized into ${root} (${notices.count} third-party packages)`)
  return { root, packages: notices.count }
}

module.exports = { buildThirdPartyNotices, collectPackages, organizeLicenses, shippedPackageRoots }
