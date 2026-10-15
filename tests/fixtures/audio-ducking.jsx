// Real Inspector, PreviewPanel clock/audio graph and Timeline. Synthetic WAVs
// and a deterministic native waveform IPC stand-in; no project or file writes.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import InspectorPanel from '../../src/components/InspectorPanel'
import PreviewPanel from '../../src/components/PreviewPanel'
import Timeline from '../../src/components/Timeline'
import TransportControls from '../../src/components/TransportControls'
import useTimelineStore from '../../src/stores/timelineStore'
import useAssetsStore from '../../src/stores/assetsStore'
import useProjectStore from '../../src/stores/projectStore'
import { useAudioDuckingPreview } from '../../src/services/audioDuckingPreview'
import { I18nProvider } from '../../src/i18n/I18nContext'
import { getTrackAnalyser, readAnalyserRmsDb } from '../../src/services/audioMixerGraph'
import { watchStoreForProjectChanges, TIMELINE_PROJECT_KEYS, markProjectClean, isProjectDirty } from '../../src/services/projectDirtyTracker'

const duration = 6, rate = 8000, frames = duration * rate
const speech = time => (time >= 1 && time < 2.1) || (time >= 3.5 && time < 4.5)
function wav(voice) {
  const bytes = new ArrayBuffer(44 + frames * 2), view = new DataView(bytes)
  const text = (offset, value) => [...value].forEach((letter, i) => view.setUint8(offset + i, letter.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, frames * 2, true)
  for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2,
    Math.round(Math.sin(2 * Math.PI * (voice ? 750 : 220) * i / rate) * (voice && !speech(i / rate) ? 0 : 0.25) * 32767), true)
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
}
const musicUrl = wav(false), voiceUrl = wav(true), calls = []
let delay = 0, silent = false
window.electronAPI = { isElectron: true,
  getAudioWaveform: async (path, { sampleCount, sampleRate = 8000 }) => {
    if (!['/__duck__/voice.wav', '/__duck__/music.wav'].includes(path)) throw new Error(`Unexpected fixture path: ${path}`)
    calls.push(path)
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
    const bucket = Math.max(1, Math.floor(duration * sampleRate / sampleCount))
    return { success: true, duration, peaks: Array.from({ length: sampleCount }, (_, i) =>
      silent ? 0 : path.endsWith('music.wav') || speech(i * bucket / sampleRate) ? 0.25 : 0) }
  },
}
const asset = (id, url) => ({ id, name: id, type: 'audio', url, absolutePath: `/__duck__/${id}.wav`, duration, hasAudio: true, settings: { duration } })
const clip = id => ({ id, name: id === 'music' ? 'Music bed' : 'Dialogue', type: 'audio', trackId: id, assetId: id,
  startTime: 1, duration, trimStart: 0, trimEnd: duration, sourceDuration: duration, sourceTimeScale: 1, speed: 1,
  enabled: true, gainDb: 0, fadeIn: 0, fadeOut: 0, effects: [], keyframes: {},
  ...(id === 'music' ? { volumeEnvelope: { version: 1, offsetSeconds: 0, points: [{ id: 'authored', time: 0, db: -3 }] } } : {}) })
const track = id => ({ id, name: id === 'music' ? 'Music' : 'Dialogue', type: 'audio', visible: true, muted: false, volume: 100 })
useProjectStore.setState({ currentProject: { name: 'Ducking test', settings: { fps: 24, width: 640, height: 360 }, timelines: [] }, currentProjectHandle: null })
const reset = () => {
  useAssetsStore.setState({ assets: [asset('music', musicUrl), asset('voice', voiceUrl)], previewMode: 'timeline', currentPreview: null, isPlaying: false, volume: 0.1 })
  useTimelineStore.setState(s => ({ clips: [clip('music'), clip('voice')], tracks: [track('music'), track('voice')],
    selectedClipIds: ['music'], selectedTransitionId: null, selectedGap: null, selectedMarkerId: null,
    activeTrackId: 'music', history: [], historyIndex: -1, transitions: [], markers: [], duration: 8, timelineFps: 24,
    playheadPosition: 0.5, isPlaying: false, playAround: null, playbackJump: null, playbackJumpError: null,
    playbackRate: 1, shuttleMode: false, loopMode: 'loop-in-out', inPoint: 2, outPoint: 3,
    timelineSessionId: (Number(s.timelineSessionId) || 0) + 1, masterAudioVolume: 100 }))
  markProjectClean()
}
watchStoreForProjectChanges(useTimelineStore, TIMELINE_PROJECT_KEYS)
reset()
window.duckingTest = { timeline: useTimelineStore, assets: useAssetsStore, preview: useAudioDuckingPreview,
  calls, reset, isProjectDirty, setDelay: value => { delay = value }, setSilent: value => { silent = value },
  rms: () => readAnalyserRmsDb(getTrackAnalyser('music')),
  snapshot: () => { const s = useTimelineStore.getState(); return { project: JSON.stringify(s.getProjectData()), history: s.history.length,
    dirty: isProjectDirty(), position: s.playheadPosition, playing: s.isPlaying, audition: s.playAround,
    preview: useAudioDuckingPreview.getState().token, envelope: s.clips.find(c => c.id === 'music')?.volumeEnvelope } } }
function Harness() {
  return <div className="h-screen flex flex-col bg-sf-dark-950 text-sf-text-primary">
    <div className="flex flex-1 min-h-0"><main className="flex flex-col flex-1 min-w-0"><PreviewPanel /><TransportControls /></main>
      <aside className="w-[340px] overflow-auto"><InspectorPanel isExpanded onToggleExpanded={() => {}} /></aside></div>
    <div className="h-[240px]"><Timeline /></div>
  </div>
}
createRoot(document.getElementById('root')).render(<I18nProvider><Harness /></I18nProvider>)
