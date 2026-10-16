import { getChatBackendConfig, resolveChatTarget } from './chatBackend'

/** One-shot, tool-free request to the Assistant backend the user chose in
 * Settings › Agents (Ollama, LM Studio, Claude, OpenAI, DeepSeek). Keys stay
 * in the main process. Used by the songwriter and the Idea Pad. */
export async function askStoryAssistant({ system, prompt, requestId = `story-${Date.now()}`, api = globalThis.window?.electronAPI?.llm } = {}) {
  if (!api?.chat) throw new Error('The AI writer needs the Drama Studio desktop app.')
  const target = resolveChatTarget(await getChatBackendConfig())
  if (!target.model) throw new Error('Choose an Assistant model in Settings › Agents (MCP) › Assistant AI first.')
  const response = await api.chat({ provider: target.provider, baseUrl: target.baseUrl, model: target.model,
    system, messages: [{ role: 'user', content: prompt }], tools: [], requestId })
  if (!response?.ok) throw new Error(response?.message || `${target.label || 'The Assistant'} did not answer.`)
  const text = String(response.text || '').trim()
  if (!text) throw new Error('The Assistant returned an empty answer. Try again or pick another model.')
  return { text, target }
}

export const cancelStoryAssistant = (requestId, api = globalThis.window?.electronAPI?.llm) => api?.cancel?.(requestId)
