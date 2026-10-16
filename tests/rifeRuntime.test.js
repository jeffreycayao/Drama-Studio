const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { resolveRifeRuntime, verifyPlatformSignature, windowsSignatureEnvironment } = require('../electron/rifeRuntime')

function createRuntime(root, platform = 'linux') {
  fs.mkdirSync(path.join(root, 'rife-v4.6'), { recursive: true })
  fs.writeFileSync(path.join(root, platform === 'win32' ? 'rife-ncnn-vulkan.exe' : 'rife-ncnn-vulkan'), 'binary')
  fs.writeFileSync(path.join(root, 'rife-v4.6', 'flownet.param'), 'model')
  fs.writeFileSync(path.join(root, 'rife-v4.6', 'flownet.bin'), 'weights')
}

test('resolves a complete development runtime', (t) => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-studio-rife-runtime-'))
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }))
  const runtimeRoot = path.join(appRoot, '.runtime', 'rife')
  createRuntime(runtimeRoot)

  const result = resolveRifeRuntime({ appRoot, platform: 'linux' })
  assert.equal(result.available, true)
  assert.equal(result.executablePath, path.join(runtimeRoot, 'rife-ncnn-vulkan'))
  assert.equal(result.modelPath, path.join(runtimeRoot, 'rife-v4.6'))
})

test('uses the packaged Windows executable name, ignores overrides, and rejects an unproven runtime', (t) => {
  const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-studio-rife-resources-'))
  t.after(() => fs.rmSync(resourcesPath, { recursive: true, force: true }))
  const runtimeRoot = path.join(resourcesPath, 'bin', 'rife')
  createRuntime(runtimeRoot, 'win32')

  const result = resolveRifeRuntime({
    packaged: true,
    resourcesPath,
    platform: 'win32',
    environmentRoot: path.join(resourcesPath, 'untrusted-override'),
  })
  assert.equal(result.available, false)
  assert.equal(path.basename(result.executablePath), 'rife-ncnn-vulkan.exe')
  assert.equal(result.root, runtimeRoot)
  assert.match(result.error, /integrity check/i)
  assert.match(result.validationErrors[0], /provenance/i)
})

test('reports a missing model or executable without guessing another path', (t) => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drama-studio-rife-missing-'))
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }))

  const result = resolveRifeRuntime({ appRoot, platform: 'linux' })
  assert.equal(result.available, false)
  assert.equal(result.missingPaths.length, 3)
  assert.match(result.error, /smooth-motion engine is missing/i)
})

test('Windows signature checks discard incompatible inherited PowerShell module paths', () => {
  const environment = windowsSignatureEnvironment({
    Path: 'C:\\Windows\\System32',
    PSModulePath: 'C:\\Program Files\\PowerShell\\Modules',
    pSmOdUlEpAtH: 'C:\\another-inherited-module-path',
    DRAMA_STUDIO_TEST_VALUE: 'preserved',
  })
  assert.equal(environment.Path, 'C:\\Windows\\System32')
  assert.equal(environment.DRAMA_STUDIO_TEST_VALUE, 'preserved')
  assert.equal(Object.keys(environment).some((key) => key.toLowerCase() === 'psmodulepath'), false)
})

const PACKAGE_ROOT = 'C:\\Program Files\\WindowsApps\\DramaStudio_0.1.5.0_x64__abc123'
const PACKAGE_HOST = `${PACKAGE_ROOT}\\app\\Drama Studio.exe`
const PACKAGE_RIFE = `${PACKAGE_ROOT}\\app\\resources\\bin\\rife\\rife-ncnn-vulkan.exe`
const OUR_SIGNER = { status: 'Valid', subject: 'CN=Drama Studio Publisher', issuer: 'CN=Azure Trusted Signing' }
const STORE_SIGNER = { status: 'Valid', subject: 'CN=00000000-PARTNER-CENTER-ID', issuer: 'CN=Microsoft Marketplace CA G 027' }
const INTACT_PACKAGE = {
  familyName: 'DramaStudio_abc123',
  installLocation: PACKAGE_ROOT,
  signatureKind: 'Store',
  status: 'Ok',
  isDevelopmentMode: false,
}

function verifyWindows(identities, options = {}) {
  const seen = {}
  const result = verifyPlatformSignature({
    platform: 'win32',
    executablePath: options.executablePath || PACKAGE_RIFE,
    hostExecutablePath: PACKAGE_HOST,
    windowsStore: options.windowsStore,
    readWindowsIdentities: (target, host, readOptions) => {
      Object.assign(seen, { target, host, ...readOptions })
      return identities
    },
  })
  return { result, seen }
}

test('Windows signature check requires the RIFE signer to match the host outside a Store package', () => {
  const { result, seen } = verifyWindows({ target: OUR_SIGNER, host: OUR_SIGNER })
  assert.equal(result, OUR_SIGNER)
  assert.equal(seen.windowsStore, false)
  assert.throws(
    () => verifyWindows({ target: OUR_SIGNER, host: STORE_SIGNER, package: INTACT_PACKAGE }),
    /signer does not match/,
  )
  assert.throws(
    () => verifyWindows({ target: OUR_SIGNER, host: { status: 'NotSigned' }, package: INTACT_PACKAGE }),
    /host Authenticode signature is not valid/,
  )
})

test('Windows Store package accepts the package signer only for an intact package containing both executables', () => {
  const { result, seen } = verifyWindows({ target: OUR_SIGNER, host: STORE_SIGNER, package: INTACT_PACKAGE }, { windowsStore: true })
  assert.equal(result, OUR_SIGNER)
  assert.equal(seen.windowsStore, true)
  assert.doesNotThrow(() => verifyWindows(
    { target: OUR_SIGNER, host: { status: 'NotSigned' }, package: { ...INTACT_PACKAGE, signatureKind: 'Developer' } },
    { windowsStore: true },
  ))
  // A matching signer still passes in a package without consulting package state.
  assert.doesNotThrow(() => verifyWindows({ target: OUR_SIGNER, host: OUR_SIGNER }, { windowsStore: true }))

  const rejects = (identities, pattern, options = {}) => assert.throws(
    () => verifyWindows(identities, { windowsStore: true, ...options }),
    pattern,
  )
  rejects({ target: { status: 'NotSigned' }, host: STORE_SIGNER, package: INTACT_PACKAGE }, /RIFE Authenticode signature is not valid/)
  rejects({ target: OUR_SIGNER, host: STORE_SIGNER }, /not running from an installed Windows package/)
  rejects({ target: OUR_SIGNER, host: STORE_SIGNER, package: { ...INTACT_PACKAGE, status: 'Tampered' } }, /not intact/)
  rejects({ target: OUR_SIGNER, host: STORE_SIGNER, package: { ...INTACT_PACKAGE, signatureKind: 'None' } }, /not signed for distribution/)
  rejects({ target: OUR_SIGNER, host: STORE_SIGNER, package: { ...INTACT_PACKAGE, isDevelopmentMode: true } }, /not signed for distribution/)
  rejects(
    { target: OUR_SIGNER, host: STORE_SIGNER, package: INTACT_PACKAGE },
    /not inside the installed Drama Studio package/,
    { executablePath: 'C:\\Users\\someone\\Downloads\\rife-ncnn-vulkan.exe' },
  )
  rejects(
    { target: OUR_SIGNER, host: STORE_SIGNER, package: { ...INTACT_PACKAGE, installLocation: `${PACKAGE_ROOT}-other` } },
    /not inside the installed Drama Studio package/,
  )
})
