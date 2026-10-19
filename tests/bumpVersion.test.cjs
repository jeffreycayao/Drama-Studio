const test = require('node:test')
const assert = require('node:assert/strict')
const { nextVersion, replaceVersionField } = require('../scripts/bump-version.cjs')

test('patch, minor and major follow major.minor.patch rules', () => {
  assert.equal(nextVersion('0.1.1', 'patch'), '0.1.2')
  assert.equal(nextVersion('0.1.9', 'minor'), '0.2.0')
  assert.equal(nextVersion('0.9.3', 'major'), '1.0.0')
  assert.equal(nextVersion('0.1.4', 'set', '0.1.1'), '0.1.1')
  assert.throws(() => nextVersion('0.1.1', 'set', 'v2'))
  assert.throws(() => nextVersion('0.1', 'patch'))
  assert.throws(() => nextVersion('0.1.1', 'huge'))
})

test('only the top-level package.json version field is rewritten', () => {
  const pkg = '{\n  "name": "drama-studio",\n  "version": "0.1.1",\n  "dependencies": { "x": { "version": "9.9.9" } }\n}\n'
  const next = replaceVersionField(pkg, '0.1.2')
  assert.match(next, /"version": "0\.1\.2"/)
  assert.match(next, /"version": "9\.9\.9"/)
})

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { readVersions, versionProblems } = require('../scripts/check-version-sync.cjs')

test('Drama Studio Companion has the app version', () => {
  const versions = readVersions()
  assert.deepEqual(versionProblems(versions), [], JSON.stringify(versions))
})

test('the version check names every mismatch and a wrong tag', () => {
  const same = { app: '0.6.0', appLock: '0.6.0', companion: '0.6.0', companionLock: '0.6.0' }
  assert.deepEqual(versionProblems(same, 'v0.6.0'), [])
  assert.match(versionProblems({ ...same, companion: '0.5.2' }).join(), /companion is 0\.5\.2, app is 0\.6\.0/)
  assert.match(versionProblems({ ...same, companionLock: '0.5.2' }).join(), /companionLock/)
  assert.match(versionProblems(same, 'v0.5.9').join(), /tag v0\.5\.9 does not match/)
  assert.match(versionProblems({ ...same, companion: undefined }).join(), /has no version/)
})

test('the Companion changelog gets the release heading', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-version-'))
  const { releaseCompanionChangelog } = require('../scripts/bump-version.cjs')
  const file = path.join(dir, 'CHANGELOG.md')
  fs.writeFileSync(file, '# Changelog\r\n\r\n## Unreleased\r\n\r\n- Something.\r\n\r\n## 0.5.2 (2026-10-18)\r\n')
  assert.equal(releaseCompanionChangelog('0.6.0', '2026-10-19', file), true)
  const next = fs.readFileSync(file, 'utf8')
  assert.match(next, /^## 0\.6\.0 \(2026-10-19\)\r$/m)
  assert.match(next, /^## 0\.5\.2/m)
  assert.ok(!next.includes('Unreleased'))
  // Nothing left to release: the file is left alone.
  assert.equal(releaseCompanionChangelog('0.6.1', '2026-10-20', file), false)
})
