// Reuse the real Timeline, Inspector and in-memory synthetic-media harness.
// The separate bin exercises real EffectsPanel dragstart payloads without
// loading production main, a user project, a filesystem bridge, or MCP.
import './compound-clips.jsx'
import React from 'react'
import { createRoot } from 'react-dom/client'
import EffectsPanel from '../../src/components/panels/EffectsPanel'
import { I18nProvider } from '../../src/i18n/I18nContext'

const bin = document.createElement('div')
bin.id = 'fixture-effects-bin'
Object.assign(bin.style, { position: 'fixed', top: '8px', left: '8px', width: '250px',
  height: '360px', overflow: 'auto', zIndex: '10', background: '#141418' })
document.body.appendChild(bin)
createRoot(bin).render(<I18nProvider><EffectsPanel /></I18nProvider>)
