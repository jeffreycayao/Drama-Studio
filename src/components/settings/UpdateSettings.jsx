import { useEffect } from 'react'
import { RefreshCcw } from 'lucide-react'
import useAppUpdateStore from '../../stores/appUpdateStore'
import { useI18n } from '../../i18n/I18nContext'
import { buttonClass, primaryButtonClass } from '../audio/ModalShell'

function statusText(update, t) {
  if (!update) return t('updates.statusDetecting', undefined, 'Checking how this copy was installed…')
  const version = update.latestVersion
  switch (update.status) {
    case 'off': return t('updates.statusOff', undefined, 'Updates are not checked in this copy.')
    case 'idle': return t('updates.statusIdle', undefined, 'Drama Studio checks for updates shortly after it starts.')
    case 'checking': return t('updates.statusChecking', undefined, 'Checking for updates…')
    case 'up-to-date': return t('updates.statusUpToDate', { version: update.currentVersion }, `You have the latest version (${update.currentVersion}).`)
    case 'available': return t('updates.statusAvailable', { version }, `Drama Studio ${version} is available.`)
    case 'downloading': return update.percent != null
      ? t('updates.statusDownloadingPercent', { version, percent: update.percent }, `Downloading Drama Studio ${version} (${update.percent}%)…`)
      : t('updates.statusDownloading', { version }, `Downloading Drama Studio ${version}…`)
    case 'ready': return t('updates.statusReady', { version }, `Drama Studio ${version} is downloaded. Restart to install it.`)
    case 'error': return t(`updates.errors.${update.errorCode || 'unknown'}`, undefined, update.error || 'The update check did not work.')
    default: return ''
  }
}

/** Settings › Updates: version, Check now, and automatic downloads. */
export default function UpdateSettings() {
  const { t } = useI18n()
  const update = useAppUpdateStore((state) => state.update)
  const busy = useAppUpdateStore((state) => state.busy)
  const { init, check, download, installNow, setAutoDownload } = useAppUpdateStore.getState()
  useEffect(() => { init() }, [init])

  const mode = update?.mode
  const autoDownload = update?.autoDownload === true
  const checkedAt = update?.checkedAt ? new Date(update.checkedAt).toLocaleString() : null

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-sf-dark-700 bg-sf-dark-900/60 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-sf-text-primary">Drama Studio {update?.currentVersion || ''}</div>
            <p className="mt-1 text-[11px] text-sf-text-muted" role="status">{statusText(update, t)}</p>
            {checkedAt && <p className="mt-1 text-[10px] text-sf-text-muted">{t('updates.lastChecked', { time: checkedAt }, `Last checked ${checkedAt}`)}</p>}
          </div>
          {mode && mode !== 'off' && (
            <button type="button" className={`${buttonClass} flex items-center gap-1.5`} disabled={busy || update?.status === 'checking' || update?.status === 'downloading'} onClick={check}>
              <RefreshCcw className="h-3.5 w-3.5" aria-hidden /> {t('updates.checkNow', undefined, 'Check now')}
            </button>
          )}
        </div>
        {update?.status === 'ready' && (
          <button type="button" className={`${primaryButtonClass} mt-3`} disabled={busy} onClick={installNow}>
            {t('updates.restartAndUpdate', undefined, 'Restart and update')}
          </button>
        )}
        {update?.status === 'available' && (
          <button type="button" className={`${primaryButtonClass} mt-3`} onClick={download}>
            {mode === 'notify' ? t('updates.openDownloadPage', undefined, 'Open the download page') : t('updates.downloadNow', undefined, 'Download now')}
          </button>
        )}
      </div>

      {mode === 'auto' && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-sf-dark-700 bg-sf-dark-900/60 px-3 py-3">
          <div className="min-w-0">
            <div className="text-sm text-sf-text-primary">{t('updates.autoDownload', undefined, 'Download updates automatically')}</div>
            <p className="mt-1 text-[11px] text-sf-text-muted">{t('updates.autoDownloadHelp', undefined, 'New versions download in the background and install when you restart.')}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autoDownload}
            onClick={() => setAutoDownload(!autoDownload)}
            className={`w-10 h-5 rounded-full transition-colors flex-shrink-0 relative ${autoDownload ? 'bg-sf-accent' : 'bg-sf-dark-600'}`}
            title={autoDownload ? t('updates.autoDownloadTurnOff', undefined, 'Turn off automatic downloads') : t('updates.autoDownloadTurnOn', undefined, 'Turn on automatic downloads')}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${autoDownload ? 'left-[calc(100%-1.25rem)]' : 'left-0.5'}`} aria-hidden />
          </button>
        </div>
      )}

      {mode === 'notify' && (
        <p className="text-[11px] text-sf-text-muted">{t('updates.notifyHelp', undefined, 'This copy cannot replace itself. Drama Studio tells you when a new version is out and opens the download page.')}</p>
      )}
    </div>
  )
}
