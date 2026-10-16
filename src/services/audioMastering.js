import { fetchDuckingWaveform } from './audioDucking.mjs'
import {
  planAutoDuckingTargets, detectSpeechActivity, buildAutoDuckingEnvelope, getAutoDuckingBase,
  buildAutoDuckingRecord, validateAutoDuckingSettings,
} from '../utils/audioMastering.mjs'

/** Read-only auto-ducking analysis over every BGM clip. Decodes each unique
 * dialogue source once (RMS requested), in main, one at a time. Returns
 * proposals the caller can audition and then pass to
 * `timelineStore.applyAutoDucking`. Nothing here edits the project. */
export async function analyzeAutoDucking({ state, assets, projectHandle, settings, signal,
  isCurrent = () => true, onProgress = () => {}, api = globalThis.window?.electronAPI, browserWaveform } = {}) {
  const alive = () => !signal?.aborted && isCurrent()
  const check = () => { if (!alive()) throw new Error('Analysis canceled because the editing context changed or the dialog was closed.') }
  check()
  const checked = validateAutoDuckingSettings(settings)
  if (!checked.ok) throw new Error(checked.reason)
  const plan = planAutoDuckingTargets(state, assets)
  if (!plan.ok) throw new Error(plan.reason)
  if (!plan.targets.length) return { proposals: [], skipped: plan.skipped, detector: checked.settings.detector }
  const unique = [...new Map(plan.targets.flatMap(target => target.sources).map(source => [source.asset.id, source.asset])).values()]
  const waveforms = new Map()
  for (const [index, asset] of unique.entries()) {
    check()
    onProgress(`Reading dialogue ${index + 1} of ${unique.length}…`)
    waveforms.set(asset.id, await fetchDuckingWaveform(asset, {
      projectHandle, api, check, includeRms: checked.settings.detector === 'rms',
      ...(browserWaveform ? { browserWaveform } : {}),
    }))
  }
  check()
  const proposals = [], skipped = [...plan.skipped]
  let detector = checked.settings.detector
  for (const { music, musicTrack, sources } of plan.targets) {
    const activity = detectSpeechActivity(music, sources, waveforms, checked.settings)
    if (activity.detector !== detector) detector = activity.detector
    const base = getAutoDuckingBase(music)
    const result = buildAutoDuckingEnvelope(music, activity, checked.settings, base.envelope)
    if (!result.ok) { skipped.push({ clipId: music.id, name: music.name || music.id, reason: result.reason }); continue }
    proposals.push({
      clip: music, trackId: musicTrack.id, trackName: musicTrack.name || musicTrack.id,
      envelope: result.envelope, activity, dipCount: result.dipCount, mergedForLimit: result.mergedForLimit,
      pointCount: result.pointCount, replacesPrevious: base.replacesPrevious, editedSinceDucking: base.editedSinceDucking,
      autoDucking: buildAutoDuckingRecord(base.envelope, result.envelope, checked.settings),
    })
  }
  return { proposals, skipped, detector }
}

/** Store payload for one atomic, undoable apply. */
export function toAutoDuckingUpdates(proposals) {
  return proposals.map(proposal => ({ clipId: proposal.clip.id, expectedClip: proposal.clip,
    envelope: proposal.envelope, autoDucking: proposal.autoDucking }))
}
