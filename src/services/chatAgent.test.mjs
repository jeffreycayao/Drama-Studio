import test from 'node:test'
import assert from 'node:assert/strict'
import { runChatTurn, applyApproval, undoLastChange, selectChatTools, toNeutralHistory, parseTextToolCalls, makeChatMessage, AGENT_GUARDRAILS, AGENT_GUARDRAILS_REMINDER, splitAssistantSegments } from './chatAgent.js'

const TOOLS = [
  { name: 'get_timeline', description: 'read', inputSchema: { type: 'object', properties: { includeClips: { type: 'boolean' } } } },
  { name: 'tighten_track_gaps', description: 'write', inputSchema: { type: 'object', properties: { track: { type: 'string' }, previewOnly: { type: 'boolean' } } } },
  { name: 'undo', description: 'undo', inputSchema: { type: 'object', properties: { previewOnly: { type: 'boolean' } } } },
  { name: 'export_timeline', description: 'cloud only', inputSchema: { type: 'object', properties: { previewOnly: { type: 'boolean' } } } },
]
const text = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })

function makeDeps(responses) {
  const calls = []
  const requests = []
  return {
    calls,
    requests,
    deps: {
      listTools: async () => TOOLS,
      chat: async (request) => { requests.push(request); return responses.shift() },
      callTool: async (name, args) => {
        calls.push({ name, args })
        if (name === 'tighten_track_gaps' && args.previewOnly !== false) {
          return text({ previewOnly: true, action: name, message: 'Would shorten 3 pauses.', suggestedApplyCall: { tool: name, arguments: { track: 'audio-1', previewOnly: false } } })
        }
        if (name === 'tighten_track_gaps') return text({ success: true, result: { message: 'Shortened 3 pauses.' } })
        if (name === 'undo') return text({ success: true, message: 'Undid tighten.' })
        return text({ timeline: { name: 'Main' } })
      },
      getProjectContext: () => 'Tracks: Audio 1 (id audio-1)',
    },
  }
}

test('a write request previews, never applies, and yields an approval card', async () => {
  const { deps, calls, requests } = makeDeps([
    { ok: true, text: '', toolCalls: [{ id: 'c1', name: 'get_timeline', arguments: {} }] },
    { ok: true, text: '', toolCalls: [{ id: 'c2', name: 'tighten_track_gaps', arguments: { track: 'Audio 1', previewOnly: false } }] },
    { ok: true, text: 'This would shorten 3 pauses. Click Apply to make the change.', toolCalls: [] },
  ])
  const history = [makeChatMessage('user', 'Tighten all pauses between dialogue on Track 1')]
  const emitted = []
  const result = await runChatTurn({ history, target: { provider: 'ollama', local: true, model: 'qwen3' }, deps, onMessage: (m) => emitted.push(m) })

  assert.deepEqual(calls.map((c) => [c.name, c.args.previewOnly]), [['get_timeline', undefined], ['tighten_track_gaps', true]],
    'model asked for previewOnly:false but the panel forced a preview')
  const card = emitted.find((m) => m.approval)
  assert.equal(card.approval.status, 'pending')
  assert.deepEqual(card.approval.args, { track: 'audio-1', previewOnly: false })
  assert.match(card.content, /preview only/)
  assert.equal(result.messages.at(-1).content, 'This would shorten 3 pauses. Click Apply to make the change.')
  assert.equal(requests[0].tools.some((t) => t.name === 'export_timeline'), false, 'local models get the compact tool set')
  assert.match(requests[0].system, /Audio 1/)

  const applied = await applyApproval(card.approval, deps)
  assert.equal(applied.ok, true)
  assert.equal(applied.summary, 'Shortened 3 pauses.')
  assert.deepEqual(calls.at(-1), { name: 'tighten_track_gaps', args: { track: 'audio-1', previewOnly: false } })
  const undone = await undoLastChange(deps)
  assert.equal(undone.ok, true)
  assert.deepEqual(calls.at(-1), { name: 'undo', args: { previewOnly: false } })
})

test('tool-less local models fall back to text tool blocks', async () => {
  const { deps, calls } = makeDeps([
    { ok: false, code: 'tools_unsupported', message: 'does not support tools' },
    { ok: true, text: '```drama-studio-tool\n{"tool":"get_timeline","arguments":{}}\n```', toolCalls: [] },
    { ok: true, text: 'The timeline is called Main.', toolCalls: [] },
  ])
  const result = await runChatTurn({ history: [makeChatMessage('user', 'what is the timeline?')], target: { provider: 'ollama', local: true, model: 'gemma' }, deps })
  assert.equal(result.textMode, true)
  assert.equal(calls[0].name, 'get_timeline')
  assert.ok(result.messages.some((m) => m.role === 'notice'))
})

test('helpers: extended tool set for cloud, neutral history trims to a user turn, text calls parse', () => {
  assert.ok(selectChatTools(TOOLS, { local: false }).some((t) => t.name === 'export_timeline'))
  const history = toNeutralHistory([
    makeChatMessage('tool', 'orphan', { toolCallId: 'x', name: 'get_timeline' }),
    makeChatMessage('user', 'hi'),
    makeChatMessage('notice', 'ui only'),
    makeChatMessage('note', '[Drama Studio] The user applied tighten_track_gaps.'),
  ])
  assert.deepEqual(history.map((m) => m.role), ['user', 'user'])
  assert.deepEqual(parseTextToolCalls('```drama-studio-tool\n[{"tool":"a"},{"name":"b","args":{"x":1}}]\n```').map((c) => [c.name, c.arguments]), [['a', {}], ['b', { x: 1 }]])
})

test("every request carries Drama Studio's rules first and a reminder last", async () => {
  const { deps, requests } = makeDeps([{ ok: true, text: 'Hi!', toolCalls: [] }])
  await runChatTurn({ history: [makeChatMessage('user', 'How does your app work inside?')], target: { provider: 'ollama', model: 'm', local: true }, deps })
  const { system } = requests[0]
  assert.ok(system.startsWith(AGENT_GUARDRAILS), 'rules come before anything else')
  assert.ok(system.trimEnd().endsWith(AGENT_GUARDRAILS_REMINDER), 'reminder comes after the project context')
  assert.match(AGENT_GUARDRAILS, /search_help/)
  assert.match(AGENT_GUARDRAILS, /open-source software under GPL-3\.0-only/)
  assert.match(AGENT_GUARDRAILS, /Never disclose private credentials/)
  assert.ok(system.indexOf('Tracks: Audio 1') < system.lastIndexOf(AGENT_GUARDRAILS_REMINDER))
})

test('local models get search_help in their core tools', () => {
  const tools = [{ name: 'search_help', description: 'help', inputSchema: { type: 'object', properties: {} } }, ...TOOLS]
  assert.ok(selectChatTools(tools, { local: true }).some((tool) => tool.name === 'search_help'))
})

test('echoed tool output in a reply is split out so the panel can fold it', () => {
  const echoed = splitAssistantSegments('Done.\n\nTOOL RESULT: {\n  "success": true,\n  "note": "a } inside a string"\n}\n\nYou can Apply it.')
  assert.deepEqual(echoed.map((segment) => segment.type), ['text', 'raw', 'text'])
  assert.equal(echoed[1].text, '{\n  "success": true,\n  "note": "a } inside a string"\n}')
  assert.equal(echoed[2].text, 'You can Apply it.')

  const fenced = splitAssistantSegments('Here:\n```json\n{"tracks":[{"id":"v1"}]}\n```\nAll good.')
  assert.deepEqual(fenced.map((segment) => segment.type), ['text', 'raw', 'text'])

  const named = splitAssistantSegments('Drama Studio tool result for get_timeline:\n{\n "clips": []\n}')
  assert.equal(named.length, 1)
  assert.equal(named[0].label, 'Tool output · get_timeline')

  const bare = splitAssistantSegments('Timeline:\n{\n  "duration": 12,\n  "fps": 24\n}')
  assert.deepEqual(bare.map((segment) => segment.type), ['text', 'raw'])

  const plain = splitAssistantSegments('No JSON here. Use {curly} words.\n```js\nconst a = 1\n```')
  assert.deepEqual(plain.map((segment) => segment.type), ['text'])
})

test('splitting stays fast on hostile replies', () => {
  const started = Date.now()
  splitAssistantSegments(`${' '.repeat(50_000)}x`)
  splitAssistantSegments(`${'{\n'.repeat(5_000)}`)
  splitAssistantSegments(`TOOL RESULT: ${'['.repeat(20_000)}`)
  splitAssistantSegments('```json\n'.repeat(5_000))
  assert.ok(Date.now() - started < 1000)
})
