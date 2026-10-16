import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, Square, Search, RefreshCw, Download, Check } from 'lucide-react'
import useAssetsStore from '../../stores/assetsStore'
import useProjectStore from '../../stores/projectStore'
import { buildSfxIndex, searchSfx, listSfxCategories, SFX_DRAG_TYPE, formatBytes } from '../../types/sfx.js'
import {
  loadSfxCatalog, getSfxPreviewSource, getSfxStatus, prefetchSfx, setActiveSfxDrag, resolveSfxDropToAsset, isSfxLibraryAvailable,
} from '../../services/sfxManager'

const formatDuration = seconds => seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}` : `${seconds.toFixed(1)} s`

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

/** Sound-effects browser: fuzzy search, category filters, streaming preview
 * and drag-and-drop onto audio tracks (the file downloads on dragstart). */
export default function SFXBrowser() {
  const projectHandle = useProjectStore(state => state.currentProjectHandle)
  const [catalog, setCatalog] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [category, setCategory] = useState('')
  const [subCategory, setSubCategory] = useState('')
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
  useEffect(() => {
    load()
    const reload = () => load(true)
    window.addEventListener('drama-sfx-settings-changed', reload)
    return () => window.removeEventListener('drama-sfx-settings-changed', reload)
  }, [load])
  useEffect(() => { const timer = setTimeout(() => setDebounced(query), 120); return () => clearTimeout(timer) }, [query])

  const index = useMemo(() => buildSfxIndex(catalog?.entries || []), [catalog])
  const categories = useMemo(() => listSfxCategories(catalog?.entries || []), [catalog])
  const subCategories = categories.find(item => item.name === category)?.subCategories || []
  const { results, total } = useMemo(() => searchSfx(index, debounced, { category: category || null, subCategory: subCategory || null }),
    [index, debounced, category, subCategory])

  const refreshStatus = useCallback(ids => {
    getSfxStatus(ids).then(next => setStatus(previous => ({ ...previous, ...next }))).catch(() => {})
  }, [])
  useEffect(() => { if (results.length) refreshStatus(results.slice(0, 200).map(entry => entry.id)) }, [results, refreshStatus])

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

  if (!isSfxLibraryAvailable()) return <div className="p-4 text-xs text-sf-text-muted">The sound-effects library needs the Drama Studio desktop app.</div>
  return <div className="h-full flex flex-col min-h-0" data-testid="sfx-browser">
    <div className="p-3 space-y-2 border-b border-sf-dark-700">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sf-text-muted" />
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search sounds (e.g. door slam)"
            aria-label="Search sound effects" className="w-full rounded bg-sf-dark-800 border border-sf-dark-600 pl-7 pr-2 py-1.5 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent" />
        </div>
        <button type="button" onClick={() => load(true)} disabled={loading} title="Refresh catalog" aria-label="Refresh catalog"
          className="p-1.5 rounded hover:bg-sf-dark-700 text-sf-text-muted disabled:opacity-40"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>
      <div className="flex gap-2">
        <select aria-label="Category" value={category} onChange={event => { setCategory(event.target.value); setSubCategory('') }}
          className="flex-1 min-w-0 rounded bg-sf-dark-800 border border-sf-dark-600 p-1 text-xs text-sf-text-primary">
          <option value="">All categories</option>
          {categories.map(item => <option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}
        </select>
        {subCategories.length > 0 && <select aria-label="Subcategory" value={subCategory} onChange={event => setSubCategory(event.target.value)}
          className="flex-1 min-w-0 rounded bg-sf-dark-800 border border-sf-dark-600 p-1 text-xs text-sf-text-primary">
          <option value="">All</option>
          {subCategories.map(item => <option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}
        </select>}
      </div>
      {catalog?.configured && <p className="text-[10px] text-sf-text-muted">{total} of {catalog.entries.length} sounds{total > results.length ? ` · showing ${results.length}` : ''} · drag onto an audio track</p>}
      {catalog?.warning && <p className="text-[10px] text-sf-warning">{catalog.warning}</p>}
      {error && <p role="alert" className="text-[10px] text-sf-warning break-words">{error}</p>}
    </div>
    {catalog && !catalog.configured && <div className="p-4 text-xs text-sf-text-muted space-y-1">
      <p>No sound-effects library is set up yet.</p>
      <p>Add the catalog URL in <span className="text-sf-text-secondary">Settings › Sound effects library</span>.</p>
    </div>}
    <ul className="flex-1 overflow-y-auto min-h-0" aria-label="Sound effects">
      {results.map(entry => {
        const state = status[entry.id]
        const isPlaying = playing?.id === entry.id
        return <li key={entry.id} draggable onDragStart={event => onDragStart(event, entry)} onDragEnd={() => setActiveSfxDrag(null)}
          className="px-3 py-2 border-b border-sf-dark-800 hover:bg-sf-dark-800/60 cursor-grab active:cursor-grabbing">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => play(entry)} aria-label={isPlaying ? `Stop ${entry.name}` : `Play ${entry.name}`}
              className="p-1 rounded bg-sf-dark-700 hover:bg-sf-dark-600 text-sf-text-primary">{isPlaying ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}</button>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-sf-text-primary truncate" title={entry.name}>{entry.name}</p>
              <p className="text-[10px] text-sf-text-muted truncate">{entry.category}{entry.subCategory ? ` › ${entry.subCategory}` : ''} · {formatDuration(entry.duration)} · {formatBytes(entry.fileSize)}</p>
            </div>
            {state === 'cached'
              ? <Check className="w-3.5 h-3.5 text-sf-success" aria-label="Downloaded" />
              : <button type="button" onClick={() => addToBin(entry)} disabled={busyId === entry.id || state === 'downloading' || !projectHandle}
                title="Add to project bin" aria-label={`Add ${entry.name} to project`} className="p-1 rounded hover:bg-sf-dark-700 text-sf-text-muted disabled:opacity-40">
                <Download className={`w-3.5 h-3.5 ${state === 'downloading' || busyId === entry.id ? 'animate-pulse' : ''}`} /></button>}
          </div>
          {isPlaying && <div className="mt-1"><Waveform url={playing.url} progress={progress} /></div>}
          {entry.tags?.length > 0 && <p className="mt-0.5 text-[10px] text-sf-text-muted truncate">{entry.tags.slice(0, 6).join(' · ')}</p>}
        </li>
      })}
    </ul>
  </div>
}
