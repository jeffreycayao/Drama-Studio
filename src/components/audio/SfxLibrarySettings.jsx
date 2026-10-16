import { useEffect, useState } from 'react'
import { getSfxSettings, saveSfxSettings, sfxPack, loadSfxCatalog, isSfxLibraryAvailable, validateSfxCatalogUrl } from '../../services/sfxManager'
import { formatBytes } from '../../types/sfx.js'
import { buttonClass, primaryButtonClass } from './ModalShell'

const PACK_LABELS = { idle: 'Not started', running: 'Downloading', paused: 'Paused', done: 'Complete',
  'done-with-errors': 'Finished with errors', canceled: 'Canceled', error: 'Stopped by an error' }

/** Settings › Sound effects library: catalog URL, offline pack, cache. */
export default function SfxLibrarySettings() {
  const [catalogUrl, setCatalogUrl] = useState('')
  const [saved, setSaved] = useState('')
  const [message, setMessage] = useState('')
  const [catalogInfo, setCatalogInfo] = useState(null)
  const [pack, setPack] = useState(null)
  const [cache, setCache] = useState(null)
  const [confirmPack, setConfirmPack] = useState(false)
  const available = isSfxLibraryAvailable()

  const refreshInfo = async () => {
    try { setCache(await sfxPack.cacheInfo()) } catch { /* optional */ }
    try { setPack(await sfxPack.status()) } catch { /* optional */ }
  }
  useEffect(() => {
    if (!available) return undefined
    getSfxSettings().then(value => { setCatalogUrl(value.catalogUrl); setSaved(value.catalogUrl) })
    refreshInfo()
    loadSfxCatalog().then(setCatalogInfo).catch(() => {})
    return sfxPack.onProgress(setPack)
  }, [available])

  if (!available) return <p className="text-xs text-sf-text-muted">The sound-effects library needs the Drama Studio desktop app.</p>

  const save = async () => {
    setMessage('')
    const checked = validateSfxCatalogUrl(catalogUrl)
    if (!checked.ok) { setMessage(checked.reason); return }
    if (checked.url === saved) return
    try {
      await saveSfxSettings({ catalogUrl: checked.url })
      setSaved(checked.url)
      setCatalogInfo(checked.url ? await loadSfxCatalog({ refresh: true }) : null)
      setMessage(checked.url ? 'Catalog loaded.' : 'Library disconnected.')
    } catch (error) { setMessage(error.message) }
  }
  const act = async (fn) => {
    setMessage('')
    try { setPack(await fn()) } catch (error) { setMessage(error.message) }
    refreshInfo()
  }
  const totalBytes = catalogInfo?.entries?.reduce((sum, entry) => sum + entry.fileSize, 0) || 0
  const percent = pack?.bytesTotal ? Math.min(100, Math.round(pack.bytesDone / pack.bytesTotal * 100)) : 0

  return <div className="space-y-4" data-testid="sfx-library-settings">
    <div>
      <label htmlFor="sfx-catalog-url" className="block text-xs text-sf-text-muted mb-1">Catalog URL (sfx-catalog.json)</label>
      <input id="sfx-catalog-url" type="url" value={catalogUrl} onChange={event => setCatalogUrl(event.target.value)} onBlur={save}
        placeholder="https://<bucket>.r2.dev/sfx/sfx-catalog.json"
        className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-3 py-2 text-sm text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent" />
      <p className="text-[10px] text-sf-text-muted mt-1">Host the pack on zero-egress storage with HTTPS and byte-range support, such as Cloudflare R2 or a Hugging Face dataset. Google Drive is not supported. Downloads only come from the catalog’s own address.</p>
      {catalogInfo?.configured && <p className="text-[10px] text-sf-text-secondary mt-1">{catalogInfo.entries.length} sounds · {formatBytes(totalBytes)}{catalogInfo.dropped ? ` · ${catalogInfo.dropped} invalid entries ignored` : ''}</p>}
    </div>
    <div className="rounded border border-sf-dark-700 p-3 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">Offline pack</span>
        <span className="text-sf-text-muted">{PACK_LABELS[pack?.state] || PACK_LABELS.idle}</span>
      </div>
      <p className="text-[10px] text-sf-text-muted">Download every sound now so the library works offline. Files are checked with SHA-256 and resume after a pause or restart.</p>
      {pack && pack.state !== 'idle' && <>
        <div className="h-1.5 rounded bg-sf-dark-700 overflow-hidden" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Offline pack progress">
          <div className="h-full bg-sf-accent" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-[10px] text-sf-text-muted">{pack.completed} of {pack.total} files · {formatBytes(pack.bytesDone)} of {formatBytes(pack.bytesTotal)}{pack.failed ? ` · ${pack.failed} failed` : ''}</p>
        {pack.errors?.slice(-3).map((item, index) => <p key={index} className="text-[10px] text-sf-warning break-words">{item.id ? `${item.id}: ` : ''}{item.message}</p>)}
      </>}
      {confirmPack
        ? <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span>Download about {formatBytes(totalBytes)}?</span>
          <button className={primaryButtonClass} onClick={() => { setConfirmPack(false); act(sfxPack.start) }}>Download</button>
          <button className={buttonClass} onClick={() => setConfirmPack(false)}>Cancel</button>
        </div>
        : <div className="flex flex-wrap gap-2">
          {(!pack || ['idle', 'done', 'done-with-errors', 'canceled', 'error'].includes(pack.state)) &&
            <button className={buttonClass} disabled={!catalogInfo?.configured} onClick={() => setConfirmPack(true)}>{pack?.state === 'done' ? 'Check for new sounds' : 'Download offline pack…'}</button>}
          {pack?.state === 'running' && <button className={buttonClass} onClick={() => act(sfxPack.pause)}>Pause</button>}
          {pack?.state === 'paused' && <button className={buttonClass} onClick={() => act(sfxPack.resume)}>Resume</button>}
          {['running', 'paused'].includes(pack?.state) && <button className={buttonClass} onClick={() => act(sfxPack.cancel)}>Cancel</button>}
        </div>}
    </div>
    <div className="flex items-center justify-between text-xs">
      <span className="text-sf-text-muted">Cache: {cache ? `${cache.files} files · ${formatBytes(cache.bytes)}` : '…'}</span>
      <button className={buttonClass} disabled={!cache?.files || pack?.state === 'running'} onClick={async () => {
        try { setCache(await sfxPack.clearCache()); setMessage('Cache cleared. Sounds already in projects are kept.') } catch (error) { setMessage(error.message) }
      }}>Clear cache</button>
    </div>
    {message && <p role="status" className="text-xs text-sf-text-secondary">{message}</p>}
  </div>
}
