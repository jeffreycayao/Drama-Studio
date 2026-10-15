import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { ArrowRightLeft, Image as ImageIcon, Music, Search, Video, X } from 'lucide-react'
import useTimelineStore from '../stores/timelineStore'
import useAssetsStore from '../stores/assetsStore'
import { trapDialogFocus } from '../utils/dialogFocus.mjs'
import { getSmartReplaceSourceMetadata } from '../utils/smartReplace.mjs'

const SNAPSHOT_KEYS = [
  'clips', 'tracks', 'transitions', 'markers', 'timelineFps', 'timelineSessionId',
  'history', 'historyIndex', 'duration', 'isPlaying',
]
const sameSelection = (current, captured) => current.length === captured.length
  && current.every(id => captured.includes(id))
const isLocked = item => item?.locked || item?.syncLocked || item?.lockMode === 'sync'
  || item?.syncLock?.mode === 'sync'
const getMediaKind = (clip, tracks) => tracks.find(track => track.id === clip?.trackId)?.type === 'audio'
  && clip?.type === 'video' ? 'audio' : clip?.type
const formatSeconds = value => Number.isFinite(Number(value))
  ? `${Number(Number(value).toFixed(3))} s` : 'Unknown duration'

// A linked picture-and-sound pair is one editorial selection, but the menu's
// explicit target is the only clip that Smart Replace is allowed to change.
export function getSmartReplaceEligibility(state, clipId) {
  const clip = state.clips.find(candidate => candidate.id === clipId)
  if (!clip || !['video', 'image', 'audio'].includes(clip.type)) {
    return { ok: false, reason: 'Choose one video, image or audio clip.' }
  }
  const selection = state.selectedClipIds || []
  const selected = selection.map(id => state.clips.find(candidate => candidate.id === id))
  const kind = getMediaKind(clip, state.tracks)
  const single = selection.length === 1 && selection[0] === clipId
  const linkedPair = selection.length === 2 && new Set(selection).size === 2
    && selection.includes(clipId) && selected.every(Boolean)
    && selected.some(candidate => getMediaKind(candidate, state.tracks) === 'video')
    && selected.some(candidate => getMediaKind(candidate, state.tracks) === 'audio')
    && typeof clip.linkGroupId === 'string' && clip.linkGroupId.trim()
    && selected.every(candidate => typeof candidate.linkGroupId === 'string' && candidate.linkGroupId.trim() === clip.linkGroupId.trim()
      && state.tracks.find(track => track.id === candidate.trackId)?.type === getMediaKind(candidate, state.tracks))
  if (!single && !linkedPair) return { ok: false, reason: 'Select one clip or its linked video/audio pair. Batch replacement is not available.' }
  const track = state.tracks.find(candidate => candidate.id === clip.trackId)
  if (!track || track.type !== (kind === 'audio' ? 'audio' : 'video')) {
    return { ok: false, reason: 'This clip needs a compatible media track.' }
  }
  if (isLocked(clip) || isLocked(track)) return { ok: false, reason: 'Unlock this clip and its track before replacing media.' }
  return { ok: true, clip, kind }
}

export function captureSmartReplaceSession(state, clipId, returnFocus) {
  const eligibility = getSmartReplaceEligibility(state, clipId)
  if (!eligibility.ok) return null
  return {
    clip: eligibility.clip,
    kind: eligibility.kind,
    clipIds: [...state.selectedClipIds],
    snapshot: Object.fromEntries(SNAPSHOT_KEYS.map(key => [key, state[key]])),
    returnFocus,
  }
}

function AssetThumbnail({ asset }) {
  const [failed, setFailed] = useState(false)
  const url = asset.type === 'image' ? asset.url : asset.poster?.url
  const Icon = asset.type === 'audio' ? Music : asset.type === 'image' ? ImageIcon : Video
  const sprite = asset.sprite
  const frame = sprite?.frames?.[0]
  const useSprite = !url && asset.type === 'video' && sprite?.url && frame?.width > 0 && frame?.height > 0
  const scale = useSprite ? Math.min(64 / frame.width, 42 / frame.height) : 1
  return <span className="flex h-[42px] w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-sf-dark-900 text-sf-text-muted" aria-hidden="true">
    {url && !failed
      ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="h-full w-full object-contain" />
      : useSprite
        ? <span style={{ width: frame.width * scale, height: frame.height * scale, backgroundImage: `url(${sprite.url})`, backgroundSize: `${sprite.width * scale}px ${sprite.height * scale}px`, backgroundPosition: `${-frame.x * scale}px ${-frame.y * scale}px`, backgroundRepeat: 'no-repeat' }} />
        : <Icon className="h-5 w-5" />}
  </span>
}

export default function SmartReplaceDialog({ session, onClose }) {
  const dialogRef = useRef(null)
  const searchRef = useRef(null)
  const applyingRef = useRef(false)
  const [query, setQuery] = useState('')
  const [selectedAsset, setSelectedAsset] = useState(null)
  const [sourceIn, setSourceIn] = useState(String(session.clip.trimStart ?? 0))
  const [error, setError] = useState('')
  const assets = useAssetsStore(state => state.assets)
  const live = useTimelineStore(useShallow(state => ({
    ...Object.fromEntries(SNAPSHOT_KEYS.map(key => [key, state[key]])),
    selectedClipIds: state.selectedClipIds,
    previewSmartReplace: state.previewSmartReplace,
  })))
  const staleTimeline = SNAPSHOT_KEYS.some(key => live[key] !== session.snapshot[key])
    || !sameSelection(live.selectedClipIds, session.clipIds)
  const staleAsset = !!selectedAsset && assets.find(asset => asset.id === selectedAsset.id) !== selectedAsset
  const kind = session.kind || session.clip.type
  const isImage = kind === 'image'
  const validSourceIn = isImage || (sourceIn.trim() !== '' && Number.isFinite(Number(sourceIn)) && Number(sourceIn) >= 0)
  const request = useMemo(() => selectedAsset ? {
    clipId: session.clip.id,
    asset: selectedAsset,
    ...(!isImage ? { sourceInSeconds: Number(sourceIn) } : {}),
  } : null, [session.clip.id, selectedAsset, isImage, sourceIn])
  const preview = useMemo(() => {
    if (!request || staleTimeline || staleAsset || !validSourceIn) return null
    return live.previewSmartReplace?.(request) || { ok: false, reason: 'Smart Replace is unavailable. Close this dialog and try again.' }
  }, [request, staleTimeline, staleAsset, validSourceIn, live])
  const candidates = useMemo(() => assets.filter(asset => asset.type === kind
    && `${asset.name || ''} ${asset.id || ''}`.toLowerCase().includes(query.trim().toLowerCase())), [assets, kind, query])
  const linkedCompanions = session.snapshot.clips.filter(clip => clip.id !== session.clip.id
    && session.clip.linkGroupId && clip.linkGroupId === session.clip.linkGroupId)
  const warnings = (preview?.warnings || []).filter(warning => !(linkedCompanions.length > 0
    && warning === 'Only this clip instance is replaced. Linked picture or audio clips keep their current sources.'))
  const canApply = !staleTimeline && !staleAsset && validSourceIn && preview?.ok && preview.changed !== false
  const status = staleTimeline ? 'The timeline or selection changed. Close this dialog and reopen Smart Replace to review the current clip.'
    : staleAsset ? 'This replacement asset changed or was removed. Choose it again before replacing media.'
      : !validSourceIn ? 'Enter a Source In of zero or more seconds.'
        : error || (!selectedAsset ? 'Choose replacement media from this project.'
          : !preview?.ok ? preview?.reason || 'This media cannot replace the clip.'
            : preview.changed === false ? 'This is already the current media and source start. Nothing to replace.'
              : 'Ready to replace this clip. One Undo restores the original media.')
  const hasError = staleTimeline || staleAsset || !validSourceIn || !!error || (selectedAsset && preview && !preview.ok)

  useLayoutEffect(() => {
    const returnFocus = session.returnFocus || document.activeElement
    const focusFirst = () => (searchRef.current || dialogRef.current)?.focus()
    const handleKeyDown = event => {
      event.stopImmediatePropagation()
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      else trapDialogFocus(event, dialogRef.current)
    }
    const handleKeyUp = event => event.stopImmediatePropagation()
    const containFocus = event => {
      if (!dialogRef.current?.contains(event.target)) focusFirst()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    document.addEventListener('focusin', containFocus, true)
    focusFirst()
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      document.removeEventListener('focusin', containFocus, true)
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [onClose, session])

  const apply = () => {
    if (!canApply || applyingRef.current) return
    const state = useTimelineStore.getState()
    if (SNAPSHOT_KEYS.some(key => state[key] !== session.snapshot[key])
      || !sameSelection(state.selectedClipIds, session.clipIds)) {
      setError('The timeline changed. Close this dialog and reopen Smart Replace before applying.')
      return
    }
    const freshAsset = useAssetsStore.getState().assets.find(asset => asset.id === selectedAsset.id)
    if (freshAsset !== selectedAsset) {
      setError('The replacement asset changed. Choose it again before applying.')
      return
    }
    applyingRef.current = true
    const result = state.applySmartReplace?.({ ...request, asset: freshAsset }, preview.token)
    if (result?.ok) onClose()
    else {
      applyingRef.current = false
      setError(result?.reason || 'This media could not be replaced. Nothing was changed.')
    }
  }

  return createPortal(
    <div
      data-testid="smart-replace-backdrop"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3 sm:p-4"
      onMouseDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose() }}
      onClick={event => event.stopPropagation()}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation() }}
    >
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="smart-replace-title" aria-describedby="smart-replace-description" data-testid="smart-replace-dialog" tabIndex={-1}
        className="flex max-h-[90vh] w-full min-w-0 max-w-xl flex-col overflow-hidden rounded-lg border border-sf-dark-600 bg-sf-dark-800 text-sf-text-primary shadow-2xl">
        <header className="flex flex-shrink-0 items-start gap-3 border-b border-sf-dark-700 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="smart-replace-title" className="text-sm font-medium">Smart Replace</h2>
            <p id="smart-replace-description" className="mt-1 text-xs leading-relaxed text-sf-text-muted">Swap this clip’s media without rebuilding its edit.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close Smart Replace" className="rounded p-1 text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary"><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 space-y-4 overflow-y-auto px-4 py-4">
          <div>
            <label htmlFor="smart-replace-search" className="mb-1.5 block text-xs font-medium">Replacement {kind} from this project</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-sf-text-muted" />
              <input ref={searchRef} id="smart-replace-search" data-testid="smart-replace-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search project assets" className="w-full min-w-0 rounded border border-sf-dark-600 bg-sf-dark-900 py-2 pl-8 pr-2 text-xs" />
            </div>
            <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded border border-sf-dark-600 p-1" aria-label="Compatible project assets">
              {candidates.map(asset => {
                const { sourceDuration } = getSmartReplaceSourceMetadata(asset)
                const durationLabel = asset.type === 'image' ? 'Still image' : sourceDuration != null ? formatSeconds(sourceDuration) : 'Duration unavailable'
                return <button key={asset.id} type="button" data-testid="smart-replace-asset" data-asset-id={asset.id} aria-pressed={selectedAsset?.id === asset.id} disabled={staleTimeline}
                  onClick={() => { setSelectedAsset(asset); setError('') }}
                  className={`flex w-full min-w-0 items-center gap-2.5 rounded border px-2 py-1.5 text-left text-xs disabled:opacity-50 ${selectedAsset?.id === asset.id ? 'border-sf-accent/60 bg-sf-accent/10' : 'border-transparent hover:bg-sf-dark-700'}`}>
                  <AssetThumbnail key={`${asset.id}:${asset.url}:${asset.poster?.url}`} asset={asset} />
                  <span className="min-w-0 flex-1"><span className="block break-words font-medium">{asset.name || asset.id}</span><span className="mt-0.5 block text-sf-text-muted">{durationLabel}{asset.id === session.clip.assetId ? ' · Current media' : ''}</span></span>
                </button>
              })}
              {!candidates.length && <p className="px-2 py-4 text-xs leading-relaxed text-sf-text-muted">{query.trim() ? 'No matching assets.' : `No ${kind} assets in this project. Import or generate replacement media first.`}</p>}
            </div>
          </div>
          {!isImage && <div>
            <label htmlFor="smart-replace-source-in" className="mb-1.5 block text-xs font-medium">Source In (seconds)</label>
            <div className="flex flex-wrap items-center gap-2">
              <input id="smart-replace-source-in" data-testid="smart-replace-source-in" type="number" min="0" step="any" value={sourceIn} disabled={staleTimeline}
                onChange={event => { setSourceIn(event.target.value); setError('') }} className="min-w-0 flex-1 rounded border border-sf-dark-600 bg-sf-dark-900 px-2.5 py-2 text-xs disabled:opacity-50" />
              <button type="button" data-testid="smart-replace-from-start" disabled={staleTimeline} onClick={() => { setSourceIn('0'); setError('') }} className="rounded border border-sf-dark-600 px-2.5 py-2 text-xs hover:bg-sf-dark-700 disabled:opacity-50">Start at beginning</button>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-sf-text-muted">Starts at the current trim ({formatSeconds(session.clip.trimStart ?? 0)}) by default. Short media is never stretched or used to shorten the edit.</p>
          </div>}
          <div data-testid="smart-replace-summary" className="space-y-2 rounded border border-sf-dark-600 bg-sf-dark-900/50 px-3 py-2.5 text-xs leading-relaxed">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="min-w-0 break-words">{session.clip.name || session.clip.id}</span><ArrowRightLeft className="h-3 w-3 flex-shrink-0 text-sf-text-muted" /><span className="min-w-0 break-words font-medium">{selectedAsset?.name || selectedAsset?.id || 'Choose replacement'}</span></div>
            <p>Keep {formatSeconds(session.clip.duration)} on the timeline at {formatSeconds(session.clip.startTime)}. The clip label stays unchanged.</p>
            <p className="text-sf-text-muted">Timing, transforms, color, effects, masks, animation and audio settings stay unchanged.</p>
            {!isImage && Number.isFinite(preview?.summary?.requiredSourceEnd) && <p className="text-sf-text-muted">Required source, including transition handles: {formatSeconds(preview.summary.requiredSourceStart ?? preview.summary.sourceInSeconds)}–{formatSeconds(preview.summary.requiredSourceEnd)}{preview.summary.sourceDuration != null ? ` of ${formatSeconds(preview.summary.sourceDuration)}` : ''}.</p>}
            {linkedCompanions.length > 0 && <p className="text-amber-200">Linked audio/video stays unchanged. Only this {kind} clip is replaced.</p>}
            {warnings.map((warning, index) => <p key={index} className="text-amber-200">{warning}</p>)}
          </div>
          <p data-testid="smart-replace-status" role={hasError ? 'alert' : 'status'} aria-live="polite" className={`rounded border px-3 py-2 text-xs leading-relaxed ${hasError ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-sf-dark-600 text-sf-text-muted'}`}>{status}</p>
        </div>
        <footer className="flex flex-shrink-0 flex-wrap justify-end gap-2 border-t border-sf-dark-700 px-4 py-3">
          <button type="button" data-testid="smart-replace-cancel" onClick={onClose} className="rounded border border-sf-dark-600 px-3 py-1.5 text-xs hover:bg-sf-dark-700">Cancel</button>
          <button type="button" data-testid="smart-replace-apply" onClick={apply} disabled={!canApply} className="rounded bg-sf-accent px-3 py-1.5 text-xs font-medium text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">Replace Media</button>
        </footer>
      </section>
    </div>, document.body,
  )
}
