// LLM gateway for the in-app chat panel.
//
// Runs in the Electron main process so that:
//   - requests are not subject to renderer CORS rules (Ollama/LM Studio/cloud),
//   - API keys are read from Drama Studio settings here and only ever sent to
//     the fixed base URL of the provider they belong to.
// The renderer speaks one provider-neutral message format; this module
// converts it to OpenAI-compatible or Anthropic Messages API requests.

const ANTHROPIC_VERSION = '2023-06-01'
const ANTHROPIC_FALLBACK_BETA = 'server-side-fallback-2026-07-01'
const OLLAMA_CONTEXT_LENGTH = 16384

const PROVIDERS = Object.freeze({
  ollama: {
    id: 'ollama',
    label: 'Ollama',
    kind: 'openai',
    local: true,
    keyRequired: false,
    defaultBaseUrl: 'http://localhost:11434/v1',
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio',
    kind: 'openai',
    local: true,
    keyRequired: false,
    defaultBaseUrl: 'http://localhost:1234/v1',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    kind: 'anthropic',
    local: false,
    keyRequired: true,
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-opus-5-5',
    suggestedModels: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    local: false,
    keyRequired: true,
    baseUrl: 'https://api.openai.com/v1',
  },
  // Your own subscription through the installed CLI (see subscriptionCli.cjs).
  // Text tool mode only: edits are previewed and applied by Drama Studio.
  'claude-cli': {
    id: 'claude-cli',
    label: 'Claude (your subscription)',
    kind: 'cli',
    cli: 'claude',
    local: false,
    keyRequired: false,
    textTools: true,
    defaultModel: 'default',
    suggestedModels: ['default', 'opus', 'sonnet', 'haiku'],
  },
  'codex-cli': {
    id: 'codex-cli',
    label: 'Codex (your subscription)',
    kind: 'cli',
    cli: 'codex',
    local: false,
    keyRequired: false,
    textTools: true,
    defaultModel: 'default',
    suggestedModels: ['default'],
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai',
    local: false,
    keyRequired: true,
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    suggestedModels: ['deepseek-chat', 'deepseek-reasoner'],
  },
})

class GatewayError extends Error {
  constructor(message, code = 'error', status = 0) {
    super(message)
    this.code = code
    this.status = status
  }
}

function getProvider(id) {
  const provider = PROVIDERS[String(id || '')]
  if (!provider) throw new GatewayError(`Unknown chat provider "${id}".`, 'invalid_provider')
  return provider
}

function normalizeLocalBaseUrl(provider, rawUrl) {
  const fallback = provider.defaultBaseUrl
  const text = String(rawUrl || '').trim() || fallback
  let url
  try {
    url = new URL(text)
  } catch {
    throw new GatewayError(`"${text}" is not a valid URL.`, 'invalid_url')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new GatewayError('Local model servers must use http:// or https://.', 'invalid_url')
  }
  let pathname = url.pathname.replace(/\/+$/, '')
  if (!/\/v1$/.test(pathname)) pathname = `${pathname}/v1`
  return `${url.origin}${pathname}`
}

// Cloud base URLs are fixed: a user-supplied URL never receives a cloud key.
function resolveBaseUrl(provider, baseUrl) {
  return provider.local ? normalizeLocalBaseUrl(provider, baseUrl) : provider.baseUrl
}

// --- Schema helpers -------------------------------------------------------

function sanitizeSchema(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || depth > 12) return {}
  const out = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(Object.entries(value).map(([name, prop]) => [name, sanitizeSchema(prop, depth + 1)]))
    } else if (key === 'items') {
      out.items = sanitizeSchema(value, depth + 1)
    } else if ((key === 'anyOf' || key === 'oneOf' || key === 'allOf') && Array.isArray(value)) {
      out[key] = value.map((item) => sanitizeSchema(item, depth + 1))
    } else if (key === 'additionalProperties' && value && typeof value === 'object') {
      out.additionalProperties = sanitizeSchema(value, depth + 1)
    } else {
      out[key] = value
    }
  }
  // OpenAI rejects arrays without items; everyone needs object roots.
  if (out.type === 'array' && !out.items) out.items = {}
  return out
}

function toParametersSchema(schema) {
  const clean = sanitizeSchema(schema)
  if (clean.type !== 'object') clean.type = 'object'
  if (!clean.properties || typeof clean.properties !== 'object') clean.properties = {}
  return clean
}

function safeParseArguments(value) {
  if (value && typeof value === 'object') return value
  const text = String(value || '').trim()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return { __invalidJson: text.slice(0, 2000) }
  }
}

// --- Message conversion ---------------------------------------------------
// Neutral message shapes:
//   { role: 'user', content }
//   { role: 'assistant', content, toolCalls: [{ id, name, arguments }], raw, rawProvider, rawModel }
//   { role: 'tool', toolCallId, name, content, isError }

function toOpenAiMessages(system, messages) {
  const out = []
  if (system) out.push({ role: 'system', content: system })
  for (const message of messages || []) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: String(message.content || '') })
    } else if (message.role === 'assistant') {
      const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : []
      const entry = { role: 'assistant', content: String(message.content || '') || (toolCalls.length ? null : '') }
      if (toolCalls.length) {
        entry.tool_calls = toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments || {}) },
        }))
      }
      out.push(entry)
    } else if (message.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: message.toolCallId, content: String(message.content || '') })
    }
  }
  return out
}

// Ollama native /api/chat: tool arguments are objects, tool results carry tool_name.
function toOllamaMessages(system, messages) {
  return toOpenAiMessages(system, messages).map((message) => {
    if (message.role === 'assistant' && message.tool_calls) {
      return {
        role: 'assistant',
        content: message.content || '',
        tool_calls: message.tool_calls.map((call) => ({ function: { name: call.function.name, arguments: safeParseArguments(call.function.arguments) } })),
      }
    }
    if (message.role === 'tool') {
      const source = (messages || []).find((item) => item.role === 'tool' && item.toolCallId === message.tool_call_id)
      return { role: 'tool', content: message.content, tool_name: source?.name || '' }
    }
    return message
  })
}

function toAnthropicMessages(messages, model) {
  const out = []
  let pendingResults = null
  const flush = () => {
    if (pendingResults?.length) out.push({ role: 'user', content: pendingResults })
    pendingResults = null
  }
  for (const message of messages || []) {
    if (message.role === 'tool') {
      if (!pendingResults) pendingResults = []
      pendingResults.push({
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: String(message.content || '') || '(empty result)',
        ...(message.isError ? { is_error: true } : {}),
      })
      continue
    }
    flush()
    if (message.role === 'user') {
      const text = String(message.content || '')
      if (text) out.push({ role: 'user', content: text })
    } else if (message.role === 'assistant') {
      // Echo Claude's own content blocks (including thinking) back unchanged
      // when continuing on the same model; otherwise rebuild text + tool_use.
      if (Array.isArray(message.raw) && message.rawProvider === 'anthropic' && message.rawModel === model) {
        out.push({ role: 'assistant', content: message.raw })
        continue
      }
      const blocks = []
      if (String(message.content || '').trim()) blocks.push({ type: 'text', text: String(message.content) })
      for (const call of message.toolCalls || []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments || {} })
      }
      if (blocks.length) out.push({ role: 'assistant', content: blocks })
    }
  }
  flush()
  return out
}

function supportsEffort(model) {
  return /^claude-(opus|sonnet|haiku|fable|mythos)-5/.test(String(model || ''))
}

function supportsDefaultFallback(model) {
  return /^claude-(opus-5|sonnet-5-5|fable-5-1)/.test(String(model || ''))
}

function filterOpenAiChatModels(ids) {
  return ids.filter((id) => /^(gpt|o\d|chatgpt)/i.test(id))
    .filter((id) => !/(audio|realtime|tts|transcribe|image|embedding|search|moderation|instruct|dall-e|whisper)/i.test(id))
}

// --- Gateway --------------------------------------------------------------

function createLlmGateway({ fetchImpl = globalThis.fetch, getApiKey = async () => '', cliBaseDir = '', cliRunner = null } = {}) {
  const inflight = new Map()
  const cli = cliRunner || require('./subscriptionCli.cjs')

  async function requireKey(provider) {
    if (!provider.keyRequired) return ''
    const key = String((await getApiKey(provider.id)) || '').trim()
    if (!key) throw new GatewayError(`Add your ${provider.label} API key in Settings > Agents first.`, 'missing_key')
    return key
  }

  function headersFor(provider, key, model) {
    if (provider.kind === 'anthropic') {
      const headers = {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
      }
      if (model && supportsDefaultFallback(model)) headers['anthropic-beta'] = ANTHROPIC_FALLBACK_BETA
      return headers
    }
    const headers = { 'content-type': 'application/json' }
    if (key) headers.authorization = `Bearer ${key}`
    return headers
  }

  async function request(url, init, { provider, timeoutMs, requestId }) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new GatewayError('The model took too long to answer.', 'timeout')), timeoutMs)
    if (requestId) inflight.set(requestId, controller)
    let response
    try {
      response = await fetchImpl(url, { ...init, signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted) {
        const reason = controller.signal.reason
        if (reason instanceof GatewayError) throw reason
        throw new GatewayError('Request cancelled.', 'cancelled')
      }
      const cause = error?.cause?.code || error?.code || ''
      if (provider.local) {
        throw new GatewayError(`Nothing answered at ${new URL(url).origin}. Is ${provider.label} running${provider.id === 'ollama' ? ' (ollama serve)' : ' with its local server enabled'}?`, 'unreachable')
      }
      throw new GatewayError(`Could not reach ${provider.label}${cause ? ` (${cause})` : ''}. Check your internet connection.`, 'unreachable')
    } finally {
      clearTimeout(timer)
      if (requestId) inflight.delete(requestId)
    }
    const text = await response.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = null }
    if (!response.ok) {
      const detail = data?.error?.message || data?.error || data?.message || text.slice(0, 300) || response.statusText
      const detailText = typeof detail === 'string' ? detail : JSON.stringify(detail)
      if (response.status === 401 || response.status === 403) {
        throw new GatewayError(`${provider.label} rejected the API key (${response.status}). Check it in Settings > Agents.`, 'auth', response.status)
      }
      if (response.status === 429) throw new GatewayError(`${provider.label} is rate limiting requests. Wait a moment and try again.`, 'rate_limit', 429)
      if (/does not support tools|tools? (?:are|is) not supported|tool[_ ]?(?:use|calling|choice)? .*not supported|unsupported.*tool/i.test(detailText)) {
        throw new GatewayError(detailText, 'tools_unsupported', response.status)
      }
      if (response.status === 404 && provider.local) {
        throw new GatewayError(`${provider.label} answered but the model or endpoint was not found: ${detailText}`, 'not_found', 404)
      }
      throw new GatewayError(`${provider.label} error ${response.status}: ${detailText}`, 'http', response.status)
    }
    return data
  }

  async function listModels({ provider: providerId, baseUrl } = {}) {
    const provider = getProvider(providerId)
    if (provider.kind === 'cli') return { models: [...provider.suggestedModels], baseUrl: '' }
    const key = await requireKey(provider)
    const root = resolveBaseUrl(provider, baseUrl)
    if (provider.kind === 'anthropic') {
      const data = await request(`${root}/models?limit=100`, { method: 'GET', headers: headersFor(provider, key) }, { provider, timeoutMs: 20000 })
      const ids = (data?.data || []).map((model) => model.id).filter(Boolean)
      return { models: ids.length ? ids : [...provider.suggestedModels], baseUrl: root }
    }
    const data = await request(`${root}/models`, { method: 'GET', headers: headersFor(provider, key) }, { provider, timeoutMs: provider.local ? 8000 : 20000 })
    let ids = (Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []).map((model) => model?.id || model?.name).filter(Boolean)
    if (provider.id === 'openai') ids = filterOpenAiChatModels(ids)
    return { models: ids, baseUrl: root }
  }

  async function testConnection(options = {}) {
    const provider = getProvider(options.provider)
    const started = Date.now()
    if (provider.kind === 'cli') {
      const result = await cli.checkCli(provider.cli, { model: options.model, baseDir: cliBaseDir })
      return { ...result, provider: provider.id, models: [...provider.suggestedModels] }
    }
    try {
      const { models, baseUrl } = await listModels(options)
      if (!models.length) {
        return {
          ok: false,
          provider: provider.id,
          baseUrl,
          models,
          message: provider.local
            ? `${provider.label} is running but has no models yet. ${provider.id === 'ollama' ? 'Run "ollama pull qwen3" (or another tool-capable model).' : 'Download a model in LM Studio first.'}`
            : `${provider.label} answered but returned no chat models.`,
        }
      }
      return { ok: true, provider: provider.id, baseUrl, models, latencyMs: Date.now() - started, message: `Connected to ${provider.label} (${models.length} model${models.length === 1 ? '' : 's'}).` }
    } catch (error) {
      return { ok: false, provider: provider.id, code: error.code || 'error', message: error.message || String(error) }
    }
  }

  async function chat(options = {}) {
    const provider = getProvider(options.provider)
    if (provider.kind === 'cli') {
      const requestId = options.requestId || ''
      const controller = new AbortController()
      if (requestId) inflight.set(requestId, controller)
      try {
        const runner = provider.cli === 'codex' ? cli.runCodex : cli.runClaude
        const reply = await runner({
          model: String(options.model || provider.defaultModel || '').trim(),
          system: options.system || '',
          messages: options.messages || [],
          baseDir: cliBaseDir,
          signal: controller.signal,
        })
        return { text: reply.text, toolCalls: [], stopReason: 'end_turn', model: reply.model }
      } catch (error) {
        throw new GatewayError(error.message || String(error), error.code || 'error')
      } finally {
        if (requestId) inflight.delete(requestId)
      }
    }
    const key = await requireKey(provider)
    const root = resolveBaseUrl(provider, options.baseUrl)
    const model = String(options.model || provider.defaultModel || '').trim()
    if (!model) throw new GatewayError(`Choose a ${provider.label} model in Settings > Agents.`, 'missing_model')
    const tools = Array.isArray(options.tools) ? options.tools : []
    const timeoutMs = provider.local ? 300000 : 180000
    const requestId = options.requestId || ''

    if (provider.kind === 'anthropic') {
      const body = {
        model,
        max_tokens: Number(options.maxTokens) || 16000,
        messages: toAnthropicMessages(options.messages, model),
      }
      if (options.system) body.system = options.system
      if (tools.length) {
        body.tools = tools.map((tool) => ({ name: tool.name, description: tool.description || '', input_schema: toParametersSchema(tool.parameters) }))
      }
      if (supportsEffort(model)) body.output_config = { effort: options.effort || 'medium' }
      if (supportsDefaultFallback(model)) body.fallbacks = 'default'
      const data = await request(`${root}/messages`, { method: 'POST', headers: headersFor(provider, key, model), body: JSON.stringify(body) }, { provider, timeoutMs, requestId })
      if (data?.stop_reason === 'refusal') {
        return { text: 'The model declined this request. Try rephrasing it, or switch models in Settings > Agents.', toolCalls: [], stopReason: 'refusal', model: data?.model || model }
      }
      const content = Array.isArray(data?.content) ? data.content : []
      const text = content.filter((block) => block.type === 'text').map((block) => block.text).join('\n').trim()
      const toolCalls = content.filter((block) => block.type === 'tool_use').map((block) => ({ id: block.id, name: block.name, arguments: block.input || {} }))
      return {
        text,
        toolCalls,
        stopReason: data?.stop_reason || '',
        model: data?.model || model,
        raw: content,
        rawProvider: 'anthropic',
        rawModel: model,
        usage: data?.usage || null,
      }
    }

    if (provider.id === 'ollama') {
      // Ollama's OpenAI-compatible endpoint keeps the model's default context
      // (often 4096 tokens), which silently truncates the system prompt and
      // tool schemas. The native endpoint lets us raise num_ctx.
      const nativeRoot = root.replace(/\/v1$/, '')
      const body = {
        model,
        messages: toOllamaMessages(options.system, options.messages),
        stream: false,
        options: { temperature: 0.2, num_ctx: Number(options.contextLength) || OLLAMA_CONTEXT_LENGTH },
      }
      if (tools.length) {
        body.tools = tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description || '', parameters: toParametersSchema(tool.parameters) } }))
      }
      const data = await request(`${nativeRoot}/api/chat`, { method: 'POST', headers: headersFor(provider, key), body: JSON.stringify(body) }, { provider, timeoutMs, requestId })
      const message = data?.message || {}
      const toolCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : []).map((call, index) => ({
        id: call.id || `call_${Date.now()}_${index}`,
        name: call.function?.name,
        arguments: safeParseArguments(call.function?.arguments),
      })).filter((call) => call.name)
      return { text: String(message.content || '').trim(), toolCalls, stopReason: data?.done_reason || '', model: data?.model || model }
    }

    const body = {
      model,
      messages: toOpenAiMessages(options.system, options.messages),
      stream: false,
    }
    if (tools.length) {
      body.tools = tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description || '', parameters: toParametersSchema(tool.parameters) } }))
      body.tool_choice = 'auto'
    }
    if (provider.id !== 'openai') body.temperature = 0.2
    const data = await request(`${root}/chat/completions`, { method: 'POST', headers: headersFor(provider, key), body: JSON.stringify(body) }, { provider, timeoutMs, requestId })
    const choice = data?.choices?.[0] || {}
    const message = choice.message || {}
    const toolCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : []).map((call, index) => ({
      id: call.id || `call_${Date.now()}_${index}`,
      name: call.function?.name || call.name,
      arguments: safeParseArguments(call.function?.arguments ?? call.arguments),
    })).filter((call) => call.name)
    return {
      text: String(message.content || '').trim(),
      toolCalls,
      stopReason: choice.finish_reason || '',
      model: data?.model || model,
      usage: data?.usage || null,
    }
  }

  function cancel(requestId) {
    const controller = inflight.get(requestId)
    if (!controller) return false
    controller.abort(new GatewayError('Request cancelled.', 'cancelled'))
    inflight.delete(requestId)
    return true
  }

  function describeProviders() {
    return Object.values(PROVIDERS).map((provider) => ({
      id: provider.id,
      label: provider.label,
      local: provider.local,
      keyRequired: provider.keyRequired,
      defaultBaseUrl: provider.defaultBaseUrl || provider.baseUrl,
      defaultModel: provider.defaultModel || '',
      suggestedModels: provider.suggestedModels || [],
      textTools: Boolean(provider.textTools),
    }))
  }

  return { listModels, testConnection, chat, cancel, describeProviders }
}

function serializeGatewayError(error) {
  return { ok: false, code: error?.code || 'error', status: error?.status || 0, message: error?.message || String(error) }
}

module.exports = {
  PROVIDERS,
  GatewayError,
  createLlmGateway,
  serializeGatewayError,
  // exported for tests
  toOpenAiMessages,
  toAnthropicMessages,
  toParametersSchema,
  normalizeLocalBaseUrl,
}
