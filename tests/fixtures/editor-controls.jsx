// Isolated synthetic state: never opens, writes or exports a user's project.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import DopeSheet from '../../src/components/DopeSheet'
import TransportControls from '../../src/components/TransportControls'
import useTimelineStore from '../../src/stores/timelineStore'
import useAssetsStore from '../../src/stores/assetsStore'
import { useTimelinePlayback } from '../../src/hooks/useTimelinePlayback'
import { I18nProvider } from '../../src/i18n/I18nContext'

const clip = {
  id: 'fixture', trackId: 'track-1', name: 'Zoom verification — synthetic clip',
  type: 'video', startTime: 0, duration: 10, trimStart: 0, trimEnd: 10,
  transform: { positionX: 0, opacity: 1 },
  keyframes: {
    positionX: [1, 1.0416666667, 1.0833333333, 2, 5, 9].map((time, i) => ({ time, value: i * 20, easing: 'linear' })),
    opacity: [{ time: 0, value: 0, easing: 'linear' }, { time: 1, value: 1, easing: 'linear' }],
  },
}
useTimelineStore.setState({ clips: [clip], selectedClipIds: ['fixture'], playheadPosition: 2, timelineFps: 24, isPlaying: false })
useAssetsStore.setState({ previewMode: 'timeline' })
window.editorControlsTest = { timeline: useTimelineStore, assets: useAssetsStore }
function Harness() {
  useTimelinePlayback()
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <input aria-label="Typing guard" placeholder="Typing must not shuttle" />
    <TransportControls />
    <div style={{ flex: 1, minHeight: 0 }}><DopeSheet /></div>
  </div>
}
createRoot(document.getElementById('root')).render(<I18nProvider><Harness /></I18nProvider>)
