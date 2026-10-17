import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookMarked, Check, ClipboardCopy, CopyPlus, Pencil, Plus, Search, Star, Trash2, X } from 'lucide-react'
import usePromptLibraryStore from '../../stores/promptLibraryStore'
import useProjectStore from '../../stores/projectStore'
import { normalizeCastData } from '../../types/cast.js'
import { useI18n } from '../../i18n/I18nContext'
import OpenInMenu from './OpenInMenu'
import {
  MAX_PROMPT_TEXT,
  MAX_PROMPT_TITLE,
  PROMPT_CATEGORIES,
  extractBlanks,
  fillBlanks,
  searchPrompts,
  suggestionsForBlank,
} from '../../utils/promptLibrary.mjs'

const fieldClass = 'w-full rounded border border-sf-dark-600 bg-sf-dark-900 px-2 py-1.5 text-xs text-sf-text-primary placeholder:text-sf-text-muted focus:border-sf-accent focus:outline-none'
const quietButton = 'inline-flex items-center gap-1 rounded border border-sf-dark-600 px-2 py-1 text-[11px] text-sf-text-secondary hover:border-sf-dark-500 hover:bg-sf-dark-700 hover:text-sf-text-primary disabled:opacity-40'
const primaryButton = 'inline-flex items-center gap-1 rounded bg-sf-accent px-2.5 py-1 text-[11px] font-medium text-sf-dark-900 hover:brightness-110 disabled:opacity-40'

const SOURCE_VIEWS = ['all', 'favorites', 'recent', 'mine', 'pack', 'starter']

function emptyDraft(category = 'shot', text = '') {
  return { id: null, title: '', text, category, tags: '' }
}

/**
 * Prompt library (top bar menu, the command palette, the Assistant, and the
 * book buttons next to prompt fields). Browse starter prompts, prompts from
 * imported packs and your own; fill the {blanks}; then put the result in the
 * field that opened the library, or copy it.
 */
export default function PromptLibraryDialog() {
  const { t } = useI18n()
  const tr = (key, vars) => t(`promptLibrary.${key}`, vars)
  const request = usePromptLibraryStore((state) => state.request)
  const closeLibrary = usePromptLibraryStore((state) => state.closeLibrary)
  const mine = usePromptLibraryStore((state) => state.mine)
  const packPrompts = usePromptLibraryStore((state) => state.packPrompts)
  const starter = usePromptLibraryStore((state) => state.starter)
  const favorites = usePromptLibraryStore((state) => state.favorites)
  const used = usePromptLibraryStore((state) => state.used)
  const loaded = usePromptLibraryStore((state) => state.loaded)
  const storeError = usePromptLibraryStore((state) => state.error)
  const { savePrompt, deletePrompt, toggleFavorite, markUsed } = usePromptLibraryStore.getState()
  const rawCast = useProjectStore((state) => state.currentProject?.cast)
  const castNames = useMemo(() => normalizeCastData(rawCast).members.map((member) => member.name), [rawCast])

  const [view, setView] = useState(() => (request?.category && PROMPT_CATEGORIES.some((item) => item.id === request.category) ? request.category : 'all'))
  const [query, setQuery] = useState(request?.query || '')
  const [selectedId, setSelectedId] = useState(null)
  const [editing, setEditing] = useState(() => (request?.draftText || request?.newPrompt ? emptyDraft(request.draftCategory || request.category || 'shot', request.draftText || '') : null))
  const [values, setValues] = useState({})
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const searchRef = useRef(null)
  const titleRef = useRef(null)

  const all = useMemo(() => [...mine, ...packPrompts, ...starter], [mine, packPrompts, starter])
  const results = useMemo(() => searchPrompts(all, { query, view, favorites, used }), [all, query, view, favorites, used])
  const selected = useMemo(() => results.find((item) => item.id === selectedId) || results[0] || null, [results, selectedId])
  const blanks = useMemo(() => extractBlanks(selected?.text), [selected?.text])
  const filled = useMemo(() => fillBlanks(selected?.text || '', values), [selected?.text, values])

  useEffect(() => { setValues({}); setConfirmDelete(false) }, [selected?.id])
  useEffect(() => { if (!notice) return undefined; const timer = setTimeout(() => setNotice(''), Math.max(2200, notice.length * 60)); return () => clearTimeout(timer) }, [notice])
  useEffect(() => {
    const focusTarget = editing ? titleRef.current : searchRef.current
    focusTarget?.focus()
  }, [editing ? 'edit' : 'browse']) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (editing) setEditing(null)
      else closeLibrary()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [editing, closeLibrary])

  const countFor = (id) => searchPrompts(all, { view: id, favorites, used }).length
  const viewLabel = (id) => (SOURCE_VIEWS.includes(id) ? tr(`views.${id}`) : tr(`categories.${id}`))

  const applyPrompt = (mode) => {
    if (!selected || !request?.onUse) return
    request.onUse(filled.text, mode)
    markUsed(selected.id)
    closeLibrary()
  }

  const copyPrompt = async () => {
    if (!selected) return
    try {
      await navigator.clipboard.writeText(filled.text)
      markUsed(selected.id)
      setNotice(tr('copied'))
    } catch {
      setError(tr('errors.copy'))
    }
  }

  const startEdit = (prompt, asCopy = false) => {
    setError('')
    setEditing(prompt
      ? { id: asCopy ? null : prompt.id, title: asCopy ? tr('copyTitle', { title: prompt.title }) : prompt.title, text: prompt.text, category: prompt.category, tags: (prompt.tags || []).join(', ') }
      : emptyDraft(PROMPT_CATEGORIES.some((item) => item.id === view) ? view : 'shot'))
  }

  const saveDraft = async () => {
    if (!editing?.text.trim()) { setError(tr('errors.noText')); return }
    try {
      const saved = await savePrompt(editing)
      setEditing(null)
      setQuery('')
      setView('mine')
      setSelectedId(saved.id)
      setNotice(tr('saved'))
    } catch (err) {
      setError(err?.message || tr('errors.save'))
    }
  }

  const removeSelected = async () => {
    if (selected?.source !== 'mine') return
    await deletePrompt(selected.id)
    setSelectedId(null)
    setConfirmDelete(false)
    setNotice(tr('deleted'))
  }

  const sourceLabel = (prompt) => (prompt.source === 'pack' ? tr('source.pack', { name: prompt.packName }) : tr(`source.${prompt.source}`))

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3 sm:p-4"
      onMouseDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) closeLibrary() }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}>
      <section role="dialog" aria-modal="true" aria-labelledby="prompt-library-title" data-testid="prompt-library-dialog"
        className="flex h-[85vh] max-h-[760px] w-full min-w-0 max-w-5xl flex-col overflow-hidden rounded-lg border border-sf-dark-600 bg-sf-dark-800 text-sf-text-primary shadow-2xl">
        <header className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-sf-dark-700 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="prompt-library-title" className="flex items-center gap-1.5 text-sm font-medium">
              <BookMarked className="h-4 w-4 text-sf-accent" />
              {request?.fieldLabel ? tr('titleFor', { field: request.fieldLabel }) : tr('title')}
            </h2>
            <p className="mt-0.5 text-[11px] text-sf-text-muted">{tr('intro')}</p>
          </div>
          {!editing && (
            <label className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sf-text-muted" />
              <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr('search')}
                aria-label={tr('search')} data-testid="prompt-library-search" className={`${fieldClass} pl-7`} />
            </label>
          )}
          {!editing && (
            <button type="button" className={primaryButton} onClick={() => startEdit(null)} data-testid="prompt-library-new"><Plus className="h-3.5 w-3.5" />{tr('newPrompt')}</button>
          )}
          <button type="button" onClick={closeLibrary} aria-label={tr('close')} className="rounded p-1 text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary"><X className="h-4 w-4" /></button>
        </header>

        {editing ? (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-xs" data-testid="prompt-library-editor">
            <h3 className="text-xs font-medium text-sf-text-secondary">{editing.id ? tr('editTitle') : tr('newTitle')}</h3>
            <label className="block text-[11px] text-sf-text-muted">{tr('fields.title')}
              <input ref={titleRef} className={`${fieldClass} mt-1`} maxLength={MAX_PROMPT_TITLE} value={editing.title}
                onChange={(event) => setEditing({ ...editing, title: event.target.value })} placeholder={tr('fields.titlePlaceholder')} data-testid="prompt-library-edit-title" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[11px] text-sf-text-muted">{tr('fields.category')}
                <select className={`${fieldClass} mt-1`} value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value })} data-testid="prompt-library-edit-category">
                  {PROMPT_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{tr(`categories.${item.id}`)}</option>)}
                </select>
              </label>
              <label className="block text-[11px] text-sf-text-muted">{tr('fields.tags')}
                <input className={`${fieldClass} mt-1`} value={editing.tags} onChange={(event) => setEditing({ ...editing, tags: event.target.value })} placeholder={tr('fields.tagsPlaceholder')} />
              </label>
            </div>
            <label className="block text-[11px] text-sf-text-muted">{tr('fields.text')}
              <textarea className={`${fieldClass} mt-1 min-h-[220px] resize-y font-mono leading-relaxed`} maxLength={MAX_PROMPT_TEXT} value={editing.text}
                onChange={(event) => setEditing({ ...editing, text: event.target.value })} placeholder={tr('fields.textPlaceholder')} data-testid="prompt-library-edit-text" />
            </label>
            <p className="rounded border border-sf-dark-700 bg-sf-dark-900/60 px-2.5 py-2 text-[11px] leading-relaxed text-sf-text-muted">{tr('blanksHelp')}</p>
            {extractBlanks(editing.text).length > 0 && (
              <p className="text-[11px] text-sf-text-secondary">{tr('blanksFound', { list: extractBlanks(editing.text).map((item) => item.label).join(', ') })}</p>
            )}
            {error && <p className="text-[11px] text-red-300" role="alert">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className={quietButton} onClick={() => { setEditing(null); setError('') }}>{tr('cancel')}</button>
              <button type="button" className={primaryButton} onClick={saveDraft} data-testid="prompt-library-save"><Check className="h-3.5 w-3.5" />{tr('save')}</button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            <nav aria-label={tr('viewsLabel')} className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-sf-dark-700 p-2 sm:w-48 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r">
              {[...SOURCE_VIEWS, null, ...PROMPT_CATEGORIES.map((item) => item.id)].map((id, index) => (id === null
                ? <div key={`sep-${index}`} className="mx-1 my-1 hidden border-t border-sf-dark-700 sm:block" />
                : (
                  <button key={id} type="button" onClick={() => { setView(id); setSelectedId(null) }} data-testid={`prompt-library-view-${id}`}
                    className={`flex flex-shrink-0 items-center justify-between gap-2 rounded px-2 py-1 text-left text-[11px] ${view === id ? 'bg-sf-dark-700 text-sf-text-primary' : 'text-sf-text-secondary hover:bg-sf-dark-700/60'}`}>
                    <span className="truncate">{viewLabel(id)}</span>
                    <span className="text-[10px] text-sf-text-muted">{countFor(id)}</span>
                  </button>
                )))}
            </nav>

            <div className="flex min-h-0 flex-shrink-0 flex-col border-b border-sf-dark-700 sm:w-72 sm:border-b-0 sm:border-r">
              <ul className="max-h-48 min-h-0 flex-1 overflow-y-auto p-1 sm:max-h-none" data-testid="prompt-library-list">
                {results.map((prompt) => (
                  <li key={prompt.id}>
                    <button type="button" onClick={() => setSelectedId(prompt.id)} data-testid="prompt-library-item" data-prompt-id={prompt.id}
                      className={`w-full rounded px-2 py-1.5 text-left ${selected?.id === prompt.id ? 'bg-sf-dark-700' : 'hover:bg-sf-dark-700/60'}`}>
                      <span className="flex items-center gap-1 text-xs text-sf-text-primary">
                        {favorites.includes(prompt.id) && <Star className="h-3 w-3 flex-shrink-0 fill-sf-accent text-sf-accent" />}
                        <span className="truncate">{prompt.title}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-sf-text-muted">{tr(`categories.${prompt.category}`)} · {sourceLabel(prompt)}</span>
                    </button>
                  </li>
                ))}
                {loaded && results.length === 0 && (
                  <li className="px-2 py-6 text-center text-[11px] text-sf-text-muted">{query ? tr('noResults', { query }) : tr(`empty.${view === 'favorites' || view === 'recent' || view === 'mine' || view === 'pack' ? view : 'other'}`)}</li>
                )}
              </ul>
            </div>

            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-3 text-xs" data-testid="prompt-library-detail">
              {selected ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-medium text-sf-text-primary">{selected.title}</h3>
                      <p className="mt-0.5 text-[11px] text-sf-text-muted">{tr(`categories.${selected.category}`)} · {sourceLabel(selected)}{selected.tags?.length ? ` · ${selected.tags.join(', ')}` : ''}</p>
                    </div>
                    <button type="button" onClick={() => toggleFavorite(selected.id)} aria-pressed={favorites.includes(selected.id)} data-testid="prompt-library-favorite"
                      aria-label={favorites.includes(selected.id) ? tr('unfavorite') : tr('favorite')} title={favorites.includes(selected.id) ? tr('unfavorite') : tr('favorite')}
                      className="rounded p-1 text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary">
                      <Star className={`h-4 w-4 ${favorites.includes(selected.id) ? 'fill-sf-accent text-sf-accent' : ''}`} />
                    </button>
                  </div>

                  {blanks.length > 0 && (
                    <fieldset className="space-y-2 rounded border border-sf-dark-700 bg-sf-dark-900/50 p-2.5">
                      <legend className="px-1 text-[11px] text-sf-text-secondary">{tr('fillBlanks')}</legend>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {blanks.map((blank) => {
                          const suggestions = suggestionsForBlank(blank.key, { castNames })
                          const listId = suggestions.length ? `prompt-blank-${blank.key.replace(/\s+/g, '-')}` : undefined
                          return (
                            <label key={blank.key} className="block text-[11px] text-sf-text-muted">{blank.label}
                              <input className={`${fieldClass} mt-0.5`} list={listId} value={values[blank.key] || ''} data-testid="prompt-library-blank" data-blank={blank.key}
                                onChange={(event) => setValues((current) => ({ ...current, [blank.key]: event.target.value }))}
                                placeholder={suggestions.length ? tr('blankFromCast') : tr('blankPlaceholder')} />
                              {listId && <datalist id={listId}>{suggestions.map((name) => <option key={name} value={name} />)}</datalist>}
                            </label>
                          )
                        })}
                      </div>
                    </fieldset>
                  )}

                  <pre className="max-h-[38vh] overflow-y-auto whitespace-pre-wrap break-words rounded border border-sf-dark-700 bg-sf-dark-900 px-3 py-2 font-sans text-xs leading-relaxed text-sf-text-primary" data-testid="prompt-library-preview">{filled.text}</pre>
                  {blanks.length > 0 && filled.missing.length > 0 && (
                    <p className="text-[11px] text-sf-text-muted">{tr('stillEmpty', { list: filled.missing.join(', ') })}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {request?.onUse && (
                      <>
                        <button type="button" className={primaryButton} onClick={() => applyPrompt('replace')} data-testid="prompt-library-use">
                          <Check className="h-3.5 w-3.5" />{tr('useReplace')}
                        </button>
                        <button type="button" className={quietButton} onClick={() => applyPrompt('append')} data-testid="prompt-library-append">{tr('useAppend')}</button>
                      </>
                    )}
                    <button type="button" className={request?.onUse ? quietButton : primaryButton} onClick={copyPrompt} data-testid="prompt-library-copy">
                      <ClipboardCopy className="h-3.5 w-3.5" />{tr('copy')}
                    </button>
                    <OpenInMenu text={filled.text} className={quietButton}
                      labels={{ button: tr('openIn'), hint: tr('openInHint') }}
                      onOpened={(site) => { markUsed(selected.id); setError(''); setNotice(tr('openedIn', { site })) }}
                      onError={(message) => setError(message || tr('errors.openIn'))} />
                    {selected.source === 'mine' ? (
                      <>
                        <button type="button" className={quietButton} onClick={() => startEdit(selected)} data-testid="prompt-library-edit"><Pencil className="h-3.5 w-3.5" />{tr('edit')}</button>
                        {confirmDelete ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-sf-text-secondary">
                            {tr('deleteConfirm')}
                            <button type="button" className={quietButton} onClick={removeSelected} data-testid="prompt-library-delete-yes">{tr('deleteYes')}</button>
                            <button type="button" className={quietButton} onClick={() => setConfirmDelete(false)}>{tr('cancel')}</button>
                          </span>
                        ) : (
                          <button type="button" className={quietButton} onClick={() => setConfirmDelete(true)} data-testid="prompt-library-delete"><Trash2 className="h-3.5 w-3.5" />{tr('delete')}</button>
                        )}
                      </>
                    ) : (
                      <button type="button" className={quietButton} onClick={() => startEdit(selected, true)} data-testid="prompt-library-duplicate"><CopyPlus className="h-3.5 w-3.5" />{tr('saveCopy')}</button>
                    )}
                    {notice && <span className="text-[11px] text-sf-accent" role="status">{notice}</span>}
                  </div>
                  {(error || storeError) && <p className="text-[11px] text-red-300" role="alert">{error || storeError}</p>}
                </div>
              ) : (
                <p className="py-10 text-center text-[11px] text-sf-text-muted">{loaded ? tr('pickOne') : tr('loading')}</p>
              )}
            </div>
          </div>
        )}
      </section>
    </div>,
    document.body,
  )
}
