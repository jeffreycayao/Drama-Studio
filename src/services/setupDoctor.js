/**
 * Setup Doctor fact gathering.
 *
 * Runs every read-only probe in parallel and hands the raw facts to the pure
 * report builder. A probe that throws or times out contributes "unknown"
 * instead of failing the whole run, so one broken subsystem never hides the
 * advice for the rest.
 */

import { buildSetupReport } from '../utils/setupDoctorReport'
import { checkLocalComfyConnection, hydrateLocalComfyConnection } from './localComfyConnection'
import { getLocalCaptionEngineStatus, installLocalCaptionEngine } from './captionLocalTranscription'
import { getComfyPartnerApiKey } from './comfyPartnerAuth'
import { isCloudOnlyStatus } from '../utils/comfySetupGateFlow.mjs'
import { getPexelsApiKey } from './pexelsSettings'

const COMFY_TIMEOUT_MS = 2500

async function settle(promiseFactory, fallback = null) {
  try {
    return await promiseFactory()
  } catch {
    return fallback
  }
}

export async function gatherSetupFacts({ projectsPath } = {}) {
  const api = typeof window !== 'undefined' ? window.electronAPI : null

  const [native, captionEngine, comfy, cloudKey, pexelsKey, bridgeStatus, launcher, mcp, rtx, comfySetup] = await Promise.all([
    settle(() => api?.runSetupDoctorNativeChecks?.({ projectsPath: projectsPath || '' })),
    settle(() => getLocalCaptionEngineStatus()),
    settle(async () => {
      const connection = await hydrateLocalComfyConnection()
      const result = await checkLocalComfyConnection({ port: connection.port, timeoutMs: COMFY_TIMEOUT_MS })
      return { ...result, httpBase: result?.httpBase || connection.httpBase }
    }, { ok: false }),
    settle(() => getComfyPartnerApiKey(), ''),
    settle(() => getPexelsApiKey(), ''),
    settle(() => api?.comfyBridge?.getStatus?.()),
    settle(() => api?.comfyLauncher?.getConfig?.()),
    settle(() => api?.mcp?.getStatus?.()),
    settle(() => (api?.platform === 'win32' ? api?.checkRtxVideoUpscaleRuntime?.() : null)),
    settle(() => api?.comfySetup?.getStatus?.()),
  ])

  return {
    native: native || {},
    captionEngine,
    comfy,
    cloudKeyConfigured: Boolean(String(cloudKey || '').trim()),
    pexelsConfigured: Boolean(String(pexelsKey || '').trim()),
    bridge: bridgeStatus ? { installed: Boolean(bridgeStatus.installed), state: bridgeStatus.state || null } : null,
    launcher,
    mcp,
    rtx,
    cloudOnly: isCloudOnlyStatus(comfySetup),
    checkedAt: Date.now(),
  }
}

export async function runSetupDoctor(options = {}) {
  const facts = await gatherSetupFacts(options)
  return { ...buildSetupReport(facts), checkedAt: facts.checkedAt }
}

export async function installSetupCaptionEngine(onProgress) {
  return installLocalCaptionEngine({ modelId: 'base', onProgress })
}

export async function installSetupComfyBridge() {
  const api = typeof window !== 'undefined' ? window.electronAPI : null
  if (!api?.comfyBridge?.install) throw new Error('The ComfyUI bridge needs the Drama Studio desktop app.')
  const result = await api.comfyBridge.install()
  if (result?.success === false) throw new Error(result.error || 'Could not install the ComfyUI bridge.')
  return result
}
