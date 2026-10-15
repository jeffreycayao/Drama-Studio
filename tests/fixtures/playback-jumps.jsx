// Reuse the real Timeline, CanvasPreviewRenderer and AudioLayerRenderer harness
// unchanged. Unlike the older transition diagnostic, transport advances through
// the same hook as PreviewPanel, never a test-owned RAF or hand-published clock.
import './compound-clips.jsx'
import React from 'react'
import { createRoot } from 'react-dom/client'
import useTimelinePlayback from '../../src/hooks/useTimelinePlayback'

function PlaybackClock() {
  const { isPlaying, togglePlay } = useTimelinePlayback()
  return <button type="button" data-testid="playback-jumps-transport"
    aria-pressed={isPlaying} onClick={togglePlay}
    style={{ position: 'fixed', right: 365, top: 8, zIndex: 1000, padding: '4px 10px', background: '#252933', color: 'white' }}>
    {isPlaying ? 'Pause test playback' : 'Play test playback'}
  </button>
}

createRoot(document.getElementById('playback-clock')).render(<PlaybackClock />)
