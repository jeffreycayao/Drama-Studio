// Bundle entry for tests/musicEnginesLipSync.test.mjs: the real dependency
// checker, registries and music service, with the ComfyUI client stubbed.
export { checkWorkflowDependencies } from '../../src/services/workflowDependencies.js'
export { getModelInstallInfo, getNodeInstallInfo } from '../../src/config/workflowInstallCatalog.js'
export { BUILTIN_WORKFLOWS, BUILTIN_WORKFLOW_PATHS } from '../../src/config/workflowRegistry.js'
export { GENERATE_WORKFLOW_CATALOG } from '../../src/config/generateWorkflowCatalog.js'
export { getWorkflowHardwareInfo } from '../../src/config/generateWorkspaceConfig.js'
export { queueMusicGeneration } from '../../src/services/musicGeneration.js'
// Resolved to the stubbed ComfyUI client by the test's esbuild plugin.
export { __setKey, __queued } from 'stub:comfyui'
