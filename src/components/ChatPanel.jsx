import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  Bot,
  Check,
  ChevronDown,
  Loader2,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import useChatPanelStore from '../stores/chatPanelStore'
import { splitAssistantContent } from '../utils/chatMessageSegments.mjs'
import {
  CHAT_BACKEND_CHANGED_EVENT,
  getChatApiKeyStatus,
  getChatBackendConfig,
  getChatProvider,
  resolveChatTarget,
} from '../services/chatBackend'

const ACCEPTED_STORAGE_KEY = 'drama-studio-agent-disclaimer-accepted'

const SAMPLE_PROMPTS = [
  'Tighten all pauses between dialogue on Track 1',
  'Regenerate Shot 4 with a high-angle camera',
  'Generate a 5-beat teaser based on this script',
]

function useChatTarget() {
  const [target, setTarget] = useState(null)
  const [keyStatus, setKeyStatus] = useState({ hasKey: false })
  const refresh = useCallback(async () => {
    const next = resolveChatTarget(await getChatBackendConfig())
    setTarget(next)
    setKeyStatus(next.keyRequired ? await getChatApiKeyStatus(next.provider) : { hasKey: true })
  }, [])
  useEffect(() => {
    refresh()
    window.addEventListener(CHAT_BACKEND_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(CHAT_BACKEND_CHANGED_EVENT, refresh)
  }, [refresh])
  return { target, keyStatus }
}

function ApprovalCard({ message, onApply, onCancel, onUndo, disabled }) {
  const { approval } = message
  const [showDetails, setShowDetails] = useState(false)
  const status = approval.status
  return (
    <div className="rounded-lg border border-sf-accent/35 bg-sf-dark-800/80 p-3">
      <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-sf-accent">
        <Wand2 className="h-3 w-3" />
        {status === 'pending' || status === 'applying' ? 'Preview — nothing changed yet' : status === 'applied' ? 'Applied' : status === 'undone' ? 'Undone' : status === 'cancelled' ? 'Cancelled' : status === 'expired' ? 'Expired' : 'Failed'}
      </div>
      <div className="text-xs leading-relaxed text-sf-text-primary">{approval.result || approval.summary}</div>
      <button
        type="button"
        onClick={() => setShowDetails((value) => !value)}
        className="mt-1 inline-flex items-center gap-1 text-[10px] text-sf-text-muted hover:text-sf-text-secondary"
      >
        <ChevronDown className={`h-3 w-3 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
        {approval.tool} details
      </button>
      {showDetails && (
        <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-sf-dark-950 p-2 text-[10px] leading-relaxed text-sf-text-secondary">
          {message.content}
        </pre>
      )}
      {(status === 'pending' || status === 'applying') && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onApply}
            disabled={disabled || status === 'applying'}
            className="inline-flex items-center gap-1 rounded bg-sf-accent px-3 py-1 text-xs font-semibold text-sf-accent-on hover:bg-sf-accent-hover disabled:opacity-50"
          >
            {status === 'applying' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Apply
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={status === 'applying'}
            className="rounded border border-sf-dark-600 px-3 py-1 text-xs text-sf-text-secondary hover:border-sf-dark-500 hover:text-sf-text-primary disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      )}
      {status === 'applied' && approval.undoable !== false && (
        <button
          type="button"
          onClick={onUndo}
          disabled={disabled}
          className="mt-2 inline-flex items-center gap-1 rounded border border-sf-dark-600 px-3 py-1 text-xs text-sf-text-secondary hover:border-sf-accent/60 hover:text-sf-text-primary disabled:opacity-50"
        >
          <RotateCcw className="h-3 w-3" />
          Undo
        </button>
      )}
    </div>
  )
}

function MessageRow({ message, compact, onApply, onCancel, onUndo, busy }) {
  if (message.role === 'note') return null
  if (message.role === 'notice') {
    return (
      <div className={`rounded-md border px-3 py-2 text-[11px] leading-relaxed ${message.level === 'error' ? 'border-sf-error/40 bg-sf-error/10 text-sf-text-primary' : 'border-sf-dark-600 bg-sf-dark-800/60 text-sf-text-secondary'}`}>
        {message.content}
      </div>
    )
  }
  if (message.role === 'tool') {
    if (message.approval) {
      return <ApprovalCard message={message} disabled={busy} onApply={() => onApply(message.id)} onCancel={() => onCancel(message.id)} onUndo={() => onUndo(message.id)} />
    }
    return <ToolStepGroup steps={[message]} />
  }
  if (message.role === 'assistant' && !message.content) return null
  const isUser = message.role === 'user'
  return (
    <div className={`${isUser ? (compact ? 'ml-6' : 'ml-16') : (compact ? 'mr-4' : 'mr-16')} rounded-lg border px-3 py-2 text-sm leading-relaxed ${
      isUser ? 'border-sf-accent/25 bg-sf-accent/10 text-sf-text-primary' : 'border-sf-dark-700 bg-sf-dark-800/70 text-sf-text-primary'
    }`}>
      {isUser ? (
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
      ) : (
        <AssistantContent text={message.content} />
      )}
    </div>
  )
}

// Raw tool output that a model echoed into its reply stays behind a toggle.
function RawDetails({ label, content }) {
  return (
    <details className="my-1 rounded border border-sf-dark-700 bg-sf-dark-900/60 text-[11px]">
      <summary className="cursor-pointer select-none px-2 py-1 text-sf-text-muted hover:text-sf-text-secondary">{label || 'Details'}</summary>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap border-t border-sf-dark-700 p-2 text-[10px] leading-relaxed text-sf-text-secondary">{content}</pre>
    </details>
  )
}

function AssistantContent({ text }) {
  const segments = splitAssistantContent(text)
  if (!segments.length) return null
  return segments.map((segment, index) => (segment.type === 'raw'
    ? <RawDetails key={index} label={segment.label} content={segment.content} />
    : <div key={index} className="whitespace-pre-wrap break-words">{segment.content}</div>))
}

// One or more tool steps in a row: a single quiet line, details on demand.
function ToolStepGroup({ steps }) {
  const failed = steps.filter((step) => step.isError).length
  const label = steps.length === 1
    ? steps[0].summary || steps[0].name
    : `${steps.length} steps${failed ? ` · ${failed} failed` : ''}`
  return (
    <details className="group rounded-md border border-sf-dark-700 bg-sf-dark-900/60 text-[11px]">
      <summary className={`cursor-pointer list-none px-3 py-1.5 ${failed ? 'text-sf-error' : 'text-sf-text-muted'} hover:text-sf-text-secondary`}>
        <span className="inline-flex items-center gap-1">
          <ChevronDown className="h-3 w-3 -rotate-90 transition-transform group-open:rotate-0" />
          {failed ? '⚠ ' : '✓ '}{label}
        </span>
        <span className="ml-2 text-[10px] text-sf-text-muted/70 group-open:hidden">details</span>
      </summary>
      <div className="space-y-1 border-t border-sf-dark-700 p-2">
        {steps.map((step) => (
          <div key={step.id}>
            {steps.length > 1 && (
              <div className={`text-[10px] ${step.isError ? 'text-sf-error' : 'text-sf-text-secondary'}`}>{step.isError ? '⚠ ' : '✓ '}{step.summary || step.name}</div>
            )}
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-sf-dark-950 p-2 text-[10px] leading-relaxed text-sf-text-secondary">{step.content}</pre>
          </div>
        ))}
      </div>
    </details>
  )
}

// Folds runs of plain tool steps (no Apply card) into one row each.
function groupMessages(messages) {
  const items = []
  for (const message of messages) {
    const plainTool = message.role === 'tool' && !message.approval
    const last = items[items.length - 1]
    if (plainTool && last?.kind === 'tools') last.steps.push(message)
    else if (plainTool) items.push({ kind: 'tools', id: message.id, steps: [message] })
    else if (message.role === 'assistant' && !message.content && last?.kind === 'tools') continue
    else items.push({ kind: 'message', id: message.id, message })
  }
  return items
}

/**
 * The in-app AI chat. variant "dock" sits beside the editor; "workspace"
 * fills the Agent tab. Both share one conversation (chatPanelStore).
 */
function ChatPanel({ variant = 'dock', onClose, onOpenSettings }) {
  const compact = variant === 'dock'
  const messages = useChatPanelStore((state) => state.messages)
  const isBusy = useChatPanelStore((state) => state.isBusy)
  const status = useChatPanelStore((state) => state.status)
  const side = useChatPanelStore((state) => state.side)
  const send = useChatPanelStore((state) => state.send)
  const stop = useChatPanelStore((state) => state.stop)
  const clear = useChatPanelStore((state) => state.clear)
  const apply = useChatPanelStore((state) => state.apply)
  const cancelApproval = useChatPanelStore((state) => state.cancelApproval)
  const undo = useChatPanelStore((state) => state.undo)
  const setSide = useChatPanelStore((state) => state.setSide)
  const { target, keyStatus } = useChatTarget()
  const [input, setInput] = useState('')
  const [accepted, setAccepted] = useState(() => {
    try { return localStorage.getItem(ACCEPTED_STORAGE_KEY) === 'true' } catch { return false }
  })
  const endRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, status])

  const needsKey = Boolean(target?.keyRequired && !keyStatus.hasKey)
  const needsModel = Boolean(target && !target.local && !target.model)
  const ready = accepted && target && !needsKey && !needsModel
  const canSend = ready && input.trim() && !isBusy

  const handleSend = (text = input) => {
    const value = String(text || '').trim()
    if (!value || !ready || isBusy) return
    setInput('')
    void send(value)
  }

  const handleAccept = () => {
    try { localStorage.setItem(ACCEPTED_STORAGE_KEY, 'true') } catch { /* ignore */ }
    setAccepted(true)
    setTimeout(() => inputRef.current?.focus(), 30)
  }

  const provider = target ? getChatProvider(target.provider) : null
  const backendLabel = target ? `${provider.label}${target.model ? ` · ${target.model}` : ''}` : 'Loading…'

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-sf-dark-900 text-sf-text-primary">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-sf-dark-700 px-3 py-2">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-sf-accent/15 text-sf-accent">
          <Bot className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-tight">Assistant</div>
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex max-w-full items-center gap-1 truncate text-[10px] text-sf-text-muted hover:text-sf-text-secondary"
            title="Change the AI backend in Settings > Agents"
          >
            <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${needsKey || needsModel ? 'bg-sf-warning' : 'bg-sf-success'}`} />
            <span className="truncate">{backendLabel}</span>
          </button>
        </div>
        {compact && (
          <button type="button" onClick={() => setSide(side === 'right' ? 'left' : 'right')} className="rounded p-1 text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary" title={`Dock on the ${side === 'right' ? 'left' : 'right'}`}>
            <ArrowLeftRight className="h-3.5 w-3.5" />
          </button>
        )}
        <button type="button" onClick={onOpenSettings} className="rounded p-1 text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary" title="AI backend settings">
          <Settings2 className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={clear} disabled={isBusy || !messages.length} className="rounded p-1 text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary disabled:opacity-40" title="Clear conversation">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        {onClose && (
          <button type="button" onClick={onClose} className="rounded p-1 text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary" title="Close assistant">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className={`${compact ? '' : 'mx-auto max-w-4xl'} space-y-2.5`}>
          {!accepted ? (
            <div className="rounded-lg border border-sf-warning/35 bg-sf-dark-800 p-3 text-xs leading-relaxed text-sf-text-secondary">
              <div className="mb-1 text-sm font-semibold text-sf-text-primary">Turn on the assistant</div>
              <p>The assistant can read your open project and propose edits, generations and exports through Drama Studio's tools. Every change is shown as a preview first and only happens when you click <span className="font-semibold text-sf-text-primary">Apply</span>; applied edits can be undone.</p>
              <button type="button" onClick={handleAccept} className="mt-3 inline-flex items-center gap-1.5 rounded bg-sf-accent px-3 py-1.5 text-xs font-semibold text-sf-accent-on hover:bg-sf-accent-hover">
                <ShieldCheck className="h-3.5 w-3.5" />
                Turn on
              </button>
            </div>
          ) : (needsKey || needsModel) ? (
            <div className="rounded-lg border border-sf-dark-600 bg-sf-dark-800 p-3 text-xs leading-relaxed text-sf-text-secondary">
              <div className="mb-1 text-sm font-semibold text-sf-text-primary">Finish setting up {provider?.label}</div>
              <p>{needsKey ? `Add your ${provider?.label} API key` : 'Pick a model'} in Settings, or switch to a free local backend (Ollama or LM Studio).</p>
              <button type="button" onClick={onOpenSettings} className="mt-3 rounded bg-sf-accent px-3 py-1.5 text-xs font-semibold text-sf-accent-on hover:bg-sf-accent-hover">
                Open AI settings
              </button>
            </div>
          ) : messages.length === 0 ? (
            <div className="pt-4 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-sf-accent/15 text-sf-accent">
                <Wand2 className="h-5 w-5" />
              </div>
              <div className="text-sm font-semibold">Talk to your edit</div>
              <p className="mx-auto mt-1 max-w-xs text-xs text-sf-text-muted">Ask about the project or describe a change. You'll see a preview before anything changes.</p>
              <div className="mt-4 flex flex-col gap-1.5">
                {SAMPLE_PROMPTS.map((prompt) => (
                  <button key={prompt} type="button" onClick={() => setInput(prompt)} className="rounded-md border border-sf-dark-600 bg-sf-dark-800/60 px-3 py-1.5 text-left text-xs text-sf-text-secondary hover:border-sf-accent/50 hover:text-sf-text-primary">
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {accepted && groupMessages(messages).map((item) => (item.kind === 'tools'
            ? <ToolStepGroup key={item.id} steps={item.steps} />
            : <MessageRow key={item.id} message={item.message} compact={compact} busy={isBusy} onApply={apply} onCancel={cancelApproval} onUndo={undo} />
          ))}
          {isBusy && (
            <div className="flex items-center gap-2 px-1 text-[11px] text-sf-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-sf-accent" />
              {status && status !== 'thinking' && status !== 'working' ? status.replace(/_/g, ' ') : 'Thinking…'}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-sf-dark-700 p-2.5">
        <div className={`${compact ? '' : 'mx-auto max-w-4xl'} flex items-end gap-2`}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                handleSend()
              }
            }}
            disabled={!ready}
            rows={compact ? 2 : 3}
            placeholder={ready ? 'Ask or describe an edit…' : 'Finish setup above to start'}
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-md border border-sf-dark-600 bg-sf-dark-950 px-2.5 py-2 text-sm text-sf-text-primary outline-none placeholder:text-sf-text-muted focus:border-sf-accent disabled:opacity-50"
          />
          {isBusy ? (
            <button type="button" onClick={stop} className="flex h-[44px] w-[44px] items-center justify-center rounded-md border border-sf-dark-600 text-sf-text-secondary hover:border-sf-error/60 hover:text-sf-text-primary" title="Stop">
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button type="button" onClick={() => handleSend()} disabled={!canSend} className="flex h-[44px] w-[44px] items-center justify-center rounded-md bg-sf-accent text-sf-accent-on hover:bg-sf-accent-hover disabled:opacity-40" title="Send (Enter)">
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default ChatPanel
