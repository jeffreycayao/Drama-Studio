const test = require('node:test')
const assert = require('node:assert/strict')
const {
  createLlmGateway, toAnthropicMessages, toOpenAiMessages, toParametersSchema, normalizeLocalBaseUrl, PROVIDERS,
} = require('../electron/llmGateway')

function fakeFetch(handler) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null })
    const { status = 200, json = {} } = await handler(url, init)
    return { ok: status >= 200 && status < 300, status, statusText: String(status), text: async () => JSON.stringify(json) }
  }
  return { fetchImpl, calls }
}

const history = [
  { role: 'user', content: 'Tighten Audio 1' },
  { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'tighten_track_gaps', arguments: { track: 'Audio 1' } }] },
  { role: 'tool', toolCallId: 't1', name: 'tighten_track_gaps', content: '{"previewOnly":true}' },
]

test('local base URLs gain /v1 and reject non-http schemes', () => {
  assert.equal(normalizeLocalBaseUrl(PROVIDERS.lmstudio, 'http://localhost:1234'), 'http://localhost:1234/v1')
  assert.equal(normalizeLocalBaseUrl(PROVIDERS.ollama, 'http://127.0.0.1:11434/v1/'), 'http://127.0.0.1:11434/v1')
  assert.equal(normalizeLocalBaseUrl(PROVIDERS.ollama, ''), 'http://localhost:11434/v1')
  assert.throws(() => normalizeLocalBaseUrl(PROVIDERS.ollama, 'file:///etc/passwd'))
})

test('schemas become object roots and arrays always have items', () => {
  const schema = toParametersSchema({ properties: { ids: { type: 'array' } } })
  assert.equal(schema.type, 'object')
  assert.deepEqual(schema.properties.ids, { type: 'array', items: {} })
})

test('neutral history converts to OpenAI tool_calls and Anthropic tool_use/tool_result', () => {
  const openai = toOpenAiMessages('sys', history)
  assert.equal(openai[0].role, 'system')
  assert.equal(openai[2].tool_calls[0].function.name, 'tighten_track_gaps')
  assert.equal(openai[2].content, null)
  assert.deepEqual(openai[3], { role: 'tool', tool_call_id: 't1', content: '{"previewOnly":true}' })

  const anthropic = toAnthropicMessages(history, 'claude-opus-5-5')
  assert.equal(anthropic.length, 3)
  assert.deepEqual(anthropic[1].content[0], { type: 'tool_use', id: 't1', name: 'tighten_track_gaps', input: { track: 'Audio 1' } })
  assert.equal(anthropic[2].content[0].type, 'tool_result')
  assert.equal(anthropic[2].content[0].tool_use_id, 't1')

  const raw = [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'tool_use', id: 't1', name: 'x', input: {} }]
  const echoed = toAnthropicMessages([history[0], { ...history[1], raw, rawProvider: 'anthropic', rawModel: 'claude-opus-5-5' }, history[2]], 'claude-opus-5-5')
  assert.equal(echoed[1].content, raw, 'same-model Claude content is echoed unchanged')
  const switched = toAnthropicMessages([history[0], { ...history[1], raw, rawProvider: 'anthropic', rawModel: 'claude-opus-5-5' }, history[2]], 'claude-sonnet-5-5')
  assert.notEqual(switched[1].content, raw)
})

test('Anthropic requests use fixed URL, key header, version, effort and default fallback', async () => {
  const { fetchImpl, calls } = fakeFetch(async () => ({ json: {
    model: 'claude-opus-5-5', stop_reason: 'tool_use',
    content: [{ type: 'text', text: 'Previewing.' }, { type: 'tool_use', id: 'tu1', name: 'get_timeline', input: { includeClips: false } }],
  } }))
  const gateway = createLlmGateway({ fetchImpl, getApiKey: async (id) => (id === 'anthropic' ? 'sk-ant-test' : '') })
  const result = await gateway.chat({ provider: 'anthropic', baseUrl: 'http://evil.example', model: 'claude-opus-5-5', system: 'sys', messages: [history[0]],
    tools: [{ name: 'get_timeline', description: 'd', parameters: { type: 'object', properties: {} } }] })
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages')
  assert.equal(calls[0].init.headers['x-api-key'], 'sk-ant-test')
  assert.equal(calls[0].init.headers['anthropic-version'], '2023-06-01')
  assert.equal(calls[0].init.headers['anthropic-beta'], 'server-side-fallback-2026-07-01')
  assert.equal(calls[0].body.fallbacks, 'default')
  assert.deepEqual(calls[0].body.output_config, { effort: 'medium' })
  assert.equal(calls[0].body.tools[0].input_schema.type, 'object')
  assert.equal('temperature' in calls[0].body, false)
  assert.equal(result.text, 'Previewing.')
  assert.deepEqual(result.toolCalls, [{ id: 'tu1', name: 'get_timeline', arguments: { includeClips: false } }])
  assert.equal(result.rawProvider, 'anthropic')
})

test('Ollama requests go to the local URL with no key; missing cloud keys fail before any request', async () => {
  const { fetchImpl, calls } = fakeFetch(async () => ({ json: { done_reason: 'stop', message: { content: '', tool_calls: [{ function: { name: 'get_project', arguments: {} } }] } } }))
  const gateway = createLlmGateway({ fetchImpl, getApiKey: async () => '' })
  const result = await gateway.chat({ provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen3', messages: history, tools: [{ name: 'get_project', parameters: {} }] })
  assert.equal(calls[0].url, 'http://localhost:11434/api/chat', 'native endpoint so num_ctx can be raised')
  assert.equal(calls[0].body.options.num_ctx, 16384)
  assert.equal(calls[0].init.headers.authorization, undefined)
  assert.equal(calls[0].body.tools[0].type, 'function')
  assert.deepEqual(calls[0].body.messages[1].tool_calls[0].function.arguments, { track: 'Audio 1' }, 'native tool arguments are objects')
  assert.deepEqual(calls[0].body.messages[2], { role: 'tool', content: '{"previewOnly":true}', tool_name: 'tighten_track_gaps' })
  assert.equal(result.toolCalls[0].name, 'get_project')
  await gateway.chat({ provider: 'lmstudio', model: 'm', messages: [history[0]] })
  assert.equal(calls[1].url, 'http://localhost:1234/v1/chat/completions')
  await assert.rejects(gateway.chat({ provider: 'deepseek', model: 'deepseek-chat', messages: [] }), (error) => error.code === 'missing_key')
  assert.equal(calls.length, 2, 'the missing-key DeepSeek call never hit the network')
})

test('tool-unsupported and auth errors are classified; tests report friendly failures', async () => {
  const { fetchImpl } = fakeFetch(async (url) => (url.includes('/models')
    ? { status: 401, json: { error: { message: 'bad key' } } }
    : { status: 400, json: { error: { message: 'registry.ollama.ai/library/gemma does not support tools' } } }))
  const gateway = createLlmGateway({ fetchImpl, getApiKey: async () => 'k' })
  await assert.rejects(gateway.chat({ provider: 'ollama', model: 'gemma', messages: [], tools: [{ name: 'a' }] }), (error) => error.code === 'tools_unsupported')
  const tested = await gateway.testConnection({ provider: 'openai' })
  assert.equal(tested.ok, false)
  assert.equal(tested.code, 'auth')
  const unreachable = createLlmGateway({ fetchImpl: async () => { throw new TypeError('fetch failed') } })
  const offline = await unreachable.testConnection({ provider: 'lmstudio' })
  assert.equal(offline.ok, false)
  assert.match(offline.message, /LM Studio/)
})
