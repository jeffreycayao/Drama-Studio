import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Film, ListOrdered, Loader2, Package, X } from 'lucide-react'
import { useI18n } from '../../i18n/I18nContext'
import { isPackTemplatesAvailable, listImportedPackTemplates, readImportedPackTemplate } from '../../services/packTemplates'
import { requestPackImport } from '../../services/packImport'
import { interpretPackTemplate } from '../../utils/packShotList.mjs'
import { parseScreenplay, summarizeScreenplay, toFountain } from '../../utils/screenplayParser.mjs'

const KIND_ICONS = { shots: ListOrdered, script: Film, text: FileText, json: FileText }
const PREVIEW_CHARS = 4000
const PREVIEW_SHOTS = 8

/** A .fountain file → clean Fountain (as Import script does); other text as it is. */
function scriptTextFor(name, text) {
  const parsed = parseScreenplay(text, name)
  const summary = summarizeScreenplay(parsed)
  if (!summary.scenes && !summary.dialogueLines) return { text, summary: null }
  return { text: toFountain(parsed, { includeTitlePage: false }), summary }
}

/**
 * Short Film › Script › "From an imported pack…". Lists the prompt templates
 * and shot lists Import pack kept, previews the chosen one, and only then
 * hands it to Short Film: a shot list becomes the Shot Plan, a script or a
 * text template the Screenplay (or, for text, the Premise).
 */
export default function PackTemplatePicker({ locations = [], characters = [], screenplay = '', premise = '', shotCount = 0, onApply, onClose }) {
  const { t } = useI18n()
  const tr = (key, vars) => t(`generate.shortFilmPackTemplates.${key}`, vars)
  const [packs, setPacks] = useState(null)
  const [selected, setSelected] = useState(null) // { pack, template }
  const [preview, setPreview] = useState(null) // { loading } | { error } | { result, raw }
  const dialogRef = useRef(null)
  const readToken = useRef(0)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    let alive = true
    listImportedPackTemplates()
      .then((list) => { if (alive) setPacks(list) })
      .catch(() => { if (alive) setPacks([]) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    dialogRef.current?.focus()
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); closeRef.current() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const choose = async (pack, template) => {
    const token = ++readToken.current
    setSelected({ pack, template })
    setPreview({ loading: true })
    const read = await readImportedPackTemplate(pack, template)
    if (token !== readToken.current) return
    if (!read.ok) { setPreview({ error: tr(`errors.${read.code === 'TOO_LARGE' ? 'tooLarge' : 'missing'}`) }); return }
    const result = interpretPackTemplate(template.name, read.text, { locations, characters, sceneLabel: pack.name })
    if (result.kind === 'unsupported') { setPreview({ error: tr(`errors.${result.reason === 'no-shots' ? 'noShots' : result.reason === 'empty' ? 'empty' : 'format'}`) }); return }
    if (result.kind === 'script') setPreview({ result: { ...result, ...scriptTextFor(template.name, result.text) } })
    else setPreview({ result })
  }

  const apply = (target) => {
    const result = preview?.result
    if (!result || !selected) return
    const source = { pack: selected.pack.name, title: selected.template.title }
    if (target === 'shots') onApply({ target, shots: result.shots, ...source })
    else onApply({ target, text: result.text, ...source })
  }

  const totalTemplates = useMemo(() => (packs || []).reduce((sum, pack) => sum + pack.templates.length, 0), [packs])
  const result = preview?.result
  const hasScript = Boolean(String(screenplay).trim())
  const hasPremise = Boolean(String(premise).trim())
  const fallbackLocation = locations[0]?.name || ''

  const renderPreview = () => {
    if (!selected) return <p className="text-sf-text-muted">{tr('chooseHint')}</p>
    if (preview?.loading) return <p role="status" className="flex items-center gap-2 text-sf-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />{tr('reading')}</p>
    if (preview?.error) return <p role="alert" className="text-sf-error">{preview.error}</p>
    if (!result) return null
    if (result.kind === 'shots') {
      return (
        <div className="space-y-3">
          <p className="font-medium text-sf-text-primary">{tr('shotsFound', { count: result.shots.length })}</p>
          <ol className="space-y-1.5">
            {result.shots.slice(0, PREVIEW_SHOTS).map((shot, index) => (
              <li key={shot.id} className="rounded border border-sf-dark-700 bg-sf-dark-950 px-2.5 py-1.5">
                <div className="flex justify-between gap-2 text-[11px]">
                  <span className="truncate font-medium text-sf-text-primary">{index + 1}. {shot.title}</span>
                  <span className="flex-shrink-0 text-sf-text-muted">{tr('seconds', { count: shot.duration })}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] text-sf-text-secondary">{shot.keyframe}</p>
              </li>
            ))}
          </ol>
          {result.shots.length > PREVIEW_SHOTS && <p className="text-sf-text-muted">{tr('moreShots', { count: result.shots.length - PREVIEW_SHOTS })}</p>}
          <ul className="space-y-1 text-[11px] text-sf-text-muted">
            {result.truncated && <li>{tr('notes.truncated', { count: result.shots.length })}</li>}
            {result.skippedRows > 0 && <li>{tr('notes.skipped', { count: result.skippedRows })}</li>}
            {result.ignoredColumns.length > 0 && <li>{tr('notes.ignoredColumns', { columns: result.ignoredColumns.join(', ') })}</li>}
            {result.unmatchedLocations.length > 0 && fallbackLocation && <li>{tr('notes.unknownLocations', { names: result.unmatchedLocations.slice(0, 5).join(', '), location: fallbackLocation })}</li>}
            {result.unmatchedCharacters.length > 0 && <li>{tr('notes.unknownCharacters', { names: result.unmatchedCharacters.slice(0, 5).join(', ') })}</li>}
          </ul>
          {shotCount > 0 && <p className="rounded border border-sf-warning/40 bg-sf-warning/10 px-2.5 py-1.5 text-sf-text-primary">{tr('replaceShotsWarning', { count: shotCount })}</p>}
          <button type="button" data-testid="pack-template-use-shots" onClick={() => apply('shots')}
            className="rounded bg-sf-accent px-3 py-1.5 font-semibold text-sf-accent-on hover:brightness-110">
            {shotCount > 0 ? tr('replaceShots') : tr('useShots')}
          </button>
        </div>
      )
    }
    return (
      <div className="space-y-3">
        {result.summary && <p className="font-medium text-sf-text-primary">{tr('scriptFound', { scenes: result.summary.scenes, lines: result.summary.dialogueLines })}</p>}
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-sf-dark-700 bg-sf-dark-950 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-sf-text-secondary">
          {result.text.slice(0, PREVIEW_CHARS)}{result.text.length > PREVIEW_CHARS ? '…' : ''}
        </pre>
        {hasScript && <p className="text-[11px] text-sf-text-muted">{tr('replaceScriptWarning')}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="pack-template-use-script" onClick={() => apply('screenplay')}
            className="rounded bg-sf-accent px-3 py-1.5 font-semibold text-sf-accent-on hover:brightness-110">
            {hasScript ? tr('replaceScript') : tr('useScript')}
          </button>
          {result.kind === 'text' && (
            <button type="button" data-testid="pack-template-use-premise" onClick={() => apply('premise')}
              className="rounded border border-sf-dark-600 bg-sf-dark-800 px-3 py-1.5 font-semibold text-sf-text-primary hover:bg-sf-dark-700">
              {hasPremise ? tr('replacePremise') : tr('usePremise')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3 sm:p-4"
      onMouseDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose() }}
      onClick={(event) => event.stopPropagation()}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="pack-template-title" data-testid="pack-template-picker" tabIndex={-1}
        className="flex max-h-[85vh] w-full min-w-0 max-w-3xl flex-col overflow-hidden rounded-lg border border-sf-dark-600 bg-sf-dark-800 text-sf-text-primary shadow-2xl">
        <header className="flex flex-shrink-0 items-start gap-3 border-b border-sf-dark-700 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="pack-template-title" className="flex items-center gap-1.5 text-sm font-medium">
              <Package className="h-4 w-4 text-sf-accent" />{tr('title')}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-sf-text-muted">{tr('intro')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={tr('close')} className="rounded p-1 text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary"><X className="h-4 w-4" /></button>
        </header>

        {packs === null ? (
          <p role="status" className="flex items-center gap-2 px-4 py-6 text-xs text-sf-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />{tr('loading')}</p>
        ) : totalTemplates === 0 ? (
          <div className="space-y-3 px-4 py-6 text-xs">
            <p className="leading-relaxed text-sf-text-secondary">{isPackTemplatesAvailable() ? tr('empty') : tr('errors.desktopOnly')}</p>
            {isPackTemplatesAvailable() && (
              <button type="button" onClick={() => { onClose(); requestPackImport() }}
                className="rounded border border-sf-dark-600 bg-sf-dark-900 px-3 py-1.5 font-medium text-sf-text-primary hover:bg-sf-dark-700">
                {tr('importPack')}
              </button>
            )}
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 gap-0 text-xs sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="min-h-0 overflow-y-auto border-b border-sf-dark-700 p-3 sm:border-b-0 sm:border-r">
              {packs.map((pack) => (
                <div key={pack.slug} className="mb-3 last:mb-0">
                  <div className="px-1 text-[10px] uppercase tracking-wide text-sf-text-muted">
                    {pack.name}{pack.author ? ` · ${pack.author}` : ''}
                  </div>
                  <ul className="mt-1 space-y-1">
                    {pack.templates.map((template) => {
                      const Icon = KIND_ICONS[template.kind] || FileText
                      const active = selected?.pack.slug === pack.slug && selected?.template.rel === template.rel
                      return (
                        <li key={template.rel}>
                          <button type="button" data-testid="pack-template-item" onClick={() => choose(pack, template)} aria-pressed={active}
                            className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left ${active ? 'border-sf-accent bg-sf-accent/10' : 'border-transparent hover:border-sf-dark-600 hover:bg-sf-dark-700'}`}>
                            <Icon className="h-3.5 w-3.5 flex-shrink-0 text-sf-text-muted" />
                            <span className="min-w-0 flex-1 truncate text-sf-text-primary" title={template.rel}>{template.title}</span>
                            <span className="flex-shrink-0 text-[10px] text-sf-text-muted">{tr(`kinds.${template.kind}`)}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
            <div className="min-h-0 overflow-y-auto p-4">{renderPreview()}</div>
          </div>
        )}
      </section>
    </div>,
    document.body,
  )
}
