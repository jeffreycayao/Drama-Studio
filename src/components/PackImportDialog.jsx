import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ChevronRight, FileText, FolderOpen, Image as ImageIcon, Loader2, Package, ShieldAlert, Workflow, X } from 'lucide-react'
import useProjectStore from '../stores/projectStore'
import { useI18n } from '../i18n/I18nContext'
import {
  checkPackWorkflows,
  choosePack,
  discardPack,
  importPackSelection,
  inspectPack,
  isPackImportAvailable,
} from '../services/packImport'
import {
  canImportMediaItem,
  countPackSelection,
  initialPackSelection,
  packErrorKey,
  shortList,
} from '../utils/packImportPlan.mjs'

const formatBytes = (bytes) => {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Generate › My Workflows › "Import pack…", the command palette, or a .zip
 * dropped on the app.
 * 1. Main unzips the pack with limits and classifies every file
 *    (electron/packImport.cjs). Nothing is kept yet.
 * 2. Review: workflows (with the dependency check), prompt templates, media,
 *    and code, which is explained and never run or installed.
 * 3. Import only what is ticked: workflows → My Workflows › <pack name>,
 *    media → Assets, LUTs → the LUT library, templates kept with the pack.
 */
export default function PackImportDialog({ filePath = '', onClose }) {
  const { t } = useI18n()
  const tr = (key, vars) => t(`packImport.${key}`, vars)
  const hasProject = useProjectStore((state) => Boolean(state.currentProjectHandle))
  const projectHandle = useProjectStore((state) => state.currentProjectHandle)
  const [phase, setPhase] = useState(filePath ? 'reading' : 'pick') // pick | reading | review | importing | done
  const [pack, setPack] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [checks, setChecks] = useState({})
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [summary, setSummary] = useState(null)
  const [showReadme, setShowReadme] = useState(false)
  const [showSkipped, setShowSkipped] = useState(false)
  const dialogRef = useRef(null)
  const packRef = useRef(null)
  const busy = phase === 'reading' || phase === 'importing'

  const errorText = (result) => {
    if (result?.code === 'DESKTOP_ONLY') return tr('errors.desktopOnly')
    const key = packErrorKey(result?.code)
    return key === 'generic' ? tr('errors.generic', { message: result?.error || '' }) : tr(`errors.${key}`)
  }

  const adopt = (result) => {
    if (result?.code === 'CANCELED') { setPhase('pick'); return }
    if (!result?.ok) { setError(errorText(result)); setPhase('pick'); return }
    packRef.current = result
    setPack(result)
    setSelected(initialPackSelection(result, { hasProject }))
    setChecks(Object.fromEntries(result.workflows.map((item) => [item.id, { status: 'checking' }])))
    setPhase('review')
    void checkPackWorkflows(result, { onResult: (id, value) => setChecks((current) => ({ ...current, [id]: value })) })
  }

  const open = async (path) => {
    setError('')
    setPhase('reading')
    try {
      adopt(path ? await inspectPack(path) : await choosePack())
    } catch (err) {
      setError(errorText({ error: err?.message }))
      setPhase('pick')
    }
  }

  useEffect(() => {
    if (filePath) void open(filePath)
    // The temp folder goes when the dialog closes, whatever happened.
    return () => { if (packRef.current?.packId) void discardPack(packRef.current.packId) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    dialogRef.current?.focus()
    const onKey = (event) => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, busy])

  const counts = useMemo(() => (pack ? countPackSelection(pack, selected, { hasProject }) : { total: 0 }), [pack, selected, hasProject])

  const toggle = (id) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const setGroup = (items, on) => setSelected((current) => {
    const next = new Set(current)
    for (const item of items) {
      if (on && item.mediaType && !canImportMediaItem(item, { hasProject })) continue
      if (on) next.add(item.id)
      else next.delete(item.id)
    }
    return next
  })

  const runImport = async () => {
    if (!pack || phase !== 'review' || !counts.total) return
    setPhase('importing')
    setError('')
    try {
      const result = await importPackSelection(pack, selected, { projectHandle, onProgress: (step) => setStatus(tr('importingItem', { name: step })) })
      setSummary(result)
      setPhase('done')
    } catch (err) {
      setError(errorText({ error: err?.message }))
      setPhase('review')
    }
  }

  const openMyWorkflows = () => {
    window.dispatchEvent(new CustomEvent('comfystudio-open-generate-tab', { detail: { source: 'pack-import' } }))
    // Generate mounts with the tab; it switches to My Workflows on this event.
    setTimeout(() => window.dispatchEvent(new CustomEvent('drama-studio-open-my-workflows')), 150)
    onClose()
  }

  const checkLine = (id) => {
    const check = checks[id] || { status: 'checking' }
    if (check.status === 'checking') return <span className="text-sf-text-muted"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" />{tr('check.checking')}</span>
    if (check.status === 'ready') return <span className="text-emerald-300/90">{tr('check.ready')}</span>
    if (check.status === 'offline') return <span className="text-sf-text-muted">{tr('check.offline')}</span>
    if (check.status === 'error') return <span className="text-amber-200">{tr('errors.generic', { message: check.error || '' })}</span>
    return <span className="text-amber-200">
      {check.missingNodes.length > 0 && <span className="block">{tr('check.missingNodes', { list: shortList(check.missingNodes) })}</span>}
      {check.missingModels.length > 0 && <span className="block">{tr('check.missingModels', { list: shortList(check.missingModels) })}</span>}
    </span>
  }

  const renderRow = ({ item, icon: Icon, meta, detail, disabled = false }) => (
    <label key={item.id} className={`flex items-start gap-2 rounded px-2 py-1.5 ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-sf-dark-700/60'}`}>
      <input type="checkbox" className="mt-0.5" checked={selected.has(item.id) && !disabled} disabled={disabled || busy} onChange={() => toggle(item.id)}
        data-testid={`pack-item-${item.id}`} />
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sf-text-muted" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sf-text-primary" title={item.path}>{item.title}</span>
        <span className="block truncate text-[11px] text-sf-text-muted">{meta}</span>
        {item.description && <span className="block text-[11px] leading-relaxed text-sf-text-secondary">{item.description}</span>}
        {detail && <span className="block text-[11px] leading-relaxed">{detail}</span>}
      </span>
    </label>
  )

  const renderSection = ({ title, hint, items }, children) => (
    <section className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sf-text-muted">{title}</h3>
        {items?.length > 1 && (
          <span className="flex shrink-0 gap-2 text-[11px]">
            <button type="button" disabled={busy} onClick={() => setGroup(items, true)} className="text-sf-text-muted hover:text-sf-text-primary">{tr('selectAll')}</button>
            <button type="button" disabled={busy} onClick={() => setGroup(items, false)} className="text-sf-text-muted hover:text-sf-text-primary">{tr('selectNone')}</button>
          </span>
        )}
      </div>
      {hint && <p className="text-[11px] leading-relaxed text-sf-text-muted">{hint}</p>}
      <div className="space-y-0.5">{children}</div>
    </section>
  )

  const manifest = pack?.manifest
  const credits = pack ? [
    manifest?.author && tr('by', { author: manifest.author }),
    manifest?.version && tr('version', { version: manifest.version }),
    manifest?.license && tr('license', { license: manifest.license }),
    tr('source', { file: pack.fileName }),
  ].filter(Boolean).join(' · ') : ''

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3 sm:p-4"
      onMouseDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget && !busy) onClose() }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="pack-import-title" data-testid="pack-import-dialog" tabIndex={-1}
        className="flex max-h-[90vh] w-full min-w-0 max-w-2xl flex-col overflow-hidden rounded-lg border border-sf-dark-600 bg-sf-dark-800 text-sf-text-primary shadow-2xl">
        <header className="flex flex-shrink-0 items-start gap-3 border-b border-sf-dark-700 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="pack-import-title" className="flex items-center gap-1.5 text-sm font-medium">
              <Package className="h-4 w-4 text-sf-accent" />
              {pack ? tr('titleWithName', { name: pack.name }) : tr('title')}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-sf-text-muted">{pack ? credits : tr('intro')}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label={tr('close')} className="rounded p-1 text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary disabled:opacity-40"><X className="h-4 w-4" /></button>
        </header>

        <div className="min-h-0 space-y-4 overflow-y-auto px-4 py-4 text-xs">
          {phase === 'pick' && (
            <div className="space-y-3">
              <p className="leading-relaxed text-sf-text-secondary">{tr('pickHelp')}</p>
              <button type="button" data-testid="pack-import-choose" onClick={() => open('')} disabled={!isPackImportAvailable()}
                className="inline-flex items-center gap-1.5 rounded bg-sf-accent px-3 py-1.5 font-medium text-sf-dark-900 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
                <FolderOpen className="h-3.5 w-3.5" />{tr('choose')}
              </button>
              {!isPackImportAvailable() && <p className="text-sf-text-muted">{tr('errors.desktopOnly')}</p>}
            </div>
          )}

          {phase === 'reading' && (
            <p role="status" className="flex items-center gap-2 text-sf-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />{tr('reading')}</p>
          )}

          {pack && (phase === 'review' || phase === 'importing') && <>
            {manifest?.description && <p className="leading-relaxed text-sf-text-secondary">{manifest.description}</p>}
            {pack.readme && (
              <div className="rounded border border-sf-dark-600 bg-sf-dark-900/50">
                <button type="button" onClick={() => setShowReadme((value) => !value)} className="flex w-full items-center gap-1 px-3 py-2 text-left text-sf-text-secondary hover:text-sf-text-primary">
                  {showReadme ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{tr('readme')}
                </button>
                {showReadme && (
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 font-sans text-[11px] leading-relaxed text-sf-text-secondary">
                    {pack.readme.text}{pack.readme.truncated ? '…' : ''}
                  </pre>
                )}
              </div>
            )}

            {pack.workflows.length > 0 && renderSection({
              title: tr('sections.workflows', { count: pack.workflows.length }),
              hint: tr('sections.workflowsHint', { pack: pack.name }),
              items: pack.workflows,
            }, <>
              {pack.workflows.map((item) => renderRow({
                item,
                icon: Workflow,
                meta: `${tr(`format.${item.format}`)} · ${tr('nodeCount', { count: item.nodeCount })} · ${item.path}`,
                detail: checkLine(item.id),
              }))}
              {Object.values(checks).some((check) => check.status === 'missing') && (
                <p className="px-2 pt-1 text-[11px] leading-relaxed text-sf-text-muted">{tr('check.fixHint')}</p>
              )}
            </>)}

            {pack.templates.length > 0 && renderSection({
              title: tr('sections.templates', { count: pack.templates.length }),
              hint: tr('sections.templatesHint'),
              items: pack.templates,
            }, pack.templates.map((item) => renderRow({
              item,
              icon: FileText,
              meta: `${tr(`subtype.${item.subtype}`)} · ${formatBytes(item.size)} · ${item.path}`,
            })))}

            {pack.media.length > 0 && renderSection({
              title: tr('sections.media', { count: pack.media.length }),
              hint: hasProject ? tr('sections.mediaHint', { pack: pack.name }) : tr('sections.mediaNeedsProject'),
              items: pack.media,
            }, pack.media.map((item) => renderRow({
              item,
              icon: ImageIcon,
              disabled: !canImportMediaItem(item, { hasProject }),
              meta: `${tr(`mediaType.${item.mediaType}`)} · ${formatBytes(item.size)} · ${item.path}`,
            })))}

            {pack.code.length > 0 && (
              <section data-testid="pack-import-code" className="space-y-2 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-200">
                  <ShieldAlert className="h-3.5 w-3.5" />{tr('sections.code', { count: pack.code.reduce((sum, group) => sum + group.fileCount, 0) })}
                </h3>
                <p className="text-[11px] leading-relaxed text-sf-text-secondary">{tr('sections.codeHint')}</p>
                {pack.code.map((group) => (
                  <div key={group.id} className="space-y-0.5 border-t border-amber-500/15 pt-2">
                    <p className="text-sf-text-primary">
                      {group.name ? <span className="font-medium">{group.name}: </span> : null}{tr(`codeType.${group.type}`)}
                    </p>
                    <p className="truncate text-[11px] text-sf-text-muted" title={group.files.join('\n')}>
                      {group.fileCount > 1 ? `${tr('codeFiles', { count: group.fileCount })} · ` : ''}{shortList(group.files.map((file) => file.split('/').pop()), 4)}
                    </p>
                    {group.patterns.map((pattern) => (
                      <p key={pattern} className="text-[11px] leading-relaxed text-sf-text-secondary">{tr(`pattern.${pattern}`)}</p>
                    ))}
                  </div>
                ))}
                {(pack.toolPatterns || []).length > 0 && (
                  <div className="space-y-0.5 border-t border-amber-500/15 pt-2">
                    {pack.toolPatterns.map((pattern) => (
                      <p key={pattern} className="text-[11px] leading-relaxed text-sf-text-secondary">{tr(`pattern.${pattern}`)}</p>
                    ))}
                  </div>
                )}
              </section>
            )}

            {pack.skippedCount > 0 && (
              <div>
                <button type="button" onClick={() => setShowSkipped((value) => !value)} className="flex items-center gap-1 text-[11px] text-sf-text-muted hover:text-sf-text-primary">
                  {showSkipped ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}{tr('sections.skipped', { count: pack.skippedCount })}
                </button>
                {showSkipped && (
                  <ul className="mt-1 space-y-0.5 pl-4 text-[11px] text-sf-text-muted">
                    {pack.skipped.map((item) => <li key={item.path} className="truncate" title={item.path}>{item.path}: {tr(`skipReason.${item.reason}`)}</li>)}
                    {pack.skippedCount > pack.skipped.length && <li>{tr('moreSkipped', { count: pack.skippedCount - pack.skipped.length })}</li>}
                  </ul>
                )}
              </div>
            )}
          </>}

          {phase === 'done' && summary && (
            <div data-testid="pack-import-done" className="space-y-2">
              <p className="flex items-center gap-1.5 font-medium text-emerald-300/90"><Check className="h-4 w-4" />{tr('done.title')}</p>
              <ul className="space-y-1 leading-relaxed text-sf-text-secondary">
                {summary.workflows > 0 && <li>{tr('done.workflows', { count: summary.workflows, pack: pack.name })}</li>}
                {summary.assets > 0 && <li>{tr('done.media', { count: summary.assets, pack: pack.name })}</li>}
                {summary.luts > 0 && <li>{tr('done.luts', { count: summary.luts })}</li>}
                {summary.templates > 0 && <li>{tr('done.templates', { count: summary.templates })}</li>}
              </ul>
              {summary.failed.length > 0 && (
                <p className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-200">
                  {tr('done.failed', { list: shortList(summary.failed.map((item) => item.name), 5) })}
                </p>
              )}
            </div>
          )}

          {(status && phase === 'importing') && (
            <p role="status" aria-live="polite" className="flex items-center gap-1.5 text-sf-text-muted"><Loader2 className="h-3 w-3 animate-spin" />{status}</p>
          )}
          {error && (
            <p role="alert" data-testid="pack-import-error" className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 leading-relaxed text-amber-200">{error}</p>
          )}
        </div>

        <footer className="flex flex-shrink-0 flex-wrap justify-end gap-2 border-t border-sf-dark-700 px-4 py-3">
          {phase === 'done' ? <>
            {summary?.folder && (
              <button type="button" onClick={() => window.electronAPI?.showItemInFolder?.(summary.folder)}
                className="rounded border border-sf-dark-600 px-3 py-1.5 text-xs hover:bg-sf-dark-700">{tr('done.showFolder')}</button>
            )}
            {summary?.workflows > 0 && (
              <button type="button" onClick={openMyWorkflows} className="rounded border border-sf-dark-600 px-3 py-1.5 text-xs hover:bg-sf-dark-700">{tr('done.openWorkflows')}</button>
            )}
            <button type="button" onClick={onClose} className="rounded bg-sf-accent px-3 py-1.5 text-xs font-medium text-sf-dark-900 hover:brightness-110">{tr('close')}</button>
          </> : <>
            <button type="button" onClick={onClose} disabled={busy} className="rounded border border-sf-dark-600 px-3 py-1.5 text-xs hover:bg-sf-dark-700 disabled:opacity-40">{tr('cancel')}</button>
            {(phase === 'review' || phase === 'importing') && (
              <button type="button" data-testid="pack-import-run" onClick={runImport} disabled={busy || !counts.total}
                className="rounded bg-sf-accent px-3 py-1.5 text-xs font-medium text-sf-dark-900 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
                {phase === 'importing' ? tr('importing') : tr('importButton', { count: counts.total })}
              </button>
            )}
          </>}
        </footer>
      </section>
    </div>, document.body,
  )
}
