import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import '../../src/index.css'
import Timeline from '../../src/components/Timeline'
import useTimelineStore from '../../src/stores/timelineStore'
import useProjectStore from '../../src/stores/projectStore'
import useAssetsStore from '../../src/stores/assetsStore'
import { I18nProvider } from '../../src/i18n/I18nContext'
import { analyzeAudioSource } from '../../src/services/audioAnalysis'
import { watchStoreForProjectChanges, TIMELINE_PROJECT_KEYS, markProjectClean, isProjectDirty } from '../../src/services/projectDirtyTracker'

const fixture = window.audioAnalysisFixture
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const equal = (actual, expected, message) => assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`)
const near = (actual, expected, tolerance, label) => assert(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(predicate, label) {
  const deadline = Date.now() + 15000
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('Timed out: ' + label)
    await delay(20)
  }
}
const groups = []
const pass = message => { groups.push(message); console.log(`AUDIO PASS ${groups.length}: ${message}`) }
let config, seedNumber = 0
watchStoreForProjectChanges(useTimelineStore, TIMELINE_PROJECT_KEYS)
function reset(options = {}) {
  seedNumber++
  const trimStart = options.trimStart ?? 2, trimEnd = options.trimEnd ?? 10, speed = options.speed ?? 2
  useTimelineStore.getState().clearProject()
  useProjectStore.setState({ currentProject: { name: 'Synthetic audio-analysis check', settings: { fps: 24 }, timelines: [] },
    currentProjectHandle: null, currentTimelineId: `synthetic-beats-${seedNumber}` })
  useAssetsStore.setState({ assets: [{ id: 'synthetic-audio', name: 'Synthetic 120 BPM', type: 'audio',
    duration: 12, absolutePath: options.sourcePath || config.wavPath, hasAudio: true, settings: { duration: 12 } }],
  folders: [], previewMode: 'timeline', currentPreview: null, selectedAssetIds: [], isPlaying: false })
  useTimelineStore.setState({
    tracks: [{ id: 'audio', name: 'Synthetic Music', type: 'audio', visible: true, locked: false, muted: false, order: 0 }],
    clips: [{ id: 'beat-clip', assetId: 'synthetic-audio', name: 'Synthetic beats', type: 'audio', trackId: 'audio',
      startTime: 3, duration: (trimEnd - trimStart) / speed, trimStart, trimEnd, sourceDuration: 12,
      sourceTimeScale: 1, speed, enabled: true, effects: [], keyframes: {},
      transform: { positionX: 0, positionY: 0, scaleX: 100, scaleY: 100, rotation: 0, opacity: 100 } }],
    transitions: [], markers: [{ id: 'keep-marker', label: 'Keep marker', time: 11 }], markerCounter: 2,
    selectedClipIds: [], selectedTransitionId: null, selectedMarkerId: null, selectedGap: null,
    activeTrackId: 'audio', playheadPosition: 0, isPlaying: false, playbackRate: 1,
    timelineFps: 24, duration: 14, zoom: 250, clipCounter: 100, inPoint: null, outPoint: null,
    history: [], historyIndex: -1, historyLastChangedAt: 0, snappingEnabled: false, rippleEditMode: false,
    activeTimelineTool: 'select', showTimelineClipThumbnails: false, compoundEditContext: null,
  })
  markProjectClean()
}
function snapshot() {
  const state = useTimelineStore.getState()
  return JSON.parse(JSON.stringify({ markers: state.markers, clips: state.clips, history: state.history,
    historyIndex: state.historyIndex, dirty: isProjectDirty() }))
}
let seed
function Fixture() {
  const [version, setVersion] = React.useState(0)
  React.useEffect(() => { seed = options => flushSync(() => { reset(options); setVersion(value => value + 1) }) }, [])
  return <I18nProvider><div className="h-screen flex flex-col bg-sf-dark-950 text-sf-text-primary">
    <h1 className="p-3 text-sm shrink-0">Velorn · hidden synthetic native audio-analysis check</h1>
    <main className="flex-1 min-h-0 flex flex-col"><Timeline key={version} /></main>
  </div></I18nProvider>
}
async function detect(options) {
  seed(options)
  await waitFor(() => document.querySelector('[data-clip-id="beat-clip"]'), 'synthetic clip mounted')
  const clip = document.querySelector('[data-clip-id="beat-clip"]'), bounds = clip.getBoundingClientRect()
  clip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
    button: 2, clientX: bounds.x + 20, clientY: bounds.y + 20 }))
  await waitFor(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Detect Beats → Markers'), 'actual Detect Beats menu')
  const before = snapshot()
  const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Detect Beats → Markers')
  button.click()
  return { before, button }
}
async function main() {
  assert(fixture?.sandboxed, 'actual Electron renderer is sandboxed')
  assert(window.electronAPI?.analyzeAudio, 'production preload exposes native analysis bridge')
  config = await fixture.config()
  assert((await fixture.status()).hidden, 'window starts hidden')
  const full = await analyzeAudioSource({ absolutePath: config.wavPath }, { includeLoudnessCurve: true, maxCurvePoints: 40 })
  near(full.bpm, 120, 1, 'full 12-second synthetic BPM'); near(full.duration, 12, 0.002, 'full duration')
  assert(full.beats.length >= 20, 'steady beat grid recovered')
  assert(full.loudnessCurve.length <= 40, 'summary curve is bounded')
  assert(JSON.stringify(full).length < 30000, 'only compact analysis crosses IPC')
  pass('Electron native bridge safely analyzes synthetic PCM matching the prior crash dimensions (576,044 bytes, 24 kHz); 120 BPM')

  const trim = await analyzeAudioSource({ path: 'synthetic-120bpm.wav', projectPath: config.projectPath },
    { startSeconds: 2, endSeconds: 10, includeLoudnessCurve: false })
  near(trim.duration, 8, 0.002, 'trimmed analysis duration'); near(trim.bpm, 120, 1, 'trimmed BPM')
  assert(trim.beats.every(time => time >= 0 && time <= 8), 'beat times are relative to selected range')
  assert(!('loudnessCurve' in trim), 'curve omission respected')
  const uri = await analyzeAudioSource({ url: config.fileUrl }, { startSeconds: 3, endSeconds: 9, includeLoudnessCurve: false })
  near(uri.duration, 6, 0.002, 'file URL selection')
  const fractional = await analyzeAudioSource({ absolutePath: config.wavPath },
    { startSeconds: 2.125, endSeconds: 10.125, includeLoudnessCurve: false })
  near(fractional.duration, 8, 0.002, 'fractional range duration')
  near(fractional.onsets[0], 0.375, 0.04, 'fractional trim seeks to the correct source samples')
  pass('portable project-relative path and file URL resolve; native source trims are honored and reported relative to the trim')

  for (const [sourcePath, pattern, label] of [[config.missingPath, /missing|not found|exist|read/i, 'missing file'],
    [config.noAudioPath, /audio|track|stream/i, 'no audio stream'], [config.invalidPath, /decode|probe|invalid|unsupported|media/i, 'invalid media'],
    [config.tooLongPath, /600|10.minute|long|range|limit/i, 'overlength source']]) {
    let rejected = false
    try { await analyzeAudioSource({ absolutePath: sourcePath }, { includeLoudnessCurve: false }) }
    catch (error) { rejected = true; assert(pattern.test(error.message), `${label}: readable error: ${error.message}`) }
    assert(rejected, `${label} must reject`)
  }
  const recovered = await window.electronAPI.analyzeAudio({ source: { absolutePath: config.wavPath },
    options: { startSeconds: 1, endSeconds: 11, includeLoudnessCurve: false } })
  assert(recovered.success && Math.abs(recovered.analysis.bpm - 120) < 1, 'analysis succeeds after errors')
  pass('missing file, no-audio stream, malformed media and overlength selection give clear errors; renderer and native service recover')

  reset()
  createRoot(document.getElementById('root')).render(<Fixture />)
  await waitFor(() => seed, 'Timeline fixture ready')
  const { before } = await detect()
  await waitFor(() => snapshot().markers.length > 1, 'actual Timeline beat markers')
  const after = snapshot(), markers = after.markers.filter(marker => marker.id !== 'keep-marker')
  equal(markers.map(marker => marker.time), trim.beats.map(beat => Math.round((3 + beat / 2) * 24) / 24), 'retimed/trimmed markers')
  equal(after.history.length, before.history.length + 1, 'one atomic checkpoint')
  assert(after.dirty, 'marker insertion dirties the project')
  document.activeElement?.blur()
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'z', code: 'KeyZ', ctrlKey: true }))
  await waitFor(() => snapshot().markers.length === before.markers.length, 'single Timeline Undo shortcut')
  equal(snapshot().markers, before.markers, 'Undo restores original markers')
  equal(snapshot().clips, before.clips, 'Undo preserves all clip timing')
  pass('actual Timeline context menu → Detect Beats produces correctly trimmed 2× markers; exactly one Undo restores markers and clips')

  for (const [index, stale] of ['clip', 'project'].entries()) {
    await fixture.holdNext()
    const pending = await detect({ trimStart: 2.1 + index * 0.1 })
    await waitFor(async () => (await fixture.status()).held, 'native result held for stale race')
    assert(pending.button.disabled, 'Detect Beats is disabled while result is pending')
    if (stale === 'clip') useTimelineStore.setState(state => ({ clips: state.clips.map(clip => ({ ...clip, startTime: 4 })) }))
    else useProjectStore.setState({ currentTimelineId: 'replacement-project-timeline' })
    const staleBefore = snapshot()
    await fixture.release()
    await waitFor(() => document.querySelector('[data-testid="beat-analysis-error"]')?.textContent.includes('changed'), 'visible stale-result refusal')
    equal(snapshot(), staleBefore, `${stale} stale result cannot mutate markers, clip, dirty state or history`)
    pass(`pending ${stale} change rejects the late native result in actual Timeline without markers or Undo checkpoint`)
  }

  const failed = await detect({ sourcePath: config.missingPath, trimStart: 0, trimEnd: 8 })
  await waitFor(() => document.querySelector('[data-testid="beat-analysis-error"]')?.textContent.length, 'visible missing-file error')
  equal(snapshot(), failed.before, 'failed Timeline analysis leaves authoring state unchanged')
  pass('actual Timeline displays native analysis failure without changing clips, markers, dirty state or history')

  const nativeChecks = await fixture.nativeChecks()
  pass('native missing binary, bounded timeout, busy admission and owner destruction fail safely; child reaped, recovery and app.asar-shaped worker/DSP path succeed')
  const isolation = window.__audioIsolation
  equal(isolation.webAudioCalls, 0, 'no Web Audio constructor or decode invoked')
  equal(isolation.forbidden, [], 'no provider/fetch/filesystem/browser-storage requests')
  equal(isolation.errors, [], 'no renderer errors')
  assert((await fixture.status()).hidden, 'window remains hidden')
  fixture.report({ success: true, groups, nativeChecks, isolation, bpm: full.bpm, trimBpm: trim.bpm,
    markerCount: markers.length, productionPreload: true, sandboxed: fixture.sandboxed })
}
main().catch(error => fixture?.report({ success: false, error: error.stack || error.message, groups, isolation: window.__audioIsolation }))
