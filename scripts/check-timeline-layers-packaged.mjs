// Packaged-app check for timeline layering, over CDP.
// node scripts/check-timeline-layers-packaged.mjs <exe> <profileDir> <projectsDir> <video.mp4> <outDir>
// Starts its own copy with a scratch profile (never the user's), DS_ALLOW_DEVTOOLS=1,
// DS_SKIP_COMFY_GATE=1 and --remote-debugging-port=9334. Make a test video with
// ffmpeg-static: -f lavfi -i testsrc=duration=20:size=640x360:rate=24 -pix_fmt yuv420p
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [exe, profile, projectsDir, video, outDir] = process.argv.slice(2)
const PORT = 9334
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const pass = msg => { results.push(`PASS ${msg}`); console.log(`PASS ${msg}`) }
const fail = msg => { results.push(`FAIL ${msg}`); console.log(`FAIL ${msg}`) }
const check = (cond, msg) => (cond ? pass(msg) : fail(msg))

fs.mkdirSync(profile, { recursive: true })
fs.mkdirSync(projectsDir, { recursive: true })
fs.mkdirSync(outDir, { recursive: true })

const child = spawn(exe, [`--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`], {
  env: { ...process.env, DS_ALLOW_DEVTOOLS: '1', DS_SKIP_COMFY_GATE: '1' }, stdio: 'ignore',
})
console.log('started pid', child.pid)

class Cdp {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map() }
  open() { return new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; this.ws.onmessage = e => {
    const msg = JSON.parse(e.data); const p = this.pending.get(msg.id); if (p) { this.pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result) } } }) }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })) }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }
  close() { try { this.ws.close() } catch {} }
}

async function findPage() {
  for (let i = 0; i < 90; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      for (const t of list.filter(t => t.type === 'page' && !t.url.startsWith('devtools'))) {
        const c = new Cdp(t.webSocketDebuggerUrl); await c.open()
        const ok = await c.eval(`Boolean(document.querySelector('#root')?.children.length) && !location.hash.includes('export')`).catch(() => false)
        if (ok) return c
        c.close()
      }
    } catch {}
    await sleep(1000)
  }
  throw new Error('No app page found over CDP')
}

async function shot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(outDir, name), Buffer.from(data, 'base64'))
}

let cdp
try {
  cdp = await findPage()
  await cdp.send('Page.enable')
  console.log('version', await cdp.eval(`document.title + ' ' + (window.electronAPI ? 'electron' : 'web')`))

  // Find the app's own store instances: re-importing a loaded chunk returns the same module.
  await cdp.eval(`(async () => {
    const urls = [...new Set([...document.scripts].map(s => s.src).concat(performance.getEntriesByType('resource').map(e => e.name)))]
      .filter(u => /\\/assets\\/[^/]+\\.js$/.test(u))
    const found = {}
    for (const url of urls) {
      let mod; try { mod = await import(url) } catch { continue }
      for (const value of Object.values(mod)) {
        if (typeof value !== 'function' || typeof value.getState !== 'function') continue
        const s = value.getState()
        if (s && typeof s.commitLayeredMove === 'function') found.T = value
        if (s && typeof s.createProject === 'function' && typeof s.openProject === 'function') found.P = value
        if (s && typeof s.addAsset === 'function' && Array.isArray(s.assets)) found.A = value
      }
    }
    window.__lc = found
    return Object.keys(found)
  })()`).then(keys => console.log('stores', keys))
  const hasStores = await cdp.eval(`Boolean(window.__lc.T && window.__lc.P && window.__lc.A)`)
  if (!hasStores) throw new Error('Could not reach the app stores')

  // New project in a scratch folder.
  await cdp.eval(`(async () => {
    const { P } = window.__lc
    await P.getState().setDefaultProjectsLocation(${JSON.stringify(projectsDir)})
    return Boolean(await P.getState().createProject({ name: 'Layer check ' + Date.now(), width: 1280, height: 720, fps: 24 }))
  })()`).then(ok => check(ok, 'scratch project created'))
  await sleep(2500)
  // Dismiss the first-run guided tour; it is modal and swallows input.
  for (let i = 0; i < 5; i += 1) {
    const closed = await cdp.eval(`(() => {
      const box = [...document.querySelectorAll('div')].find(d => /\\b\\d+ OF \\d+\\b/i.test(d.textContent || '') && d.querySelector('button') && d.textContent.length < 600)
      if (!box) return false
      const close = [...box.querySelectorAll('button')].find(b => /close|skip|×|✕/i.test((b.getAttribute('aria-label') || '') + b.textContent))
      ;(close || box.querySelector('button')).click(); return true
    })()`)
    if (!closed) break
    await sleep(500)
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(500)
  check(await cdp.eval(`!/\\b1 OF 8\\b/i.test(document.body.innerText)`), 'guided tour dismissed')

  // The reported case: one long video on Video 1, then Add text at the playhead.
  const fileUrl = pathToFileURL(video).href
  await cdp.eval(`(async () => {
    const { T, A } = window.__lc
    const asset = A.getState().addAsset({ name: 'sas.mp4', type: 'video', url: ${JSON.stringify(fileUrl)}, path: ${JSON.stringify(video)},
      duration: 20, hasAudio: false, settings: { duration: 20, fps: 24, width: 640, height: 360 } })
    window.__lc.asset = asset
    T.getState().addClip('video-1', asset, 0, 24)
    T.getState().setPlayheadPosition(8)
    return true
  })()`)
  await sleep(800)
  const clicked = await cdp.eval(`(() => {
    const button = [...document.querySelectorAll('button')].find(b => (b.title || '').startsWith('Add text at the playhead'))
    if (!button) return false
    button.click(); return true
  })()`)
  check(clicked, 'toolbar Add text button found (new tooltip)')
  await sleep(800)
  let state = await cdp.eval(`(() => { const s = window.__lc.T.getState(); return { tracks: s.tracks.map(t => [t.id, t.type, !!t.autoLayer]), clips: s.clips.map(c => [c.id, c.type, c.trackId, c.startTime, c.duration]) } })()`)
  console.log(JSON.stringify(state))
  const videos = state.clips.filter(c => c[1] === 'video')
  const texts = state.clips.filter(c => c[1] === 'text')
  check(videos.length === 1 && Math.abs(videos[0][4] - 20) < 1e-6, 'video clip is whole (not split) after adding text')
  check(texts.length === 1 && texts[0][2] !== 'video-1', `text is on its own layer (${texts[0]?.[2]})`)
  check(state.tracks[0][0] === texts[0]?.[2] && state.tracks[0][2] === true, 'new layer created above the video, marked as auto layer')
  await cdp.eval(`document.activeElement?.blur(); window.__lc.T.getState().clearTextEditRequest?.(); true`)
  await sleep(500)
  await shot(cdp, '1-text-on-layer.png')

  // Undo removes the text and its layer in one step.
  const undone = await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Undo'); if (!b) return false; b.click(); return true })()`)
  await sleep(600)
  state = await cdp.eval(`(() => { const s = window.__lc.T.getState(); return { tracks: s.tracks.map(t => t.id), clips: s.clips.map(c => c.type) } })()`)
  check(undone && !state.clips.includes('text') && !state.tracks.includes('video-2'), `one Undo removes the text and its layer (${JSON.stringify(state)})`)

  // Split cuts only the selected clip.
  await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(b => (b.title || '').startsWith('Add text at the playhead')); b.click(); return true })()`)
  await sleep(600)
  await cdp.eval(`document.activeElement?.blur(); window.__lc.T.getState().clearTextEditRequest?.(); true`)
  const textId = await cdp.eval(`window.__lc.T.getState().clips.find(c => c.type === 'text').id`)
  await cdp.eval(`(() => { const T = window.__lc.T; T.getState().selectClip(${JSON.stringify(textId)}); T.getState().setPlayheadPosition(10); return true })()`)
  await sleep(400)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'x', code: 'KeyX', text: 'x', windowsVirtualKeyCode: 88 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88 })
  await sleep(600)
  state = await cdp.eval(`(() => { const s = window.__lc.T.getState(); return s.clips.map(c => [c.type, c.trackId, c.startTime, c.duration]) })()`)
  console.log(JSON.stringify(state))
  console.log('after X:', await cdp.eval(`JSON.stringify({ active: document.activeElement?.tagName + '.' + (document.activeElement?.className || '').toString().slice(0, 60), dialogs: [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].map(d => (d.textContent || '').slice(0, 80)), selected: window.__lc.T.getState().selectedClipIds, playhead: window.__lc.T.getState().playheadPosition })`))
  if (state.filter(c => c[0] === 'text').length !== 2) {
    const button = await cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(b => (b.title || '').startsWith('Split the selected clip')); if (!b) return 'missing'; if (b.disabled) return 'disabled'; b.click(); return 'clicked' })()`)
    console.log('split button:', button)
    await sleep(600)
    state = await cdp.eval(`(() => { const s = window.__lc.T.getState(); return s.clips.map(c => [c.type, c.trackId, c.startTime, c.duration]) })()`)
    console.log(JSON.stringify(state))
  }
  check(state.filter(c => c[0] === 'text').length === 2, 'Split cut the selected text clip')
  check(state.filter(c => c[0] === 'video').length === 1, 'X did not cut the video on the other layer')

  // Drag a clip onto the video: it lands on a free layer, the video stays whole.
  await cdp.eval(`(() => { const { T } = window.__lc; T.getState().addClip('video-1', window.__lc.asset, 30, 24, { duration: 4 }); T.getState().clearSelection(); T.getState().setPlayheadPosition(0); return true })()`)
  await sleep(800)
  const dragId = await cdp.eval(`window.__lc.T.getState().clips.find(c => c.type === 'video' && c.startTime === 30).id`)
  await cdp.eval(`(() => { const T = window.__lc.T; T.getState().setZoom?.(Math.max(10, T.getState().zoom)); return true })()`)
  await sleep(400)
  const rect = await cdp.eval(`(() => { const el = document.querySelector('[data-clip-id=${JSON.stringify(dragId)}]'); if (!el) return null; el.scrollIntoView({ block: 'nearest', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
  if (!rect) {
    fail('drag: clip element not found')
  } else {
    await sleep(300)
    const r2 = await cdp.eval(`(() => { const r = document.querySelector('[data-clip-id=${JSON.stringify(dragId)}]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
    const pps = r2.w / 4
    const startX = r2.x + r2.w / 2, y = r2.y + r2.h / 2
    const endX = startX - 20 * pps // 30s -> 10s, on top of the video
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX, y })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y, button: 'left', clickCount: 1 })
    for (let i = 1; i <= 12; i += 1) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX + (endX - startX) * i / 12, y, button: 'left', buttons: 1 })
      await sleep(40)
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: endX, y, button: 'left', clickCount: 1 })
    await sleep(800)
    state = await cdp.eval(`(() => { const s = window.__lc.T.getState(); return { tracks: s.tracks.map(t => t.id), clips: s.clips.map(c => [c.id, c.type, c.trackId, c.startTime, c.duration]) } })()`)
    console.log(JSON.stringify(state))
    const dragged = state.clips.find(c => c[0] === dragId)
    const main = state.clips.filter(c => c[1] === 'video' && c[0] !== dragId)
    check(dragged && dragged[3] < 29, `drag moved the clip (now at ${dragged?.[3]})`)
    check(dragged && dragged[2] !== 'video-1', `dragged clip landed on a free layer (${dragged?.[2]})`)
    check(main.length === 1 && Math.abs(main[0][4] - 20) < 1e-6 && main[0][3] === 0, 'clip underneath is not cut')
    await shot(cdp, '2-drag-to-layer.png')
  }

  // Magnetic toggle exists and is off by default.
  const magnetic = await cdp.eval(`(() => { const b = document.querySelector('[data-testid="magnetic-main-track-toggle"]'); return b ? b.getAttribute('aria-pressed') : 'missing' })()`)
  check(magnetic === 'false', `Main track toggle present and off (${magnetic})`)
} catch (error) {
  fail(`error: ${error.message}`)
} finally {
  try {
    const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
    const browser = new Cdp(version.webSocketDebuggerUrl)
    await Promise.race([browser.open().then(() => browser.send('Browser.close')), sleep(3000)]).catch(() => {})
  } catch {}
  cdp?.close()
  await sleep(1500)
  try { child.kill() } catch {}
  fs.writeFileSync(path.join(outDir, 'results.txt'), results.join('\n') + '\n')
  console.log(results.filter(r => r.startsWith('FAIL')).length ? 'SOME CHECKS FAILED' : 'ALL CHECKS PASSED')
  process.exit(0)
}
