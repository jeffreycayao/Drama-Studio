/**
 * Assistant backends that use the creator's own subscription instead of an
 * API key: the Claude Code CLI (`claude`, signed in with Claude Pro/Max) and
 * the Codex CLI (`codex`, signed in with ChatGPT). Drama Studio runs the CLI
 * once per Assistant turn, headless, as a plain text model:
 *   - every CLI tool is off (Claude: --tools ""; Codex: read-only sandbox in
 *     an empty folder) and the user's own MCP servers, hooks and project
 *     memory are not loaded, so the CLI cannot touch files or the project;
 *   - edits still go through the Assistant's text tool blocks, which Drama
 *     Studio previews and only applies after the user clicks Apply.
 * API-key variables are removed from the child's environment so the CLI
 * uses the subscription sign-in. Arguments are fixed or validated; the
 * conversation goes in on stdin, never on the command line.
 */
const { spawn, execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const CLI_TIMEOUT_MS = 240000
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/

const CLIS = Object.freeze({
  claude: {
    command: 'claude',
    label: 'Claude Code',
    fallbacks: () => [
      path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'),
      ...(process.platform === 'win32' ? [path.join(process.env.APPDATA || '', 'npm', 'claude.cmd')] : ['/usr/local/bin/claude', '/opt/homebrew/bin/claude']),
    ],
    install: 'Install Claude Code (claude.com/claude-code), run "claude" once in a terminal and sign in with your Claude account.',
    // Keys that would make the CLI bill an API account instead of the subscription.
    stripEnv: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
  },
  codex: {
    command: 'codex',
    label: 'Codex',
    fallbacks: () => [
      ...(process.platform === 'win32'
        ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'), path.join(process.env.APPDATA || '', 'npm', 'codex.cmd')]
        : ['/usr/local/bin/codex', '/opt/homebrew/bin/codex', path.join(os.homedir(), '.local', 'bin', 'codex')]),
    ],
    install: 'Install the Codex CLI (developers.openai.com/codex), run "codex" once in a terminal and sign in with ChatGPT.',
    stripEnv: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
  },
})

class CliError extends Error {
  constructor(message, code = 'error') {
    super(message)
    this.code = code
  }
}

const resolved = new Map()

function whichAll(command) {
  return new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'where.exe' : 'which'
    const args = process.platform === 'win32' ? [command] : ['-a', command]
    execFile(finder, args, { windowsHide: true, timeout: 8000 }, (error, stdout) => {
      if (error) return resolve([])
      resolve(String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
    })
  })
}

/** Full path to the CLI, preferring a real executable over a .cmd shim. */
async function resolveCli(id) {
  const cli = CLIS[id]
  if (!cli) throw new CliError('Unknown command-line tool.', 'unknown_cli')
  if (resolved.has(id) && fs.existsSync(resolved.get(id))) return resolved.get(id)
  const found = [...await whichAll(cli.command), ...cli.fallbacks()].filter((candidate) => {
    try { return fs.statSync(candidate).isFile() } catch { return false }
  })
  const pick = found.find((candidate) => /\.exe$/i.test(candidate))
    || found.find((candidate) => /\.(cmd|bat)$/i.test(candidate))
    || (process.platform === 'win32' ? null : found[0])
  if (!pick) throw new CliError(`${cli.label} is not installed on this PC. ${cli.install}`, 'cli_missing')
  resolved.set(id, pick)
  return pick
}

/** cmd.exe quoting for a .cmd shim; our arguments never contain quotes. */
function quoteForCmd(value) {
  const text = String(value)
  if (/["%^&|<>]/.test(text)) throw new CliError('Unsafe argument for the command-line tool.', 'unsafe_arg')
  return /[\s()]/.test(text) || text === '' ? `"${text}"` : text
}

function childEnv(cli) {
  const env = { ...process.env, NO_COLOR: '1' }
  for (const key of cli.stripEnv) delete env[key]
  return env
}

/**
 * A fresh, private, empty working folder for one run (0700 on macOS and
 * Linux), so no project memory or rules are picked up and nothing else can
 * plant files in it. It sits in the system temp folder, away from Drama
 * Studio's settings (where API keys are stored), and is deleted afterwards.
 */
function makeWorkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drama-studio-cli-'))
}

function removeWorkDir(dir) {
  fs.rm(dir, { recursive: true, force: true }, () => {})
}

// Codex has no "no tools" switch, so every tool feature is turned off by
// config, approvals never run, web search is off, and the sandbox is
// read-only. The prompt is not relied on.
const CODEX_DISABLED_FEATURES = Object.freeze([
  'shell_tool', 'unified_exec', 'apps', 'plugins', 'browser_use', 'browser_use_external', 'in_app_browser',
  'computer_use', 'image_generation', 'code_mode_host', 'tool_suggest', 'skill_search', 'sleep_tool',
])
const CODEX_LOCKDOWN_ARGS = Object.freeze([
  ...CODEX_DISABLED_FEATURES.flatMap((feature) => ['--disable', feature]),
  '-c', 'approval_policy="never"',
  '-c', 'web_search="disabled"',
])

function run(executable, args, { input, cwd, env, signal, timeoutMs = CLI_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const isShim = /\.(cmd|bat)$/i.test(executable)
    const child = isShim
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [quoteForCmd(executable), ...args.map(quoteForCmd)].join(' ')], { cwd, env, windowsHide: true, windowsVerbatimArguments: true })
      : spawn(executable, args, { cwd, env, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      fn(value)
    }
    const kill = () => { try { child.kill() } catch { /* already gone */ } }
    const timer = setTimeout(() => { kill(); finish(reject, new CliError('The model took too long to answer.', 'timeout')) }, timeoutMs)
    const onAbort = () => { kill(); finish(reject, new CliError('Request cancelled.', 'cancelled')) }
    if (signal?.aborted) return onAbort()
    signal?.addEventListener?.('abort', onAbort)
    child.stdout.on('data', (chunk) => { if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk })
    child.stderr.on('data', (chunk) => { if (stderr.length < 65536) stderr += chunk })
    child.on('error', (error) => finish(reject, new CliError(`Could not start the command-line tool: ${error.message}`, 'cli_start')))
    child.on('close', (code) => finish(resolve, { code, stdout, stderr }))
    child.stdin.on('error', () => { /* the CLI may exit before reading everything */ })
    child.stdin.end(input || '')
  })
}

/** The neutral chat history as one transcript the CLI answers in a single turn. */
function buildTranscript(messages = []) {
  const lines = []
  for (const message of messages) {
    const text = String(message?.content || '').trim()
    if (!text) continue
    lines.push(`${message.role === 'assistant' ? 'ASSISTANT' : 'USER'}:\n${text}`)
  }
  lines.push('Reply as the ASSISTANT to the last USER message. Use the Drama Studio tool blocks described in your instructions when a tool is needed.')
  return lines.join('\n\n')
}

function explainFailure(cli, output) {
  const text = `${output.stdout}\n${output.stderr}`
  if (/not logged in|please log ?in|\/login|authenticat|unauthori[sz]ed|sign ?in/i.test(text)) {
    return new CliError(`${cli.label} is not signed in. Run "${cli.command}" once in a terminal and sign in, then try again.`, 'cli_login')
  }
  if (/usage limit|rate limit|limit reached|quota/i.test(text)) {
    return new CliError(`Your ${cli.label} plan limit is reached for now. Try again later or pick another Assistant backend.`, 'cli_limit')
  }
  const detail = text.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ').slice(0, 400)
  return new CliError(`${cli.label} did not answer${detail ? `: ${detail}` : '.'}`, 'cli_failed')
}

async function runClaude({ model, system, messages, baseDir, signal }) {
  const cli = CLIS.claude
  const executable = await resolveCli('claude')
  const cwd = makeWorkDir()
  const systemFile = path.join(cwd, 'system.txt')
  fs.writeFileSync(systemFile, String(system || ''), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  const args = ['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--system-prompt-file', systemFile]
  if (model && model !== 'default') {
    if (!SAFE_MODEL.test(model)) throw new CliError('That model name is not valid.', 'bad_model')
    args.push('--model', model)
  }
  try {
    const output = await run(executable, args, { input: buildTranscript(messages), cwd, env: childEnv(cli), signal })
    let data = null
    try { data = JSON.parse(output.stdout.trim().split(/\r?\n/).filter(Boolean).pop() || '') } catch { data = null }
    if (!data || data.is_error || output.code !== 0) {
      if (data?.result && /log ?in|limit/i.test(String(data.result))) throw explainFailure(cli, { stdout: String(data.result), stderr: output.stderr })
      throw explainFailure(cli, output)
    }
    return { text: String(data.result || '').trim(), model: Object.keys(data.modelUsage || {})[0] || model || 'default' }
  } finally {
    removeWorkDir(cwd)
  }
}

async function runCodex({ model, system, messages, baseDir, signal }) {
  const cli = CLIS.codex
  const executable = await resolveCli('codex')
  const cwd = makeWorkDir()
  const outFile = path.join(cwd, 'reply.txt')
  const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules', '-s', 'read-only', ...CODEX_LOCKDOWN_ARGS, '-C', cwd, '-o', outFile]
  if (model && model !== 'default') {
    if (!SAFE_MODEL.test(model)) throw new CliError('That model name is not valid.', 'bad_model')
    args.push('-m', model)
  }
  args.push('-')
  const input = `${String(system || '').trim()}\n\nDo not run shell commands or read files. Answer in text only.\n\n${buildTranscript(messages)}`
  try {
    const output = await run(executable, args, { input, cwd, env: childEnv(cli), signal })
    let text = ''
    try { text = fs.readFileSync(outFile, 'utf8').trim() } catch { text = '' }
    if (output.code !== 0 || !text) throw explainFailure(cli, output)
    return { text, model: model || 'default' }
  } finally {
    removeWorkDir(cwd)
  }
}

/** Is the CLI installed, and does it answer? (Signs-in show up as a failure message.) */
async function checkCli(id, options = {}) {
  const started = Date.now()
  const runner = id === 'codex' ? runCodex : runClaude
  try {
    const reply = await runner({ ...options, system: 'You are a connection test. Reply with the single word OK.', messages: [{ role: 'user', content: 'Reply with OK.' }] })
    return { ok: true, latencyMs: Date.now() - started, message: `${CLIS[id].label} answered (${Math.round((Date.now() - started) / 1000)} s). Your subscription is used; no API key needed.`, reply: reply.text.slice(0, 40) }
  } catch (error) {
    return { ok: false, code: error.code || 'error', message: error.message || String(error) }
  }
}

module.exports = { CLIS, CODEX_LOCKDOWN_ARGS, CliError, resolveCli, runClaude, runCodex, checkCli, buildTranscript, quoteForCmd }
