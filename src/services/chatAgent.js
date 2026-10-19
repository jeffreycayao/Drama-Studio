/**
 * Chat panel agent loop.
 *
 * Sends the conversation to the selected LLM backend with a curated subset of
 * Drama Studio's MCP tools, runs tool calls through the same MCP tool layer
 * external agents use, and gates every write:
 *   - tools that support previewOnly are ALWAYS run as a preview first;
 *   - the panel shows the plan with Apply / Cancel;
 *   - Apply runs the tool with previewOnly:false (existing undo/checkpoint
 *     store paths), after which Undo is offered.
 * The model is never allowed to apply a write on its own.
 *
 * React-free: dependencies (chat, listTools, callTool) are injected.
 */

import agentGuardrails from '../../electron/agentGuardrails.json' with { type: 'json' }

// Drama Studio's own rules for every agent (electron/agentGuardrails.json),
// injected on every request ahead of everything else, with a reminder after
// the project context so text from the project cannot talk the model out of them.
export const AGENT_GUARDRAILS = agentGuardrails.rules
export const AGENT_GUARDRAILS_REMINDER = agentGuardrails.reminder

export const AGENT_SYSTEM_PROMPT = `You are Drama Studio Agent, the AI assistant built into Drama Studio, a desktop video editor.

You help the user inspect and edit the open project using the Drama Studio tools provided. Speak like a friendly creative assistant, not a developer console. Keep answers short (1-3 sentences) unless asked for detail, and put the direct answer first.

How edits work:
- Read before you write. Use get_timeline, find_timeline_items or analyze_timeline to resolve clips and tracks before editing. If a target is ambiguous (for example "Track 1" could be Video 1 or Audio 1), pick the obvious one for the request (dialogue lives on audio tracks) or ask.
- Any tool that changes the project runs as a preview first. Drama Studio then shows the user Apply and Cancel buttons. Nothing changes until the user clicks Apply. Never call a tool again with previewOnly false to apply it yourself.
- After a preview, tell the user in one or two sentences what will change and that they can Apply it. Then stop.
- Generation can spend credits or GPU time; mention that when you preview it.
- For multi-shot requests (a teaser, trailer, or N beats), plan one prompt per beat or shot in a single batch, and keep shot prompts consistent in characters and style.
- Never claim you changed or looked at something unless a tool result confirms it. Do not show raw JSON unless asked.`

// Curated tool sets keep small local models focused (and their context small).
export const CORE_TOOL_NAMES = [
  'get_project', 'get_timeline', 'find_timeline_items', 'analyze_timeline', 'inspect_clip', 'get_assets',
  'tighten_track_gaps', 'move_clips', 'trim_clips', 'delete_clips', 'split_clip', 'set_clips_enabled',
  'set_clip_audio', 'set_track_mix_role', 'auto_duck_music', 'add_timeline_markers', 'add_text_clip', 'add_transition', 'undo', 'redo',
  'create_project_checkpoint', 'get_music_video_plan', 'update_music_video_shot',
  'regenerate_music_video_keyframe', 'queue_prompt_generation_batch', 'get_generation_queue_status',
  'export_subtitles', 'translate_captions', 'search_help', 'list_prompts', 'use_prompt', 'save_prompt',
]

export const EXTENDED_TOOL_NAMES = [
  ...CORE_TOOL_NAMES,
  'get_mcp_recipes', 'check_media_health', 'inspect_timeline_frame', 'inspect_timeline_range', 'extract_range',
  'set_clip_speed', 'add_track', 'update_track', 'create_timeline', 'switch_timeline', 'add_asset_to_timeline',
  'add_assets_to_timeline', 'replace_clip_with_asset', 'update_text_clip', 'add_dip_to_black', 'set_clip_keyframes',
  'list_glsl_effects', 'add_glsl_effect', 'remove_timeline_markers', 'get_music_video_session',
  'get_music_video_status', 'set_music_video_director_script', 'regenerate_music_video_video',
  'prepare_generation_from_timeline_context', 'queue_prepared_generation', 'queue_timeline_generation_batch',
  'run_mcp_action_plan', 'restore_project_checkpoint', 'transcribe_captions', 'generate_captions', 'export_timeline',
  'conform_draft_clips', 'get_caption_translation', 'set_caption_language',
]

const PREVIEW_NOTE = '[Drama Studio] This is a preview only; nothing has changed yet. The user now sees Apply / Cancel buttons for it. Do not call this tool again to apply it.'

export function selectChatTools(allTools = [], { local = true } = {}) {
  const wanted = local ? CORE_TOOL_NAMES : EXTENDED_TOOL_NAMES
  const byName = new Map((allTools || []).map((tool) => [tool.name, tool]))
  return wanted.filter((name) => byName.has(name)).map((name) => {
    const tool = byName.get(name)
    const description = String(tool.description || '')
    return {
      name,
      description: local && description.length > 420 ? `${description.slice(0, 417)}...` : description,
      parameters: tool.inputSchema || { type: 'object', properties: {} },
      gated: Boolean(tool.inputSchema?.properties?.previewOnly),
    }
  })
}

export function readToolResult(result) {
  const parts = Array.isArray(result?.content) ? result.content : []
  const text = parts.filter((part) => part?.type === 'text').map((part) => part.text).join('\n')
  const omittedImages = parts.filter((part) => part?.type === 'image').length
  let data = null
  try { data = JSON.parse(text) } catch { data = null }
  return { text, data, isError: result?.isError === true, omittedImages }
}

function isPreviewResult(data) {
  return Boolean(data && (data.previewOnly === true || data.result?.previewOnly === true))
}

function previewFailed(data) {
  return Boolean(data && (data.success === false || data.result?.success === false))
}

function nothingToChange(data) {
  return Boolean(data && (data.changed === false || data.result?.changed === false))
}

function truncate(text, limit) {
  const value = String(text || '')
  return value.length > limit ? `${value.slice(0, limit)}\n... [truncated ${value.length - limit} chars]` : value
}

export function summarizeToolOutcome(name, read) {
  const data = read.data
  const message = data?.message || data?.result?.message
  if (read.isError) return `${name} failed: ${truncate(read.text, 240)}`
  if (message) return String(message)
  if (data?.summary && typeof data.summary === 'string') return data.summary
  if (isPreviewResult(data)) return `Preview ready for ${name}.`
  return `Ran ${name}.`
}

/** Strip UI-only fields; produce the provider-neutral history. */
export function toNeutralHistory(messages = [], { textMode = false, limit = 40 } = {}) {
  const usable = messages.filter((message) => ['user', 'assistant', 'tool', 'note'].includes(message.role))
  let slice = usable.slice(-limit)
  // Never start mid tool-exchange.
  while (slice.length && slice[0].role !== 'user') slice = slice.slice(1)
  const out = []
  for (const message of slice) {
    if (message.role === 'note') {
      out.push({ role: 'user', content: message.content })
    } else if (message.role === 'tool') {
      if (textMode) out.push({ role: 'user', content: `Drama Studio tool result for ${message.name}:\n${message.content}` })
      else out.push({ role: 'tool', toolCallId: message.toolCallId, name: message.name, content: message.content, isError: message.isError })
    } else if (message.role === 'assistant') {
      if (textMode) {
        const calls = (message.toolCalls || []).map((call) => `\`\`\`drama-studio-tool\n${JSON.stringify({ tool: call.name, arguments: call.arguments || {} })}\n\`\`\``)
        const content = [message.content, ...calls].filter(Boolean).join('\n')
        if (content) out.push({ role: 'assistant', content })
      } else {
        out.push({ role: 'assistant', content: message.content || '', toolCalls: message.toolCalls || [],
          raw: message.raw, rawProvider: message.rawProvider, rawModel: message.rawModel })
      }
    } else {
      out.push({ role: 'user', content: message.content })
    }
  }
  return out
}

export function parseTextToolCalls(text) {
  const calls = []
  const pattern = /```(?:drama-studio-tool|drama_studio_tool|tool|json)\s*([\s\S]*?)```/gi
  let match
  while ((match = pattern.exec(text || '')) !== null) {
    let parsed = null
    try { parsed = JSON.parse(match[1].trim()) } catch { parsed = null }
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      const name = item?.tool || item?.name
      if (name) calls.push({ id: `text_${Date.now()}_${calls.length}`, name, arguments: item.arguments || item.args || {} })
    }
  }
  return calls
}

export function cleanAssistantText(text) {
  return String(text || '')
    .replace(/```(?:drama-studio-tool|drama_studio_tool)\s*[\s\S]*?```/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Models (local ones especially) sometimes echo raw tool output into their
// reply: "TOOL RESULT: { ... }", a ```json fence, or a bare JSON object.
// splitAssistantSegments separates that from the prose so the panel can fold
// it behind a "details" toggle. The stored message text is left untouched.
const RAW_LABEL_PATTERN = /^\s*[*_#>\s]*(?:\[?\s*)?(?:drama[\s_-]*studio\s+)?tool[\s_-]*(?:call\s+)?(?:result|output|response)s?\b[^\n]*$/i
const FENCE_PATTERN = /^\s*```\s*([\w-]*)\s*$/

function looksLikeJson(text) {
  const value = String(text || '').trim()
  if (!/^[[{]/.test(value)) return false
  try { JSON.parse(value); return true } catch { return value.length > 80 && /"\s*:/.test(value) }
}

// From (lineIndex, column), find the line where the bracket opened there closes.
function findJsonEnd(lines, lineIndex, column) {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = lineIndex; i < lines.length; i += 1) {
    const line = lines[i]
    for (let j = i === lineIndex ? column : 0; j < line.length; j += 1) {
      const ch = line[j]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{' || ch === '[') depth += 1
      else if (ch === '}' || ch === ']') {
        depth -= 1
        if (depth <= 0) return i
      }
    }
  }
  return lines.length - 1
}

function rawLabelFor(line) {
  const name = String(line || '').match(/\bfor\s+`?([a-z][a-z0-9_]*)`?/i)?.[1]
    || String(line || '').match(/\(([a-z][a-z0-9_]*)\)/i)?.[1]
  return name ? `Tool output · ${name}` : 'Tool output'
}

export function splitAssistantSegments(text) {
  const lines = String(text || '').split('\n')
  const segments = []
  const pushText = (chunk) => {
    if (!chunk.length) return
    const last = segments[segments.length - 1]
    if (last?.type === 'text') last.text += `\n${chunk.join('\n')}`
    else segments.push({ type: 'text', text: chunk.join('\n') })
  }
  let prose = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = line.match(FENCE_PATTERN)
    if (fence) {
      let end = i + 1
      while (end < lines.length && !/^\s*```\s*$/.test(lines[end])) end += 1
      const body = lines.slice(i + 1, end).join('\n')
      if (/^(json|tool|drama[-_]studio[-_]tool)?$/i.test(fence[1]) && looksLikeJson(body)) {
        pushText(prose); prose = []
        segments.push({ type: 'raw', label: 'Tool output', text: body.trim() })
        i = end + 1
        continue
      }
    }
    if (RAW_LABEL_PATTERN.test(line)) {
      pushText(prose); prose = []
      const bracket = line.search(/[[{]/)
      let end = i
      if (bracket >= 0) {
        end = findJsonEnd(lines, i, bracket)
      } else {
        let next = i + 1
        while (next < lines.length && !lines[next].trim()) next += 1
        const nextLine = lines[next] || ''
        if (/^\s*```/.test(nextLine)) {
          end = next + 1
          while (end < lines.length && !/^\s*```\s*$/.test(lines[end])) end += 1
        } else if (/^\s*[[{]/.test(nextLine)) {
          end = findJsonEnd(lines, next, nextLine.search(/[[{]/))
        } else {
          end = next - 1
          while (end + 1 < lines.length && lines[end + 1].trim()) end += 1
        }
      }
      end = Math.min(Math.max(end, i), lines.length - 1)
      const body = [bracket >= 0 ? line.slice(bracket) : '', ...lines.slice(i + 1, end + 1)].join('\n')
        .replace(/^\s*```\w*\s*$/gm, '')
        .trim()
      segments.push({ type: 'raw', label: rawLabelFor(line), text: body || line.trim() })
      i = end + 1
      continue
    }
    if (/^\s*[[{]\s*$|^\s*\{\s*"/.test(line)) {
      const end = findJsonEnd(lines, i, line.search(/[[{]/))
      const body = lines.slice(i, end + 1).join('\n')
      if (end > i && looksLikeJson(body)) {
        pushText(prose); prose = []
        segments.push({ type: 'raw', label: 'Tool output', text: body.trim() })
        i = end + 1
        continue
      }
    }
    prose.push(line)
    i += 1
  }
  pushText(prose)
  return segments
    .map((segment) => (segment.type === 'text' ? { ...segment, text: segment.text.replace(/\n{3,}/g, '\n\n').trim() } : segment))
    .filter((segment) => segment.text)
}

function textModeInstructions(tools) {
  const lines = tools.map((tool) => {
    const props = Object.keys(tool.parameters?.properties || {}).filter((key) => key !== 'previewOnly')
    return `- ${tool.name}: ${String(tool.description || '').slice(0, 160)}${props.length ? ` Arguments: ${props.slice(0, 8).join(', ')}.` : ''}`
  })
  return `To use a Drama Studio tool, reply with a fenced block exactly like:\n\`\`\`drama-studio-tool\n{"tool":"get_project","arguments":{}}\n\`\`\`\nAvailable tools:\n${lines.join('\n')}`
}

export function buildProjectContext(snapshot) {
  if (!snapshot?.project) return 'No project is open.'
  const timeline = snapshot.currentTimeline
  if (!timeline) return `Project "${snapshot.project.name || 'Untitled'}" is open with no active timeline.`
  const clips = Array.isArray(timeline.clips) ? timeline.clips : []
  const tracks = (timeline.tracks || []).slice(0, 24).map((track) => {
    const count = clips.filter((clip) => clip.trackId === track.id).length
    return `${track.name || track.id} (id ${track.id}, ${track.type}, ${count} clip${count === 1 ? '' : 's'}${track.locked ? ', locked' : ''})`
  })
  return [
    `Open project: "${snapshot.project.name || 'Untitled'}". Active timeline: "${timeline.name || 'Untitled'}", ${Number(timeline.duration || 0).toFixed(1)}s at ${timeline.fps || 24} fps.`,
    tracks.length ? `Tracks (top to bottom): ${tracks.join('; ')}.` : 'The timeline has no tracks.',
  ].join('\n')
}

let messageCounter = 0
export function makeChatMessage(role, content, extra = {}) {
  messageCounter += 1
  return { id: `${Date.now().toString(36)}-${messageCounter}`, role, content: String(content ?? ''), createdAt: new Date().toISOString(), ...extra }
}

/**
 * Run one user turn. Emits each new message via onMessage(message) and
 * returns { messages, textMode }.
 * deps: { chat(options) -> {ok,text,toolCalls,...}, listTools(), callTool(name,args), getProjectContext?() }
 */
export async function runChatTurn({ history, target, deps, onMessage = () => {}, onStatus = () => {}, textMode = false, maxSteps = 8, requestIdPrefix = 'chat' }) {
  const allTools = await deps.listTools()
  const tools = selectChatTools(allTools, { local: target.local })
  const gatedNames = new Set(tools.filter((tool) => tool.gated).map((tool) => tool.name))
  const allowedNames = new Set(tools.map((tool) => tool.name))
  const resultLimit = target.local ? 6000 : 16000
  const messages = [...history]
  const emit = (message) => { messages.push(message); onMessage(message); return message }
  let mode = textMode

  for (let step = 0; step < maxSteps; step += 1) {
    const context = deps.getProjectContext ? deps.getProjectContext() : ''
    const system = [AGENT_GUARDRAILS, AGENT_SYSTEM_PROMPT, context ? `Current state:\n${context}` : '', mode ? textModeInstructions(tools) : '', AGENT_GUARDRAILS_REMINDER].filter(Boolean).join('\n\n')
    onStatus(step === 0 ? 'thinking' : 'working')
    const request = {
      provider: target.provider,
      baseUrl: target.baseUrl,
      model: target.model,
      system,
      messages: toNeutralHistory(messages, { textMode: mode }),
      tools: mode ? [] : tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
      requestId: `${requestIdPrefix}-${step}`,
    }
    let response = await deps.chat(request)
    if (!response?.ok && response?.code === 'tools_unsupported' && !mode) {
      mode = true
      emit(makeChatMessage('notice', `${target.model || 'This model'} does not support native tool calls, so Drama Studio switched to text tool mode. A tool-capable model (for example Qwen 3 or Llama 3.1+) works better.`))
      step -= 1
      continue
    }
    if (!response?.ok) {
      const error = new Error(response?.message || 'The model did not answer.')
      error.code = response?.code
      throw error
    }

    let toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : []
    if (mode && !toolCalls.length) toolCalls = parseTextToolCalls(response.text)
    const visible = cleanAssistantText(response.text)
    emit(makeChatMessage('assistant', visible, {
      toolCalls,
      raw: response.raw,
      rawProvider: response.rawProvider,
      rawModel: response.rawModel,
      model: response.model,
    }))
    if (!toolCalls.length) break

    for (const call of toolCalls) {
      const name = String(call.name || '')
      const args = call.arguments && typeof call.arguments === 'object' && !call.arguments.__invalidJson ? call.arguments : {}
      if (call.arguments?.__invalidJson) {
        emit(makeChatMessage('tool', 'The tool arguments were not valid JSON. Try again with valid JSON.', { toolCallId: call.id, name, isError: true, summary: `${name}: invalid arguments` }))
        continue
      }
      if (!allowedNames.has(name)) {
        emit(makeChatMessage('tool', `Tool "${name}" is not available in the chat panel. Available: ${[...allowedNames].join(', ')}.`, { toolCallId: call.id, name, isError: true, summary: `Unknown tool ${name}` }))
        continue
      }
      onStatus(`running ${name}`)
      const gated = gatedNames.has(name)
      const callArgs = gated ? { ...args, previewOnly: true } : args
      let read
      try {
        read = readToolResult(await deps.callTool(name, callArgs))
      } catch (error) {
        read = { text: error?.message || String(error), data: null, isError: true, omittedImages: 0 }
      }
      const summary = summarizeToolOutcome(name, read)
      let content = truncate(read.text, resultLimit)
      if (read.omittedImages) content += `\n[${read.omittedImages} image(s) omitted]`
      const extra = { toolCallId: call.id, name, isError: read.isError, summary }
      if (gated && !read.isError && isPreviewResult(read.data) && !previewFailed(read.data) && !nothingToChange(read.data)) {
        const applyArgs = { ...(read.data?.suggestedApplyCall?.arguments || args), previewOnly: false }
        content = `${content}\n\n${PREVIEW_NOTE}`
        extra.approval = { status: 'pending', tool: name, args: applyArgs, summary }
      } else if (gated && !read.isError && !isPreviewResult(read.data) && !previewFailed(read.data)) {
        // A tool that ignored previewOnly and applied directly: offer Undo.
        extra.applied = true
      }
      emit(makeChatMessage('tool', content, extra))
    }
  }
  onStatus('')
  return { messages, textMode: mode }
}

/** Apply an approved preview. Returns { ok, summary, read }. */
export async function applyApproval(approval, deps) {
  const read = readToolResult(await deps.callTool(approval.tool, { ...approval.args, previewOnly: false }))
  const failed = read.isError || previewFailed(read.data)
  return { ok: !failed, summary: summarizeToolOutcome(approval.tool, read), read }
}

export async function undoLastChange(deps) {
  const read = readToolResult(await deps.callTool('undo', { previewOnly: false }))
  return { ok: !read.isError && !previewFailed(read.data), summary: summarizeToolOutcome('undo', read) }
}
