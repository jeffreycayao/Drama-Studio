// Isolated real-Timeline checks. Synthetic decoded-frame media stays in /tmp;
// never opens an app project or the production Electron main process.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')

const FPS = 10
const WIDTH = 96
const HEIGHT = 54
const FRAMES = 60

function makeMedia(directory, name, alternate = false, fps = FPS) {
  const input = Buffer.alloc(WIDTH * HEIGHT * 3 * FRAMES)
  for (let frame = 0; frame < FRAMES; frame++) {
    const n = alternate ? FRAMES - 1 - frame : frame
    const rgb = [20 + (n % 4) * 60, 20 + (Math.floor(n / 4) % 4) * 60, 20 + Math.floor(n / 16) * 60]
    for (let i = frame * WIDTH * HEIGHT * 3; i < (frame + 1) * WIDTH * HEIGHT * 3; i += 3) {
      input[i] = rgb[0]; input[i + 1] = rgb[1]; input[i + 2] = rgb[2]
    }
  }
  const output = path.join(directory, name + '.mp4')
  const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static')
  const encoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
    '-s', `${WIDTH}x${HEIGHT}`, '-r', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264',
    '-preset', 'ultrafast', '-crf', '10', '-g', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output],
  { input, timeout: 30000, maxBuffer: 8 * 1024 * 1024 })
  assert.equal(encoded.status, 0, String(encoded.stderr))
  const decoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', output, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    { timeout: 30000, maxBuffer: 8 * 1024 * 1024 })
  assert.equal(decoded.status, 0, String(decoded.stderr))
  return { base64: fs.readFileSync(output).toString('base64'), fps,
    pixels: Array.from({ length: FRAMES }, (_, i) => [...decoded.stdout.subarray(i * WIDTH * HEIGHT * 3, i * WIDTH * HEIGHT * 3 + 3)]) }
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-trim-preview-'))
  let browser
  try {
    const original = makeMedia(temp, 'source')
    // A visibly different 20-fps sequence stands in for an existing valid RIFE
    // cache. No interpolation model is run, downloaded or otherwise modified.
    const interpolated = makeMedia(temp, 'cached', true, 20)
    const native = process.env.VELORN_TEST_ELECTRON === '1'
    browser = native
      ? await _electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')] })
      : await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true })
    const page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.setDefaultTimeout(15000)
    // Keep this isolated loaded app stable while other review files change.
    await page.routeWebSocket(/ws:\/\/(?:127\.0\.0\.1|localhost):5184\//, socket => socket.close())
    const errors = []
    page.on('pageerror', error => { errors.push(error.message); console.error('Renderer:', error.message) })
    await page.goto((process.env.VELORN_TEST_URL || 'http://127.0.0.1:5184') + '/tests/fixtures/multi-clip-inspector.html?timeline=1')
    await page.waitForFunction(() => Boolean(window.multiClipInspectorTest?.project))
    assert.equal(await page.evaluate(() => {
      // Use the fixture's statically imported store: a runtime import of the
      // bare URL can create a second store after Vite timestamps the UI graph.
      const project = window.multiClipInspectorTest.project
      project.setState({ currentProject: { name: 'Synthetic trim verification', settings: { fps: 10, width: 960, height: 540 }, timelines: [] },
        currentProjectHandle: null, currentTimelineId: null })
      return project.getState().getCurrentTimelineSettings()?.fps
    }), FPS, 'the rendered timeline uses the synthetic project frame rate')
    const urls = await page.evaluate(({ source, cached }) => {
      const create = base64 => URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: 'video/mp4' }))
      const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 54
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ae2377'; ctx.fillRect(0, 0, 96, 54)
      return { source: create(source), cached: create(cached), image: canvas.toDataURL('image/png'), broken: URL.createObjectURL(new Blob(['not a video'], { type: 'video/mp4' })) }
    }, { source: original.base64, cached: interpolated.base64 })
    const preview = page.getByTestId('trim-edge-preview')
    const canvas = page.getByTestId('trim-edge-canvas')
    const state = () => page.evaluate(() => {
      const t = window.multiClipInspectorTest, s = t.timeline.getState()
      return JSON.parse(JSON.stringify({ clips: s.clips, tracks: s.tracks, selected: s.selectedClipIds,
        history: s.history.length, historyIndex: s.historyIndex, playhead: s.playheadPosition,
        dirty: t.isProjectDirty(), activeSnap: s.activeSnapTime, playing: s.isPlaying }))
    })
    const byId = (s, id = 'visual-a') => s.clips.find(c => c.id === id)
    const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}; got ${actual}`)
    const seed = async ({ patches = {}, selected = ['visual-a'], extras = [], snapping = false } = {}) => {
      await page.mouse.up()
      await page.evaluate(({ patches, selected, extras, snapping, urls }) => {
        const t = window.multiClipInspectorTest; t.reset()
        const base = { type: 'video', assetId: 'source', url: urls.source, startTime: 2, duration: 3,
          trimStart: 1, trimEnd: 4, sourceDuration: 6, sourceFps: 10, timelineFps: 10,
          sourceTimeScale: 1, speed: 1, reverse: false, frameSampling: 'frame', effects: [], keyframes: {} }
        t.assets.setState({ assets: [{ id: 'source', type: 'video', name: 'Synthetic encoded frames', url: urls.source, settings: { fps: 10, width: 96, height: 54 } },
          { id: 'image', type: 'image', name: 'Synthetic image', url: urls.image }] })
        t.timeline.setState(s => ({ clips: [...s.clips.map(c => ({ ...c, ...base,
          ...(c.type === 'audio' ? { type: 'audio', assetId: null, url: null } : {}),
          ...(c.id === 'audio-b' ? { startTime: 7 } : {}),
          ...(c.id === 'locked' ? { startTime: 8 } : {}), ...(patches[c.id] || {}) })), ...extras],
          selectedClipIds: selected, timelineFps: 10, zoom: 250, playheadPosition: 1.3,
          snappingEnabled: snapping, history: [], historyIndex: -1, isPlaying: false, transitions: [], markers: [] }))
        t.markProjectClean()
      }, { patches, selected, extras, snapping, urls })
      await preview.waitFor({ state: 'hidden' })
    }
    const handle = (id, edge) => page.locator(`[data-clip-id="${id}"]`).first().locator('[data-trim-handle]').nth(edge === 'left' ? 0 : 1)
    let gesture
    const start = async (id = 'visual-a', edge = 'right') => {
      const h = handle(id, edge); await h.scrollIntoViewIfNeeded()
      const box = await h.boundingBox(); assert.ok(box, 'trim handle exists')
      gesture = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      await page.mouse.move(gesture.x, gesture.y); await page.mouse.down()
      await preview.waitFor()
      assert.equal(await preview.getAttribute('data-clip-id'), id)
      assert.equal(await preview.getAttribute('data-edge'), edge)
      assert.equal(await preview.evaluate(el => getComputedStyle(el).pointerEvents), 'none', 'feedback never captures trim input')
    }
    const move = async delta => {
      await page.mouse.move(gesture.x + delta * 50, gesture.y)
    }
    const release = async () => { await page.mouse.up(); await preview.waitFor({ state: 'hidden' }) }
    const waitClip = async (id, key, expected) => page.waitForFunction(({ id, key, expected }) =>
      Math.abs(window.multiClipInspectorTest.timeline.getState().clips.find(c => c.id === id)?.[key] - expected) < 1e-6,
    { id, key, expected })
    const readyFrame = async (expectedSource, expectedMediaTime = expectedSource, media = original, mode = 'original') => {
      try {
        await page.waitForFunction(({ expectedSource, expectedMediaTime }) => {
          const el = document.querySelector('[data-testid="trim-edge-canvas"]')
          return el?.dataset.state === 'ready' && Math.abs(Number(el.dataset.sourceTime) - expectedSource) < 0.0001
            && Math.abs(Number(el.dataset.frameTime) - expectedMediaTime) < 0.0001
        }, { expectedSource, expectedMediaTime })
      } catch (error) {
        console.error('Frame readiness diagnostic:', await preview.evaluate(el => ({ text: el.innerText,
          canvas: { ...el.querySelector('canvas')?.dataset }, video: el.querySelector('video') && {
            time: el.querySelector('video').currentTime, ready: el.querySelector('video').readyState,
            seeking: el.querySelector('video').seeking } })))
        throw error
      }
      const got = await canvas.evaluate(el => ({ state: el.dataset.state, mode: el.dataset.sourceMode,
        pixels: [...el.getContext('2d').getImageData(Math.floor(el.width / 2), Math.floor(el.height / 2), 1, 1).data] }))
      assert.equal(got.state, 'ready'); assert.equal(got.mode, mode)
      const index = Math.max(0, Math.min(FRAMES - 1, Math.floor((expectedMediaTime + 0.000001) * media.fps)))
      const expected = media.pixels[index]
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(got.pixels[i] - expected[i]) <= 5,
        `encoded frame ${index}, RGB ${i}: expected ${expected}; got ${got.pixels}`)
    }
    const undo = () => page.evaluate(() => window.multiClipInspectorTest.timeline.getState().undo())
    const feedbackText = () => preview.innerText()

    await seed(); const tailOriginal = await state(); await start(); await move(0.4)
    await waitClip('visual-a', 'duration', 3.4)
    await readyFrame(4.3)
    assert.match(await page.getByTestId('trim-edge-time').innerText(), /\d{2}:\d{2}:\d{2}:\d{2}/)
    assert.match(await page.getByTestId('trim-edge-delta').innerText(), /\+4\s*f/i)
    assert.match(await page.getByTestId('trim-edge-duration').innerText(), /00:00:03:04/)
    assert.equal((await state()).playhead, tailOriginal.playhead)
    assert.equal((await state()).history, 1)
    if (process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT })
    await release(); await undo(); assert.deepEqual((await state()).clips, tailOriginal.clips)
    console.log('PASS: tail retains the exact encoded last frame, timecode/signed duration delta, fixed playhead, pointer transparency and one undo')

    await seed(); const headOriginal = await state(); await start('visual-a', 'left'); await move(0.4)
    await waitClip('visual-a', 'trimStart', 1.4); await readyFrame(1.4)
    near(byId(await state()).duration, 2.6, 'head duration')
    assert.match(await page.getByTestId('trim-edge-delta').innerText(), /[−-]4\s*f/i)
    assert.equal((await state()).playhead, headOriginal.playhead)
    await release(); await undo(); assert.deepEqual((await state()).clips, headOriginal.clips)
    console.log('PASS: head shows exact first retained frame and removed-frame delta without seeking the timeline playhead')

    await seed({ selected: ['visual-a', 'visual-b', 'locked'], patches: { 'visual-b': { sourceDuration: 4.2 } } })
    const groupOriginal = await state(); await start(); await move(0.8)
    await waitClip('visual-a', 'duration', 3.2); await readyFrame(4.1)
    near(byId(await state(), 'visual-b').duration, 3.2, 'other selected clip shares bounded delta')
    assert.deepEqual(byId(await state(), 'locked'), byId(groupOriginal, 'locked'))
    assert.match(await feedbackText(), /2\s*clips|2\s*selected/i)
    assert.match(await page.getByTestId('trim-edge-limit').innerText(), /source/i)
    assert.match(await page.getByTestId('trim-edge-limit').innerText(), /visual-b/i)
    await release(); await undo(); assert.deepEqual((await state()).clips, groupOriginal.clips)
    await seed({ extras: [{ id: 'neighbor', type: 'shape', name: 'Neighbor', trackId: 'visual-a', startTime: 5.5, duration: 1, trimStart: 0, trimEnd: 1 }] })
    await start(); await move(1); await waitClip('visual-a', 'duration', 3.5)
    assert.match(await page.getByTestId('trim-edge-limit').innerText(), /neighbor|next clip/i)
    assert.doesNotMatch(await page.getByTestId('trim-edge-limit').innerText(), /source/i)
    await release()
    await seed(); await start('visual-a', 'left'); await move(-2)
    await waitClip('visual-a', 'trimStart', 0); await readyFrame(0)
    assert.match(await page.getByTestId('trim-edge-limit').innerText(), /source start/i)
    await release()
    console.log('PASS: multi-trim uses original common bounds, names another limiting clip, excludes locked tracks and distinguishes neighboring clips from source limits')

    await seed({ snapping: true, patches: { 'visual-b': { startTime: 5.5, duration: 1 } } })
    const snapOriginal = await state(); await start(); await move(0.44)
    await waitClip('visual-a', 'duration', 3.5); await readyFrame(4.4)
    assert.equal((await state()).playhead, snapOriginal.playhead)
    assert.equal((await state()).history, 1)
    await release(); await undo(); assert.deepEqual((await state()).clips, snapOriginal.clips)
    console.log('PASS: existing cross-track snapping selects the shown edge frame and remains a single undo gesture')

    for (const [patch, delta, source] of [
      [{ reverse: true }, 0.4, 1.1],
      [{ speed: 0.5, duration: 4, trimEnd: 3 }, 0.4, 3.15],
      [{ speed: 2, duration: 1.5, trimEnd: 4 }, 0.2, 4.2],
    ]) {
      await seed({ patches: { 'visual-a': patch } }); await start(); await move(delta)
      await waitClip('visual-a', 'duration', (patch.duration || 3) + delta)
      await readyFrame(source); await release()
    }
    console.log('PASS: reverse, slow and fast clips map the retained timeline frame to the actual encoded source frame')

    const cache = { version: 'rife_ncnn_vulkan_v46_uhd_v1', engine: 'rife-ncnn-vulkan', modelName: 'rife-v4.6',
      status: 'ready', path: 'cache/synthetic-trim.mp4', url: urls.cached, sourceStart: 0, sourceEnd: 3,
      targetFps: 20, requestedTargetFps: 20 }
    await seed({ patches: { 'visual-a': { speed: 0.5, duration: 2, trimStart: 1, trimEnd: 2, frameSampling: 'optical-flow', opticalFlowCache: cache } } })
    await start(); await move(-0.4); await waitClip('visual-a', 'duration', 1.6)
    await readyFrame(1.75, 1.75, interpolated, 'optical-flow'); await release()
    await seed({ patches: { 'visual-a': { speed: 0.5, duration: 2, trimStart: 1, trimEnd: 2, frameSampling: 'optical-flow', opticalFlowCache: { ...cache, status: 'invalid' } } } })
    await start(); await move(-0.4); await waitClip('visual-a', 'duration', 1.6)
    await readyFrame(1.75); await release()
    console.log('PASS: valid local optical-flow cache supplies its actual frames; invalid cache safely uses original media')

    await seed({ patches: { 'visual-a': { type: 'image', assetId: 'image', url: urls.image } } })
    await start(); await move(0.2); await waitClip('visual-a', 'duration', 3.2)
    await page.waitForFunction(() => document.querySelector('[data-testid="trim-edge-canvas"]')?.dataset.state === 'ready')
    assert.equal(await canvas.getAttribute('data-source-mode'), 'image')
    const imagePixel = await canvas.evaluate(el => [...el.getContext('2d').getImageData(el.width / 2, el.height / 2, 1, 1).data])
    assert.deepEqual(imagePixel.slice(0, 3), [174, 35, 119]); await release()
    await seed({ patches: { 'audio-a': { type: 'audio', assetId: null, url: null } }, selected: ['audio-a'] })
    await start('audio-a'); await move(0.2); await waitClip('audio-a', 'duration', 3.2)
    assert.equal(await preview.getAttribute('data-state'), 'timing-only')
    assert.match(await feedbackText(), /audio|timing/i); await release()
    await seed({ patches: { 'visual-a': { assetId: null, url: urls.broken } } })
    await start(); await move(0.2)
    await page.waitForFunction(() => document.querySelector('[data-testid="trim-edge-preview"]')?.dataset.state === 'unavailable')
    assert.match(await feedbackText(), /unavailable|could not|cannot|unable/i)
    await release()
    console.log('PASS: still-image pixels, audio timing-only feedback, and honest unavailable status for decode failures')

    await seed(); await start(); await readyFrame(3.9)
    await page.evaluate(({ pixels }) => {
      const el = document.querySelector('[data-testid="trim-edge-canvas"]')
      window.trimReadyObservations = { count: 0, failures: [] }
      window.trimReadyObserver = new MutationObserver(() => {
        if (el.dataset.state !== 'ready') return
        const index = Math.max(0, Math.min(59, Math.floor((Number(el.dataset.frameTime) + 0.000001) * 10)))
        const actual = [...el.getContext('2d').getImageData(el.width / 2, el.height / 2, 1, 1).data]
        window.trimReadyObservations.count++
        if (pixels[index].some((value, i) => Math.abs(value - actual[i]) > 5)) {
          window.trimReadyObservations.failures.push({ index, actual, expected: pixels[index] })
        }
      })
      window.trimReadyObserver.observe(el, { attributes: true })
    }, { pixels: original.pixels })
    // Dispatch a burst in one JS task so pending seeks race newer requested
    // frames. A stale canvas must never advertise that it is ready for the new
    // frame while still showing the previously committed pixels.
    await page.evaluate(({ x, y }) => {
      for (const delta of [0.5, -0.2, 0.8, 0.1, 0.7]) window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + delta * 50, clientY: y, buttons: 1 }))
    }, gesture)
    await waitClip('visual-a', 'duration', 3.7); await readyFrame(4.6)
    const observations = await page.evaluate(() => { window.trimReadyObserver.disconnect(); return window.trimReadyObservations })
    assert.ok(observations.count > 0, 'at least one newest-frame readiness commit observed')
    assert.deepEqual(observations.failures, [], 'every advertised ready frame has matching actual pixels')
    assert.equal((await state()).history, 1)
    await page.evaluate(url => window.multiClipInspectorTest.assets.setState(s => ({ assets: s.assets.map(a => a.id === 'source' ? { ...a, url } : a) })), urls.broken)
    await page.waitForFunction(() => document.querySelector('[data-testid="trim-edge-canvas"]')?.dataset.state !== 'ready')
    await page.evaluate(url => window.multiClipInspectorTest.assets.setState(s => ({ assets: s.assets.map(a => a.id === 'source' ? { ...a, url } : a) })), urls.source)
    await readyFrame(4.6)
    await release(); await seed(); await start('visual-b', 'left'); await move(0.2); await readyFrame(1.2)
    assert.equal(await preview.getAttribute('data-clip-id'), 'visual-b'); await release()
    console.log('PASS: rapid coalesced seeks commit only the newest requested frame and new clip/edge sessions do not show stale pixels')

    for (const mutation of ['blur', 'pointercancel', 'escape', 'selection', 'lock', 'load', 'remove', 'history']) {
      await seed(); await start(); await move(0.2); await waitClip('visual-a', 'duration', 3.2)
      await page.evaluate(mutation => {
        const t = window.multiClipInspectorTest, s = t.timeline.getState()
        if (mutation === 'blur') window.dispatchEvent(new Event('blur'))
        if (mutation === 'pointercancel') window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))
        if (mutation === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        if (mutation === 'selection') t.timeline.setState({ selectedClipIds: ['visual-b'] })
        if (mutation === 'lock') t.timeline.setState({ tracks: s.tracks.map(track => track.id === 'visual-a' ? { ...track, locked: true } : track) })
        if (mutation === 'load') s.loadFromProject(JSON.parse(JSON.stringify(s.getProjectData())), [], 10)
        if (mutation === 'remove') t.timeline.setState({ clips: s.clips.filter(c => c.id !== 'visual-a') })
        if (mutation === 'history') s.saveToHistory()
      }, mutation)
      await preview.waitFor({ state: 'hidden' })
      const canceled = await state(); await move(0.6); await page.mouse.up()
      assert.deepEqual((await state()).clips, canceled.clips, `${mutation} prevents stale writes`)
      assert.equal((await state()).history, canceled.history, `${mutation} does not add feedback history`)
      assert.equal((await state()).playhead, canceled.playhead)
    }
    if (await page.evaluate(() => typeof window.multiClipInspectorTest.setTimelineVisible === 'function')) {
      await seed(); await start(); await move(0.2); await waitClip('visual-a', 'duration', 3.2)
      await page.evaluate(() => window.multiClipInspectorTest.setTimelineVisible(false))
      await preview.waitFor({ state: 'hidden' }); const unmounted = await state()
      await move(0.6); await page.mouse.up(); assert.deepEqual((await state()).clips, unmounted.clips)
      await page.evaluate(() => window.multiClipInspectorTest.setTimelineVisible(true))
    }
    console.log('PASS: release, blur, pointer cancellation, Escape, selection, lock, timeline load/removal, intervening history and optional unmount terminate feedback and stale gesture writes')

    await seed(); const unchanged = await state(); await start(); await release()
    assert.deepEqual((await state()).clips, unchanged.clips)
    assert.equal((await state()).playhead, unchanged.playhead)
    assert.equal((await state()).dirty, false)
    // Existing trim saves one history snapshot at pointer-down; preview must not
    // add a second snapshot even when the pointer never moves.
    assert.equal((await state()).history, 1)
    assert.deepEqual(errors, [], 'no renderer exceptions')
    console.log(`PASS: feedback-only gesture leaves project data clean; ${native ? 'Electron' : 'Chrome'} trim-preview integration complete`)
  } finally {
    if (browser) await browser.close()
    // Only explicitly known generated files from our unique directory.
    for (const file of ['source.mp4', 'cached.mp4']) {
      const generated = path.join(temp, file)
      if (fs.existsSync(generated)) fs.unlinkSync(generated)
    }
    fs.rmdirSync(temp)
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
