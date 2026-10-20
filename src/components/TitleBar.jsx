import { Fragment, useEffect, useState } from 'react'
import { BookMarked, Copy, Download, GraduationCap, HelpCircle, LayoutTemplate, MessageSquare, Minus, PanelLeft, Search, Square, Users, X } from 'lucide-react'
import useCastLockerStore from '../stores/castLockerStore'
import useHelpStore from '../stores/helpStore'
import useCommandStore from '../stores/commandStore'
import useProjectStore from '../stores/projectStore'
import { openPromptLibrary } from '../stores/promptLibraryStore'
import ComfyLauncherChip from './ComfyLauncherChip'
import CreditsChip from './CreditsChip'
import GenerationMonitorChip from './GenerationMonitorChip'
import { useI18n } from '../i18n/I18nContext'
import { LEARN_AI_URL } from '../config/projectInfo'

const EDITOR_LAYOUTS = [
  { id: 'default', Icon: LayoutTemplate, label: 'Default layout' },
  { id: 'vertical', Icon: PanelLeft, label: 'Vertical layout — tall preview on the left, made for 9:16, 1:1, and other social formats' },
]

// Workspace tabs. Export is not a tab here: it is the one primary action on
// the right. ComfyUI's node editor sits apart at the end, marked Advanced.
const TOP_TABS = [
  { id: 'editor', label: 'Editor' },
  { id: 'idea-pad', label: 'Idea Pad' },
  { id: 'motion', label: 'Motion Studio' },
  { id: 'generate', label: 'Generate' },
  { id: 'agent', label: 'Agent' },
  { id: 'flow-ai', label: 'Flow AI' },
  { id: 'mog', label: 'MoGraph' },
  { id: 'stock', label: 'Stock' },
  { id: 'comfyui', label: 'ComfyUI', advanced: true },
]

// Kept in the app but not offered in the top bar: Agent is the same chat as
// the Assistant panel (top bar › Assistant); Flow AI and MoGraph are unfinished.
export const HIDDEN_TOP_TAB_IDS = new Set([
  'agent',
  'flow-ai',
  'mog',
])

export function getVisibleTopTabs() {
  return TOP_TABS.filter((tab) => !HIDDEN_TOP_TAB_IDS.has(tab.id))
}

const QUIET_BUTTON = 'inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-sf-text-secondary transition-colors hover:bg-sf-dark-700 hover:text-sf-text-primary'

function TitleBar({
  projectName,
  activeTab = 'editor',
  onTabChange,
  editorLayout = 'default',
  onEditorLayoutChange,
  assistantOpen = false,
  onToggleAssistant,
}) {
  const { t } = useI18n()
  const openHelp = useHelpStore((state) => state.openHelp)
  const openPalette = useCommandStore((state) => state.openPalette)
  const tabs = getVisibleTopTabs()
  const [windowState, setWindowState] = useState({
    isMaximized: false,
    isFullScreen: false,
  })

  useEffect(() => {
    let mounted = true
    let unsubscribe = null

    const loadWindowState = async () => {
      try {
        const nextState = await window.electronAPI?.getWindowState?.()
        if (mounted && nextState) {
          setWindowState({
            isMaximized: Boolean(nextState.isMaximized),
            isFullScreen: Boolean(nextState.isFullScreen),
          })
        }
      } catch (_) {
        // Ignore missing Electron bridge/state fetch errors in non-Electron contexts.
      }
    }

    loadWindowState()

    unsubscribe = window.electronAPI?.onWindowStateChanged?.((nextState) => {
      if (!mounted || !nextState) return
      setWindowState({
        isMaximized: Boolean(nextState.isMaximized),
        isFullScreen: Boolean(nextState.isFullScreen),
      })
    })

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [])

  const isRestoreDown = windowState.isMaximized || windowState.isFullScreen

  const handleMinimize = () => {
    window.electronAPI?.minimizeWindow?.()
  }

  const handleToggleMaximize = () => {
    window.electronAPI?.toggleMaximizeWindow?.()
  }

  const handleCloseWindow = () => {
    window.electronAPI?.closeWindow?.()
  }

  return (
    <div className="h-10 bg-gradient-to-b from-sf-dark-900/70 to-sf-dark-950 shadow-[inset_0_-1px_0_rgb(var(--sf-dark-800))] flex items-center justify-between px-4 drag-region relative">
      {/* Left - logo, then the app mode tabs */}
      <div className="flex h-full min-w-0 items-center">
      <div className="mr-4 flex flex-shrink-0 items-center gap-2" data-tour="app-logo" title="Drama Studio™">
        <img
          src={`${import.meta.env.BASE_URL}brand/drama-studio-mark-64.png`}
          alt=""
          className="h-6 w-6"
          draggable={false}
        />
        <span className="whitespace-nowrap font-display text-[13px] font-extrabold tracking-tight text-sf-text-primary" aria-label="Drama Studio">
          Drama Studio<span className="ml-px align-super text-[7px] font-bold text-sf-text-muted">™</span>
        </span>
      </div>

      {/* App mode tabs; extend 1px into content so grey touches with no black line */}
      <div
        className="flex items-center self-start"
        style={{ height: 'calc(100% + 1px)' }}
      >
        <nav
          data-tour="editor-modes"
          className="no-drag flex items-center gap-0 h-full bg-sf-dark-800 border-x border-sf-dark-700 border-t-0 rounded-none p-0.5"
          aria-label={t('topTabs.navigation', undefined, 'Workspace modes')}
        >
          {tabs.map((tab, index) => (
            <Fragment key={tab.id}>
              {index > 0 && (
                <div
                  className={tab.advanced
                    ? 'mx-1 h-5 w-px flex-shrink-0 bg-sf-dark-500'
                    : 'h-4 w-px flex-shrink-0 bg-sf-dark-600'}
                  aria-hidden="true"
                />
              )}
              <div className="relative flex h-full items-center">
                <button
                  onClick={() => onTabChange?.(tab.id)}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                  data-testid={`top-tab-${tab.id}`}
                  title={tab.advanced ? t('topTabs.comfyuiAdvancedTitle', undefined, 'Advanced: the full ComfyUI node editor, for building custom workflows. Generate covers the usual jobs.') : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-[5px] px-3 py-1 text-[11px] transition-colors ${
                    activeTab === tab.id
                      ? 'bg-sf-dark-600 font-semibold text-sf-text-primary shadow-[inset_0_-2px_0_rgb(var(--sf-accent))]'
                      : 'text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary'
                  }`}
                >
                  {tab.advanced ? tab.label : t(`topTabs.${tab.id}`, undefined, tab.label)}
                  {tab.advanced && (
                    <span className="rounded border border-sf-dark-500 px-1 py-px font-mono text-[8.5px] uppercase tracking-[0.12em] text-sf-text-muted">
                      {t('topTabs.advanced', undefined, 'Advanced')}
                    </span>
                  )}
                </button>
                {tab.id === 'mog' && activeTab === 'mog' && (
                  <div className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 rounded-full bg-sf-accent/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-sf-text-muted">
                    beta
                  </div>
                )}
              </div>
            </Fragment>
          ))}
        </nav>
      </div>
      </div>

      {/* Right - tools, status area, the one primary action, window controls */}
      <div className="no-drag flex items-center">
        {activeTab === 'editor' && onEditorLayoutChange && (
          <div className="mr-2 flex items-center gap-0.5 rounded-md bg-sf-dark-800/80 p-0.5 ring-1 ring-inset ring-sf-dark-600/70">
            {EDITOR_LAYOUTS.map(({ id, Icon, label }) => (
              <button
                key={id}
                onClick={() => onEditorLayoutChange(id)}
                title={label}
                className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                  editorLayout === id
                    ? 'bg-sf-accent/25 text-sf-accent'
                    : 'text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={openPalette}
          title={t('commandPalette.buttonTitle', undefined, 'Search all actions (Ctrl+Shift+P)')}
          data-tour="command-palette"
          data-testid="command-palette-button"
          className={`mr-1 ${QUIET_BUTTON}`}
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">{t('commandPalette.button', undefined, 'Search')}</span>
          <span className="hidden font-mono text-[9.5px] text-sf-text-muted 2xl:inline">Ctrl⇧P</span>
        </button>
        <button
          type="button"
          onClick={() => openHelp()}
          title={t('help.buttonTitle', undefined, 'Help Center: guides and answers (F1)')}
          data-tour="help-button"
          className={`mr-1 ${QUIET_BUTTON}`}
        >
          <HelpCircle className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">{t('help.button', undefined, 'Help')}</span>
        </button>
        {onToggleAssistant && (
          <button
            type="button"
            onClick={onToggleAssistant}
            title={assistantOpen ? 'Hide the AI assistant' : 'Open the AI assistant: ask questions or describe edits'}
            data-tour="assistant-toggle"
            aria-pressed={assistantOpen}
            className={`mr-2 inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors ${
              assistantOpen
                ? 'bg-sf-accent/15 text-sf-text-primary ring-1 ring-inset ring-sf-accent/50 hover:bg-sf-accent/25'
                : 'text-sf-text-secondary hover:bg-sf-dark-700 hover:text-sf-text-primary'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Assistant</span>
          </button>
        )}
        {/* One status area: the project's Cast and Prompts, then credits, jobs and ComfyUI. */}
        <div
          data-testid="top-bar-status"
          data-tour="top-bar-status"
          className="mr-2 flex h-8 items-center gap-0.5 rounded-lg bg-sf-dark-900/70 px-1 ring-1 ring-inset ring-sf-dark-700"
        >
          <CastLockerButton />
          <PromptLibraryButton />
          <div className="mx-1 h-4 w-px flex-shrink-0 bg-sf-dark-600" aria-hidden="true" />
          <CreditsChip size="xs" className="mr-1" />
          <GenerationMonitorChip onOpenGenerate={() => onTabChange?.('generate')} />
          <ComfyLauncherChip />
        </div>
        <a
          href={LEARN_AI_URL}
          target="_blank"
          rel="noreferrer sponsored"
          title={t('titleBar.learnAiTitle', undefined, 'Learn AI content generation (partner link, opens in your browser)')}
          data-testid="learn-ai-link"
          className="mr-2 inline-flex h-6 flex-shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-sf-text-muted transition-colors hover:bg-sf-dark-700 hover:text-sf-text-primary"
        >
          <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden 2xl:inline">{t('titleBar.learnAiShort', undefined, 'Learn AI')}</span>
        </a>
        <button
          type="button"
          onClick={() => onTabChange?.('export')}
          aria-current={activeTab === 'export' ? 'page' : undefined}
          data-testid="top-bar-export"
          data-tour="top-bar-export"
          title={t('titleBar.exportTitle', undefined, 'Export your video')}
          className={`mr-2 inline-flex h-7 items-center gap-1.5 rounded-md bg-sf-accent px-3 text-[11.5px] font-semibold text-sf-accent-on transition-colors hover:bg-sf-accent-hover ${
            activeTab === 'export' ? 'ring-2 ring-sf-accent/40 ring-offset-1 ring-offset-sf-dark-950' : ''
          }`}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          {t('topTabs.export', undefined, 'Export')}
        </button>
        <button
          onClick={handleMinimize}
          className="no-drag w-10 h-10 flex items-center justify-center hover:bg-sf-dark-700 transition-colors"
          title="Minimize"
        >
          <Minus className="w-4 h-4 text-sf-text-secondary" />
        </button>
        <button
          onClick={handleToggleMaximize}
          className="no-drag w-10 h-10 flex items-center justify-center hover:bg-sf-dark-700 transition-colors"
          title={isRestoreDown ? 'Restore Down' : 'Maximize'}
        >
          {isRestoreDown ? (
            <Copy className="w-3 h-3 text-sf-text-secondary" />
          ) : (
            <Square className="w-3 h-3 text-sf-text-secondary" />
          )}
        </button>
        <button
          onClick={handleCloseWindow}
          className="no-drag w-10 h-10 flex items-center justify-center hover:bg-red-600 transition-colors"
          title="Close"
        >
          <X className="w-4 h-4 text-sf-text-secondary" />
        </button>
      </div>
    </div>
  )
}

export default TitleBar

function CastLockerButton() {
  const { t } = useI18n()
  const openDrawer = useCastLockerStore((state) => state.openDrawer)
  const activeLock = useCastLockerStore((state) => state.activeLock)
  const lockProjectKey = useCastLockerStore((state) => state.lockProjectKey)
  const handle = useProjectStore((state) => state.currentProjectHandle)
  const projectName = useProjectStore((state) => state.currentProject?.name)
  const members = useProjectStore((state) => state.currentProject?.cast?.members)
  const projectKey = typeof handle === 'string' ? handle : (projectName || null)
  const locked = activeLock && lockProjectKey === projectKey
    ? (members || []).find((member) => member.id === activeLock.castId)
    : null
  return (
    <button
      type="button"
      onClick={() => openDrawer(locked?.id || null)}
      data-tour="cast-locker"
      title={locked ? t('castLocker.button.lockedTitle', { name: locked.name }) : t('castLocker.button.title')}
      className={`inline-flex h-6 max-w-[180px] items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors ${
        locked
          ? 'border border-sf-accent/60 bg-sf-accent/15 text-sf-text-primary hover:bg-sf-accent/25'
          : 'text-sf-text-secondary hover:bg-sf-dark-700 hover:text-sf-text-primary'
      }`}
    >
      <Users className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{locked ? t('castLocker.button.locked', { name: locked.name }) : t('castLocker.button.label')}</span>
    </button>
  )
}

// The prompt library, next to Cast: both are the project's creative library.
function PromptLibraryButton() {
  const { t } = useI18n()
  return (
    <button
      type="button"
      onClick={() => openPromptLibrary()}
      data-tour="prompt-library"
      data-testid="top-bar-prompt-library"
      title={t('promptLibrary.buttonTitle', undefined, 'Prompt library: your saved prompts and templates')}
      className={QUIET_BUTTON}
    >
      <BookMarked className="h-3.5 w-3.5 shrink-0" />
      <span>{t('promptLibrary.button', undefined, 'Prompts')}</span>
    </button>
  )
}
