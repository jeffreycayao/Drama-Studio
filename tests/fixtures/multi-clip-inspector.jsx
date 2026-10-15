// Synthetic project only: no media files, Electron bridge, or user project access.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import InspectorPanel from '../../src/components/InspectorPanel'
import EffectsPanel from '../../src/components/panels/EffectsPanel'
import CanvasPreviewRenderer from '../../src/components/CanvasPreviewRenderer'
import TransportControls from '../../src/components/TransportControls'
import Timeline from '../../src/components/Timeline'
import useTimelineStore from '../../src/stores/timelineStore'
import useAssetsStore from '../../src/stores/assetsStore'
import useProjectStore from '../../src/stores/projectStore'
import { I18nProvider } from '../../src/i18n/I18nContext'
import { DEFAULT_SHAPE_PROPERTIES } from '../../src/utils/shapes'
import { watchStoreForProjectChanges, TIMELINE_PROJECT_KEYS, markProjectClean, isProjectDirty } from '../../src/services/projectDirtyTracker'

function reset() {
  const base = { startTime: 0, duration: 10, trimStart: 0, trimEnd: 10, keyframes: {}, effects: [] }
  const visual = (id, x, color, scaleLinked) => ({
    ...base, id, name: id, type: 'shape', trackId: id,
    shapeProperties: { ...DEFAULT_SHAPE_PROPERTIES, width: 180, height: 180, fillColor: color },
    transform: { positionX: x, positionY: 0, scaleX: 100, scaleY: 100, scaleLinked, rotation: 0, opacity: 100 },
  })
  const clips = [visual('visual-a', -180, '#38bdf8', true), visual('visual-b', 180, '#eab308', false),
    ...['audio-a', 'audio-b'].map((id, index) => ({ ...base, id, name: id, type: 'audio', trackId: 'audio', gainDb: index * 6, fadeIn: 0.2, fadeOut: 0.3 })),
    { ...visual('locked', 0, '#ffffff', true), startTime: 20 },
  ]
  const tracks = ['visual-a', 'visual-b', 'locked'].map((id, index) => ({ id, name: id, type: 'video', order: index, visible: true, locked: id === 'locked' }))
  tracks.push({ id: 'audio', name: 'Audio', type: 'audio', order: 3, muted: false, volume: 1 })
  useTimelineStore.setState({ clips, tracks, selectedClipIds: ['visual-a', 'visual-b'], selectedTransitionId: null,
    history: [], historyIndex: -1, playheadPosition: 1, duration: 30, timelineFps: 30, isPlaying: false,
    activeTrackId: 'visual-a', transitions: [], markers: [], selectedMarkerId: null, selectedGap: null,
    copiedClips: [], attributeClipboard: null, playbackRate: 1, shuttleMode: false })
  markProjectClean()
}
useAssetsStore.setState({ assets: [], folders: [], previewMode: 'timeline', selectedAssetIds: [] })
watchStoreForProjectChanges(useTimelineStore, TIMELINE_PROJECT_KEYS)
reset()
window.multiClipInspectorTest = { timeline: useTimelineStore, assets: useAssetsStore, project: useProjectStore, reset, markProjectClean, isProjectDirty }
function OptionalTimeline() {
  const [visible, setVisible] = React.useState(true)
  React.useEffect(() => {
    window.multiClipInspectorTest.setTimelineVisible = setVisible
    return () => { delete window.multiClipInspectorTest.setTimelineVisible }
  }, [])
  return visible ? <div data-testid="fixture-timeline" className="h-[400px] shrink-0"><Timeline /></div> : null
}
createRoot(document.getElementById('root')).render(<I18nProvider>
  <div className="h-screen flex flex-col bg-sf-dark-950 text-sf-text-primary">
    <div className="flex flex-1 min-h-0">
    {new URLSearchParams(window.location.search).has('effectsLibrary') && (
      <div data-testid="effects-library" className="w-80 overflow-y-auto"><EffectsPanel /></div>
    )}
    <main className="flex-1 min-w-0 flex flex-col justify-center gap-4 p-6">
      <h1 className="text-sm">Multi-clip Inspector · isolated verification</h1>
      <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}><CanvasPreviewRenderer timelineWidth={960} timelineHeight={540} /></div>
      <TransportControls />
      <p className="text-xs text-sf-text-muted">Synthetic shapes and audio clips. No user project is loaded.</p>
    </main>
    <div data-testid="inspector-container" style={{ width: 350, display: 'flex' }}>
      <InspectorPanel isExpanded onToggleExpanded={() => {}} onToggleFullHeight={() => {}} />
    </div>
    </div>
    {new URLSearchParams(window.location.search).has('timeline') && (
      <OptionalTimeline />
    )}
  </div>
</I18nProvider>)
