import { useEffect } from 'react'
import { X } from 'lucide-react'
import useBrowserJobsStore from '../../stores/browserJobsStore'
import useCompanionLinkStatus from '../../hooks/useCompanionLinkStatus'
import { useI18n } from '../../i18n/I18nContext'
import { companionSetupState } from '../../utils/companionSetup.mjs'
import CompanionInstallSteps from './CompanionInstallSteps'

/**
 * Opened by requireCompanion() (stores/browserJobsStore.js) when something
 * wants to send to an AI site before a browser is connected. Closes by itself
 * and carries on with what the person asked for once the Companion connects.
 */
export default function CompanionInstallDialog({ onOpenSettings }) {
  const request = useBrowserJobsStore((state) => state.companionInstall)
  const close = useBrowserJobsStore((state) => state.closeCompanionInstall)
  const status = useCompanionLinkStatus(Boolean(request))
  const { t } = useI18n()
  const ready = companionSetupState(status) === 'ready'

  useEffect(() => {
    if (!request || !ready) return
    close()
    request.onReady?.()
  }, [request, ready, close])

  if (!request) return null
  const title = t('companionInstall.dialogTitle', undefined, 'Drama Studio Companion')
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={title}
      data-testid="companion-install-dialog" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <div className="w-full max-w-lg rounded-xl border border-sf-dark-600 bg-sf-dark-900 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-sf-text-primary">{title}</h2>
          <button type="button" onClick={close} className="rounded p-1 text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary"
            aria-label={t('companionInstall.notNow', undefined, 'Not now')}><X className="h-4 w-4" /></button>
        </div>
        {status
          ? <CompanionInstallSteps status={status} onOpenSettings={onOpenSettings ? () => { close(); onOpenSettings('browser') } : undefined} />
          : <p className="text-xs text-sf-text-muted">{t('companionInstall.checking', undefined, 'Checking your browser…')}</p>}
      </div>
    </div>
  )
}
