#!/usr/bin/env node
'use strict'

// Release CI with Windows signing (.github/workflows/release.yml): writes a
// copy of package.json "build" with Azure Trusted Signing added, for
// `electron-builder --config <file>`. The account and profile are the
// maintainer's own and live in repository variables, not in package.json, so
// forks and local builds never point at someone else's signing account.
//
//   AZURE_CODE_SIGNING_ACCOUNT   Trusted Signing account name (required)
//   AZURE_CERTIFICATE_PROFILE    certificate profile name (required)
//   AZURE_CODE_SIGNING_ENDPOINT  account endpoint (default East US)
//   AZURE_PUBLISHER_NAME         certificate subject CN (default Jeffrey Cayao)
//
// publisherName also goes into the installed app's app-update.yml, so signed
// builds only accept updates signed by the same publisher.
//
//   node scripts/ci-signed-builder-config.cjs <output.json>

const fs = require('fs')
const path = require('path')

const DEFAULT_ENDPOINT = 'https://eus.codesigning.azure.net'
const DEFAULT_PUBLISHER = 'Jeffrey Cayao'

function signedBuilderConfig(build, env = process.env) {
  const account = String(env.AZURE_CODE_SIGNING_ACCOUNT || '').trim()
  const profile = String(env.AZURE_CERTIFICATE_PROFILE || '').trim()
  if (!account || !profile) {
    throw new Error('Set the AZURE_CODE_SIGNING_ACCOUNT and AZURE_CERTIFICATE_PROFILE repository variables to sign Windows builds.')
  }
  const endpoint = String(env.AZURE_CODE_SIGNING_ENDPOINT || DEFAULT_ENDPOINT).trim()
  if (!/^https:\/\/[a-z0-9-]+\.codesigning\.azure\.net\/?$/i.test(endpoint)) {
    throw new Error(`AZURE_CODE_SIGNING_ENDPOINT is not an Azure Trusted Signing endpoint: ${endpoint}`)
  }
  const config = JSON.parse(JSON.stringify(build || {}))
  config.win = {
    ...(config.win || {}),
    azureSignOptions: {
      publisherName: String(env.AZURE_PUBLISHER_NAME || DEFAULT_PUBLISHER).trim(),
      endpoint,
      codeSigningAccountName: account,
      certificateProfileName: profile,
    },
  }
  return config
}

if (require.main === module) {
  const output = process.argv[2]
  if (!output) {
    console.error('Usage: node scripts/ci-signed-builder-config.cjs <output.json>')
    process.exit(1)
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
    fs.writeFileSync(output, JSON.stringify(signedBuilderConfig(pkg.build), null, 2))
    console.log(`Signed electron-builder config written to ${output}`)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}

module.exports = { signedBuilderConfig }
