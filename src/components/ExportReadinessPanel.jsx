import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, Loader2 } from 'lucide-react'
import useTimelineStore from '../stores/timelineStore'
import useProjectStore from '../stores/projectStore'
import useAssetsStore from '../stores/assetsStore'
import { useI18n } from '../i18n/I18nContext'
import {
  buildExportReadinessPlan, EXPORT_READINESS_WARNING_COPY, isExportReadinessContextCurrent,
} from '../utils/exportReadiness.mjs'
import { createExportReadinessChecker } from '../services/exportReadiness.mjs'
import { formatExportOverviewTimecode } from '../utils/exportTimelineOverview.mjs'

/** Optional, advisory checks only. Times are project seconds, with an
 * exclusive rangeEnd. Inspect requests navigation; no authored state changes. */
export default function ExportReadinessPanel({ active = true, rangeStart = 0, rangeEnd = 0,
  includeAudio = true, format = 'mp4', useProxyMedia = false, disabled = false, onInspect }) {
  const { t } = useI18n()
  const clips = useTimelineStore(state => state.clips)
  const tracks = useTimelineStore(state => state.tracks)
  const transitions = useTimelineStore(state => state.transitions)
  const timelineFps = useTimelineStore(state => state.timelineFps)
  const timelineSessionId = useTimelineStore(state => state.timelineSessionId)
  const masterAudioVolume = useTimelineStore(state => state.masterAudioVolume)
  const assets = useAssetsStore(state => state.assets)
  const projectHandle = useProjectStore(state => state.currentProjectHandle)
  const timelineId = useProjectStore(state => state.currentTimelineId)
  const snapshot = useMemo(() => ({ clips, tracks, transitions, timelineFps, timelineSessionId,
    masterAudioVolume, assets, projectHandle, timelineId, rangeStart, rangeEnd, includeAudio, format, useProxyMedia }),
  [clips, tracks, transitions, timelineFps, timelineSessionId, masterAudioVolume, assets, projectHandle,
    timelineId, rangeStart, rangeEnd, includeAudio, format, useProxyMedia])
  const currentRef = useRef(snapshot)
  currentRef.current = snapshot
  const permittedRef = useRef(false)
  permittedRef.current = active && !disabled
  const checkerRef = useRef(null)
  if (!checkerRef.current) checkerRef.current = createExportReadinessChecker()
  const runId = useRef(0)
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState(null)
  const [failed, setFailed] = useState(false)
  const stale = report && !isExportReadinessContextCurrent(report.snapshot, snapshot)

  useEffect(() => {
    runId.current += 1
    checkerRef.current.cancel()
    setRunning(false)
    setFailed(false)
    return () => { runId.current += 1; checkerRef.current.cancel() }
  }, [snapshot, active, disabled])

  const stillCurrent = (captured) => {
    if (!permittedRef.current || currentRef.current !== captured) return false
    // Store reads close the gap before React processes a source/timeline
    // update. Playback-only changes do not invalidate a check.
    const timeline = useTimelineStore.getState(), project = useProjectStore.getState()
    return isExportReadinessContextCurrent(captured, { ...currentRef.current,
      clips: timeline.clips, tracks: timeline.tracks, transitions: timeline.transitions,
      timelineFps: timeline.timelineFps, timelineSessionId: timeline.timelineSessionId,
      masterAudioVolume: timeline.masterAudioVolume, assets: useAssetsStore.getState().assets,
      projectHandle: project.currentProjectHandle, timelineId: project.currentTimelineId })
  }
  const check = async () => {
    if (!permittedRef.current) return
    const captured = currentRef.current, token = ++runId.current
    setRunning(true); setFailed(false)
    try {
      const result = await checkerRef.current.run(buildExportReadinessPlan(captured), { isCurrent: () => stillCurrent(captured) })
      if (result && token === runId.current && stillCurrent(captured)) setReport({ ...result, snapshot: captured })
    } catch (_) {
      if (token === runId.current && stillCurrent(captured)) setFailed(true)
    } finally {
      if (token === runId.current) setRunning(false)
    }
  }
  const cancel = () => { runId.current += 1; checkerRef.current.cancel(); setRunning(false) }
  const timecode = (time) => formatExportOverviewTimecode(Math.max(0, Math.round(time * (report?.snapshot.timelineFps || 24))), report?.snapshot.timelineFps || 24)
  const currentReport = report && !stale
  const status = running ? t('export.readiness.checking', undefined, 'Checking…')
    : stale ? t('export.readiness.stale', undefined, 'Refresh needed')
      : currentReport ? t('export.readiness.warningCount', { count: report.warnings.length }, '{{count}} warnings')
        : t('export.readiness.optional', undefined, 'Optional')

  if (!active) return null
  return <details data-export-readiness className="group border-t border-sf-dark-700 bg-sf-dark-950 text-xs">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sf-text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent">
      <ChevronDown size={13} aria-hidden="true" className="shrink-0 transition-transform group-open:rotate-180" />
      <span className="min-w-0 flex-1 font-medium">{t('export.readiness.title', undefined, 'Before you export')}</span>
      <span className="text-[11px] text-sf-text-muted" aria-live="polite">{status}</span>
    </summary>
    <div className="space-y-3 px-3 pb-3">
      <p className="text-[11px] leading-relaxed text-sf-text-muted">
        {t('export.readiness.help', undefined, 'Check source availability, Optical Flow cache metadata, and possible picture or audio gaps in this range. Warnings are advisory; intentional black and silence are allowed.')}
      </p>
      <div className="flex items-center gap-2">
        <button type="button" onClick={check} disabled={disabled || running}
          className="flex items-center gap-1.5 border border-sf-dark-600 bg-sf-dark-800 px-2.5 py-1.5 text-[11px] text-sf-text-primary hover:bg-sf-dark-700 disabled:cursor-default disabled:opacity-40">
          {running && <Loader2 size={12} aria-hidden="true" className="animate-spin" />}
          {report ? t('export.readiness.refresh', undefined, 'Refresh checks') : t('export.readiness.check', undefined, 'Check this range')}
        </button>
        {running && <button type="button" onClick={cancel} className="px-2 py-1.5 text-[11px] text-sf-text-secondary hover:text-sf-text-primary">
          {t('export.readiness.cancel', undefined, 'Cancel check')}
        </button>}
      </div>
      {stale && <p className="text-[11px] text-sf-text-secondary" role="status">
        {t('export.readiness.staleHelp', undefined, 'The timeline, source records, or export settings changed. Refresh to check the current range.')}
      </p>}
      {failed && <p className="text-[11px] text-sf-text-secondary" role="status">
        {t('export.readiness.failed', undefined, 'The check could not finish. Try again; no media or project data was changed.')}
      </p>}
      {report && <div className={stale ? 'opacity-60' : ''}>
        {!report.warnings.length && <p className="text-[11px] text-sf-text-secondary" role="status">
          {t('export.readiness.noWarnings', undefined, 'No warnings found by these checks.')}
        </p>}
        {!!report.warnings.length && <ul className="max-h-48 space-y-2 overflow-y-auto pr-1" aria-label={t('export.readiness.warnings', undefined, 'Export readiness warnings')}>
          {report.warnings.map((warning) => {
            const [title, detail] = EXPORT_READINESS_WARNING_COPY[warning.code] || ['', '']
            return <li key={warning.id} className="flex items-start gap-2 border-t border-sf-dark-700 pt-2 first:border-0 first:pt-0">
              <AlertTriangle size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-sf-text-muted" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-sf-text-secondary">{t(`export.readiness.warning.${warning.code}.title`, warning, title)}</p>
                <p className="break-words text-[11px] leading-relaxed text-sf-text-muted">{t(`export.readiness.warning.${warning.code}.detail`, warning, detail)}</p>
                {Number.isFinite(warning.time) && <span className="font-mono text-[11px] tabular-nums text-sf-text-muted">
                  {timecode(warning.time)}{Number.isFinite(warning.endTime) ? ` – ${timecode(warning.endTime)}` : ''}
                </span>}
              </div>
              {onInspect && Number.isFinite(warning.time) && <button type="button" disabled={disabled || running || !!stale}
                onClick={() => { if (stillCurrent(report.snapshot)) onInspect(warning.time, warning) }}
                className="shrink-0 px-1 py-0.5 text-[11px] text-sf-text-secondary underline underline-offset-2 hover:text-sf-text-primary disabled:cursor-default disabled:opacity-40">
                {t('export.readiness.inspect', undefined, 'Inspect')}
              </button>}
            </li>
          })}
        </ul>}
        <p className="mt-2 text-[11px] leading-relaxed text-sf-text-muted">
          {t('export.readiness.limitations', undefined, 'Availability and timeline checks only—not a decode or render test. Source changes and cache fingerprints are validated during export. Refresh after moving files; export safety checks still apply.')}
        </p>
      </div>}
    </div>
  </details>
}
