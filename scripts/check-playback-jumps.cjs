// Isolated real transport hook + Timeline clicks + Canvas/Audio renderer.
// Media stays in memory; no production main/preload, user project, capture
// bridge or hand-driven timeline clock participates in the measurement.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const base = process.env.VELORN_TEST_URL || 'http://127.0.0.1:5193'
const native = process.env.VELORN_TEST_ELECTRON === '1'
const baseline = process.env.VELORN_PLAYBACK_JUMP_BASELINE === '1'
const FPS = 24

function media(alternate = false) {
  const input = process.env[alternate ? 'VELORN_PLAYBACK_JUMP_SOURCE_B' : 'VELORN_PLAYBACK_JUMP_SOURCE']
  const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static')
  if (input) {
    const result = spawnSync(ffmpeg, ['-hide_banner', '-i', path.resolve(input)], { encoding: 'utf8', timeout: 15000 })
    const stream = String(result.stderr).split('\n').find(line => line.includes('Video:')) || ''
    assert.equal(Number(stream.match(/(?:,|\s)([\d.]+) fps(?:,|\s|$)/)?.[1]), FPS, 'exact-frame fixture requires24fps sources')
    return { base64: fs.readFileSync(path.resolve(input)).toString('base64'), fps: FPS }
  }
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'testsrc2=size=1280x720:rate=24:duration=8', '-an', '-vf', alternate ? 'hflip,hue=h=60' : 'null',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-g', '250', '-keyint_min', '250',
    '-sc_threshold', '0', '-bf', '2', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov',
    '-f', 'mp4', 'pipe:1'], { timeout: 60000, maxBuffer: 32 * 1024 * 1024 })
  assert.equal(result.status, 0, String(result.stderr))
  return { base64: result.stdout.toString('base64'), fps: FPS }
}

async function main() {
  const sources = { red: media(), blue: media(true) }
  const browser = native ? await _electron.launch({ executablePath: require('electron'),
    args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')], env: { ...process.env, VELORN_TEST_URL: base } })
    : await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true })
  try {
    const page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    if (native) await browser.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
    const errors = []
    page.on('pageerror', error => { errors.push(error.message); console.error('Renderer:', error.message) })
    await page.routeWebSocket(url => url.hostname === new URL(base).hostname && url.port === new URL(base).port, socket => socket.close())
    await page.addInitScript(() => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
      const elements = new Map(), ids = new WeakMap(), observed = new WeakSet()
      let nextId = 0
      const id = element => { if (!ids.has(element)) { ids.set(element, ++nextId); elements.set(nextId, element) }; return ids.get(element) }
      window.jumpDiagnostic = { seeks: [], frames: [], events: [], latestFrames: new Map(), elements,
        recording: false, samples: [], actions: [] }
      const entry = element => ({ at: performance.now(), id: id(element), kind: element.tagName,
        source: element.currentSrc || element.src, time: element.currentTime, ready: element.readyState,
        seeking: element.seeking, paused: element.paused, timeline: window.compoundTest?.timeline.getState().playheadPosition })
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { ...descriptor, set(value) {
        if (window.jumpDiagnostic.recording) window.jumpDiagnostic.seeks.push({ ...entry(this), to: value })
        return descriptor.set.call(this, value)
      } })
      for (const method of ['play', 'pause']) {
        const original = HTMLMediaElement.prototype[method]
        HTMLMediaElement.prototype[method] = function (...args) {
          if (window.jumpDiagnostic.recording) window.jumpDiagnostic.events.push({ ...entry(this), method })
          return original.apply(this, args)
        }
      }
      const request = HTMLVideoElement.prototype.requestVideoFrameCallback
      const observe = video => {
        id(video)
        if (observed.has(video)) return
        observed.add(video)
        let callback = null
        const arm = () => {
          if (callback != null || video.readyState < 1 || video.dataset.reference === 'true') return
          callback = request.call(video, (now, metadata) => {
            callback = null
            const frame = { ...entry(video), presented: metadata.mediaTime }
            window.jumpDiagnostic.latestFrames.set(id(video), frame)
            if (window.jumpDiagnostic.recording) window.jumpDiagnostic.frames.push(frame)
            arm()
          })
        }
        video.addEventListener('loadedmetadata', arm)
        video.addEventListener('emptied', () => { if (callback != null) video.cancelVideoFrameCallback(callback); callback = null })
        arm()
      }
      const create = document.createElement.bind(document)
      document.createElement = (...args) => { const element = create(...args); if (String(args[0]).toLowerCase() === 'video') observe(element); return element }
      HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
        observe(this)
        // Also observe callbacks the renderer requested itself before invoking
        // it: a synchronous commit inside that callback must see this newest
        // PTS even when our separate passive observer runs later in the batch.
        return request.call(this, (now, metadata) => {
          const frame = { ...entry(this), presented: metadata.mediaTime }
          window.jumpDiagnostic.latestFrames.set(id(this), frame)
          if (window.jumpDiagnostic.recording && this.dataset.reference !== 'true') window.jumpDiagnostic.frames.push(frame)
          callback(now, metadata)
        })
      }
      const Audio = window.Audio
      window.Audio = function (...args) { const audio = new Audio(...args); id(audio); return audio }
      window.Audio.prototype = Audio.prototype
    })
    await page.goto(base + '/tests/fixtures/playback-jumps.html' + (native ? '?nativeWaveformStub=1' : ''))
    await page.waitForFunction(() => Boolean(window.compoundTest))
    await page.evaluate(value => window.compoundTest.initializeMedia(value), sources)

    async function seed({ start = 1, transition = false, failed = false, delayed = false } = {}) {
      await page.evaluate(({ start, transition, failed, delayed }) => {
        const t = window.compoundTest, a = t.getAsset('red'), b = t.getAsset('blue'), audio = t.getAsset('tone')
        t.reset({ clips: [t.makeClip('first', { trackId: 'video', startTime: 0, duration: 4,
          trimStart: 1, trimEnd: 5, sourceDuration: a.duration }),
        t.makeClip(delayed ? `delayed-second-${t.timeline.getState().timelineSessionId}` : 'second', { assetId: failed || delayed ? 'external-blue' : 'blue',
          url: failed ? `${location.origin}/__missing_jump_media__.mp4` : delayed ? `${location.origin}/__delayed_jump_media__.mp4` : b.url,
          trackId: 'video', startTime: 4, duration: 4, trimStart: 1, trimEnd: 5, sourceDuration: b.duration }),
        t.makeClip('sound', { assetId: 'tone', url: audio.url, type: 'audio', trackId: 'audio', startTime: 0,
          duration: 8, trimStart: 0, trimEnd: 8, sourceDuration: 8, gainDb: 0, fadeIn: 0, fadeOut: 0 })],
        tracks: [t.track('video'), t.track('audio', 'audio')], selectedClipIds: [], activeTrackId: 'video',
        playheadPosition: start, playheadSeekIntent: null, playbackJump: null, playbackJumpError: null,
        inPoint: null, outPoint: null, duration: 8,
        zoom: 500, markers: [], loopMode: 'normal', followPlayhead: false,
        transitions: transition ? [{ id: 'dissolve', kind: 'between', type: 'dissolve', clipAId: 'first', clipBId: 'second',
          duration: .75, editPoint: 4, originalClipAEnd: 4, originalClipBStart: 4, settings: { alignment: 'center' } }] : [] })
        document.querySelector('[data-testid="timeline-viewport"]').scrollLeft = 0
      }, { start, transition, failed, delayed })
      await page.waitForFunction(start => { const frame = window.compoundTest.getPreviewFrameSnapshot(); return frame?.canvas && Math.abs(frame.time - start) < 1e-5 }, start)
    }
    async function clickTime(time) {
      const point = await page.evaluate(time => {
        const viewport = document.querySelector('[data-testid="timeline-viewport"]'), ruler = document.querySelector('[data-testid="timeline-scrub-ruler"]')
        const rect = viewport.getBoundingClientRect(), rr = ruler.getBoundingClientRect()
        window.jumpDiagnostic.actions.push({ at: performance.now(), target: time })
        return { x: rect.left + time * window.compoundTest.timeline.getState().zoom / 5 - viewport.scrollLeft, y: rr.top + rr.height / 2 }
      }, time)
      await page.mouse.click(point.x, point.y)
    }
    async function recordStart() {
      await page.evaluate(() => {
        const d = window.jumpDiagnostic, t = window.compoundTest
        d.seeks = []; d.frames = []; d.events = []; d.samples = []; d.actions = []; d.states = []; d.landings = []; d.recording = true
        d.before = JSON.stringify(t.timeline.getState().getProjectData())
        const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 54
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        const sample = () => {
          const frame = t.getPreviewFrameSnapshot(), state = t.timeline.getState()
          let hash = 2166136261, light = 0
          if (frame?.canvas) {
            ctx.clearRect(0, 0, 96, 54); ctx.drawImage(frame.canvas, 0, 0, 96, 54)
            const pixels = ctx.getImageData(0, 0, 96, 54).data
            for (let i = 0; i < pixels.length; i += 4) { light += pixels[i] + pixels[i + 1] + pixels[i + 2]; hash = Math.imul(hash ^ pixels[i] ^ pixels[i + 1] << 8 ^ pixels[i + 2] << 16, 16777619) >>> 0 }
          }
          const media = [...d.elements.entries()].filter(([, el]) => el.currentSrc).map(([id, el]) => ({ id, kind: el.tagName,
            source: el.currentSrc, time: el.currentTime, ready: el.readyState, seeking: el.seeking, paused: el.paused,
            pts: d.latestFrames.get(id)?.presented }))
          const result = { at: performance.now(), timeline: state.playheadPosition, playing: state.isPlaying,
            pending: Boolean(state.playbackJump), token: state.playbackJump?.token, frameTime: frame?.time, serial: frame?.serial, hash,
            light: light / (96 * 54 * 3), media }
          d.samples.push(result)
          return result
        }
        d.unsubscribe?.()
        d.unsubscribe = t.timeline.subscribe((state, previous) => {
          if (state.playbackJump !== previous.playbackJump || state.isPlaying !== previous.isPlaying) {
            const snapshot = sample()
            d.states.push({ ...snapshot, target: state.playbackJump?.targetTime, error: state.playbackJumpError })
            if (previous.playbackJump && !state.playbackJump && state.isPlaying) {
              d.landings.push({ ...snapshot, target: previous.playbackJump.targetTime, token: previous.playbackJump.token,
                pixels: [...ctx.getImageData(0, 0, 96, 54).data] })
            }
          }
        })
        sample(); d.interval = setInterval(sample, 16)
      })
    }
    async function recordEnd() {
      return page.evaluate(() => {
        const d = window.jumpDiagnostic, t = window.compoundTest
        clearInterval(d.interval); d.unsubscribe?.(); d.unsubscribe = null; d.recording = false
        return { samples: d.samples, seeks: d.seeks, frames: d.frames, events: d.events, actions: d.actions,
          states: d.states, landings: d.landings,
          before: d.before, after: JSON.stringify(t.timeline.getState().getProjectData()), dirty: t.isProjectDirty() }
      })
    }

    // Independent private decoders validate the exact jump picture after it was
    // passively observed. They never seek/capture the application's video.
    async function reference(time, transition = false) {
      return page.evaluate(async ({ time, transition }) => {
        const t = window.compoundTest, state = t.timeline.getState(), decoded = []
        const full = document.createElement('canvas'); full.width = 960; full.height = 540
        const ctx = full.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 960, 540)
        const clips = state.clips.filter(clip => clip.type === 'video' && (transition || time >= clip.startTime && time < clip.startTime + clip.duration))
        for (let i = 0; i < clips.length; i++) {
          const clip = clips[i], asset = t.getAsset(clip.assetId)
          // Existing rendering treats the nominal tail as end-exclusive even
          // at a transition's exact cut; handle footage starts strictly beyond
          // it. Preserve that clock contract, independently decode its frame.
          const rawSourceTime = clip.trimStart + time - clip.startTime
          const sourceTime = time === clip.startTime + clip.duration ? Math.min(rawSourceTime, clip.trimEnd - .01) : rawSourceTime
          const targetFrame = Math.floor(sourceTime * asset.fps + 1e-7)
          const video = document.createElement('video'); video.dataset.reference = 'true'; video.muted = true
          await new Promise((resolve, reject) => {
            video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('Reference metadata failed'))
            video.src = asset.url; video.load()
          })
          const pts = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Exact reference frame timed out')), 15000)
            const arm = () => video.requestVideoFrameCallback((now, metadata) => {
              if (Math.round(metadata.mediaTime * asset.fps) === targetFrame) { clearTimeout(timeout); resolve(metadata.mediaTime) } else arm()
            })
            arm(); video.currentTime = (targetFrame + .25) / asset.fps
          })
          decoded.push({ assetId: asset.id, source: asset.url, sourceTime, targetFrame, presentedPTS: pts })
          const scale = Math.min(960 / video.videoWidth, 540 / video.videoHeight)
          const width = video.videoWidth * scale, height = video.videoHeight * scale
          ctx.globalAlpha = i === 1 ? .5 : 1
          ctx.drawImage(video, (960 - width) / 2, (540 - height) / 2, width, height)
          video.removeAttribute('src'); video.load()
        }
        const small = document.createElement('canvas'); small.width = 96; small.height = 54
        const context = small.getContext('2d'); context.drawImage(full, 0, 0, 96, 54)
        return { pixels: [...context.getImageData(0, 0, 96, 54).data], decoded }
      }, { time, transition })
    }
    const meanDifference = (actual, expected) => actual.reduce((sum, value, i) => sum + (i % 4 === 3 ? 0 : Math.abs(value - expected[i])), 0) / (96 * 54 * 3)

    const cases = [
      { name: 'playing backward within clip', start: 2.5, targets: [1] },
      { name: 'playing forward within clip', start: .5, targets: [2.5] },
      { name: 'playing forward across cut', start: 1, targets: [5] },
      { name: 'playing backward across cut', start: 5.5, targets: [2] },
      { name: 'latest repeated playing clicks', start: 1, targets: [5.5, 2, 6, 1.5] },
      { name: 'playing transition landing', start: 1, targets: [4], transition: true },
    ]
    const results = []
    const original = Boolean(process.env.VELORN_PLAYBACK_JUMP_SOURCE)
    const caseSuffix = process.env.VELORN_PLAYBACK_JUMP_CASE ? `-${process.env.VELORN_PLAYBACK_JUMP_CASE.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}` : ''
    const artifact = `/tmp/velorn-playback-jumps-${baseline ? 'baseline' : 'verification'}${!baseline && original ? '-original' : ''}${caseSuffix}-${native ? 'native' : 'chrome'}.json`
    const save = () => fs.writeFileSync(artifact, JSON.stringify(results, null, 2))
    for (const testCase of cases.filter(item => !process.env.VELORN_PLAYBACK_JUMP_CASE || item.name === process.env.VELORN_PLAYBACK_JUMP_CASE)) {
      await seed(testCase)
      await page.getByTestId('playback-jumps-transport').click()
      await page.waitForFunction(start => window.compoundTest.timeline.getState().playheadPosition > start + .15, testCase.start)
      await recordStart()
      for (const target of testCase.targets) { await clickTime(target); if (testCase.targets.length > 1) await page.waitForTimeout(45) }
      if (!baseline) await page.waitForFunction(() => !window.compoundTest.timeline.getState().playbackJump, null, { timeout: 6500 })
      await page.waitForTimeout(baseline ? 1100 : 650)
      const observed = await recordEnd()
      await page.getByTestId('playback-jumps-transport').click()
      const after = observed.samples.filter(sample => sample.at >= observed.actions[0].at)
      const changes = after.filter((sample, index) => index && sample.hash !== after[index - 1].hash)
      const black = after.filter(sample => sample.light < 2)
      const report = { runtime: native ? 'Electron-visible' : 'Chrome', mode: baseline ? 'baseline' : 'verification',
        source: original ? 'read-only originals' : 'generated1280x720 long-GOP/B-frame',
        name: testCase.name, samples: after.length, pictureChanges: changes.length, blackSamples: black.length,
        videoSeekAssignments: observed.seeks.filter(seek => seek.kind === 'VIDEO').length,
        audioSeekAssignments: observed.seeks.filter(seek => seek.kind === 'AUDIO').length,
        distinctPresentedFrames: new Set(observed.frames.map(frame => `${frame.id}:${frame.presented}`)).size,
        finalTimeline: after.at(-1)?.timeline, finalFrameTime: after.at(-1)?.frameTime,
        firstBlackDelayMs: black.length ? black[0].at - observed.actions[0].at : null }
      console.log(JSON.stringify(report)); results.push({ report, observed }); save()
      assert.equal(observed.after, observed.before, 'click/playback navigation does not alter project')
      assert.equal(observed.dirty, false)
      if (!baseline) {
        assert.equal(black.length, 0, 'covered timeline must retain a picture throughout a playing jump')
        assert.ok(changes.length >= 3, 'playback resumes with changing pictures after the jump')
        const lastTarget = testCase.targets.at(-1)
        assert.ok(after.at(-1).timeline >= lastTarget && after.at(-1).timeline < lastTarget + 1.5, 'latest click owns transport destination')
        const landing = observed.landings.findLast(item => Math.abs(item.target - lastTarget) < 1e-6)
        assert.ok(landing, 'latest jump is acknowledged after committing its exact picture')
        assert.ok(Math.abs(landing.frameTime - lastTarget) < 1e-6, 'frame tap publishes exact target before transport resumes')
        const expected = await reference(lastTarget, testCase.transition)
        report.meanLandingPixelDifference = meanDifference(landing.pixels, expected.pixels)
        report.latestJumpHoldMs = landing.at - observed.actions.at(-1).at
        report.landingPTS = expected.decoded
        save()
        assert.ok(report.meanLandingPixelDifference < 5, 'playing jump landing matches independent exact source-frame pixels')
        for (const decoded of expected.decoded) assert.ok(landing.media.some(element => element.kind === 'VIDEO'
          && element.source === decoded.source && element.ready >= 2 && !element.seeking
          && Math.round(element.pts * FPS) === decoded.targetFrame), 'acknowledged source is drawable with matching latest presented PTS')
        const held = observed.samples.filter(sample => sample.pending)
        assert.ok(held.length, 'playing clicks enter explicit decoder hold')
        for (const sample of held) {
          const state = observed.states.findLast(item => item.at <= sample.at && item.token === sample.token)
          assert.ok(!state || Math.abs(sample.timeline - state.target) < 1e-6, 'transport clock does not run ahead while pending')
          assert.ok(sample.media.filter(element => element.kind === 'AUDIO').every(element => element.paused), 'audio is paused throughout decoder hold')
        }
        const finalAudio = after.at(-1).media.filter(element => element.kind === 'AUDIO')
        assert.ok(finalAudio.some(element => !element.paused && Math.abs(element.time - after.at(-1).timeline) < .2), 'audio resumes aligned with the latest transport target')
      }
    }
    if (!baseline && (!process.env.VELORN_PLAYBACK_JUMP_CASE || process.env.VELORN_PLAYBACK_JUMP_CASE === 'same encoded-frame playing navigation')) {
      await seed({ start: 1 })
      await page.getByTestId('playback-jumps-transport').click()
      await page.waitForFunction(() => window.compoundTest.timeline.getState().playheadPosition > 1.15)
      await recordStart()
      const sameFrame = await page.evaluate(() => {
        const t = window.compoundTest, s = t.timeline.getState(), d = window.jumpDiagnostic
        const video = [...d.elements.values()].find(element => element.tagName === 'VIDEO'
          && element.currentSrc === t.getAsset('red').url && !element.paused && element.readyState >= 2)
        if (!video) throw new Error('No playing source decoder for same-frame navigation')
        const sourceTime = video.currentTime, target = sourceTime - 1
        d.actions.push({ at: performance.now(), target })
        // An explicit unsnapped navigation is intentionally not a ruler click:
        // it exercises a currently decoded frame at a non-interior clock.
        s.setPlayheadPosition(target, { snap: false })
        return { target, sourceTime, sourceFrame: Math.floor(sourceTime * 24) }
      })
      await page.waitForFunction(() => !window.compoundTest.timeline.getState().playbackJump, null, { timeout: 6000 })
      await page.waitForTimeout(200)
      const observed = await recordEnd()
      const landing = observed.landings.findLast(item => Math.abs(item.target - sameFrame.target) < 1e-6)
      const report = { name: 'same encoded-frame playing navigation', ...sameFrame,
        successful: Boolean(landing), error: await page.evaluate(() => window.compoundTest.timeline.getState().playbackJumpError) }
      results.push({ report, observed }); save()
      assert.ok(landing, 'same encoded-frame navigation completes rather than waiting for a missing callback')
      assert.ok(landing.at - observed.actions[0].at < 5000)
      assert.ok(landing.media.some(element => element.kind === 'VIDEO' && !element.seeking && element.ready >= 2
        && Math.round(element.pts * FPS) === sameFrame.sourceFrame), 'same-frame landing has matching latest PTS')
      assert.equal(observed.samples.filter(sample => sample.light < 2).length, 0)
      assert.equal(observed.after, observed.before)
      await page.getByTestId('playback-jumps-transport').click()
      const expected = await reference(sameFrame.target)
      report.meanLandingPixelDifference = meanDifference(landing.pixels, expected.pixels)
      assert.ok(report.meanLandingPixelDifference < 5)
      save(); console.log(`PASS same encoded-frame playing navigation ${JSON.stringify(report)}`)
    }
    if (!baseline && !process.env.VELORN_PLAYBACK_JUMP_CASE) {
      await seed({ start: 1 })
      for (const target of [0, 4.25]) {
        const before = await page.evaluate(() => JSON.stringify(window.compoundTest.timeline.getState().getProjectData()))
        await clickTime(target)
        const expected = await reference(target)
        await page.waitForFunction(({ target, expected }) => {
          const t = window.compoundTest, state = t.timeline.getState(), frame = t.getPreviewFrameSnapshot()
          if (state.isPlaying || state.playbackJump || state.playheadPosition !== target
            || state.playheadSeekIntent?.type !== 'frame-step' || !frame?.canvas || Math.abs(frame.time - target) > 1e-6) return false
          const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 54
          const ctx = canvas.getContext('2d'); ctx.drawImage(frame.canvas, 0, 0, 96, 54)
          const actual = ctx.getImageData(0, 0, 96, 54).data
          let difference = 0
          for (let i = 0; i < actual.length; i++) if (i % 4 !== 3) difference += Math.abs(actual[i] - expected[i])
          return difference / (96 * 54 * 3) < 5
        }, { target, expected: expected.pixels }, { timeout: 15000 })
        const after = await page.evaluate(() => JSON.stringify(window.compoundTest.timeline.getState().getProjectData()))
        assert.equal(after, before)
      }
      results.push({ report: { name: 'paused exact ruler clicks including zero', passed: true } }); save()
      console.log('PASS paused exact ruler clicks including zero')

      await seed({ start: .5, failed: true })
      await page.getByTestId('playback-jumps-transport').click()
      await page.waitForFunction(() => window.compoundTest.timeline.getState().playheadPosition > .65)
      await recordStart(); await clickTime(5)
      await page.waitForFunction(() => {
        const state = window.compoundTest.timeline.getState()
        return !state.isPlaying && !state.playbackJump && Boolean(state.playbackJumpError)
      }, null, { timeout: 6500 })
      const failure = await recordEnd()
      assert.ok(failure.samples.at(-1).at - failure.actions[0].at < 6500, 'unavailable source pauses with a bounded error')
      assert.equal(failure.landings.length, 0, 'missing media is never acknowledged as a successful picture')
      assert.equal(failure.after, failure.before)
      assert.ok(failure.samples.at(-1).media.filter(element => element.kind === 'AUDIO').every(element => element.paused))
      results.push({ report: { name: 'unavailable media bounded pause and error', passed: true }, observed: failure }); save()
      console.log('PASS unavailable media bounded pause and error')

      for (const cancel of ['pause', 'project replacement']) {
        let releaseResponse
        let delayedRequests = 0
        const gate = new Promise(resolve => { releaseResponse = resolve })
        await page.route('**/__delayed_jump_media__.mp4', async route => {
          delayedRequests++
          await gate
          await route.fulfill({ status: 200, contentType: 'video/mp4', headers: { 'cache-control': 'no-store' }, body: Buffer.from(sources.blue.base64, 'base64') }).catch(() => {})
        })
        await seed({ start: .5, delayed: true })
        await page.getByTestId('playback-jumps-transport').click()
        await page.waitForFunction(() => window.compoundTest.timeline.getState().playheadPosition > .65)
        await recordStart(); await clickTime(5)
        try { await page.waitForFunction(() => Boolean(window.compoundTest.timeline.getState().playbackJump), null, { timeout: 3000 }) }
        catch (error) {
          console.error('Delayed source diagnostic', { delayedRequests, detail: await page.evaluate(() => {
            const s = window.compoundTest.timeline.getState(), d = window.jumpDiagnostic
            return { playing: s.isPlaying, position: s.playheadPosition, pending: s.playbackJump,
              error: s.playbackJumpError, states: d.states, seeks: d.seeks }
          }) })
          releaseResponse()
          throw error
        }
        await page.waitForTimeout(250)
        if (cancel === 'pause') await page.getByTestId('playback-jumps-transport').click()
        else await seed({ start: .75 })
        const canceledPosition = await page.evaluate(() => window.compoundTest.timeline.getState().playheadPosition)
        releaseResponse()
        await page.waitForTimeout(700)
        const canceled = await recordEnd()
        const final = await page.evaluate(() => { const s = window.compoundTest.timeline.getState(); return { playing: s.isPlaying, position: s.playheadPosition, pending: s.playbackJump } })
        assert.equal(final.playing, false, 'late readiness cannot restart canceled audio/transport')
        assert.equal(final.position, canceledPosition)
        assert.equal(final.pending, null)
        assert.equal(canceled.landings.length, 0, 'canceled token cannot acknowledge a late picture')
        assert.ok(canceled.samples.at(-1).media.filter(element => element.kind === 'AUDIO').every(element => element.paused))
        await page.unroute('**/__delayed_jump_media__.mp4')
        results.push({ report: { name: `pending jump ${cancel} cancellation`, passed: true }, observed: canceled }); save()
        console.log(`PASS pending jump ${cancel} cancellation`)
      }
    }
    save()
    console.log(`RESULT ${results.length}/${results.length} ${baseline ? 'baseline recorded' : 'passed'}; ${artifact}`)
    assert.deepEqual(errors, [], 'no renderer exceptions')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
