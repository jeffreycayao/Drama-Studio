import { useEffect, useState } from 'react'
import PackImportDialog from './PackImportDialog'
import { OPEN_PACK_IMPORT_EVENT, isPackImportAvailable } from '../services/packImport'
import { dragMayCarryPack, findDroppedPack } from '../utils/packImportPlan.mjs'

/**
 * App-wide entry for Import pack: opens the review on OPEN_PACK_IMPORT_EVENT
 * (Generate › My Workflows, the command palette, Help) and when a .zip or
 * .dspack is dropped anywhere. The drop is taken in the capture phase, so the
 * Assets panel and the timeline never see a pack as "unsupported media".
 */
export default function PackImportHost() {
  const [request, setRequest] = useState(null)

  useEffect(() => {
    const onOpen = (event) => setRequest({ filePath: String(event?.detail?.filePath || ''), key: Date.now() })
    // Tabs without their own drop target refuse drops by default; allow zips.
    const onDragOver = (event) => {
      if (isPackImportAvailable() && dragMayCarryPack(event.dataTransfer)) event.preventDefault()
    }
    const onDrop = (event) => {
      if (!isPackImportAvailable()) return
      const file = findDroppedPack(event.dataTransfer)
      if (!file) return
      event.preventDefault()
      event.stopPropagation()
      const filePath = window.electronAPI?.getPathForFile?.(file) || ''
      setRequest({ filePath, key: Date.now() })
    }
    window.addEventListener(OPEN_PACK_IMPORT_EVENT, onOpen)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop, true)
    return () => {
      window.removeEventListener(OPEN_PACK_IMPORT_EVENT, onOpen)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop, true)
    }
  }, [])

  if (!request) return null
  return <PackImportDialog key={request.key} filePath={request.filePath} onClose={() => setRequest(null)} />
}
