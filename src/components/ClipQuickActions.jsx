import { useMemo } from 'react'
import { Command as CommandGlyph, Search } from 'lucide-react'
import useTimelineStore from '../stores/timelineStore'
import useCommandStore, { collectCommands, commandAvailability } from '../stores/commandStore'
import { commandAppliesToClip, getCommandContext } from '../services/commandContext'
import { useI18n } from '../i18n/I18nContext'

/**
 * Top of the Inspector: the actions that fit the selected clip (translate
 * captions, lip-sync, continue shot, detect beats...), which otherwise live
 * only in the right-click menu. Same commands as the palette.
 */
export default function ClipQuickActions() {
  const { t } = useI18n()
  const selectedClipIds = useTimelineStore((state) => state.selectedClipIds)
  const clips = useTimelineStore((state) => state.clips)
  const version = useCommandStore((state) => state.version)
  const openPalette = useCommandStore((state) => state.openPalette)

  const { context, actions } = useMemo(() => {
    const nextContext = getCommandContext()
    const list = nextContext.clip ? collectCommands(nextContext).filter((command) => commandAppliesToClip(command, nextContext)) : []
    return { context: nextContext, actions: list }
    // clips/selection/version drive a fresh read of the registry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClipIds, clips, version])

  if (!context.clip || actions.length === 0) return null

  return (
    <div className="border-b border-sf-dark-700 bg-sf-dark-900/60 px-3 py-2.5" data-testid="clip-quick-actions">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-sf-text-muted">{t('quickActions.title', undefined, 'Quick actions')}</span>
        <button type="button" onClick={openPalette} title={t('commandPalette.buttonTitle', undefined, 'Search all actions (Ctrl+Shift+P)')}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary">
          <Search className="h-3 w-3" aria-hidden="true" />{t('quickActions.more', undefined, 'More')}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {actions.map((command) => {
          const availability = commandAvailability(command, context)
          const Icon = command.icon || CommandGlyph
          const disabled = availability !== true
          return (
            <button key={command.id} type="button" data-command-id={command.id} disabled={disabled}
              title={disabled ? availability : (command.where ? `${command.title} (also: ${command.where})` : command.title)}
              onClick={() => command.run(context)}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-sf-dark-800/80 px-2 py-1 text-[11px] text-sf-text-secondary ring-1 ring-inset ring-sf-dark-600/70 hover:bg-sf-dark-700 hover:text-sf-text-primary hover:ring-sf-accent/40 disabled:cursor-not-allowed disabled:opacity-45">
              <Icon className="h-3.5 w-3.5 shrink-0 text-sf-accent" aria-hidden="true" />
              <span className="truncate">{command.title.replace(/…$/, '')}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
