import { getSmartReplaceTransitionExtent } from './smartReplace.mjs'

/**
 * Timeline lip-sync planning (sync.so, Timeline clip menu).
 *
 * Works out which source seconds of a video clip the edit needs (the clip's
 * trim plus any between-clip transition handles) and which part of a dialogue
 * clip lines up with them, so the cloud job gets exactly one video range and a
 * dialogue track of the same length. The lip-synced result then replaces the
 * clip source through Smart Replace with sourceInSeconds = trimStart - start,
 * which keeps the edit, trims, transitions and undo intact.
 *
 * Only real-time clips are supported: retimed, reversed or ramped clips would
 * need the dialogue time-warped to source time, which this does not do.
 */

export const LIPSYNC_WORKFLOW_ID = 'sync-lipsync'
// sync.so price badge in ComfyUI 0.41.1 (comfy_api_nodes/nodes_sync_so.py).
export const SYNC_SO_USD_PER_SECOND = 0.19019
export const LIPSYNC_MAX_SECONDS = 600
const MIN_DIALOGUE_SECONDS = 0.25
export const SEGMENT_MARGIN_SECONDS = 0.25
const EPS = 1e-6

const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const fail = (reason) => ({ ok: false, reason })
const locked = (value) => Boolean(value?.locked || value?.syncLocked || value?.lockMode === 'sync' || value?.syncLock?.mode === 'sync')

function sourceRate(clip) {
  const speed = clip.speed ?? 1
  const scale = clip.sourceTimeScale
    ?? (clip.timelineFps && clip.sourceFps ? clip.timelineFps / clip.sourceFps : 1)
  return speed * scale
}

function realtimeReason(clip, what) {
  if (clip.reverse) return `The ${what} plays in reverse. Lip-sync needs it at normal speed.`
  if (Array.isArray(clip.keyframes?.speed) && clip.keyframes.speed.length > 0) return `The ${what} has a speed ramp. Remove it before lip-syncing.`
  if (Math.abs(sourceRate(clip) - 1) > 1e-4) return `The ${what} is retimed. Lip-sync needs it at 100% real-time speed.`
  return ''
}

/**
 * Fill the bundled api_sync_so_lip_sync.json with uploaded inputs. cut_off
 * keeps the output at the shorter input; both inputs have the same length.
 */
export function buildLipSyncWorkflow(template, { videoName, audioName, seed = 0, filenamePrefix, followActiveSpeaker = false } = {}) {
  const workflow = JSON.parse(JSON.stringify(template || {}))
  const byClass = (classType) => Object.values(workflow).find((node) => node?.class_type === classType)
  const load = byClass('LoadVideo')
  const audio = byClass('LoadAudio')
  const sync = byClass('SyncLipSyncNode')
  const save = byClass('SaveVideo')
  if (!load || !audio || !sync || !save) throw new Error('The bundled lip-sync workflow is incomplete.')
  load.inputs.file = String(videoName)
  audio.inputs.audio = String(audioName)
  sync.inputs.seed = Math.abs(Math.floor(Number(seed) || 0)) % 2147483647
  sync.inputs['model.sync_mode'] = 'cut_off'
  sync.inputs['model.speaker_selection'] = followActiveSpeaker ? 'auto-detect' : 'default'
  if (filenamePrefix) save.inputs.filename_prefix = String(filenamePrefix)
  return workflow
}

/** Quick menu check: is this a clip lip-sync could work on at all? */
export function canLipSyncClip(clip, track) {
  if (!clip || clip.type !== 'video' || track?.type !== 'video') return false
  if (locked(clip) || locked(track)) return false
  return !realtimeReason(clip, 'clip')
}

/**
 * Audio clips that overlap the video clip, best first: tracks marked as
 * dialogue, then clips not linked to the video (its own camera audio is
 * rarely the new line), then by overlap length.
 */
export function listLipSyncAudioCandidates({ clips = [], tracks = [], clipId } = {}) {
  const clip = clips.find((item) => item?.id === clipId)
  if (!clip) return []
  const start = clip.startTime
  const end = clip.startTime + clip.duration
  const trackById = new Map(tracks.map((track) => [track.id, track]))
  return clips
    .filter((item) => {
      const track = trackById.get(item?.trackId)
      if (!item || item.id === clip.id || track?.type !== 'audio' || track.muted || item.muted) return false
      if (!['audio', 'video'].includes(item.type) || !finite(item.startTime) || !finite(item.duration)) return false
      return Math.min(end, item.startTime + item.duration) - Math.max(start, item.startTime) >= MIN_DIALOGUE_SECONDS
    })
    .map((item) => {
      const track = trackById.get(item.trackId)
      const overlap = Math.min(end, item.startTime + item.duration) - Math.max(start, item.startTime)
      return {
        clipId: item.id,
        name: item.name || item.id,
        trackName: track?.name || '',
        isDialogueTrack: track?.mixRole === 'dialogue',
        isLinked: Boolean(clip.linkGroupId && item.linkGroupId === clip.linkGroupId),
        overlapSeconds: overlap,
      }
    })
    .sort((a, b) => (Number(b.isDialogueTrack) - Number(a.isDialogueTrack))
      || (Number(a.isLinked) - Number(b.isLinked))
      || (b.overlapSeconds - a.overlapSeconds))
}

/**
 * @returns {{ ok: false, reason: string } | {
 *   ok: true, clipId: string, audioClipId: string,
 *   video: { assetId: string, startSeconds: number, durationSeconds: number },
 *   audio: { assetId: string, startSeconds: number, durationSeconds: number, leadingSilenceSeconds: number, totalSeconds: number },
 *   sourceInSeconds: number, segmentSeconds: number, estimatedUsd: number,
 * }}
 */
export function planLipSync({ clips = [], tracks = [], transitions = [], getAsset = () => null, clipId, audioClipId } = {}) {
  const matches = clips.filter((item) => item?.id === clipId)
  const clip = matches[0]
  if (matches.length !== 1) return fail('Select one video clip to lip-sync.')
  const track = tracks.find((item) => item?.id === clip.trackId)
  if (clip.type !== 'video' || track?.type !== 'video') return fail('Lip-sync works on video clips on a video track.')
  if (locked(clip) || locked(track)) return fail('Unlock the clip and its track first.')
  const clipReason = realtimeReason(clip, 'clip')
  if (clipReason) return fail(clipReason)
  const asset = getAsset(clip.assetId)
  if (asset?.type !== 'video') return fail('The clip’s source video is not available.')
  const sourceDuration = Number(asset.duration ?? clip.sourceDuration)
  if (!finite(sourceDuration) || sourceDuration <= 0) return fail('Wait for the source video’s duration to load.')
  if (!finite(clip.startTime) || !finite(clip.duration) || clip.duration <= 0) return fail('The clip has invalid timing.')

  const trimStart = clip.trimStart ?? 0
  const extent = getSmartReplaceTransitionExtent(clip, clips, transitions)
  if (!extent.ok) return fail(extent.reason)
  const needStart = trimStart + (extent.start - clip.startTime)
  const needEnd = trimStart + (extent.end - clip.startTime)
  const trimEnd = trimStart + clip.duration
  if (needStart < -1e-3 || needEnd > sourceDuration + 1e-3) return fail('The clip uses source media beyond the video file. Relink it first.')
  // A little extra media on both sides where the file has it: re-encoded and
  // cloud-returned video can land a frame short, and Smart Replace (rightly)
  // refuses a replacement that does not cover the edit.
  const segStart = Math.max(0, needStart - SEGMENT_MARGIN_SECONDS)
  const segEnd = Math.min(sourceDuration, needEnd + SEGMENT_MARGIN_SECONDS)
  if (segStart > trimStart + EPS || segEnd < trimEnd - 1e-3) return fail('The clip uses source media beyond the video file. Relink it first.')
  const segmentSeconds = segEnd - segStart
  if (segmentSeconds > LIPSYNC_MAX_SECONDS) return fail('sync.so takes up to 10 minutes per job. Split the clip first.')

  const audioClip = clips.find((item) => item?.id === audioClipId)
  const audioTrack = audioClip ? tracks.find((item) => item?.id === audioClip.trackId) : null
  if (!audioClip || audioTrack?.type !== 'audio') return fail('Choose a dialogue clip on an audio track.')
  const audioReason = realtimeReason(audioClip, 'dialogue clip')
  if (audioReason) return fail(audioReason)
  const audioAsset = getAsset(audioClip.assetId)
  if (!audioAsset || !['audio', 'video'].includes(audioAsset.type)) return fail('The dialogue clip’s source is not available.')

  // Timeline window that the video segment covers.
  const windowStart = clip.startTime + (segStart - trimStart)
  const windowEnd = windowStart + segmentSeconds
  const overlapStart = Math.max(windowStart, audioClip.startTime)
  const overlapEnd = Math.min(windowEnd, audioClip.startTime + audioClip.duration)
  if (overlapEnd - overlapStart < MIN_DIALOGUE_SECONDS) return fail('The dialogue clip does not overlap this video clip.')

  return {
    ok: true,
    clipId: clip.id,
    audioClipId: audioClip.id,
    video: { assetId: asset.id, startSeconds: segStart, durationSeconds: segmentSeconds },
    audio: {
      assetId: audioAsset.id,
      startSeconds: (audioClip.trimStart ?? 0) + (overlapStart - audioClip.startTime),
      durationSeconds: overlapEnd - overlapStart,
      leadingSilenceSeconds: overlapStart - windowStart,
      totalSeconds: segmentSeconds,
    },
    sourceInSeconds: trimStart - segStart,
    segmentSeconds,
    estimatedUsd: Math.round(segmentSeconds * SYNC_SO_USD_PER_SECOND * 100) / 100,
  }
}
