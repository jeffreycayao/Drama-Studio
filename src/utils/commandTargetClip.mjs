// Which clip quick actions, the clip's AI button and the command palette act
// on: the one selected clip, or the video side of a selected linked
// video/audio pair (the Inspector shows that pair as one clip too).
export function getCommandTargetClip({ clips = [], tracks = [], selectedClipIds = [] } = {}) {
  const selected = selectedClipIds.map((id) => clips.find((clip) => clip.id === id)).filter(Boolean)
  if (selected.length === 1) return selected[0]
  if (selected.length !== 2) return null
  const [first, second] = selected
  const group = String(first.linkGroupId || '').trim()
  if (!group || group !== String(second.linkGroupId || '').trim()) return null
  const typeOf = (clip) => tracks.find((track) => track.id === clip.trackId)?.type
  if (typeOf(first) === 'video' && typeOf(second) === 'audio') return first
  if (typeOf(second) === 'video' && typeOf(first) === 'audio') return second
  return null
}
