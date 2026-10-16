// Content-Security-Policy for the packaged renderer (main window and export
// worker both load dist/index.html).
//
// The policy is injected into the built index.html only. The Vite dev server
// injects inline HMR/React-refresh scripts that a strict script-src would
// block, and dev runs load from http://127.0.0.1, not file://.
//
// What it protects: script-src 'self' means only our own bundled files run.
// Injected <script> tags, inline handlers, eval and scripts from any remote
// host are refused, and plugins (<object>/<embed>) and <base> rewrites are off.
//
// What it leaves open on purpose: images, media and fetch/WebSocket traffic
// may use any http(s) host. Project media is file:/comfystudio:/blob:, the
// stock providers (Pexels, Pixabay, Unsplash, Openverse, NASA, Wikimedia)
// return images from hosts we don't control, and ComfyUI, LM Studio and
// Ollama base URLs are user-configurable. Remote frames are limited to local
// ComfyUI and YouTube embeds (Discover).
import { createHash } from 'node:crypto'

export const CSP_DIRECTIVES = Object.freeze({
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
  'img-src': ["'self'", 'data:', 'blob:', 'file:', 'comfystudio:', 'http:', 'https:'],
  'media-src': ["'self'", 'data:', 'blob:', 'file:', 'comfystudio:', 'http:', 'https:'],
  'connect-src': ["'self'", 'data:', 'blob:', 'file:', 'comfystudio:', 'http:', 'https:', 'ws:', 'wss:'],
  'frame-src': [
    "'self'",
    'http://127.0.0.1:*',
    'http://localhost:*',
    'https://www.youtube-nocookie.com',
    'https://www.youtube.com',
  ],
  'worker-src': ["'self'", 'blob:'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'none'"],
})

/** Inline <script> bodies (no src attribute) in an HTML document. */
export function findInlineScripts(html) {
  const scripts = []
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  let match
  while ((match = pattern.exec(html))) {
    if (/\bsrc\s*=/i.test(match[1])) continue
    if (match[2].trim()) scripts.push(match[2])
  }
  return scripts
}

// The browser hashes the script text after HTML parsing, which turns CRLF and
// lone CR into LF (index.html is checked out with CRLF on Windows).
export function hashInlineScript(body) {
  const parsed = body.replace(/\r\n?/g, '\n')
  return `'sha256-${createHash('sha256').update(parsed, 'utf8').digest('base64')}'`
}

export function buildContentSecurityPolicy({ inlineScriptHashes = [] } = {}) {
  return Object.entries(CSP_DIRECTIVES)
    .map(([name, sources]) => {
      const values = name === 'script-src' ? [...sources, ...inlineScriptHashes] : sources
      return `${name} ${values.join(' ')}`
    })
    .join('; ')
}

/** Add the CSP <meta> right after <meta charset> (the charset must stay in the
 * first 1024 bytes), allowing the page's own inline scripts (the pre-paint
 * theme script) by hash. */
export function injectContentSecurityPolicy(html) {
  const inlineScriptHashes = findInlineScripts(html).map(hashInlineScript)
  const policy = buildContentSecurityPolicy({ inlineScriptHashes })
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`
  const anchor = /<meta\s+charset=[^>]*>/i.test(html) ? /<meta\s+charset=[^>]*>/i : /<head[^>]*>/i
  if (!anchor.test(html)) throw new Error('index.html has no <head> for the Content-Security-Policy')
  return html.replace(anchor, (tag) => `${tag}\n    ${meta}`)
}

export default function contentSecurityPolicyPlugin() {
  return {
    name: 'drama-studio-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => injectContentSecurityPolicy(html),
    },
  }
}
