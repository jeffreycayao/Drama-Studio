import { useState } from 'react'
import { Check, ChevronDown, Clapperboard, Copy, Download, Film, Mic, ScanSearch, ShieldCheck, Sparkles, Wrench, FolderOpen } from 'lucide-react'

const AGENTS = {
  claude: {
    label: 'Claude Code',
    command: (url) => `claude mcp add --transport http drama-studio ${url}`,
    restart: 'Claude Code',
  },
  codex: {
    label: 'Codex',
    command: (url) => `codex mcp add drama-studio --url ${url}`,
    restart: 'Codex',
  },
}

/** One message the user pastes into the agent's chat; the agent does the setup. */
export function buildAgentSetupPrompt(agentId, mcpUrl) {
  const agent = AGENTS[agentId] || AGENTS.claude
  return [
    'You are going to help me edit video in Drama Studio, a desktop video editor running on this computer. It exposes a local MCP server.',
    '',
    'Setup (do this first):',
    `1. Run this command: ${agent.command(mcpUrl)}`,
    '   If it says a server named "drama-studio" already exists, that is fine; continue.',
    `2. New MCP servers load when ${agent.restart} starts. If you cannot see tools such as get_project or get_timeline yet, tell me to restart ${agent.restart} and paste this message again.`,
    '',
    'Once the drama-studio tools are available:',
    '3. Call get_project and get_mcp_recipes, then tell me in a few lines what is open and what you can do for me.',
    '',
    'Ground rules:',
    '- Follow the instructions the drama-studio server gives you. For how-to questions about Drama Studio, use search_help and answer from the Help Center.',
    '- Inspect before changing anything (get_timeline, inspect_clip, inspect_timeline_frame).',
    '- Before any edit, tell me the plan and wait for my OK. Before bigger changes, call create_project_checkpoint.',
    '- Keep every change undoable in Drama Studio. Never delete my files or projects.',
    '- Generation can use cloud credits: name the workflow and ask me before queueing jobs.',
  ].join('\n')
}

const CAPABILITIES = [
  {
    icon: Film,
    title: 'Edit the timeline',
    detail: 'Move, trim, split and delete clips, close gaps, add transitions, text, shapes, effects and keyframes, manage tracks, markers, clip speed and the audio mix, including auto-ducking music under dialogue.',
    example: 'Tighten all pauses between dialogue on Track 1.',
  },
  {
    icon: Sparkles,
    title: 'Generate with AI',
    detail: 'Queue image, video and music jobs from written prompts or from what is on the timeline, check their progress, regenerate shots and conform draft clips to final renders.',
    example: 'Generate a 5-shot teaser from the script in my assets.',
  },
  {
    icon: Mic,
    title: 'Captions and audio',
    detail: 'Transcribe dialogue, generate and edit caption cues, and analyze music for beats.',
    example: 'Add captions to the interview and fix the speaker names.',
  },
  {
    icon: FolderOpen,
    title: 'Projects and media',
    detail: 'Create, open and duplicate projects and timelines, import and organize assets, relink missing media, and search or import stock footage.',
    example: 'Move every unused asset into a folder called Archive.',
  },
  {
    icon: ScanSearch,
    title: 'Review',
    detail: 'Look at individual frames, clips and ranges, analyze the whole timeline, check media health and export readiness, and run AI review passes.',
    example: 'Review the edit and list shots that feel too long.',
  },
  {
    icon: Wrench,
    title: 'ComfyUI setup',
    detail: 'Diagnose and repair the ComfyUI connection, start or stop the launcher, read its logs, validate nodes and install workflows.',
    example: 'ComfyUI will not connect. Find out why and fix it.',
  },
  {
    icon: Download,
    title: 'Export',
    detail: 'Export the timeline, run batches of delivery formats, or hand off an FCPXML to Premiere or Resolve.',
    example: 'Export a 9:16 and a 16:9 version for social.',
  },
]

function useCopy() {
  const [copied, setCopied] = useState(null)
  const copy = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1800)
    } catch {
      setCopied(null)
    }
  }
  return [copied, copy]
}

export default function AgentConnectHelper({ mcpUrl, toolNames = [] }) {
  const [agentId, setAgentId] = useState('claude')
  const [showPrompt, setShowPrompt] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [copied, copy] = useCopy()
  const agent = AGENTS[agentId]
  const prompt = buildAgentSetupPrompt(agentId, mcpUrl)
  const command = agent.command(mcpUrl)

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-sf-accent/30 bg-sf-dark-900/60 px-3 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-sf-text-primary">
              <Clapperboard className="h-3.5 w-3.5 text-sf-accent" />
              Connect an AI agent in one paste
            </div>
            <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-sf-text-muted">
              Copy the setup prompt, paste it into the agent&apos;s chat, and approve the command it runs. The agent connects itself to this project and tells you what it can do.
            </p>
          </div>
          <div className="inline-flex rounded-md border border-sf-dark-600 bg-sf-dark-950 p-0.5" role="tablist" aria-label="Agent">
            {Object.entries(AGENTS).map(([id, item]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={agentId === id}
                onClick={() => setAgentId(id)}
                className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${agentId === id ? 'bg-sf-accent text-sf-accent-on' : 'text-sf-text-secondary hover:text-sf-text-primary'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <ol className="mt-3 grid gap-2 text-[11px] text-sf-text-secondary sm:grid-cols-3">
          <li className="rounded-md bg-sf-dark-800/70 px-2.5 py-2"><span className="font-mono text-sf-accent">1</span> Open {agent.label} in a terminal or your editor.</li>
          <li className="rounded-md bg-sf-dark-800/70 px-2.5 py-2"><span className="font-mono text-sf-accent">2</span> Paste the setup prompt and send it.</li>
          <li className="rounded-md bg-sf-dark-800/70 px-2.5 py-2"><span className="font-mono text-sf-accent">3</span> Approve the command. Restart {agent.restart} if it asks.</li>
        </ol>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { void copy('prompt', prompt) }}
            className="inline-flex items-center gap-1.5 rounded-md bg-sf-accent px-3 py-1.5 text-[11px] font-semibold text-sf-accent-on hover:bg-sf-accent-hover"
          >
            {copied === 'prompt' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied === 'prompt' ? 'Copied: paste it into the agent' : `Copy setup prompt for ${agent.label}`}
          </button>
          <button
            type="button"
            onClick={() => setShowPrompt((open) => !open)}
            className="inline-flex items-center gap-1 rounded-md border border-sf-dark-500 px-2.5 py-1.5 text-[11px] text-sf-text-secondary hover:text-sf-text-primary"
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${showPrompt ? 'rotate-180' : ''}`} />
            {showPrompt ? 'Hide prompt' : 'Preview prompt'}
          </button>
        </div>
        {showPrompt && (
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-black/30 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-sf-text-secondary">{prompt}</pre>
        )}

        <div className="mt-3 border-t border-sf-dark-700 pt-3">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-sf-text-muted">Or run the command yourself</div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-black/30 px-2 py-1.5 text-[11px] text-sf-text-secondary">{command}</code>
            <button
              type="button"
              onClick={() => { void copy('command', command) }}
              className="inline-flex flex-shrink-0 items-center gap-1 rounded bg-sf-dark-700 px-2 py-1.5 text-[11px] text-sf-text-secondary hover:bg-sf-dark-600"
            >
              <Copy className="h-3 w-3" />
              {copied === 'command' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <p className="mt-3 text-[10.5px] leading-relaxed text-sf-text-muted">
          Works with agents that can run commands on this computer: Claude Code, Codex, and MCP-capable editors such as Cursor. Chat websites (claude.ai, chatgpt.com) cannot reach a server on this computer, so a pasted prompt will not connect them.
        </p>
      </div>

      <div className="rounded-lg border border-sf-dark-700 bg-sf-dark-900/60 px-3 py-3">
        <div className="text-xs font-semibold text-sf-text-primary">What a connected agent can do</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {CAPABILITIES.map(({ icon: Icon, title, detail, example }) => (
            <div key={title} className="rounded-md border border-sf-dark-700 bg-sf-dark-950/50 px-2.5 py-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-sf-text-primary"><Icon className="h-3.5 w-3.5 text-sf-accent" />{title}</div>
              <p className="mt-1 text-[10.5px] leading-relaxed text-sf-text-muted">{detail}</p>
              <p className="mt-1 text-[10.5px] italic text-sf-text-secondary">“{example}”</p>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-sf-text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sf-success" />
          Edits go through Drama Studio&apos;s undo history, and agents can save a checkpoint before big changes. Only programs on this computer can reach the server.
        </div>

        {toolNames.length > 0 && (
          <div className="mt-3 border-t border-sf-dark-700 pt-2">
            <button
              type="button"
              onClick={() => setShowTools((open) => !open)}
              className="inline-flex items-center gap-1 text-[11px] text-sf-text-secondary hover:text-sf-text-primary"
            >
              <ChevronDown className={`h-3 w-3 transition-transform ${showTools ? 'rotate-180' : ''}`} />
              {showTools ? 'Hide' : 'Show'} all {toolNames.length} tools
            </button>
            {showTools && (
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-sf-text-secondary">
                {toolNames.map((tool) => <span key={tool} className="rounded bg-sf-dark-800 px-2 py-1 font-mono">{tool}</span>)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
