#!/usr/bin/env node
'use strict'

// Release CI without signing secrets (.github/workflows/release.yml): writes
// a copy of package.json "build" with Windows signing removed and macOS
// ad-hoc signed without notarization, for
// `electron-builder --config <file>`. A config file replaces package.json
// "build", so everything else (targets, hooks, artifact names) is kept.
//
//   node scripts/ci-unsigned-builder-config.cjs <output.json>

const fs = require('fs')
const path = require('path')

function unsignedBuilderConfig(build) {
  const config = JSON.parse(JSON.stringify(build || {}))
  if (config.win) delete config.win.azureSignOptions
  // macOS without an Apple Developer ID: ad-hoc signature ("-"), which Apple
  // Silicon needs to start the app at all, and no notarization. Gatekeeper
  // still asks the user to allow the app once (Privacy & Security > Open Anyway).
  config.mac = { ...(config.mac || {}), identity: '-', notarize: false, hardenedRuntime: false }
  return config
}

if (require.main === module) {
  const output = process.argv[2]
  if (!output) {
    console.error('Usage: node scripts/ci-unsigned-builder-config.cjs <output.json>')
    process.exit(1)
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
  fs.writeFileSync(output, JSON.stringify(unsignedBuilderConfig(pkg.build), null, 2))
  console.log(`Unsigned electron-builder config written to ${output}`)
}

module.exports = { unsignedBuilderConfig }
