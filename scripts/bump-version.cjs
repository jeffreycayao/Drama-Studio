#!/usr/bin/env node
// Drama Studio versioning (major.minor.patch).
//
//   node scripts/bump-version.cjs patch          0.1.1 -> 0.1.2   (runs automatically before every `npm run build`)
//   node scripts/bump-version.cjs minor          0.1.9 -> 0.2.0
//   node scripts/bump-version.cjs major          0.9.3 -> 1.0.0
//   node scripts/bump-version.cjs set 0.1.1      set an exact version
//   node scripts/bump-version.cjs patch --auto   same as patch, but skipped on CI or when DS_SKIP_VERSION_BUMP=1
//
// Updates package.json, package-lock.json and the README version badge. If CHANGELOG.md has notes under
// "## [Unreleased]", they are moved under a new "## [x.y.z] - date" heading.

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

function nextVersion(current, kind, explicit) {
  if (kind === 'set') {
    if (!SEMVER.test(String(explicit || ''))) throw new Error(`"set" needs a version like 0.1.1 (got "${explicit || ''}").`)
    return explicit
  }
  const match = SEMVER.exec(current)
  if (!match) throw new Error(`package.json version "${current}" is not major.minor.patch.`)
  let [major, minor, patch] = match.slice(1).map(Number)
  if (kind === 'major') { major += 1; minor = 0; patch = 0 }
  else if (kind === 'minor') { minor += 1; patch = 0 }
  else if (kind === 'patch') { patch += 1 }
  else throw new Error(`Unknown bump "${kind}". Use patch, minor, major or set <version>.`)
  return `${major}.${minor}.${patch}`
}

function replaceVersionField(text, version, { all = false } = {}) {
  let replaced = false
  return text.replace(/("version"\s*:\s*")[^"]*(")/g, (whole, start, end) => {
    if (replaced && !all) return whole
    replaced = true
    return `${start}${version}${end}`
  })
}

function updateLockfile(version) {
  const file = path.join(root, 'package-lock.json')
  if (!fs.existsSync(file)) return
  const text = fs.readFileSync(file, 'utf8')
  const lock = JSON.parse(text)
  lock.version = version
  if (lock.packages && lock.packages['']) lock.packages[''].version = version
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  fs.writeFileSync(file, `${JSON.stringify(lock, null, 2)}\n`.replace(/\n/g, eol))
}

function updateReadmeBadge(version) {
  const i18nDir = path.join(root, 'docs', 'i18n')
  const files = [path.join(root, 'README.md')]
  if (fs.existsSync(i18nDir)) {
    for (const name of fs.readdirSync(i18nDir)) if (/^README\..+\.md$/.test(name)) files.push(path.join(i18nDir, name))
  }
  for (const file of files) {
    if (!fs.existsSync(file)) continue
    const text = fs.readFileSync(file, 'utf8')
    const next = text.replace(/badge\/version-\d+\.\d+\.\d+-/, `badge/version-${version}-`)
    if (next !== text) fs.writeFileSync(file, next)
  }
}

function releaseChangelog(version, date) {
  const file = path.join(root, 'CHANGELOG.md')
  if (!fs.existsSync(file)) return false
  const raw = fs.readFileSync(file, 'utf8')
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const text = raw.replace(/\r\n/g, '\n')
  const heading = '## [Unreleased]'
  const start = text.indexOf(heading)
  if (start < 0) return false
  const bodyStart = start + heading.length
  const nextHeading = text.indexOf('\n## ', bodyStart)
  const bodyEnd = nextHeading < 0 ? text.length : nextHeading
  const notes = text.slice(bodyStart, bodyEnd).trim()
  // Only release when there is something listed (ignore empty "### Added" stubs).
  if (!notes.split('\n').some((line) => /^\s*[-*]\s+\S/.test(line))) return false
  const released = `${heading}\n\n## [${version}] - ${date}\n\n${notes}\n`
  const next = `${text.slice(0, start)}${released}${text.slice(bodyEnd)}`
  fs.writeFileSync(file, next.replace(/\n/g, eol))
  return true
}

function main() {
  const args = process.argv.slice(2)
  const auto = args.includes('--auto')
  const [kind = 'patch', explicit] = args.filter((arg) => !arg.startsWith('--'))
  if (auto && (process.env.CI || process.env.DS_SKIP_VERSION_BUMP === '1')) {
    console.log('[version] Skipping automatic bump (CI or DS_SKIP_VERSION_BUMP=1).')
    return
  }

  const pkgFile = path.join(root, 'package.json')
  const pkgText = fs.readFileSync(pkgFile, 'utf8')
  const current = JSON.parse(pkgText).version
  const version = nextVersion(current, kind, explicit)
  fs.writeFileSync(pkgFile, replaceVersionField(pkgText, version))
  updateLockfile(version)
  updateReadmeBadge(version)
  const date = new Date().toISOString().slice(0, 10)
  const changelog = releaseChangelog(version, date)
  console.log(`[version] ${current} -> ${version}${changelog ? ' (CHANGELOG.md updated)' : ''}`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`[version] ${error.message}`)
    process.exit(1)
  }
}

module.exports = { nextVersion, replaceVersionField }
