import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildContentSecurityPolicy,
  findInlineScripts,
  hashInlineScript,
  injectContentSecurityPolicy,
} from '../scripts/vite-csp-plugin.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function directives(policy) {
  return Object.fromEntries(policy.split(';').map((part) => {
    const [name, ...values] = part.trim().split(/\s+/)
    return [name, values]
  }))
}

test('renderer CSP only runs our own scripts', () => {
  const policy = directives(buildContentSecurityPolicy({ inlineScriptHashes: ["'sha256-abc='"] }))
  assert.deepEqual(policy['script-src'], ["'self'", "'sha256-abc='"])
  assert.deepEqual(policy['object-src'], ["'none'"])
  assert.deepEqual(policy['base-uri'], ["'self'"])
  for (const values of Object.values(policy)) {
    assert.ok(!values.includes("'unsafe-eval'"))
  }
  assert.ok(!policy['script-src'].includes("'unsafe-inline'"))
})

test('renderer CSP keeps local media, ComfyUI and stock hosts reachable', () => {
  const policy = directives(buildContentSecurityPolicy())
  for (const scheme of ['file:', 'blob:', 'data:', 'comfystudio:', 'https:']) {
    assert.ok(policy['img-src'].includes(scheme), `img-src ${scheme}`)
    assert.ok(policy['media-src'].includes(scheme), `media-src ${scheme}`)
    assert.ok(policy['connect-src'].includes(scheme), `connect-src ${scheme}`)
  }
  assert.ok(policy['connect-src'].includes('http:'))
  assert.ok(policy['connect-src'].includes('ws:'))
  assert.ok(policy['frame-src'].includes('http://127.0.0.1:*'))
  assert.ok(policy['frame-src'].includes('https://www.youtube-nocookie.com'))
})

test('the CSP meta follows <meta charset> and allows index.html inline scripts by hash', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  const scripts = findInlineScripts(html)
  assert.equal(scripts.length, 1, 'only the pre-paint theme script is inline')
  const out = injectContentSecurityPolicy(html)
  assert.match(out, /<meta charset="UTF-8" \/>\r?\n\s*<meta http-equiv="Content-Security-Policy"/)
  assert.ok(out.includes(hashInlineScript(scripts[0])))
  assert.ok(out.indexOf('<meta charset') < 1024)
})

test('inline script hashes match the browser for CRLF files', () => {
  // Chromium hashes the parsed text, where CRLF is already LF.
  assert.equal(hashInlineScript('\r\n  a()\r\n'), hashInlineScript('\n  a()\n'))
  assert.equal(hashInlineScript('\n  a()\n'), "'sha256-XrdTP8w9c7chErqwKZtQigpcknxM1M8OQbe/Sw5+Yls='")
})
