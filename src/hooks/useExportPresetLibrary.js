import { useCallback, useEffect, useState } from 'react'
import { EXPORT_PRESET_LIBRARY_KEY, readExportPresetLibrary, updateExportPresetLibrary } from '../utils/exportPresetLibrary.mjs'

const CHANGED_EVENT = 'velorn-custom-export-presets-changed'

export default function useExportPresetLibrary() {
  const [library, setLibrary] = useState(() => readExportPresetLibrary())
  const reload = useCallback(() => setLibrary(readExportPresetLibrary()), [])
  useEffect(() => {
    const onStorage = event => { if (event.key === EXPORT_PRESET_LIBRARY_KEY || event.key === null) reload() }
    window.addEventListener('storage', onStorage)
    window.addEventListener(CHANGED_EVENT, reload)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(CHANGED_EVENT, reload)
    }
  }, [reload])
  const update = useCallback(operation => {
    const result = updateExportPresetLibrary(operation)
    if (result.ok) {
      setLibrary(result)
      window.dispatchEvent(new Event(CHANGED_EVENT))
    } else reload()
    return result
  }, [reload])
  return { presets: library.ok ? library.presets : [], error: library.ok ? '' : library.error, update, reload }
}
