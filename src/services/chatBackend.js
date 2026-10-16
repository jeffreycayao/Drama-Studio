/**
 * Chat panel backend selection (Ollama, LM Studio, Claude, OpenAI, DeepSeek).
 *
 * Storage mirrors comfyPartnerAuth.js:
 *   - backend choice/model/endpoints: electron settings `chatBackendConfig`
 *     (localStorage fallback for web preview)
 *   - API keys: written once through window.electronAPI.llm.setApiKey and only
 *     read back by the Electron main process, which sends each key solely to
 *     its own provider's fixed URL.
 */

const SETTING_KEY = 'chatBackendConfig'
const LOCAL_KEY = 'drama-studio-chat-backend-config'
const LEGACY_ENDPOINT_KEY = 'drama-studio-agent-endpoint'
const LEGACY_MODEL_KEY = 'drama-studio-agent-selected-model'

export const CHAT_BACKEND_CHANGED_EVENT = 'drama-studio-chat-backend-changed'

// Renderer-side copy of electron/llmGateway.js PROVIDERS (labels/defaults only).
export const CHAT_PROVIDERS = Object.freeze([
  {
    id: 'ollama',
    label: 'Ollama',
    local: true,
    keyRequired: false,
    defaultBaseUrl: 'http://localhost:11434/v1',
    blurb: 'Free and private. Runs on this PC; needs a decent GPU or Apple Silicon.',
    help: 'Install Ollama, then run "ollama pull qwen3" (or another model that supports tools).',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    local: true,
    keyRequired: false,
    defaultBaseUrl: 'http://localhost:1234/v1',
    blurb: 'Free and private. Pick and download models in the LM Studio app.',
    help: 'In LM Studio, open the Developer tab and start the local server (port 1234). Load the model with a context length of 8192 or more so the editing tools fit.',
  },
  {
    id: 'anthropic',
    label: 'Claude',
    local: false,
    keyRequired: true,
    defaultModel: 'claude-opus-5-5',
    suggestedModels: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    blurb: 'Cloud. Strongest at multi-step edits. Works on any PC.',
    help: 'Create a key at console.anthropic.com. Usage is billed by Anthropic.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    local: false,
    keyRequired: true,
    blurb: 'Cloud. Works on any PC.',
    help: 'Create a key at platform.openai.com. Usage is billed by OpenAI.',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    local: false,
    keyRequired: true,
    defaultModel: 'deepseek-chat',
    suggestedModels: ['deepseek-chat', 'deepseek-reasoner'],
    blurb: 'Cloud. Low cost. Works on any PC.',
    help: 'Create a key at platform.deepseek.com. Usage is billed by DeepSeek.',
  },
])

export function getChatProvider(id) {
  return CHAT_PROVIDERS.find((provider) => provider.id === id) || CHAT_PROVIDERS[0]
}

function defaultConfig() {
  const config = { provider: 'ollama', baseUrls: {}, models: {} }
  // Carry over the endpoint/model from the older Agent tab (LM Studio).
  try {
    const legacyEndpoint = localStorage.getItem(LEGACY_ENDPOINT_KEY)
    const legacyModel = localStorage.getItem(LEGACY_MODEL_KEY)
    if (legacyEndpoint) {
      config.provider = 'lmstudio'
      config.baseUrls.lmstudio = legacyEndpoint
      if (legacyModel) config.models.lmstudio = legacyModel
    }
  } catch (_) {
    // ignore storage errors
  }
  return config
}

export function normalizeChatBackendConfig(value) {
  const base = defaultConfig()
  if (!value || typeof value !== 'object') return base
  const provider = CHAT_PROVIDERS.some((item) => item.id === value.provider) ? value.provider : base.provider
  return {
    provider,
    baseUrls: { ...base.baseUrls, ...(value.baseUrls && typeof value.baseUrls === 'object' ? value.baseUrls : {}) },
    models: { ...base.models, ...(value.models && typeof value.models === 'object' ? value.models : {}) },
  }
}

export async function getChatBackendConfig() {
  try {
    if (typeof window !== 'undefined' && window?.electronAPI?.getSetting) {
      const stored = await window.electronAPI.getSetting(SETTING_KEY)
      if (stored && typeof stored === 'object') return normalizeChatBackendConfig(stored)
    }
  } catch (_) {
    // fall through to localStorage
  }
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (raw) return normalizeChatBackendConfig(JSON.parse(raw))
  } catch (_) {
    // ignore
  }
  return defaultConfig()
}

export async function saveChatBackendConfig(nextConfig) {
  const config = normalizeChatBackendConfig(nextConfig)
  try {
    if (typeof window !== 'undefined' && window?.electronAPI?.setSetting) {
      await window.electronAPI.setSetting(SETTING_KEY, config)
    }
  } catch (_) {
    // keep localStorage copy below
  }
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(config))
  } catch (_) {
    // ignore
  }
  try {
    window.dispatchEvent(new CustomEvent(CHAT_BACKEND_CHANGED_EVENT, { detail: config }))
  } catch (_) {
    // ignore
  }
  return config
}

/** Selected provider + endpoint + model, ready for llm.chat / llm.test. */
export function resolveChatTarget(config) {
  const normalized = normalizeChatBackendConfig(config)
  const provider = getChatProvider(normalized.provider)
  return {
    provider: provider.id,
    label: provider.label,
    local: provider.local,
    keyRequired: provider.keyRequired,
    baseUrl: provider.local ? (normalized.baseUrls[provider.id] || provider.defaultBaseUrl) : undefined,
    model: normalized.models[provider.id] || provider.defaultModel || '',
  }
}

function llmApi() {
  return typeof window !== 'undefined' ? window.electronAPI?.llm || null : null
}

export function isChatBackendAvailable() {
  return Boolean(llmApi())
}

export async function testChatBackend(target) {
  const api = llmApi()
  if (!api) return { ok: false, message: 'The chat panel needs the Drama Studio desktop app.' }
  return api.test({ provider: target.provider, baseUrl: target.baseUrl })
}

export async function setChatApiKey(providerId, key) {
  const api = llmApi()
  if (!api) return { success: false, error: 'The chat panel needs the Drama Studio desktop app.' }
  const result = await api.setApiKey(providerId, key)
  try {
    window.dispatchEvent(new CustomEvent(CHAT_BACKEND_CHANGED_EVENT, { detail: { keyChanged: providerId } }))
  } catch (_) {
    // ignore
  }
  return result
}

export async function getChatApiKeyStatus(providerId) {
  const api = llmApi()
  if (!api) return { hasKey: false, hint: '' }
  try {
    return await api.getKeyStatus(providerId)
  } catch (_) {
    return { hasKey: false, hint: '' }
  }
}
