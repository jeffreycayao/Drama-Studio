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

test('unsigned config has no Windows signing and ad-hoc signs macOS without notarizing', () => {
  const config = unsignedBuilderConfig(pkg.build)
  assert.equal(config.win.azureSignOptions, undefined)
  assert.equal(config.mac.identity, '-')
  assert.equal(config.mac.notarize, false)
  assert.equal(config.mac.hardenedRuntime, false)
  assert.equal(config.mac.target, pkg.build.mac.target, 'the dmg target is kept')
  assert.equal(config.mac.artifactName, pkg.build.mac.artifactName, 'release file names are kept')
  assert.equal(pkg.build.mac.notarize, true, 'package.json still notarizes signed builds')
})

// An empty CSC_LINK (secrets not set) makes electron-builder fail with
// "<repo> not a file", so every unsigned Mac build step unsets it first.
test('unsigned macOS builds unset the empty signing variables before electron-builder', () => {
  const fs = require('fs')
  const path = require('path')
  for (const workflow of ['release.yml', 'mac-build-check.yml']) {
    const text = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', workflow), 'utf8').replace(/\r\n/g, '\n')
    const step = text.slice(text.indexOf('- name: Build unsigned macOS artifacts'))
    const run = step.slice(0, step.indexOf('npx electron-builder'))
    assert.match(run, /unset CSC_LINK CSC_KEY_PASSWORD/, workflow)
  }
})
