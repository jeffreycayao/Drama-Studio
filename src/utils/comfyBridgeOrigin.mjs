const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const defaultPort = protocol => (protocol === 'https:' ? '443' : '80')

/** Workflows posted by the ComfyUI bridge are trusted only from the local
 * ComfyUI this app connects to: a loopback origin on the configured port.
 * `localhost` and `127.0.0.1` are the same host. Anything else (another
 * frame, a popup, a page on another port) is ignored. */
export function isTrustedComfyBridgeOrigin(origin, httpBase) {
  if (typeof origin !== 'string' || !origin || origin === 'null') return false
  try {
    const from = new URL(origin)
    const base = new URL(httpBase)
    if (!['http:', 'https:'].includes(from.protocol) || from.protocol !== base.protocol) return false
    if (!LOOPBACK.has(from.hostname) || !LOOPBACK.has(base.hostname)) return false
    return (from.port || defaultPort(from.protocol)) === (base.port || defaultPort(base.protocol))
  } catch {
    return false
  }
}
