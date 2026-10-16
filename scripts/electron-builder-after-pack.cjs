const { normalizeArch, normalizePlatform } = require('../electron/rifeRuntime')
const {
  packagedResourcesPath,
  verifyPackagedResources,
} = require('./runtime-package-gate.cjs')
const { assertPackageContents } = require('./package-content-gate.cjs')
const { organizeLicenses } = require('./organize-licenses.cjs')

module.exports = async function afterPack(context) {
  const platform = normalizePlatform(context.electronPlatformName)
  const arch = normalizeArch(context.arch)
  verifyPackagedResources({
    resourcesPath: packagedResourcesPath(context),
    platform,
    arch,
    // Windows signs extra-resource executables while copying them, before this
    // hook, but signs Drama Studio.exe afterward. macOS signs the completed app after
    // this hook. Retry changed native helpers only under valid Authenticode;
    // the final release gate later requires the helpers to match Drama Studio's signer.
    allowSignedPackageFallback: platform === 'win32',
  })
  // Licenses in one folder instead of loose files next to the executable.
  const resourcesDir = packagedResourcesPath(context)
  organizeLicenses({
    appOutDir: context.appOutDir,
    resourcesDir,
    projectDir: context.packager.projectDir,
    licensesDir: platform === 'darwin' ? require('path').join(resourcesDir, 'licenses') : undefined,
  })
  // Lean installer: packs, models and other large content download later.
  assertPackageContents(resourcesDir)
}
