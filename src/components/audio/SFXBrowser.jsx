import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, Square, Search, RefreshCw, Download, Check, ChevronRight, ChevronDown, FolderOpen, Pause } from 'lucide-react'
import useAssetsStore from '../../stores/assetsStore'
import useProjectStore from '../../stores/projectStore'
import {
  buildSfxIndex, searchSfx, listSfxCategories, sortSfxResults, groupSfxByFolder, SFX_SORTS, SFX_DRAG_TYPE, formatBytes,
} from '../../types/sfx.js'
import {
  loadSfxCatalog, getSfxPreviewSource, getSfxStatus, prefetchSfx, setActiveSfxDrag, resolveSfxDropToAsset, isSfxLibraryAvailable, sfxPack,
} from '../../services/sfxManager'

const PAGE_SIZE = 300
const VIEW_STORAGE_KEY = 'drama-sfx-browser-view'

const formatDuration = seconds => seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}` : `${(seconds || 0).toFixed(1)} s`

function readView() {
  try {
    const value = JSON.parse(localStorage.getItem(VIEW_STORAGE_KEY) || '{}')
    return { sort: SFX_SORTS.some(item => item.id === value.sort) ? value.sort : 'relevance', grouped: value.grouped !== false }
  } catch { return { sort: 'relevance', grouped: true } }
}
function writeView(view) {
  try { localStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(view)) } catch { /* per-viewer convenience only */ }
}

/** Peak bars for a cached file, drawn from the existing waveform IPC. */
function Waveform({ url, progress }) {
  const [peaks, setPeaks] = useState(null)
  useEffect(() => {
    let alive = true
    setPeaks(null)
    if (!url || !url.startsWith('comfystudio://')) return undefined
    window.electronAPI?.getAudioWaveform?.(url, { sampleCount: 160, sampleRate: 4000 })
      .then(result => { if (alive && result?.success) setPeaks(result.peaks) })
      .catch(() => {})
    return () => { alive = false }
  }, [url])
  return <svg viewBox="0 0 160 24" preserveAspectRatio="none" className="w-full h-6" aria-hidden="true">
    {peaks
      ? peaks.map((peak, index) => <rect key={index} x={index} width="0.8" y={12 - Math.max(0.5, peak * 11)} height={Math.max(1, peak * 22)}
        className={index / peaks.length <= progress ? 'fill-sf-accent' : 'fill-sf-text-muted'} />)
      : <rect x="0" y="11" width={160 * progress} height="2" className="fill-sf-accent" />}
  </svg>
}

/** Install card for the private R2 pack (shown until it is installed). */
function PackInstallCard({ catalog, onInstalled }) {
  const [pack, setPack] = useState(null)
  const [confirm, setConfirm] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    sfxPack.status().then(setPack).catch(() => {})
    return sfxPack.onProgress(next => {
      setPack(next)
      if (next?.state === 'done') onInstalled()
    })
  }, [onInstalled])
  const act = async fn => {
    setMessage('')
    try { setPack(await fn()) } catch (error) { setMessage(error.message) }
  }
  const running = pack?.state === 'running'
  const extracting = running && pack?.phase === 'extract'
  const percent = extracting
    ? (pack.total ? Math.round((pack.completed + pack.skipped) / pack.total * 100) : 0)
    : (pack?.bytesTotal ? Math.min(100, Math.round(pack.bytesDone / pack.bytesTotal * 100)) : 0)
  const size = catalog.remoteBytes || pack?.bytesTotal || 0
  return <div className="m-3 rounded border border-sf-dark-600 bg-sf-dark-800/60 p-3 space-y-2 text-xs" data-testid="sfx-pack-install">
    <p className="font-medium text-sf-text-primary">Sound-effects pack{size ? ` · ${formatBytes(size)}` : ''}</p>
    {!catalog.hasKeys
      ? <p className="text-sf-text-muted">Add the R2 access keys in <span className="text-sf-text-secondary">Settings › Sound effects library</span> to download the pack.</p>
      : <p className="text-sf-text-muted">Downloads once, unpacks into <span className="text-sf-text-secondary break-all">{catalog.libraryDir}</span>, then works offline.</p>}
    {pack && ['running', 'paused', 'error'].includes(pack.state) && <>
      <div className="h-1.5 rounded bg-sf-dark-700 overflow-hidden" role="progressbar" aria-label="Pack progress" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-sf-accent" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-[10px] text-sf-text-muted">{extracting
        ? `Unpacking ${pack.completed} of ${pack.total} files`
        : `${formatBytes(pack.bytesDone)} of ${formatBytes(pack.bytesTotal)}`}{pack.state === 'paused' ? ' · paused' : ''}</p>
    </>}
    {(pack?.state === 'error' ? pack.message : message) && <p role="alert" className="text-[10px] text-sf-warning break-words">{pack?.state === 'error' ? pack.message : message}</p>}
    {catalog.hasKeys && <div className="flex flex-wrap gap-2">
      {confirm
        ? <>
          <span className="self-center">Download {size ? formatBytes(size) : 'the pack'}?</span>
          <button type="button" className="rounded bg-sf-accent px-2 py-1 text-[11px] font-medium text-sf-accent-on" onClick={() => { setConfirm(false); act(sfxPack.start) }}>Download</button>
          <button type="button" className="rounded border border-sf-dark-600 px-2 py-1 text-[11px]" onClick={() => setConfirm(false)}>Cancel</button>
        </>
        : <>
          {(!pack || ['idle', 'error', 'canceled', 'done'].includes(pack.state)) &&
            <button type="button" className="flex items-center gap-1 rounded bg-sf-accent px-2 py-1 text-[11px] font-medium text-sf-accent-on" onClick={() => setConfirm(true)}>
              <Download className="w-3 h-3" />{pack?.state === 'error' ? 'Try again' : 'Download and install'}</button>}
          {running && !extracting && <button type="button" className="flex items-center gap-1 rounded border border-sf-dark-600 px-2 py-1 text-[11px]" onClick={() => act(sfxPack.pause)}><Pause className="w-3 h-3" />Pause</button>}
          {pack?.state === 'paused' && <button type="button" className="rounded border border-sf-dark-600 px-2 py-1 text-[11px]" onClick={() => act(sfxPack.resume)}>Resume</button>}
          {(running || pack?.state === 'paused') && <button type="button" className="rounded border border-sf-dark-600 px-2 py-1 text-[11px]" onClick={() => act(sfxPack.cancel)}>Cancel</button>}
        </>}
    </div>}
  </div>
}

/** Sound-effects browser: fuzzy search, folder filters, sorting, folder
 * groups, streaming preview and drag-and-drop onto audio tracks (the file
 * downloads, or is read from the local pack, on dragstart). */
export default function SFXBrowser() {
  const projectHandle = useProjectStore(state => state.currentProjectHandle)
  const [catalog, setCatalog] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [category, setCategory] = useState('')
  const [subCategory, setSubCategory] = useState('')
  const [view, setView] = useState(readView)
  const [expanded, setExpanded] = useState(() => new Set())
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [status, setStatus] = useState({})
  const [playing, setPlaying] = useState(null)
  const [progress, setProgress] = useState(0)
  const [busyId, setBusyId] = useState(null)
  const audio = useRef(null)
  const playSerial = useRef(0)

  const load = useCallback(async (refresh = false) => {
    setLoading(true); setError('')
    try { setCatalog(await loadSfxCatalog({ refresh })) } catch (err) { setError(err.message) } finally { setLoading(false) }
  }, [])
  const reloadInstalled = useCallback(() => load(true), [load])
  useEffect(() => {
    load(true)
    const reload = () => load(true)
    window.addEventListener('drama-sfx-settings-changed', reload)
    return () => window.removeEventListener('drama-sfx-settings-changed', reload)
  }, [load])
  useEffect(() => { const timer = setTimeout(() => setDebounced(query), 120); return () => clearTimeout(timer) }, [query])
  useEffect(() => { setVisible(PAGE_SIZE) }, [debounced, category, subCategory, view.sort])
  useEffect(() => writeView(view), [view])

  const index = useMemo(() => buildSfxIndex(catalog?.entries || []), [catalog])
  const categories = useMemo(() => listSfxCategories(catalog?.entries || []), [catalog])
  const subCategories = categories.find(item => item.name === category)?.subCategories || []
  const { results, total } = useMemo(() => {
    const found = searchSfx(index, debounced, { category: category || null, subCategory: subCategory || null, limit: Infinity })
    const sort = view.sort === 'relevance' && !debounced.trim() ? 'folder' : view.sort
    return { results: sortSfxResults(found.results, sort), total: found.total }
  }, [index, debounced, category, subCategory, view.sort])
  const searching = Boolean(debounced.trim())
  const groups = useMemo(() => (view.grouped ? groupSfxByFolder(results) : []), [view.grouped, results])
  const shown = useMemo(() => (view.grouped ? [] : results.slice(0, visible)), [view.grouped, results, visible])

  const refreshStatus = useCallback(ids => {
    getSfxStatus(ids).then(next => setStatus(previous => ({ ...previous, ...next }))).catch(() => {})
  }, [])
  useEffect(() => {
    const ids = view.grouped
      ? groups.filter(group => searching || expanded.has(group.key)).flatMap(group => group.entries).slice(0, 500).map(entry => entry.id)
      : shown.slice(0, 500).map(entry => entry.id)
    if (ids.length) refreshStatus(ids)
  }, [view.grouped, groups, shown, expanded, searching, refreshStatus])

  const stop = useCallback(() => {
    playSerial.current += 1 // Any preview still resolving its source is now stale.
    audio.current?.pause()
    setPlaying(null); setProgress(0)
  }, [])
  useEffect(() => () => audio.current?.pause(), [])

  const play = async entry => {
    if (playing?.id === entry.id) { stop(); return }
    stop()
    const serial = playSerial.current
    try {
      const source = await getSfxPreviewSource(entry.id)
      if (serial !== playSerial.current) return
      if (!audio.current) audio.current = new Audio()
      const element = audio.current
      element.src = source.url // Remote: Chromium streams with Range requests.
      element.ontimeupdate = () => setProgress(element.duration ? element.currentTime / element.duration : 0)
      element.onended = () => { setPlaying(null); setProgress(0) }
      element.onerror = () => { setPlaying(null); setError('This sound could not be played.') }
      setPlaying({ id: entry.id, url: source.url })
      await element.play()
    } catch (err) {
      if (serial !== playSerial.current) return
      setPlaying(null); setError(err?.name === 'AbortError' ? '' : (err.message || 'Preview failed.'))
    }
  }

  const onDragStart = (event, entry) => {
    const payload = { id: entry.id, name: entry.name, duration: entry.duration }
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(SFX_DRAG_TYPE, JSON.stringify(payload))
    event.dataTransfer.setData('text/plain', entry.name)
    setActiveSfxDrag(payload)
    setStatus(previous => ({ ...previous, [entry.id]: previous[entry.id] === 'cached' ? 'cached' : 'downloading' }))
    prefetchSfx(entry.id).then(() => setStatus(previous => ({ ...previous, [entry.id]: 'cached' })))
      .catch(err => { setStatus(previous => ({ ...previous, [entry.id]: 'remote' })); setError(err.message) })
  }

  const addToBin = async entry => {
    setBusyId(entry.id); setError('')
    try {
      await resolveSfxDropToAsset({ id: entry.id, name: entry.name, duration: entry.duration },
        { projectHandle, assetsStore: useAssetsStore, isCurrent: () => useProjectStore.getState().currentProjectHandle === projectHandle })
      setStatus(previous => ({ ...previous, [entry.id]: 'cached' }))
    } catch (err) { setError(err.message) } finally { setBusyId(null) }
  }

  const toggleGroup = key => setExpanded(previous => {
    const next = new Set(previous)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const renderEntry = entry => {
    const state = status[entry.id]
    const isPlaying = playing?.id === entry.id
    return <li key={entry.id} draggable onDragStart={event => onDragStart(event, entry)} onDragEnd={() => setActiveSfxDrag(null)}
      title={entry.description || entry.name} data-testid="sfx-entry"
      className="px-3 py-2 border-b border-sf-dark-800 hover:bg-sf-dark-800/60 cursor-grab active:cursor-grabbing">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => play(entry)} aria-label={isPlaying ? `Stop ${entry.name}` : `Play ${entry.name}`}
          className="p-1 rounded bg-sf-dark-700 hover:bg-sf-dark-600 text-sf-text-primary">{isPlaying ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}</button>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-sf-text-primary truncate">{entry.name}</p>
          <p className="text-[10px] text-sf-text-muted truncate">{view.grouped ? '' : `${entry.category}${entry.subCategory ? ` › ${entry.subCategory}` : ''} · `}{formatDuration(entry.duration)} · {formatBytes(entry.fileSize)}</p>
        </div>
        {state === 'cached'
          ? <Check className="w-3.5 h-3.5 text-sf-success" aria-label="Available offline" />
          : <button type="button" onClick={() => addToBin(entry)} disabled={busyId === entry.id || state === 'downloading' || !projectHandle}
            title="Add to project bin" aria-label={`Add ${entry.name} to project`} className="p-1 rounded hover:bg-sf-dark-700 text-sf-text-muted disabled:opacity-40">
            <Download className={`w-3.5 h-3.5 ${state === 'downloading' || busyId === entry.id ? 'animate-pulse' : ''}`} /></button>}
      </div>
      {isPlaying && <div className="mt-1"><Waveform url={playing.url} progress={progress} /></div>}
      {entry.tags?.length > 0 && <p className="mt-0.5 text-[10px] text-sf-text-muted truncate">{entry.tags.slice(0, 6).join(' · ')}</p>}
    </li>
  }

  if (!isSfxLibraryAvailable()) return <div className="p-4 text-xs text-sf-text-muted">The sound-effects library needs the Drama Studio desktop app.</div>
  const needsPack = catalog?.source === 'r2-pack' && !catalog.installed
  return <div className="h-full flex flex-col min-h-0" data-testid="sfx-browser">
    <div className="p-3 space-y-2 border-b border-sf-dark-700">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sf-text-muted" />
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search sounds (e.g. door slam)"
            aria-label="Search sound effects" className="w-full rounded bg-sf-dark-800 border border-sf-dark-600 pl-7 pr-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent" />
        </div>
        <button type="button" onClick={() => load(true)} disabled={loading} title="Refresh library" aria-label="Refresh library"
          className="p-1.5 rounded hover:bg-sf-dark-700 text-sf-text-muted disabled:opacity-40"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>
      <div className="flex gap-2">
        <select aria-label="Folder" value={category} onChange={event => { setCategory(event.target.value); setSubCategory('') }}
          className="flex-1 min-w-0 rounded bg-sf-dark-800 border border-sf-dark-600 p-1 text-xs text-sf-text-primary">
          <option value="">All folders</option>
          {categories.map(item => <option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}
        </select>
        {subCategories.length > 0 && <select aria-label="Sub-folder" value={subCategory} onChange={event => setSubCategory(event.target.value)}
          className="flex-1 min-w-0 rounded bg-sf-dark-800 border border-sf-dark-600 p-1 text-xs text-sf-text-primary">
          <option value="">All</option>
          {subCategories.map(item => <option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}
        </select>}
      </div>
      <div className="flex items-center gap-2">
        <select aria-label="Sort sounds" value={view.sort} onChange={event => setView(previous => ({ ...previous, sort: event.target.value }))}
          className="flex-1 min-w-0 rounded bg-sf-dark-800 border border-sf-dark-600 p-1 text-xs text-sf-text-primary" data-testid="sfx-sort">
          {SFX_SORTS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[11px] text-sf-text-secondary whitespace-nowrap">
          <input type="checkbox" checked={view.grouped} onChange={event => setView(previous => ({ ...previous, grouped: event.target.checked }))} data-testid="sfx-group" />
          Group by folder
        </label>
      </div>
      {catalog?.configured && !needsPack && <p className="text-[10px] text-sf-text-muted">{total} of {catalog.entries.length} sounds{view.grouped ? ` · ${groups.length} folders` : ''} · drag onto an audio track</p>}
      {catalog?.warning && <p className="text-[10px] text-sf-warning">{catalog.warning}</p>}
      {error && <p role="alert" className="text-[10px] text-sf-warning break-words">{error}</p>}
    </div>
    {catalog && !catalog.configured && <div className="p-4 text-xs text-sf-text-muted space-y-1">
      <p>No sound-effects library is set up yet.</p>
      <p>Add the R2 pack keys or a catalog URL in <span className="text-sf-text-secondary">Settings › Sound effects library</span>.</p>
    </div>}
    {needsPack && <PackInstallCard catalog={catalog} onInstalled={reloadInstalled} />}
    <ul className="flex-1 overflow-y-auto min-h-0" aria-label="Sound effects">
      {view.grouped
        ? groups.map(group => {
          const open = searching || expanded.has(group.key)
          return <li key={group.key} className="border-b border-sf-dark-800">
            <button type="button" onClick={() => toggleGroup(group.key)} aria-expanded={open} data-testid="sfx-group-header"
              className="sticky top-0 z-[1] flex w-full items-center gap-1.5 bg-sf-dark-900 px-3 py-1.5 text-left text-[11px] text-sf-text-secondary hover:text-sf-text-primary">
              {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <FolderOpen className="w-3 h-3 text-sf-accent" />
              <span className="truncate">{group.category}{group.subCategory ? ` › ${group.subCategory}` : ''}</span>
              <span className="ml-auto text-sf-text-muted">{group.entries.length}</span>
            </button>
            {open && <ul>{group.entries.map(renderEntry)}</ul>}
          </li>
        })
        : shown.map(renderEntry)}
      {!view.grouped && results.length > shown.length && <li className="p-3 text-center">
        <button type="button" onClick={() => setVisible(count => count + PAGE_SIZE)}
          className="rounded border border-sf-dark-600 px-3 py-1 text-[11px] text-sf-text-secondary hover:bg-sf-dark-700">
          Show more ({results.length - shown.length} left)</button>
      </li>}
    </ul>
  </div>
}
