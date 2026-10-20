import { useEffect } from 'react'
import { Download, X } from 'lucide-react'
import useAppUpdateStore from '../stores/appUpdateStore'
import { useI18n } from '../i18n/I18nContext'
import { buttonClass, primaryButtonClass } from './audio/ModalShell'
import { updateNoticeKind } from '../utils/updateNotice.mjs'

/** Top-right notice when a new Drama Studio version is ready or out. */
export default function UpdateNotice() {
  const { t } = useI18n()
  const update = useAppUpdateStore((state) => state.update)
  const dismissedVersion = useAppUpdateStore((state) => state.dismissedVersion)
  const busy = useAppUpdateStore((state) => state.busy)
  const { init, installNow, download, dismiss } = useAppUpdateStore.getState()
  useEffect(() => { init() }, [init])

  const kind = updateNoticeKind(update, dismissedVersion)
  if (!kind) return null
  const vars = { version: update.latestVersion }
  const copy = {
    ready: {
      title: t('updates.readyTitle', vars, `Drama Studio ${vars.version} is ready`),
      detail: t('updates.readyDetail', undefined, 'Restart to finish updating. Your project is saved first. It also installs the next time you quit.'),
      action: t('updates.restartNow', undefined, 'Restart now'),
      run: installNow,
    },
    fetch: {
      title: t('updates.availableTitle', vars, `Drama Studio ${vars.version} is available`),
      detail: t('updates.availableDetail', undefined, 'Download it now and install it when you restart.'),
      action: t('updates.download', undefined, 'Download'),
      run: download,
    },
    download: {
      title: t('updates.outTitle', vars, `Drama Studio ${vars.version} is out`),
      detail: t('updates.outDetail', undefined, 'This copy cannot update itself. Download the new version from the release page.'),
      action: t('updates.getUpdate', undefined, 'Get the update'),
      run: download,
    },
  }[kind]

  return (
    <div className="pointer-events-none fixed right-4 top-14 z-50 w-[min(360px,calc(100vw-32px))]">
      <div role="status" className="pointer-events-auto flex items-start gap-2 rounded-xl border border-sf-dark-600 bg-sf-dark-900/95 p-3 text-xs shadow-2xl shadow-black/40 backdrop-blur">
        <Download className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sf-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sf-text-primary">{copy.title}</div>
          <div className="mt-0.5 text-[11px] text-sf-text-muted">{copy.detail}</div>
          <div className="mt-2 flex gap-2">
            <button type="button" className={primaryButtonClass} disabled={busy} onClick={() => copy.run()}>{copy.action}</button>
            <button type="button" className={buttonClass} onClick={dismiss}>{t('updates.later', undefined, 'Later')}</button>
          </div>
        </div>
        <button type="button" onClick={dismiss} className="text-sf-text-muted hover:text-sf-text-primary" aria-label={t('updates.dismiss', undefined, 'Dismiss')}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
