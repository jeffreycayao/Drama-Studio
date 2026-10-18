import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Cloud, Cpu, Wand2, X } from 'lucide-react'
import useComfySetupStore from '../stores/comfySetupStore'
import useHelpStore from '../stores/helpStore'
import { useI18n } from '../i18n/I18nContext'

function Explanation({ feature }) {
  const { t } = useI18n()
  return (
    <>
      <p className="text-[13px] leading-relaxed text-sf-text-secondary">
        {t('comfyRequired.body', { feature }, `${feature} runs through ComfyUI, the free AI engine. You chose to start without it, so it is not set up yet.`)}
      </p>
      <ul className="mt-3 space-y-2 text-[12.5px] leading-relaxed text-sf-text-secondary">
        <li className="flex gap-2"><Cpu className="mt-0.5 h-4 w-4 shrink-0 text-sf-accent" />{t('comfyRequired.local', undefined, 'With a strong NVIDIA card, ComfyUI runs AI on your PC for free.')}</li>
        <li className="flex gap-2"><Cloud className="mt-0.5 h-4 w-4 shrink-0 text-sf-accent" />{t('comfyRequired.cloud', undefined, 'Without one, ComfyUI can still run cloud models with a Comfy.org key (paid per result).')}</li>
      </ul>
    </>
  )
}

/** Modal shown when a ComfyUI feature is opened in cloud-only mode. */
export function ComfyRequiredDialog() {
  const { t } = useI18n()
  const prompt = useComfySetupStore((state) => state.prompt)
  const dismissPrompt = useComfySetupStore((state) => state.dismissPrompt)
  const requestSetup = useComfySetupStore((state) => state.requestSetup)

  useEffect(() => {
    if (!prompt) return undefined
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); dismissPrompt() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [prompt, dismissPrompt])

  if (!prompt) return null
  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) dismissPrompt() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="comfy-required-title" data-testid="comfy-required-dialog"
        className="w-full max-w-md overflow-hidden rounded-xl border border-sf-dark-600 bg-sf-dark-800 text-sf-text-primary shadow-2xl">
        <header className="flex items-start gap-3 border-b border-sf-dark-700 px-4 py-3">
          <h2 id="comfy-required-title" className="flex-1 text-sm font-semibold">{t('comfyRequired.title', { feature: prompt.feature }, `${prompt.feature} needs ComfyUI`)}</h2>
          <button type="button" onClick={dismissPrompt} aria-label={t('common.close', undefined, 'Close')} className="rounded p-1 text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary"><X className="h-4 w-4" /></button>
        </header>
        <div className="px-4 py-4"><Explanation feature={prompt.feature} /></div>
        <footer className="flex flex-wrap justify-end gap-2 border-t border-sf-dark-700 px-4 py-3">
          <button type="button" onClick={() => { dismissPrompt(); useHelpStore.getState().openHelp('local-vs-cloud') }} className="mr-auto rounded px-2 py-1.5 text-xs text-sf-text-muted hover:text-sf-text-primary">
            {t('comfyRequired.learn', undefined, 'Local or cloud?')}
          </button>
          <button type="button" onClick={dismissPrompt} className="rounded border border-sf-dark-600 px-3 py-1.5 text-xs hover:bg-sf-dark-700">{t('comfyRequired.notNow', undefined, 'Not now')}</button>
          <button type="button" onClick={requestSetup} data-testid="comfy-required-setup" className="rounded bg-sf-accent px-3 py-1.5 text-xs font-semibold text-sf-accent-on hover:bg-sf-accent-hover">
            {t('comfyRequired.setup', undefined, 'Set up ComfyUI')}
          </button>
        </footer>
      </section>
    </div>, document.body,
  )
}

/** In place of the Generate / ComfyUI workspaces in cloud-only mode. */
export function ComfyRequiredPanel({ feature, title = null, onBack, altLabel = '', onAlt = null }) {
  const { t } = useI18n()
  const requestSetup = useComfySetupStore((state) => state.requestSetup)
  return (
    <div className="flex flex-1 items-center justify-center bg-sf-dark-950 p-6" data-testid="comfy-required-panel">
      <div className="w-full max-w-lg rounded-2xl border border-sf-dark-600 bg-gradient-to-b from-sf-dark-800 to-sf-dark-900 p-6 shadow-2xl">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-sf-accent text-sf-accent-on"><Wand2 className="h-5 w-5" /></div>
        <h2 className="font-display text-xl font-bold tracking-tight">{title || t('comfyRequired.title', { feature }, `${feature} needs ComfyUI`)}</h2>
        <div className="mt-2"><Explanation feature={feature} /></div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={requestSetup} data-testid="comfy-required-panel-setup" className="rounded-lg bg-sf-accent px-4 py-2 text-sm font-semibold text-sf-accent-on hover:bg-sf-accent-hover">{t('comfyRequired.setup', undefined, 'Set up ComfyUI')}</button>
          {onAlt && altLabel && <button type="button" onClick={onAlt} data-testid="comfy-required-panel-alt" className="rounded-lg border border-sf-accent/50 px-4 py-2 text-sm text-sf-text-primary hover:bg-sf-dark-700">{altLabel}</button>}
          <button type="button" onClick={onBack} className="rounded-lg border border-sf-dark-500 px-4 py-2 text-sm hover:bg-sf-dark-700">{t('comfyRequired.backToEditor', undefined, 'Back to the editor')}</button>
        </div>
      </div>
    </div>
  )
}
