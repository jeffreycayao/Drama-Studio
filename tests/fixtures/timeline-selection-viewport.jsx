// Isolated synthetic timeline: no media, project folders, preload or MCP.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import Timeline from '../../src/components/Timeline'
import useTimelineStore from '../../src/stores/timelineStore'
import useProjectStore from '../../src/stores/projectStore'
import useAssetsStore from '../../src/stores/assetsStore'
import { I18nProvider } from '../../src/i18n/I18nContext'
import { DEFAULT_SHAPE_PROPERTIES } from '../../src/utils/shapes'
import { DEFAULT_EDITOR_HOTKEYS, setEditorHotkeys } from '../../src/services/editorHotkeys'
import { watchStoreForProjectChanges, TIMELINE_PROJECT_KEYS, markProjectClean, isProjectDirty } from '../../src/services/projectDirtyTracker'

watchStoreForProjectChanges(useTimelineStore, TIMELINE_PROJECT_KEYS)
useProjectStore.setState({ currentProject: { name: 'Synthetic viewport', settings: { fps: 24, width: 1920, height: 1080 }, timelines: [] }, currentProjectHandle: null, currentTimelineId: 'synthetic' })
useAssetsStore.setState({ assets: [], folders: [], previewMode: 'timeline', selectedAssetIds: [] })
function reset() {
  const tracks = Array.from({ length: 14 }, (_, index) => ({ id: 'v' + index, name: 'Layer ' + (index + 1),
    type: 'video', order: index, visible: true, locked: index === 8 }))
  const shape = (id, trackId, startTime, duration) => ({ id, name: id, type: 'shape', trackId, startTime, duration,
    trimStart: 0, trimEnd: duration, effects: [], keyframes: {},
    shapeProperties: { ...DEFAULT_SHAPE_PROPERTIES, width: 120, height: 120, fillColor: '#f8b449' },
    transform: { positionX: 0, positionY: 0, scaleX: 100, scaleY: 100, rotation: 0, opacity: 100 } })
  useTimelineStore.getState().clearProject()
  useTimelineStore.setState({ tracks, clips: [shape('A', 'v2', 120, 4), shape('B', 'v3', 130, 2),
    shape('Start', 'v0', 0, 0.1), shape('Far', 'v8', 200, 8)],
    zoom: 80, duration: 240, selectedClipIds: ['A', 'B'], timelineFps: 24,
    playheadPosition: 75, inPoint: 20, outPoint: 210, markers: [{ id: 'm1', name: 'Keep', time: 40 }],
    transitions: [], isPlaying: false, activeTrackId: 'v2', history: [], historyIndex: -1 })
  markProjectClean()
}
reset()
window.timelineSelectionViewportTest = { timeline: useTimelineStore, project: useProjectStore, reset,
  markProjectClean, isProjectDirty, setEditorHotkeys, DEFAULT_EDITOR_HOTKEYS }
function App() {
  const [visible, setVisible] = React.useState(true)
  React.useEffect(() => { window.timelineSelectionViewportTest.setVisible = setVisible }, [])
  return <I18nProvider><div className="h-screen flex flex-col bg-sf-dark-950 text-sf-text-primary">
    <header className="p-3 shrink-0 flex gap-3 items-center">
      <span>Selection viewport · isolated verification</span>
      <input aria-label="Typing guard" className="bg-sf-dark-800 w-28" />
      <div contentEditable suppressContentEditableWarning role="textbox" aria-label="Editable guard" className="bg-sf-dark-800 w-28">Text</div>
    </header>
    <main className="flex-1 min-h-0 flex flex-col">{visible && <Timeline />}</main>
  </div></I18nProvider>
}
createRoot(document.getElementById('root')).render(<App />)
