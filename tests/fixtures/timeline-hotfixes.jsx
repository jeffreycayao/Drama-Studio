// Real Timeline and real store actions; synthetic source metadata only.
// No App shell, media URL, project folder, preview player, preload, or MCP.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import '../../src/index.css'
import Timeline from '../../src/components/Timeline'
import useTimelineStore from '../../src/stores/timelineStore'
import useProjectStore from '../../src/stores/projectStore'
import useAssetsStore from '../../src/stores/assetsStore'
import { I18nProvider } from '../../src/i18n/I18nContext'
import { DEFAULT_EDITOR_HOTKEYS, setEditorHotkeys } from '../../src/services/editorHotkeys'
import { watchStoreForProjectChanges, TIMELINE_PROJECT_KEYS, markProjectClean, isProjectDirty } from '../../src/services/projectDirtyTracker'

const tracks = [
  { id: 'v', name: 'Video', type: 'video', visible: true, locked: false, muted: false, order: 0 },
  { id: 'a1', name: 'Dialogue', type: 'audio', visible: true, locked: false, muted: false, order: 1 },
  { id: 'a2', name: 'Music', type: 'audio', visible: true, locked: false, muted: false, order: 2 },
]
const source = type => ({ id: `synthetic-${type}`, name: `Synthetic ${type}`, type, duration: 30,
  hasAudio: type === 'audio', settings: { duration: 30, fps: 24, width: 960, height: 540 } })
const clip = (id, trackId, startTime, duration, extra = {}) => ({
  id, name: id, trackId, type: trackId === 'v' ? 'video' : 'audio',
  assetId: `synthetic-${trackId === 'v' ? 'video' : 'audio'}`,
  startTime, duration, trimStart: 0, trimEnd: duration, sourceDuration: 30,
  sourceTimeScale: 1, speed: 1, enabled: true, effects: [], keyframes: {},
  transform: { positionX: 0, positionY: 0, scaleX: 100, scaleY: 100, rotation: 0, opacity: 100 },
  ...extra,
})

useProjectStore.setState({
  currentProject: { name: 'Synthetic timeline hotfix verification', settings: { fps: 24, width: 960, height: 540 }, timelines: [] },
  currentProjectHandle: null, currentTimelineId: 'synthetic-hotfixes',
})
watchStoreForProjectChanges(useTimelineStore, TIMELINE_PROJECT_KEYS)

function reset({ mode = 'split', activeTrackId = 'v', lock = null } = {}) {
  useTimelineStore.getState().clearProject()
  useAssetsStore.setState({ assets: [source('video'), source('audio')], folders: [],
    previewMode: 'timeline', currentPreview: null, selectedAssetIds: [], isPlaying: false })
  const seededTracks = tracks.map(track => ({ ...track, locked: lock === `track:${track.id}` }))
  const clips = mode === 'split'
    ? [clip('video-first', 'v', 0, 8), clip('video-second', 'v', 10, 4),
      clip('audio-first', 'a1', 0, 8), clip('audio-second', 'a1', 10, 4)]
    : [clip('video-before', 'v', 0, 2), clip('video-after', 'v', 3.125, 2),
      clip('dialogue-before', 'a1', 0, 2), clip('dialogue-after', 'a1', 3.125, 2),
      clip('music-before', 'a2', 0, 2), clip('music-after', 'a2', 4.125, 3)]
  if (mode === 'occupied') {
    clips.splice(clips.findIndex(item => item.id === 'music-before'), 2, clip('continuous-music', 'a2', 0, 8))
  }
  if (lock?.startsWith('clip:')) {
    const target = clips.find(item => item.id === lock.slice(5))
    if (target) target.locked = true
  }
  useTimelineStore.setState({ tracks: seededTracks, clips, transitions: [],
    markers: [{ id: 'keep-marker', name: 'Keep marker', time: 16 }], markerCounter: 2,
    selectedClipIds: [], selectedTransitionId: null, selectedMarkerId: null, selectedGap: null,
    activeTrackId, playheadPosition: 0, isPlaying: false, playbackRate: 1,
    timelineFps: 24, duration: 20, zoom: 250, clipCounter: 100,
    inPoint: null, outPoint: null, history: [], historyIndex: -1, historyLastChangedAt: 0,
    snappingEnabled: false, rippleEditMode: false, activeTimelineTool: 'select',
    showTimelineClipThumbnails: false, compoundEditContext: null,
  })
  markProjectClean()
}

function snapshot() {
  const state = useTimelineStore.getState()
  return JSON.parse(JSON.stringify({
    clips: state.clips, tracks: state.tracks, transitions: state.transitions, markers: state.markers,
    history: state.history, historyIndex: state.historyIndex, selectedGap: state.selectedGap,
    selectedClipIds: state.selectedClipIds, activeTrackId: state.activeTrackId,
    playheadPosition: state.playheadPosition, dirty: isProjectDirty(),
  }))
}
reset()
window.timelineHotfixTest = { timeline: useTimelineStore, project: useProjectStore, assets: useAssetsStore,
  reset, snapshot, markProjectClean, DEFAULT_EDITOR_HOTKEYS, setEditorHotkeys }

function Fixture() {
  const [version, setVersion] = React.useState(0)
  React.useEffect(() => {
    window.timelineHotfixTest.seed = async options => {
      await setEditorHotkeys(DEFAULT_EDITOR_HOTKEYS)
      flushSync(() => { reset(options); setVersion(value => value + 1) })
    }
  }, [])
  return <I18nProvider><div className="h-screen flex flex-col bg-sf-dark-950 text-sf-text-primary">
    <h1 className="p-3 text-sm shrink-0">Velorn · isolated timeline hotfix verification · RAM-only synthetic clips</h1>
    <main className="flex-1 min-h-0 flex flex-col"><Timeline key={version} /></main>
  </div></I18nProvider>
}
createRoot(document.getElementById('root')).render(<Fixture />)
