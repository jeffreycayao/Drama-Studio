import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Download, Languages, Loader2, Trash2, X } from 'lucide-react'
import useTimelineStore from '../stores/timelineStore'
import { getChatBackendConfig, resolveChatTarget } from '../services/chatBackend'
import {
  applyCaptionTranslation,
  deleteCaptionVersion,
  saveSubtitlesWithDialog,
  showCaptionVersion,
  translateCaptionsClip,
} from '../services/subtitleService'
import { ORIGINAL_VERSION_KEY, SUBTITLE_LANGUAGES, getCaptionVersions, maxCharsForCue } from '../utils/subtitles.mjs'

const formatTime = (seconds) => {
  const total = Math.max(0, Number(seconds) || 0)
  const minutes = Math.floor(total / 60)
  return `${minutes}:${(total % 60).toFixed(1).padStart(4, '0')}`
}

const OTHER_LANGUAGE = '__other__'

function languageKeyFor(label) {
  return String(label || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'custom'
}

/**
 * Timeline › captions clip menu › "Translate Captions…".
 * 1. Pick a language and translate with the Assistant model (Settings ›
 *    Agents › Assistant AI). Nothing changes on the timeline yet.
 * 2. Review every line next to the original; edit any of them.
 * 3. Apply: the translation becomes a language version on the same captions
 *    clip and is shown (one undo step). The original is kept, and versions
 *    can be switched or removed here at any time.
 */
export default function TranslateCaptionsDialog({ clipId, onClose }) {
  const clip = useTimelineStore((state) => state.clips.find((item) => item.id === clipId))
  const { activeKey, versions } = useMemo(() => getCaptionVersions(clip?.captions), [clip?.captions])
  // Default to the first common target not on the clip yet, skipping English
  // (usually the language the captions were made in).
  const [languageCode, setLanguageCode] = useState(() => SUBTITLE_LANGUAGES.find((item) => item.code !== 'en' && !versions.some((v) => v.key === item.code))?.code || 'es')
  const [customLanguage, setCustomLanguage] = useState('')
  const [sourceKey, setSourceKey] = useState(activeKey)
  const [phase, setPhase] = useState('choose') // choose | running | review
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState(null)
  const [edited, setEdited] = useState([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [modelLabel, setModelLabel] = useState('')
  const abortRef = useRef(null)
  const dialogRef = useRef(null)

  const target = languageCode === OTHER_LANGUAGE
    ? { code: languageKeyFor(customLanguage), label: customLanguage.trim() }
    : SUBTITLE_LANGUAGES.find((item) => item.code === languageCode)
  const existingVersion = target?.code ? versions.find((version) => version.key === target.code) : null
  const running = phase === 'running'

  useEffect(() => {
    let cancelled = false
    getChatBackendConfig().then((config) => {
      if (cancelled) return
      const resolved = resolveChatTarget(config)
      setModelLabel(resolved.model ? `${resolved.label} · ${resolved.model}` : '')
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    dialogRef.current?.focus()
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (running) abortRef.current?.abort()
      else onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, running])

  useEffect(() => () => abortRef.current?.abort(), [])

  const translate = async () => {
    if (!target?.label) { setError('Choose a language to translate into.'); return }
    const controller = new AbortController()
    abortRef.current = controller
    setPhase('running')
    setError('')
    setStatus('')
    setProgress({ done: 0, total: 0 })
    try {
      const outcome = await translateCaptionsClip({
        clipId,
        targetLanguage: target,
        sourceKey,
        signal: controller.signal,
        onProgress: setProgress,
      })
      setResult(outcome)
      setEdited(outcome.cues.map((cue) => cue.text))
      setPhase('review')
      setStatus(`Translated ${outcome.cues.length} lines${outcome.model ? ` with ${outcome.model}` : ''}. Check them, edit any line, then apply.`)
    } catch (err) {
      setPhase('choose')
      setError(err?.message || 'Translation failed.')
    } finally {
      abortRef.current = null
    }
  }

  const apply = () => {
    if (!result || !target) return
    try {
      const cues = result.cues.map((cue, index) => ({ ...cue, text: edited[index]?.trim() || cue.text }))
      applyCaptionTranslation(result.clipId, { key: target.code, label: target.label, cues, translatedFrom: result.sourceKey })
      setPhase('choose')
      setResult(null)
      setStatus(`${target.label} captions are on the timeline now. The original is kept below. Undo with Ctrl+Z.`)
    } catch (err) {
      setError(err?.message || 'Could not apply the translation.')
    }
  }

  const runVersionAction = (action, key, message) => {
    try {
      action(clipId, key)
      setStatus(message)
      setError('')
    } catch (err) {
      setError(err?.message || 'That did not work.')
    }
  }

  const saveFile = async (format) => {
    setError('')
    try {
      const saved = await saveSubtitlesWithDialog({ format })
      if (saved) setStatus(`Saved ${saved.paths.map((path) => path.split(/[\\/]/).pop()).join(', ')}.`)
    } catch (err) {
      setError(err?.message || 'Could not save the subtitle file.')
    }
  }

  if (!clip) return null
  const sourceVersion = versions.find((version) => version.key === sourceKey) || versions[0]
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3 sm:p-4"
      onMouseDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget && !running) onClose() }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="translate-captions-title" data-testid="translate-captions-dialog" tabIndex={-1}
        className="flex max-h-[90vh] w-full min-w-0 max-w-2xl flex-col overflow-hidden rounded-xl border border-sf-dark-600 bg-sf-dark-800 text-sf-text-primary shadow-2xl focus:outline-none">
        <header className="flex flex-shrink-0 items-start gap-3 border-b border-sf-dark-700 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="translate-captions-title" className="flex items-center gap-1.5 text-sm font-semibold"><Languages className="h-4 w-4 text-sf-accent" />Translate captions</h2>
            <p className="mt-1 text-xs leading-relaxed text-sf-text-muted">Translate every caption line into another language. Timing and style stay the same, and the original is kept.</p>
          </div>
          <button type="button" onClick={onClose} disabled={running} aria-label="Close translate captions" className="rounded p-1 text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary disabled:opacity-40"><X className="h-4 w-4" /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-xs">
          <div>
            <div className="mb-1.5 font-medium">Languages on this clip</div>
            <ul className="space-y-1" data-testid="caption-versions">
              {versions.map((version) => (
                <li key={version.key} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${version.isActive ? 'border-sf-accent/50 bg-sf-accent/10' : 'border-sf-dark-600 bg-sf-dark-900/50'}`}>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-sf-text-primary">{version.label}</span>
                    <span className="ml-1.5 text-sf-text-muted">{version.cues.length} lines{version.translatedFrom ? ' · translated' : ''}</span>
                  </span>
                  {version.isActive
                    ? <span className="inline-flex items-center gap-1 text-[11px] text-sf-accent"><Check className="h-3 w-3" />Shown</span>
                    : <button type="button" disabled={running} onClick={() => runVersionAction(showCaptionVersion, version.key, `${version.label} captions are shown now. Undo with Ctrl+Z.`)}
                        className="rounded border border-sf-dark-500 px-2 py-0.5 text-[11px] hover:bg-sf-dark-700 disabled:opacity-40">Show</button>}
                  {version.key !== ORIGINAL_VERSION_KEY && (
                    <button type="button" disabled={running} title={`Remove the ${version.label} version`} aria-label={`Remove the ${version.label} version`}
                      onClick={() => runVersionAction(deleteCaptionVersion, version.key, `Removed the ${version.label} version. Undo with Ctrl+Z.`)}
                      className="rounded p-1 text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-error disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {phase !== 'review' && (
            <div className="space-y-3 rounded-lg border border-sf-dark-600 bg-sf-dark-900/40 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="translate-target" className="mb-1.5 block font-medium">Translate into</label>
                  <select id="translate-target" data-testid="translate-target" value={languageCode} disabled={running}
                    onChange={(event) => { setLanguageCode(event.target.value); setError('') }}
                    className="w-full rounded border border-sf-dark-600 bg-sf-dark-900 px-2 py-1.5 disabled:opacity-50">
                    {SUBTITLE_LANGUAGES.map((item) => (
                      <option key={item.code} value={item.code}>{item.label}{item.native ? ` (${item.native})` : ''}</option>
                    ))}
                    <option value={OTHER_LANGUAGE}>Other language…</option>
                  </select>
                  {languageCode === OTHER_LANGUAGE && (
                    <input type="text" value={customLanguage} disabled={running} onChange={(event) => setCustomLanguage(event.target.value)}
                      placeholder="e.g. Cebuano, Swahili, Ukrainian" aria-label="Language name"
                      className="mt-2 w-full rounded border border-sf-dark-600 bg-sf-dark-900 px-2 py-1.5" />
                  )}
                </div>
                <div>
                  <label htmlFor="translate-source" className="mb-1.5 block font-medium">From</label>
                  <select id="translate-source" value={sourceKey} disabled={running} onChange={(event) => setSourceKey(event.target.value)}
                    className="w-full rounded border border-sf-dark-600 bg-sf-dark-900 px-2 py-1.5 disabled:opacity-50">
                    {versions.map((version) => <option key={version.key} value={version.key}>{version.label} ({version.cues.length} lines)</option>)}
                  </select>
                </div>
              </div>
              <p className="leading-relaxed text-sf-text-muted">
                Uses your Assistant model{modelLabel ? <> (<span className="text-sf-text-secondary">{modelLabel}</span>)</> : ''}, set in Settings › Agents (MCP) › Assistant AI.
                A local model is free; a cloud model is billed by its provider. Lines are sent in small batches.
              </p>
              {existingVersion && <p className="text-sf-warning">This clip already has a {existingVersion.label} version. Applying a new one replaces it.</p>}
              {running && (
                <div role="status" aria-live="polite">
                  <div className="mb-1 flex items-center gap-1.5 text-sf-text-secondary"><Loader2 className="h-3 w-3 animate-spin" />
                    {progress.total ? `Translating ${progress.done} of ${progress.total} lines…` : 'Sending the first lines…'}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-sf-dark-700"><div className="h-full rounded-full bg-sf-accent transition-[width]" style={{ width: `${percent}%` }} /></div>
                </div>
              )}
            </div>
          )}

          {phase === 'review' && result && (
            <div>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="font-medium">{sourceVersion?.label || 'Original'} → {target?.label}</span>
                <span className="text-[11px] text-sf-text-muted">Amber lines may be too long to read in time.</span>
              </div>
              <div className="max-h-[42vh] overflow-y-auto rounded-lg border border-sf-dark-600" data-testid="translate-review">
                {result.cues.map((cue, index) => {
                  const original = sourceVersion?.cues.find((item) => item.id === cue.id)?.text || ''
                  const tooLong = (edited[index] || '').length > maxCharsForCue(cue)
                  return (
                    <div key={cue.id || index} className="grid grid-cols-[52px_1fr_1fr] gap-2 border-b border-sf-dark-700/70 px-2.5 py-2 last:border-b-0">
                      <span className="pt-1 font-mono text-[10px] text-sf-text-muted">{formatTime(cue.start)}</span>
                      <span className="whitespace-pre-wrap pt-1 leading-snug text-sf-text-muted">{original}</span>
                      <textarea value={edited[index] ?? ''} rows={Math.min(3, Math.max(1, Math.ceil((edited[index] || '').length / 38)))}
                        onChange={(event) => setEdited((current) => current.map((value, i) => (i === index ? event.target.value : value)))}
                        aria-label={`Translated line ${index + 1}`}
                        className={`w-full resize-y rounded border bg-sf-dark-900 px-2 py-1 leading-snug ${tooLong ? 'border-sf-warning/70' : 'border-sf-dark-600'}`} />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {(status || error) && (
            <p role={error ? 'alert' : 'status'} aria-live="polite" data-testid="translate-status"
              className={`rounded border px-3 py-2 leading-relaxed ${error ? 'border-sf-warning/40 bg-sf-warning/10 text-sf-warning' : 'border-sf-dark-600 text-sf-text-muted'}`}>
              {error || status}
            </p>
          )}
        </div>

        <footer className="flex flex-shrink-0 flex-wrap items-center gap-2 border-t border-sf-dark-700 px-4 py-3">
          <div className="mr-auto flex items-center gap-1.5">
            <span className="text-[11px] text-sf-text-muted">Save shown language:</span>
            {['srt', 'vtt'].map((format) => (
              <button key={format} type="button" disabled={running} onClick={() => void saveFile(format)}
                className="inline-flex items-center gap-1 rounded border border-sf-dark-600 px-2 py-1 text-[11px] hover:bg-sf-dark-700 disabled:opacity-40">
                <Download className="h-3 w-3" />.{format}
              </button>
            ))}
          </div>
          {running
            ? <button type="button" onClick={() => abortRef.current?.abort()} className="rounded border border-sf-dark-600 px-3 py-1.5 text-xs hover:bg-sf-dark-700">Stop</button>
            : <button type="button" onClick={phase === 'review' ? () => { setPhase('choose'); setResult(null); setStatus('') } : onClose}
                className="rounded border border-sf-dark-600 px-3 py-1.5 text-xs hover:bg-sf-dark-700">{phase === 'review' ? 'Discard' : 'Close'}</button>}
          {phase === 'review'
            ? <button type="button" data-testid="translate-apply" onClick={apply}
                className="rounded bg-sf-accent px-3 py-1.5 text-xs font-semibold text-sf-accent-on hover:bg-sf-accent-hover">Apply {target?.label} captions</button>
            : <button type="button" data-testid="translate-run" onClick={() => void translate()} disabled={running || !target?.label}
                className="rounded bg-sf-accent px-3 py-1.5 text-xs font-semibold text-sf-accent-on hover:bg-sf-accent-hover disabled:cursor-not-allowed disabled:opacity-40">
                {running ? 'Translating…' : `Translate to ${target?.label || '…'}`}
              </button>}
        </footer>
      </section>
    </div>, document.body,
  )
}
