import useTimelineStore from '../stores/timelineStore'
import useAssetsStore from '../stores/assetsStore'
import useProjectStore from '../stores/projectStore'

/**
 * What commands can act on right now: the single selected clip (with its
 * track and asset), whether the timeline has captions, and whether a
 * project is open.
 */
export function getCommandContext() {
  const { clips = [], tracks = [], selectedClipIds = [] } = useTimelineStore.getState()
  const clip = selectedClipIds.length === 1 ? clips.find((item) => item.id === selectedClipIds[0]) || null : null
  const track = clip ? tracks.find((item) => item.id === clip.trackId) || null : null
  const asset = clip?.assetId ? useAssetsStore.getState().getAssetById?.(clip.assetId) || null : null
  const captionsClip = clips.find((item) => item.type === 'captions' && item.captions?.cues?.length) || null
  return {
    clip,
    track,
    asset,
    clipType: clip?.type || null,
    selectionCount: selectedClipIds.length,
    captionsClip,
    hasProject: Boolean(useProjectStore.getState().currentProject),
  }
}

/** Quick-action targeting: does a command apply to the selected clip? */
export function commandAppliesToClip(command, context) {
  if (!Array.isArray(command?.clipTypes) || !context?.clip) return false
  return command.clipTypes.includes(context.clipType)
}
