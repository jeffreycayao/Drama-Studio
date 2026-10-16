import { useCallback, useEffect, useMemo, useState } from 'react'
import { Cloud, Download, FolderSearch, Loader2, Music, Plus, RotateCw, Wand2, X } from 'lucide-react'
import { askStoryAssistant } from '../services/storyAssistant'
import { SONGWRITER_SYSTEM, buildSongwriterPrompt, parseSongwriterResponse } from '../utils/songwriter.mjs'
import useTimelineStore from '../stores/timelineStore'
import useAssetsStore from '../stores/assetsStore'
import {
  MUSIC_BPM_MAX,
  MUSIC_BPM_MIN,
  MUSIC_DURATION_MAX,
  MUSIC_DURATION_MIN,
  MUSIC_JOBS_UPDATED_EVENT,
  MUSIC_KEY_SCALES,
  MUSIC_TIME_SIGNATURES,
  MUSIC_VARIATIONS_MAX,
  checkMusicModelDependencies,
  getMusicJobs,
  normalizeMusicDuration,
  queueMusicGeneration,
} from '../services/musicGeneration'
import { checkLocalComfyConnection } from '../services/localComfyConnection'
import { useWorkflowSetupFlow } from '../hooks/useWorkflowSetupFlow'
import { formatBytes } from '../hooks/useWorkflowSetupFlow'
import useMusicPopoverStore from '../stores/musicPopoverStore'
import { MUSIC_ENGINES, clampEngineDuration, getMusicEngine, validateMusicEngineRequest } from '../utils/musicEngines.mjs'

/**
 * Number field that lets you type freely and only clamps to [min, max] when
 * you finish (blur or Enter) — a controlled input that clamped on every
 * keystroke would snap "1" to the minimum before you could type "140".
 */
function ClampedNumberField({ value, min, max, onCommit, className }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])

  const commit = () => {
    const parsed = Number(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(String(value))
      return
    }
    const clamped = Math.max(min, Math.min(max, Math.round(parsed)))
    setDraft(String(clamped))
    onCommit(clamped)
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
      className={className}
    />
  )
}

/**
 * "Generate music for this range" — text-to-music scoped to the timeline.
 * Engines: ACE-Step (default), YuE2 songs, Stable Audio Open underscore and
 * MiniMax Music 3 on Comfy Cloud (asks before spending credits). Duration prefills from the in/out range (or remaining timeline
 * length at the playhead) so takes land exactly to picture; finished takes
 * drop onto an audio track at the range start with one click.
 */
export default function GenerateMusicPopover({ onClose, anchorRect = null }) {
  const {
    inPoint,
    outPoint,
    playheadPosition,
    duration,
  } = useTimelineStore()
  const getAssetById = useAssetsStore((state) => state.getAssetById)

  const rangeStart = Number.isFinite(inPoint) && inPoint !== null ? inPoint : null
  const rangeEnd = Number.isFinite(outPoint) && outPoint !== null ? outPoint : null
  const hasRange = rangeStart !== null && rangeEnd !== null && rangeEnd > rangeStart
  const prefillDuration = hasRange
    ? normalizeMusicDuration(rangeEnd - rangeStart)
    : normalizeMusicDuration(Math.max(10, (Number(duration) || 30) - (Number(playheadPosition) || 0)))
  const dropTime = hasRange ? rangeStart : (Number(playheadPosition) || 0)

  // Persisted form state (survives popover close and app restart).
  const {
    tags,
    instrumental,
    lyrics,
    durationSeconds,
    variations,
    bpm,
    keyScale,
    timeSignature,
    engine: storedEngine,
    sessionPromptIds,
    setMusicField,
    appendSessionPromptIds,
  } = useMusicPopoverStore()

  const engineInfo = getMusicEngine(storedEngine)
  const engine = engineInfo.id
  const isCloudEngine = engineInfo.route === 'cloud'
  const engineDuration = engine === 'ace-step' ? durationSeconds : clampEngineDuration(engine, durationSeconds)
  const requestCheck = validateMusicEngineRequest(engine, { tags, lyrics, instrumental })
  // Cloud runs go through an explicit confirm step that names the spend.
  const [confirmingCloud, setConfirmingCloud] = useState(false)
  useEffect(() => { setConfirmingCloud(false) }, [engine, variations])

  const [isQueueing, setIsQueueing] = useState(false)
  const [queueError, setQueueError] = useState('')
  // AI songwriter: fills title, style tags, BPM, key and sectioned lyrics
  // from a short brief using the Assistant model chosen in Settings.
  const [songBrief, setSongBrief] = useState('')
  const [songStatus, setSongStatus] = useState({ busy: false, text: '' })
  const writeSong = async () => {
    if (songStatus.busy) return
    setSongStatus({ busy: true, text: 'Writing…' })
    try {
      const prompt = buildSongwriterPrompt({ brief: songBrief, durationSeconds: Number(durationSeconds) || 60, instrumental })
      const { text } = await askStoryAssistant({ system: SONGWRITER_SYSTEM, prompt, requestId: `songwriter-${Date.now()}` })
      const song = parseSongwriterResponse(text, { instrumental })
      if (!song.ok) { setSongStatus({ busy: false, text: song.reason }); return }
      setMusicField('tags', song.tags)
      setMusicField('bpm', song.bpm)
      setMusicField('keyScale', song.keyScale)
      if (!instrumental) setMusicField('lyrics', song.lyrics)
      setSongStatus({ busy: false, text: `“${song.title}” · ${song.bpm} BPM · ${song.keyScale}. Edit anything, then generate.` })
    } catch (error) {
      setSongStatus({ busy: false, text: error?.message || 'The songwriter could not write this song.' })
    }
  }
  const [jobs, setJobs] = useState([])

  // When opened over an in/out range, prefill duration to match it (that's
  // the point of "generate music for this range"). Runs once per open.
  useEffect(() => {
    if (hasRange) setMusicField('durationSeconds', prefillDuration)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Model availability: check the shared 'music-gen' dependency once on open
  // (and after installs) so the popover can offer a download instead of
  // failing at generate time.
  const [isConnected, setIsConnected] = useState(false)
  const [dependencyCheck, setDependencyCheck] = useState({ status: 'idle', hasPack: true, hasBlockingIssues: false })

  const recheckModels = useCallback(async () => {
    const result = await checkMusicModelDependencies(engine)
    if (result) setDependencyCheck(result)
    return result
  }, [engine])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const connection = await checkLocalComfyConnection().catch(() => null)
      if (cancelled) return
      const connected = Boolean(connection?.ok)
      setIsConnected(connected)
      if (connected) await recheckModels()
    })()
    return () => { cancelled = true }
  }, [recheckModels])

  const setupFlow = useWorkflowSetupFlow({ dependencyCheck, isConnected, recheck: recheckModels })
  const modelsMissing = setupFlow.mode !== 'hidden' && setupFlow.mode !== 'installing' && setupFlow.mode !== 'restarting'
  const modelsInstalling = setupFlow.mode === 'installing' || setupFlow.phase === 'restarting'

  const refreshJobs = useCallback(() => {
    if (sessionPromptIds.length === 0) return
    setJobs(getMusicJobs(sessionPromptIds))
  }, [sessionPromptIds])

  useEffect(() => {
    refreshJobs()
    window.addEventListener(MUSIC_JOBS_UPDATED_EVENT, refreshJobs)
    return () => window.removeEventListener(MUSIC_JOBS_UPDATED_EVENT, refreshJobs)
  }, [refreshJobs])

  const handleGenerate = useCallback(async () => {
    if (isCloudEngine && !confirmingCloud) {
      setConfirmingCloud(true)
      return
    }
    setConfirmingCloud(false)
    setIsQueueing(true)
    setQueueError('')
    try {
      const queued = await queueMusicGeneration({
        tags,
        lyrics,
        instrumental,
        durationSeconds: engineDuration,
        variations,
        bpm,
        keyScale,
        timeSignature,
        engine,
        allowCloudSpend: isCloudEngine,
      })
      appendSessionPromptIds(queued.map((job) => job.promptId))
    } catch (err) {
      setQueueError(err?.message || `Could not queue the music generation. Is ComfyUI connected and ${engineInfo.label} set up?`)
    } finally {
      setIsQueueing(false)
    }
  }, [tags, lyrics, instrumental, engineDuration, variations, bpm, keyScale, timeSignature, engine, engineInfo.label, isCloudEngine, confirmingCloud, appendSessionPromptIds])

  const handleAddToTimeline = useCallback((assetId) => {
    const asset = getAssetById(assetId)
    if (!asset) return
    const state = useTimelineStore.getState()
    const audioTracks = (state.tracks || []).filter((track) => track.type === 'audio')
    const clipLength = Number(asset.duration) || durationSeconds
    // Prefer an audio track with free space at the drop time; otherwise add one.
    let targetTrack = audioTracks.find((track) => !(state.clips || []).some((clip) => (
      clip.trackId === track.id
      && dropTime < clip.startTime + clip.duration
      && clip.startTime < dropTime + clipLength
    )))
    if (!targetTrack && typeof state.addTrack === 'function') {
      state.addTrack('audio')
      const nextTracks = useTimelineStore.getState().tracks || []
      targetTrack = [...nextTracks].reverse().find((track) => track.type === 'audio') || null
    }
    if (!targetTrack?.id) return
    useTimelineStore.getState().addClip(targetTrack.id, asset, dropTime)
  }, [dropTime, durationSeconds, getAssetById])

  const activeCount = useMemo(() => jobs.filter((job) => job.status === 'queued' || job.status === 'running').length, [jobs])

  // Fixed positioning so the panel escapes the timeline toolbar's
  // overflow-hidden/overflow-x-auto containers (which clip an absolutely
  // positioned popover). Anchor under the triggering button, clamped to the
  // viewport; flip above the anchor if it would run off the bottom.
  const PANEL_WIDTH = 320
  const positionStyle = useMemo(() => {
    if (typeof window === 'undefined' || !anchorRect) {
      return { left: '50%', top: '20%', transform: 'translateX(-50%)' }
    }
    const margin = 8
    const left = Math.max(margin, Math.min(anchorRect.left, window.innerWidth - PANEL_WIDTH - margin))
    const spaceBelow = window.innerHeight - anchorRect.bottom
    if (spaceBelow < 360 && anchorRect.top > spaceBelow) {
      return { left: `${left}px`, bottom: `${window.innerHeight - anchorRect.top + margin}px` }
    }
    return { left: `${left}px`, top: `${anchorRect.bottom + margin}px` }
  }, [anchorRect])

  return (
    <>
      <div className="fixed inset-0 z-40" onMouseDown={onClose} aria-hidden="true" />
      <div
        className="fixed z-50 max-h-[80vh] w-80 overflow-y-auto rounded-lg border border-sf-dark-600 bg-sf-dark-800 p-3 shadow-2xl"
        style={positionStyle}
        onMouseDown={(event) => event.stopPropagation()}
      >
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-sf-text-primary">
          <Music className="h-3.5 w-3.5 text-sf-accent" />
          Generate Music
        </span>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-sf-text-muted hover:bg-sf-dark-600 hover:text-sf-text-primary"
          aria-label="Close music generator"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <label className="mb-0.5 block text-[10px] text-sf-text-muted">Engine</label>
      <select
        value={engine}
        onChange={(event) => setMusicField('engine', event.target.value)}
        data-testid="music-engine"
        aria-label="Music engine"
        className="mb-1 w-full rounded border border-sf-dark-600 bg-sf-dark-900 px-1 py-1 text-xs text-sf-text-primary focus:border-sf-accent focus:outline-none"
      >
        {MUSIC_ENGINES.map((option) => (
          <option key={option.id} value={option.id}>{option.label}</option>
        ))}
      </select>
      {engineInfo.note && (
        <p className={`mb-2 flex gap-1 text-[10px] ${isCloudEngine ? 'text-amber-200/90' : 'text-sf-text-muted'}`}>
          {isCloudEngine && <Cloud className="mt-px h-3 w-3 shrink-0" />}
          <span>{engineInfo.note}</span>
        </p>
      )}

      <label className="mb-0.5 block text-[10px] text-sf-text-muted">Write with AI</label>
      <div className="mb-1 flex gap-1.5">
        <input
          value={songBrief}
          onChange={(event) => setSongBrief(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); writeSong() } }}
          placeholder="What is the scene? e.g. lovers part at a rainy bus stop"
          aria-label="Song brief"
          className="min-w-0 flex-1 rounded border border-sf-dark-600 bg-sf-dark-900 px-2 py-1.5 text-xs text-sf-text-primary focus:border-sf-accent focus:outline-none"
        />
        <button
          type="button"
          data-testid="music-write-song"
          onClick={writeSong}
          disabled={songStatus.busy || !songBrief.trim()}
          title="Write title, style tags, BPM, key and lyrics with the Assistant model"
          className="inline-flex items-center gap-1 rounded border border-sf-dark-600 bg-sf-dark-800 px-2 py-1 text-[10px] text-sf-text-primary hover:bg-sf-dark-700 disabled:opacity-40"
        >
          {songStatus.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
          Write
        </button>
      </div>
      {songStatus.text && <p role="status" className="mb-2 text-[10px] text-sf-text-secondary">{songStatus.text}</p>}

      <label className="mb-0.5 block text-[10px] text-sf-text-muted">{engineInfo.lyrics === 'none' ? 'Describe the sound' : 'Style tags'}</label>
      <textarea
        value={tags}
        onChange={(event) => setMusicField('tags', event.target.value)}
        rows={2}
        placeholder="genre, mood, instruments, tempo — e.g. warm lo-fi hip hop, mellow keys, 85 bpm"
        className="mb-2 w-full resize-none rounded border border-sf-dark-600 bg-sf-dark-900 px-2 py-1.5 text-xs text-sf-text-primary focus:border-sf-accent focus:outline-none"
      />

      {engineInfo.lyrics === 'optional' && (
        <label className="mb-2 flex items-center gap-2 text-[10px] text-sf-text-secondary">
          <input
            type="checkbox"
            checked={instrumental}
            onChange={(event) => setMusicField('instrumental', event.target.checked)}
          />
          Instrumental
        </label>
      )}

      {(engineInfo.lyrics === 'required' || (engineInfo.lyrics === 'optional' && !instrumental)) && (
        <>
          <label className="mb-0.5 block text-[10px] text-sf-text-muted">
            Lyrics — use [verse], [chorus], [bridge] structure tags
          </label>
          <textarea
            value={lyrics}
            onChange={(event) => setMusicField('lyrics', event.target.value)}
            rows={4}
            placeholder={'[verse]\nNeon rivers running through the night\n[chorus]\nWe glow, we glow...'}
            className="mb-2 w-full resize-none rounded border border-sf-dark-600 bg-sf-dark-900 px-2 py-1.5 text-xs text-sf-text-primary focus:border-sf-accent focus:outline-none"
          />
        </>
      )}

      <div className="mb-2 grid grid-cols-2 gap-2">
        <div>
          <label className="mb-0.5 block text-[10px] text-sf-text-muted">
            Duration {hasRange ? '(from in/out range)' : '(s)'}
          </label>
          <ClampedNumberField
            value={engineDuration}
            min={engine === 'ace-step' ? MUSIC_DURATION_MIN : engineInfo.minDuration}
            max={engine === 'ace-step' ? MUSIC_DURATION_MAX : engineInfo.maxDuration}
            onCommit={(next) => setMusicField('durationSeconds', next)}
            className="w-full rounded border border-sf-dark-600 bg-sf-dark-900 px-2 py-1 text-xs text-sf-text-primary focus:border-sf-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] text-sf-text-muted">Variations</label>
          <ClampedNumberField
            value={variations}
            min={1}
            max={MUSIC_VARIATIONS_MAX}
            onCommit={(next) => setMusicField('variations', next)}
            className="w-full rounded border border-sf-dark-600 bg-sf-dark-900 px-2 py-1 text-xs text-sf-text-primary focus:border-sf-accent focus:outline-none"
          />
        </div>
      </div>

      {engineInfo.usesBpmKey && (
      <div className="mb-2 grid grid-cols-3 gap-2">
        <div>
          <label className="mb-0.5 block text-[10px] text-sf-text-muted">BPM</label>
          <ClampedNumberField
            value={bpm}
            min={MUSIC_BPM_MIN}
            max={MUSIC_BPM_MAX}
            onCommit={(next) => setMusicField('bpm', next)}
            className="w-full rounded border border-sf-dark-600 bg-sf-dark-900 px-2 py-1 text-xs text-sf-text-primary focus:border-sf-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] text-sf-text-muted">Key</label>
          <select
            value={keyScale}
            onChange={(event) => setMusicField('keyScale', event.target.value)}
            className="w-full rounded border border-sf-dark-600 bg-sf-dark-900 px-1 py-1 text-xs text-sf-text-primary focus:border-sf-accent focus:outline-none"
          >
            {MUSIC_KEY_SCALES.map((scale) => (
              <option key={scale} value={scale}>{scale}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] text-sf-text-muted">Time sig</label>
          <select
            value={timeSignature}
            onChange={(event) => setMusicField('timeSignature', event.target.value)}
            className="w-full rounded border border-sf-dark-600 bg-sf-dark-900 px-1 py-1 text-xs text-sf-text-primary focus:border-sf-accent focus:outline-none"
          >
            {MUSIC_TIME_SIGNATURES.map((sig) => (
              <option key={sig} value={sig}>{sig}/4</option>
            ))}
          </select>
        </div>
      </div>
      )}

      {isConnected && modelsMissing && (
        <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 p-2">
          {setupFlow.mode === 'choose-root' ? (
            <>
              <p className="mb-1.5 text-[10px] text-amber-200/90">
                The {engineInfo.label} model isn't set up yet. Point Drama Studio at your ComfyUI folder to download it.
              </p>
              <button
                onClick={setupFlow.chooseComfyFolder}
                className="flex w-full items-center justify-center gap-1.5 rounded border border-amber-500/50 bg-amber-500/15 px-2 py-1 text-[10px] text-amber-100 hover:bg-amber-500/25"
              >
                <FolderSearch className="h-3 w-3" />
                Choose ComfyUI folder
              </button>
            </>
          ) : setupFlow.mode === 'needs-auth' ? (
            <p className="text-[10px] text-amber-200/90">
              {engineInfo.label} needs a Comfy.org API key. Add it in Settings, then reopen this panel.
            </p>
          ) : setupFlow.mode === 'manual-only' ? (
            <p className="text-[10px] text-amber-200/90">
              {engineInfo.label} needs a manual install or a ComfyUI update. No curated download covers everything it needs.
            </p>
          ) : setupFlow.mode === 'needs-restart' ? (
            <>
              <p className="mb-1.5 text-[10px] text-amber-200/90">Models installed. Restart ComfyUI to load them.</p>
              <button
                onClick={setupFlow.restartNow}
                className="flex w-full items-center justify-center gap-1.5 rounded border border-amber-500/50 bg-amber-500/15 px-2 py-1 text-[10px] text-amber-100 hover:bg-amber-500/25"
              >
                <RotateCw className="h-3 w-3" />
                Restart ComfyUI
              </button>
            </>
          ) : (
            <>
              <p className="mb-1.5 text-[10px] text-amber-200/90">
                The {engineInfo.label} model isn't installed yet
                {setupFlow.totalDownloadBytes > 0 ? ` (~${formatBytes(setupFlow.totalDownloadBytes)}${setupFlow.unknownSizeCount > 0 ? ` + ${setupFlow.unknownSizeCount} more` : ''})` : ''}.
              </p>
              {setupFlow.insufficientDiskSpace && (
                <p className="mb-1.5 text-[10px] text-sf-error">Not enough free disk space for the download.</p>
              )}
              <button
                onClick={setupFlow.startSetup}
                disabled={setupFlow.insufficientDiskSpace}
                className="flex w-full items-center justify-center gap-1.5 rounded border border-amber-500/50 bg-amber-500/15 px-2 py-1 text-[10px] text-amber-100 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download className="h-3 w-3" />
                Download model
              </button>
            </>
          )}
          {setupFlow.error && <p className="mt-1 text-[9px] text-sf-error">{setupFlow.error}</p>}
        </div>
      )}

      {modelsInstalling && (
        <div className="mb-2 rounded border border-sf-dark-600 bg-sf-dark-900 p-2">
          <p className="mb-1 flex items-center gap-1.5 text-[10px] text-sf-text-secondary">
            <Loader2 className="h-3 w-3 animate-spin" />
            {setupFlow.progress.currentLabel
              ? `Downloading ${setupFlow.progress.currentLabel}...`
              : 'Installing music model...'}
          </p>
          <div className="h-1 w-full overflow-hidden rounded bg-sf-dark-700">
            <div
              className="h-full bg-sf-accent transition-all"
              style={{ width: `${setupFlow.progress.overallPercent || 0}%` }}
            />
          </div>
        </div>
      )}

      {confirmingCloud && (
        <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[10px] text-amber-100" role="alert">
          This queues {variations} paid run{variations > 1 ? 's' : ''} of {engineInfo.label} on Comfy Cloud. Each run is billed by GPU time, so the total is only known afterwards.
          <button type="button" onClick={() => setConfirmingCloud(false)} className="ml-1 underline hover:text-amber-50">Cancel</button>
        </div>
      )}
      {!requestCheck.ok && tags.trim() && (
        <p className="mb-2 text-[10px] text-sf-text-muted">{requestCheck.reason}</p>
      )}

      <button
        onClick={handleGenerate}
        data-testid="music-generate"
        disabled={isQueueing || !requestCheck.ok || (isConnected && modelsMissing) || modelsInstalling}
        className="mb-2 flex w-full items-center justify-center gap-1.5 rounded bg-sf-accent/90 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sf-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isQueueing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Music className="h-3.5 w-3.5" />}
        {isQueueing
          ? 'Queueing...'
          : confirmingCloud
            ? `Spend credits: generate ${variations > 1 ? `${variations} takes` : 'music'}`
            : `Generate ${variations > 1 ? `${variations} takes` : 'music'}`}
      </button>

      {queueError && (
        <p className="mb-2 text-[10px] text-sf-error">{queueError}</p>
      )}

      {jobs.length > 0 && (
        <div className="max-h-48 space-y-1.5 overflow-y-auto border-t border-sf-dark-700 pt-2">
          {activeCount > 0 && (
            <p className="text-[10px] text-sf-text-muted">
              {activeCount} take{activeCount > 1 ? 's' : ''} generating — speed depends on your ComfyUI GPU.
            </p>
          )}
          {jobs.map((job) => (
            <div key={job.promptId} className="rounded border border-sf-dark-700 bg-sf-dark-900 px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[10px] text-sf-text-secondary" title={job.tags}>
                  Seed {job.seed} — {job.durationSeconds}s
                </span>
                {(job.status === 'queued' || job.status === 'running') && (
                  <span className="flex items-center gap-1 text-[10px] text-sf-text-muted">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {job.status}
                  </span>
                )}
                {job.status === 'failed' && (
                  <span className="text-[10px] text-sf-error" title={job.error || ''}>failed</span>
                )}
              </div>
              {job.status === 'failed' && job.error && (
                <p className="mt-0.5 text-[9px] text-sf-error/80">{job.error}</p>
              )}
              {job.status === 'completed' && job.assetIds.map((assetId) => {
                const asset = getAssetById(assetId)
                return (
                  <div key={assetId} className="mt-1 space-y-1">
                    {asset?.url && (
                      <audio controls src={asset.url} className="h-7 w-full" />
                    )}
                    <button
                      onClick={() => handleAddToTimeline(assetId)}
                      className="flex w-full items-center justify-center gap-1 rounded border border-sf-accent/50 bg-sf-accent/15 px-2 py-1 text-[10px] text-sf-accent transition-colors hover:bg-sf-accent/25"
                    >
                      <Plus className="h-3 w-3" />
                      Add at {hasRange ? 'range start' : 'playhead'} ({dropTime.toFixed(1)}s)
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
      </div>
    </>
  )
}
