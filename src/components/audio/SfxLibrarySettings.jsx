import { useEffect, useState } from 'react'
import { getSfxSettings, saveSfxSettings, sfxPack, sfxR2, loadSfxCatalog, isSfxLibraryAvailable, validateSfxCatalogUrl } from '../../services/sfxManager'
import { formatBytes } from '../../types/sfx.js'
import { buttonClass, primaryButtonClass } from './ModalShell'

const inputClass = 'w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-xs text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent'
const EMPTY_R2_FORM = { endpoint: '', region: 'auto', bucket: '', objectKey: '', catalogKey: '', accessKeyId: '', secretAccessKey: '' }

/** Private Cloudflare R2 pack: keys (saved encrypted in the main process),
 * pack file, library folder. The secret is write-only from here. */
function R2PackSettings() {
  const [info, setInfo] = useState(null)
  const [form, setForm] = useState(EMPTY_R2_FORM)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [cache, setCache] = useState(null)

  const adopt = next => {
    if (!next) return
    setInfo(next)
    setForm({ ...EMPTY_R2_FORM, endpoint: next.endpoint, region: next.region || 'auto', bucket: next.bucket, objectKey: next.objectKey, catalogKey: next.catalogKey })
  }
  const refresh = async () => {
    try { adopt(await sfxR2.get()) } catch (error) { setMessage(error.message) }
    try { setCache(await sfxPack.cacheInfo()) } catch { /* optional */ }
  }
  useEffect(() => { refresh() }, [])

  const run = async (fn, done) => {
    setBusy(true); setMessage('')
    try {
      const result = await fn()
      if (!result?.canceled) {
        adopt(result)
        setMessage(done(result))
        setEditing(false)
        setForm(previous => ({ ...previous, accessKeyId: '', secretAccessKey: '' }))
      }
    } catch (error) { setMessage(error.message) } finally { setBusy(false); refresh() }
  }
  const field = (name, label, props = {}) => <label className="block">
    <span className="block text-[10px] text-sf-text-muted mb-0.5">{label}</span>
    <input value={form[name]} onChange={event => setForm(previous => ({ ...previous, [name]: event.target.value }))} className={inputClass}
      autoComplete="off" spellCheck={false} {...props} />
  </label>

  if (!info) return null
  return <div className="rounded border border-sf-dark-700 p-3 space-y-2" data-testid="sfx-r2-settings">
    <div className="flex items-center justify-between text-xs">
      <span className="font-medium">Sound-effects pack (Cloudflare R2)</span>
      <span className="text-sf-text-muted">{info.active ? 'In use' : 'Not in use'}</span>
    </div>
    <p className="text-[10px] text-sf-text-muted">Downloads the pack zip from your private R2 bucket once, unpacks the sounds into the library folder and lists them in the editor’s Sound effects tab. The keys are stored encrypted on this computer and only used to download.</p>
    {info.hasKeys && !editing
      ? <p className="text-[11px] text-sf-text-secondary break-all">{info.bucket}/{info.objectKey} · key {info.accessKeyIdHint}</p>
      : <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {field('endpoint', 'Endpoint', { placeholder: 'https://<account id>.r2.cloudflarestorage.com' })}
        {field('bucket', 'Bucket', { placeholder: 'sfx-drama-studio' })}
        {field('objectKey', 'Pack file (.zip)', { placeholder: 'sfx/viral-sfx-library.zip' })}
        {field('catalogKey', 'Catalog (optional .tsv)', { placeholder: 'sfx/catalog.tsv' })}
        {field('accessKeyId', 'Access key ID', { placeholder: info.hasKeys ? `saved (${info.accessKeyIdHint}) — leave blank to keep` : '' })}
        {field('secretAccessKey', 'Secret access key', { type: 'password', placeholder: info.hasKeys ? 'saved — leave blank to keep' : '' })}
      </div>}
    <div className="flex flex-wrap gap-2">
      <button className={buttonClass} disabled={busy} onClick={() => run(sfxR2.importKeyFile, result => `Keys imported and checked: the pack is ${formatBytes(result.remoteBytes)}.`)}>Import from key file…</button>
      {info.hasKeys && !editing
        ? <button className={buttonClass} disabled={busy} onClick={() => setEditing(true)}>Edit</button>
        : <button className={primaryButtonClass} disabled={busy} onClick={() => run(() => sfxR2.save(form), result => `Saved and checked: the pack is ${formatBytes(result.remoteBytes)}.`)}>Save and check</button>}
      {editing && <button className={buttonClass} disabled={busy} onClick={() => { setEditing(false); adopt(info) }}>Cancel</button>}
      {info.hasKeys && <button className={buttonClass} disabled={busy} onClick={() => run(sfxR2.forgetKeys, () => 'Keys removed. Installed sounds stay available.')}>Remove keys</button>}
    </div>
    <div className="text-[11px] space-y-1">
      <p className="text-sf-text-muted">Library folder</p>
      <p className="text-sf-text-secondary break-all">{info.libraryDir}</p>
      <p className="text-[10px] text-sf-text-muted">{cache?.installed ? `${cache.files} sounds · ${formatBytes(cache.bytes)}` : 'Pack not installed yet. Install it from the Sound effects tab.'}</p>
      <div className="flex flex-wrap gap-2">
        <button className={buttonClass} disabled={busy} onClick={() => run(sfxR2.chooseFolder, () => 'Library folder changed. Install the pack again there, or move the files yourself.')}>Change folder…</button>
        <button className={buttonClass} onClick={() => sfxR2.openFolder().catch(error => setMessage(error.message))}>Open folder</button>
        {info.active
          ? <button className={buttonClass} disabled={busy} onClick={() => run(() => sfxR2.setActive(false), () => 'Using the catalog URL instead.')}>Use catalog URL instead</button>
          : <button className={buttonClass} disabled={busy} onClick={() => run(() => sfxR2.setActive(true), () => 'Using the R2 pack.')}>Use this pack</button>}
      </div>
    </div>
    {message && <p role="status" className="text-[11px] text-sf-text-secondary break-words">{message}</p>}
  </div>
}

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
    <R2PackSettings />
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
