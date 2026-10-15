// Isolated synthetic sources only. The runner injects generated MP4 buffers;
// no media files, production main/preload or real projects are opened.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import InspectorPanel from '../../src/components/InspectorPanel'
import Timeline from '../../src/components/Timeline'
import CanvasPreviewRenderer from '../../src/components/CanvasPreviewRenderer'
import VideoLayerRenderer from '../../src/components/VideoLayerRenderer'
import { getSmartReplaceEligibility } from '../../src/components/SmartReplaceDialog'
import { normalizeAdjustmentSettings } from '../../src/utils/adjustments'
import useTimelineStore from '../../src/stores/timelineStore'
import useAssetsStore from '../../src/stores/assetsStore'
import useProjectStore from '../../src/stores/projectStore'
import { I18nProvider } from '../../src/i18n/I18nContext'
import { getPreviewFrameSnapshot } from '../../src/services/previewFrameTap'
import { computePreviewSignature } from '../../src/services/previewCache'
import { exportTimeline } from '../../src/services/exporter'
import { watchStoreForProjectChanges, TIMELINE_PROJECT_KEYS, markProjectClean, isProjectDirty } from '../../src/services/projectDirtyTracker'

let sources = []
const nativeWaveformStub = new URLSearchParams(window.location.search).has('nativeWaveformStub')
let nativeWaveformCalls = 0
if (nativeWaveformStub) window.electronAPI = {
  isElectron: true,
  // Existing installed Electron decodeAudioData crashes on valid PCM WAVs;
  // the audio-only route uses known peaks in place of main-process FFmpeg.
  getAudioWaveform: async (path, { sampleCount }) => {
    if (!/^\/__synthetic__\/replace-audio-/.test(path)) throw new Error('Unexpected waveform source')
    nativeWaveformCalls++
    return { success: true, peaks: Array.from({ length: sampleCount }, () => 0.1), duration: 10 }
  },
}
const track = (id, name, type = 'video', locked = false) => ({ id, name, type, locked, muted: false, visible: true, volume: 100, channels: 'stereo' })
const getAsset = id => sources.find(asset => asset.id === id)
const makeClip = (id = 'replace-target', patch = {}) => ({
  id, name: id === 'replace-target' ? 'Edited red instance' : id, type: 'video', trackId: 'video-1',
  assetId: 'red', url: getAsset('red')?.url || null,
  startTime: 2, duration: 3, trimStart: 1, trimEnd: 4, sourceDuration: 8, sourceFps: 24,
  timelineFps: 24, sourceTimeScale: 1, speed: 1, reverse: false, frameSampling: 'frame', enabled: true,
  transform: { positionX: 0, positionY: 0, scaleX: 60, scaleY: 70, scaleLinked: false, rotation: 0, opacity: 90 },
  adjustments: normalizeAdjustmentSettings({ brightness: 3, contrast: 2, saturation: -5 }),
  effects: [{ id: 'keep-blur', type: 'gaussianBlur', enabled: true, settings: { amount: 0.2 } }],
  keyframes: { positionX: [{ time: 0, value: 0, easing: 'linear' }, { time: 3, value: 180, easing: 'linear' }],
    opacity: [{ time: 0, value: 90 }, { time: 3, value: 90 }] },
  gainDb: -3, fadeIn: 0.2, fadeOut: 0.3,
  audioEq: { version: 1, enabled: false, lowCut: true, bassDb: 4, midDb: -3, trebleDb: 2 },
  volumeEnvelope: { version: 1, offsetSeconds: 0.25, points: [{ id: 'env-start', time: 0, db: -2 }, { id: 'env-end', time: 3, db: -9 }] },
  linkGroupId: 'replace-linked', customMetadata: { keep: 'instance-only', nested: { value: 7 } },
  ...patch,
})
function reset(patch = {}) {
  useAssetsStore.setState({ assets: sources, folders: [], selectedAssetIds: [], currentPreview: null,
    previewMode: 'timeline', isPlaying: false, volume: 0, videoRef: null })
  useTimelineStore.setState(state => ({
    timelineSessionId: (Number(state.timelineSessionId) || 0) + 1,
    clips: [makeClip(), makeClip('same-source-instance', { startTime: 8, linkGroupId: null }),
      makeClip('linked-audio', { type: 'audio', trackId: 'audio-1', assetId: 'silent-partner', url: null,
        metadata: { linkedVideoClipId: 'replace-target' } }),
      makeClip('locked-target', { trackId: 'video-locked', startTime: 12, linkGroupId: null })],
    tracks: [track('video-1', 'Video 1'), track('video-locked', 'Locked picture', 'video', true), track('audio-1', 'Linked sound', 'audio')],
    selectedClipIds: ['replace-target'], activeTrackId: 'video-1', selectedTransitionId: null, selectedMarkerId: null, selectedGap: null,
    history: [], historyIndex: -1, historyLastChangedAt: 0, playheadPosition: 2.5, timelineFps: 24, duration: 18, zoom: 250,
    clipCounter: 100, markerCounter: 2, transitionCounter: 1,
    markers: [{ id: 'marker-1', time: 3.25, name: 'Keep this marker' }], transitions: [], inPoint: 2.25, outPoint: 4.75,
    snappingEnabled: false, rippleEditMode: false, activeSnapTime: null, isPlaying: false, playbackRate: 1, shuttleMode: false,
    copiedClips: [], attributeClipboard: null, ...patch,
  }))
  markProjectClean()
}
const blobUrl = (base64, type) => URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), letter => letter.charCodeAt(0))], { type }))
async function probe(url) {
  const video = document.createElement('video')
  video.muted = true; video.preload = 'metadata'
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Synthetic video metadata timed out')), 8000)
      video.onloadedmetadata = () => { clearTimeout(timer); resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight }) }
      video.onerror = () => { clearTimeout(timer); reject(new Error('Synthetic video metadata failed')) }
      video.src = url; video.load()
    })
  } finally { video.removeAttribute('src'); video.load() }
}
function silentWav() {
  const rate = 8000, frames = rate * 10, buffer = new ArrayBuffer(44 + frames * 2), view = new DataView(buffer)
  const text = (at, value) => [...value].forEach((letter, index) => view.setUint8(at + index, letter.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, frames * 2, true)
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
}
async function initializeMedia(media) {
  const videos = await Promise.all(Object.entries(media).map(async ([id, encoded]) => {
    const url = blobUrl(encoded.base64, 'video/mp4'), metadata = await probe(url)
    return { id, name: { red: 'Red original', blue: 'Blue replacement', short: 'Short replacement' }[id], type: 'video', url,
      path: `media/${id}.mp4`, duration: metadata.duration, hasAudio: false,
      settings: { ...metadata, fps: encoded.fps, hasAudio: false } }
  }))
  const image = color => {
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 54
    const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 96, 54)
    return canvas.toDataURL('image/png')
  }
  sources = [...videos,
    { id: 'unknown', name: 'Unknown duration', type: 'video', url: getAsset('blue')?.url || videos.find(a => a.id === 'blue').url, path: 'media/unknown.mp4', settings: { fps: 24 } },
    { id: 'offline', name: 'Offline candidate', type: 'video', url: null, path: null, duration: 10, settings: { duration: 10, fps: 24 } },
    { id: 'image-red', name: 'Red still', type: 'image', url: image('#dd1818'), path: 'media/red.png', settings: { width: 96, height: 54 } },
    { id: 'image-blue', name: 'Blue still', type: 'image', url: image('#1820dd'), path: 'media/blue.png', settings: { width: 96, height: 54 } },
    ...['a', 'b'].map(id => ({ id: `audio-${id}`, name: `Audio ${id}`, type: 'audio', url: silentWav(), duration: 10,
      path: `media/audio-${id}.wav`, absolutePath: nativeWaveformStub ? `/__synthetic__/replace-audio-${id}.wav` : null, hasAudio: true, settings: { duration: 10, sampleRate: 8000 } })),
    { id: 'silent-partner', name: 'Unchanged linked sound', type: 'audio', url: null, path: null, duration: 8, settings: { duration: 8 } },
  ]
  reset()
  return videos.map(({ id, duration, settings }) => ({ id, duration, settings }))
}

// Runs the actual export compositor, but every native destination operation
// is an in-memory stand-in. No filesystem API or production main is callable.
async function exportFrameInMemory(time) {
  const previousApi = window.electronAPI, previousHandle = useProjectStore.getState().currentProjectHandle
  const flags = ['comfystudio-export-webcodecs', 'comfystudio-export-gpu']
  const previousFlags = flags.map(key => localStorage.getItem(key))
  const root = '/__smart_replace_memory__', frames = [], reads = [], calls = []
  let size = null
  const validate = path => { if (typeof path !== 'string' || !path.startsWith(`${root}/`)) throw new Error(`Non-memory export path refused: ${path}`); return path }
  window.electronAPI = {
    isElectron: true,
    pathJoin: async (...parts) => validate(parts.join('/').replace(/\/+/g, '/')),
    createDirectory: async path => { calls.push(['mkdir', validate(path)]); return { success: true } },
    deleteDirectory: async path => { calls.push(['rmdir', validate(path)]); return { success: true } },
    getFileUrlDirect: async path => {
      validate(path); reads.push(path)
      const asset = useAssetsStore.getState().assets.find(item => item.path && path === `${root}/${item.path}`)
      if (!asset?.url) throw new Error(`Unknown in-memory source: ${path}`)
      return asset.url
    },
    startFramePipe: async options => { validate(options.outputPath); size = { width: options.width, height: options.height }; return { success: true, sessionId: 'memory-only', encoderUsed: 'memory-test-only' } },
    writeFrameToPipe: async (session, data) => {
      if (session !== 'memory-only') throw new Error('Unknown memory frame session')
      frames.push(Uint8Array.from(new Uint8Array(data)))
      return { success: true }
    },
    finishFramePipe: async () => ({ success: true, encoderUsed: 'memory-test-only' }),
    abortFramePipe: async () => ({ success: true }),
  }
  useProjectStore.setState({ currentProjectHandle: root })
  flags.forEach(key => localStorage.setItem(key, '0'))
  try {
    const result = await exportTimeline({ width: 96, height: 54, fps: 24, rangeStart: time, rangeEnd: time + 0.04,
      format: 'mp4', outputPath: `${root}/output.mp4`, includeAudio: false, useCachedRenders: true,
      useProxyMedia: false, fastSeek: false, sampleAtFrameCenter: false, sourceTimelineWidth: 960, sourceTimelineHeight: 540,
      soloClipIds: ['replace-target'] })
    return { result, reads, calls, size, frames: frames.map(data => {
      let left = size.width, right = -1, count = 0, sumX = 0
      for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
        const at = (y * size.width + x) * 4, rgb = [data[at], data[at + 1], data[at + 2]]
        if (Math.max(...rgb) > 50 && Math.max(...rgb) - Math.min(...rgb) > 35) { left = Math.min(left, x); right = Math.max(right, x); sumX += x; count++ }
      }
      const center = (Math.floor(size.height / 2) * size.width + Math.floor(size.width / 2)) * 4
      return { center: [...data.slice(center, center + 4)], left, right, count, centroidX: count ? sumX / count : null }
    }) }
  } finally {
    window.electronAPI = previousApi
    useProjectStore.setState({ currentProjectHandle: previousHandle })
    flags.forEach((key, index) => previousFlags[index] === null ? localStorage.removeItem(key) : localStorage.setItem(key, previousFlags[index]))
  }
}
useProjectStore.setState({ currentProject: { name: 'Synthetic Smart Replace verification', settings: { fps: 24, width: 960, height: 540 }, timelines: [] }, currentProjectHandle: null, currentTimelineId: null })
watchStoreForProjectChanges(useTimelineStore, TIMELINE_PROJECT_KEYS)
reset()
window.smartReplaceTest = { timeline: useTimelineStore, assets: useAssetsStore, project: useProjectStore,
  reset, initializeMedia, getAsset, makeClip, track, markProjectClean, isProjectDirty, getPreviewFrameSnapshot,
  computePreviewSignature, exportFrameInMemory, getSmartReplaceEligibility, getNativeWaveformCalls: () => nativeWaveformCalls }
function Harness() {
  const [legacyVisible, setLegacyVisible] = React.useState(false)
  React.useEffect(() => {
    window.smartReplaceTest.setLegacyVisible = setLegacyVisible
    return () => { delete window.smartReplaceTest.setLegacyVisible }
  }, [])
  return <div className="h-screen flex flex-col bg-sf-dark-950 text-sf-text-primary">
    {legacyVisible && <div data-testid="replace-legacy-renderer" className="pointer-events-none fixed left-0 top-0 h-20 w-32 opacity-0">
      <VideoLayerRenderer buildVideoTransform={() => ({})} getClipTransform={clip => clip.transform || {}} transitionInfo={null} />
    </div>}
    <div className="flex flex-1 min-h-0">
      <main className="flex flex-1 min-w-0 flex-col justify-center gap-3 p-5">
        <h1 className="text-sm">Smart Replace · isolated decoded-source verification</h1>
        <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}><CanvasPreviewRenderer timelineWidth={960} timelineHeight={540} timelineFps={24} /></div>
        <p className="text-xs text-sf-text-muted">Generated red/blue media. No user project or production main process.</p>
      </main>
      <div data-testid="replace-fixture-inspector" style={{ width: 350, display: 'flex' }}><InspectorPanel isExpanded onToggleExpanded={() => {}} onToggleFullHeight={() => {}} /></div>
    </div>
    <div className="h-[390px] shrink-0"><Timeline /></div>
  </div>
}
createRoot(document.getElementById('root')).render(<I18nProvider><Harness /></I18nProvider>)
