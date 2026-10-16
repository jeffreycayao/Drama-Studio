// Must stay first: migrates pre-rename localStorage keys before any store reads them.
import './services/legacyStorageMigration'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ExportWorker from './components/ExportWorker'
import ComfySetupGate from './components/ComfySetupGate'
import { applyTheme, getStoredThemeId } from './config/themes'
import { I18nProvider } from './i18n/I18nContext'
import './index.css'

const isExportWorker = typeof window !== 'undefined' && window.location.search.includes('export=worker')

applyTheme(getStoredThemeId())

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      {isExportWorker ? <ExportWorker /> : <ComfySetupGate><App /></ComfySetupGate>}
    </I18nProvider>
  </React.StrictMode>,
)
