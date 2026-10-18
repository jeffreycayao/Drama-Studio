import { ExternalLink, Loader2, Puzzle } from 'lucide-react'
import { COMPANION_STORE_URL } from '../../config/projectInfo'
import { useI18n } from '../../i18n/I18nContext'
import { browserLinkStatus } from '../../utils/browserLinkStatus.mjs'
import { companionSetupState } from '../../utils/companionSetup.mjs'
import { primaryButtonClass } from '../audio/ModalShell'

/**
 * What to do before Drama Studio can send to an AI site: install Drama Studio
 * Companion from the Chrome Web Store and connect it, or (when the browser
 * link itself is not working) open Settings › Browser. Renders nothing once a
 * browser is connected.
 */
export default function CompanionInstallSteps({ status, onOpenSettings }) {
  const { t } = useI18n()
  const tr = (key, vars, fallback) => t(`companionInstall.${key}`, vars, fallback)
  const state = companionSetupState(status)
  if (!status || state === 'ready') return null

  if (state !== 'install') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100" data-testid="companion-link-not-ready">
        <span>{browserLinkStatus(status).text}</span>
        {onOpenSettings && (
          <button type="button" onClick={onOpenSettings} className="rounded border border-amber-400/50 px-2 py-0.5 hover:bg-amber-500/20">
            {tr('openBrowserSettings', undefined, 'Settings › Browser')}
          </button>
        )}
      </div>
    )
  }

  const steps = [
    tr('step1', undefined, 'Add Drama Studio Companion to Chrome or Edge. It’s free.'),
    tr('step2', undefined, 'Open the Companion from the browser’s toolbar and press Connect.'),
    tr('step3', undefined, 'Press Allow when Drama Studio asks.'),
  ]
  return (
    <div className="space-y-3 rounded-md border border-sf-accent/40 bg-sf-accent/10 px-4 py-3 text-xs text-sf-text-primary" data-testid="companion-install">
      <div className="flex items-start gap-2">
        <Puzzle className="mt-0.5 h-4 w-4 flex-shrink-0 text-sf-accent" aria-hidden="true" />
        <div>
          <p className="font-semibold">{tr('title', undefined, 'Add Drama Studio Companion to your browser first')}</p>
          <p className="mt-0.5 text-sf-text-secondary">{tr('body', undefined, 'Drama Studio needs its browser extension to fill in AI sites for you. You set it up once.')}</p>
        </div>
      </div>
      <ol className="list-decimal space-y-1 pl-9 text-sf-text-secondary">
        {steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      <div className="flex flex-wrap items-center gap-3 pl-6">
        <button type="button" className={`${primaryButtonClass} inline-flex items-center gap-1.5`} data-testid="companion-install-store"
          onClick={() => window.electronAPI?.openExternalUrl?.(COMPANION_STORE_URL)}>
          <ExternalLink className="h-3.5 w-3.5" />{tr('addToChrome', undefined, 'Add to Chrome')}
        </button>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-sf-text-muted" role="status">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          {tr('waiting', undefined, 'Waiting for your browser to connect…')}
        </span>
      </div>
      <p className="pl-6 text-[10px] text-sf-text-muted">{tr('edgeHint', undefined, 'Using Edge? Open the same page and allow extensions from other stores when Edge asks.')}</p>
    </div>
  )
}
