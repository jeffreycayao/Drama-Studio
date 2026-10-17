// Motion Studio: runs the steps from utils/motion/editPlanToSteps.mjs through
// the app's own timeline actions (the same ones the Assistant and agents use),
// after a checkpoint, on a NEW timeline, so the user's current edit is never
// touched. Optional steps (ducking, captions) never fail the whole apply.

import { runMcpAction } from '../mcpActions'
import useProjectStore from '../../stores/projectStore'
import useTimelineStore from '../../stores/timelineStore'

function uniqueTimelineName(name) {
  const existing = new Set((useProjectStore.getState().currentProject?.timelines || []).map((t) => String(t.name || '')))
  if (!existing.has(name)) return name
  for (let n = 2; n < 100; n += 1) if (!existing.has(`${name} (${n})`)) return `${name} (${n})`
  return `${name} (${Date.now()})`
}

/**
 * @param {{ steps: object[] }} built  from editPlanToSteps
 * @param {(progress: { index: number, total: number, label: string }) => void} [onProgress]
 */
export async function applyMotionSteps(built, { onProgress = () => {}, run = runMcpAction } = {}) {
  const steps = built?.steps || []
  const tracks = {}
  const clips = {}
  const skipped = []
  let timelineId = null
  let checkpointId = null

  const need = (map, key, what) => {
    if (!map[key]) throw new Error(`Motion Studio lost track of the ${what} "${key}".`)
    return map[key]
  }

  for (const [index, step] of steps.entries()) {
    onProgress({ index, total: steps.length, label: step.op })
    try {
      switch (step.op) {
        case 'checkpoint': {
          const result = await run('create_project_checkpoint', { label: step.label, previewOnly: false })
          checkpointId = result?.checkpoint?.id || result?.checkpointId || null
          break
        }
        case 'createTimeline': {
          const result = await run('create_timeline', {
            name: uniqueTimelineName(step.name), width: step.width, height: step.height, switchToTimeline: true, previewOnly: false,
          })
          timelineId = result?.timeline?.id || result?.currentTimelineId || null
          break
        }
        case 'useMainTrack': {
          const main = (useTimelineStore.getState().tracks || []).find((track) => track.type === 'video' && !track.locked)
          if (!main) throw new Error('The new timeline has no video track.')
          tracks[step.key] = main.id
          break
        }
        case 'addTrack': {
          const result = await run('add_track', { trackType: step.type, name: step.name, ...(step.type === 'audio' ? { channels: 'stereo' } : {}), previewOnly: false })
          const id = result?.track?.id
          if (!id) throw new Error(`Could not add the ${step.name} track.`)
          tracks[step.key] = id
          if (step.mixRole) await run('set_track_mix_role', { trackId: id, role: step.mixRole, previewOnly: false })
          break
        }
        case 'placeClip': {
          const result = await run('add_asset_to_timeline', {
            assetId: step.assetId,
            trackId: need(tracks, step.track, 'track'),
            startSeconds: step.startSeconds,
            ...(Number.isFinite(step.inSeconds) && step.inSeconds > 0 ? { sourceInSeconds: step.inSeconds } : {}),
            durationSeconds: step.seconds,
            selectAfterAdd: false,
            previewOnly: false,
          })
          const id = result?.clip?.id
          if (!id) throw new Error('A shot could not be placed on the timeline.')
          clips[step.key] = id
          break
        }
        case 'addText': {
          const result = await run('add_text_clip', {
            text: step.text,
            trackId: need(tracks, step.track, 'track'),
            startSeconds: step.startSeconds,
            durationSeconds: step.seconds,
            previewOnly: false,
          })
          if (result?.clip?.id) clips[step.key] = result.clip.id
          break
        }
        case 'transition':
          await run('add_transition', {
            clipAId: need(clips, step.between[0], 'shot'),
            clipBId: need(clips, step.between[1], 'shot'),
            transitionType: step.type === 'dip-to-black' ? 'dip-to-black' : 'dissolve',
            durationSeconds: step.seconds,
            previewOnly: false,
          })
          break
        case 'audioLevel':
          await run('set_clip_audio', {
            clipId: need(clips, step.clip, 'clip'),
            gainDb: step.gainDb,
            fadeInSeconds: step.fadeInSeconds,
            fadeOutSeconds: step.fadeOutSeconds,
            previewOnly: false,
          })
          break
        case 'duck':
          await run('auto_duck_music', { previewOnly: false })
          break
        case 'captions':
          await run('transcribe_captions', { scope: 'timeline', previewOnly: false })
          break
        default:
          throw new Error(`Unknown Motion Studio step "${step.op}".`)
      }
    } catch (error) {
      // Transitions and level tweaks are nice to have; a missing shot is not.
      if (step.optional || step.op === 'transition' || step.op === 'audioLevel') {
        skipped.push({ op: step.op, reason: error?.message || String(error) })
        continue
      }
      const failure = new Error(error?.message || String(error))
      failure.stepIndex = index
      failure.checkpointId = checkpointId
      failure.timelineId = timelineId
      throw failure
    }
  }
  onProgress({ index: steps.length, total: steps.length, label: 'done' })
  return { timelineId, checkpointId, clipCount: Object.keys(clips).length, trackCount: Object.keys(tracks).length, skipped }
}
