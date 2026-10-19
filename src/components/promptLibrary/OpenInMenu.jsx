import { useEffect, useRef, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { requireCompanion } from '../../stores/browserJobsStore'
import { companionSetupState } from '../../utils/companionSetup.mjs'

/**
 * "Open in…": hands the prompt to Drama Studio Companion through a one-time
 * token (Settings › Browser). The desktop app opens the site in the default
 * browser and the Companion fills the prompt; only the token is in the URL.
 * Hidden outside the desktop app.
 */
export default function OpenInMenu({ text, className, labels, onOpened, onError }) {
  const api = window.electronAPI?.companionLink
  const [open, setOpen] = useState(false)
  const [sites, setSites] = useState([])
  const [busy, setBusy] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!api) return
    api.sites().then((result) => { if (result?.success) setSites(result.sites) }).catch(() => {})
  }, [api])

  useEffect(() => {
    if (!open) return undefined
    const close = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false) }
    window.addEventListener('mousedown', close, true)
    return () => window.removeEventListener('mousedown', close, true)
  }, [open])

  if (!api || sites.length === 0) return null

  const openSite = async (site) => {
    setOpen(false)
    // Without a connected Companion nothing would fill the site in: ask the
    // person to install it, then open the site once it connects.
    const status = await api.status().catch(() => null)
    if (companionSetupState(status) !== 'ready') {
      requireCompanion(() => openSite(site))
      return
    }
    setBusy(true)
    try {
      const result = await api.openIn(site.id, text)
      if (result?.success) onOpened(result.label)
      else onError(result?.error)
    } catch {
      onError()
    } finally {
      setBusy(false)
    }
  }

  return (
    <span ref={rootRef} className="relative inline-flex">
      <button type="button" className={className} aria-haspopup="menu" aria-expanded={open} disabled={busy || !text.trim()}
        onClick={() => setOpen((value) => !value)} data-testid="prompt-library-open-in">
        <ExternalLink className="h-3.5 w-3.5" />{labels.button}
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full left-0 z-10 mb-1 w-56 rounded border border-sf-dark-600 bg-sf-dark-800 py-1 shadow-lg">
          {sites.map((site) => (
            <button key={site.id} type="button" role="menuitem" onClick={() => openSite(site)} data-testid={`prompt-library-open-in-${site.id}`}
              className="block w-full px-3 py-1.5 text-left text-[11px] text-sf-text-secondary hover:bg-sf-dark-700 hover:text-sf-text-primary">
              {site.label}
            </button>
          ))}
          <p className="mt-1 border-t border-sf-dark-700 px-3 pb-1 pt-1.5 text-[10px] leading-snug text-sf-text-muted">{labels.hint}</p>
        </div>
      )}
    </span>
  )
}
