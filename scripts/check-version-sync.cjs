#!/usr/bin/env node
// Drama Studio and Drama Studio Companion share one version (scripts/bump-version.cjs keeps them equal).
//
//   node scripts/check-version-sync.cjs              app package.json == Companion package.json + lockfiles
//   node scripts/check-version-sync.cjs --tag v1.2.3 ...and the release tag is v<that version>
//
// The release workflow runs it before building, so a release never ships with mismatched versions.

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

function readVersions(base = root) {
  const read = (rel) => {
    const file = path.join(base, rel)
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
  }
  const app = read('package.json')
  const appLock = read('package-lock.json')
  const companion = read('extensions/companion/package.json')
  const companionLock = read('extensions/companion/package-lock.json')
  return {
    app: app?.version,
    appLock: appLock?.packages?.['']?.version ?? appLock?.version,
    companion: companion?.version,
    companionLock: companionLock?.packages?.['']?.version ?? companionLock?.version,
  }
}

/** @returns {string[]} problems, empty when everything matches */
function versionProblems(versions, tag = '') {
  const problems = []
  const { app } = versions
  for (const [name, value] of Object.entries(versions)) {
    if (value !== undefined && value !== app) problems.push(`${name} is ${value}, app is ${app}`)
  }
  if (versions.companion === undefined) problems.push('extensions/companion/package.json has no version')
  if (tag && tag !== `v${app}`) problems.push(`tag ${tag} does not match app version v${app}`)
  return problems
}

if (require.main === module) {
  const tagIndex = process.argv.indexOf('--tag')
  const tag = tagIndex > 0 ? process.argv[tagIndex + 1] || '' : ''
  const versions = readVersions()
  const problems = versionProblems(versions, tag)
  if (problems.length) {
    console.error(`[versions] Out of step:\n- ${problems.join('\n- ')}\nRun: node scripts/bump-version.cjs set ${versions.app}`)
    process.exit(1)
  }
  console.log(`[versions] Drama Studio and Drama Studio Companion are both ${versions.app}${tag ? ` (tag ${tag})` : ''}.`)
}

module.exports = { readVersions, versionProblems }
