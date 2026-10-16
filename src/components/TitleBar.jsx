import { Fragment, useEffect, useState } from 'react'
import { Copy, LayoutTemplate, MessageSquare, Minus, PanelLeft, PlayCircle, Square, Users, X } from 'lucide-react'
import useCastLockerStore from '../stores/castLockerStore'
import useProjectStore from '../stores/projectStore'
import ComfyLauncherChip from './ComfyLauncherChip'
import CreditsChip from './CreditsChip'
import GenerationMonitorChip from './GenerationMonitorChip'
import { useI18n } from '../i18n/I18nContext'

const EDITOR_LAYOUTS = [
  { id: 'default', Icon: LayoutTemplate, label: 'Default layout' },
  { id: 'vertical', Icon: PanelLeft, label: 'Vertical layout — tall preview on the left, made for 9:16, 1:1, and other social formats' },
]

const TOP_TABS = [
  { id: 'editor', label: 'Editor' },
  { id: 'idea-pad', label: 'Idea Pad' },
  { id: 'generate', label: 'Generate' },
  { id: 'agent', label: 'Agent' },
  { id: 'flow-ai', label: 'Flow AI' },
  { id: 'mog', label: 'MoGraph' },
  { id: 'stock', label: 'Stock' },
  { id: 'comfyui', label: 'ComfyUI' },
  { id: 'export', label: 'Export' },
  { id: 'discover', label: 'Discover' },
]

const HIDDEN_TOP_TAB_IDS = new Set([
  'agent',
  'flow-ai',
  'mog',
])

function TitleBar({
  projectName,
  activeTab = 'editor',
  onTabChange,
  showDiscoverTab = true,
  editorLayout = 'default',
  onEditorLayoutChange,
  assistantOpen = false,
  onToggleAssistant,
}) {
  const { t } = useI18n()
  const tabs = TOP_TABS.filter((tab) => (
    !HIDDEN_TOP_TAB_IDS.has(tab.id)
    && (tab.id !== 'discover' || showDiscoverTab)
  ))
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
    <div className="h-10 bg-sf-dark-950 flex items-center justify-between px-4 drag-region relative">
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
                  className={tab.id === 'discover'
                    ? 'mx-0.5 h-5 w-px flex-shrink-0 bg-sf-dark-500 2xl:mx-1.5'
                    : 'h-4 w-px flex-shrink-0 bg-sf-dark-600'}
                  aria-hidden="true"
                />
              )}
              <div className="relative flex h-full items-center">
                <button
                  onClick={() => onTabChange?.(tab.id)}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 text-[11px] transition-colors ${
                    tab.id === 'discover'
                      ? (activeTab === tab.id
                          ? 'rounded border border-sf-accent/70 bg-sf-accent/20 font-medium text-sf-text-primary'
                          : 'rounded border border-sf-dark-600 bg-sf-dark-900/70 text-sf-text-secondary hover:border-sf-dark-500 hover:bg-sf-dark-700 hover:text-sf-text-primary')
                      : (activeTab === tab.id
                          ? 'rounded-none bg-sf-accent text-sf-accent-on'
                          : 'rounded-none text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary')
                  }`}
                >
                  {tab.id === 'discover' && <PlayCircle className="hidden h-3.5 w-3.5 2xl:block" aria-hidden="true" />}
                  {tab.id === 'comfyui' ? tab.label : t(`topTabs.${tab.id}`, undefined, tab.label)}
                </button>
                {tab.id === 'mog' && activeTab === 'mog' && (
                  <div className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 rounded-full bg-pink-300/12 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-pink-200/65 shadow-[0_0_10px_rgba(244,114,182,0.12)]">
                    beta
                  </div>
                )}
              </div>
            </Fragment>
          ))}
        </nav>
      </div>
      </div>
      
      {/* Right - Launcher chip + Window Controls (Windows style) */}
      <div className="no-drag flex items-center">
        {activeTab === 'editor' && onEditorLayoutChange && (
          <div className="mr-2 flex items-center gap-0.5 rounded bg-sf-dark-800 p-0.5">
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
        {onToggleAssistant && (
          <button
            type="button"
            onClick={onToggleAssistant}
            title={assistantOpen ? 'Hide the AI assistant' : 'Open the AI assistant: ask questions or describe edits'}
            data-tour="assistant-toggle"
            className={`mr-2 inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
              assistantOpen
                ? 'bg-sf-accent text-sf-accent-on hover:bg-sf-accent-hover'
                : 'bg-sf-dark-800 text-sf-text-secondary hover:bg-sf-dark-700 hover:text-sf-text-primary'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Assistant
          </button>
        )}
        <CastLockerButton />
        <CreditsChip size="xs" className="mr-1" />
        <GenerationMonitorChip onOpenGenerate={() => onTabChange?.('generate')} />
        <ComfyLauncherChip />
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
      className={`mr-2 inline-flex h-6 max-w-[180px] items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors ${
        locked
          ? 'border border-sf-accent/60 bg-sf-accent/15 text-sf-text-primary hover:bg-sf-accent/25'
          : 'bg-sf-dark-800 text-sf-text-secondary hover:bg-sf-dark-700 hover:text-sf-text-primary'
      }`}
    >
      <Users className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{locked ? t('castLocker.button.locked', { name: locked.name }) : t('castLocker.button.label')}</span>
    </button>
  )
}
