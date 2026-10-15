// Isolated real Timeline + Canvas renderer. Sources are generated in memory;
// the existing host does not load production main/preload or user projects.
// Playwright's Electron launch uses test-only --no-sandbox: this is not a
// packaged-app/sandbox or Windows/macOS verification claim.
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const FPS = 24, WIDTH = 96, HEIGHT = 54, PPS = 50, MOVES = 240
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`)
function media(alternate = false, fps = FPS) {
  const frames = fps * 8, input = Buffer.alloc(WIDTH * HEIGHT * 3 * frames)
  for (let frame = 0; frame < frames; frame++) {
    const n = alternate ? frames - 1 - frame : frame
    const rgb = [20 + n % 8 * 28, 20 + Math.floor(n / 8) % 8 * 28, 20 + Math.floor(n / 64) * 35]
    for (let offset = frame * WIDTH * HEIGHT * 3; offset < (frame + 1) * WIDTH * HEIGHT * 3; offset += 3) {
      input[offset] = rgb[0]; input[offset + 1] = rgb[1]; input[offset + 2] = rgb[2]
    }
  }
  const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static')
  const encoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
    '-s', `${WIDTH}x${HEIGHT}`, '-r', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-crf', '10', '-g', '1', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'],
  { input, timeout: 30000, maxBuffer: 8 * 1024 * 1024 })
  assert.equal(encoded.status, 0, String(encoded.stderr))
  const decoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    { input: encoded.stdout, timeout: 30000, maxBuffer: 8 * 1024 * 1024 })
  assert.equal(decoded.status, 0, String(decoded.stderr))
  return { base64: encoded.stdout.toString('base64'), fps,
    pixels: Array.from({ length: frames }, (_, i) => [...decoded.stdout.subarray(i * WIDTH * HEIGHT * 3, i * WIDTH * HEIGHT * 3 + 3)]) }
}
async function main() {
  const source = media(), cached = media(true, 48), native = process.env.VELORN_TEST_ELECTRON === '1', baseline = process.env.VELORN_SCRUB_BASELINE === '1'
  const browser = native
    ? await _electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')] })
    : await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true })
  try {
    const page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    // The installed Electron can stop RAF in a never-shown window even with
    // backgroundThrottling:false. Exercise visible user-interaction scheduling
    // without stealing focus; do not change production or the shared host.
    if (native) {
      await browser.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
    }
    page.setDefaultTimeout(12000)
    if (process.env.VELORN_SCRUB_DIAGNOSTICS === '1') await page.addInitScript(() => {
      window.scrubDecodedLog = []; window.scrubDecodedVideos = new Set()
      const request = HTMLVideoElement.prototype.requestVideoFrameCallback
      HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
        window.scrubDecodedVideos.add(this)
        return request.call(this, (now, metadata) => {
          window.scrubDecodedLog.push({ requestedNow: this.currentTime, presented: metadata.mediaTime, seeking: this.seeking })
          if (window.scrubDecodedLog.length > 100) window.scrubDecodedLog.shift()
          callback(now, metadata)
        })
      }
    })
    const base = process.env.VELORN_TEST_URL || 'http://127.0.0.1:5184'
    await page.routeWebSocket(url => url.hostname === new URL(base).hostname && url.port === new URL(base).port,
      socket => socket.close())
    const errors = []
    page.on('pageerror', error => { errors.push(error.message); console.error('Renderer:', error.message) })
    await page.goto(base + '/tests/fixtures/compound-clips.html' + (native ? '?nativeWaveformStub=1' : ''))
    await page.waitForFunction(() => Boolean(window.compoundTest), null, { polling: 100 })
    await page.evaluate(({ source, cached }) => window.compoundTest.initializeMedia({ red: source, blue: cached }), { source, cached })
    const seed = async (patch = {}, position = 0.5) => {
      await page.mouse.up(); await page.keyboard.press('Escape')
      await page.evaluate(({ patch, position }) => {
        const t = window.compoundTest
        t.reset({ clips: [t.makeClip('picture', { trackId: 'video', startTime: 0, duration: 8, trimStart: 0, trimEnd: 8,
          sourceDuration: 8, sourceFps: 24, timelineFps: 24, ...patch })], tracks: [t.track('video')],
          selectedClipIds: [], activeTrackId: 'video', zoom: 250, duration: 60, playheadPosition: position,
          markers: [], inPoint: null, outPoint: null, playheadSeekIntent: null })
        const viewport = document.querySelector('[data-testid="timeline-viewport"]'); viewport.scrollLeft = 0
      }, { patch, position })
      await page.waitForTimeout(100)
    }
    const ruler = page.locator('[title="Double-click to add marker"]')
    const press = async time => {
      const box = await page.getByTestId('timeline-viewport').boundingBox(), r = await ruler.boundingBox()
      const point = { x: box.x + time * PPS, y: r.y + r.height / 2 }
      await page.mouse.move(point.x, point.y); await page.mouse.down()
      await page.waitForTimeout(35)
      return { ...point, left: box.x }
    }
    const burst = async (point, { target = 4.25, releaseTarget = target, count = MOVES, release = true } = {}) => {
      return page.evaluate(({ point, target, releaseTarget, count, release, pps }) => {
        const t = window.compoundTest, viewport = document.querySelector('[data-testid="timeline-viewport"]')
        const geometry = viewport.getBoundingClientRect, revisions = [], start = performance.now()
        let reads = 0
        viewport.getBoundingClientRect = function (...args) { reads++; return geometry.apply(this, args) }
        const unsubscribe = t.timeline.subscribe((s, previous) => {
          if (s.playheadSeekRevision !== previous.playheadSeekRevision) revisions.push({ time: s.playheadPosition, at: performance.now() - start })
        })
        for (let i = 0; i < count; i++) {
          const time = i === count - 1 ? target : i % 2 ? 1.25 : 6.25
          window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: point.left + time * pps, clientY: point.y }))
        }
        if (release) window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: point.left + releaseTarget * pps, clientY: point.y }))
        const immediate = { count, publications: revisions.length, reads, final: t.timeline.getState().playheadPosition,
          publicationTimes: revisions.map(item => item.time), synchronousMs: performance.now() - start }
        unsubscribe(); viewport.getBoundingClientRect = geometry
        return immediate
      }, { point, target, releaseTarget, count, release, pps: PPS })
    }
    await seed(); const point = await press(0.5), measured = await burst(point)
    console.log(JSON.stringify({ mode: baseline ? 'BEFORE' : 'AFTER', runtime: native ? 'Electron' : 'Chrome', ...measured,
      publicationTimes: measured.publicationTimes.length > 8 ? ['alternating', ...measured.publicationTimes.slice(-2)] : measured.publicationTimes }))
    near(measured.final, 4.25, 'same final snapped burst target')
    if (baseline) {
      assert.equal(measured.publications, MOVES, 'baseline publishes every raw move')
      assert.equal(errors.length, 0, errors.join('\n'))
      console.log('BASELINE captured: identical deterministic input contract is ready for comparison')
      return
    }
    assert.ok(measured.publications <= 2, 'one synchronous burst coalesces to final release, at most one subsequent exact seek')
    assert.ok(measured.reads <= 8, 'viewport geometry is not remeasured for each raw move')
    console.log('PASS 1: 240-event burst coalesces actual store publications and preserves exact final target')

    const state = () => page.evaluate(() => {
      const t = window.compoundTest, s = t.timeline.getState()
      return { time: s.playheadPosition, intent: s.playheadSeekIntent, revision: s.playheadSeekRevision,
        dirty: t.isProjectDirty(), document: s.getProjectData(), history: s.history, index: s.historyIndex, zoom: s.zoom }
    })
    // Read only the real committed canvas. Never call the capture bridge here:
    // it would seek on behalf of the test and mask a broken release path.
    const decodedFrame = async (time, sourceTime = time, reference = source) => {
      const started = Date.now(), expected = reference.pixels[Math.min(reference.pixels.length - 1, Math.floor(sourceTime * reference.fps + 1e-6))]
      try {
        await page.waitForFunction(({ time, expected }) => {
          const frame = window.compoundTest.getPreviewFrameSnapshot()
          if (!frame?.canvas || Math.abs(frame.time - time) > 1e-6) return false
          const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1
          const ctx = canvas.getContext('2d'); ctx.drawImage(frame.canvas, frame.canvas.width / 2, frame.canvas.height / 2, 1, 1, 0, 0, 1, 1)
          const actual = [...ctx.getImageData(0, 0, 1, 1).data]
          return expected.every((value, i) => Math.abs(actual[i] - value) <= 5)
        }, { time, expected }, { polling: 50, timeout: 8000 })
      } catch (error) {
        console.error('Decoded landing diagnostic', await page.evaluate(async () => {
          const f = window.compoundTest.getPreviewFrameSnapshot(), c = document.createElement('canvas'); c.width = c.height = 1
          const x = c.getContext('2d'); if (f?.canvas) x.drawImage(f.canvas, 0, 0, 1, 1)
          let animationFrames = 0
          const countFrame = () => { animationFrames++; if (animationFrames < 3) requestAnimationFrame(countFrame) }
          requestAnimationFrame(countFrame); await new Promise(resolve => setTimeout(resolve, 120))
          return { frame: f && { time: f.time, serial: f.serial }, pixel: [...x.getImageData(0, 0, 1, 1).data], animationFrames,
            visibility: document.visibilityState, decoded: window.scrubDecodedLog,
            videos: [...(window.scrubDecodedVideos || [])].map(v => ({ time: v.currentTime, ready: v.readyState, seeking: v.seeking,
              dimensions: [v.videoWidth, v.videoHeight], error: v.error?.message })),
            state: { time: window.compoundTest.timeline.getState().playheadPosition, intent: window.compoundTest.timeline.getState().playheadSeekIntent } }
        }), { time, sourceTime, expected })
        throw error
      }
      return Date.now() - started
    }
    await decodedFrame(4.25)
    await seed(); const immutable = await state(), finalPoint = await press(0.5)
    const release = await burst(finalPoint, { target: 3, releaseTarget: 4.5 })
    near(release.final, 4.5, 'mouseup-only coordinate is flushed synchronously')
    const landed = await state(); assert.equal(landed.intent?.type, 'frame-step'); near(landed.intent.targetTime, 4.5, 'exact release intent')
    const latency = await decodedFrame(4.5)
    assert.deepEqual(landed.document, immutable.document); assert.deepEqual(landed.history, immutable.history)
    assert.equal(landed.index, immutable.index); assert.equal(landed.dirty, false)
    for (const entry of ['ruler', 'upper', 'lower']) {
      await seed()
      const sameTask = await page.evaluate(entry => {
        const t = window.compoundTest, viewport = document.querySelector('[data-testid="timeline-viewport"]')
        const upper = document.querySelector('[title="Drag to scrub"]')
        const el = entry === 'ruler' ? document.querySelector('[title="Double-click to add marker"]')
          : entry === 'upper' ? upper : upper.parentElement.lastElementChild
        if (!el) throw new Error(`Missing real ${entry} entry`)
        const rect = el.getBoundingClientRect(), x = entry === 'ruler' ? viewport.getBoundingClientRect().left + 75 : rect.x + 1
        const y = rect.y + Math.min(10, rect.height / 2), before = t.timeline.getState().playheadPosition
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1, clientX: x, clientY: y }))
        const pressed = t.timeline.getState().playheadPosition
        window.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: x, clientY: y }))
        const untouched = t.timeline.getState().playheadPosition
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1, clientX: x, clientY: y }))
        // Deliberately no intermediate mousemove or RAF/effect opportunity.
        window.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: viewport.getBoundingClientRect().left + 125, clientY: y }))
        return { before, pressed, untouched, final: t.timeline.getState().playheadPosition, intent: t.timeline.getState().playheadSeekIntent }
      }, entry)
      near(sameTask.pressed, entry === 'ruler' ? 1.5 : sameTask.before, `${entry} initial press/no-jump grab`)
      near(sameTask.untouched, sameTask.pressed, `${entry} same-coordinate release does not jump`)
      near(sameTask.final, 2.5, `${entry} release before first RAF uses mouseup target`)
      assert.equal(sameTask.intent?.type, 'frame-step'); await decodedFrame(2.5)
    }
    console.log(`PASS 2: latest mouseup coordinate, real decoded final frame and document neutrality (observed landing wait ${latency} ms; not a FPS benchmark)`)

    await seed(); const same = await press(0.5), startRevision = (await state()).revision
    for (let i = 0; i < 3; i++) { await burst(same, { count: 40, target: 0.5, release: false }); await page.waitForTimeout(70) }
    assert.equal((await state()).revision, startRevision, 'same snapped frame publishes nothing during motion')
    await burst(same, { count: 0, target: 0.5 }); assert.equal((await state()).revision, startRevision + 1, 'one exact same-frame release')
    await decodedFrame(0.5)
    await seed(); const paced = await press(0.5), pacedStart = (await state()).revision
    for (let i = 0; i < 6; i++) {
      await burst(paced, { count: 40, target: 1 + i / 4, release: false })
      await page.waitForFunction(target => Math.abs(window.compoundTest.timeline.getState().playheadPosition - target) < 1e-6, 1 + i / 4, { polling: 20 })
    }
    assert.equal((await state()).revision - pacedStart, 6, 'six paced bursts publish six latest targets, not 240 inputs')
    await burst(paced, { count: 0, target: 2.25 }); await decodedFrame(2.25)
    console.log('PASS 3: same-frame dedupe and paced RAF bursts retain responsive intermediate targets')

    // A new paused element already showing frame zero may not emit another
    // rVFC for a no-op seek within that frame. Exact release must still settle.
    await seed({ id: 'cold-frame-zero' }, 0)
    await decodedFrame(0)
    const zero = await press(0)
    await burst(zero, { count: 0, target: 0 })
    await decodedFrame(0)
    assert.equal((await state()).intent?.type, 'frame-step')
    await burst(zero, { count: 0, target: 0 })
    await decodedFrame(0)
    console.log('CHECK cold frame-zero exact release and repeated presentation')

    for (const [name, patch, time, expected] of [
      ['reverse', { duration: 4, trimStart: 1, trimEnd: 5, reverse: true }, 1.5, 3.5],
      ['slow', { duration: 4, trimStart: 1, trimEnd: 3, speed: 0.5 }, 2, 2],
      ['fast', { duration: 4, trimStart: 0, trimEnd: 8, speed: 2 }, 2, 4],
    ]) {
      await seed(patch); const p = await press(0.5); await burst(p, { target: time }); await decodedFrame(time, expected)
      console.log('CHECK decoded source clock: ' + name)
    }
    await seed({ duration: 4, trimStart: 2, trimEnd: 4, speed: 0.5, frameSampling: 'optical-flow' })
    await page.evaluate(() => {
      const t = window.compoundTest, s = t.timeline.getState()
      t.timeline.setState({ clips: s.clips.map(c => ({ ...c, opticalFlowCache: { version: 'rife_ncnn_vulkan_v46_uhd_v1',
        engine: 'rife-ncnn-vulkan', modelName: 'rife-v4.6', status: 'ready', path: 'cache/synthetic-scrub.mp4',
        url: t.getAsset('blue').url, sourceStart: 1, sourceEnd: 8, targetFps: 48, requestedTargetFps: 48 } })) })
    })
    const rife = await press(0.5); await burst(rife, { target: 2 }); await decodedFrame(2, 2, cached)
    console.log('PASS 4: reverse, constant 0.5x/2x and verified RIFE-origin final decoded frames')

    await seed(); await page.evaluate(() => {
      const t = window.compoundTest, s = t.timeline.getState(), original = s.clips[0]
      t.timeline.setState({ clips: [{ ...original, duration: 2, trimEnd: 2 },
        { ...original, id: 'next', name: 'Next', startTime: 2, duration: 6, trimEnd: 6, sourceFps: 48, assetId: 'blue', url: t.getAsset('blue').url }] })
    })
    for (const [time, sourceTime, reference] of [[47 / 24, 47 / 24, source], [2, 0, cached], [3.25, 1.25, cached]]) {
      const p = await press(0.5); await burst(p, { target: time }); await decodedFrame(time, sourceTime, reference)
    }
    await seed(); await page.evaluate(() => {
      const t = window.compoundTest, s = t.timeline.getState(), request = { clipIds: ['picture'], name: 'Scrub scene', width: 960, height: 540 }
      const plan = s.previewCreateCompound(request); if (!plan.ok) throw new Error(plan.reason)
      const result = s.applyCreateCompound(request, plan.token); if (!result.ok) throw new Error(result.reason)
      t.markProjectClean()
    })
    const compoundBefore = await state(), compoundPoint = await press(0.5)
    await burst(compoundPoint, { target: 3.5 }); await decodedFrame(3.5)
    assert.deepEqual((await state()).document, compoundBefore.document); assert.equal((await state()).dirty, false)
    console.log('PASS 5: touching source cuts and expanded compound preview retain exact decoded landing')

    // Each cancellation happens in the same JS task as the queued pointer, so
    // no animation tick can hide a stale callback by consuming it first.
    for (const kind of ['Escape', 'blur', 'pointercancel', 'load', 'seek', 'zoom', 'fps', 'unmount']) {
      await seed(); const p = await press(0.5)
      const expected = await page.evaluate(({ p, kind }) => {
        const t = window.compoundTest
        window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: p.left + 5 * 50, clientY: p.y }))
        if (kind === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        if (kind === 'blur' || kind === 'pointercancel') window.dispatchEvent(new Event(kind))
        if (kind === 'load') { const saved = t.timeline.getState().getProjectData(); t.timeline.getState().loadFromProject(saved) }
        if (kind === 'seek') t.timeline.getState().setPlayheadPosition(2.125, { snap: true, intent: 'frame-step' })
        if (kind === 'zoom') t.timeline.getState().setZoom(300)
        if (kind === 'fps') t.timeline.setState({ timelineFps: 30 })
        if (kind === 'unmount') t.setTimelineVisible(false)
        return { time: t.timeline.getState().playheadPosition, revision: t.timeline.getState().playheadSeekRevision }
      }, { p, kind })
      await page.waitForTimeout(120)
      await page.evaluate(p => window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: p.left + 6 * 50, clientY: p.y })), p)
      await page.waitForTimeout(70)
      near((await state()).time, expected.time, `${kind} discards pending/latest release`)
      assert.equal((await state()).revision, expected.revision, `${kind} does not manufacture exact release`)
      if (kind === 'unmount') { await page.evaluate(() => window.compoundTest.setTimelineVisible(true)); await page.getByTestId('timeline-viewport').waitFor() }
      console.log('CHECK cancellation: ' + kind)
    }
    console.log('PASS 6: cancellation, project load, external exact seek, view/FPS changes and real unmount discard queued work')

    await seed(); const scrollPoint = await press(0.5)
    const scrollBefore = await page.getByTestId('timeline-viewport').evaluate(el => el.scrollLeft)
    await page.evaluate(p => {
      const viewport = document.querySelector('[data-testid="timeline-viewport"]'), rect = viewport.getBoundingClientRect()
      window.dispatchEvent(new MouseEvent('mousemove', { buttons: 1, clientX: rect.right + 10, clientY: p.y }))
    }, scrollPoint)
    await page.waitForFunction(before => document.querySelector('[data-testid="timeline-viewport"]').scrollLeft > before + 70, scrollBefore, { polling: 20 })
    const expectedScrollTime = await page.evaluate(p => {
      const el = document.querySelector('[data-testid="timeline-viewport"]'), x = el.getBoundingClientRect().left + 160
      const expected = Math.round(((160 + el.scrollLeft) / 50) * 24) / 24
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: p.y }))
      return expected
    }, scrollPoint)
    near((await state()).time, expectedScrollTime, 'release uses live auto-scrolled geometry')
    const stoppedScroll = await page.getByTestId('timeline-viewport').evaluate(el => el.scrollLeft)
    await page.waitForTimeout(150); near(await page.getByTestId('timeline-viewport').evaluate(el => el.scrollLeft), stoppedScroll, 'autoscroll stops at release')
    await seed(); const externalScroll = await press(0.5)
    const afterScroll = await page.evaluate(p => {
      const el = document.querySelector('[data-testid="timeline-viewport"]'); el.scrollLeft = 100
      el.dispatchEvent(new Event('scroll'))
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: p.left + 150, clientY: p.y }))
      return window.compoundTest.timeline.getState().playheadPosition
    }, externalScroll)
    near(afterScroll, 5, 'external scroll invalidates cached geometry')
    console.log('PASS 7: held-edge autoscroll, live external scroll, exact release and stopped scheduling')

    await seed(); const hotkeys = await press(0.5), zoom = (await state()).zoom
    await page.keyboard.press('z'); assert.equal((await state()).zoom, zoom, 'selection zoom does not disrupt scrub')
    await burst(hotkeys, { target: 1.5 }); await decodedFrame(1.5)
    await seed(); await page.evaluate(() => window.compoundTest.timeline.setState({ isPlaying: true }))
    const playing = await press(0.5); await burst(playing, { target: 2 })
    assert.equal((await state()).intent, null, 'playing release does not install paused exact-frame intent')
    await page.evaluate(() => window.compoundTest.timeline.setState({ isPlaying: false }))
    console.log('PASS 8: existing view shortcut guard and playing scrub release retain transport semantics')

    for (const width of [600, 350]) {
      if (native) await browser.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 1000), width)
      else await page.setViewportSize({ width, height: 1000 })
      await page.waitForFunction(width => window.innerWidth === width, width, { polling: 50 })
      // At 350 px the unchanged headers/meters leave a 70 px timeline. Keep
      // both actual pointer coordinates inside that visible viewport.
      await seed(); const p = await press(0.25), narrowRelease = await burst(p, { target: 0.75, count: 0 })
      if (Math.abs(narrowRelease.final - 0.75) > 1e-6) console.error('Narrow input diagnostic', { width, p, narrowRelease,
        dom: await page.evaluate(p => ({ inner: [innerWidth, innerHeight], hit: document.elementFromPoint(p.x, p.y)?.outerHTML,
          ruler: document.querySelector('[title="Double-click to add marker"]')?.getBoundingClientRect().toJSON(),
          viewport: document.querySelector('[data-testid="timeline-viewport"]')?.getBoundingClientRect().toJSON() }), p) })
      await decodedFrame(0.75)
      const bounds = await page.getByTestId('timeline-viewport').boundingBox(); assert.ok(bounds.width > 0 && bounds.x + bounds.width <= width + 1)
    }
    if (!native && process.env.VELORN_TEST_SCREENSHOT) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT })
    console.log('PASS 9: narrow real viewport geometry and exact canvas landing (native uses BrowserWindow resize)')
    assert.equal(errors.length, 0, errors.join('\n'))
    console.log(`PASS all 9 timeline scrub groups (${native ? 'installed Electron' : 'Chrome'}), no renderer exceptions`)
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
