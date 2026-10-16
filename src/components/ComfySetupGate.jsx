import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Copy, Download, FolderOpen, HardDrive, Loader2, Minus, PlugZap, RefreshCw, Square, X } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import { saveLocalComfyConnectionPort } from '../services/localComfyConnection'

// Drama Studio needs ComfyUI. On launch this finds it wherever it is installed
// (running server, Comfy Desktop, folder scan) and saves it. When nothing is
// found the whole app stays behind this screen until the user installs or
// locates ComfyUI. Once set up, later launches pass straight through, even
// when ComfyUI is not running (the app can start it).

const COMFY_ROOT_SETTING_KEY = 'comfyRootPath'
const COMFY_SETUP_SETTING_KEY = 'comfySetup'
const COMFY_DOWNLOAD_URL = 'https://www.comfy.org/download'

const SOURCE_LABEL_KEYS = {
  running: ['comfyGate.source.running', 'Running now'],
  'comfy-desktop': ['comfyGate.source.comfyDesktop', 'Comfy Desktop'],
  'comfy-desktop-legacy': ['comfyGate.source.comfyDesktopLegacy', 'ComfyUI Desktop (older)'],
  scan: ['comfyGate.source.scan', 'Found on disk'],
}

function getApi() {
  return typeof window !== 'undefined' ? window.electronAPI : null
}

async function rememberLauncher(api, comfyRootPath) {
  // Portable installs: remember run_nvidia_gpu.bat etc. so "Start ComfyUI" works.
  try {
    const config = await api.comfyLauncher?.getConfig?.()
    if (config?.launcherScript) return
    const detected = await api.comfyLauncher?.detectLaunchers?.({ comfyRootPath })
    const first = detected?.candidates?.[0]
    if (first?.path) await api.comfyLauncher.setConfig({ launcherScript: first.path })
  } catch {
    /* optional; Settings can set the launcher later */
  }
}

function WindowControls() {
  const api = getApi()
  const [isMaximized, setIsMaximized] = useState(false)
  useEffect(() => {
    let cancelled = false
    api?.getWindowState?.().then((state) => {
      if (!cancelled && state) setIsMaximized(Boolean(state.isMaximized || state.isFullScreen))
    }).catch(() => {})
    const unsubscribe = api?.onWindowStateChanged?.((state) => setIsMaximized(Boolean(state?.isMaximized || state?.isFullScreen)))
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [api])
  return (
    <div className="relative z-50 h-10 flex-shrink-0 bg-sf-dark-950 flex items-stretch justify-end drag-region select-none">
      <div className="no-drag flex items-stretch">
        <button onClick={() => api?.minimizeWindow?.()} className="w-10 h-10 flex items-center justify-center hover:bg-sf-dark-700 transition-colors" title="Minimize" aria-label="Minimize">
          <Minus className="w-4 h-4 text-sf-text-secondary" />
        </button>
        <button onClick={() => api?.toggleMaximizeWindow?.()} className="w-10 h-10 flex items-center justify-center hover:bg-sf-dark-700 transition-colors" title={isMaximized ? 'Restore Down' : 'Maximize'} aria-label={isMaximized ? 'Restore Down' : 'Maximize'}>
          {isMaximized ? <Copy className="w-3 h-3 text-sf-text-secondary" /> : <Square className="w-3 h-3 text-sf-text-secondary" />}
        </button>
        <button onClick={() => api?.closeWindow?.()} className="w-10 h-10 flex items-center justify-center hover:bg-red-600 transition-colors" title="Close" aria-label="Close">
          <X className="w-4 h-4 text-sf-text-secondary" />
        </button>
      </div>
    </div>
  )
}

export default function ComfySetupGate({ children }) {
  const { t } = useI18n()
  const api = getApi()
  // checking | scanning | choose | missing | ready
  const [phase, setPhase] = useState(api?.comfySetup ? 'checking' : 'ready')
  const [installs, setInstalls] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [port, setPort] = useState('8188')
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const acceptRoot = useCallback(async (root, via) => {
    let validation = await api.validateWorkflowSetupRoot(root)
    if (!validation?.isValid) {
      // A portable folder was picked: use the ComfyUI folder inside it.
      const nested = `${String(root).replace(/[\\/]+$/, '')}${root.includes('\\') ? '\\' : '/'}ComfyUI`
      const nestedValidation = await api.validateWorkflowSetupRoot(nested)
      if (nestedValidation?.isValid) validation = nestedValidation
    }
    if (!validation?.isValid) {
      return { ok: false, error: t('comfyGate.invalidFolder', undefined, "That folder doesn't look like ComfyUI. Pick the folder that contains main.py.") }
    }
    const comfyRootPath = validation.normalizedPath || root
    await api.setSetting(COMFY_ROOT_SETTING_KEY, comfyRootPath)
    await rememberLauncher(api, comfyRootPath)
    await api.setSetting(COMFY_SETUP_SETTING_KEY, { via, root: comfyRootPath, confirmedAt: new Date().toISOString() })
    return { ok: true }
  }, [api, t])

  const acceptServer = useCallback(async (serverPort) => {
    const saved = await saveLocalComfyConnectionPort(serverPort)
    if (!saved?.success) return { ok: false, error: saved?.error || '' }
    await api.setSetting(COMFY_SETUP_SETTING_KEY, { via: 'server', port: saved.config?.port, confirmedAt: new Date().toISOString() })
    return { ok: true }
  }, [api])

  const applyDetection = useCallback(async (result, { allowScan }) => {
    const found = Array.isArray(result?.installs) ? result.installs : []
    const servers = Array.isArray(result?.servers) ? result.servers : []
    if (found.length === 1) {
      const accepted = await acceptRoot(found[0].root, found[0].source)
      if (accepted.ok) return 'ready'
    }
    if (found.length > 1) {
      setInstalls(found)
      return 'choose'
    }
    if (servers.length) {
      // Running ComfyUI without a local folder (Docker, another drive we
      // could not read): connecting is enough.
      const accepted = await acceptServer(servers[0].port)
      if (accepted.ok) return 'ready'
    }
    if (!allowScan) return 'missing'
    setPhase('scanning')
    const scanned = await api.comfySetup.detect({ scan: true })
    return applyDetection(scanned, { allowScan: false })
  }, [acceptRoot, acceptServer, api])

  const runDetection = useCallback(async ({ full }) => {
    setError('')
    setPhase(full ? 'scanning' : 'checking')
    try {
      const result = await api.comfySetup.detect({ scan: Boolean(full) })
      const next = await applyDetection(result, { allowScan: !full })
      if (mountedRef.current) setPhase(next)
    } catch (detectError) {
      if (!mountedRef.current) return
      setError(detectError?.message || String(detectError))
      setPhase('missing')
    }
  }, [api, applyDetection])

  useEffect(() => {
    if (phase !== 'checking' || !api?.comfySetup) return undefined
    let cancelled = false
    ;(async () => {
      try {
        const status = await api.comfySetup.getStatus()
        if (cancelled) return
        if (status?.skipGate || status?.rootLooksValid || status?.confirmedVia === 'server') {
          setPhase('ready')
          return
        }
      } catch {
        /* fall through to detection */
      }
      if (!cancelled) await runDetection({ full: false })
    })()
    return () => { cancelled = true }
    // Only on mount; later searches are started by the buttons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLocate = useCallback(async () => {
    const picked = await api.selectDirectory?.({ title: t('comfyGate.locateTitle', undefined, 'Select your ComfyUI folder') })
    if (!picked) return
    setBusy(true)
    setError('')
    const accepted = await acceptRoot(picked, 'manual')
    setBusy(false)
    if (accepted.ok) setPhase('ready')
    else setError(accepted.error)
  }, [acceptRoot, api, t])

  const handleChoose = useCallback(async (entry) => {
    setBusy(true)
    setError('')
    const accepted = await acceptRoot(entry.root, entry.source)
    setBusy(false)
    if (accepted.ok) setPhase('ready')
    else setError(accepted.error)
  }, [acceptRoot])

  const handleConnectPort = useCallback(async () => {
    setBusy(true)
    setError('')
    const check = await api.checkLocalComfyConnection?.({ port, timeoutMs: 2500 })
    if (!check?.ok) {
      setBusy(false)
      setError(t('comfyGate.portFailed', { port }, `Nothing answered on port ${port}. Start ComfyUI and try again.`))
      return
    }
    const accepted = await acceptServer(port)
    setBusy(false)
    if (accepted.ok) setPhase('ready')
    else setError(accepted.error)
  }, [acceptServer, api, port, t])

  if (phase === 'ready') return children

  const searching = phase === 'checking' || phase === 'scanning'

  return (
    <div className="h-screen flex flex-col bg-sf-dark-950 text-sf-text-primary no-select">
      <WindowControls />
      <div className="flex-1 overflow-y-auto flex items-center justify-center px-6 pb-10">
        <div className="w-full max-w-xl" data-testid="comfy-setup-gate" data-phase={phase}>
          <div className="mb-6 text-center">
            <div className="text-xs uppercase tracking-[0.2em] text-sf-text-muted">Drama Studio™</div>
            <h1 className="mt-2 text-2xl font-semibold">{t('comfyGate.title', undefined, 'Drama Studio needs ComfyUI')}</h1>
            <p className="mt-2 text-sm text-sf-text-secondary">
              {t('comfyGate.intro', undefined, 'ComfyUI is the free engine Drama Studio uses to generate video, images, music and voices. Install it, or show Drama Studio where you already have it.')}
            </p>
          </div>

          {searching && (
            <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-900 p-5 flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-sf-accent flex-shrink-0" />
              <div className="text-sm">
                {phase === 'scanning'
                  ? t('comfyGate.scanning', undefined, 'Searching your drives for ComfyUI. This can take a few seconds.')
                  : t('comfyGate.checking', undefined, 'Looking for ComfyUI on this computer…')}
              </div>
            </div>
          )}

          {phase === 'choose' && (
            <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-900 p-5">
              <div className="text-sm font-medium mb-3">{t('comfyGate.chooseTitle', undefined, 'We found more than one ComfyUI. Which one should Drama Studio use?')}</div>
              <ul className="space-y-2">
                {installs.map((entry) => {
                  const [labelKey, labelFallback] = SOURCE_LABEL_KEYS[entry.source] || SOURCE_LABEL_KEYS.scan
                  return (
                    <li key={entry.root}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleChoose(entry)}
                        className="w-full text-left rounded-lg border border-sf-dark-600 hover:border-sf-accent bg-sf-dark-800 px-3 py-2 transition-colors disabled:opacity-60"
                      >
                        <div className="flex items-center gap-2 text-xs text-sf-text-muted">
                          <HardDrive className="w-3.5 h-3.5" />
                          <span>{t(labelKey, undefined, labelFallback)}{entry.label ? ` · ${entry.label}` : ''}</span>
                        </div>
                        <div className="mt-0.5 text-sm font-mono break-all">{entry.root}</div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {phase === 'missing' && (
            <div className="rounded-xl border border-sf-dark-600 bg-sf-dark-900 p-5">
              <div className="text-sm font-medium">{t('comfyGate.notFoundTitle', undefined, "ComfyUI isn't installed yet")}</div>
              <p className="mt-1 text-sm text-sf-text-secondary">{t('comfyGate.notFoundBody', undefined, "We couldn't find ComfyUI on this computer.")}</p>
              <ol className="mt-3 space-y-1.5 text-sm text-sf-text-secondary list-decimal pl-5">
                <li>{t('comfyGate.step1', undefined, 'Download and install ComfyUI. The Comfy Desktop app is the easiest.')}</li>
                <li>{t('comfyGate.step2', undefined, 'Open it once so it finishes setting up.')}</li>
                <li>{t('comfyGate.step3', undefined, 'Come back here and press Search again.')}</li>
              </ol>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => api?.openExternalUrl?.(COMFY_DOWNLOAD_URL)}
                  className="flex items-center gap-2 px-4 py-2 bg-sf-accent hover:bg-sf-accent-hover border border-sf-accent rounded-lg text-sm text-sf-accent-on font-medium transition-colors"
                >
                  <Download className="w-4 h-4" />
                  {t('comfyGate.download', undefined, 'Download ComfyUI')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => runDetection({ full: true })}
                  className="flex items-center gap-2 px-4 py-2 bg-sf-dark-800 hover:bg-sf-dark-700 border border-sf-dark-600 rounded-lg text-sm transition-colors disabled:opacity-60"
                >
                  <RefreshCw className="w-4 h-4" />
                  {t('comfyGate.searchAgain', undefined, 'Search again')}
                </button>
              </div>
            </div>
          )}

          {(phase === 'missing' || phase === 'choose') && (
            <div className="mt-4 rounded-xl border border-sf-dark-700 bg-sf-dark-900/60 p-4 space-y-3">
              <button
                type="button"
                disabled={busy}
                onClick={handleLocate}
                className="flex items-center gap-2 text-sm text-sf-text-primary hover:text-sf-accent transition-colors disabled:opacity-60"
              >
                <FolderOpen className="w-4 h-4" />
                {t('comfyGate.locate', undefined, 'I already have ComfyUI: locate its folder…')}
              </button>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <PlugZap className="w-4 h-4 text-sf-text-muted" />
                <span className="text-sf-text-secondary">{t('comfyGate.portPrompt', undefined, 'ComfyUI running in Docker or on another port?')}</span>
                <input
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                  inputMode="numeric"
                  aria-label={t('comfyGate.portLabel', undefined, 'Port')}
                  className="w-20 rounded-md border border-sf-dark-600 bg-sf-dark-800 px-2 py-1 text-sm font-mono focus:outline-none focus:border-sf-accent"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleConnectPort}
                  className="px-3 py-1 rounded-md border border-sf-dark-600 bg-sf-dark-800 hover:bg-sf-dark-700 transition-colors disabled:opacity-60"
                >
                  {t('comfyGate.connect', undefined, 'Connect')}
                </button>
              </div>
            </div>
          )}

          {busy && (
            <div className="mt-3 flex items-center gap-2 text-xs text-sf-text-muted">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {t('comfyGate.saving', undefined, 'Checking ComfyUI…')}
            </div>
          )}
          {error && (
            <div className="mt-3 rounded-lg border border-sf-error/40 bg-sf-error/10 px-3 py-2 text-sm text-sf-text-primary">{error}</div>
          )}
          <div className="mt-6 flex items-center justify-center gap-1.5 text-xs text-sf-text-muted">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {t('comfyGate.footer', undefined, 'You only do this once. Drama Studio remembers your ComfyUI.')}
          </div>
        </div>
      </div>
    </div>
  )
}
