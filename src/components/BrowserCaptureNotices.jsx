import { useEffect } from 'react'
import { X } from 'lucide-react'
import useBrowserJobsStore from '../stores/browserJobsStore'

const NOTICE_MS = 6000

function Notice({ notice }) {
  const dismiss = useBrowserJobsStore((state) => state.dismissNotice)
  useEffect(() => {
    const timer = setTimeout(() => dismiss(notice.id), notice.tone === 'error' ? NOTICE_MS * 2 : NOTICE_MS)
    return () => clearTimeout(timer)
  }, [dismiss, notice.id, notice.tone])
  const accent = notice.tone === 'error' ? 'bg-red-500' : notice.tone === 'success' ? 'bg-sf-accent' : 'bg-sf-dark-500'
  return (
    <div role="status" className="pointer-events-auto flex items-start gap-2 rounded-xl border border-sf-dark-600 bg-sf-dark-900/95 p-3 text-xs shadow-2xl shadow-black/40 backdrop-blur">
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${accent}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-sf-text-primary">{notice.title}</div>
        {notice.detail && <div className="mt-0.5 text-[10px] text-sf-text-muted">{notice.detail}</div>}
      </div>
      <button type="button" onClick={() => dismiss(notice.id)} className="text-sf-text-muted hover:text-sf-text-primary" aria-label="Dismiss">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/** Short notices for files that arrive from the browser. */
export default function BrowserCaptureNotices() {
  const notices = useBrowserJobsStore((state) => state.notices)
  if (!notices.length) return null
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex w-[min(360px,calc(100vw-32px))] flex-col gap-2">
      {notices.map((notice) => <Notice key={notice.id} notice={notice} />)}
    </div>
  )
}
