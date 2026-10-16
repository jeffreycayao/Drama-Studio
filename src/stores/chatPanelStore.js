import { create } from 'zustand'
import { buildMcpSnapshot } from '../services/mcpSnapshot'
import useTimelineStore from './timelineStore'
import { getChatBackendConfig, resolveChatTarget } from '../services/chatBackend'
import {
  applyApproval,
  buildProjectContext,
  makeChatMessage,
  runChatTurn,
  undoLastChange,
} from '../services/chatAgent'

// Shared by the docked chat panel and the Agent workspace tab, so both show
// the same conversation.

const HISTORY_KEY = 'drama-studio-chat-panel-history'
const LAYOUT_KEY = 'drama-studio-chat-panel-layout'
const MAX_STORED_MESSAGES = 80

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore quota/storage errors
  }
}

function persistMessages(messages) {
  writeJson(HISTORY_KEY, messages.slice(-MAX_STORED_MESSAGES))
}

let toolCache = null
const electronDeps = {
  listTools: async () => {
    if (toolCache) return toolCache
    const api = window.electronAPI?.mcp
    if (!api?.listTools) throw new Error('The chat panel needs the Drama Studio desktop app.')
    toolCache = await api.listTools()
    return toolCache
  },
  callTool: async (name, args) => {
    const api = window.electronAPI.mcp
    // Publish a fresh snapshot so read tools see edits made a moment ago.
    try { await api.updateSnapshot?.(buildMcpSnapshot()) } catch { /* the debounced publisher will catch up */ }
    return api.callTool(name, args)
  },
  chat: (options) => window.electronAPI.llm.chat(options),
  getProjectContext: () => {
    try {
      return buildProjectContext(buildMcpSnapshot())
    } catch {
      return ''
    }
  },
}

const savedLayout = readJson(LAYOUT_KEY, {})

const useChatPanelStore = create((set, get) => ({
  isOpen: savedLayout.isOpen === true,
  side: savedLayout.side === 'left' ? 'left' : 'right',
  width: Number.isFinite(savedLayout.width) ? Math.min(720, Math.max(300, savedLayout.width)) : 380,
  // Previews saved from an earlier session are stale; they can no longer be applied.
  messages: readJson(HISTORY_KEY, [])
    .filter((message) => message && message.role)
    .map((message) => (['pending', 'applying'].includes(message.approval?.status)
      ? { ...message, approval: { ...message.approval, status: 'expired' } }
      : message)),
  status: '',
  isBusy: false,
  textMode: false,
  activeRequestPrefix: '',
  cancelled: false,

  setOpen: (isOpen) => {
    set({ isOpen })
    writeJson(LAYOUT_KEY, { isOpen, side: get().side, width: get().width })
  },
  toggleOpen: () => get().setOpen(!get().isOpen),
  setSide: (side) => {
    set({ side })
    writeJson(LAYOUT_KEY, { isOpen: get().isOpen, side, width: get().width })
  },
  setWidth: (width) => {
    const next = Math.min(720, Math.max(300, Math.round(width)))
    set({ width: next })
    writeJson(LAYOUT_KEY, { isOpen: get().isOpen, side: get().side, width: next })
  },

  appendMessage: (message) => {
    const messages = [...get().messages, message]
    set({ messages })
    persistMessages(messages)
  },
  updateMessage: (id, patch) => {
    const messages = get().messages.map((message) => (message.id === id ? { ...message, ...patch } : message))
    set({ messages })
    persistMessages(messages)
  },

  clear: () => {
    set({ messages: [], status: '', textMode: false })
    persistMessages([])
  },

  send: async (text) => {
    const content = String(text || '').trim()
    if (!content || get().isBusy) return
    // Plans previewed in an earlier turn may be stale now; expire them.
    const expired = get().messages.map((message) => (
      message.approval?.status === 'pending' ? { ...message, approval: { ...message.approval, status: 'expired' } } : message
    ))
    const userMessage = makeChatMessage('user', content)
    const history = [...expired, userMessage]
    const prefix = `chat-${Date.now().toString(36)}`
    set({ messages: history, isBusy: true, status: 'thinking', cancelled: false, activeRequestPrefix: prefix })
    persistMessages(history)

    const target = resolveChatTarget(await getChatBackendConfig())
    const deps = {
      ...electronDeps,
      chat: async (options) => {
        if (get().cancelled) return { ok: false, code: 'cancelled', message: 'Stopped.' }
        return electronDeps.chat(options)
      },
    }
    try {
      if (!window.electronAPI?.llm?.chat) throw new Error('The chat panel needs the Drama Studio desktop app.')
      const result = await runChatTurn({
        history,
        target,
        deps,
        textMode: get().textMode,
        requestIdPrefix: prefix,
        onMessage: (message) => get().appendMessage(message),
        onStatus: (status) => set({ status }),
      })
      set({ textMode: result.textMode })
    } catch (error) {
      if (error?.code !== 'cancelled') {
        get().appendMessage(makeChatMessage('notice', error?.message || String(error), { level: 'error', code: error?.code || '' }))
      }
    } finally {
      set({ isBusy: false, status: '', activeRequestPrefix: '' })
    }
  },

  stop: () => {
    const prefix = get().activeRequestPrefix
    set({ cancelled: true })
    if (prefix && window.electronAPI?.llm?.cancel) {
      for (let step = -1; step < 10; step += 1) window.electronAPI.llm.cancel(`${prefix}-${step}`)
    }
  },

  apply: async (messageId) => {
    const message = get().messages.find((item) => item.id === messageId)
    if (!message?.approval || message.approval.status !== 'pending' || get().isBusy) return
    get().updateMessage(messageId, { approval: { ...message.approval, status: 'applying' } })
    try {
      const stampBefore = useTimelineStore.getState().historyLastChangedAt
      const result = await applyApproval(message.approval, electronDeps)
      const stampAfter = useTimelineStore.getState().historyLastChangedAt
      const status = result.ok ? 'applied' : 'failed'
      // Only the most recent applied change offers Undo.
      const messages = get().messages.map((item) => {
        if (item.id === messageId) return { ...item, approval: { ...item.approval, status, result: result.summary, timelineStamp: stampAfter !== stampBefore ? stampAfter : null } }
        if (item.approval?.status === 'applied' && result.ok) return { ...item, approval: { ...item.approval, undoable: false } }
        return item
      })
      set({ messages })
      get().appendMessage(makeChatMessage('note', result.ok
        ? `[Drama Studio] The user clicked Apply for ${message.approval.tool}. Result: ${result.summary}`
        : `[Drama Studio] Applying ${message.approval.tool} failed: ${result.summary}`))
    } catch (error) {
      get().updateMessage(messageId, { approval: { ...message.approval, status: 'failed', result: error?.message || String(error) } })
    }
  },

  cancelApproval: (messageId) => {
    const message = get().messages.find((item) => item.id === messageId)
    if (!message?.approval || message.approval.status !== 'pending') return
    get().updateMessage(messageId, { approval: { ...message.approval, status: 'cancelled' } })
    get().appendMessage(makeChatMessage('note', `[Drama Studio] The user cancelled the ${message.approval.tool} preview. Nothing was changed.`))
  },

  undo: async (messageId) => {
    const message = get().messages.find((item) => item.id === messageId)
    if (!message?.approval || message.approval.status !== 'applied' || message.approval.undoable === false) return
    const stamp = message.approval.timelineStamp
    if (stamp != null && useTimelineStore.getState().historyLastChangedAt !== stamp) {
      get().appendMessage(makeChatMessage('notice', 'The timeline changed after this was applied, so Undo here could undo your newer edit. Use Edit > Undo (Ctrl+Z) to step back instead.'))
      get().updateMessage(messageId, { approval: { ...message.approval, undoable: false } })
      return
    }
    const result = await undoLastChange(electronDeps)
    get().updateMessage(messageId, { approval: { ...message.approval, status: result.ok ? 'undone' : 'applied', result: result.summary } })
    get().appendMessage(makeChatMessage('note', `[Drama Studio] The user clicked Undo for ${message.approval.tool}. ${result.summary}`))
  },
}))

export default useChatPanelStore
