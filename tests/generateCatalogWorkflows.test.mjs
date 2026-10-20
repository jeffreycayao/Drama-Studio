import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// The config modules import siblings without extensions and read
// import.meta.env, so bundle them with esbuild the way Vite would.
async function loadGenerateConfig() {
  const { build } = await import('esbuild')
  const result = await build({
    stdin: {
      contents: [
        "export { WORKFLOWS, getWorkflowHardwareInfo } from './src/config/generateWorkspaceConfig.js'",
        "export { GENERATE_WORKFLOW_CATALOG } from './src/config/generateWorkflowCatalog.js'",
      ].join('\n'),
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      loader: 'js',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  })
  const source = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  return import(source)
}

// Mirrors handleWorkflowManifestSelect in GenerateWorkspace.jsx.
function categoryForManifest(manifest) {
  if (manifest.outputType === 'audio') return 'audio'
  if (manifest.outputType === 'image') return 'image'
  return 'video'
}

function runnableGenerateManifests(catalog) {
  return catalog.filter((manifest) => manifest.mode === 'generate' && manifest.runnable && manifest.workflowId)
}

// Selecting a catalog card sets the category and workflowId. The "When category
// changes, pick default workflow" effect then resets any workflowId missing from
// WORKFLOWS[category] to the first entry, so the card silently opens a different
// workflow (Qwen3 TTS, MiniMax H3 and Seedance 2.0 Mini T2V all did).
test('every runnable Generate catalog card is listed in WORKFLOWS for its category', async () => {
  const { WORKFLOWS, GENERATE_WORKFLOW_CATALOG } = await loadGenerateConfig()
  const manifests = runnableGenerateManifests(GENERATE_WORKFLOW_CATALOG)
  assert.ok(manifests.length > 0, 'expected runnable generate manifests in the catalog')

  const missing = manifests
    .filter((manifest) => !(WORKFLOWS[categoryForManifest(manifest)] || [])
      .some((workflow) => workflow.id === manifest.workflowId))
    .map((manifest) => `${manifest.title} (${manifest.workflowId}) -> WORKFLOWS.${categoryForManifest(manifest)}`)

  assert.deepEqual(missing, [], `catalog cards that would open a different workflow:\n${missing.join('\n')}`)
})

// The workflow picker groups WORKFLOWS entries by getWorkflowHardwareInfo and
// treats an unknown id as local, so a cloud card without an entry shows under Local.
test('cloud Generate catalog cards are grouped as cloud in the workflow picker', async () => {
  const { GENERATE_WORKFLOW_CATALOG, getWorkflowHardwareInfo } = await loadGenerateConfig()
  const misgrouped = runnableGenerateManifests(GENERATE_WORKFLOW_CATALOG)
    .filter((manifest) => manifest.route === 'cloud')
    .filter((manifest) => getWorkflowHardwareInfo(manifest.workflowId)?.runtime !== 'cloud')
    .map((manifest) => `${manifest.title} (${manifest.workflowId})`)

  assert.deepEqual(misgrouped, [], `cloud cards missing a cloud hardware entry:\n${misgrouped.join('\n')}`)
})
