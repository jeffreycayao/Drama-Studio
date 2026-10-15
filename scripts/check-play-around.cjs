// Isolated renderer integration: real PreviewPanel/transport/Timeline and
// decoded synthetic media. Electron uses the fixture host, never production
// main/preload, the MCP bridge, a user project or filesystem/cache writes.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const base = process.env.VELORN_TEST_URL || 'http://127.0.0.1:5193'
const native = process.env.VELORN_TEST_ELECTRON === '1'
const output = process.env.VELORN_PLAY_AROUND_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-play-around-'))

function media({ alternate = false, start = 0, duration = 8 } = {}) {
  const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static')
  const filter = `${alternate ? 'hflip,hue=h=60,' : ''}trim=start=${start}:duration=${duration},setpts=PTS-STARTPTS`
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'testsrc2=size=640x360:rate=24:duration=8', '-an', '-vf', filter, '-r', '24',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-g', '192', '-keyint_min', '192',
    '-sc_threshold', '0', '-bf', '2', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov',
    '-f', 'mp4', 'pipe:1'], { timeout: 60000, maxBuffer: 24 * 1024 * 1024 })
  assert.equal(result.status, 0, String(result.stderr))
  const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', 'pipe:0'], { input: result.stdout, encoding: 'utf8', timeout: 10000 })
  const stream = String(probe.stderr).split('\n').find(line => line.includes('Video:')) || ''
  assert.equal(Number(stream.match(/(?:,|\s)([\d.]+) fps(?:,|\s|$)/)?.[1]), 24, `Encoded fixture must be 24 fps: ${stream}`)
  return result.stdout.toString('base64')
}

function preserved(before, after, { preferences = true, selection = true } = {}) {
  for (const key of ['project', 'history', 'historyIndex', 'historyLastChangedAt', 'inPoint', 'outPoint']) {
    assert.deepEqual(after[key], before[key], `${key} is unchanged by transport`)
  }
  if (selection) for (const key of ['selectedClipIds', 'selectedTransitionId', 'selectedMarkerId', 'selectedGap', 'activeTrackId']) {
    assert.deepEqual(after[key], before[key], `${key} survives review`)
  }
  if (preferences) for (const key of ['loopMode', 'playbackRate', 'shuttleMode']) assert.deepEqual(after[key], before[key], `${key} preference survives review`)
  assert.equal(after.dirty, false, 'review does not dirty the project')
}

async function main() {
  const encoded = { red: media(), blue: media({ alternate: true }),
    cachedRed: media({ start: 3, duration: 2 }), cachedBlue: media({ alternate: true, start: 1, duration: 2 }) }
  const browser = native ? await _electron.launch({ executablePath: require('electron'),
    args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')], env: { ...process.env, VELORN_TEST_URL: base } })
    : await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true })
  let page, releaseDelayed, releaseUnavailable
  const results = [], errors = []
  const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({
    runtime: native ? 'Linux Electron renderer (isolated visible fixture)' : 'Linux Chrome headless',
    claims: 'Functional real-clock Play Around verification with synthetic 24 fps H.264/B-frame media. Cache reuse is in-memory; no production native IPC, packaged build, export parity, platform coverage or performance benchmark is claimed.',
    results, errors,
  }, null, 2))
  try {
    page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.setDefaultTimeout(15000)
    if (native) await browser.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
    page.on('pageerror', error => { errors.push(error.message); console.error('Renderer:', error.message) })
    // Isolate this loaded fixture from other agents' in-progress Vite edits.
    await page.routeWebSocket(url => url.hostname === new URL(base).hostname && url.port === new URL(base).port, socket => socket.close())
    await page.addInitScript(() => {
      const frames = new Map(), elements = new Set()
      const request = HTMLVideoElement.prototype.requestVideoFrameCallback
      HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
        elements.add(this)
        return request.call(this, (now, metadata) => {
          frames.set(this, metadata.mediaTime)
          callback(now, metadata)
        })
      }
      const Audio = window.Audio
      window.Audio = function (...args) { const element = new Audio(...args); elements.add(element); return element }
      window.Audio.prototype = Audio.prototype
      window.playAroundDiagnostic = { frames, elements, samples: [], records: [] }
    })
    await page.goto(`${base}/tests/fixtures/play-around.html`)
    await page.waitForFunction(() => Boolean(window.playAroundTest))
    await page.evaluate(value => window.playAroundTest.initializeMedia(value), encoded)
    const transport = page.getByTestId('actual-transport-controls')
    const aroundButton = () => transport.getByTestId('play-around-button')
    const snapshot = () => page.evaluate(() => window.playAroundTest.snapshot())
    async function seed(patch = {}) {
      await page.evaluate(patch => {
        const t = window.playAroundTest
        t.setPreviewVisible(true); t.setTimelineVisible(true); t.reset(patch)
        document.querySelector('[data-testid="timeline-viewport"]').scrollLeft = 0
        document.activeElement?.blur()
      }, patch)
      await page.waitForFunction(time => {
        const t = window.playAroundTest, state = t.timeline.getState(), frame = t.getPreviewFrameSnapshot()
        return !state.isPlaying && frame?.canvas && Math.abs(frame.time - time) < 1e-6 && t.snapshot().light > 5
      }, patch.playheadPosition ?? 3)
    }
    async function clickTime(time) {
      const point = await page.evaluate(time => {
        const viewport = document.querySelector('[data-testid="timeline-viewport"]')
        const ruler = document.querySelector('[data-testid="timeline-scrub-ruler"]')
        const rect = viewport.getBoundingClientRect(), rr = ruler.getBoundingClientRect()
        return { x: rect.left + time * window.playAroundTest.timeline.getState().zoom / 5 - viewport.scrollLeft, y: rr.top + rr.height / 2 }
      }, time)
      await page.mouse.click(point.x, point.y)
    }
    async function recordStart() {
      await page.evaluate(() => {
        const t = window.playAroundTest, d = window.playAroundDiagnostic
        d.unsubscribe?.(); clearInterval(d.interval); d.samples = []; d.records = []
        const capture = () => {
          const { pixels, project, history, ...snapshot } = t.snapshot()
          const media = [...d.elements].filter(element => element.currentSrc && element.dataset.reference !== 'true')
            .map(element => ({ kind: element.tagName, source: element.currentSrc, time: element.currentTime,
              pts: d.frames.get(element), paused: element.paused, ready: element.readyState, seeking: element.seeking }))
          return { ...snapshot, media }
        }
        d.unsubscribe = t.timeline.subscribe((state, previous) => {
          if (state.playAround !== previous.playAround || state.isPlaying !== previous.isPlaying || state.playbackJump !== previous.playbackJump) {
            d.records.push(capture())
          }
        })
        d.samples.push(capture()); d.interval = setInterval(() => d.samples.push(capture()), 24)
      })
    }
    async function recordEnd() {
      return page.evaluate(() => {
        const d = window.playAroundDiagnostic
        clearInterval(d.interval); d.unsubscribe?.(); d.unsubscribe = null
        return { samples: d.samples, records: d.records }
      })
    }
    async function trigger({ keyboard = false } = {}) {
      if (keyboard) {
        await page.waitForFunction(() => document.querySelector('[data-testid="play-around-button"]')?.title.includes('Shift+K'))
        await page.keyboard.press('Shift+K')
      }
      else await aroundButton().click()
      return page.evaluate(() => ({ ...window.playAroundTest.timeline.getState().playAround }))
    }
    async function exactReference(time) {
      return page.evaluate(async time => {
        const t = window.playAroundTest, clip = t.timeline.getState().clips.find(clip => clip.type === 'video'
          && time >= clip.startTime && time < clip.startTime + clip.duration)
        if (!clip) throw new Error('Reference requires covered video time')
        const cached = t.snapshot().cached, cacheStart = time < 4 ? 2 : 4
        const frame = Math.floor((cached ? time - cacheStart : time - clip.startTime + clip.trimStart) * 24 + 1e-7)
        const url = cached ? t.cacheUrls.get(cacheStart === 2 ? '48_96' : '96_144') : t.getAsset(clip.assetId).url
        const video = document.createElement('video'); video.muted = true; video.dataset.reference = 'true'
        await new Promise((resolve, reject) => {
          video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('Reference metadata failed'))
          video.src = url; video.load()
        })
        const pts = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Reference frame timed out')), 10000)
          const arm = () => video.requestVideoFrameCallback((now, metadata) => {
            if (Math.round(metadata.mediaTime * 24) === frame) { clearTimeout(timeout); resolve(metadata.mediaTime) } else arm()
          })
          arm(); video.currentTime = (frame + .25) / 24
        })
        // Match the live compositor's full-size RGB surface before thumbnail
        // sampling. Direct video→thumbnail performs different YUV filtering.
        const settings = t.project.getState().getCurrentTimelineSettings()
        const full = document.createElement('canvas'); full.width = settings.width; full.height = settings.height
        full.getContext('2d').drawImage(video, 0, 0, full.width, full.height)
        const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 54
        const context = canvas.getContext('2d'); context.drawImage(cached ? video : full, 0, 0, 96, 54)
        const pixels = [...context.getImageData(0, 0, 96, 54).data]
        video.removeAttribute('src'); video.load()
        return { pixels, pts, frame, cached }
      }, time)
    }
    async function verifyPicture(time) {
      const reference = await exactReference(time)
      await page.waitForFunction(({ time, pixels }) => {
        const snapshot = window.playAroundTest.snapshot()
        if (snapshot.playing || Math.abs(snapshot.time - time) > 1e-6) return false
        const difference = snapshot.pixels.reduce((sum, value, index) => sum + (index % 4 === 3 ? 0 : Math.abs(value - pixels[index])), 0) / (96 * 54 * 3)
        window.playAroundDiagnostic.pictureComparison = { time, difference, expected: pixels, actual: snapshot.pixels }
        return difference < 3
      }, { time, pixels: reference.pixels })
      return { referencePTS: reference.pts, referenceFrame: reference.frame, cached: reference.cached }
    }
    async function finished(time) {
      await page.waitForFunction(time => {
        const s = window.playAroundTest.timeline.getState()
        return !s.playAround && !s.isPlaying && Math.abs(s.playheadPosition - time) < 1e-6
      }, time, { timeout: 11000 })
      await page.waitForFunction(time => {
        const video = document.querySelector('[data-testid="actual-preview-panel"] video[data-preview-popout-source="video"]')
        return video ? video.readyState >= 2 && !video.seeking
          : Math.abs((window.playAroundTest.getPreviewFrameSnapshot()?.time ?? -1) - time) < 1e-6
      }, time)
    }
    function report(name, detail = {}) {
      results.push({ name, ...detail }); save(); console.log(`PASS ${name}`)
    }
    async function appliedTransition() {
      await seed({ selectedClipIds: ['first', 'second'], selectedTransitionId: 'existing-dissolve',
        transitions: [{ id: 'existing-dissolve', kind: 'between', type: 'dissolve',
          clipAId: 'first', clipBId: 'second', duration: .75, editPoint: 4,
          originalClipAEnd: 4, originalClipBStart: 4, settings: { alignment: 'center' } }] })
      const before = await snapshot(), box = await page.locator('[data-clip-id="first"]').first().boundingBox()
      await page.mouse.click(box.x + box.width, box.y + box.height / 2, { button: 'right' })
      await page.getByTestId('play-around-cut').waitFor()
      await page.screenshot({ path: path.join(output, 'play-around-existing-transition-menu.png') })
      await page.getByTestId('play-around-cut').click()
      const session = (await snapshot()).session
      assert.equal(session.centerTime, 4); assert.equal(session.startTime, 2); assert.equal(session.endTime, 6)
      await finished(before.time)
      const returnedPicture = await verifyPicture(before.time)
      preserved(before, await snapshot())
      report('applied dissolve cut reviews once and preserves transition metadata and selection', { session, returnedPicture })
    }
    if (process.env.VELORN_PLAY_AROUND_ONLY === 'transition') {
      await appliedTransition()
      assert.deepEqual(errors, []); save()
      console.log(`RESULT ${results.length}/${results.length} passed; ${path.join(output, 'report.json')}`)
      return
    }

    // API-specific assertions below intentionally use the real store contract;
    // the test never publishes transport time or acknowledges decoder readiness.
    await seed()
    await recordStart()
    const before = await snapshot(), session = await trigger({ keyboard: true })
    await page.screenshot({ path: path.join(output, 'play-around-active.png') })
    assert.ok(session.token, 'Shift+K starts a single explicit review session')
    assert.equal(session.startTime, 1); assert.equal(session.endTime, 5); assert.equal(session.returnTime, 3)
    await finished(before.time)
    const returnedPicture = await verifyPicture(before.time)
    const evidence = await recordEnd(), after = await snapshot()
    preserved(before, after)
    assert.equal(after.jump, null)
    assert.ok(evidence.samples.some(sample => sample.playing && sample.time > before.time + .5), 'real playback advances beyond the anchor')
    assert.ok(new Set(evidence.samples.filter(sample => sample.playing).map(sample => sample.hash)).size >= 12, 'decoded preview pictures change during review')
    assert.ok(evidence.samples.some(sample => sample.media.some(element => element.kind === 'AUDIO' && !element.paused)), 'real audio playback participates')
    assert.ok(evidence.samples.at(-1).media.filter(element => element.kind === 'AUDIO').every(element => element.paused), 'audio is paused after review')
    // Fixture hydration can briefly expose an empty canvas before the command.
    // Review coverage begins at the observed atomic session start, not reset.
    const reviewStartedAt = evidence.records.find(record => record.session?.token === session.token).at
    const blackSamples = evidence.samples.filter(sample => sample.at >= reviewStartedAt && sample.light < 2)
      .map(sample => ({ time: sample.time, frameTime: sample.frameTime, at: sample.at }))
    if (blackSamples.length) {
      await seed({ playheadPosition: 1 })
      await recordStart(); await page.keyboard.press('Space')
      await page.waitForFunction(() => window.playAroundTest.timeline.getState().playheadPosition > 5)
      await page.keyboard.press('Space')
      const ordinary = await recordEnd()
      const baselineBlack = ordinary.samples.filter(sample => sample.light < 2).map(sample => ({ time: sample.time, frameTime: sample.frameTime, at: sample.at }))
      report('ordinary-playback natural-cut picture baseline (diagnostic, not a no-black claim)', { blackSamples: baselineBlack, evidence: ordinary })
      console.log(`PICTURE_DIAGNOSTIC ${JSON.stringify({ around: blackSamples, ordinary: baselineBlack })}`)
    }
    assert.equal(blackSamples.length, 0, 'covered review keeps a picture from request through exact return')
    report('default Shift+K plays around playhead and returns without changing project', { session, returnedPicture, blackSamples, evidence })

    await seed()
    const cutBefore = await snapshot()
    const outgoing = page.locator('[data-clip-id="first"]').first()
    const box = await outgoing.boundingBox()
    assert.ok(box)
    await page.mouse.click(box.x + box.width, box.y + box.height / 2, { button: 'right' })
    await page.getByTestId('play-around-cut').waitFor()
    await page.screenshot({ path: path.join(output, 'play-around-cut-menu.png') })
    await page.getByTestId('play-around-cut').click()
    const cutSession = (await snapshot()).session
    assert.equal(cutSession.centerTime, 4); assert.equal(cutSession.startTime, 2); assert.equal(cutSession.endTime, 6)
    assert.equal(cutSession.returnTime, 3, 'cut target does not overwrite original playhead')
    await finished(cutBefore.time)
    await verifyPicture(cutBefore.time)
    preserved(cutBefore, await snapshot())
    report('real cut context menu reviews two seconds either side and returns to original playhead', { session: cutSession })
    await appliedTransition()

    for (const loopMode of ['loop', 'loop-in-out', 'loop-selection', 'ping-pong']) {
      await seed({ loopMode, playbackRate: -2, shuttleMode: true })
      const before = await snapshot()
      await trigger()
      await finished(before.time)
      preserved(before, await snapshot())
      report(`single forward review preserves ${loopMode} and reverse-shuttle preferences`)
    }

    for (const time of [.5, 7.5]) {
      await seed({ playheadPosition: time })
      const before = await snapshot()
      await recordStart(); await trigger(); await finished(time)
      const evidence = await recordEnd()
      assert.ok(evidence.samples.every(sample => sample.time >= 0 && sample.time <= 8), 'clamped review remains within actual timeline media bounds')
      preserved(before, await snapshot())
      report(`review clamps at ${time < 1 ? 'timeline start' : 'timeline end'}`, { evidence })
    }

    await seed()
    const repeatBefore = await snapshot()
    const first = await trigger()
    await page.waitForFunction(() => !window.playAroundTest.timeline.getState().playbackJump)
    await page.waitForTimeout(180)
    const second = await trigger()
    assert.notEqual(first.token, second.token, 'retrigger allocates a fresh owner')
    await finished(repeatBefore.time)
    preserved(repeatBefore, await snapshot())
    await page.waitForTimeout(250)
    assert.equal((await snapshot()).time, repeatBefore.time, 'stale session cannot spring back after the latest completion')
    report('rapid retrigger is latest-wins with original return position', { first, second })

    await seed()
    await page.evaluate(() => window.playAroundTest.setPlayAroundHotkey('Shift+P'))
    await page.waitForFunction(() => document.querySelector('[data-testid="play-around-button"]')?.title.includes('Shift+P'))
    await page.keyboard.press('Shift+K')
    assert.equal((await snapshot()).session, null, 'former shortcut no longer launches review')
    await page.keyboard.press('Shift+P')
    assert.ok((await snapshot()).session, 'configured shortcut launches review')
    await page.keyboard.press('Escape')
    await page.evaluate(() => window.playAroundTest.setPlayAroundHotkey('Shift+K'))
    report('configured shortcut replaces default without conflict')

    for (const blocked of ['text input', 'modal dialog', 'media preparation', 'source preview']) {
      await seed()
      const before = await snapshot()
      await page.evaluate(blocked => {
        const t = window.playAroundTest
        if (blocked === 'text input' || blocked === 'modal dialog') {
          const element = document.createElement(blocked === 'text input' ? 'input' : 'div')
          element.id = 'play-around-blocking-fixture'
          element.style.cssText = 'position:fixed;left:10px;top:10px;z-index:9999;width:200px;height:35px'
          if (blocked === 'modal dialog') { element.setAttribute('role', 'dialog'); element.setAttribute('aria-modal', 'true'); element.textContent = 'Fixture dialog' }
          document.body.appendChild(element)
          if (blocked === 'text input') element.focus()
        }
        if (blocked === 'media preparation') t.assets.setState({ mediaPreparation: { critical: true } })
        if (blocked === 'source preview') { t.assets.setState({ currentPreview: t.getAsset('blue') }); t.assets.getState().setPreviewMode('asset') }
      }, blocked)
      await page.keyboard.press('Shift+K')
      const after = await snapshot()
      assert.equal(after.session, null); assert.equal(after.playing, false); assert.equal(after.time, before.time)
      preserved(before, after)
      await page.evaluate(() => document.getElementById('play-around-blocking-fixture')?.remove())
      report(`${blocked} blocks Play Around without changing timeline state`)
    }

    for (const cancel of ['Space', 'Escape', 'ruler', 'frame-step', 'shuttle']) {
      await seed()
      const before = await snapshot()
      await trigger()
      await page.waitForFunction(() => { const s = window.playAroundTest.timeline.getState(); return !s.playbackJump && s.playheadPosition > 1.1 })
      if (cancel === 'ruler') await clickTime(6.5)
      else await page.keyboard.press(cancel === 'frame-step' ? 'ArrowRight' : cancel === 'shuttle' ? 'l' : cancel)
      await page.waitForFunction(() => !window.playAroundTest.timeline.getState().playAround)
      const canceled = await snapshot()
      // Explicit playing navigation/shuttle can continue normal transport.
      // Pause that new user intent before waiting past the abandoned endpoint.
      if (canceled.playing) await page.keyboard.press('Space')
      const stopped = await snapshot()
      await page.waitForTimeout(650)
      const after = await snapshot()
      assert.equal(after.session, null)
      assert.equal(after.time, stopped.time, 'canceled review never performs a deferred return')
      assert.notEqual(after.time, before.time, 'cancel stays at the user-chosen/current position')
      preserved(before, after, { preferences: false })
      report(`${cancel} cancels review without a deferred spring-back`, { canceledTime: canceled.time, finalTime: after.time })
    }

    for (const context of ['source mode', 'timeline replacement', 'preview unmount']) {
      await seed()
      await trigger()
      await page.waitForFunction(() => !window.playAroundTest.timeline.getState().playbackJump)
      await page.evaluate(context => {
        const t = window.playAroundTest
        if (context === 'source mode') { t.assets.setState({ currentPreview: t.getAsset('blue') }); t.assets.getState().setPreviewMode('asset') }
        if (context === 'timeline replacement') t.reset({ playheadPosition: .75 })
        if (context === 'preview unmount') t.setPreviewVisible(false)
      }, context)
      await page.waitForFunction(() => !window.playAroundTest.timeline.getState().playAround)
      const canceled = await snapshot()
      await page.waitForTimeout(650)
      const after = await snapshot()
      assert.equal(after.session, null); assert.equal(after.playing, false); assert.equal(after.time, canceled.time)
      report(`${context} cancels review and prevents stale completion`)
    }

    await seed()
    await trigger()
    await page.evaluate(() => window.playAroundTest.setTimelineVisible(false))
    await finished(3)
    report('hiding Timeline preserves the PreviewPanel-owned review clock')

    // Withhold decoder bytes, cancel the pending start, then release the real
    // source. A stale readiness callback must not resurrect the canceled owner.
    const delayed = new Promise(resolve => { releaseDelayed = resolve })
    await page.route('**/__play_around_delayed__.mp4', async route => {
      await delayed
      await route.fulfill({ status: 200, contentType: 'video/mp4', headers: { 'cache-control': 'no-store' },
        body: Buffer.from(encoded.blue, 'base64') }).catch(() => {})
    })
    await seed()
    await page.evaluate(() => {
      const t = window.playAroundTest, state = t.timeline.getState()
      t.timeline.setState({ clips: state.clips.map(clip => clip.id === 'second'
        ? { ...clip, id: 'delayed-second', assetId: 'external-blue', url: `${location.origin}/__play_around_delayed__.mp4` } : clip) })
      t.markProjectClean(); t.timeline.getState().startPlayAround(6)
    })
    await page.waitForFunction(() => Boolean(window.playAroundTest.timeline.getState().playbackJump))
    await page.keyboard.press('Space')
    const canceledPending = await snapshot()
    assert.equal(canceledPending.session, null); assert.equal(canceledPending.playing, false)
    releaseDelayed()
    await page.waitForTimeout(800)
    const lateReady = await snapshot()
    assert.equal(lateReady.time, canceledPending.time); assert.equal(lateReady.session, null)
    assert.equal(lateReady.jump, null); assert.equal(lateReady.playing, false)
    report('late decoded-source readiness cannot restart canceled review')

    const unavailable = new Promise(resolve => { releaseUnavailable = resolve })
    await page.route('**/__play_around_unavailable__.mp4', async route => {
      await unavailable
      await route.fulfill({ status: 404, contentType: 'video/mp4', body: '' }).catch(() => {})
    })
    await seed({ playbackRate: -2, shuttleMode: true, loopMode: 'loop-in-out' })
    await page.evaluate(() => {
      const t = window.playAroundTest, state = t.timeline.getState()
      t.timeline.setState({ clips: state.clips.map(clip => clip.id === 'second'
        ? { ...clip, id: 'unavailable-second', assetId: 'external-unavailable', url: `${location.origin}/__play_around_unavailable__.mp4` } : clip) })
      t.markProjectClean()
    })
    const failureBefore = await snapshot()
    await recordStart()
    await page.evaluate(() => window.playAroundTest.timeline.getState().startPlayAround(6))
    await page.waitForFunction(() => {
      const state = window.playAroundTest.timeline.getState()
      return Boolean(state.playbackJumpError) && !state.playbackJump && !state.playAround && !state.isPlaying
    }, null, { timeout: 7000 })
    const failed = await snapshot(), failureEvidence = await recordEnd()
    preserved(failureBefore, failed)
    assert.equal(failed.time, 4, 'failed decoder pauses at requested review start without deferred return')
    const request = failureEvidence.records.find(record => record.jump), terminal = failureEvidence.records.find(record => record.error)
    assert.ok(terminal.at - request.at >= 4800 && terminal.at - request.at < 6500, 'real watchdog bounds unavailable-source hold')
    report('unavailable-source watchdog pauses and restores saved loop/rate/shuttle preferences', { latencyMs: terminal.at - request.at, evidence: failureEvidence })
    releaseUnavailable()

    // Register synthetic existing chunks through the production reuse UI.
    // No render call or filesystem write is allowed by the fixture bridge.
    await seed()
    const panel = page.getByTestId('actual-preview-panel')
    for (const [start, end] of [[2, 4], [4, 6]]) {
      await page.evaluate(([inPoint, outPoint]) => window.playAroundTest.timeline.setState({ inPoint, outPoint, rangeRenderState: null }), [start, end])
      await panel.getByRole('button', { name: 'Render In→Out', exact: true }).click()
      await page.waitForFunction(([start, end]) => {
        const range = window.playAroundTest.timeline.getState().rangeRenderState
        return range?.status === 'cached' && range.rangeStart === start && range.rangeEnd === end
      }, [start, end])
    }
    await page.evaluate(() => {
      window.playAroundTest.timeline.setState({ inPoint: 1.25, outPoint: 1.75 })
      window.playAroundTest.markProjectClean()
    })
    const cachedBefore = await snapshot()
    await recordStart(); await trigger(); await finished(3)
    const cachedReturn = await verifyPicture(3)
    const cachedEvidence = await recordEnd()
    preserved(cachedBefore, await snapshot())
    assert.ok(cachedEvidence.samples.some(sample => sample.playing && !sample.cached), 'review uses the live Canvas branch before cached coverage')
    assert.ok(cachedEvidence.samples.some(sample => sample.playing && sample.cached && sample.time > 2.25 && sample.time < 3.75), 'review crosses into first cached chunk')
    assert.ok(cachedEvidence.samples.some(sample => sample.playing && sample.cached && sample.time > 4.25), 'review crosses the cut into the second cached chunk')
    assert.equal((await snapshot()).cached, true, 'completion returns to the cached original frame')
    report('actual PreviewPanel crosses live and two cached chunks then returns to exact cached frame', { cachedReturn, evidence: cachedEvidence })

    await page.setViewportSize({ width: 900, height: 1000 })
    await aroundButton().waitFor()
    await page.screenshot({ path: path.join(output, 'play-around-900px.png') })

    assert.equal(await page.evaluate(() => window.playAroundTest.bridgeCalls.some(call => call[0] === 'FORBIDDEN WRITE')), false)
    assert.deepEqual(errors, [], 'no renderer exceptions')
    save()
    console.log(`RESULT ${results.length}/${results.length} passed; ${path.join(output, 'report.json')}`)
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
      const diagnostic = await page.evaluate(() => ({ snapshot: window.playAroundTest?.snapshot(),
        transport: document.querySelector('[data-testid="actual-transport-controls"]')?.innerHTML,
        pictureComparison: window.playAroundDiagnostic?.pictureComparison,
        records: window.playAroundDiagnostic?.records, samples: window.playAroundDiagnostic?.samples })).catch(() => null)
      fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: error.message, diagnostic }, null, 2))
    }
    save(); console.error(`Failure artifacts: ${output}`); throw error
  } finally { releaseDelayed?.(); releaseUnavailable?.(); await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
