'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const pkg = require('../package.json')
const { signedBuilderConfig } = require('../scripts/ci-signed-builder-config.cjs')
const { unsignedBuilderConfig } = require('../scripts/ci-unsigned-builder-config.cjs')

test('package.json names no signing account; forks never sign as someone else', () => {
  assert.equal(pkg.build.win.azureSignOptions, undefined)
  assert.doesNotMatch(JSON.stringify(pkg.build), /velorn/i)
})

test('signed config takes the account and profile from repository variables', () => {
  const config = signedBuilderConfig(pkg.build, {
    AZURE_CODE_SIGNING_ACCOUNT: 'my-account',
    AZURE_CERTIFICATE_PROFILE: 'my-profile',
  })
  assert.deepEqual(config.win.azureSignOptions, {
    publisherName: 'Jeffrey Cayao',
    endpoint: 'https://eus.codesigning.azure.net',
    codeSigningAccountName: 'my-account',
    certificateProfileName: 'my-profile',
  })
  assert.deepEqual(config.win.target, pkg.build.win.target, 'targets are kept')
  assert.deepEqual(config.publish, pkg.build.publish, 'the update feed is kept')
  assert.equal(pkg.build.win.azureSignOptions, undefined, 'package.json is not changed')
})

test('signed config refuses to run without an account, profile or a real endpoint', () => {
  assert.throws(() => signedBuilderConfig(pkg.build, {}), /AZURE_CODE_SIGNING_ACCOUNT/)
  assert.throws(() => signedBuilderConfig(pkg.build, { AZURE_CODE_SIGNING_ACCOUNT: 'a' }), /AZURE_CERTIFICATE_PROFILE/)
  assert.throws(() => signedBuilderConfig(pkg.build, {
    AZURE_CODE_SIGNING_ACCOUNT: 'a', AZURE_CERTIFICATE_PROFILE: 'p', AZURE_CODE_SIGNING_ENDPOINT: 'https://evil.example',
  }), /not an Azure Trusted Signing endpoint/)
  const west = signedBuilderConfig(pkg.build, {
    AZURE_CODE_SIGNING_ACCOUNT: 'a', AZURE_CERTIFICATE_PROFILE: 'p', AZURE_CODE_SIGNING_ENDPOINT: 'https://wus2.codesigning.azure.net',
  })
  assert.equal(west.win.azureSignOptions.endpoint, 'https://wus2.codesigning.azure.net')
})

test('unsigned config has no signing options', () => {
  assert.equal(unsignedBuilderConfig(pkg.build).win.azureSignOptions, undefined)
})
