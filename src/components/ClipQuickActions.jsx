import { useMemo } from 'react'
import { Check, Command as CommandGlyph, Search, X } from 'lucide-react'
import useTimelineStore from '../stores/timelineStore'
import useCommandStore, { collectCommands, commandAvailability } from '../stores/commandStore'
import { commandAppliesToClip, getCommandContext } from '../services/commandContext'
import { CLIP_AI_COMMAND_IDS } from '../services/timelineCommands'
import { CLIP_LABEL_COLOR_OPTIONS } from '../utils/clipLabelColors'
import { useI18n } from '../i18n/I18nContext'

function QuickActionButton({ command, context }) {
  const availability = commandAvailability(command, context)
  const Icon = command.icon || CommandGlyph
  const disabled = availability !== true
  return (
    <button type="button" data-command-id={command.id} disabled={disabled}
      title={disabled ? availability : (command.where ? `${command.title} (also: ${command.where})` : command.title)}
      onClick={() => command.run(context)}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-sf-dark-800/80 px-2 py-1 text-[11px] text-sf-text-secondary ring-1 ring-inset ring-sf-dark-600/70 hover:bg-sf-dark-700 hover:text-sf-text-primary hover:ring-sf-accent/40 disabled:cursor-not-allowed disabled:opacity-45">
      <Icon className="h-3.5 w-3.5 shrink-0 text-sf-accent" aria-hidden="true" />
      <span className="truncate">{command.title.replace(/…$/, '').replace(/ \(AI\)$/, '')}</span>
    </button>
  )
}

function RowLabel({ children }) {
  return <div className="mb-1 mt-2 font-mono text-[9px] uppercase tracking-[0.14em] text-sf-text-muted/80 first:mt-0">{children}</div>
}

/**
 * Top of the Inspector: the actions that fit the selected clip, which
 * otherwise live only in the right-click menu. AI tools (continue shot,
 * lip-sync, Smart Replace, translate captions, detect beats) come first,
 * then editing tools (mask, compound, paste attributes, match frame, move
 * by offset) and label colours. Same commands as the palette.
 */
export default function ClipQuickActions() {
  const { t } = useI18n()
  const selectedClipIds = useTimelineStore((state) => state.selectedClipIds)
  const clips = useTimelineStore((state) => state.clips)
  const setClipLabelColor = useTimelineStore((state) => state.setClipLabelColor)
  const version = useCommandStore((state) => state.version)
  const openPalette = useCommandStore((state) => state.openPalette)

  const { context, aiActions, editActions } = useMemo(() => {
    const nextContext = getCommandContext()
    const list = nextContext.clip ? collectCommands(nextContext).filter((command) => commandAppliesToClip(command, nextContext)) : []
    const isAi = (command) => CLIP_AI_COMMAND_IDS.includes(command.id) || command.group === 'AI'
    return { context: nextContext, aiActions: list.filter(isAi), editActions: list.filter((command) => !isAi(command)) }
    // clips/selection/version drive a fresh read of the registry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClipIds, clips, version])

  if (!context.clip || (aiActions.length === 0 && editActions.length === 0)) return null
  const activeLabel = typeof context.clip.labelColor === 'string' ? context.clip.labelColor.trim().toLowerCase() : ''

  return (
    <div className="border-b border-sf-dark-700 bg-sf-dark-900/60 px-3 py-2.5" data-testid="clip-quick-actions">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-sf-text-muted">{t('quickActions.title', undefined, 'Quick actions')}</span>
        <button type="button" onClick={openPalette} title={t('commandPalette.buttonTitle', undefined, 'Search all actions (Ctrl+Shift+P)')}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary">
          <Search className="h-3 w-3" aria-hidden="true" />{t('quickActions.more', undefined, 'More')}
        </button>
      </div>
      {aiActions.length > 0 && <>
        <RowLabel>{t('quickActions.ai', undefined, 'AI')}</RowLabel>
        <div className="flex flex-wrap gap-1.5" data-testid="clip-quick-actions-ai">
          {aiActions.map((command) => <QuickActionButton key={command.id} command={command} context={context} />)}
        </div>
      </>}
      {editActions.length > 0 && <>
        <RowLabel>{t('quickActions.edit', undefined, 'Edit')}</RowLabel>
        <div className="flex flex-wrap gap-1.5" data-testid="clip-quick-actions-edit">
          {editActions.map((command) => <QuickActionButton key={command.id} command={command} context={context} />)}
        </div>
      </>}
      <RowLabel>{t('quickActions.labelColor', undefined, 'Label colour')}</RowLabel>
      <div className="flex flex-wrap gap-1" data-testid="clip-quick-actions-label">
        {CLIP_LABEL_COLOR_OPTIONS.map((option) => {
          const isActive = option.color ? activeLabel === option.color : !activeLabel
          return (
            <button key={option.label} type="button" title={option.label} aria-label={option.label}
              onClick={() => setClipLabelColor(selectedClipIds, option.color)}
              className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${isActive ? 'border-sf-text-primary ring-1 ring-sf-text-primary/60' : 'border-sf-dark-500 hover:border-sf-text-secondary'} ${option.color ? '' : 'bg-sf-dark-900'}`}
              style={option.color ? { backgroundColor: option.color } : undefined}>
              {!option.color && <X className="h-3 w-3 text-sf-text-muted" />}
              {option.color && isActive && <Check className="h-3 w-3 text-white drop-shadow" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
