import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, BookOpen, ChevronRight, Compass, CornerDownLeft, FolderOpen, HelpCircle,
  Info, Lightbulb, LifeBuoy, Loader2, MessageSquare, Music, PlayCircle, Rocket, Scissors, Search, Sparkles,
  Stethoscope, Upload, X,
} from 'lucide-react'
import { HELP_ARTICLES, HELP_CATEGORIES, HELP_FEATURED_IDS } from '../../config/helpGuide'
import { buildHelpIndex, searchHelp, tokenizeHelpQuery } from '../../utils/helpSearch.mjs'
import useHelpStore from '../../stores/helpStore'
import { useI18n } from '../../i18n/I18nContext'
import HelpVisual from './HelpVisuals'
import useLocalizedHelp from './useLocalizedHelp'

// Tutorials and showcase videos (formerly the Discover tab) live here as "Watch".
const DiscoverWorkspace = lazy(() => import('../DiscoverWorkspace'))
export const HELP_WATCH_VIEW_ID = 'watch'

const CATEGORY_ICONS = { Rocket, FolderOpen, Sparkles, Music, Scissors, Upload, MessageSquare, BookOpen, LifeBuoy, Compass }
const CATEGORY_BY_ID = Object.fromEntries(HELP_CATEGORIES.map((category) => [category.id, category]))
const COUNT_BY_CATEGORY = HELP_ARTICLES.reduce((counts, article) => ({ ...counts, [article.category]: (counts[article.category] || 0) + 1 }), {})
const POPULAR_QUESTIONS = [
  ['where-files-are-saved', 'Is everything saved on my computer?'],
  ['assets-panel-folders', 'Are generated and downloaded files added automatically?'],
  ['local-vs-cloud', 'Why would I use cloud instead of my own PC?'],
  ['assistant-overview', 'Can the AI Assistant do the editing for me?'],
  ['where-models-go', 'Where do downloaded AI models go?'],
  ['dubbing', 'Can I dub my video into another language?'],
]

/** Renders **bold** and highlights search words inside plain text. */
function RichText({ text, highlight = [] }) {
  const parts = String(text ?? '').split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  const pattern = highlight.length
    ? new RegExp(`(${highlight.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
    : null
  const mark = (value, key) => {
    if (!pattern) return <Fragment key={key}>{value}</Fragment>
    return value.split(pattern).map((piece, index) => (
      index % 2 === 1
        ? <mark key={`${key}-${index}`} className="rounded-sm bg-sf-accent/25 px-0.5 text-sf-text-primary">{piece}</mark>
        : <Fragment key={`${key}-${index}`}>{piece}</Fragment>
    ))
  }
  return parts.map((part, index) => (
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={index} className="font-semibold text-sf-text-primary">{mark(part.slice(2, -2), index)}</strong>
      : mark(part, index)
  ))
}

function Callout({ type, text }) {
  const styles = {
    tip: { icon: Lightbulb, label: 'Tip', box: 'border-sf-accent/35 bg-sf-accent/[0.07]', iconColor: 'text-sf-accent' },
    note: { icon: Info, label: 'Good to know', box: 'border-sf-blue/35 bg-sf-blue/[0.07]', iconColor: 'text-sf-blue' },
    warn: { icon: AlertTriangle, label: 'Heads up', box: 'border-sf-warning/40 bg-sf-warning/[0.08]', iconColor: 'text-sf-warning' },
  }[type]
  const Icon = styles.icon
  return (
    <div className={`my-3 flex gap-2.5 rounded-xl border px-3.5 py-3 ${styles.box}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${styles.iconColor}`} aria-hidden="true" />
      <p className="text-[13px] leading-relaxed text-sf-text-secondary">
        <span className="mr-1 font-semibold text-sf-text-primary">{styles.label}:</span>
        <RichText text={text} />
      </p>
    </div>
  )
}

function ArticleBlock({ block, onAction, canRunAction, visualText = null }) {
  switch (block.type) {
    case 'p':
      return <p className="my-3 text-[13.5px] leading-relaxed text-sf-text-secondary"><RichText text={block.text} /></p>
    case 'steps':
      return (
        <ol className="my-3 space-y-2">
          {block.items.map((item, index) => (
            <li key={index} className="flex gap-3 rounded-xl border border-sf-dark-700 bg-sf-dark-800/50 px-3 py-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sf-accent font-mono text-[11px] font-bold text-sf-accent-on">{index + 1}</span>
              <span className="pt-0.5 text-[13px] leading-relaxed text-sf-text-secondary"><RichText text={item} /></span>
            </li>
          ))}
        </ol>
      )
    case 'list':
      return (
        <ul className="my-3 space-y-1.5">
          {block.items.map((item, index) => (
            <li key={index} className="flex gap-2.5 text-[13px] leading-relaxed text-sf-text-secondary">
              <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-sf-accent" aria-hidden="true" />
              <span><RichText text={item} /></span>
            </li>
          ))}
        </ul>
      )
    case 'tip':
    case 'note':
    case 'warn':
      return <Callout type={block.type} text={block.text} />
    case 'table':
      return (
        <div className="my-4 overflow-x-auto rounded-xl border border-sf-dark-700">
          <table className="w-full border-collapse text-left text-[12.5px]">
            <thead>
              <tr className="bg-sf-dark-800/80">
                {block.head.map((cell, index) => (
                  <th key={index} className="whitespace-nowrap px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-sf-text-muted">{cell}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-sf-dark-700/80 even:bg-sf-dark-900/40">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className={`px-3 py-2 align-top leading-relaxed ${cellIndex === 0 ? 'text-sf-text-primary' : 'text-sf-text-secondary'}`}>
                      <RichText text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'visual':
      return <HelpVisual id={block.id} text={visualText} />
    case 'action':
      if (!canRunAction(block.action)) return null
      return (
        <button
          type="button"
          onClick={() => onAction(block.action)}
          className="my-3 inline-flex items-center gap-1.5 rounded-lg bg-sf-accent px-3.5 py-2 text-[12.5px] font-semibold text-sf-accent-on shadow-[0_6px_20px_-8px_rgb(var(--sf-accent)/0.7)] transition-colors hover:bg-sf-accent-hover"
        >
          {block.label}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )
    default:
      return null
  }
}

function CategoryIcon({ category, className }) {
  const Icon = CATEGORY_ICONS[category?.icon] || HelpCircle
  return <Icon className={className} aria-hidden="true" />
}

function ArticleCard({ article, onOpen, snippet, highlight, categoryById = CATEGORY_BY_ID }) {
  const category = categoryById[article.category]
  return (
    <button
      type="button"
      onClick={() => onOpen(article.id)}
      className="group flex w-full items-start gap-3 rounded-xl border border-sf-dark-700 bg-sf-dark-800/40 px-3.5 py-3 text-left transition-all hover:-translate-y-px hover:border-sf-accent/40 hover:bg-sf-dark-800/80"
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sf-dark-700 text-sf-text-secondary transition-colors group-hover:bg-sf-accent group-hover:text-sf-accent-on">
        <CategoryIcon category={category} className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold text-sf-text-primary"><RichText text={article.title} highlight={highlight} /></span>
        <span className="mt-0.5 block text-[12px] leading-snug text-sf-text-muted"><RichText text={snippet || article.summary} highlight={highlight} /></span>
        {snippet && <span className="mt-1.5 inline-block rounded-full border border-sf-dark-600 px-2 py-px text-[10px] text-sf-text-muted">{category?.title}</span>}
      </span>
      <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-sf-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-sf-accent" aria-hidden="true" />
    </button>
  )
}

export default function HelpCenter({ actions = {} }) {
  const { t, language } = useI18n()
  const help = useLocalizedHelp(language)
  const open = useHelpStore((state) => state.open)
  const requestedArticleId = useHelpStore((state) => state.articleId)
  const closeHelp = useHelpStore((state) => state.closeHelp)
  const toggleHelp = useHelpStore((state) => state.toggleHelp)
  const index = useMemo(() => buildHelpIndex(help.articles), [help.articles])
  const [query, setQuery] = useState('')
  const [view, setView] = useState({ type: 'home' })
  const [history, setHistory] = useState([])
  const searchRef = useRef(null)
  const contentRef = useRef(null)

  const results = useMemo(() => (query.trim() ? searchHelp(index, query) : []), [index, query])
  const highlight = useMemo(() => tokenizeHelpQuery(query).filter((word) => word.length >= 3), [query])

  // History entries remember the search too, so Back from an article
  // returns to the results the user came from.
  const go = useCallback((next) => {
    setHistory((stack) => [...stack, { view, query }])
    setView(next)
    setQuery('')
    contentRef.current?.scrollTo?.({ top: 0 })
  }, [view, query])

  const openArticle = useCallback((articleId) => {
    if (!help.byId[articleId]) return
    go({ type: 'article', id: articleId })
  }, [go, help.byId])

  const goBack = useCallback(() => {
    const previous = history[history.length - 1]
    setHistory((stack) => stack.slice(0, -1))
    setView(previous?.view || { type: 'home' })
    setQuery(previous?.query || '')
    contentRef.current?.scrollTo?.({ top: 0 })
  }, [history])

  // Reset on every open; jump straight to a deep-linked article.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setHistory([])
    setView(requestedArticleId === HELP_WATCH_VIEW_ID
      ? { type: 'watch' }
      : requestedArticleId && help.byId[requestedArticleId] ? { type: 'article', id: requestedArticleId } : { type: 'home' })
    const timer = setTimeout(() => searchRef.current?.focus(), 30)
    return () => clearTimeout(timer)
    // help.byId only changes when the translated guide finishes loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requestedArticleId])

  // F1 opens/closes Help anywhere in the app.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'F1') return
      event.preventDefault()
      toggleHelp()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleHelp])

  // Inside the overlay: Esc clears the search, then goes back, then closes;
  // "/" focuses the search box. Other keys are left alone: editor shortcuts
  // already stand down while an aria-modal dialog is visible
  // (hasVisibleKeyboardModal in utils/transportKeyboardGuards.mjs).
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      const typing = event.target === searchRef.current
      // A video player or form opened from Watch closes itself first.
      if (document.querySelector('[data-discover-overlay="true"]')) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (query) setQuery('')
        else if (view.type !== 'home') goBack()
        else closeHelp()
        return
      }
      if (event.key === '/' && !typing) {
        event.preventDefault()
        event.stopPropagation()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, query, view.type, goBack, closeHelp])

  // "openSettings:<section>", "command:<palette command id>", "palette", or a
  // plain handler name. Buttons only show when this screen can run them.
  const canRunAction = useCallback((action) => {
    const [name, arg] = String(action).split(':')
    if (name === 'openSettings') return typeof actions.openSettings === 'function' && Boolean(arg)
    if (name === 'command') return typeof actions.runCommand === 'function' && Boolean(arg)
    if (name === 'palette') return typeof actions.openPalette === 'function'
    return typeof actions[name] === 'function'
  }, [actions])

  const runAction = useCallback((action) => {
    const [name, arg] = String(action).split(':')
    closeHelp()
    // Let the overlay unmount before the next modal or tour measures the page.
    setTimeout(() => {
      if (name === 'openSettings') actions.openSettings?.(arg)
      else if (name === 'command') actions.runCommand?.(arg)
      else actions[name]?.()
    }, 0)
  }, [actions, closeHelp])

  if (!open) return null

  const searching = query.trim().length > 0
  const activeCategoryId = view.type === 'category' ? view.id : view.type === 'article' ? help.byId[view.id]?.category : null
  const article = view.type === 'article' ? help.byId[view.id] : null
  const showLanguageNote = language && !String(language).toLowerCase().startsWith('en')
    && (!help.translated || (view.type === 'article' && article?.translated === false))

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => { if (event.target === event.currentTarget) closeHelp() }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('help.title', undefined, 'Help Center')}
        className="flex h-full max-h-[900px] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-sf-dark-600 bg-sf-dark-900 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.75)] ring-1 ring-black/40 select-text"
      >
        {/* Header with search */}
        <div className="relative flex flex-shrink-0 items-center gap-3 border-b border-sf-dark-700 bg-gradient-to-b from-sf-dark-800 to-sf-dark-900 px-4 py-3 sm:px-5">
          <div className="flex shrink-0 items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sf-accent text-sf-accent-on shadow-[0_6px_18px_-8px_rgb(var(--sf-accent)/0.8)]">
              <HelpCircle className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <span className="hidden font-display text-[15px] font-bold tracking-tight text-sf-text-primary sm:inline">{t('help.title', undefined, 'Help Center')}</span>
          </div>
          <label className="relative flex min-w-0 flex-1 items-center">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-sf-text-muted" aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && results[0]) openArticle(results[0].article.id)
              }}
              placeholder={t('help.searchPlaceholder', undefined, 'Search the guide, e.g. "where are my videos saved?"')}
              aria-label={t('help.searchLabel', undefined, 'Search help')}
              className="h-10 w-full rounded-xl border border-sf-dark-600 bg-sf-dark-950/80 pl-9 pr-24 text-[13.5px] text-sf-text-primary placeholder:text-sf-text-muted focus:border-sf-accent/60 focus:outline-none focus:ring-2 focus:ring-sf-accent/20"
            />
            <span className="pointer-events-none absolute right-3 hidden items-center gap-1 font-mono text-[10px] text-sf-text-muted sm:flex">
              {searching ? <><CornerDownLeft className="h-3 w-3" />{t('help.openTop', undefined, 'open top result')}</> : <kbd className="rounded border border-sf-dark-500 px-1.5 py-px">/</kbd>}
            </span>
          </label>
          <button
            type="button"
            onClick={closeHelp}
            title={`${t('common.close', undefined, 'Close')} (Esc)`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sf-text-muted transition-colors hover:bg-sf-dark-700 hover:text-sf-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Topics */}
          <nav className="hidden w-64 flex-shrink-0 overflow-y-auto border-r border-sf-dark-700 bg-sf-dark-950/40 p-2.5 md:block" aria-label={t('help.topics', undefined, 'Topics')}>
            <button
              type="button"
              onClick={() => { setQuery(''); setHistory([]); setView({ type: 'home' }) }}
              className={`mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors ${!searching && view.type === 'home' ? 'bg-sf-dark-700 font-semibold text-sf-text-primary' : 'text-sf-text-secondary hover:bg-sf-dark-800 hover:text-sf-text-primary'}`}
            >
              <HelpCircle className="h-4 w-4 text-sf-accent" aria-hidden="true" />
              {t('help.home', undefined, 'Help home')}
            </button>
            <button
              type="button"
              data-testid="help-watch-nav"
              onClick={() => go({ type: 'watch' })}
              className={`mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition-colors ${!searching && view.type === 'watch' ? 'bg-sf-dark-700 font-semibold text-sf-text-primary' : 'text-sf-text-secondary hover:bg-sf-dark-800 hover:text-sf-text-primary'}`}
            >
              <PlayCircle className="h-4 w-4 text-sf-accent" aria-hidden="true" />
              {t('help.watch', undefined, 'Watch')}
              <span className="ml-auto text-[10px] text-sf-text-muted">{t('help.watchHint', undefined, 'Videos')}</span>
            </button>
            <div className="mb-1 mt-3 px-2.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-sf-text-muted">{t('help.topics', undefined, 'Topics')}</div>
            {help.categories.map((category) => {
              const active = !searching && activeCategoryId === category.id
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => go({ type: 'category', id: category.id })}
                  className={`relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors ${active ? 'bg-sf-dark-700 font-medium text-sf-text-primary' : 'text-sf-text-secondary hover:bg-sf-dark-800 hover:text-sf-text-primary'}`}
                >
                  {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-sf-accent" aria-hidden="true" />}
                  <CategoryIcon category={category} className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-sf-accent' : 'text-sf-text-muted'}`} />
                  <span className="min-w-0 flex-1 truncate">{category.title}</span>
                  <span className="font-mono text-[10px] text-sf-text-muted">{COUNT_BY_CATEGORY[category.id] || 0}</span>
                </button>
              )
            })}
          </nav>

          {/* Content */}
          {!searching && view.type === 'watch' ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="help-watch">
              <Suspense fallback={<div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-sf-accent" /></div>}>
                <DiscoverWorkspace embedded />
              </Suspense>
            </div>
          ) : (
          <div ref={contentRef} className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8">
              {showLanguageNote && (
                <div className="mb-4 rounded-lg border border-sf-dark-600 bg-sf-dark-800/60 px-3 py-2 text-[11.5px] text-sf-text-muted">
                  {t('help.englishOnly', undefined, 'This guide is in English for now.')}
                </div>
              )}

              {searching ? (
                <section aria-live="polite">
                  <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-sf-text-muted">
                    {t('help.resultsCount', { count: results.length }, `${results.length} results`)}
                  </div>
                  {results.length > 0 ? (
                    <div className="space-y-2">
                      {results.map((result) => (
                        <ArticleCard categoryById={help.categoryById} key={result.article.id} article={result.article} snippet={result.snippet} highlight={highlight} onOpen={openArticle} />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-sf-dark-600 px-6 py-10 text-center">
                      <Search className="mx-auto h-6 w-6 text-sf-text-muted" aria-hidden="true" />
                      <p className="mt-3 text-[14px] font-semibold text-sf-text-primary">{t('help.noResults', { query: query.trim() }, `No answers for "${query.trim()}"`)}</p>
                      <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-sf-text-muted">{t('help.noResultsHint', undefined, 'Try fewer or simpler words, or ask the AI Assistant: it can answer questions about your project too.')}</p>
                    </div>
                  )}
                </section>
              ) : article ? (
                <article>
                  <div className="mb-4 flex items-center gap-2 text-[11.5px] text-sf-text-muted">
                    <button type="button" onClick={goBack} className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-sf-dark-800 hover:text-sf-text-primary">
                      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />{t('help.back', undefined, 'Back')}
                    </button>
                    <span aria-hidden="true">·</span>
                    <button type="button" onClick={() => go({ type: 'category', id: article.category })} className="hover:text-sf-text-primary">
                      {help.categoryById[article.category]?.title}
                    </button>
                  </div>
                  <h1 className="font-display text-[26px] font-bold leading-tight tracking-tight text-sf-text-primary">{article.title}</h1>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-sf-text-secondary">{article.summary}</p>
                  <div className="mt-5 h-px bg-gradient-to-r from-sf-accent/50 via-sf-dark-600 to-transparent" aria-hidden="true" />
                  <div className="mt-2">
                    {article.body.map((block, blockIndex) => (
                      <ArticleBlock key={blockIndex} block={block} onAction={runAction} canRunAction={canRunAction} visualText={help.pack?.visuals || null} />
                    ))}
                  </div>
                  {article.related?.length > 0 && (
                    <div className="mt-8 border-t border-sf-dark-700 pt-5">
                      <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-sf-text-muted">{t('help.related', undefined, 'Related')}</div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {article.related.map((id) => help.byId[id]).filter(Boolean).map((related) => (
                          <ArticleCard categoryById={help.categoryById} key={related.id} article={related} onOpen={openArticle} />
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              ) : view.type === 'category' ? (
                <section>
                  <button type="button" onClick={goBack} className="mb-4 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] text-sf-text-muted transition-colors hover:bg-sf-dark-800 hover:text-sf-text-primary">
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />{t('help.back', undefined, 'Back')}
                  </button>
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sf-accent text-sf-accent-on">
                      <CategoryIcon category={help.categoryById[view.id]} className="h-5 w-5" />
                    </span>
                    <div>
                      <h1 className="font-display text-[22px] font-bold tracking-tight text-sf-text-primary">{help.categoryById[view.id]?.title}</h1>
                      <p className="text-[13px] text-sf-text-muted">{help.categoryById[view.id]?.blurb}</p>
                    </div>
                  </div>
                  <div className="mt-5 space-y-2">
                    {help.articles.filter((item) => item.category === view.id).map((item) => (
                      <ArticleCard categoryById={help.categoryById} key={item.id} article={item} onOpen={openArticle} />
                    ))}
                  </div>
                </section>
              ) : (
                <section>
                  <div className="relative overflow-hidden rounded-2xl border border-sf-dark-600 bg-gradient-to-br from-sf-dark-800 via-sf-dark-900 to-sf-dark-950 px-6 py-7">
                    <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-sf-accent/10 blur-3xl" aria-hidden="true" />
                    <div className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-sf-accent">{t('help.eyebrow', undefined, 'Drama Studio guide')}</div>
                    <h1 className="mt-2 font-display text-[28px] font-bold leading-tight tracking-tight text-sf-text-primary">{t('help.heading', undefined, 'How can we help?')}</h1>
                    <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-sf-text-secondary">{t('help.subheading', undefined, 'Plain-language answers about making AI video, editing, sound, saving and exporting. Search above, or pick a topic.')}</p>
                    <div className="relative mt-4 flex flex-wrap gap-2" data-testid="help-quick-start">
                      {canRunAction('openGettingStarted') && (
                        <button type="button" onClick={() => runAction('openGettingStarted')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-sf-dark-500 bg-sf-dark-800/80 px-3 py-1.5 text-[12px] font-medium text-sf-text-primary transition-colors hover:border-sf-accent/50 hover:bg-sf-dark-700">
                          <Stethoscope className="h-3.5 w-3.5 text-sf-accent" aria-hidden="true" />{t('help.checkSetup', undefined, 'Check my setup')}
                        </button>
                      )}
                      {canRunAction('startTour') && (
                        <button type="button" onClick={() => runAction('startTour')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-sf-dark-500 bg-sf-dark-800/80 px-3 py-1.5 text-[12px] font-medium text-sf-text-primary transition-colors hover:border-sf-accent/50 hover:bg-sf-dark-700">
                          <Compass className="h-3.5 w-3.5 text-sf-accent" aria-hidden="true" />{t('help.takeTour', undefined, 'Take the guided tour')}
                        </button>
                      )}
                      <button type="button" onClick={() => go({ type: 'watch' })}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-sf-dark-500 bg-sf-dark-800/80 px-3 py-1.5 text-[12px] font-medium text-sf-text-primary transition-colors hover:border-sf-accent/50 hover:bg-sf-dark-700">
                        <PlayCircle className="h-3.5 w-3.5 text-sf-accent" aria-hidden="true" />{t('help.watchTutorials', undefined, 'Watch tutorials')}
                      </button>
                    </div>
                  </div>

                  <h2 className="mb-2 mt-7 font-mono text-[10.5px] uppercase tracking-[0.14em] text-sf-text-muted">{t('help.popular', undefined, 'Common questions')}</h2>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {help.localizePopular(POPULAR_QUESTIONS).map(([id, question]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => openArticle(id)}
                        className="group flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-sf-text-secondary transition-colors hover:bg-sf-dark-800 hover:text-sf-text-primary"
                      >
                        <HelpCircle className="h-3.5 w-3.5 shrink-0 text-sf-accent" aria-hidden="true" />
                        <span className="min-w-0 flex-1">{question}</span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-sf-text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                      </button>
                    ))}
                  </div>

                  <h2 className="mb-2 mt-7 font-mono text-[10.5px] uppercase tracking-[0.14em] text-sf-text-muted">{t('help.startHere', undefined, 'Start here')}</h2>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {HELP_FEATURED_IDS.map((id) => help.byId[id]).map((item) => (
                      <ArticleCard categoryById={help.categoryById} key={item.id} article={item} onOpen={openArticle} />
                    ))}
                  </div>

                  <h2 className="mb-2 mt-7 font-mono text-[10.5px] uppercase tracking-[0.14em] text-sf-text-muted">{t('help.browse', undefined, 'Browse by topic')}</h2>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {help.categories.map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => go({ type: 'category', id: category.id })}
                        className="group rounded-xl border border-sf-dark-700 bg-sf-dark-800/40 p-3.5 text-left transition-all hover:-translate-y-px hover:border-sf-accent/40 hover:bg-sf-dark-800/80"
                      >
                        <div className="flex items-center gap-2">
                          <CategoryIcon category={category} className="h-4 w-4 text-sf-accent" />
                          <span className="text-[13px] font-semibold text-sf-text-primary">{category.title}</span>
                        </div>
                        <p className="mt-1.5 text-[11.5px] leading-snug text-sf-text-muted">{category.blurb}</p>
                        <p className="mt-2 font-mono text-[10px] text-sf-text-muted">{t('help.articleCount', { count: COUNT_BY_CATEGORY[category.id] || 0 }, `${COUNT_BY_CATEGORY[category.id] || 0} articles`)}</p>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  )
}
