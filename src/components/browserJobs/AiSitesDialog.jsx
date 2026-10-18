import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ExternalLink, Film, Globe, Image as ImageIcon, Loader2, Music2, X } from 'lucide-react'
import useBrowserJobsStore from '../../stores/browserJobsStore'
import useAssetsStore from '../../stores/assetsStore'
import { useI18n } from '../../i18n/I18nContext'
import PromptLibraryButtons from '../promptLibrary/PromptLibraryButtons'

const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4']
const MAX_REFERENCES = 8
const MAX_LYRICS = 5000
const STATE_KEYS = {
  queued: 'opening',
  sent: 'opening',
  filling: 'filling',
  'waiting-user': 'waiting',
  generating: 'generating',
  stopped: 'stopped',
  failed: 'failed',
  done: 'done',
}

const field = 'w-full rounded-md border border-sf-dark-600 bg-sf-dark-900 px-2.5 py-1.5 text-xs text-sf-text-primary placeholder:text-sf-text-muted focus:border-sf-accent focus:outline-none'
const chip = (active) => `rounded-md border px-2.5 py-1 text-[11px] transition-colors ${active ? 'border-sf-accent bg-sf-accent text-sf-accent-on' : 'border-sf-dark-600 text-sf-text-secondary hover:border-sf-dark-500 hover:text-sf-text-primary'}`

/**
 * "AI Sites": make an image or video on a site you already use (Google Flow,
 * Grok Imagine, Kling, Midjourney…) in your own browser. Drama Studio opens
 * the site, the Companion fills the prompt and adds the references, you
 * press Generate there, and "Send to Drama Studio" brings the result back.
 * Hidden outside the desktop app; needs no ComfyUI.
 */
export default function AiSitesDialog({ onOpenSettings }) {
  const { t } = useI18n()
  const tr = (key, vars, fallback) => t(`aiSites.${key}`, vars, fallback)
  const request = useBrowserJobsStore((state) => state.dialog)
  const close = useBrowserJobsStore((state) => state.closeDialog)
  const jobs = useBrowserJobsStore((state) => state.jobs)
  const assets = useAssetsStore((state) => state.assets)
  const api = window.electronAPI?.companionLink

  const [sites, setSites] = useState([])
  const [status, setStatus] = useState(null)
  const [siteId, setSiteId] = useState('')
  const [kind, setKind] = useState('video')
  const [prompt, setPrompt] = useState('')
  const [aspect, setAspect] = useState('16:9')
  const [seconds, setSeconds] = useState('')
  const [referenceIds, setReferenceIds] = useState([])
  // Songs (music sites): simple = one description; custom = style + lyrics.
  const [songMode, setSongMode] = useState('simple')
  const [lyrics, setLyrics] = useState('')
  const [songTitle, setSongTitle] = useState('')
  const [instrumental, setInstrumental] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(null)

  useEffect(() => {
    if (!request || !api) return
    setPrompt(request.prompt || '')
    setSongMode(request.lyrics || request.songMode === 'custom' ? 'custom' : 'simple')
    setLyrics(request.lyrics || '')
    setSongTitle(request.title || '')
    setInstrumental(request.instrumental === true)
    setReferenceIds(Array.isArray(request.referenceAssetIds) ? request.referenceAssetIds.slice(0, MAX_REFERENCES) : [])
    setError('')
    setSent(null)
    api.jobSites().then((result) => {
      if (!result?.success) return
      setSites(result.sites)
      const wanted = result.sites.find((site) => site.id === request.siteId) || result.sites[0]
      if (wanted) {
        setSiteId(wanted.id)
        setKind(wanted.kinds.includes(request.kind) ? request.kind : wanted.kinds[0])
      }
    }).catch(() => {})
    api.status().then(setStatus).catch(() => setStatus(null))
  }, [request?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const site = sites.find((item) => item.id === siteId) || null
  const media = useMemo(() => (assets || []).filter((asset) => (asset?.type === 'image' || asset?.type === 'video') && asset.absolutePath), [assets])
  const recent = useMemo(() => Object.values(jobs || {}).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5), [jobs])
  const linkReady = Boolean(status?.supported && status?.listening && status?.registered)
  const paired = Boolean(status?.paired?.length)

  if (!request) return null
  if (!api) return null

  const pickSite = (item) => {
    setSiteId(item.id)
    if (!item.kinds.includes(kind)) setKind(item.kinds[0])
  }
  const toggleReference = (id) => setReferenceIds((ids) => (ids.includes(id) ? ids.filter((value) => value !== id) : ids.length >= MAX_REFERENCES ? ids : [...ids, id]))

  const send = async () => {
    if (!site) return
    setBusy(true); setError(''); setSent(null)
    try {
      const references = referenceIds
        .map((id) => media.find((asset) => asset.id === id))
        .filter(Boolean)
        .map((asset) => ({ path: asset.absolutePath, name: asset.name || '' }))
      let params = { aspect }
      const length = Number(seconds)
      if (kind === 'video' && Number.isInteger(length) && length > 0) params.durationSeconds = length
      if (kind === 'audio') {
        params = songMode === 'custom'
          ? { custom: true, instrumental, lyrics: instrumental ? '' : lyrics.slice(0, MAX_LYRICS), title: songTitle.trim() }
          : {}
      }
      const result = await api.createJob({ siteId: site.id, kind, prompt, params, references })
      if (result?.success) setSent({ label: result.label })
      else setError(result?.error || tr('sendFailed', undefined, 'Drama Studio could not open the site. Try again.'))
    } catch {
      setError(tr('sendFailed', undefined, 'Drama Studio could not open the site. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  const groups = [
    ['video', tr('groupVideo', undefined, 'Video'), Film],
    ['image', tr('groupImage', undefined, 'Images'), ImageIcon],
    ['music', tr('groupMusic', undefined, 'Music'), Music2],
  ]
  const isSong = kind === 'audio'
  const kindLabel = (value) => (value === 'video' ? tr('kindVideo', undefined, 'Video') : value === 'audio' ? tr('kindAudio', undefined, 'Song') : tr('kindImage', undefined, 'Image'))
  const promptLabel = !isSong ? tr('prompt', undefined, 'Prompt') : songMode === 'custom' ? tr('songStyle', undefined, 'Style of music') : tr('songDescription', undefined, 'Song description')
  const promptPlaceholder = !isSong
    ? tr('promptPlaceholder', undefined, 'Describe the shot: subject, action, camera, light, mood…')
    : songMode === 'custom'
      ? tr('songStylePlaceholder', undefined, 'Genre, mood, instruments, tempo: e.g. lo-fi synthwave, warm pads, 90 bpm')
      : tr('songDescriptionPlaceholder', undefined, 'What the song is about and how it should sound')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="ai-sites-title" data-testid="ai-sites-dialog"
      onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-sf-dark-600 bg-sf-dark-900 shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-sf-dark-700 px-5 py-4">
          <div>
            <h2 id="ai-sites-title" className="flex items-center gap-2 font-display text-base font-semibold"><Globe className="h-4 w-4 text-sf-accent" />{tr('title', undefined, 'Make it on an AI site')}</h2>
            <p className="mt-1 max-w-xl text-xs text-sf-text-secondary">{tr('intro', undefined, 'Use a site you already pay for, in your own browser. Drama Studio opens it with your prompt and references filled in; you press Generate there.')}</p>
          </div>
          <button type="button" onClick={close} className="rounded p-1 text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary" aria-label={tr('close', undefined, 'Close')}><X className="h-4 w-4" /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {status && (!linkReady || !paired) && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100" data-testid="ai-sites-setup">
              <span>{!linkReady
                ? tr('linkNotReady', undefined, 'The browser link is not ready. Open Settings › Browser to see why.')
                : tr('notPaired', undefined, 'Add Drama Studio Companion to Chrome or Edge first, then allow your browser once.')}</span>
              <button type="button" onClick={() => { close(); onOpenSettings?.('browser') }} className="rounded border border-amber-400/50 px-2 py-0.5 hover:bg-amber-500/20">{tr('openBrowserSettings', undefined, 'Settings › Browser')}</button>
            </div>
          )}

          {groups.map(([group, label, Icon]) => {
            const list = sites.filter((item) => (item.group || 'video') === group)
            if (!list.length) return null
            return (
              <section key={group}>
                <h3 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sf-text-muted"><Icon className="h-3 w-3" />{label}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((item) => (
                    <button key={item.id} type="button" onClick={() => pickSite(item)} className={chip(item.id === siteId)} data-testid={`ai-site-${item.id}`}>{item.label}</button>
                  ))}
                </div>
              </section>
            )
          })}

          {site && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1" role="group" aria-label={tr('kind', undefined, 'Make')}>
                  {site.kinds.map((value) => (
                    <button key={value} type="button" onClick={() => setKind(value)} className={chip(kind === value)} data-testid={`ai-sites-kind-${value}`}>
                      {kindLabel(value)}
                    </button>
                  ))}
                </div>
                {isSong && (
                  <div className="flex items-center gap-1" role="group" aria-label={tr('songModeLabel', undefined, 'Mode')}>
                    {['simple', 'custom'].map((value) => (
                      <button key={value} type="button" onClick={() => setSongMode(value)} className={chip(songMode === value)} data-testid={`ai-sites-song-${value}`}>
                        {value === 'simple' ? tr('songSimple', undefined, 'Simple') : tr('songCustom', undefined, 'Custom: lyrics and style')}
                      </button>
                    ))}
                  </div>
                )}
                {!isSong && <label className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-sf-text-secondary">{tr('shape', undefined, 'Shape')}
                  <select className={`${field} w-20`} value={aspect} onChange={(event) => setAspect(event.target.value)}>
                    {ASPECTS.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>}
                {kind === 'video' && (
                  <label className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-sf-text-secondary">{tr('length', undefined, 'Length (s)')}
                    <input className={`${field} w-16`} type="number" min={1} max={60} value={seconds} placeholder="—" onChange={(event) => setSeconds(event.target.value)} />
                  </label>
                )}
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label htmlFor="ai-sites-prompt" className="text-[11px] font-medium text-sf-text-secondary">{promptLabel}</label>
                  <PromptLibraryButtons value={prompt} onChange={setPrompt} category={isSong ? 'music' : kind === 'video' ? 'shot' : 'style'} fieldLabel={promptLabel} testId="ai-sites-prompt-library" />
                </div>
                <textarea id="ai-sites-prompt" className={`${field} ${isSong && songMode === 'custom' ? 'min-h-[56px]' : 'min-h-[96px]'} resize-y`} value={prompt} onChange={(event) => setPrompt(event.target.value)}
                  placeholder={promptPlaceholder} data-testid="ai-sites-prompt" />
              </div>

              {isSong && songMode === 'custom' && (
                <div className="space-y-2" data-testid="ai-sites-song-fields">
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <label htmlFor="ai-sites-lyrics" className="text-[11px] font-medium text-sf-text-secondary">{tr('songLyrics', undefined, 'Lyrics')}</label>
                      <label className="flex items-center gap-1.5 text-[11px] text-sf-text-secondary">
                        <input type="checkbox" checked={instrumental} onChange={(event) => setInstrumental(event.target.checked)} data-testid="ai-sites-instrumental" />
                        {tr('songInstrumental', undefined, 'Instrumental (no vocals)')}
                      </label>
                    </div>
                    <textarea id="ai-sites-lyrics" className={`${field} min-h-[120px] resize-y font-mono`} value={lyrics} disabled={instrumental} maxLength={MAX_LYRICS}
                      onChange={(event) => setLyrics(event.target.value)} data-testid="ai-sites-lyrics"
                      placeholder={tr('songLyricsPlaceholder', undefined, 'Write your lyrics here. [Verse], [Chorus] and [Bridge] tags help shape the song.')} />
                  </div>
                  <label className="block text-[11px] font-medium text-sf-text-secondary">{tr('songTitle', undefined, 'Title (optional)')}
                    <input className={`${field} mt-1`} value={songTitle} maxLength={100} onChange={(event) => setSongTitle(event.target.value)} data-testid="ai-sites-song-title" />
                  </label>
                </div>
              )}

              {!isSong && <div>
                <div className="mb-1 text-[11px] font-medium text-sf-text-secondary">{tr('references', { count: referenceIds.length, max: MAX_REFERENCES }, 'Reference images or clips ({{count}} of {{max}})')}</div>
                {media.length ? (
                  <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-sf-dark-700 p-1 sm:grid-cols-3">
                    {media.map((asset) => (
                      <label key={asset.id} className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[11px] ${referenceIds.includes(asset.id) ? 'bg-sf-dark-700 text-sf-text-primary' : 'text-sf-text-secondary hover:bg-sf-dark-800'}`}>
                        <input type="checkbox" checked={referenceIds.includes(asset.id)} onChange={() => toggleReference(asset.id)} data-testid="ai-sites-reference" />
                        {asset.type === 'video' ? <Film className="h-3 w-3 flex-shrink-0" /> : <ImageIcon className="h-3 w-3 flex-shrink-0" />}
                        <span className="truncate">{asset.name}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-sf-text-muted">{tr('noReferences', undefined, 'Pictures and clips in this project can be sent as references.')}</p>
                )}
              </div>}
            </>
          )}

          {error && <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200" role="alert">{error}</p>}
          {sent && (
            <div className="flex items-start gap-2 rounded-md border border-sf-accent/40 bg-sf-accent/10 px-3 py-2 text-xs text-sf-text-primary" role="status" data-testid="ai-sites-sent">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-sf-accent" />
              <span>{isSong
                ? tr('sentSong', { site: sent.label }, '{{site}} is opening in your browser with the song filled in. Check it and press Create there. When it is done, right-click its player › Send to Drama Studio, or download it and drag it into Drama Studio.')
                : tr('sent', { site: sent.label }, '{{site}} is opening in your browser with everything filled in. Check it and press Generate there. When it is done, right-click the result › Send to Drama Studio; it lands in AI Sites in your project.')}</span>
            </div>
          )}

          {recent.length > 0 && (
            <section>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-sf-text-muted">{tr('recent', undefined, 'Recent')}</h3>
              <ul className="space-y-1" data-testid="ai-sites-recent">
                {recent.map((job) => (
                  <li key={job.jobId} className="flex items-center justify-between gap-2 rounded border border-sf-dark-700 px-2.5 py-1.5 text-[11px]">
                    <span className="min-w-0 truncate text-sf-text-secondary">{sites.find((item) => item.id === job.siteId)?.label || job.siteId} · {job.prompt}</span>
                    <span className="flex-shrink-0 text-sf-text-muted">{tr(`state.${STATE_KEYS[job.state] || 'opening'}`, undefined, job.state)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-sf-dark-700 px-5 py-3">
          <p className="max-w-md text-[10px] text-sf-text-muted">{tr('footnote', undefined, "Drama Studio never presses Generate for you, and never gets around a site's sign-in, limits or checks.")}</p>
          <button type="button" onClick={send} disabled={busy || !site || !prompt.trim()} data-testid="ai-sites-send"
            className="inline-flex items-center gap-1.5 rounded-md bg-sf-accent px-4 py-2 text-xs font-semibold text-sf-accent-on hover:bg-sf-accent-hover disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
            {site ? tr('send', { site: site.label }, 'Open in {{site}}') : tr('pickSite', undefined, 'Pick a site')}
          </button>
        </footer>
      </div>
    </div>
  )
}
