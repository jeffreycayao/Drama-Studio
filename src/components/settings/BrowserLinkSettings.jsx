import { useEffect, useState } from 'react'
import { buttonClass, fieldClass, primaryButtonClass } from '../audio/ModalShell'
import { browserLinkStatus } from '../../utils/browserLinkStatus.mjs'

const formatDate = (value) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Settings › Browser: allowed browsers (Drama Studio Companion) and, while the
 * Companion has no store listing, the extension IDs the link accepts. */
export default function BrowserLinkSettings() {
  const api = window.electronAPI?.companionLink
  const [status, setStatus] = useState(null)
  const [message, setMessage] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [extensionId, setExtensionId] = useState('')
  const [busy, setBusy] = useState(false)

  const adopt = (result) => {
    if (result?.success === false) { setMessage(result.error || 'That did not work.'); return false }
    if (result) setStatus(result)
    return true
  }
  const refresh = async () => { if (api) adopt(await api.status()) }

  useEffect(() => {
    if (!api) return undefined
    refresh()
    const stop = api.onChanged(() => refresh())
    window.addEventListener('focus', refresh)
    return () => { stop(); window.removeEventListener('focus', refresh) }
  }, [])

  const run = async (action, done) => {
    setBusy(true); setMessage('')
    try {
      if (adopt(await action()) && done) setMessage(done)
    } finally {
      setBusy(false)
    }
  }

  if (!api) return <p className="text-xs text-sf-text-muted">The browser link needs the Drama Studio desktop app.</p>
  if (!status) return <p className="text-xs text-sf-text-muted">Checking the browser link…</p>

  const { ready, text: statusText } = browserLinkStatus(status)
  return <div className="space-y-4" data-testid="browser-link-settings">
    <p className="text-xs text-sf-text-secondary">
      Drama Studio Companion is the browser extension for Chrome and Edge. Once you allow a browser here,
      <span className="text-sf-text-primary"> Open in…</span> in the prompt library sends a prompt to ChatGPT, Gemini, Claude, Grok,
      Perplexity or Manus and the Companion fills it in for you to review. The prompt never goes into the web address.
    </p>

    <div className="flex items-start gap-2 rounded border border-sf-dark-700 p-3 text-xs" data-testid="browser-link-status">
      <span className={`mt-1 inline-block h-2 w-2 flex-shrink-0 rounded-full ${ready ? 'bg-sf-accent' : 'bg-sf-dark-500'}`} aria-hidden="true" />
      <span className="text-sf-text-secondary">{statusText}</span>
    </div>

    <div className="space-y-2">
      <h4 className="text-xs font-medium text-sf-text-primary">Allowed browsers</h4>
      {status.paired.length === 0
        ? <p className="text-[11px] text-sf-text-muted">
          None yet. In the Companion’s side panel, open Settings › Drama Studio desktop and press Connect. Drama Studio then asks
          “Allow this browser to send files to Drama Studio?”.
        </p>
        : <ul className="space-y-2" data-testid="browser-link-paired">
          {status.paired.map((browser) => <li key={browser.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-sf-dark-700 px-3 py-2" data-testid="browser-link-paired-item">
            <div className="min-w-0 text-xs">
              <p className="text-sf-text-primary">{browser.browser}{browser.extVersion ? ` · Companion ${browser.extVersion}` : ''}</p>
              <p className="text-[10px] text-sf-text-muted">
                Allowed {formatDate(browser.pairedAt)}{browser.lastSeenAt ? ` · last seen ${formatDate(browser.lastSeenAt)}` : ''} · ID {browser.extensionId}
              </p>
            </div>
            {confirmRemove === browser.id
              ? <span className="inline-flex items-center gap-2 text-[11px] text-sf-text-secondary">
                Remove this browser?
                <button className={buttonClass} disabled={busy} data-testid="browser-link-remove-yes"
                  onClick={() => run(() => api.removePaired(browser.id), 'Browser removed. It has to be allowed again before it can send anything.').then(() => setConfirmRemove(null))}>Remove</button>
                <button className={buttonClass} onClick={() => setConfirmRemove(null)}>Cancel</button>
              </span>
              : <button className={buttonClass} onClick={() => setConfirmRemove(browser.id)} data-testid="browser-link-remove">Remove</button>}
          </li>)}
        </ul>}
    </div>

    <details className="rounded border border-sf-dark-700 p-3 text-xs">
      <summary className="cursor-pointer text-sf-text-secondary">Developer: extension IDs</summary>
      <div className="mt-2 space-y-2">
        <p className="text-[11px] text-sf-text-muted">
          The link only answers the Companion extension IDs listed here. Until the Companion is in the Chrome Web Store, add the ID
          of a copy you loaded unpacked (chrome://extensions or edge://extensions, Developer mode on).
        </p>
        {status.extensionIds.length > 0 && <ul className="space-y-1">
          {status.extensionIds.map((entry) => <li key={entry.id} className="flex items-center justify-between gap-2">
            <code className="break-all font-mono text-[11px] text-sf-text-secondary">{entry.id}</code>
            {entry.source === 'development'
              ? <button className={buttonClass} disabled={busy} onClick={() => run(() => api.removeExtensionId(entry.id))}>Remove</button>
              : <span className="text-[10px] text-sf-text-muted">{entry.source === 'release' ? 'Store listing' : 'Set by DS_COMPANION_EXTENSION_IDS'}</span>}
          </li>)}
        </ul>}
        <form className="flex gap-2" onSubmit={(event) => {
          event.preventDefault()
          run(() => api.addExtensionId(extensionId.trim()), 'Extension ID added. Reload the Companion, then press Connect again.').then(() => setExtensionId(''))
        }}>
          <input value={extensionId} onChange={(event) => setExtensionId(event.target.value)} placeholder="32 letters, a to p"
            className={fieldClass} spellCheck={false} autoComplete="off" aria-label="Extension ID" data-testid="browser-link-extension-id" />
          <button type="submit" className={primaryButtonClass} disabled={busy || !extensionId.trim()}>Add</button>
        </form>
      </div>
    </details>

    {message && <p className="text-[11px] text-sf-text-secondary" role="status">{message}</p>}
  </div>
}
