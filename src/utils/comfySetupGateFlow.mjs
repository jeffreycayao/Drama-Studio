// Decisions for the first-launch ComfyUI gate (src/components/ComfySetupGate.jsx).
//
// A detected folder decides which launcher script "Start ComfyUI" runs, and
// detection includes a scan of drive roots, so a folder someone else planted
// could be picked up. Nothing found on disk is saved until the user confirms
// it: the gate shows the full path first. A ComfyUI server already answering
// on localhost is only connected to (nothing runs from disk), so it may still
// be accepted without a question.

/**
 * What the gate does with one detection result.
 * - confirm: show these folders; the user picks one (or locates their own).
 * - connect: no folder found, but a server is running; connect to its port.
 * - scan: nothing yet; search the drives (only when allowed).
 * - missing: nothing found; show install help.
 */
export function planDetection(result, { allowScan = false } = {}) {
  const installs = (Array.isArray(result?.installs) ? result.installs : [])
    .filter(entry => entry && typeof entry.root === 'string' && entry.root.trim())
  if (installs.length) return { kind: 'confirm', installs }
  const servers = Array.isArray(result?.servers) ? result.servers : []
  const server = servers.find(entry => entry && Number.isInteger(Number(entry.port)) && Number(entry.port) > 0)
  if (server) return { kind: 'connect', port: Number(server.port) }
  return { kind: allowScan ? 'scan' : 'missing' }
}

/**
 * Whether to ask about a launcher script after a folder is accepted.
 * A launcher the user already set is kept. Detected scripts are only offered,
 * never saved without a click.
 */
export function planLauncher({ config, detected } = {}) {
  if (String(config?.launcherScript || '').trim()) return { kind: 'keep' }
  const candidates = (Array.isArray(detected?.candidates) ? detected.candidates : [])
    .filter(entry => entry && typeof entry.path === 'string' && entry.path.trim())
  return candidates.length ? { kind: 'confirm', candidates } : { kind: 'none' }
}

// "Cloud only" (no GPU): the user chose to use Drama Studio without ComfyUI.
// Saved as comfySetup.via; ComfyUI features ask for ComfyUI when opened.
export const CLOUD_ONLY_VIA = 'cloud-only'

/** Whether the gate lets the app through on launch, from comfySetup:getStatus. */
export function gatePasses(status) {
  if (!status || typeof status !== 'object') return false
  return Boolean(status.skipGate || status.rootLooksValid || status.confirmedVia === 'server' || status.confirmedVia === CLOUD_ONLY_VIA)
}

/** Cloud-only applies only while no ComfyUI folder is set up. */
export function isCloudOnlyStatus(status) {
  return Boolean(status && status.confirmedVia === CLOUD_ONLY_VIA && !status.rootLooksValid && !status.skipGate)
}
