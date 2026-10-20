// Must stay first: migrates pre-rename localStorage keys before any store reads them.
import './services/legacyStorageMigration'
// Brand fonts ship with the app so they render offline (SIL Open Font License).
import '@fontsource-variable/inter'
import '@fontsource-variable/sora'
import '@fontsource-variable/jetbrains-mono'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ExportWorker from './components/ExportWorker'
import ComfySetupGate from './components/ComfySetupGate'
import { applyTheme, getStoredThemeId } from './config/themes'
import { I18nProvider } from './i18n/I18nContext'
import useProjectStore from './stores/projectStore'
import { isProjectDirty } from './services/projectDirtyTracker'
import './index.css'

const isExportWorker = typeof window !== 'undefined' && window.location.search.includes('export=worker')

applyTheme(getStoredThemeId())

// Closing the window: main waits for this answer (electron/saveBeforeClose.cjs).
// Registered here, outside the ComfyUI setup gate, so the setup screen answers
// too. No thumbnail, so quitting stays quick.
if (!isExportWorker) {
  window.electronAPI?.onSaveBeforeClose?.(async () => {
    const project = useProjectStore.getState()
    if (project.currentProject && isProjectDirty()) return project.saveProject({}, { thumbnail: false })
    return true
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      {isExportWorker ? <ExportWorker /> : <ComfySetupGate><App /></ComfySetupGate>}
    </I18nProvider>
  </React.StrictMode>,
)
