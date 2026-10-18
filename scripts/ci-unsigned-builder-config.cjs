#!/usr/bin/env node
'use strict'

// Release CI without signing secrets (.github/workflows/release.yml): writes
// a copy of package.json "build" with Windows signing removed, for
// `electron-builder --config <file>`. A config file replaces package.json
// "build", so everything else (targets, hooks, artifact names) is kept.
//
//   node scripts/ci-unsigned-builder-config.cjs <output.json>

const fs = require('fs')
const path = require('path')

function unsignedBuilderConfig(build) {
  const config = JSON.parse(JSON.stringify(build || {}))
  if (config.win) delete config.win.azureSignOptions
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
