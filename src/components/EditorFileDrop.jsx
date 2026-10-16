import { useEffect, useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import useProjectStore from '../stores/projectStore'
import { getDroppedMediaFiles, hasDesktopFiles, importMediaFiles } from '../services/mediaFileImport'

/**
 * Editor-wide drop target for files from the desktop. The Assets panel and
 * the timeline handle their own drops (and call preventDefault); anything
 * dropped elsewhere in the Editor (preview, inspector, empty space) is
 * imported into the bin here instead of being ignored.
 */
export default function EditorFileDrop() {
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState('')
  const depth = useRef(0)
  const noticeTimer = useRef(null)

  useEffect(() => {
    const show = text => {
      setNotice(text)
      clearTimeout(noticeTimer.current)
      noticeTimer.current = setTimeout(() => setNotice(''), 4000)
    }
    const onDragEnter = event => {
      if (!hasDesktopFiles(event.dataTransfer)) return
      depth.current += 1
      setDragging(true)
    }
    const onDragLeave = event => {
      if (!hasDesktopFiles(event.dataTransfer)) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setDragging(false)
    }
    // Allow dropping files anywhere in the Editor (the default is "no drop").
    const onDragOver = event => {
      if (!hasDesktopFiles(event.dataTransfer)) return
      event.preventDefault()
    }
    const onDrop = async event => {
      depth.current = 0
      setDragging(false)
      if (!hasDesktopFiles(event.dataTransfer)) return
      if (event.defaultPrevented) return // A panel or the timeline took it.
      event.preventDefault()
      const { media, skipped } = getDroppedMediaFiles(event.dataTransfer)
      const projectHandle = useProjectStore.getState().currentProjectHandle
      if (!projectHandle) { show('Open a project before importing media.'); return }
      if (!media.length) { show(skipped.length ? `Unsupported file type: ${skipped.slice(0, 3).join(', ')}` : 'Nothing to import.'); return }
      show(`Importing ${media.length} file${media.length === 1 ? '' : 's'}…`)
      try {
        const { assets, failed } = await importMediaFiles(media, { projectHandle })
        const problems = [...failed.map(item => item.name), ...skipped]
        show(`Added ${assets.length} file${assets.length === 1 ? '' : 's'} to the Assets panel${problems.length ? `; skipped ${problems.slice(0, 3).join(', ')}` : ''}. Drag them onto the timeline.`)
      } catch (error) { show(error?.message || 'The files could not be imported.') }
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      clearTimeout(noticeTimer.current)
    }
  }, [])

  return <>
    {dragging && <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center" data-testid="editor-file-drop-hint">
      <div className="flex items-center gap-2 rounded-full border border-sf-accent bg-sf-dark-900/95 px-4 py-2 text-xs text-sf-text-primary shadow-xl">
        <FileUp className="h-4 w-4 text-sf-accent" />Drop on a track to place it, on Assets to import, or anywhere to add it to the bin
      </div>
    </div>}
    {notice && !dragging && <div role="status" className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center" data-testid="editor-file-drop-notice">
      <div className="rounded-full border border-sf-dark-600 bg-sf-dark-900/95 px-4 py-2 text-xs text-sf-text-secondary shadow-xl">{notice}</div>
    </div>}
  </>
}
