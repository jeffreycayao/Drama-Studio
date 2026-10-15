// Synthetic media only: no production main/preload, project, downloads or files.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import InspectorPanel from '../../src/components/InspectorPanel'
import Timeline from '../../src/components/Timeline'
import AudioLayerRenderer from '../../src/components/AudioLayerRenderer'
import useTimelineStore from '../../src/stores/timelineStore'
import useAssetsStore from '../../src/stores/assetsStore'
import useProjectStore from '../../src/stores/projectStore'
import useAudioEqPreview from '../../src/services/audioEqPreview'
import { createAudioEqChain } from '../../src/services/audioEqChain'
import { getAudioEqCoefficients, normalizeAudioEq } from '../../src/utils/audioEq.mjs'
import { I18nProvider } from '../../src/i18n/I18nContext'
import { getEditorHotkeys, EDITOR_HOTKEY_IDS } from '../../src/services/editorHotkeys'
import { getTrackAnalyser, readAnalyserRmsDb } from '../../src/services/audioMixerGraph'
import { computePreviewSignature } from '../../src/services/previewCache'
import { watchStoreForProjectChanges, TIMELINE_PROJECT_KEYS, markProjectClean, isProjectDirty } from '../../src/services/projectDirtyTracker'

function syntheticWav(duration = 12, sampleRate = 24000) {
  const frames = Math.round(duration * sampleRate)
  const bytes = new ArrayBuffer(44 + frames * 2), view = new DataView(bytes)
  const string = (offset, text) => [...text].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)))
  string(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); string(8, 'WAVE')
  string(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  string(36, 'data'); view.setUint32(40, frames * 2, true)
  for (let index = 0; index < frames; index++) view.setInt16(44 + index * 2, Math.round(Math.sin(2 * Math.PI * 1000 * index / sampleRate) * 0.15 * 32767), true)
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
}
const sourceUrl = syntheticWav()
const nativeWaveformStub = new URLSearchParams(window.location.search).has('nativeWaveformStub')
let nativeWaveformCalls = 0
if (nativeWaveformStub) {
  // Existing installed Electron decodeAudioData crashes on valid PCM WAVs.
  // Only main-process waveform extraction is represented by known peaks;
  // real blob playback, AudioLayerRenderer and OfflineAudioContext stay on.
  window.electronAPI = { isElectron: true, getAudioWaveform: async (input, { sampleCount }) => {
    if (input !== '/__synthetic__/eq.wav') throw new Error('Unexpected native EQ waveform fixture input')
    nativeWaveformCalls += 1
    return { success: true, peaks: Array.from({ length: sampleCount }, () => 0.15), duration: 12 }
  } }
}
const asset = { id: 'synthetic-eq-audio', name: 'Synthetic 1kHz tone', type: 'audio', url: sourceUrl,
  duration: 12, path: 'audio/synthetic-eq.wav', absolutePath: nativeWaveformStub ? '/__synthetic__/eq.wav' : null,
  hasAudio: true, settings: { duration: 12, sampleRate: 24000 } }
const track = (id, name, type = 'audio', locked = false) => ({ id, name, type, locked, muted: false, visible: true, volume: 100, channels: 'stereo' })
const makeClip = (id = 'eq-a', patch = {}) => ({
  id, name: id === 'eq-a' ? 'Dialogue · synthetic tone' : id, type: 'audio', trackId: 'audio-1', assetId: asset.id, url: sourceUrl,
  startTime: 1, duration: 8, trimStart: 2, trimEnd: 10, sourceDuration: 12,
  sourceTimeScale: 1, sourceFps: 24, timelineFps: 24, speed: 1, reverse: false,
  gainDb: -3, fadeIn: 0.2, fadeOut: 0.3, enabled: true, effects: [], keyframes: {},
  volumeEnvelope: { version: 1, offsetSeconds: 0, points: [{ id: 'level', time: 0, db: -6 }] },
  ...patch,
})
function reset(patch = {}) {
  useAudioEqPreview.getState().clearPreview()
  useAssetsStore.setState({ assets: [asset], folders: [], selectedAssetIds: [], currentPreview: null,
    previewMode: 'timeline', isPlaying: false, volume: 0, videoRef: null })
  useTimelineStore.setState(state => ({
    timelineSessionId: (Number(state.timelineSessionId) || 0) + 1,
    clips: [makeClip(), makeClip('eq-b', { trackId: 'audio-2', startTime: 11, duration: 1, trimStart: 0, trimEnd: 1 }),
      makeClip('locked-audio', { trackId: 'audio-locked' })],
    tracks: [track('video-1', 'Video 1', 'video'), track('audio-1', 'Dialogue'), track('audio-2', 'Music'), track('audio-locked', 'Locked audio', 'audio', true)],
    selectedClipIds: ['eq-a'], activeTrackId: 'audio-1', selectedTransitionId: null, selectedMarkerId: null, selectedGap: null,
    history: [], historyIndex: -1, historyLastChangedAt: 0, playheadPosition: 2, timelineFps: 24, duration: 20, zoom: 250,
    clipCounter: 100, markerCounter: 1, transitionCounter: 1, transitions: [], markers: [], inPoint: null, outPoint: null,
    snappingEnabled: false, rippleEditMode: false, activeSnapTime: null, isPlaying: false, playbackRate: 1, shuttleMode: false,
    copiedClips: [], attributeClipboard: null, ...patch,
  }))
  markProjectClean()
}
useProjectStore.setState({ currentProject: { name: 'Synthetic EQ verification', settings: { fps: 24, width: 960, height: 540 }, timelines: [] }, currentProjectHandle: null, currentTimelineId: null })
watchStoreForProjectChanges(useTimelineStore, TIMELINE_PROJECT_KEYS)
reset()
window.audioEqTest = {
  timeline: useTimelineStore, assets: useAssetsStore, project: useProjectStore, preview: useAudioEqPreview,
  reset, asset, sourceUrl, makeClip, track, markProjectClean, isProjectDirty, normalizeAudioEq,
  createAudioEqChain, getAudioEqCoefficients, getTrackAnalyser, readAnalyserRmsDb, computePreviewSignature,
  nativeWaveformStub, getNativeWaveformCalls: () => nativeWaveformCalls,
  splitHotkey: async () => (await getEditorHotkeys())[EDITOR_HOTKEY_IDS.SPLIT_ACTIVE],
}
function Harness() {
  return <div className="h-screen flex flex-col bg-sf-dark-950 text-sf-text-primary">
    <AudioLayerRenderer />
    <div className="flex flex-1 min-h-0">
      <main className="flex flex-1 min-w-0 flex-col justify-center gap-3 p-6">
        <h1 className="text-sm">Clip EQ · isolated verification</h1>
        <p className="text-xs text-sf-text-muted">Synthetic 1kHz tone. Monitor muted. No user project or media file is open.</p>
        <input className="w-48 bg-sf-dark-800 p-2" aria-label="Typing guard" placeholder="Delete here must not remove a clip" />
      </main>
      <div data-testid="eq-fixture-inspector" style={{ width: 350, display: 'flex' }}>
        <InspectorPanel isExpanded onToggleExpanded={() => {}} onToggleFullHeight={() => {}} />
      </div>
    </div>
    <div className="h-[430px] shrink-0"><Timeline /></div>
  </div>
}
createRoot(document.getElementById('root')).render(<I18nProvider><Harness /></I18nProvider>)
