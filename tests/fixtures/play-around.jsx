// Real PreviewPanel owns the sole transport clock and Canvas/Audio renderers.
// All media and cache lookups are synthetic/in-memory. No production preload,
// main process, MCP connection, user project, export or filesystem writes.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import '../../src/index.css'
import PreviewPanel from '../../src/components/PreviewPanel'
import Timeline from '../../src/components/Timeline'
import TransportControls from '../../src/components/TransportControls'
import { I18nProvider } from '../../src/i18n/I18nContext'
import useTimelineStore from '../../src/stores/timelineStore'
import useAssetsStore from '../../src/stores/assetsStore'
import useProjectStore from '../../src/stores/projectStore'
import { getPreviewFrameSnapshot } from '../../src/services/previewFrameTap'
import { setEditorHotkeys, DEFAULT_EDITOR_HOTKEYS, EDITOR_HOTKEY_IDS } from '../../src/services/editorHotkeys'
import { watchStoreForProjectChanges, TIMELINE_PROJECT_KEYS, markProjectClean, isProjectDirty } from '../../src/services/projectDirtyTracker'

const memoryRoot = '/__play_around_memory__'
localStorage.setItem('previewShowInfoOverlay', 'true')
const cacheUrls = new Map(), bridgeCalls = [], sources = []
const validate = path => {
  if (typeof path !== 'string' || !path.startsWith(`${memoryRoot}/`)) throw new Error(`Non-memory path refused: ${path}`)
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
  // Electron 28's decodeAudioData waveform fallback can crash on PCM WAVs.
  // Only peak extraction is stubbed; real HTML audio/Web Audio still runs.
  getAudioWaveform: async (path, { sampleCount }) => {
    if (path !== '/__synthetic__/play-around-tone.wav') throw new Error('Unexpected waveform source')
    return { success: true, duration: 8, peaks: Array.from({ length: sampleCount }, () => 0.08) }
  },
  createDirectory: forbid, writeFile: forbid, startFramePipe: forbid, mixAudio: forbid,
  exportVideo: forbid, copyFile: forbid, deleteFile: forbid,
}
const blobUrl = base64 => URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], { type: 'video/mp4' }))
const track = (id, type = 'video') => ({ id, name: id, type, locked: false, muted: false, visible: true, volume: 100, pan: 0, inserts: [] })
const getAsset = id => sources.find(asset => asset.id === id)
const makeClip = (id, patch = {}) => ({ id, assetId: 'red', name: id, type: 'video', trackId: 'picture',
  url: getAsset('red')?.url, enabled: true, startTime: 0, duration: 4, trimStart: 1, trimEnd: 5,
  sourceDuration: 8, sourceFps: 24, timelineFps: 24, sourceTimeScale: 1, speed: 1,
  reverse: false, frameSampling: 'frame', effects: [], keyframes: {},
  transform: { positionX: 0, positionY: 0, scaleX: 100, scaleY: 100, rotation: 0, opacity: 100 }, ...patch })
function toneWav() {
  const rate = 8000, frames = rate * 8, bytes = new ArrayBuffer(44 + frames * 2), view = new DataView(bytes)
  const text = (offset, value) => [...value].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, frames * 2, true)
  for (let index = 0; index < frames; index++) view.setInt16(44 + index * 2, Math.round(Math.sin(2 * Math.PI * 440 * index / rate) * 0.08 * 32767), true)
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
}
function reset(patch = {}) {
  useAssetsStore.setState({ assets: sources, folders: [], selectedAssetIds: [], currentPreview: null,
    previewMode: 'timeline', isPlaying: false, volume: 0, videoRef: null, mediaPreparation: null })
  useTimelineStore.setState(state => ({ timelineSessionId: state.timelineSessionId + 1,
    compoundEditContext: null, compoundNavigationRevision: 0, compoundNavigationChangedDocument: false,
    clips: [makeClip('first'), makeClip('second', { assetId: 'blue', url: getAsset('blue')?.url, startTime: 4 }),
      makeClip('sound', { assetId: 'tone', type: 'audio', trackId: 'sound', url: getAsset('tone')?.url,
        duration: 8, trimStart: 0, trimEnd: 8, gainDb: 0, fadeIn: 0, fadeOut: 0 })],
    tracks: [track('picture'), track('sound', 'audio')], transitions: [],
    markers: [{ id: 'marker-1', time: 3.25, name: 'Preserved marker' }],
    selectedClipIds: ['second'], selectedTransitionId: null, selectedMarkerId: null, selectedGap: null,
    activeTrackId: 'picture', duration: 8, timelineFps: 24,
    history: [{ fixtureSentinel: 'must survive transport' }], historyIndex: -1, historyLastChangedAt: 19,
    playheadPosition: 3, playheadSeekIntent: null, playbackJump: null, playbackJumpError: null,
    playAround: null, isPlaying: false,
    playbackRate: 1, shuttleMode: false, loopMode: 'normal', followPlayhead: false,
    inPoint: 1.25, outPoint: 1.75, rangeRenderState: null, zoom: 400, snappingEnabled: false,
    masterAudioVolume: 100, masterAudioInserts: [], useProxyPlaybackForAssets: false,
    glslPreviewQuality: 'full', previewCompositorMode: 'auto', ...patch,
  }))
  markProjectClean()
}
async function initializeMedia(media) {
  sources.splice(0, sources.length, ...['red', 'blue'].map(id => ({ id, name: `${id} synthetic`, type: 'video',
    url: blobUrl(media[id]), duration: 8, fps: 24, hasAudio: false,
    settings: { width: 640, height: 360, duration: 8, fps: 24 } })), {
    id: 'tone', name: 'Synthetic tone', type: 'audio', url: toneWav(), duration: 8, hasAudio: true,
    absolutePath: '/__synthetic__/play-around-tone.wav', settings: { duration: 8, sampleRate: 8000 },
  })
  cacheUrls.set('48_96', blobUrl(media.cachedRed))
  cacheUrls.set('96_144', blobUrl(media.cachedBlue))
  reset()
}
function snapshot() {
  const state = useTimelineStore.getState(), frame = getPreviewFrameSnapshot()
  const panel = document.querySelector('[data-testid="actual-preview-panel"]')
  const video = panel?.querySelector('video[data-preview-popout-source="video"]')
  const source = video || frame?.canvas
  const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 54
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (source && (source.videoWidth || source.width)) context.drawImage(source, 0, 0, 96, 54)
  const pixels = [...context.getImageData(0, 0, 96, 54).data]
  let hash = 2166136261, light = 0
  for (let i = 0; i < pixels.length; i += 4) {
    light += pixels[i] + pixels[i + 1] + pixels[i + 2]
    hash = Math.imul(hash ^ pixels[i] ^ pixels[i + 1] << 8 ^ pixels[i + 2] << 16, 16777619) >>> 0
  }
  return { at: performance.now(), playing: state.isPlaying, time: state.playheadPosition,
    previewMode: useAssetsStore.getState().previewMode,
    session: state.playAround, jump: state.playbackJump, error: state.playbackJumpError,
    cached: Boolean(video), source: video?.src, frameTime: frame?.time,
    hash, light: light / (96 * 54 * 3), pixels,
    project: JSON.stringify(state.getProjectData()), history: JSON.stringify(state.history),
    historyIndex: state.historyIndex, historyLastChangedAt: state.historyLastChangedAt,
    inPoint: state.inPoint, outPoint: state.outPoint, selectedClipIds: state.selectedClipIds,
    selectedTransitionId: state.selectedTransitionId, selectedMarkerId: state.selectedMarkerId,
    selectedGap: state.selectedGap, activeTrackId: state.activeTrackId,
    loopMode: state.loopMode, playbackRate: state.playbackRate, shuttleMode: state.shuttleMode,
    dirty: isProjectDirty(),
  }
}
useProjectStore.setState({ currentProject: { name: 'Isolated Play Around verification',
  settings: { width: 640, height: 360, fps: 24 }, timelines: [{ id: 'play-around', name: 'Play Around verification', width: 640, height: 360, fps: 24 }] },
  currentTimelineId: 'play-around', currentProjectHandle: memoryRoot })
watchStoreForProjectChanges(useTimelineStore, TIMELINE_PROJECT_KEYS)
reset()
window.playAroundTest = { timeline: useTimelineStore, assets: useAssetsStore, project: useProjectStore,
  initializeMedia, reset, getAsset, makeClip, track, getPreviewFrameSnapshot, snapshot, cacheUrls,
  bridgeCalls, isProjectDirty, markProjectClean,
  setPlayAroundHotkey: binding => setEditorHotkeys({ ...DEFAULT_EDITOR_HOTKEYS, [EDITOR_HOTKEY_IDS.PLAY_AROUND]: binding }) }
function Harness() {
  const [timelineVisible, setTimelineVisible] = React.useState(true)
  const [previewVisible, setPreviewVisible] = React.useState(true)
  window.playAroundTest.setTimelineVisible = visible => flushSync(() => setTimelineVisible(visible))
  window.playAroundTest.setPreviewVisible = visible => flushSync(() => setPreviewVisible(visible))
  return <div className="h-screen flex flex-col bg-sf-dark-950 text-sf-text-primary">
    <div className="px-4 py-2 text-xs text-sf-text-muted">Velorn · Play Around verification · synthetic media only</div>
    <div data-testid="actual-preview-panel" className="flex-1 min-h-0">{previewVisible && <PreviewPanel />}</div>
    <div data-testid="actual-transport-controls"><TransportControls /></div>
    <div className="h-[310px] shrink-0">{timelineVisible && <Timeline />}</div>
  </div>
}
createRoot(document.getElementById('root')).render(<I18nProvider><Harness /></I18nProvider>)
