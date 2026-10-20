/**
 * Assistant backends that use the creator's own subscription instead of an
 * API key: the Claude Code CLI (`claude`, signed in with Claude Pro/Max) and
 * the Codex CLI (`codex`, signed in with ChatGPT). Drama Studio runs the CLI
 * once per Assistant turn, headless, as a plain text model:
 *   - every CLI tool is off (Claude: --tools ""; Codex: every feature that
 *     is on by default is switched off, and the run is stopped if Codex still
 *     tries a tool) and the user's own MCP servers, hooks, skills and memory
 *     are not loaded, so the CLI cannot touch files or the project;
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

// Codex has no "no tools" switch and every release adds features, so the
// lockdown is fail-closed: before a run, `codex features list` is read and
// every feature that is on by default is switched off, except the few below.
// If the list cannot be read, Codex does not run. Approvals never run, web
// search is off and the sandbox is read-only on top of that. The prompt is not
// relied on. (Values are bare TOML-literal strings, so they pass through the
// cmd.exe quoting of a .cmd shim.)
//
// Features that stay on. None of them gives the model anything to call:
const CODEX_ALLOWED_FEATURES = Object.freeze([
  'secret_auth_storage', // where the ChatGPT sign-in is kept (file or the OS keychain)
  'system_proxy_fallback', // reach OpenAI through the PC's proxy settings
  'enable_request_compression', // compress requests sent to OpenAI
  'unbounded_connection_retries', // retry dropped connections; our own timeout still ends the run
])
const CODEX_BASE_ARGS = Object.freeze([
  '-c', 'approval_policy=never',
  '-c', 'web_search=disabled',
])
const FEATURE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/
const FEATURE_LINE = /^(\S+)\s+(.+?)\s+(true|false)$/

/** Parse `codex features list`. Throws unless every line reads as name, stage, true/false. */
function parseCodexFeatures(text) {
  const failed = (detail) => new CliError(`Codex could not be locked down for the Assistant: ${detail}. The Assistant did not run. Update Codex or pick another Assistant backend.`, 'cli_lockdown')
  const features = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const match = FEATURE_LINE.exec(line)
    if (!match || !FEATURE_NAME.test(match[1])) throw failed('its feature list was not in the expected format')
    features.push({ name: match[1], stage: match[2], enabled: match[3] === 'true' })
  }
  if (!features.length) throw failed('it did not list its features')
  return features
}

/** `--disable` for every enabled feature that is not on the allowlist, then the fixed settings. */
function codexLockdownArgs(features) {
  const args = []
  for (const feature of features) {
    if (feature.enabled && !CODEX_ALLOWED_FEATURES.includes(feature.name)) args.push('--disable', feature.name)
  }
  return [...args, ...CODEX_BASE_ARGS]
}

// Lockdown arguments per Codex executable and version, for this app session.
const codexLockdownCache = new Map()

async function getCodexLockdown(executable, env, signal) {
  const failed = (detail) => new CliError(`Codex could not be locked down for the Assistant: ${detail}. The Assistant did not run. Update Codex or pick another Assistant backend.`, 'cli_lockdown')
  const scratch = makeWorkDir()
  try {
    // An empty CODEX_HOME shows the built-in defaults, which is what
    // `codex exec --ignore-user-config` runs with.
    const listEnv = { ...env, CODEX_HOME: scratch }
    const version = await run(executable, ['--version'], { cwd: scratch, env: listEnv, signal, timeoutMs: 30000 })
    const versionText = version.stdout.trim()
    if (version.code !== 0 || !versionText) throw failed('it did not report its version')
    const key = `${executable}\n${versionText}`
    if (codexLockdownCache.has(key)) return codexLockdownCache.get(key)
    const listed = await run(executable, ['features', 'list'], { cwd: scratch, env: listEnv, signal, timeoutMs: 30000 })
    if (listed.code !== 0) throw failed('its feature list could not be read')
    const args = Object.freeze(codexLockdownArgs(parseCodexFeatures(listed.stdout)))
    codexLockdownCache.set(key, args)
    return args
  } finally {
    removeWorkDir(scratch)
  }
}

/** Where Codex keeps its sign-in and settings. */
function codexHomeDir() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
}

/**
 * A private CODEX_HOME for one run holding only a copy of the sign-in file,
 * so the user's memories, hooks, skills, AGENTS.md, plugins and settings
 * cannot load. If Codex refreshes the sign-in during the run, the new tokens
 * are written back so the user's own Codex stays signed in. Returns null when
 * there is no sign-in file (for example, it is kept in the OS keychain); the
 * run then uses the normal CODEX_HOME with the rest of the lockdown.
 */
function prepareCodexHome() {
  const realHome = codexHomeDir()
  const realAuth = path.join(realHome, 'auth.json')
  let original
  try {
    if (!fs.statSync(realAuth).isFile()) return null
    original = fs.readFileSync(realAuth)
  } catch {
    return null
  }
  const home = makeWorkDir()
  const auth = path.join(home, 'auth.json')
  fs.writeFileSync(auth, original, { flag: 'wx', mode: 0o600 })
  const syncBack = () => {
    try {
      const after = fs.readFileSync(auth)
      if (!after.length || after.equals(original)) return
      // Only replace the user's file if nothing else changed it meanwhile.
      if (!fs.readFileSync(realAuth).equals(original)) return
      const temp = path.join(realHome, `.auth.json.drama-studio-${process.pid}-${Date.now()}`)
      fs.writeFileSync(temp, after, { flag: 'wx', mode: 0o600 })
      fs.renameSync(temp, realAuth)
    } catch { /* the user's own sign-in stays as it was */ }
  }
  return { home, syncBack }
}

// `codex exec --json` events. Any item other than text, reasoning, an error
// note or the plan checklist means Codex tried to act (run a command, read or
// change a file, call an MCP or other tool, search the web, view an image...),
// so the run is stopped. Unknown event shapes stop it too.
const CODEX_EVENT_TYPES = Object.freeze(['thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'item.started', 'item.updated', 'item.completed', 'error'])
const CODEX_TEXT_ITEMS = Object.freeze(['agent_message', 'reasoning', 'error', 'todo_list'])

function createCodexEventGuard() {
  let answer = ''
  let failure = ''
  const unexpected = () => new CliError('The Assistant stopped because Codex answered in a format Drama Studio does not recognise. Update Drama Studio or pick another Assistant backend.', 'cli_unexpected')
  return {
    /** One stdout line. Returns a CliError to stop the run, or null. */
    onLine(line) {
      const text = String(line || '').trim()
      if (!text) return null
      let event
      try { event = JSON.parse(text) } catch { return unexpected() }
      if (!event || typeof event !== 'object' || !CODEX_EVENT_TYPES.includes(event.type)) return unexpected()
      if (event.type.startsWith('item.')) {
        const item = event.item
        if (!item || typeof item !== 'object') return unexpected()
        if (!CODEX_TEXT_ITEMS.includes(item.type)) {
          const kind = typeof item.type === 'string' && FEATURE_NAME.test(item.type) ? ` (${item.type.replace(/_/g, ' ')})` : ''
          return new CliError(`The Assistant stopped because Codex tried to use a tool${kind}. In Drama Studio the Assistant may only answer in text; nothing was changed.`, 'cli_tool_blocked')
        }
        if (event.type === 'item.completed' && item.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) answer = item.text.trim()
      } else if (event.type === 'turn.failed') {
        failure = String(event.error?.message || 'the turn failed')
      } else if (event.type === 'error') {
        failure = String(event.message || 'error')
      }
      return null
    },
    get answer() { return answer },
    get failure() { return failure },
  }
}

/**
 * Run the CLI once. `onLine` sees each stdout line as it arrives; when it
 * returns an error the CLI is stopped at once and the run fails with it.
 */
function run(executable, args, { input, cwd, env, signal, timeoutMs = CLI_TIMEOUT_MS, onLine = null }) {
  return new Promise((resolve, reject) => {
    const isShim = /\.(cmd|bat)$/i.test(executable)
    const child = isShim
      // `/s /c` strips one pair of quotes around the whole line, so it is wrapped once more.
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[quoteForCmd(executable), ...args.map(quoteForCmd)].join(' ')}"`], { cwd, env, windowsHide: true, windowsVerbatimArguments: true })
      : spawn(executable, args, { cwd, env, windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    let stopping = null
    let grace = null
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(grace)
      signal?.removeEventListener?.('abort', onAbort)
      fn(value)
    }
    // On Windows the whole tree goes: a .cmd shim's cmd.exe, the CLI under
    // it and anything the CLI started.
    const kill = () => {
      if (process.platform === 'win32' && child.pid) {
        execFile('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
        return
      }
      try { child.kill() } catch { /* already gone */ }
    }
    // Kill the CLI and fail once it has exited (so its folders can be
    // removed), or after a few seconds if it does not.
    const stop = (error) => {
      if (settled || stopping) return
      stopping = error
      kill()
      grace = setTimeout(() => finish(reject, error), 5000)
    }
    const timer = setTimeout(() => stop(new CliError('The model took too long to answer.', 'timeout')), timeoutMs)
    const onAbort = () => stop(new CliError('Request cancelled.', 'cancelled'))
    if (signal?.aborted) onAbort()
    else signal?.addEventListener?.('abort', onAbort)
    child.stdout.setEncoding('utf8') // a character split across chunks stays whole
    child.stderr.setEncoding('utf8')
    let pending = ''
    const feed = (line) => {
      if (settled || stopping) return
      const error = onLine(line)
      if (error) stop(error)
    }
    child.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk
      if (!onLine || settled || stopping) return
      pending += chunk
      let at
      while (!stopping && (at = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, at)
        pending = pending.slice(at + 1)
        feed(line)
      }
      if (pending.length > MAX_OUTPUT_BYTES) stop(new CliError('The command-line tool sent too much output.', 'cli_failed'))
    })
    child.stderr.on('data', (chunk) => { if (stderr.length < 65536) stderr += chunk })
    child.on('error', (error) => finish(reject, stopping || new CliError(`Could not start the command-line tool: ${error.message}`, 'cli_start')))
    child.on('close', (code) => {
      if (onLine && pending) feed(pending)
      if (stopping) finish(reject, stopping)
      else finish(resolve, { code, stdout, stderr })
    })
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
  if (model && model !== 'default' && !SAFE_MODEL.test(model)) throw new CliError('That model name is not valid.', 'bad_model')
  const baseEnv = childEnv(cli)
  const lockdown = await getCodexLockdown(executable, baseEnv, signal)
  const cwd = makeWorkDir()
  const codexHome = prepareCodexHome()
  const env = codexHome ? { ...baseEnv, CODEX_HOME: codexHome.home } : baseEnv
  const args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules', '-s', 'read-only', ...lockdown, '-C', cwd]
  if (model && model !== 'default') args.push('-m', model)
  args.push('-')
  const input = `${String(system || '').trim()}\n\nDo not run shell commands or read files. Answer in text only.\n\n${buildTranscript(messages)}`
  const guard = createCodexEventGuard()
  try {
    const output = await run(executable, args, { input, cwd, env, signal, onLine: (line) => guard.onLine(line) })
    if (output.code !== 0 || guard.failure || !guard.answer) throw explainFailure(cli, { stdout: guard.failure, stderr: output.stderr })
    return { text: guard.answer, model: model || 'default' }
  } finally {
    if (codexHome) {
      codexHome.syncBack()
      // Holds a copy of the sign-in, so it goes now rather than in the background.
      try { fs.rmSync(codexHome.home, { recursive: true, force: true, maxRetries: 3 }) } catch { removeWorkDir(codexHome.home) }
    }
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

module.exports = {
  CLIS, CODEX_ALLOWED_FEATURES, CliError, resolveCli, runClaude, runCodex, checkCli, buildTranscript, quoteForCmd,
  parseCodexFeatures, codexLockdownArgs, createCodexEventGuard,
  // Tests point a CLI at a fake executable.
  _setCliPathForTests: (id, file) => resolved.set(id, file),
}
