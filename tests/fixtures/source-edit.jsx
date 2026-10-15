// Isolated real controls/store fixture. No project folders, preload bridge,
// production main process, downloads, media decoding, or native file writes.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import PreviewSourceControls from '../../src/components/PreviewSourceControls'
import Timeline from '../../src/components/Timeline'
import useTimelineStore from '../../src/stores/timelineStore'
import useAssetsStore from '../../src/stores/assetsStore'
import useProjectStore from '../../src/stores/projectStore'
import { I18nProvider } from '../../src/i18n/I18nContext'
import { watchStoreForProjectChanges, TIMELINE_PROJECT_KEYS, markProjectClean, isProjectDirty } from '../../src/services/projectDirtyTracker'

const sourceAsset = {
  id: 'fixture-source', name: 'Synthetic source', type: 'video', duration: 10,
  url: URL.createObjectURL(new Blob([], { type: 'video/mp4' })),
  hasAudio: true, audioEnabled: true, settings: { fps: 20, width: 960, height: 540, duration: 10 },
}
const track = (id, name, type, order) => ({ id, name, type, order, visible: true, locked: false, muted: false, volume: 1 })
const makeClip = (id, trackId, startTime, duration, patch = {}) => ({
  id, name: id, trackId, assetId: sourceAsset.id,
  type: trackId.startsWith('audio') ? 'audio' : 'video',
  startTime, duration, trimStart: 0, trimEnd: duration, sourceDuration: 10,
  sourceFps: 20, timelineFps: 10, sourceTimeScale: 1, speed: 1, reverse: false,
  frameSampling: 'frame', effects: [], keyframes: {}, enabled: true,
  transform: { positionX: 0, positionY: 0, scaleX: 100, scaleY: 100, scaleLinked: true, rotation: 0, opacity: 100 },
  ...(trackId.startsWith('audio') ? { gainDb: 0, fadeIn: 0, fadeOut: 0 } : {}),
  ...patch,
})

// A real, independent HTMLVideoElement supplies deterministic source-monitor
// events and source time without codecs/RAF playback. These checks assert edit
// timing and controls, not decoded pixel or media-playback correctness.
const sourceVideo = document.createElement('video')
let sourceTime = 0
let sourcePaused = true
let sourceMetadata = { url: sourceAsset.url, duration: sourceAsset.duration, readyState: 4 }
Object.defineProperties(sourceVideo, {
  currentTime: {
    configurable: true,
    get: () => sourceTime,
    set: value => {
      sourceTime = Number(value)
      queueMicrotask(() => sourceVideo.dispatchEvent(new Event('seeked')))
    },
  },
  readyState: { configurable: true, get: () => sourceMetadata.readyState },
  currentSrc: { configurable: true, get: () => sourceMetadata.url },
  duration: { configurable: true, get: () => sourceMetadata.duration },
  paused: { configurable: true, get: () => sourcePaused },
})
sourceVideo.play = () => { sourcePaused = false; sourceVideo.dispatchEvent(new Event('play')); return Promise.resolve() }
sourceVideo.pause = () => { sourcePaused = true; sourceVideo.dispatchEvent(new Event('pause')) }

let resetVersion = 0
function reset({ assetPatch = {}, ...timelinePatch } = {}) {
  const asset = { ...sourceAsset, ...assetPatch, settings: { ...sourceAsset.settings, ...assetPatch.settings } }
  sourceTime = 0
  sourcePaused = true
  sourceMetadata = { url: asset.url, duration: asset.duration, readyState: asset.duration > 0 ? 4 : 0 }
  resetVersion += 1
  useAssetsStore.setState({
    assets: [asset], folders: [], selectedAssetIds: [], currentPreview: asset,
    previewMode: 'asset', videoRef: sourceVideo, duration: asset.duration,
    currentTime: 0, isPlaying: false, sourceSeedRequest: null,
  })
  useTimelineStore.setState(state => ({
    timelineSessionId: (Number(state.timelineSessionId) || 0) + 1,
    tracks: [track('video-1', 'Video 1', 'video', 0), track('video-2', 'Video 2', 'video', 1),
      track('audio-1', 'Audio 1', 'audio', 2), track('audio-2', 'Audio 2', 'audio', 3)],
    clips: [makeClip('main-video', 'video-1', 0, 6, { linkGroupId: 'existing-main' }),
      makeClip('main-audio', 'audio-1', 0, 6, { linkGroupId: 'existing-main' }),
      makeClip('overlay', 'video-2', 0, 6),
      makeClip('later-video', 'video-1', 8, 2, { linkGroupId: 'existing-later' }),
      makeClip('later-audio', 'audio-1', 8, 2, { linkGroupId: 'existing-later' }),
      makeClip('other-audio', 'audio-2', 9, 1)],
    markers: [{ id: 'marker-before', name: 'Before', time: 1 }, { id: 'marker-at', name: 'At cut', time: 2 },
      { id: 'marker-later', name: 'Later', time: 8 }],
    transitions: [], duration: 30, playheadPosition: 2, timelineFps: 10, zoom: 150,
    activeTrackId: 'video-1', selectedClipIds: [], selectedTransitionId: null,
    selectedMarkerId: null, selectedGap: null, activeSnapTime: null,
    history: [], historyIndex: -1, historyLastChangedAt: 0,
    clipCounter: 100, markerCounter: 10, transitionCounter: 1,
    snappingEnabled: false, rippleEditMode: false, inPoint: null, outPoint: null,
    isPlaying: false, playbackRate: 1, shuttleMode: false,
    copiedClips: [], attributeClipboard: null,
    ...timelinePatch,
  }))
  window.dispatchEvent(new Event('source-edit-fixture-reset'))
  markProjectClean()
}

useProjectStore.setState({
  currentProject: { name: 'Synthetic source edit verification', settings: { fps: 10, width: 960, height: 540 }, timelines: [] },
  currentProjectHandle: null, currentTimelineId: null,
})
watchStoreForProjectChanges(useTimelineStore, TIMELINE_PROJECT_KEYS)
reset()
window.sourceEditTest = {
  timeline: useTimelineStore, assets: useAssetsStore, project: useProjectStore,
  reset, makeClip, track, markProjectClean, isProjectDirty, sourceVideo,
  get asset() { return useAssetsStore.getState().currentPreview || sourceAsset },
  get resetVersion() { return resetVersion },
  seekSource(time) { sourceVideo.currentTime = time },
  setSourceMetadata(values = {}) { sourceMetadata = { ...sourceMetadata, ...values } },
  request(mode = 'insert', overrides = {}) {
    return { asset: this.asset, mode, inPoint: 1, outPoint: 3, sourceDuration: this.asset.duration, ...overrides }
  },
}

function Harness() {
  const asset = useAssetsStore(state => state.currentPreview)
  const mode = useAssetsStore(state => state.previewMode)
  const [version, setVersion] = React.useState(resetVersion)
  React.useEffect(() => {
    const refresh = () => setVersion(resetVersion)
    window.addEventListener('source-edit-fixture-reset', refresh)
    return () => window.removeEventListener('source-edit-fixture-reset', refresh)
  }, [])
  return <div className="h-screen flex flex-col bg-sf-dark-950 text-sf-text-primary">
    <main className="flex-1 min-h-0 flex flex-col justify-center gap-3 px-6">
      <h1 className="text-sm">Source editing · isolated verification</h1>
      <p className="text-xs text-sf-text-muted">Synthetic timing-only source. No user project or media file is loaded.</p>
      <input className="w-48 bg-sf-dark-800 p-2" aria-label="Typing guard" placeholder="I/O must not mark while typing" />
      {mode === 'asset' && <div data-testid="fixture-source-controls" className="-mx-6"><PreviewSourceControls key={version} asset={asset} /></div>}
    </main>
    <div data-testid="fixture-timeline" className="h-[430px] shrink-0"><Timeline /></div>
  </div>
}
createRoot(document.getElementById('root')).render(<I18nProvider><Harness /></I18nProvider>)
