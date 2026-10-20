import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import useProjectStore from '../stores/projectStore'
import { useI18n } from '../i18n/I18nContext'
import { primaryButtonClass } from './audio/ModalShell'

/** Stays on screen while the open project's last save failed, so work is never lost silently. */
export default function SaveErrorNotice() {
  const { t } = useI18n()
  const saveError = useProjectStore((state) => (state.currentProject ? state.saveError : null))
  const [busy, setBusy] = useState(false)
  if (!saveError) return null

  const retry = async () => {
    setBusy(true)
    try { await useProjectStore.getState().saveProject() } finally { setBusy(false) }
  }

  return (
    <div className="pointer-events-none fixed right-4 top-14 z-50 w-[min(360px,calc(100vw-32px))]">
      <div role="alert" className="pointer-events-auto flex items-start gap-2 rounded-xl border border-sf-error/60 bg-sf-dark-900/95 p-3 text-xs shadow-2xl shadow-black/40 backdrop-blur">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sf-error" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sf-text-primary">{t('saveError.title', undefined, 'Your project could not be saved')}</div>
          <div className="mt-0.5 text-[11px] text-sf-text-muted">{t('saveError.detail', undefined, 'Your changes are still open here. Fix the problem (for example reconnect the drive or free up space), then try again.')}</div>
          {/* System errors ("EPERM: operation not permitted, rename '…' -> '…'") keep only the reason. */}
          <div className="mt-1 break-words text-[11px] text-sf-text-muted">{saveError.match(/^E[A-Z]+: [^,]+/)?.[0] || saveError}</div>
          <div className="mt-2">
            <button type="button" className={primaryButtonClass} disabled={busy} onClick={retry}>
              {busy ? t('saveError.saving', undefined, 'Saving…') : t('saveError.retry', undefined, 'Try again')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
