const test = require('node:test')
const assert = require('node:assert/strict')
const { buildTranscript, quoteForCmd } = require('../electron/subscriptionCli.cjs')
const { createLlmGateway } = require('../electron/llmGateway')

test('the conversation goes to the CLI as one transcript ending on the user turn', () => {
  const text = buildTranscript([
    { role: 'user', content: 'Tighten the pauses' },
    { role: 'assistant', content: 'Previewed it.' },
    { role: 'user', content: 'Drama Studio tool result for get_timeline:\n{}' },
    { role: 'assistant', content: '' },
  ])
  assert.match(text, /^USER:\nTighten the pauses/)
  assert.match(text, /ASSISTANT:\nPreviewed it\./)
  assert.ok(!/ASSISTANT:\n\n/.test(text), 'empty turns are skipped')
  assert.match(text, /Reply as the ASSISTANT to the last USER message/)
})

test('cmd shim arguments are quoted and unsafe ones refused', () => {
  assert.equal(quoteForCmd('-p'), '-p')
  assert.equal(quoteForCmd('C:/Users/me/AppData/Roaming/Drama Studio/x.txt'), '"C:/Users/me/AppData/Roaming/Drama Studio/x.txt"')
  assert.equal(quoteForCmd(''), '""')
  assert.throws(() => quoteForCmd('a&calc'))
  assert.throws(() => quoteForCmd('say "hi"'))
})

test('subscription backends run the CLI, with no tools and no API key', async () => {
  const calls = []
  const fakeCli = {
    runClaude: async (options) => { calls.push(['claude', options]); return { text: 'Hello from Claude', model: 'claude-opus-5-5' } },
    runCodex: async (options) => { calls.push(['codex', options]); return { text: 'Hello from Codex', model: 'default' } },
    checkCli: async (id) => ({ ok: true, message: `${id} ok` }),
  }
  const gateway = createLlmGateway({ cliRunner: fakeCli, cliBaseDir: 'C:/tmp', getApiKey: async () => { throw new Error('no key lookup for subscriptions') } })
  const claude = await gateway.chat({ provider: 'claude-cli', system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'x' }] })
  assert.equal(claude.text, 'Hello from Claude')
  assert.deepEqual(claude.toolCalls, [])
  const codex = await gateway.chat({ provider: 'codex-cli', model: 'default', messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(codex.text, 'Hello from Codex')
  assert.equal(calls[0][1].baseDir, 'C:/tmp')
  assert.equal(calls[0][1].system, 'sys')
  const check = await gateway.testConnection({ provider: 'codex-cli' })
  assert.equal(check.ok, true)
  const described = gateway.describeProviders().find((p) => p.id === 'claude-cli')
  assert.equal(described.keyRequired, false)
  assert.equal(described.textTools, true)
})

test('CLI failures come back as readable gateway errors', async () => {
  const error = Object.assign(new Error('Claude Code is not signed in.'), { code: 'cli_login' })
  const gateway = createLlmGateway({ cliRunner: { runClaude: async () => { throw error }, runCodex: async () => ({}), checkCli: async () => ({}) } })
  await assert.rejects(() => gateway.chat({ provider: 'claude-cli', messages: [] }), (thrown) => thrown.code === 'cli_login' && /signed in/.test(thrown.message))
})
