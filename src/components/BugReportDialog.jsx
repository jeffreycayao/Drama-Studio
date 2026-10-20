import { useEffect, useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import ModalShell, { buttonClass, fieldClass, primaryButtonClass } from './audio/ModalShell'
import useBugReportStore from '../stores/bugReportStore'
import { useI18n } from '../i18n/I18nContext'
import { collectFeedbackDiagnostics } from '../services/feedback'
import { BUG_REPORT_LIMITS, buildBugReportBody, buildBugReportTitle, bugReportReady } from '../utils/bugReport.mjs'

const EMPTY = { summary: '', whatHappened: '', steps: '', expected: '' }

/** Report a bug: fill in a short form, preview it, then open a filled-in GitHub issue to submit. */
function BugReportForm({ onClose }) {
  const { t } = useI18n()
  const [fields, setFields] = useState(EMPTY)
  const [includeSystem, setIncludeSystem] = useState(true)
  const [diagnostics, setDiagnostics] = useState(null)
  const [state, setState] = useState({ busy: false, opened: false, truncated: false, error: '' })

  useEffect(() => {
    let alive = true
    collectFeedbackDiagnostics().then((value) => { if (alive) setDiagnostics(value) }).catch(() => {})
    return () => { alive = false }
  }, [])

  const set = (key) => (event) => setFields((current) => ({ ...current, [key]: event.target.value }))
  const title = buildBugReportTitle(fields)
  const body = useMemo(
    () => buildBugReportBody({ ...fields, diagnostics: includeSystem ? diagnostics : null }),
    [fields, includeSystem, diagnostics],
  )
  const ready = bugReportReady(fields)

  const openOnGitHub = async () => {
    setState({ busy: true, opened: false, truncated: false, error: '' })
    const result = await window.electronAPI?.bugReport?.open({ title, body })
    if (result?.success) setState({ busy: false, opened: true, truncated: result.truncated === true, error: '' })
    else setState({ busy: false, opened: false, truncated: false, error: result?.error || t('bugReport.openFailed', undefined, 'GitHub could not be opened.') })
  }

  const label = 'block text-xs font-medium text-sf-text-secondary mb-1'
  const footer = state.opened ? (
    <button type="button" className={primaryButtonClass} onClick={onClose}>{t('bugReport.done', undefined, 'Done')}</button>
  ) : (
    <>
      <button type="button" className={buttonClass} onClick={onClose}>{t('bugReport.cancel', undefined, 'Cancel')}</button>
      <button type="button" className={`${primaryButtonClass} inline-flex items-center gap-1.5`} disabled={!ready || state.busy} onClick={openOnGitHub}>
        <ExternalLink className="h-3.5 w-3.5" aria-hidden /> {t('bugReport.openGitHub', undefined, 'Open on GitHub')}
      </button>
    </>
  )

  return (
    <ModalShell title={t('bugReport.title', undefined, 'Report a bug')} titleId="bug-report-title" onClose={onClose} footer={footer} testId="bug-report-dialog" wide>
      {state.opened ? (
        <div className="space-y-2 text-sm" role="status">
          <p className="text-sf-text-primary">{t('bugReport.openedTitle', undefined, 'GitHub is open in your browser with your report filled in.')}</p>
          <p className="text-xs text-sf-text-muted">{t('bugReport.openedDetail', undefined, 'Check it, then click "Create" (or "Submit new issue"). You need a free GitHub account; sign in there if asked. Nothing is sent until you click it.')}</p>
          {state.truncated && <p className="text-xs text-sf-text-muted">{t('bugReport.truncated', undefined, 'Your report was long, so the end was cut from the link. Paste the rest into GitHub if it matters.')}</p>}
        </div>
      ) : (
        <>
          <p className="text-xs text-sf-text-muted">
            {t('bugReport.intro', undefined, 'Tell us what went wrong. When you click Open on GitHub, your browser opens a new issue on the Drama Studio GitHub page with this filled in, and you submit it there.')}
          </p>
          <div>
            <label className={label} htmlFor="bug-summary">{t('bugReport.summary', undefined, 'Short title')}</label>
            <input id="bug-summary" className={fieldClass} maxLength={BUG_REPORT_LIMITS.title} value={fields.summary} onChange={set('summary')}
              placeholder={t('bugReport.summaryPlaceholder', undefined, 'Export stops at 90% with captions on')} />
          </div>
          <div>
            <label className={label} htmlFor="bug-what">{t('bugReport.whatHappened', undefined, 'What happened?')}</label>
            <textarea id="bug-what" rows={3} className={fieldClass} maxLength={BUG_REPORT_LIMITS.field} value={fields.whatHappened} onChange={set('whatHappened')} />
          </div>
          <div>
            <label className={label} htmlFor="bug-steps">{t('bugReport.steps', undefined, 'Steps to make it happen again')}</label>
            <textarea id="bug-steps" rows={3} className={fieldClass} maxLength={BUG_REPORT_LIMITS.field} value={fields.steps} onChange={set('steps')}
              placeholder={t('bugReport.stepsPlaceholder', undefined, '1. Open a project\n2. Add captions\n3. Export as MP4')} />
          </div>
          <div>
            <label className={label} htmlFor="bug-expected">{t('bugReport.expected', undefined, 'What did you expect?')}</label>
            <textarea id="bug-expected" rows={2} className={fieldClass} maxLength={BUG_REPORT_LIMITS.field} value={fields.expected} onChange={set('expected')} />
          </div>
          <label className="flex items-start gap-2 text-xs text-sf-text-secondary">
            <input type="checkbox" className="mt-0.5" checked={includeSystem} onChange={(event) => setIncludeSystem(event.target.checked)} />
            <span>{t('bugReport.includeSystem', undefined, 'Add my Drama Studio version and system info (operating system, graphics card, screen size, whether ComfyUI is connected). No file names, paths or personal details.')}</span>
          </label>
          <details className="rounded border border-sf-dark-700 bg-sf-dark-950/60">
            <summary className="cursor-pointer px-3 py-2 text-xs text-sf-text-secondary">{t('bugReport.preview', undefined, 'Preview what GitHub will receive')}</summary>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 font-mono text-[11px] text-sf-text-muted">{`${title || '[Bug] …'}\n\n${body}`}</pre>
          </details>
          <p className="text-[11px] text-sf-text-muted">{t('bugReport.publicNote', undefined, 'Issues on GitHub are public. Security problems: use Settings › Send Feedback or the security policy instead, never a public issue.')}</p>
          {state.error && <p className="text-xs text-red-400" role="alert">{state.error}</p>}
        </>
      )}
    </ModalShell>
  )
}

export default function BugReportDialog() {
  const open = useBugReportStore((state) => state.open)
  const close = useBugReportStore((state) => state.closeBugReport)
  if (!open) return null
  return <BugReportForm onClose={close} />
}
