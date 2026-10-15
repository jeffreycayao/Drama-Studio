import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Circle, Cloud, Loader2, MinusCircle, RefreshCw, Stethoscope, XCircle } from 'lucide-react'
import useProjectStore from '../stores/projectStore'
import { runSetupDoctor, installSetupCaptionEngine, installSetupComfyBridge } from '../services/setupDoctor'
import { SETUP_FIX, SETUP_STATUS } from '../utils/setupDoctorReport'
import { useI18n } from '../i18n/I18nContext'

const STATUS_STYLE = {
  [SETUP_STATUS.READY]: { icon: CheckCircle2, pill: 'border-sf-success/30 bg-sf-success/10 text-sf-success', iconClass: 'text-sf-success' },
  [SETUP_STATUS.NEEDS_ACTION]: { icon: XCircle, pill: 'border-sf-error/40 bg-sf-error/10 text-sf-error', iconClass: 'text-sf-error' },
  [SETUP_STATUS.WARNING]: { icon: AlertCircle, pill: 'border-sf-warning/40 bg-sf-warning/10 text-sf-warning', iconClass: 'text-sf-warning' },
  [SETUP_STATUS.CLOUD]: { icon: Cloud, pill: 'border-sf-blue/40 bg-sf-blue/10 text-sf-blue', iconClass: 'text-sf-blue' },
  [SETUP_STATUS.OPTIONAL]: { icon: Circle, pill: 'border-sf-dark-500 bg-sf-dark-800 text-sf-text-secondary', iconClass: 'text-sf-text-muted' },
  [SETUP_STATUS.UNAVAILABLE]: { icon: MinusCircle, pill: 'border-sf-dark-600 bg-sf-dark-900 text-sf-text-muted', iconClass: 'text-sf-text-muted' },
}

function useProjectsPath() {
  const handle = useProjectStore((state) => state.defaultProjectsHandle)
  return typeof handle === 'string' ? handle : ''
}

/**
 * Runs the Setup Doctor and keeps the latest report. `auto` runs it once on
 * mount; `run()` re-checks on demand.
 */
export function useSetupDoctor({ auto = true } = {}) {
  const projectsPath = useProjectsPath()
  const [report, setReport] = useState(null)
  const [running, setRunning] = useState(false)
  const runIdRef = useRef(0)

  const run = useCallback(async () => {
    const runId = ++runIdRef.current
    setRunning(true)
    try {
      const next = await runSetupDoctor({ projectsPath })
      if (runId === runIdRef.current) setReport(next)
    } finally {
      if (runId === runIdRef.current) setRunning(false)
    }
  }, [projectsPath])

  useEffect(() => {
    if (auto) run()
  }, [auto, run])

  return { report, running, run }
}

function StatusPill({ status }) {
  const { t } = useI18n()
  const style = STATUS_STYLE[status] || STATUS_STYLE[SETUP_STATUS.OPTIONAL]
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${style.pill}`}>
      {t(`setupDoctor.status.${status}`)}
    </span>
  )
}

function CheckRow({ item, actionState, onFix }) {
  const { t } = useI18n()
  const style = STATUS_STYLE[item.status] || STATUS_STYLE[SETUP_STATUS.OPTIONAL]
  const Icon = style.icon
  const busy = Boolean(actionState?.busy)
  const fixLabel = busy && item.fix?.type === SETUP_FIX.INSTALL_CAPTIONS && Number.isFinite(actionState?.percent)
    ? t('setupDoctor.fix.installingCaptions', { percent: Math.round(actionState.percent) })
    : item.fix ? t(item.fix.key) : null

  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconClass}`} />
      <div className="min-w-0 flex-1">
        <div className="text-xs leading-relaxed text-sf-text-secondary">{t(item.key, item.vars)}</div>
        {item.reasons?.length > 0 && item.status !== SETUP_STATUS.READY && (
          <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-sf-text-muted">
            {item.reasons.map((reason) => (
              <li key={reason.key} className="flex gap-1.5">
                <span aria-hidden="true" className="text-sf-accent-muted">›</span>
                <span>{t(reason.key, reason.vars)}</span>
              </li>
            ))}
          </ul>
        )}
        {actionState?.error && (
          <div className="mt-1 text-[11px] text-sf-error">{t('setupDoctor.fix.failed', { error: actionState.error })}</div>
        )}
      </div>
      {item.fix && item.status !== SETUP_STATUS.READY && (
        <button
          type="button"
          onClick={() => onFix(item)}
          disabled={busy}
          className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-60 ${
            item.status === SETUP_STATUS.NEEDS_ACTION
              ? 'bg-sf-accent text-sf-accent-on hover:bg-sf-accent-hover'
              : 'border border-sf-dark-500 bg-sf-dark-800 text-sf-text-secondary hover:border-sf-dark-400 hover:text-sf-text-primary'
          }`}
        >
          {busy && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
          {fixLabel}
        </button>
      )}
    </div>
  )
}

export default function SetupDoctorPanel({ onOpenSettings, onNavigate, onOpenApiKey }) {
  const { t } = useI18n()
  const { report, running, run } = useSetupDoctor()
  const [actions, setActions] = useState({})

  const setAction = (id, patch) => setActions((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))

  const handleFix = async (item) => {
    const fix = item.fix
    if (!fix) return
    if (fix.type === SETUP_FIX.SETTINGS) return onOpenSettings?.(fix.target)
    if (fix.type === SETUP_FIX.NAVIGATE) return onNavigate?.(fix.target)
    if (fix.type === SETUP_FIX.API_KEY) return onOpenApiKey?.()

    setAction(item.id, { busy: true, error: null, percent: null })
    try {
      if (fix.type === SETUP_FIX.INSTALL_CAPTIONS) {
        await installSetupCaptionEngine((progress) => {
          if (Number.isFinite(progress?.percent)) setAction(item.id, { percent: progress.percent })
        })
      } else if (fix.type === SETUP_FIX.INSTALL_BRIDGE) {
        await installSetupComfyBridge()
      }
      setAction(item.id, { busy: false })
      run()
    } catch (error) {
      setAction(item.id, { busy: false, error: error?.message || String(error) })
    }
  }

  const summary = report?.summary
  const checkedTime = report?.checkedAt
    ? new Date(report.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <section className="rounded-xl border border-sf-dark-600 bg-sf-dark-900">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-sf-dark-700 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-sf-dark-800 p-2">
            <Stethoscope className="h-4 w-4 text-sf-accent" />
          </div>
          <div>
            <div className="font-display text-sm font-bold text-sf-text-primary">{t('setupDoctor.title')}</div>
            <div className="mt-0.5 text-xs text-sf-text-muted">{t('setupDoctor.intro')}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {summary && (
            summary.needsAction === 0 && summary.warnings === 0 ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-sf-success">{t('setupDoctor.summary.allReady')}</span>
            ) : (
              <>
                {summary.needsAction > 0 && <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-sf-error">{t('setupDoctor.summary.needsAction', { count: summary.needsAction })}</span>}
                {summary.warnings > 0 && <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-sf-warning">{t('setupDoctor.summary.warnings', { count: summary.warnings })}</span>}
              </>
            )
          )}
          {summary?.cloud > 0 && <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-sf-blue">{t('setupDoctor.summary.cloud', { count: summary.cloud })}</span>}
          {summary?.optional > 0 && <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-sf-text-muted">{t('setupDoctor.summary.optional', { count: summary.optional })}</span>}
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="inline-flex items-center gap-1.5 rounded-md border border-sf-dark-500 bg-sf-dark-800 px-2.5 py-1 text-[11px] text-sf-text-secondary transition-colors hover:border-sf-dark-400 hover:text-sf-text-primary disabled:opacity-60"
          >
            <RefreshCw className={`h-3 w-3 ${running ? 'animate-spin' : ''}`} />
            {running ? t('setupDoctor.checking') : t('setupDoctor.runAgain')}
          </button>
        </div>
      </header>

      {!report ? (
        <div className="flex items-center gap-2 px-4 py-6 text-xs text-sf-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('setupDoctor.checking')}
        </div>
      ) : (
        <div className="grid gap-px bg-sf-dark-700 lg:grid-cols-2">
          {report.areas.map((area) => (
            <div key={area.id} className={`bg-sf-dark-900 px-4 py-3 ${area.id === 'computer' ? 'lg:col-span-2' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-sf-text-primary">{t(`setupDoctor.areas.${area.id}.title`)}</div>
                  <div className="mt-0.5 text-[11px] text-sf-text-muted">{t(`setupDoctor.areas.${area.id}.description`)}</div>
                </div>
                <StatusPill status={area.status} />
              </div>
              <div className="mt-1 divide-y divide-sf-dark-800">
                {area.checks.map((item) => (
                  <CheckRow key={item.id} item={item} actionState={actions[item.id]} onFix={handleFix} />
                ))}
              </div>
              {area.id === 'computer' && area.checks.some((item) => item.status === SETUP_STATUS.CLOUD || item.status === SETUP_STATUS.WARNING) && (
                <div className="mt-2 rounded-lg border border-sf-blue/25 bg-sf-blue/5 px-3 py-2 text-[11px] leading-relaxed text-sf-text-secondary">
                  {t('setupDoctor.ai.cloudWhy')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {checkedTime && (
        <div className="border-t border-sf-dark-700 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-sf-text-muted">
          {t('setupDoctor.lastChecked', { time: checkedTime })}
        </div>
      )}
    </section>
  )
}
