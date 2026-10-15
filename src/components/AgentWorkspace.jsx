import ChatPanel from './ChatPanel'

// The Agent tab is the full-width view of the same assistant conversation that
// docks beside the editor. Backend choice (Ollama, LM Studio, Claude, OpenAI,
// DeepSeek) lives in Settings > Agents.
function AgentWorkspace({ onOpenSettings }) {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 bg-sf-dark-950">
      <ChatPanel variant="workspace" onOpenSettings={onOpenSettings} />
    </div>
  )
}

export default AgentWorkspace
