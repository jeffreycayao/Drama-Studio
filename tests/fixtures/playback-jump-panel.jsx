// Real PreviewPanel owns the sole transport hook, live/cached selection and
// AudioLayerRenderer. This fixture has no production preload, export or disk IO.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import PreviewPanel from '../../src/components/PreviewPanel'
import Timeline from '../../src/components/Timeline'
import TransportControls from '../../src/components/TransportControls'
import { I18nProvider } from '../../src/i18n/I18nContext'
import useTimelineStore from '../../src/stores/timelineStore'
import useAssetsStore from '../../src/stores/assetsStore'
import useProjectStore from '../../src/stores/projectStore'
import { getPreviewFrameSnapshot } from '../../src/services/previewFrameTap'
import { watchStoreForProjectChanges, TIMELINE_PROJECT_KEYS, markProjectClean, isProjectDirty } from '../../src/services/projectDirtyTracker'

const root = '/__playback_jump_panel_memory__'
const cacheUrls = new Map(), bridgeCalls = [], sources = []
const validate = path => {
  if (typeof path !== 'string' || !path.startsWith(`${root}/`)) throw new Error(`Non-memory path refused: ${path}`)
  return path
}
const rangeKey = path => path.match(/\/cache\/preview_chunk_v2_.+_(\d+)_(\d+)\.mp4$/)?.slice(1).join('_')
const forbid = (...args) => { bridgeCalls.push(['FORBIDDEN WRITE', ...args]); throw new Error('Fixture refuses export/filesystem writes') }
window.electronAPI = {
  isElectron: true,
  pathJoin: async (...parts) => validate(parts.join('/').replace(/\/+/g, '/')),
  exists: async path => { validate(path); bridgeCalls.push(['exists', path]); return cacheUrls.has(rangeKey(path)) },
  getFileUrlDirect: async path => {
    validate(path); bridgeCalls.push(['url', path])
    const url = cacheUrls.get(rangeKey(path))
    if (!url) throw new Error(`No in-memory cache for ${path}`)
    return url
  },
  createDirectory: forbid, writeFile: forbid, startFramePipe: forbid, mixAudio: forbid,
  exportVideo: forbid, copyFile: forbid, deleteFile: forbid,
}
localStorage.setItem('previewShowInfoOverlay', 'true')
const blobUrl = base64 => URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], { type: 'video/mp4' }))
const track = { id: 'picture', name: 'Picture', type: 'video', locked: false, muted: false, visible: true, volume: 100, pan: 0 }
function reset({ start = 1 } = {}) {
  useAssetsStore.setState({ assets: sources, folders: [], selectedAssetIds: [], currentPreview: null,
    previewMode: 'timeline', isPlaying: false, volume: 0, videoRef: null })
  useTimelineStore.setState(state => ({ timelineSessionId: state.timelineSessionId + 1,
    compoundEditContext: null, clips: [{ id: 'moving-picture', assetId: 'source', name: 'Synthetic moving picture', type: 'video',
      trackId: track.id, url: sources[0]?.url, enabled: true, startTime: 0, duration: 12,
      trimStart: 0, trimEnd: 12, sourceDuration: 12, sourceFps: 24, timelineFps: 24,
      sourceTimeScale: 1, speed: 1, reverse: false, frameSampling: 'frame', effects: [], keyframes: {},
      transform: { positionX: 0, positionY: 0, scaleX: 100, scaleY: 100, rotation: 0, opacity: 100 } }],
    tracks: [track], transitions: [], markers: [], selectedClipIds: [], selectedTransitionId: null,
    selectedMarkerId: null, selectedGap: null, activeTrackId: track.id, duration: 12, timelineFps: 24,
    history: [], historyIndex: -1, historyLastChangedAt: 0, playheadPosition: start,
    playheadSeekIntent: null, playbackJump: null, playbackJumpError: null, isPlaying: false,
    playbackRate: 1, shuttleMode: false, loopMode: 'normal', followPlayhead: false,
    inPoint: 2, outPoint: 4, rangeRenderState: null, zoom: 350, snappingEnabled: false,
    useProxyPlaybackForAssets: false, glslPreviewQuality: 'full', previewCompositorMode: 'auto',
  }))
  markProjectClean()
}
async function initializeMedia(media) {
  const url = blobUrl(media.source)
  sources.splice(0, sources.length, { id: 'source', name: 'Synthetic 12 second picture', type: 'video', url,
    duration: 12, fps: 24, hasAudio: false, settings: { width: 640, height: 360, duration: 12, fps: 24 } })
  cacheUrls.set('48_96', blobUrl(media.first))
  cacheUrls.set('144_192', blobUrl(media.second))
  cacheUrls.set('240_288', `${location.origin}/__panel_delayed_missing__.mp4`)
  reset()
}
useProjectStore.setState({ currentProject: { name: 'Isolated cached playback smoke',
  settings: { width: 640, height: 360, fps: 24 }, timelines: [{ id: 'panel', name: 'Panel smoke', width: 640, height: 360, fps: 24 }] },
  currentTimelineId: 'panel', currentProjectHandle: root })
watchStoreForProjectChanges(useTimelineStore, TIMELINE_PROJECT_KEYS)
reset()
window.panelTest = { timeline: useTimelineStore, assets: useAssetsStore, project: useProjectStore,
  initializeMedia, reset, getPreviewFrameSnapshot, cacheUrls, bridgeCalls, isProjectDirty, markProjectClean }
function Harness() {
  return <div className="h-screen flex flex-col bg-sf-dark-950 text-sf-text-primary">
    <div className="px-4 py-2 text-xs text-sf-text-muted">Velorn · isolated cached/live playback handoff · synthetic media only</div>
    <div data-testid="actual-preview-panel" className="flex-1 min-h-0"><PreviewPanel /></div>
    <div data-testid="actual-transport-controls"><TransportControls /></div>
    <div className="h-[310px] shrink-0"><Timeline /></div>
  </div>
}
createRoot(document.getElementById('root')).render(<I18nProvider><Harness /></I18nProvider>)
