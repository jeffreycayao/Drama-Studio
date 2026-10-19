import { useEffect, useMemo, useRef } from 'react'
import { ChevronDown, Command as CommandGlyph, Sparkles } from 'lucide-react'
import { collectCommands, commandAvailability } from '../stores/commandStore'
import { commandAppliesToClip, getCommandContext } from '../services/commandContext'
import { CLIP_AI_COMMAND_IDS } from '../services/timelineCommands'

/** The AI tools that fit the selected clip, for its "AI" button on the timeline. */
export function getClipAiCommands(context = getCommandContext()) {
  if (!context.clip) return []
  return collectCommands(context)
    .filter((command) => CLIP_AI_COMMAND_IDS.includes(command.id) && commandAppliesToClip(command, context))
    .sort((a, b) => CLIP_AI_COMMAND_IDS.indexOf(a.id) - CLIP_AI_COMMAND_IDS.indexOf(b.id))
}

/** Small "AI tools" button drawn at the left edge of the selected clip. */
export function ClipAiButton({ onOpen }) {
  return (
    <button
      type="button"
      data-testid="clip-ai-button"
      title="AI tools for this clip"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        onOpen({ x: rect.left, y: rect.bottom + 4 })
      }}
      className="pointer-events-auto absolute left-1 top-1/2 z-30 inline-flex -translate-y-1/2 items-center gap-0.5 rounded bg-sf-accent px-1.5 py-0.5 text-[9px] font-semibold leading-none text-sf-accent-on shadow-md ring-1 ring-black/40 hover:bg-sf-accent-hover"
    >
      <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />AI tools<ChevronDown className="h-2.5 w-2.5" aria-hidden="true" />
    </button>
  )
}

export default function ClipAiMenu({ position, onClose }) {
  const menuRef = useRef(null)
  const { context, commands } = useMemo(() => {
    const nextContext = getCommandContext()
    return { context: nextContext, commands: getClipAiCommands(nextContext) }
  }, [])

  useEffect(() => {
    const handlePointer = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) onClose()
    }
    const handleKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('mousedown', handlePointer, true)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handlePointer, true)
      window.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const left = Math.max(8, Math.min(position.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 260))
  const top = Math.max(8, Math.min(position.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 220))

  return (
    <div
      ref={menuRef}
      data-testid="clip-ai-menu"
      role="menu"
      className="fixed z-[200] min-w-[240px] rounded-lg border border-sf-dark-600 bg-sf-dark-800 py-1 shadow-xl"
      style={{ left: `${left}px`, top: `${top}px` }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="px-3 pb-1 pt-1.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-sf-text-muted">AI tools</div>
      {commands.length === 0 && <div className="px-3 py-2 text-xs text-sf-text-muted">No AI tools for this clip.</div>}
      {commands.map((command) => {
        const availability = commandAvailability(command, context)
        const disabled = availability !== true
        const Icon = command.icon || CommandGlyph
        return (
          <button
            key={command.id}
            type="button"
            role="menuitem"
            data-command-id={command.id}
            disabled={disabled}
            title={disabled ? availability : command.title}
            onClick={() => { onClose(); command.run(context) }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-sf-accent" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{command.title.replace(/ \(AI\)/, '')}</span>
          </button>
        )
      })}
    </div>
  )
}
