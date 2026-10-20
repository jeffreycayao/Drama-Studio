import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Command as CommandGlyph, MoreHorizontal, X } from 'lucide-react'
import { collectCommands, commandAvailability } from '../stores/commandStore'
import { commandAppliesToClip, getCommandContext } from '../services/commandContext'
import { CLIP_LABEL_COLOR_OPTIONS } from '../config/clipLabelColors'

// Same order as the Inspector quick actions: AI first, pro edit tools last.
export const CLIP_ACTION_GROUPS = ['AI', 'Captions', 'Audio', 'Edit']

export function groupClipCommands(commands) {
  const groups = new Map(CLIP_ACTION_GROUPS.map((name) => [name, []]))
  for (const command of commands) {
    const name = groups.has(command.group) ? command.group : 'Edit'
    groups.get(name).push(command)
  }
  return [...groups.entries()].filter(([, list]) => list.length).map(([name, list]) => ({ name, commands: list }))
}

/**
 * The menu behind the "AI" button on a selected timeline clip: the clip's
 * AI tools and pro edit tools from the command registry, label colours,
 * and a way into the full right-click menu.
 */
export default function ClipActionsMenu({ x, y, labelColor = '', onClose, onSetLabelColor, onOpenAll }) {
  const ref = useRef(null)
  const [position, setPosition] = useState({ left: x, top: y })

  const { context, groups } = useMemo(() => {
    const nextContext = getCommandContext()
    const list = nextContext.clip
      ? collectCommands(nextContext).filter((command) => commandAppliesToClip(command, nextContext))
      : []
    return { context: nextContext, groups: groupClipCommands(list) }
  }, [])

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    const margin = 8
    setPosition({
      left: Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin)),
      top: y + rect.height + margin > window.innerHeight ? Math.max(margin, y - rect.height - 36) : y,
    })
  }, [x, y])

  useEffect(() => {
    const handlePointer = (event) => {
      if (ref.current && !(event.target instanceof Node && ref.current.contains(event.target))) onClose()
    }
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('mousedown', handlePointer, true)
    window.addEventListener('keydown', handleKey, true)
    return () => {
      window.removeEventListener('mousedown', handlePointer, true)
      window.removeEventListener('keydown', handleKey, true)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="clip-actions-menu"
      className="fixed z-50 w-[248px] max-h-[calc(100vh-16px)] overflow-y-auto rounded-lg border border-sf-dark-600 bg-sf-dark-800 py-1 shadow-xl"
      style={{ left: position.left, top: position.top }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 pb-1 pt-1.5">
        <span className="truncate text-[11px] font-medium text-sf-text-primary">{context.clip?.name || 'Clip'}</span>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-0.5 text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary">
          <X className="h-3 w-3" />
        </button>
      </div>
      {groups.length === 0 && (
        <p className="px-3 py-2 text-[11px] text-sf-text-muted">No AI tools for this kind of clip. Open all clip actions below.</p>
      )}
      {groups.map((group) => (
        <div key={group.name} className="border-t border-sf-dark-700/70 py-1 first-of-type:border-t-0">
          <div className="px-3 pb-0.5 pt-1 font-mono text-[9px] uppercase tracking-[0.16em] text-sf-text-muted">{group.name === 'Edit' ? 'Edit tools' : group.name}</div>
          {group.commands.map((command) => {
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
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Icon className={`h-3.5 w-3.5 shrink-0 ${group.name === 'AI' ? 'text-sf-accent' : 'text-sf-text-muted'}`} aria-hidden="true" />
                <span className="truncate">{command.title}</span>
              </button>
            )
          })}
        </div>
      ))}
      <div className="border-t border-sf-dark-700/70 px-3 py-2">
        <div className="mb-1.5 text-[10px] text-sf-text-muted">Label colour</div>
        <div className="grid grid-cols-9 gap-1">
          {CLIP_LABEL_COLOR_OPTIONS.map((option) => {
            const active = labelColor === option.color
            return (
              <button
                key={option.label}
                type="button"
                title={option.label}
                aria-label={option.label}
                aria-pressed={active}
                onClick={() => { onSetLabelColor(option.color); onClose() }}
                className={`flex h-5 w-5 items-center justify-center rounded border ${active ? 'border-sf-text-primary ring-1 ring-sf-text-primary/70' : 'border-sf-dark-500 hover:border-sf-text-secondary'} ${option.color ? '' : 'bg-sf-dark-900'}`}
                style={option.color ? { backgroundColor: option.color } : undefined}
              >
                {!option.color && <X className="h-3 w-3 text-sf-text-muted" />}
              </button>
            )
          })}
        </div>
      </div>
      <button
        type="button"
        role="menuitem"
        data-testid="clip-actions-all"
        onClick={() => onOpenAll(position.left, position.top)}
        className="flex w-full items-center gap-2 border-t border-sf-dark-700/70 px-3 py-1.5 text-left text-xs text-sf-text-secondary hover:bg-sf-dark-700 hover:text-sf-text-primary"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
        <span>All clip actions…</span>
        <span className="ml-auto text-[10px] text-sf-text-muted">Right-click</span>
      </button>
    </div>
  )
}
