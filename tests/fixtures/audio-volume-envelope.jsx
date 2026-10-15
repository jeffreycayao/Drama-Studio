// Isolated synthetic audio only. No production main/preload, user project,
// downloads, filesystem writes, or external audio files are used here.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import InspectorPanel from '../../src/components/InspectorPanel'
import Timeline from '../../src/components/Timeline'
import AudioLayerRenderer from '../../src/components/AudioLayerRenderer'
import useTimelineStore from '../../src/stores/timelineStore'
import useAssetsStore from '../../src/stores/assetsStore'
import useProjectStore from '../../src/stores/projectStore'
import { I18nProvider } from '../../src/i18n/I18nContext'
import { getEditorHotkeys, EDITOR_HOTKEY_IDS } from '../../src/services/editorHotkeys'
import { getAudioVolumeEnvelopeGain } from '../../src/utils/audioVolumeEnvelope.mjs'
import { scheduleAudioVolumeEnvelope } from '../../src/utils/audioVolumeAutomation.mjs'
import { computePreviewSignature } from '../../src/services/previewCache'
import { getTrackAnalyser, readAnalyserRmsDb } from '../../src/services/audioMixerGraph'
import { watchStoreForProjectChanges, TIMELINE_PROJECT_KEYS, markProjectClean, isProjectDirty } from '../../src/services/projectDirtyTracker'

function syntheticWav(duration = 12, sampleRate = 24000) {
  const frames = Math.round(duration * sampleRate)
  const bytes = new ArrayBuffer(44 + frames * 2)
  const view = new DataView(bytes)
  const string = (offset, text) => [...text].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)))
  string(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); string(8, 'WAVE')
  string(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  string(36, 'data'); view.setUint32(40, frames * 2, true)
  for (let index = 0; index < frames; index++) {
    view.setInt16(44 + index * 2, Math.round(Math.sin(2 * Math.PI * 440 * index / sampleRate) * 0.25 * 32767), true)
  }
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
}
const sourceUrl = syntheticWav()
const nativeWaveformStub = new URLSearchParams(window.location.search).has('nativeWaveformStub')
let nativeWaveformCalls = 0
if (nativeWaveformStub) {
  // Installed Electron's bare decodeAudioData crashes on valid PCM WAVs.
  // Use Timeline's existing native-file waveform branch, with known peaks
  // standing in for main-process FFmpeg. Blob media playback and the real
  // AudioLayerRenderer/Web Audio graph remain enabled and unmodified.
  window.electronAPI = {
    isElectron: true,
    getAudioWaveform: async (input, { sampleCount }) => {
      if (input !== '/__synthetic__/volume.wav') throw new Error('Unexpected native waveform fixture input')
      nativeWaveformCalls += 1
      return { success: true, peaks: Array.from({ length: sampleCount }, () => 0.25), duration: 12 }
    },
  }
}
const asset = { id: 'synthetic-audio', name: 'Synthetic tone', type: 'audio', url: sourceUrl, duration: 12,
  path: 'audio/synthetic-tone.wav', absolutePath: nativeWaveformStub ? '/__synthetic__/volume.wav' : null,
  hasAudio: true, settings: { duration: 12, sampleRate: 24000 } }
const track = (id, name, type = 'audio', locked = false) => ({ id, name, type, locked, muted: false, visible: true, volume: 100, channels: 'stereo' })
const makeClip = (id = 'envelope-a', patch = {}) => ({
  id, name: id === 'envelope-a' ? 'Dialogue · synthetic tone' : id,
  type: 'audio', trackId: 'audio-1', assetId: asset.id, url: sourceUrl,
  startTime: 1, duration: 8, trimStart: 2, trimEnd: 10, sourceDuration: 12,
  sourceTimeScale: 1, sourceFps: 24, timelineFps: 24, speed: 1, reverse: false,
  gainDb: -3, fadeIn: 0.2, fadeOut: 0.3, enabled: true, effects: [], keyframes: {},
  ...patch,
})
function reset(patch = {}) {
  useAssetsStore.setState({ assets: [asset], folders: [], selectedAssetIds: [], currentPreview: null,
    previewMode: 'timeline', isPlaying: false, volume: 0, videoRef: null })
  useTimelineStore.setState(state => ({
    timelineSessionId: (Number(state.timelineSessionId) || 0) + 1,
    clips: [makeClip(), makeClip('envelope-b', { trackId: 'audio-2', startTime: 11, duration: 1, trimStart: 0, trimEnd: 1 }),
      makeClip('locked-audio', { trackId: 'audio-locked', startTime: 1 })],
    tracks: [track('video-1', 'Video 1', 'video'), track('audio-1', 'Dialogue'),
      track('audio-2', 'Music'), track('audio-locked', 'Locked audio', 'audio', true)],
    selectedClipIds: ['envelope-a'], activeTrackId: 'audio-1',
    selectedTransitionId: null, selectedMarkerId: null, selectedGap: null,
    history: [], historyIndex: -1, historyLastChangedAt: 0,
    playheadPosition: 2, timelineFps: 24, duration: 20, zoom: 250,
    clipCounter: 100, markerCounter: 1, transitionCounter: 1,
    transitions: [], markers: [], inPoint: null, outPoint: null,
    snappingEnabled: false, rippleEditMode: false, activeSnapTime: null,
    isPlaying: false, playbackRate: 1, shuttleMode: false,
    copiedClips: [], attributeClipboard: null,
    ...patch,
  }))
  markProjectClean()
}
useProjectStore.setState({ currentProject: { name: 'Synthetic envelope verification',
  settings: { fps: 24, width: 960, height: 540 }, timelines: [] }, currentProjectHandle: null, currentTimelineId: null })
watchStoreForProjectChanges(useTimelineStore, TIMELINE_PROJECT_KEYS)
reset()
window.audioVolumeEnvelopeTest = {
  timeline: useTimelineStore, assets: useAssetsStore, project: useProjectStore,
  reset, asset, sourceUrl, makeClip, track, markProjectClean, isProjectDirty,
  nativeWaveformStub, getNativeWaveformCalls: () => nativeWaveformCalls,
  getAudioVolumeEnvelopeGain, scheduleAudioVolumeEnvelope, computePreviewSignature,
  getTrackAnalyser, readAnalyserRmsDb,
  splitHotkey: async () => (await getEditorHotkeys())[EDITOR_HOTKEY_IDS.SPLIT_ACTIVE],
}
function Harness() {
  return <div className="h-screen flex flex-col bg-sf-dark-950 text-sf-text-primary">
    <AudioLayerRenderer />
    <div className="flex flex-1 min-h-0">
      <main className="flex flex-1 min-w-0 flex-col justify-center gap-3 p-6">
        <h1 className="text-sm">Clip volume envelope · isolated verification</h1>
        <p className="text-xs text-sf-text-muted">Synthetic waveform. Monitor muted. No user project or media file is open.</p>
        <input className="w-48 bg-sf-dark-800 p-2" aria-label="Typing guard" placeholder="Delete here must not remove a point" />
      </main>
      <div data-testid="envelope-fixture-inspector" style={{ width: 350, display: 'flex' }}>
        <InspectorPanel isExpanded onToggleExpanded={() => {}} onToggleFullHeight={() => {}} />
      </div>
    </div>
    <div data-testid="envelope-fixture-timeline" className="h-[430px] shrink-0"><Timeline /></div>
  </div>
}
createRoot(document.getElementById('root')).render(<I18nProvider><Harness /></I18nProvider>)
