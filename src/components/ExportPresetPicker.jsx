import { useEffect, useState } from 'react'
import { Check, Film, Play, Send } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import useExportPresetLibrary from '../hooks/useExportPresetLibrary'
import { matchCustomExportPreset, readExportPresetLibrary, validateCustomExportPresetSettings, MAX_CUSTOM_EXPORT_PRESETS } from '../utils/exportPresetLibrary.mjs'
import ExportPresetDialog from './ExportPresetDialog'

const TILE_DETAILS = {
  'youtube-1080p': 'Up to HD · MP4',
  'youtube-4k': 'Up to 4K · MP4',
  'h264-master': 'High-quality MP4',
  'prores-master': 'ProRes HQ · MOV',
  'review-copy': 'Small, quick sharing',
}

export default function ExportPresetPicker({ presets, activePresetId, hardwareLabel, onApply, settings, active = true, sessionKey = '' }) {
  const { t } = useI18n()
  const library = useExportPresetLibrary()
  const [dialog, setDialog] = useState(null)
  const [selectedId, setSelectedId] = useState('')
  const [status, setStatus] = useState('')
  useEffect(() => { setDialog(null); setStatus('') }, [active, sessionKey])
  const selectedPreset = library.presets.find(preset => preset.id === selectedId)
  const activeCustomPreset = matchCustomExportPreset(selectedPreset ? [selectedPreset] : [], settings)
    || matchCustomExportPreset(library.presets, settings)
  const managedPreset = selectedPreset || activeCustomPreset
  const recommended = presets.filter(item => Object.hasOwn(TILE_DETAILS, item.id))
  const activePreset = presets.find(item => item.id === activePresetId)
  const presetLabel = item => Object.hasOwn(TILE_DETAILS, item.id)
    ? t(`export.deliveryPresets.items.${item.id}.label`, undefined, item.label)
    : item.label.replace('NVENC', hardwareLabel)
  const presetSummary = item => Object.hasOwn(TILE_DETAILS, item.id)
    ? t(`export.deliveryPresets.items.${item.id}.summary`, undefined, item.summary)
    : t('export.presetSummaries.' + item.id, { hardware: hardwareLabel }, item.summary)

  const openSave = () => {
    const result = validateCustomExportPresetSettings(settings)
    if (!result.ok) { setStatus(result.error); return }
    setStatus('')
    setDialog({ mode: 'save', settings: result.settings, sessionKey })
  }
  const applySaved = id => {
    const latest = readExportPresetLibrary()
    const preset = latest.ok && latest.presets.find(entry => entry.id === id)
    if (!preset) { library.reload(); setStatus(latest.error || 'This preset was removed. Choose another preset.'); return }
    setSelectedId(id)
    setStatus('')
    onApply({ id: preset.id, label: preset.name, settings: preset.settings, custom: true })
  }
  const submitDialog = name => {
    if (!active || !dialog || dialog.sessionKey !== sessionKey) return { ok: false, error: 'The workspace changed. Close this dialog and try again.' }
    const result = library.update({ type: dialog.mode, name, settings: dialog.settings,
      id: dialog.preset?.id, expected: dialog.preset })
    if (result.ok) {
      setSelectedId(result.preset?.id || '')
      setStatus(dialog.mode === 'delete' ? 'Preset deleted. Current export settings are unchanged.' : dialog.mode === 'rename' ? 'Preset renamed.' : 'Preset saved for use across projects on this device.')
      setDialog(null)
    }
    return result
  }

  return <div className="export-presets space-y-2.5" data-testid="export-preset-picker">
    <h3 className="text-[11px] font-medium text-sf-text-secondary">
      {t('export.deliveryPresets.title', undefined, 'Delivery presets')}
    </h3>
    <div className="export-presets__tiles" role="group" aria-label={t('export.deliveryPresets.title', undefined, 'Delivery presets')}>
      {recommended.map(item => {
        const selected = !activeCustomPreset && activePresetId === item.id
        const Icon = item.id.startsWith('youtube-') ? Play : item.id === 'review-copy' ? Send : Film
        return <button type="button" key={item.id} data-testid={'export-preset-' + item.id}
          className="export-preset-tile" aria-pressed={selected} aria-label={presetLabel(item)}
          title={presetSummary(item)} onClick={() => onApply(item)}>
          <Icon size={15} className="export-preset-tile__icon shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="export-preset-tile__name">{presetLabel(item)}</span>
            <span className="export-preset-tile__detail">{t(`export.deliveryPresets.items.${item.id}.detail`, undefined, TILE_DETAILS[item.id])}</span>
          </span>
          {selected && <Check size={12} className="export-preset-tile__check" aria-hidden="true" />}
        </button>
      })}
    </div>
    <div data-testid="export-active-preset" className="export-help">
      <span className="font-medium text-sf-text-secondary">{activeCustomPreset ? activeCustomPreset.name : activePreset
        ? presetLabel(activePreset) : t('export.workspace.customPreset', undefined, 'Custom settings')}</span>
      <p>{activeCustomPreset ? 'Saved preset · ' + activeCustomPreset.settings.format.toUpperCase() : activePreset ? presetSummary(activePreset)
        : t('export.deliveryPresets.customHelp', undefined, 'Adjust the settings below, or choose a preset as a starting point.')}</p>
    </div>
    <details className="export-presets__more">
      <summary>{t('export.deliveryPresets.more', undefined, 'More presets')}</summary>
      <div className="export-field mt-2">
        <label htmlFor="export-preset-choice">{t('export.presets')}</label>
        <select id="export-preset-choice" value={activeCustomPreset ? '' : activePresetId || ''}
          onChange={event => onApply(presets.find(item => item.id === event.target.value))}>
          <option value="" disabled>{t('export.workspace.customPreset', undefined, 'Custom settings')}</option>
          {presets.map(item => <option key={item.id} value={item.id}>{presetLabel(item)}</option>)}
        </select>
      </div>
    </details>
    <div className="space-y-2 border-t border-sf-dark-700 pt-2.5" data-testid="export-custom-presets">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="export-saved-preset-choice" className="text-[11px] font-medium text-sf-text-secondary">My presets</label>
        <button type="button" className="export-action export-action--quiet" data-testid="export-preset-save"
          disabled={Boolean(library.error) || library.presets.length >= MAX_CUSTOM_EXPORT_PRESETS} onClick={openSave}>Save as preset…</button>
      </div>
      <div className="export-field">
        <select id="export-saved-preset-choice" value={managedPreset?.id || ''} disabled={!library.presets.length}
          onChange={event => applySaved(event.target.value)}>
          <option value="" disabled>{library.presets.length ? 'Choose a saved preset' : 'No saved presets yet'}</option>
          {library.presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
        </select>
      </div>
      {managedPreset && <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="export-action export-action--quiet !px-2" onClick={() => applySaved(managedPreset.id)}>Apply</button>
        <button type="button" className="export-action export-action--quiet !px-2" onClick={() => setDialog({ mode: 'rename', preset: managedPreset, sessionKey })}>Rename…</button>
        <button type="button" className="export-action export-action--quiet !px-2" onClick={() => setDialog({ mode: 'delete', preset: managedPreset, sessionKey })}>Delete…</button>
      </div>}
      <p className="export-help">Saved on this device, across projects. Filenames, ranges and folders stay with the current export.</p>
      {library.presets.length >= MAX_CUSTOM_EXPORT_PRESETS && <p className="export-help">{MAX_CUSTOM_EXPORT_PRESETS}-preset limit reached. Delete a preset to save another.</p>}
      {library.error && <div role="alert" className="text-xs text-sf-error">{library.error}
        <button type="button" className="export-action mt-2" onClick={library.reload}>Retry</button>
      </div>}
      {status && <p role="status" aria-live="polite" className="export-help">{status}</p>}
    </div>
    {active && dialog?.sessionKey === sessionKey && <ExportPresetDialog session={dialog} onSubmit={submitDialog} onClose={() => setDialog(null)} />}
  </div>
}
