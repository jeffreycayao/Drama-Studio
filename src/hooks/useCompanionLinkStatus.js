import { useEffect, useState } from 'react'

/**
 * companionLink:status, kept current while `active`: on link changes, when
 * the window gets focus and every few seconds, because the Companion connects
 * from the browser while Drama Studio waits (CompanionInstallSteps).
 */
export default function useCompanionLinkStatus(active = true) {
  const api = typeof window !== 'undefined' ? window.electronAPI?.companionLink : null
  const [status, setStatus] = useState(null)

  useEffect(() => {
    if (!api || !active) return undefined
    let alive = true
    const refresh = () => api.status()
      .then((next) => { if (alive && next && next.success !== false) setStatus(next) })
      .catch(() => {})
    refresh()
    const stop = api.onChanged(refresh)
    window.addEventListener('focus', refresh)
    const timer = setInterval(refresh, 3000)
    return () => {
      alive = false
      stop?.()
      window.removeEventListener('focus', refresh)
      clearInterval(timer)
    }
  }, [api, active])

  return status
}
