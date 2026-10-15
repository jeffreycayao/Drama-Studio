// Isolated real Timeline + Canvas renderer, never production main/preload or a
// user project. Media stays in memory. Optional original source is read-only.
// Assert live pictures DURING held real mouse scrubs, not capture-induced seeks
// or just the accurate frame after release. Timings are diagnostics, not FPS.
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { spawnSync } = require('node:child_process')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const FPS = 24, PPS = 100, SAMPLE_WIDTH = 96, SAMPLE_HEIGHT = 54
const base = process.env.VELORN_TEST_URL || 'http://127.0.0.1:5191'
const native = process.env.VELORN_TEST_ELECTRON === '1'

function generatedMedia(shortGop = false) {
  const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static')
  const encoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', `testsrc2=size=1280x720:rate=${FPS}:duration=7`, '-an',
    '-vf', shortGop ? 'hflip,hue=h=45' : 'null', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-g', shortGop ? '6' : '250', '-keyint_min', shortGop ? '6' : '250', '-sc_threshold', '0',
    '-bf', shortGop ? '0' : '2', '-pix_fmt', 'yuv420p',
    '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'],
  { timeout: 60000, maxBuffer: 32 * 1024 * 1024 })
  assert.equal(encoded.status, 0, String(encoded.stderr))
  return { base64: encoded.stdout.toString('base64'), fps: FPS }
}

async function main() {
  const original = process.env.VELORN_SCRUB_SOURCE
  const source = original ? { base64: fs.readFileSync(path.resolve(original)).toString('base64'),
    fps: Number(process.env.VELORN_SCRUB_SOURCE_FPS) || FPS } : generatedMedia()
  const shortGop = generatedMedia(true)
  const browser = native
    ? await _electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')],
      env: { ...process.env, VELORN_TEST_URL: base } })
    : await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true })
  try {
    const page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    // Installed Electron can suspend RAF in a never-shown host despite
    // backgroundThrottling:false. Test a visible interaction window instead.
    if (native) await browser.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
    page.setDefaultTimeout(15000)
    const errors = []
    page.on('pageerror', error => { errors.push(error.message); console.error('Renderer:', error.message) })
    await page.routeWebSocket(url => url.hostname === new URL(base).hostname && url.port === new URL(base).port,
      socket => socket.close())
    await page.addInitScript(() => {
      window.scrubPresentedFrames = []; window.scrubObservedVideos = new Set(); window.scrubLatestPresentation = new Map()
      const request = HTMLVideoElement.prototype.requestVideoFrameCallback
      const records = new WeakMap(); let nextId = 0
      // Passive per-element observer: no seeks, captures, draws, or app-state
      // writes. Unlike wrapping only app callbacks, this also sees pictures
      // legitimately reused by the exact cold-frame path.
      const observe = video => {
        if (records.has(video)) return
        const record = { id: ++nextId, callback: null }; records.set(video, record)
        const arm = () => {
          if (video.dataset.scrubReference === 'true' || record.callback != null || video.readyState < 1) return
          window.scrubObservedVideos.add(video)
          record.callback = request.call(video, (now, metadata) => {
            record.callback = null
            const entry = { id: record.id, at: performance.now(), presented: metadata.mediaTime,
              source: video.currentSrc, requested: video.currentTime, ready: video.readyState }
            window.scrubPresentedFrames.push(entry); window.scrubLatestPresentation.set(video, entry)
            if (window.scrubPresentedFrames.length > 3000) window.scrubPresentedFrames.shift()
            arm()
          })
        }
        video.addEventListener('loadedmetadata', arm)
        video.addEventListener('emptied', () => {
          if (record.callback != null) video.cancelVideoFrameCallback(record.callback)
          record.callback = null; window.scrubLatestPresentation.delete(video)
        })
        arm()
      }
      const create = document.createElement.bind(document)
      document.createElement = function (...args) {
        const element = create(...args)
        if (String(args[0]).toLowerCase() === 'video') observe(element)
        return element
      }
      HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
        observe(this)
        return request.call(this, callback)
      }
    })
    await page.goto(base + '/tests/fixtures/compound-clips.html' + (native ? '?nativeWaveformStub=1' : ''))
    await page.waitForFunction(() => Boolean(window.compoundTest))
    const assets = await page.evaluate(media => window.compoundTest.initializeMedia(media), { red: source, blue: shortGop })
    assert.ok(assets.find(a => a.id === 'red').duration >= 6.5, 'optional original must contain at least 6.5 seconds')

    // Decode references on separate private elements before the gesture. These
    // never seek the app renderer and are excluded from its callback readings.
    const referenceFrame = async layers => page.evaluate(async ({ layers, width, height }) => {
      const out = document.createElement('canvas'); out.width = 960; out.height = 540
      const ctx = out.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 960, 540)
      for (const layer of layers) {
        const asset = window.compoundTest.getAsset(layer.assetId), video = document.createElement('video')
        video.dataset.scrubReference = 'true'; video.muted = true; video.preload = 'auto'
        await new Promise((resolve, reject) => {
          video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('Reference metadata unavailable'))
          video.src = asset.url; video.load()
        })
        const targetFrame = Math.floor(layer.sourceTime * asset.fps + 1e-6)
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Independent reference frame timed out')), 15000)
          const next = () => video.requestVideoFrameCallback((now, metadata) => {
            if (Math.floor(metadata.mediaTime * asset.fps + 1e-6) === targetFrame) { clearTimeout(timeout); resolve() }
            else next()
          })
          next(); video.currentTime = (targetFrame + 0.25) / asset.fps
        })
        const scale = Math.min(960 / video.videoWidth, 540 / video.videoHeight), factor = layer.scale || 1
        const w = video.videoWidth * scale * factor, h = video.videoHeight * scale * factor
        ctx.globalAlpha = layer.opacity ?? 1; ctx.drawImage(video, (960 - w) / 2, (540 - h) / 2, w, h)
        video.removeAttribute('src'); video.load()
      }
      const small = document.createElement('canvas'); small.width = width; small.height = height
      const x = small.getContext('2d'); x.drawImage(out, 0, 0, width, height)
      return [...x.getImageData(0, 0, width, height).data]
    }, { layers, width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT })

    const cases = [
      { name: 'long-GOP B-frames', kind: 'single', assetId: 'red', moves: 120, interval: 20,
        release: 4.25, reference: [{ assetId: 'red', sourceTime: 4.25 }] },
      { name: 'short-GOP playback cache', kind: 'cache', assetId: 'red', moves: 120, interval: 20,
        release: 4.25, reference: [{ assetId: 'blue', sourceTime: 4.25 }] },
      { name: 'touching source cuts', kind: 'cuts', assetId: 'red', moves: 120, interval: 20,
        release: 4.25, reference: [{ assetId: 'blue', sourceTime: 1.25 }] },
      { name: 'two simultaneous source layers', kind: 'layers', assetId: 'red', moves: 120, interval: 20,
        release: 4.25, reference: [{ assetId: 'red', sourceTime: 4.25 }, { assetId: 'blue', sourceTime: 4.5, scale: 0.5 }] },
      { name: 'quiet held pointer then resumed scrubbing', kind: 'quiet', assetId: 'red', moves: 120, interval: 20,
        release: 4.25, reference: [{ assetId: 'red', sourceTime: 4.25 }] },
    ]
    if (process.env.VELORN_SCRUB_CASE) cases.splice(0, cases.length, ...cases.filter(c => c.kind === process.env.VELORN_SCRUB_CASE || c.name === process.env.VELORN_SCRUB_CASE))
    assert.ok(cases.length, 'requested test case exists')
    let passed = 0
    for (const testCase of cases) {
      await page.mouse.up(); await page.keyboard.press('Escape')
      const expectedPixels = await referenceFrame(testCase.reference)
      await page.evaluate(({ kind, assetId }) => {
        const t = window.compoundTest
        const clip = (id, aid, patch = {}) => {
          const a = t.getAsset(aid)
          return t.makeClip(id, { trackId: 'video', assetId: aid, url: a.url, name: aid,
            startTime: 0, duration: 6.5, trimStart: 0, trimEnd: 6.5, sourceDuration: a.duration,
            sourceFps: a.fps, timelineFps: 24, ...patch })
        }
        const clips = kind === 'cuts'
          ? [clip('first', 'red', { duration: 3.5, trimEnd: 3.5 }),
            clip('second', 'blue', { startTime: 3.5, duration: 3, trimStart: 0.5, trimEnd: 3.5 })]
          : [clip('picture', assetId)]
        if (kind === 'layers') clips.push(clip('overlay', 'blue', { trackId: 'overlay', trimStart: 0.25, trimEnd: 6.75,
          transform: { positionX: 0, positionY: 0, scaleX: 50, scaleY: 50, rotation: 0, opacity: 100 } }))
        t.reset({ clips, tracks: kind === 'layers' ? [t.track('overlay'), t.track('video')] : [t.track('video')],
          selectedClipIds: [], activeTrackId: 'video', zoom: 500, duration: 60,
          playheadPosition: 0.5, playheadSeekIntent: null, markers: [], inPoint: null, outPoint: null })
        if (kind === 'cache') t.assets.setState(s => ({ assets: s.assets.map(asset => asset.id === 'red'
          ? { ...asset, playbackCacheUrl: t.getAsset('blue').url, playbackCachePath: 'cache/synthetic-playback.mp4',
            playbackCacheStatus: 'ready', playbackCacheVersion: 'cfr_h264_kf6_v1' } : asset) }))
        document.querySelector('[data-testid="timeline-viewport"]').scrollLeft = 0
      }, testCase)
      await page.waitForFunction(() => {
        const f = window.compoundTest.getPreviewFrameSnapshot()
        return f?.canvas && Math.abs(f.time - 0.5) < 1e-6
      })
      const immutable = await page.evaluate(() => {
        const t = window.compoundTest, s = t.timeline.getState()
        return { doc: s.getProjectData(), history: s.history, historyIndex: s.historyIndex, selected: s.selectedClipIds }
      })
      const viewport = await page.getByTestId('timeline-viewport').boundingBox()
      const ruler = await page.locator('[title="Double-click to add marker"]').boundingBox()
      const y = ruler.y + ruler.height / 2
      await page.mouse.move(viewport.x + 0.5 * PPS, y); await page.mouse.down()
      await page.evaluate(({ width, height }) => {
        const t = window.compoundTest, c = document.createElement('canvas'); c.width = width; c.height = height
        const ctx = c.getContext('2d', { willReadFrequently: true }), start = performance.now(), samples = [], publications = []
        const firstCallback = window.scrubPresentedFrames.length
        const unsubscribe = t.timeline.subscribe((s, previous) => {
          if (s.playheadSeekRevision !== previous.playheadSeekRevision) publications.push({ at: performance.now() - start, time: s.playheadPosition })
        })
        const sample = () => {
          const f = t.getPreviewFrameSnapshot(); let hash = 2166136261, centerHash = 2166136261, outsideHash = 2166136261
          if (f?.canvas) { ctx.drawImage(f.canvas, 0, 0, width, height)
            const pixels = ctx.getImageData(0, 0, width, height).data
            for (let i = 0; i < pixels.length; i++) {
              const value = pixels[i], x = Math.floor(i / 4) % width, y = Math.floor(i / 4 / width)
              hash = Math.imul(hash ^ value, 16777619) >>> 0
              if (x >= width * 0.375 && x < width * 0.625 && y >= height * 0.375 && y < height * 0.625) {
                centerHash = Math.imul(centerHash ^ value, 16777619) >>> 0
              }
              if (x < width * 0.2) outsideHash = Math.imul(outsideHash ^ value, 16777619) >>> 0
            }
          }
          samples.push({ at: performance.now() - start, time: t.timeline.getState().playheadPosition,
            frameTime: f?.time, serial: f?.serial, hash, centerHash, outsideHash })
        }
        const timer = setInterval(sample, 40); sample()
        window.stopScrubSamples = () => { sample(); clearInterval(timer); unsubscribe()
          return { start, samples, publications, decoded: window.scrubPresentedFrames.slice(firstCallback), visibility: document.visibilityState } }
      }, { width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT })
      let resumedAt = null
      for (let i = 1; i <= testCase.moves; i++) {
        const phase = i % 60 / 60, target = 0.6 + (phase < 0.5 ? phase * 2 : (1 - phase) * 2) * 5.6
        await page.mouse.move(viewport.x + target * PPS, y); await page.waitForTimeout(testCase.interval)
        if (testCase.kind === 'quiet' && i === 40) {
          // Pointer remains held across both the 220 ms active window and the
          // 265 ms settle callback; then resumed input must keep presenting.
          await page.mouse.move(viewport.x + 6 * PPS, y)
          await page.waitForTimeout(350)
          resumedAt = await page.evaluate(() => performance.now())
        }
      }
      // End the live measurement before moving to the final release target.
      const observed = await page.evaluate(() => window.stopScrubSamples())
      const changes = observed.samples.filter((s, i, arr) => i && s.hash !== arr[i - 1].hash)
      const elapsed = observed.samples.at(-1).at, boundaries = [0, ...changes.map(s => s.at), elapsed]
      const report = { runtime: native ? 'Electron-visible' : 'Chrome', source: original ? path.basename(original) : 'procedural 1280x720 H.264',
        case: testCase.name, moves: testCase.moves, elapsedMs: Math.round(elapsed), pictureChanges: changes.length,
        maxUnchangedMs: Math.round(Math.max(...boundaries.slice(1).map((at, i) => at - boundaries[i]))),
        publications: observed.publications.length, decodedCallbacks: observed.decoded.length }
      console.log(JSON.stringify(report))
      if (changes.length < 6) console.error('Presentation stall diagnostic', JSON.stringify({
        lastSamples: observed.samples.slice(-3), callbacks: observed.decoded.slice(-8),
        videos: await page.evaluate(() => [...window.scrubObservedVideos].map(video => ({
          source: video.currentSrc, time: video.currentTime, ready: video.readyState, seeking: video.seeking,
          error: video.error?.message,
        }))),
      }))
      // Broad liveness bounds, not a frame-rate goal: an initial image and a
      // release image cannot satisfy these assertions. Both halves must update.
      assert.ok(changes.length >= 6, `${testCase.name}: at least six live picture changes during motion`)
      assert.ok(changes.some(s => s.at < elapsed / 2) && changes.some(s => s.at > elapsed / 2), `${testCase.name}: live changes in both halves`)
      assert.ok(report.maxUnchangedMs < elapsed * 0.7, `${testCase.name}: must not freeze for most of the gesture`)
      if (testCase.kind === 'layers') {
        for (const [key, layerName] of [['centerHash', 'overlay'], ['outsideHash', 'underlying source']]) {
          const layerChanges = observed.samples.filter((s, i, arr) => i && s[key] !== arr[i - 1][key])
          assert.ok(layerChanges.length >= 4 && layerChanges.some(s => s.at > elapsed / 2),
            `${layerName} independently presents throughout the two-layer drag`)
        }
      }
      if (resumedAt != null) {
        // Use the recording's actual clock rather than wall-clock sleeps when
        // deciding whether changes occurred after the quiet held segment.
        assert.ok(changes.filter(s => s.at > resumedAt - observed.start).length >= 3,
          'resumed scrubbing keeps presenting after the quiet interval')
      }

      await page.mouse.move(viewport.x + testCase.release * PPS, y); await page.mouse.up()
      try { await page.waitForFunction(({ target, reference, expectedPixels, width, height }) => {
        const t = window.compoundTest, s = t.timeline.getState(), f = t.getPreviewFrameSnapshot()
        if (!f?.canvas || Math.abs(f.time - target) > 1e-6 || Math.abs(s.playheadPosition - target) > 1e-6
          || s.playheadSeekIntent?.type !== 'frame-step') return false
        if (!reference.every(layer => {
          const asset = t.getAsset(layer.assetId), frame = Math.floor(layer.sourceTime * asset.fps + 1e-6)
          return [...window.scrubObservedVideos].some(video => {
            const latest = window.scrubLatestPresentation.get(video)
            return video.currentSrc === asset.url && video.readyState >= 2 && !video.seeking
              && Math.floor(video.currentTime * asset.fps + 1e-7) === frame
              && latest?.source === asset.url && Math.round(latest.presented * asset.fps) === frame
          })
        })) return false
        const c = document.createElement('canvas'); c.width = width; c.height = height
        const x = c.getContext('2d'); x.drawImage(f.canvas, 0, 0, width, height)
        const pixels = x.getImageData(0, 0, width, height).data
        let difference = 0
        for (let i = 0; i < pixels.length; i++) if (i % 4 !== 3) difference += Math.abs(pixels[i] - expectedPixels[i])
        return difference / (width * height * 3) < 5
      }, { target: testCase.release, reference: testCase.reference, expectedPixels, width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT },
      { polling: 50, timeout: 15000 }) } catch (error) {
        console.error('Exact release diagnostic', await page.evaluate(({ expectedPixels, width, height }) => {
          const t = window.compoundTest, s = t.timeline.getState(), f = t.getPreviewFrameSnapshot()
          const c = document.createElement('canvas'); c.width = width; c.height = height
          const x = c.getContext('2d'); if (f?.canvas) x.drawImage(f.canvas, 0, 0, width, height)
          const pixels = x.getImageData(0, 0, width, height).data
          let difference = 0
          for (let i = 0; i < pixels.length; i++) if (i % 4 !== 3) difference += Math.abs(pixels[i] - expectedPixels[i])
          return { time: s.playheadPosition, intent: s.playheadSeekIntent,
            frame: f && { time: f.time, serial: f.serial }, meanPixelDifference: difference / (width * height * 3),
            presented: window.scrubPresentedFrames.slice(-12), videos: [...window.scrubObservedVideos].map(video => ({
              source: video.currentSrc, time: video.currentTime, ready: video.readyState, seeking: video.seeking, error: video.error?.message,
              latestPresentation: window.scrubLatestPresentation.get(video),
            })) }
        }, { expectedPixels, width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT }))
        throw error
      }
      const after = await page.evaluate(() => {
        const t = window.compoundTest, s = t.timeline.getState()
        return { doc: s.getProjectData(), history: s.history, historyIndex: s.historyIndex, selected: s.selectedClipIds, dirty: t.isProjectDirty() }
      })
      assert.deepEqual({ doc: after.doc, history: after.history, historyIndex: after.historyIndex, selected: after.selected }, immutable)
      assert.equal(after.dirty, false)
      console.log(`PASS ${++passed}: ${testCase.name}; live intermediate pictures, exact decoded release and document neutrality`)
    }
    assert.deepEqual(errors, [])
    console.log(`PASS ${passed}/${cases.length} scrub presentation groups (${native ? 'installed Electron, visible isolated host' : 'Chrome'}; not an FPS benchmark)`)
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
