import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, ChevronRight, Command as CommandGlyph, CornerDownLeft, Search } from 'lucide-react'
import useCommandStore, { collectCommands, commandAvailability } from '../stores/commandStore'
import useHelpStore from '../stores/helpStore'
import { commandAppliesToClip, getCommandContext } from '../services/commandContext'
import { pushRecentCommand, rankCommands } from '../utils/commandSearch.mjs'
import { buildHelpIndex, searchHelp } from '../utils/helpSearch.mjs'
import useLocalizedHelp from './help/useLocalizedHelp'
import { useI18n } from '../i18n/I18nContext'

const RECENT_KEY = 'drama-studio-recent-commands'
const GROUP_ORDER = ['Selected clip', 'Captions', 'AI', 'Audio', 'Edit', 'Go to', 'Panels', 'Help', 'Settings']

function readRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter((id) => typeof id === 'string') } catch { return [] }
}
function writeRecent(list) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)) } catch { /* storage unavailable */ }
}

function CommandIcon({ icon: Icon = CommandGlyph, className }) {
  return <Icon className={className} aria-hidden="true" />
}

/**
 * Ctrl+Shift+P (or the search button in the title bar): one searchable list of
 * every action, including the ones that normally live in right-click menus.
 * Unavailable commands stay listed with the reason, so users learn what to
 * select first. Matching Help articles appear under the commands.
 */
export default function CommandPalette() {
  const { t, language } = useI18n()
  const help = useLocalizedHelp(language)
  const open = useCommandStore((state) => state.open)
  const closePalette = useCommandStore((state) => state.closePalette)
  const togglePalette = useCommandStore((state) => state.togglePalette)
  const openHelp = useHelpStore((state) => state.openHelp)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [snapshot, setSnapshot] = useState({ commands: [], context: {} })
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const helpIndex = useMemo(() => buildHelpIndex(help.articles), [help.articles])

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && String(event.key).toLowerCase() === 'p') {
        event.preventDefault()
        event.stopPropagation()
        togglePalette()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [togglePalette])

  useEffect(() => {
    if (!open) return undefined
    const context = getCommandContext()
    setSnapshot({ commands: collectCommands(context), context })
    setQuery('')
    setActiveIndex(0)
    const timer = setTimeout(() => inputRef.current?.focus(), 20)
    return () => clearTimeout(timer)
  }, [open])

  const items = useMemo(() => {
    const { commands, context } = snapshot
    const decorate = (command, section) => ({ kind: 'command', command, section, availability: commandAvailability(command, context) })
    if (!query.trim()) {
      const recentIds = readRecent()
      const byId = new Map(commands.map((command) => [command.id, command]))
      const recent = recentIds.map((id) => byId.get(id)).filter(Boolean)
      const forClip = commands.filter((command) => commandAppliesToClip(command, context) && !recentIds.includes(command.id))
      const shown = new Set([...recent, ...forClip].map((command) => command.id))
      const rest = commands.filter((command) => !shown.has(command.id))
      rest.sort((a, b) => (GROUP_ORDER.indexOf(a.group) + 1 || 99) - (GROUP_ORDER.indexOf(b.group) + 1 || 99))
      return [
        ...recent.map((command) => decorate(command, t('commandPalette.recent', undefined, 'Recent'))),
        ...forClip.map((command) => decorate(command, t('commandPalette.forSelection', undefined, 'For the selected clip'))),
        ...rest.map((command) => decorate(command, command.group || 'Other')),
      ]
    }
    const ranked = rankCommands(commands, query).map((command) => decorate(command, t('commandPalette.actions', undefined, 'Actions')))
    const articles = searchHelp(helpIndex, query, { limit: 3 }).map((result) => ({
      kind: 'article', article: result.article, snippet: result.snippet, section: t('commandPalette.helpArticles', undefined, 'Help articles'),
    }))
    return [...ranked, ...articles]
  }, [snapshot, query, helpIndex, t])

  useEffect(() => { setActiveIndex(0) }, [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (!open) return null

  const runItem = (item) => {
    if (!item) return
    if (item.kind === 'article') {
      closePalette()
      openHelp(item.article.id)
      return
    }
    if (item.availability !== true) return
    writeRecent(pushRecentCommand(readRecent(), item.command.id))
    closePalette()
    // Let the palette unmount before the action opens its own dialog.
    setTimeout(() => item.command.run(snapshot.context), 0)
  }

  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePalette(); return }
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(items.length - 1, index + 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)) }
    if (event.key === 'Enter') { event.preventDefault(); runItem(items[activeIndex]) }
  }

  let lastSection = null
  return (
    <div className="fixed inset-0 z-[95] flex items-start justify-center bg-black/55 px-3 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(event) => { if (event.target === event.currentTarget) closePalette() }} role="presentation">
      <div role="dialog" aria-modal="true" aria-label={t('commandPalette.title', undefined, 'Search actions')} data-testid="command-palette"
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-sf-dark-600 bg-sf-dark-900 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.75)] select-text" onKeyDown={onKeyDown}>
        <label className="flex items-center gap-2.5 border-b border-sf-dark-700 px-4">
          <Search className="h-4 w-4 shrink-0 text-sf-text-muted" aria-hidden="true" />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder={t('commandPalette.placeholder', undefined, 'Search actions, e.g. "translate", "srt", "lip sync"…')}
            aria-label={t('commandPalette.title', undefined, 'Search actions')} data-testid="command-palette-input"
            className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-sf-text-primary placeholder:text-sf-text-muted focus:outline-none focus-visible:shadow-none" />
          <kbd>Esc</kbd>
        </label>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1.5" role="listbox">
          {items.length === 0 && (
            <p className="px-4 py-8 text-center text-[13px] text-sf-text-muted">{t('commandPalette.noResults', undefined, 'Nothing matches. Try another word, or press F1 for the Help Center.')}</p>
          )}
          {items.map((item, index) => {
            const header = item.section !== lastSection ? item.section : null
            lastSection = item.section
            const active = index === activeIndex
            const disabled = item.kind === 'command' && item.availability !== true
            return (
              <div key={item.kind === 'article' ? `help-${item.article.id}` : item.command.id}>
                {header && <div className="px-4 pb-1 pt-2.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-sf-text-muted">{header}</div>}
                <button type="button" data-index={index} role="option" aria-selected={active} aria-disabled={disabled || undefined}
                  data-command-id={item.kind === 'command' ? item.command.id : undefined}
                  onMouseMove={() => setActiveIndex(index)} onClick={() => runItem(item)}
                  className={`mx-1.5 flex w-[calc(100%-12px)] items-center gap-3 rounded-lg px-2.5 py-2 text-left ${active ? 'bg-sf-dark-700' : ''} ${disabled ? 'cursor-default' : ''}`}>
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${active && !disabled ? 'bg-sf-accent text-sf-accent-on' : 'bg-sf-dark-800 text-sf-text-secondary'}`}>
                    {item.kind === 'article' ? <BookOpen className="h-3.5 w-3.5" aria-hidden="true" /> : <CommandIcon icon={item.command.icon} className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[13px] ${disabled ? 'text-sf-text-muted' : 'text-sf-text-primary'}`}>
                      {item.kind === 'article' ? item.article.title : item.command.title}
                    </span>
                    <span className="block truncate text-[11px] text-sf-text-muted">
                      {item.kind === 'article' ? item.snippet : (disabled ? item.availability : item.command.where || '')}
                    </span>
                  </span>
                  {item.kind === 'command' && item.command.shortcut && <kbd>{item.command.shortcut}</kbd>}
                  {active && !disabled && (item.kind === 'article' ? <ChevronRight className="h-3.5 w-3.5 text-sf-text-muted" /> : <CornerDownLeft className="h-3.5 w-3.5 text-sf-text-muted" />)}
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-3 border-t border-sf-dark-700 px-4 py-2 text-[10.5px] text-sf-text-muted">
          <span><kbd>↑</kbd> <kbd>↓</kbd> {t('commandPalette.move', undefined, 'move')}</span>
          <span><kbd>Enter</kbd> {t('commandPalette.run', undefined, 'run')}</span>
          <span className="ml-auto"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> {t('commandPalette.anywhere', undefined, 'opens this anywhere')}</span>
        </div>
      </div>
    </div>
  )
}
