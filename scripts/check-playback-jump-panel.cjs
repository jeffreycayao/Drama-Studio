// Functional smoke of the actual PreviewPanel cache/live branches. This is
// neither an export parity test nor an FPS benchmark. All media is synthetic,
// cache lookup is memory-only, and PreviewPanel owns the only transport clock.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const base = process.env.VELORN_TEST_URL || 'http://127.0.0.1:5193'
const native = process.env.VELORN_TEST_ELECTRON === '1'
const output = process.env.VELORN_PANEL_SMOKE_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-panel-jumps-'))

function media(start = 0, duration = 12) {
  const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static')
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=12', '-vf', `trim=start=${start}:duration=${duration},setpts=PTS-STARTPTS`,
    '-an', '-r', '24', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-g', '96', '-keyint_min', '96', '-sc_threshold', '0',
    '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'],
  { timeout: 60000, maxBuffer: 24 * 1024 * 1024 })
  assert.equal(result.status, 0, String(result.stderr))
  // trim/setpts may drop the input's rate hint. Verify the actual muxed stream,
  // never infer encoded FPS from the generator arguments or fixture settings.
  const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', 'pipe:0'], { input: result.stdout, encoding: 'utf8', timeout: 10000 })
  const stream = String(probe.stderr).split('\n').find(line => line.includes('Video:')) || ''
  assert.equal(Number(stream.match(/(?:,|\s)([\d.]+) fps(?:,|\s|$)/)?.[1]), 24, `Actual synthetic stream must be 24 fps: ${stream}`)
  return result.stdout.toString('base64')
}
const difference = (a, b) => a.reduce((sum, value, i) => sum + (i % 4 === 3 ? 0 : Math.abs(value - b[i])), 0) / (96 * 54 * 3)

async function main() {
  const encoded = { source: media(), first: media(2, 2), second: media(6, 2) }
  const browser = native ? await _electron.launch({ executablePath: require('electron'),
    args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')], env: { ...process.env, VELORN_TEST_URL: base } })
    : await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true })
  let releaseMissing, diagnosticPage
  try {
    const page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    diagnosticPage = page
    page.setDefaultTimeout(12000)
    if (native) await browser.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
    const errors = []
    page.on('pageerror', error => { errors.push(error.message); console.error('Renderer:', error.message) })
    await page.routeWebSocket(url => url.hostname === new URL(base).hostname && url.port === new URL(base).port, socket => socket.close())
    const missingWait = new Promise(resolve => { releaseMissing = resolve })
    await page.route('**/__panel_delayed_missing__.mp4', async route => {
      await missingWait
      await route.fulfill({ status: 404, contentType: 'video/mp4', body: '' }).catch(() => {})
    })
    await page.addInitScript(() => {
      const frames = new Map(), original = HTMLVideoElement.prototype.requestVideoFrameCallback
      HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
        return original.call(this, (now, metadata) => { frames.set(this, metadata.mediaTime); callback(now, metadata) })
      }
      window.panelFrames = frames
    })
    await page.goto(`${base}/tests/fixtures/playback-jump-panel.html`)
    await page.waitForFunction(() => Boolean(window.panelTest))
    await page.evaluate(value => window.panelTest.initializeMedia(value), encoded)
    await page.waitForFunction(() => window.panelTest.getPreviewFrameSnapshot()?.time === 1)
    const panel = page.getByTestId('actual-preview-panel')
    const transport = page.getByTestId('actual-transport-controls')
    async function clickTime(time) {
      const point = await page.evaluate(time => {
        const viewport = document.querySelector('[data-testid="timeline-viewport"]'), ruler = document.querySelector('[data-testid="timeline-scrub-ruler"]')
        const rect = viewport.getBoundingClientRect(), rr = ruler.getBoundingClientRect()
        return { x: rect.left + time * window.panelTest.timeline.getState().zoom / 5 - viewport.scrollLeft, y: rr.top + rr.height / 2 }
      }, time)
      await page.mouse.click(point.x, point.y)
    }
    async function pausedAt(time) {
      if (await page.evaluate(() => window.panelTest.timeline.getState().isPlaying)) await transport.locator('button[title^="Pause"]').click()
      await clickTime(time)
      await page.waitForFunction(time => {
        const video = document.querySelector('[data-testid="actual-preview-panel"] video[data-preview-popout-source="video"]')
        const state = window.panelTest.timeline.getState()
        return Math.abs(state.playheadPosition - time) < 1e-6 && (video ? video.readyState >= 2 && !video.seeking : Math.abs((window.panelTest.getPreviewFrameSnapshot()?.time ?? -1) - time) < 1e-6)
      }, time)
    }
    async function play() {
      const start = await page.evaluate(() => window.panelTest.timeline.getState().playheadPosition)
      await transport.locator('button[title^="Play •"]').click()
      await page.waitForFunction(start => window.panelTest.timeline.getState().playheadPosition > start + .08, start)
    }
    // This is the production UI's reuse branch, not direct React-state/cache injection.
    for (const [start, end] of [[2, 4], [6, 8], [10, 12]]) {
      await page.evaluate(([inPoint, outPoint]) => window.panelTest.timeline.setState({ inPoint, outPoint, rangeRenderState: null }), [start, end])
      await panel.getByRole('button', { name: 'Render In→Out', exact: true }).click()
      await page.waitForFunction(([start, end]) => {
        const range = window.panelTest.timeline.getState().rangeRenderState
        return range?.status === 'cached' && range.rangeStart === start && range.rangeEnd === end
      }, [start, end])
    }
    await page.evaluate(() => {
      const t = window.panelTest, canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 54
      const context = canvas.getContext('2d', { willReadFrequently: true })
      const capture = () => {
        const panel = document.querySelector('[data-testid="actual-preview-panel"]')
        const video = panel.querySelector('video[data-preview-popout-source="video"]'), live = t.getPreviewFrameSnapshot()
        const source = video || live?.canvas, cover = panel.querySelector('canvas[aria-hidden="true"]')
        context.clearRect(0, 0, 96, 54)
        if (source && (source.videoWidth || source.width)) context.drawImage(source, 0, 0, 96, 54)
        const pixels = [...context.getImageData(0, 0, 96, 54).data]
        let coverLight = null
        if (cover?.style.display === 'block') {
          context.clearRect(0, 0, 96, 54); context.drawImage(cover, 0, 0, 96, 54)
          const held = context.getImageData(0, 0, 96, 54).data
          coverLight = held.reduce((sum, value, index) => sum + (index % 4 === 3 ? 0 : value), 0) / (96 * 54 * 3)
        }
        return { at: performance.now(), cached: Boolean(video), url: video?.src,
          sourceTime: video?.currentTime, pts: video ? window.panelFrames.get(video) : null,
          frameTime: live?.time, frameWidth: live?.canvas?.width, frameHeight: live?.canvas?.height, cover: cover?.style.display, coverLight,
          decoded: [...window.panelFrames].filter(([element]) => element.src && element.dataset.reference !== 'true')
            .map(([element, pts]) => ({ src: element.src, pts, time: element.currentTime, seeking: element.seeking })),
          pixels }
      }
      const d = window.panelDiagnostic = { records: [], landings: [], capture }
      t.timeline.subscribe((state, previous) => {
        if (state.playbackJump === previous.playbackJump && state.isPlaying === previous.isPlaying) return
        const snapshot = { ...capture(), timeline: state.playheadPosition, playing: state.isPlaying,
          token: state.playbackJump?.token, target: state.playbackJump?.targetTime, requestedAt: state.playbackJump?.requestedAt,
          error: state.playbackJumpError }
        d.records.push(snapshot)
        if (previous.playbackJump && !state.playbackJump && state.isPlaying) {
          d.landings.push({ ...snapshot, token: previous.playbackJump.token, target: previous.playbackJump.targetTime })
        }
      })
      t.markProjectClean()
      d.before = JSON.stringify(t.timeline.getState().getProjectData())
    })
    async function exactReference(time, cached) {
      return page.evaluate(async ({ time, cached }) => {
        const t = window.panelTest, start = cached ? (time < 4 ? 2 : 6) : 0
        const url = cached ? t.cacheUrls.get(start === 2 ? '48_96' : '144_192') : t.assets.getState().assets[0].url
        const frame = Math.floor((time - start) * 24 + 1e-7), video = document.createElement('video'); video.muted = true; video.dataset.reference = 'true'
        await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('Reference metadata failed')); video.src = url; video.load() })
        const pts = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Reference picture timed out')), 10000)
          const arm = () => video.requestVideoFrameCallback((now, metadata) => {
            if (Math.round(metadata.mediaTime * 24) === frame) { clearTimeout(timeout); resolve(metadata.mediaTime) } else arm()
          })
          arm(); video.currentTime = (frame + .5) / 24
        })
        const settings = t.project.getState().getCurrentTimelineSettings()
        const full = document.createElement('canvas'); full.width = settings.width; full.height = settings.height
        full.getContext('2d').drawImage(video, 0, 0, full.width, full.height)
        const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 54
        const ctx = canvas.getContext('2d'); ctx.drawImage(cached ? video : full, 0, 0, 96, 54)
        const result = { pts, frame, width: full.width, height: full.height, pixels: [...ctx.getImageData(0, 0, 96, 54).data] }
        video.removeAttribute('src'); video.load()
        return result
      }, { time, cached })
    }
    const results = []
    for (const spec of [
      { name: 'cold live to cached', start: 1, target: 2.75, cached: true },
      { name: 'cached to live', start: 2.25, target: 4.75, cached: false },
      { name: 'cached to different cached', start: 2.25, target: 6.75, cached: true },
    ]) {
      await pausedAt(spec.start); await play()
      await page.evaluate(() => { window.panelDiagnostic.records = []; window.panelDiagnostic.landings = [] })
      await clickTime(spec.target)
      await page.waitForFunction(target => window.panelDiagnostic.landings.some(landing => Math.abs(landing.target - target) < 1e-6), spec.target, { timeout: 6000 })
      await page.waitForFunction(target => window.panelTest.timeline.getState().playheadPosition > target + .08, spec.target)
      await transport.locator('button[title^="Pause"]').click()
      const evidence = await page.evaluate(() => ({ records: window.panelDiagnostic.records, landing: window.panelDiagnostic.landings.at(-1),
        cover: window.panelDiagnostic.capture().cover, error: window.panelTest.timeline.getState().playbackJumpError }))
      const landing = evidence.landing, request = evidence.records.find(record => record.token === landing.token)
      assert.ok(request, `${spec.name}: a real explicit handoff was observed`)
      assert.equal(request.cover, 'block', `${spec.name}: previous picture cover installed synchronously`)
      assert.ok(request.coverLight > 5, `${spec.name}: held cover contains the previous picture`)
      assert.equal(landing.cached, spec.cached)
      assert.equal(landing.timeline, spec.target, `${spec.name}: exact frozen target at acknowledgement`)
      assert.equal(landing.cover, 'none', `${spec.name}: cover released after landing`)
      assert.equal(evidence.cover, 'none'); assert.equal(evidence.error, null)
      const reference = await exactReference(spec.target, spec.cached)
      let decodedPTS = landing.pts
      if (spec.cached) assert.equal(Math.round(landing.pts * 24), reference.frame, `${spec.name}: decoded cached target PTS`)
      else {
        assert.equal(landing.frameTime, spec.target, `${spec.name}: committed live composite time`)
        assert.equal(landing.frameWidth, reference.width); assert.equal(landing.frameHeight, reference.height)
        const url = await page.evaluate(() => window.panelTest.assets.getState().assets[0].url)
        const decoded = landing.decoded.find(video => video.src === url && Math.round(video.pts * 24) === reference.frame && !video.seeking)
        assert.ok(decoded,
          `${spec.name}: live source decoded target PTS (${JSON.stringify(landing.decoded)})`)
        decodedPTS = decoded.pts
      }
      const pictureDifference = difference(landing.pixels, reference.pixels)
      assert.ok(pictureDifference < 1.5, `${spec.name}: exact decoded picture difference ${pictureDifference}`)
      results.push({ name: spec.name, token: landing.token, latencyMs: landing.at - request.at, cached: spec.cached,
        decodedPTS, referencePTS: reference.pts, pictureDifference, heldCoverLight: request.coverLight })
      console.log(`PASS: ${spec.name}; exact landing and cover release`)
    }
    // Deliberately withhold cached bytes: this exercises the real five-second
    // watchdog and visible status/error, rather than immediately firing error.
    await pausedAt(2.25); await play()
    await page.evaluate(() => { window.panelDiagnostic.records = []; window.panelDiagnostic.landings = [] })
    await clickTime(10.75)
    await panel.getByRole('status').filter({ hasText: 'Loading playback position' }).waitFor()
    const pending = await page.evaluate(() => ({ state: { ...window.panelTest.timeline.getState().playbackJump },
      playing: window.panelTest.timeline.getState().isPlaying, at: performance.now(), ...window.panelDiagnostic.capture() }))
    assert.equal(pending.playing, true); assert.equal(pending.state.targetTime, 10.75); assert.equal(pending.cover, 'block')
    assert.ok(pending.coverLight > 5, 'delayed cached landing retains a non-black previous picture')
    await page.screenshot({ path: path.join(output, 'loading-cached-position.png') })
    await panel.getByRole('alert').waitFor({ timeout: 7000 })
    await page.screenshot({ path: path.join(output, 'playback-timeout-alert.png') })
    const terminal = await page.evaluate(() => {
      const state = window.panelTest.timeline.getState()
      return { at: performance.now(), playing: state.isPlaying, pending: state.playbackJump, error: state.playbackJumpError,
        time: state.playheadPosition, records: window.panelDiagnostic.records, cover: window.panelDiagnostic.capture().cover }
    })
    assert.equal(terminal.playing, false); assert.equal(terminal.pending, null); assert.equal(terminal.time, 10.75)
    assert.match(terminal.error, /did not become ready/); assert.equal(terminal.cover, 'none')
    const failed = terminal.records.find(record => record.error)
    const requested = terminal.records.find(record => record.token === pending.state.token)
    assert.ok(failed.at - requested.at >= 4800 && failed.at - requested.at < 6500, 'bounded five-second timeout')
    assert.equal(await panel.getByRole('status').filter({ hasText: 'Loading playback position' }).count(), 0)
    // Retry still uses Play, and must allocate a fresh deadline, not acknowledge
    // the old token while the same unavailable cache video remains mounted.
    await transport.locator('button[title^="Play •"]').click()
    await page.waitForFunction(old => { const next = window.panelTest.timeline.getState().playbackJump; return next && next.token !== old }, pending.state.token)
    const retry = await page.evaluate(() => ({ ...window.panelTest.timeline.getState().playbackJump }))
    assert.equal(retry.targetTime, 10.75); assert.ok(retry.requestedAt > pending.state.requestedAt)
    await transport.locator('button[title^="Pause"]').click()
    releaseMissing()
    await page.waitForTimeout(150)
    const after = await page.evaluate(() => ({ playing: window.panelTest.timeline.getState().isPlaying,
      pending: window.panelTest.timeline.getState().playbackJump, error: window.panelTest.timeline.getState().playbackJumpError,
      cover: window.panelDiagnostic.capture().cover, bridge: window.panelTest.bridgeCalls,
      before: window.panelDiagnostic.before, after: JSON.stringify(window.panelTest.timeline.getState().getProjectData()),
      dirty: window.panelTest.isProjectDirty() }))
    assert.equal(after.playing, false); assert.equal(after.pending, null); assert.equal(after.error, null); assert.equal(after.cover, 'none')
    assert.equal(after.before, after.after); assert.equal(after.dirty, false)
    assert.equal(after.bridge.filter(call => call[0] === 'url').length, 3, 'three caches registered only by normal reuse')
    assert.equal(after.bridge.some(call => call[0] === 'FORBIDDEN WRITE'), false)
    assert.deepEqual(errors, [])
    results.push({ name: 'delayed unavailable cached source', timeoutMs: failed.at - requested.at,
      failedToken: pending.state.token, retryToken: retry.token, pauseCancelsRetry: true })
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ native, verifiedEncodedFps: 24, results,
      claims: 'Functional cached/live handoff smoke only; synthetic existing-cache reuse, no render/export parity or performance benchmark.',
      bridgeReads: after.bridge.length, errors }, null, 2))
    console.log(`PASS: delayed cache status, bounded timeout alert, fresh Play retry and cancellation; artifacts ${output}`)
  } catch (error) {
    if (diagnosticPage && !diagnosticPage.isClosed()) {
      await diagnosticPage.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
      const diagnostic = await diagnosticPage.evaluate(() => {
        const state = window.panelTest?.timeline.getState()
        return { time: state?.playheadPosition, playing: state?.isPlaying, jump: state?.playbackJump,
          error: state?.playbackJumpError, records: window.panelDiagnostic?.records,
          landings: window.panelDiagnostic?.landings, bridge: window.panelTest?.bridgeCalls }
      }).catch(() => null)
      fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: error.message, diagnostic }, null, 2))
      console.error(`Failure artifacts: ${output}`)
    }
    throw error
  } finally {
    releaseMissing?.()
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
