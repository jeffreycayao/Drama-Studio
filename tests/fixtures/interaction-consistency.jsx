// Actual UI components and stores, synthetic document/media only. No native
// preload, project folders, exports, transcription, or authored file writes.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import '../../src/index.css'
import TransportControls from '../../src/components/TransportControls'
import PreviewSourceControls from '../../src/components/PreviewSourceControls'
import PreviewPanel from '../../src/components/PreviewPanel'
import InspectorPanel from '../../src/components/InspectorPanel'
import CaptionWorkspace from '../../src/components/CaptionWorkspace'
import Timeline from '../../src/components/Timeline'
import usePreviewPopout from '../../src/hooks/usePreviewPopout'
import { I18nProvider } from '../../src/i18n/I18nContext'
import useTimelineStore from '../../src/stores/timelineStore'
import useAssetsStore from '../../src/stores/assetsStore'
import useProjectStore from '../../src/stores/projectStore'
import { DEFAULT_SHAPE_PROPERTIES } from '../../src/utils/shapes'
import { watchStoreForProjectChanges, TIMELINE_PROJECT_KEYS, markProjectClean, isProjectDirty } from '../../src/services/projectDirtyTracker'

const sourceAsset = { id: 'synthetic-source', name: 'Synthetic source', type: 'video', duration: 10, hasAudio: false,
  url: 'https://fixture.invalid/source.mp4', settings: { fps: 24, width: 960, height: 540, duration: 10 } }
const sourceVideo = document.createElement('video')
let sourceTime = 2, sourcePaused = true, playCalls = 0, pauseCalls = 0
Object.defineProperties(sourceVideo, {
  currentTime: { get: () => sourceTime, set: value => { sourceTime = Number(value); queueMicrotask(() => sourceVideo.dispatchEvent(new Event('seeked'))) } },
  currentSrc: { get: () => sourceAsset.url }, readyState: { get: () => 4 }, duration: { get: () => 10 },
  paused: { get: () => sourcePaused },
})
sourceVideo.play = () => { sourcePaused = false; playCalls++; useAssetsStore.setState({ isPlaying: true }); return Promise.resolve() }
sourceVideo.pause = () => { sourcePaused = true; pauseCalls++; useAssetsStore.setState({ isPlaying: false }) }
const visual = (id, x) => ({ id, name: id, type: 'shape', trackId: 'picture', startTime: 0, duration: 10,
  trimStart: 0, trimEnd: 10, effects: [], keyframes: {}, enabled: true,
  shapeProperties: { ...DEFAULT_SHAPE_PROPERTIES, width: 180, height: 180, fillColor: '#38bdf8' },
  transform: { positionX: x, positionY: 0, scaleX: 100, scaleY: 100, rotation: 0, opacity: 100, scaleLinked: true } })
function reset({ source = false, multi = false } = {}) {
  sourceTime = 2; sourcePaused = true; playCalls = 0; pauseCalls = 0
  useAssetsStore.setState({ assets: [sourceAsset], folders: [], previewMode: source ? 'asset' : 'timeline',
    currentPreview: source ? sourceAsset : null, selectedAssetIds: [], videoRef: sourceVideo,
    duration: 10, currentTime: 2, isPlaying: false, mediaPreparation: null, sourceSeedRequest: null })
  useTimelineStore.setState(state => ({ timelineSessionId: state.timelineSessionId + 1,
    clips: [visual('shape-a', -100), visual('shape-b', 100), { id: 'caption-probe', name: 'Synthetic caption', type: 'captions',
      trackId: 'picture', startTime: 0, duration: 10, captions: { cues: [{ id: 'cue-1', start: 0, end: 4, text: 'Synthetic caption preview' }] } }],
    tracks: [{ id: 'picture', name: 'Picture', type: 'video', visible: true, locked: false }],
    duration: 10, timelineFps: 24, playheadPosition: 3, selectedClipIds: multi ? ['shape-a', 'shape-b'] : ['shape-a'],
    selectedTransitionId: null, selectedMarkerId: null, selectedGap: null, activeTrackId: 'picture',
    transitions: [], markers: [], history: [], historyIndex: -1, historyLastChangedAt: 0,
    inPoint: 1, outPoint: 8, isPlaying: false, playbackRate: 1, shuttleMode: false, playAround: null,
    playbackJump: null, playbackJumpError: null, compoundEditContext: null, loopMode: 'normal',
  }))
  markProjectClean()
}
useProjectStore.setState({ currentProject: { name: 'Isolated interaction verification', settings: { fps: 24, width: 960, height: 540 }, timelines: [] },
  currentProjectHandle: null, currentTimelineId: null })
watchStoreForProjectChanges(useTimelineStore, TIMELINE_PROJECT_KEYS)
reset()
window.interactionTest = {
  timeline: useTimelineStore, assets: useAssetsStore, project: useProjectStore, sourceVideo, reset, markProjectClean,
  registerSourceStub: () => useAssetsStore.getState().registerVideoRef(sourceVideo),
  snapshot: () => {
    const state = useTimelineStore.getState()
    return { document: JSON.stringify({ clips: state.clips, tracks: state.tracks, transitions: state.transitions, markers: state.markers }),
      history: JSON.stringify(state.history), historyIndex: state.historyIndex, selected: state.selectedClipIds,
      inPoint: state.inPoint, outPoint: state.outPoint, time: state.playheadPosition, playing: state.isPlaying,
      rate: state.playbackRate, dirty: isProjectDirty(), sourceTime, sourcePaused, playCalls, pauseCalls }
  },
}
function Fixture() {
  const mode = useAssetsStore(state => state.previewMode)
  const [mounted, setMounted] = React.useState(true), [caption, setCaption] = React.useState(false), [version, setVersion] = React.useState(0)
  const [showTimeline, setShowTimeline] = React.useState(false)
  const [showPreview, setShowPreview] = React.useState(false)
  React.useEffect(() => {
    Object.assign(window.interactionTest, {
      setMounted: value => flushSync(() => setMounted(value)),
      setCaption: value => flushSync(() => setCaption(value)),
      setShowTimeline: value => flushSync(() => setShowTimeline(value)),
      seed: options => flushSync(() => { reset(options); setCaption(false); setShowTimeline(false); setShowPreview(Boolean(options?.preview)); setMounted(true); setVersion(v => v + 1) }),
    })
  }, [])
  return <div className="flex h-screen flex-col bg-sf-dark-950 text-sf-text-primary">
    <h1 className="p-3 text-sm">Velorn · isolated interaction verification</h1>
    <div className="flex min-h-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col gap-4 p-5">
        <div className="flex gap-2" data-testid="native-probes">
          <input aria-label="Typing probe" defaultValue="Text" className="w-28 text-black" />
          <select aria-label="Choice probe" className="text-black"><option>One</option><option>Two</option></select>
          <input aria-label="Checkbox probe" type="checkbox" />
          <input aria-label="Range probe" type="range" defaultValue="50" />
          <button type="button" data-testid="native-button" onClick={() => { window.interactionTest.nativeClicks = (window.interactionTest.nativeClicks || 0) + 1 }}>Native action</button>
        </div>
        <details><summary>Disclosure probe</summary><span>Native disclosure content</span></details>
        <div contentEditable suppressContentEditableWarning data-testid="editable-probe" className="border p-2">Editable probe</div>
        {mounted && showPreview && <div key={`preview-${version}`} data-testid="actual-preview" className="h-[350px] shrink-0"><PreviewPanel /></div>}
        {mounted && <div key={version} data-testid="actual-transport"><TransportControls /></div>}
        {mounted && <PopoutProbe key={`popout-${version}`} />}
        {mounted && mode === 'asset' && !showPreview && <div key={`source-${version}`} data-testid="actual-source"><PreviewSourceControls asset={sourceAsset} /></div>}
      </main>
      {mounted && mode !== 'asset' && <aside key={version} data-testid="actual-inspector" className="flex w-[350px]"><InspectorPanel isExpanded onToggleExpanded={() => {}} onToggleFullHeight={() => {}} /></aside>}
    </div>
    {showTimeline && <div className="h-[220px] shrink-0" data-testid="actual-timeline"><Timeline /></div>}
    {caption && <CaptionWorkspace isOpen scope="timeline" seedFromClipId="caption-probe" asset={{ id: 'caption-probe', name: 'Synthetic caption audio', type: 'audio', duration: 10 }}
      folders={[]} timelineSize={{ width: 960, height: 540 }} onClose={() => setCaption(false)} />}
  </div>
}
function PopoutProbe() {
  const popout = usePreviewPopout({ getSourceElement: () => null, onTogglePlay: () => {
    if (useAssetsStore.getState().previewMode === 'asset') {
      if (sourceVideo.paused) sourceVideo.play(); else sourceVideo.pause()
    } else useTimelineStore.getState().togglePlay()
  } })
  return <button type="button" data-testid="open-popout" onClick={popout.open}>Open isolated preview popout</button>
}
createRoot(document.getElementById('root')).render(<I18nProvider><Fixture /></I18nProvider>)
