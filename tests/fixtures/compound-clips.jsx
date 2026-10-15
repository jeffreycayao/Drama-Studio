// Synthetic sources and in-memory export destinations only. No production
// main/preload, user project, downloaded media, or filesystem API is used.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import '../../src/index.css'
import InspectorPanel from '../../src/components/InspectorPanel'
import Timeline from '../../src/components/Timeline'
import CanvasPreviewRenderer from '../../src/components/CanvasPreviewRenderer'
import AudioLayerRenderer from '../../src/components/AudioLayerRenderer'
import useTimelineStore from '../../src/stores/timelineStore'
import useAssetsStore from '../../src/stores/assetsStore'
import useProjectStore from '../../src/stores/projectStore'
import { I18nProvider } from '../../src/i18n/I18nContext'
import { getCompoundRenderState, getClipPlaybackWindow } from '../../src/utils/compoundPlayback.mjs'
import { getClipPlaybackTimeAtTimeline } from '../../src/utils/clipPlaybackTiming'
import { getAnimatedTransform } from '../../src/utils/keyframes'
import { getAudioClipFadeGain } from '../../src/utils/audioClipFades'
import { getAudioVolumeEnvelopeGain } from '../../src/utils/audioVolumeEnvelope.mjs'
import { getTrackAnalyser, readAnalyserRmsDb } from '../../src/services/audioMixerGraph'
import { getPreviewFrameSnapshot } from '../../src/services/previewFrameTap'
import { getLivePreviewCapture } from '../../src/services/previewFrameBridge'
import { computePreviewSignature } from '../../src/services/previewCache'
import { exportTimeline } from '../../src/services/exporter'
import { watchStoreForProjectChanges, TIMELINE_PROJECT_KEYS, markProjectClean, isProjectDirty } from '../../src/services/projectDirtyTracker'

let sources = []
const nativeWaveformStub = new URLSearchParams(window.location.search).has('nativeWaveformStub')
let waveformCalls = 0
if (nativeWaveformStub) window.electronAPI = {
  isElectron: true,
  // Existing installed Electron's decodeAudioData fallback can crash on valid
  // PCM WAVs. Only Timeline's native waveform extractor gets known peaks;
  // HTML media playback and the real Web Audio graph remain enabled.
  getAudioWaveform: async (path, { sampleCount }) => {
    if (path !== '/__synthetic__/compound-tone.wav') throw new Error('Unexpected waveform source')
    waveformCalls++
    return { success: true, duration: 8, peaks: Array.from({ length: sampleCount }, () => 0.08) }
  },
}
const track = (id, type = 'video', patch = {}) => ({ id, name: id, type, locked: false, muted: false,
  visible: true, volume: 100, pan: 0, channels: 'stereo', inserts: [], ...patch })
const getAsset = id => sources.find(asset => asset.id === id)
const makeClip = (id = 'picture', patch = {}) => ({
  id, name: id, type: 'video', trackId: 'video-2', assetId: 'red', url: getAsset('red')?.url || null,
  startTime: 2, duration: 4, trimStart: 1, trimEnd: 5, sourceDuration: 8, sourceFps: 24,
  timelineFps: 24, sourceTimeScale: 1, speed: 1, reverse: false, frameSampling: 'frame', enabled: true,
  transform: { positionX: 0, positionY: 0, scaleX: 100, scaleY: 100, rotation: 0, opacity: 100 },
  effects: [], keyframes: {}, ...patch,
})
function reset(patch = {}) {
  useAssetsStore.setState({ assets: sources, folders: [], selectedAssetIds: [], currentPreview: null,
    previewMode: 'timeline', isPlaying: false, volume: 0, videoRef: null })
  useTimelineStore.setState(state => ({
    timelineSessionId: (Number(state.timelineSessionId) || 0) + 1,
    compoundEditContext: null, compoundNavigationRevision: 0, compoundNavigationChangedDocument: false,
    clips: [makeClip('picture', { linkGroupId: 'picture-sound' }),
      makeClip('overlay', { assetId: 'blue', url: getAsset('blue')?.url || null, trackId: 'video-1',
        startTime: 2.5, duration: 2.5, trimStart: 0.5, trimEnd: 3,
        transform: { positionX: 0, positionY: 0, scaleX: 35, scaleY: 45, rotation: 0, opacity: 80 },
        shapeMask: { shape: 'ellipse', centerX: 50, centerY: 50, width: 85, height: 85, rotation: 0, feather: 1, invert: false },
        keyframes: { positionX: [{ time: 0, value: -180, easing: 'linear' }, { time: 2.5, value: 180, easing: 'linear' }] },
        effects: [{ id: 'soften', type: 'gaussianBlur', enabled: true, settings: { amount: 0.1 } }] }),
      makeClip('sound', { type: 'audio', trackId: 'audio-1', assetId: 'tone', url: getAsset('tone')?.url || null,
        linkGroupId: 'picture-sound', metadata: { linkedVideoClipId: 'picture' },
        gainDb: -3, fadeIn: 1, fadeOut: 1,
        volumeEnvelope: { version: 1, offsetSeconds: 0.25, points: [{ id: 'one', time: 0, db: -3 }, { id: 'two', time: 4, db: -9 }] },
        audioEq: { version: 1, enabled: true, lowCut: false, bassDb: 2, midDb: -1, trebleDb: 1 } }),
      makeClip('outside', { trackId: 'video-3', startTime: 9, duration: 2, trimStart: 0, trimEnd: 2 })],
    tracks: [track('video-1'), track('video-2'), track('video-3'), track('audio-1', 'audio')],
    selectedClipIds: ['picture', 'overlay', 'sound'], activeTrackId: 'video-1', selectedTransitionId: null, selectedMarkerId: null, selectedGap: null,
    history: [], historyIndex: -1, historyLastChangedAt: 0, playheadPosition: 3, timelineFps: 24, duration: 14, zoom: 200,
    clipCounter: 100, markerCounter: 2, transitionCounter: 1,
    markers: [{ id: 'marker-1', time: 3.25, name: 'Parent marker' }], transitions: [], inPoint: 2.25, outPoint: 5.75,
    snappingEnabled: false, rippleEditMode: false, activeSnapTime: null, isPlaying: false, playbackRate: 1, shuttleMode: false,
    copiedClips: [], attributeClipboard: null, masterAudioVolume: 100, masterAudioInserts: [], ...patch,
  }))
  markProjectClean()
}
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
async function initializeMedia(media) {
  sources = await Promise.all(Object.entries(media).map(async ([id, encoded]) => {
    const bytes = Uint8Array.from(atob(encoded.base64), letter => letter.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }))
    const video = document.createElement('video'); video.muted = true; video.preload = 'metadata'
    const metadata = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Synthetic metadata timed out')), 8000)
      video.onloadedmetadata = () => { clearTimeout(timer); resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight }) }
      video.onerror = () => { clearTimeout(timer); reject(new Error('Synthetic metadata failed')) }
      video.src = url; video.load()
    })
    video.removeAttribute('src'); video.load()
    return { id, name: `${id} synthetic`, type: 'video', url, path: `media/${id}.mp4`,
      duration: metadata.duration, fps: encoded.fps, hasAudio: false, settings: { ...metadata, fps: encoded.fps } }
  }))
  sources.push({ id: 'tone', name: 'Synthetic tone', type: 'audio', url: toneWav(), path: 'media/tone.wav',
    absolutePath: nativeWaveformStub ? '/__synthetic__/compound-tone.wav' : null,
    duration: 8, hasAudio: true, settings: { duration: 8, sampleRate: 8000 } })
  reset()
  return sources.map(({ id, duration }) => ({ id, duration }))
}

// Actual export compositor and audio serializer; destinations/mixer IPC are
// explicit in-memory stand-ins. The root's native tests verify real FFmpeg.
async function exportInMemory(time, options = {}) {
  const previousApi = window.electronAPI, previousHandle = useProjectStore.getState().currentProjectHandle
  const flags = ['comfystudio-export-webcodecs', 'comfystudio-export-gpu']
  const previousFlags = flags.map(key => localStorage.getItem(key))
  const root = '/__compound_memory__', frames = [], reads = [], calls = [], mixes = []
  let size = null
  const validate = path => { if (typeof path !== 'string' || !path.startsWith(`${root}/`)) throw new Error(`Non-memory path refused: ${path}`); return path }
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
    startFramePipe: async config => { validate(config.outputPath); size = { width: config.width, height: config.height }; return { success: true, sessionId: 'memory-only', encoderUsed: 'memory-test-only' } },
    writeFrameToPipe: async (session, data) => { if (session !== 'memory-only') throw new Error('Unexpected session'); frames.push([...new Uint8Array(data)]); return { success: true } },
    finishFramePipe: async () => ({ success: true, encoderUsed: 'memory-test-only' }),
    abortFramePipe: async () => ({ success: true }),
    mixAudio: async payload => {
      if (payload.outputPath) validate(payload.outputPath)
      mixes.push(JSON.parse(JSON.stringify(payload)))
      const clipCount = payload.clips.filter(clip => {
        const window = getClipPlaybackWindow(clip)
        return window.end > window.start && window.start < payload.rangeEnd && window.end > payload.rangeStart
      }).length
      return { success: true, validateOnly: payload.validateOnly === true, clipCount, skipped: [] }
    },
    muxAudioVideo: async payload => { validate(payload.outputPath); return { success: true } },
    copyFile: async (from, to) => { validate(from); validate(to); return { success: true } },
  }
  useProjectStore.setState({ currentProjectHandle: root })
  flags.forEach(key => localStorage.setItem(key, '0'))
  try {
    const result = await exportTimeline({ width: 96, height: 54, fps: 24, rangeStart: time, rangeEnd: time + 0.04,
      format: 'mp4', outputPath: `${root}/output.mp4`, includeAudio: false, useCachedRenders: true,
      useProxyMedia: false, fastSeek: false, sampleAtFrameCenter: false,
      sourceTimelineWidth: 960, sourceTimelineHeight: 540, ...options })
    return { result, reads, calls, size, frames, mixes }
  } catch (error) {
    return { error: error.message, reads, calls, frames, mixes }
  } finally {
    window.electronAPI = previousApi
    useProjectStore.setState({ currentProjectHandle: previousHandle })
    flags.forEach((key, index) => previousFlags[index] === null ? localStorage.removeItem(key) : localStorage.setItem(key, previousFlags[index]))
  }
}
useProjectStore.setState({ currentProject: { name: 'Synthetic compound verification',
  settings: { fps: 24, width: 960, height: 540 }, timelines: [] }, currentProjectHandle: null, currentTimelineId: null })
watchStoreForProjectChanges(useTimelineStore, TIMELINE_PROJECT_KEYS)
reset()
window.compoundTest = { timeline: useTimelineStore, assets: useAssetsStore, project: useProjectStore,
  reset, initializeMedia, getAsset, makeClip, track, markProjectClean, isProjectDirty, getPreviewFrameSnapshot, getLivePreviewCapture,
  getCompoundRenderState, getClipPlaybackWindow, getClipPlaybackTimeAtTimeline, getAnimatedTransform,
  getAudioClipFadeGain, getAudioVolumeEnvelopeGain, getTrackAnalyser, readAnalyserRmsDb,
  computePreviewSignature, exportInMemory, getNativeWaveformCalls: () => waveformCalls }
function Harness() {
  const [timelineVisible, setTimelineVisible] = React.useState(true)
  window.compoundTest.setTimelineVisible = visible => flushSync(() => setTimelineVisible(visible))
  return <div className="h-screen flex flex-col bg-sf-dark-950 text-sf-text-primary">
    <AudioLayerRenderer />
    <div className="flex flex-1 min-h-0">
      <main className="flex flex-1 min-w-0 flex-col justify-center gap-3 p-5">
        <h1 className="text-sm">Editable compounds · isolated decoded-source verification</h1>
        <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}><CanvasPreviewRenderer
          timelineWidth={960} timelineHeight={540} timelineFps={24}
          onClipPointerDown={clip => useTimelineStore.getState().selectClip(clip.id)} /></div>
        <p className="text-xs text-sf-text-muted">Synthetic red/blue media and quiet tone. Monitor volume is zero.</p>
      </main>
      <div style={{ width: 350, display: 'flex' }}><InspectorPanel isExpanded onToggleExpanded={() => {}} onToggleFullHeight={() => {}} /></div>
    </div>
    <div className="h-[430px] shrink-0">{timelineVisible && <Timeline />}</div>
  </div>
}
createRoot(document.getElementById('root')).render(<I18nProvider><Harness /></I18nProvider>)
