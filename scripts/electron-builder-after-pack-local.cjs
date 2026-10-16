// afterPack for local test builds (npm run exe:latest) when the CI-built RIFE
// runtime is not staged: skips the RIFE/native gates but still organizes the
// licenses and enforces the lean-installer content gate.
const path = require('path')
const { assertPackageContents } = require('./package-content-gate.cjs')
const { organizeLicenses } = require('./organize-licenses.cjs')

module.exports = async function afterPackLocal(context) {
  const resourcesDir = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager?.appInfo?.productFilename || 'Drama Studio'}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources')
  organizeLicenses({ appOutDir: context.appOutDir, resourcesDir, projectDir: context.packager.projectDir })
  assertPackageContents(resourcesDir)
}
