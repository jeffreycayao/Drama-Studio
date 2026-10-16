import { useEffect, useState } from 'react'
import { APP_VERSION } from '../../config/projectInfo'
import { useI18n } from '../../i18n/I18nContext'

/**
 * Shields.io-style "version | v0.1.9" badge, drawn locally so it works offline
 * and under the app's Content-Security-Policy (no image request to
 * img.shields.io). Same colours as the README badge: charcoal label, lime
 * value with charcoal text.
 *
 * The version comes from the running app (`app.getVersion()` over IPC), so it
 * is always the real build; the bundled package.json version is only the
 * fallback outside Electron. Unpackaged dev runs show a "dev" suffix.
 */

let appInfoPromise = null

export function loadAppInfo() {
  if (!appInfoPromise) {
    const api = typeof window !== 'undefined' ? window.electronAPI : null
    appInfoPromise = (api?.getAppInfo ? api.getAppInfo() : Promise.resolve(null))
      .then((info) => (info?.version ? info : { version: APP_VERSION, packaged: false }))
      .catch(() => ({ version: APP_VERSION, packaged: false }))
  }
  return appInfoPromise
}

export function useAppInfo() {
  const [info, setInfo] = useState(null)
  useEffect(() => {
    let cancelled = false
    loadAppInfo().then((value) => { if (!cancelled) setInfo(value) })
    return () => { cancelled = true }
  }, [])
  return info
}

export default function VersionBadge({ className = '' }) {
  const { t } = useI18n()
  const info = useAppInfo()
  const version = info?.version || APP_VERSION
  const isDev = info ? !info.packaged : false
  const details = [
    `Drama Studio ${version}${isDev ? ' (dev)' : ''}`,
    info?.electron ? `Electron ${info.electron}` : '',
    info?.chrome ? `Chromium ${info.chrome}` : '',
    info?.node ? `Node ${info.node}` : '',
  ].filter(Boolean).join(' · ')
  return (
    <span
      className={`inline-flex items-stretch overflow-hidden rounded-[3px] font-sans text-[10px] font-medium leading-none tracking-normal normal-case shadow-sm ${className}`}
      title={details}
      aria-label={t('footer.versionAria', { version }, `Drama Studio version ${version}`)}
      data-testid="version-badge"
      data-version={version}
    >
      <span className="bg-sf-dark-700 px-1.5 py-[3px] text-sf-text-primary">{t('footer.versionLabel', undefined, 'version')}</span>
      <span className="bg-sf-accent px-1.5 py-[3px] font-semibold text-sf-accent-on">
        v{version}{isDev ? '-dev' : ''}
      </span>
    </span>
  )
}
