import { exportReadinessWarning } from '../utils/exportReadiness.mjs'

export const EXPORT_READINESS_CONCURRENCY = 4

/** Only resolve a recorded local path. No relinking, directory searching,
 * media loading, metadata probing, or URL fetching belongs in this check. */
export async function resolveExportReadinessPath(location, projectHandle, api) {
  if (!location?.path || typeof location.path !== 'string' || location.path.includes('\0')) return null
  if (!location.relative) return location.path
  if (typeof projectHandle !== 'string' || !projectHandle.trim() || typeof api?.pathJoin !== 'function') return null
  // Project-owned relative paths must remain portable across Windows/POSIX.
  return await api.pathJoin(projectHandle, location.path.replace(/\\/g, '/'))
}

function combineWarnings(warnings) {
  const result = new Map()
  for (const warning of warnings) {
    const key = `${warning.code}:${warning.clipId || warning.assetId || ''}:${warning.time ?? ''}`
    const previous = result.get(key)
    if (previous) previous.occurrences = (previous.occurrences || 1) + 1
    else result.set(key, { ...warning })
  }
  return [...result.values()].sort((a, b) => (a.time ?? -1) - (b.time ?? -1))
}

/** A cancelled or superseded run returns null. IPC already in flight cannot
 * be cancelled, but no more work is scheduled and its results are discarded. */
export async function runExportReadinessCheck(plan, {
  api = globalThis.window?.electronAPI,
  signal,
  isCurrent = () => true,
  concurrency = EXPORT_READINESS_CONCURRENCY,
} = {}) {
  let invalidated = false
  const alive = () => {
    if (invalidated) return false
    invalidated = Boolean(signal?.aborted || !isCurrent())
    return !invalidated
  }
  if (!alive()) return null
  const checks = plan.files || [], fileResults = new Array(checks.length)
  const existence = new Map()
  let index = 0
  const worker = async () => {
    while (alive()) {
      const next = index++
      if (next >= checks.length) return
      const file = checks[next]
      let status = 'unverified'
      try {
        const path = await resolveExportReadinessPath(file.location, plan.projectHandle, api)
        if (!alive()) return
        if (path && typeof api?.exists === 'function') {
          if (!existence.has(path)) existence.set(path, Promise.resolve().then(() => alive() ? api.exists(path) : null))
          const exists = await existence.get(path)
          if (!alive()) return
          // IPC's normal result is boolean. Unknown response shapes are not
          // evidence of either availability or absence.
          if (exists === true) status = 'available'
          else if (exists === false) status = 'missing'
        }
      } catch (_) {
        if (!alive()) return
      }
      fileResults[next] = { file, status }
    }
  }
  const count = Math.max(1, Math.min(EXPORT_READINESS_CONCURRENCY,
    Number.isFinite(Number(concurrency)) ? Math.floor(Number(concurrency)) : EXPORT_READINESS_CONCURRENCY))
  let onAbort
  const aborted = new Promise(resolve => { onAbort = () => resolve(null); signal?.addEventListener('abort', onAbort, { once: true }) })
  try {
    const finished = await Promise.race([
      Promise.all(Array.from({ length: Math.min(count, checks.length) }, worker)),
      aborted,
    ])
    if (finished === null || !alive()) return null
    const warnings = [...plan.warnings]
    for (const { file, status } of fileResults) {
      if (status === 'available') continue
      warnings.push(exportReadinessWarning(status === 'missing' ? file.missingCode : 'file-unverified', {
        clipId: file.clipId, assetId: file.assetId, name: file.name, time: file.time, kind: file.kind,
      }))
    }
    return { warnings: combineWarnings(warnings), checkedFileCount: existence.size,
      availableFileCount: fileResults.filter(result => result.status === 'available').length,
      unverifiedFileCount: fileResults.filter(result => result.status === 'unverified').length,
      opticalFlowCount: plan.opticalFlowCount || 0, rangeStart: plan.rangeStart, rangeEnd: plan.rangeEnd }
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

/** Generation tokens protect repeated Refresh clicks as well as unmounts. */
export function createExportReadinessChecker(options = {}) {
  let generation = 0, controller = null
  const cancel = () => { generation += 1; controller?.abort(); controller = null }
  return {
    cancel,
    async run(plan, { isCurrent = () => true } = {}) {
      cancel()
      const token = generation
      controller = new AbortController()
      return runExportReadinessCheck(plan, { ...options, signal: controller.signal,
        isCurrent: () => token === generation && isCurrent() })
    },
  }
}
