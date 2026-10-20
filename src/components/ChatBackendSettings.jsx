import { useCallback, useEffect, useState } from 'react'
import { Check, CloudCog, HardDrive, KeyRound, Loader2, PlugZap, X } from 'lucide-react'
import {
  CHAT_PROVIDERS,
  getChatApiKeyStatus,
  getChatBackendConfig,
  getChatProvider,
  isChatBackendAvailable,
  resolveChatTarget,
  saveChatBackendConfig,
  setChatApiKey,
  testChatBackend,
} from '../services/chatBackend'

/** Settings > Agents: which LLM powers the in-app assistant. */
function ChatBackendSettings() {
  const [config, setConfig] = useState(null)
  const [keyStatus, setKeyStatus] = useState({ hasKey: false, hint: '' })
  const [keyDraft, setKeyDraft] = useState('')
  const [models, setModels] = useState([])
  const [test, setTest] = useState({ state: 'idle', message: '' })
  const available = isChatBackendAvailable()

  useEffect(() => {
    getChatBackendConfig().then(setConfig)
  }, [])

  const providerId = config?.provider || 'ollama'
  const provider = getChatProvider(providerId)
  const target = config ? resolveChatTarget(config) : null

  useEffect(() => {
    setKeyDraft('')
    setTest({ state: 'idle', message: '' })
    setModels(provider.suggestedModels || [])
    if (provider.keyRequired) getChatApiKeyStatus(provider.id).then(setKeyStatus)
    else setKeyStatus({ hasKey: true, hint: '' })
  }, [provider.id, provider.keyRequired, provider.suggestedModels])

  const update = useCallback(async (patch) => {
    const next = await saveChatBackendConfig({ ...config, ...patch })
    setConfig(next)
    return next
  }, [config])

  const selectProvider = (id) => update({ provider: id })
  const setBaseUrl = (value) => setConfig((current) => ({ ...current, baseUrls: { ...current.baseUrls, [providerId]: value } }))
  const commitBaseUrl = () => update({ baseUrls: config.baseUrls })
  const setModel = (value) => update({ models: { ...config.models, [providerId]: value } })

  const runTest = async (nextConfig = config) => {
    setTest({ state: 'testing', message: '' })
    const result = await testChatBackend(resolveChatTarget(nextConfig))
    if (result?.ok) {
      const list = result.models || []
      setModels(list)
      const current = nextConfig.models?.[providerId]
      if (!current || !list.includes(current)) {
        const preferred = provider.defaultModel && list.includes(provider.defaultModel) ? provider.defaultModel : list[0]
        if (preferred && !current) await saveChatBackendConfig({ ...nextConfig, models: { ...nextConfig.models, [providerId]: preferred } }).then(setConfig)
      }
    }
    setTest({ state: result?.ok ? 'ok' : 'error', message: result?.message || 'No answer.' })
  }

  const saveKey = async () => {
    const result = await setChatApiKey(provider.id, keyDraft)
    if (!result?.success) {
      setTest({ state: 'error', message: result?.error || 'Could not save the key.' })
      return
    }
    setKeyDraft('')
    setKeyStatus(await getChatApiKeyStatus(provider.id))
    await runTest()
  }

  const removeKey = async () => {
    await setChatApiKey(provider.id, '')
    setKeyStatus(await getChatApiKeyStatus(provider.id))
    setTest({ state: 'idle', message: '' })
  }

  if (!config) return null

  return (
    <div className="rounded-lg border border-sf-dark-700 bg-sf-dark-900/60 px-3 py-3">
      <div className="text-sm font-medium text-sf-text-primary">Assistant AI</div>
      <p className="mt-1 text-[11px] text-sf-text-muted">
        Choose the model behind the in-app assistant. Local runs free and private on this PC. Your subscription uses the Claude or ChatGPT plan you already pay for, with no API key. API keys are billed by the provider.
      </p>
      {!available && (
        <p className="mt-2 text-[11px] text-sf-warning">The assistant needs the Drama Studio desktop app.</p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-3">
        {CHAT_PROVIDERS.map((item) => {
          const selected = item.id === providerId
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => selectProvider(item.id)}
              className={`rounded-md border px-2.5 py-2 text-left transition-colors ${selected ? 'border-sf-accent bg-sf-accent/10' : 'border-sf-dark-600 bg-sf-dark-800/60 hover:border-sf-dark-500'}`}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold text-sf-text-primary">
                {item.local ? <HardDrive className="h-3 w-3 text-sf-text-muted" /> : <CloudCog className="h-3 w-3 text-sf-text-muted" />}
                {item.label}
                {selected && <Check className="ml-auto h-3 w-3 text-sf-accent" />}
              </div>
              <div className="mt-0.5 text-[10px] leading-snug text-sf-text-muted">{item.blurb}</div>
            </button>
          )
        })}
      </div>

      <div className="mt-3 space-y-3 rounded-md border border-sf-dark-700 bg-black/20 p-3">
        <p className="text-[11px] text-sf-text-muted">{provider.help}</p>

        {provider.local ? (
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-sf-text-muted">Server address</label>
            <input
              value={config.baseUrls?.[providerId] ?? ''}
              placeholder={provider.defaultBaseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              onBlur={commitBaseUrl}
              spellCheck={false}
              className="w-full rounded border border-sf-dark-600 bg-sf-dark-800 px-2 py-1.5 text-xs text-sf-text-primary outline-none focus:border-sf-accent"
            />
          </div>
        ) : provider.subscription ? (
          <div className="rounded border border-sf-accent/30 bg-sf-accent/5 px-2.5 py-2 text-[11px] leading-relaxed text-sf-text-secondary" data-testid="assistant-subscription-note">
            <span className="font-semibold text-sf-text-primary">No API key needed.</span> Drama Studio uses the sign-in of the {provider.id === 'codex-cli' ? 'Codex' : 'Claude Code'} app on this PC, so requests count against your plan. Click <span className="text-sf-text-primary">Test connection</span> to check it is installed and signed in.
          </div>
        ) : (
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-sf-text-muted">{provider.label} API key</label>
            {keyStatus.hasKey ? (
              <div className="flex items-center gap-2 text-xs text-sf-text-secondary">
                <KeyRound className="h-3.5 w-3.5 text-sf-success" />
                Saved ({keyStatus.hint})
                <button type="button" onClick={removeKey} className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary">
                  <X className="h-3 w-3" /> Remove
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="password"
                  value={keyDraft}
                  onChange={(event) => setKeyDraft(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && keyDraft.trim()) saveKey() }}
                  placeholder="Paste your API key"
                  autoComplete="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded border border-sf-dark-600 bg-sf-dark-800 px-2 py-1.5 text-xs text-sf-text-primary outline-none focus:border-sf-accent"
                />
                <button type="button" onClick={saveKey} disabled={!keyDraft.trim()} className="rounded bg-sf-accent px-3 py-1.5 text-xs font-semibold text-sf-accent-on hover:bg-sf-accent-hover disabled:opacity-40">
                  Save
                </button>
              </div>
            )}
            <p className="mt-1 text-[10px] text-sf-text-muted">Stored on this computer only and sent only to {provider.label}.</p>
          </div>
        )}

        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-sf-text-muted">Model</label>
          <input
            list={`chat-models-${providerId}`}
            value={config.models?.[providerId] ?? ''}
            placeholder={provider.defaultModel || (models[0] ? `e.g. ${models[0]}` : 'Test the connection to list models')}
            onChange={(event) => setConfig((current) => ({ ...current, models: { ...current.models, [providerId]: event.target.value } }))}
            onBlur={(event) => setModel(event.target.value.trim())}
            spellCheck={false}
            className="w-full rounded border border-sf-dark-600 bg-sf-dark-800 px-2 py-1.5 text-xs text-sf-text-primary outline-none focus:border-sf-accent"
          />
          <datalist id={`chat-models-${providerId}`}>
            {models.map((model) => <option key={model} value={model} />)}
          </datalist>
          {provider.subscription && (
            <p className="mt-1 text-[10px] text-sf-text-muted">"default" uses your plan's default model.{provider.id === 'claude-cli' ? ' Or type opus, sonnet or haiku.' : ''} Each answer takes a few seconds longer than an API key, because the app starts {provider.id === 'codex-cli' ? 'Codex' : 'Claude Code'} for every turn.</p>
          )}
          {provider.local && (
            <p className="mt-1 text-[10px] text-sf-text-muted">Pick a model that supports tool calling (for example Qwen 3, Llama 3.1+ or Mistral) for editing requests.</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => runTest()}
            disabled={!available || test.state === 'testing' || (provider.keyRequired && !keyStatus.hasKey)}
            className="inline-flex items-center gap-1.5 rounded border border-sf-dark-600 px-3 py-1.5 text-xs text-sf-text-secondary hover:border-sf-accent hover:text-sf-text-primary disabled:opacity-40"
          >
            {test.state === 'testing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
            Test connection
          </button>
          {test.message && (
            <span className={`min-w-0 text-[11px] ${test.state === 'ok' ? 'text-sf-success' : 'text-sf-error'}`}>{test.message}</span>
          )}
        </div>
        {target?.model && test.state !== 'error' && (
          <p className="text-[10px] text-sf-text-muted">The assistant will use {provider.label} · {target.model}.</p>
        )}
      </div>
    </div>
  )
}

export default ChatBackendSettings
