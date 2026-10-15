// Isolated production Timeline + Canvas playback. No production main/preload,
// open user project, capture bridge, or synthetic seek is used while measuring.
// The fixture has no PreviewPanel clock: an elapsed-time RAF publishes normal
// transport positions while the actual renderer owns decode/play/presentation.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const FPS = 24, base = process.env.VELORN_TEST_URL || 'http://127.0.0.1:5192'
const native = process.env.VELORN_TEST_ELECTRON === '1'
const baseline = process.env.VELORN_TRANSITION_BASELINE === '1'
const actual = process.env.VELORN_TRANSITION_ACTUAL === '1'
function read24FpsMedia(input) {
  const source = path.resolve(input)
  const probe = spawnSync(process.env.FFMPEG_PATH || require('ffmpeg-static'), ['-hide_banner', '-i', source],
    { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })
  const stream = String(probe.stderr || '').split('\n').find(line => line.includes('Video:')) || ''
  const fps = Number(stream.match(/(?:,|\s)([\d.]+) fps(?:,|\s|$)/)?.[1])
  assert.equal(fps, FPS, `This exact-frame fixture accepts verified24fps inputs only: ${source}; ${stream}`)
  return { base64: fs.readFileSync(source).toString('base64'), fps }
}
function media(alternate = false) {
  const input = process.env[alternate ? 'VELORN_TRANSITION_SOURCE_B' : 'VELORN_TRANSITION_SOURCE']
  if (input) return read24FpsMedia(input)
  const result = spawnSync(process.env.FFMPEG_PATH || require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=${FPS}:duration=8`, '-an',
    '-vf', alternate ? 'hflip,hue=h=60' : 'null', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
    '-g', '250', '-keyint_min', '250', '-sc_threshold', '0', '-bf', '2', '-pix_fmt', 'yuv420p',
    '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { timeout: 60000, maxBuffer: 32 * 1024 * 1024 })
  assert.equal(result.status, 0, String(result.stderr))
  return { base64: result.stdout.toString('base64'), fps: FPS }
}
function flattenedMedia() {
  if (process.env.VELORN_TRANSITION_RENDER) return read24FpsMedia(process.env.VELORN_TRANSITION_RENDER)
  const input = key => process.env[key] ? ['-i', path.resolve(process.env[key])]
    : ['-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=${FPS}:duration=8`]
  const fit = 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1'
  const blue = process.env.VELORN_TRANSITION_SOURCE_B ? '' : 'hflip,hue=h=60,'
  const filter = `[0:v]${fit},trim=start=1:end=5.375,setpts=PTS-STARTPTS,fps=24,settb=AVTB[a];`
    + `[1:v]${blue}${fit},trim=start=0.625:end=5,setpts=PTS-STARTPTS,fps=24,settb=AVTB[b];`
    + '[a][b]xfade=transition=fade:duration=0.75:offset=3.625,format=yuv420p[out]'
  const result = spawnSync(process.env.FFMPEG_PATH || require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error',
    ...input('VELORN_TRANSITION_SOURCE'), ...input('VELORN_TRANSITION_SOURCE_B'), '-filter_complex', filter,
    '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-g', '6', '-bf', '0',
    '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { timeout: 60000, maxBuffer: 32 * 1024 * 1024 })
  assert.equal(result.status, 0, String(result.stderr))
  return { base64: result.stdout.toString('base64'), fps: FPS }
}
async function main() {
  const sources = { red: media(), blue: media(true) }
  if (!baseline && (actual || process.env.VELORN_TRANSITION_COMPARE_GENERATED === '1')) sources.flat = flattenedMedia()
  const browser = native ? await _electron.launch({ executablePath: require('electron'),
    args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')], env: { ...process.env, VELORN_TEST_URL: base } })
    : await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true })
  try {
    const page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    if (native) await browser.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
    const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error('Renderer:', e.message) })
    await page.routeWebSocket(url => url.hostname === new URL(base).hostname && url.port === new URL(base).port, socket => socket.close())
    await page.addInitScript(() => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
      const ids = new WeakMap(); let nextId = 0
      window.transitionSeeks = []; window.transitionFrames = []; window.transitionAllFrames = []
      const id = video => { if (!ids.has(video)) ids.set(video, ++nextId); return ids.get(video) }
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { ...descriptor,
        set(value) {
          if (window.transitionRecording) {
            const s = window.compoundTest?.timeline.getState()
            window.transitionSeeks.push({ at: performance.now(), id: id(this), source: this.currentSrc || this.src,
              from: descriptor.get.call(this), to: value, timeline: s?.playheadPosition,
              playing: s?.isPlaying, ready: this.readyState, seeking: this.seeking,
              stack: window.transitionSeeks.length < 24 ? new Error().stack?.split('\n').slice(2, 6).join('\n') : undefined })
          }
          return descriptor.set.call(this, value)
        } })
      const request = HTMLVideoElement.prototype.requestVideoFrameCallback
      const observed = new WeakSet()
      const observe = video => {
        if (observed.has(video)) return
        observed.add(video)
        let callback = null
        const arm = () => {
          if (callback != null || video.readyState < 1 || video.dataset.reference === 'true') return
          callback = request.call(video, (now, metadata) => {
            callback = null
            const entry = { at: performance.now(), id: id(video),
              source: video.currentSrc, presented: metadata.mediaTime, time: video.currentTime,
              timeline: window.compoundTest?.timeline.getState().playheadPosition }
            if (window.transitionRecording) window.transitionFrames.push(entry)
            window.transitionAllFrames.push(entry)
            if (window.transitionAllFrames.length > 1000) window.transitionAllFrames.shift()
            arm()
          })
        }
        video.addEventListener('loadedmetadata', arm)
        video.addEventListener('emptied', () => { if (callback != null) video.cancelVideoFrameCallback(callback); callback = null })
        arm()
      }
      const create = document.createElement.bind(document)
      document.createElement = (...args) => { const element = create(...args); if (String(args[0]).toLowerCase() === 'video') observe(element); return element }
      HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) { observe(this); return request.call(this, callback) }
    })
    await page.goto(base + '/tests/fixtures/compound-clips.html' + (native ? '?nativeWaveformStub=1' : ''))
    await page.waitForFunction(() => Boolean(window.compoundTest))
    await page.evaluate(sources => window.compoundTest.initializeMedia(sources), sources)
    const results = []
    const cases = [{ duration: 0, name: 'ordinary continuous clip' }, { duration: 0.75, name: 'dissolve 0.75s' },
      { duration: 2, name: 'dissolve 2s' }]
    if (!baseline && process.env.VELORN_TRANSITION_COMPARE_GENERATED === '1') cases.push(
      { duration: 0.75, flat: true, external: Boolean(process.env.VELORN_TRANSITION_RENDER), name: 'flattened single-video comparator' })
    if (actual) {
      assert.ok(process.env.VELORN_TRANSITION_SOURCE && process.env.VELORN_TRANSITION_SOURCE_B && process.env.VELORN_TRANSITION_RENDER,
        'actual study requires both read-only originals and the matching2s flattened export')
      cases.splice(0, cases.length, { duration: 0.75, actual: true, name: 'actual 8.5s live dissolve' },
        { duration: 0.75, flat: true, external: true, name: 'actual flattened 7.5–9.5s comparator' })
    }
    if (process.env.VELORN_TRANSITION_CASE) cases.splice(0, cases.length, ...cases.filter(c => c.name === process.env.VELORN_TRANSITION_CASE))
    assert.ok(cases.length, 'requested case exists')
    for (const testCase of cases) {
      const { duration } = testCase
      const timing = await page.evaluate(({ duration, type, flat, external, actual }) => {
        const t = window.compoundTest, a = t.getAsset('red'), b = t.getAsset('blue')
        const first = t.makeClip('outgoing', { trackId: 'video', startTime: actual ? 6.5 : 0,
          duration: actual ? 2 : duration ? 4 : Math.min(6, a.duration - 1),
          trimStart: actual ? 0 : 1, trimEnd: actual ? 2 : duration ? 5 : Math.min(7, a.duration), sourceDuration: a.duration })
        const second = t.makeClip('incoming', { assetId: 'blue', url: b.url, trackId: 'video', startTime: actual ? 8.5 : 4,
          duration: actual ? 4.5 : 4, trimStart: actual ? 0.5 : 1, trimEnd: 5, sourceDuration: b.duration })
        const flatAsset = flat ? t.getAsset('flat') : null
        const playbackStart = external ? 0 : actual ? 7.5 : 2
        const playbackEnd = external ? Math.min(4, flatAsset.duration) : actual ? 9.5 : 6
        const cutTime = external ? playbackEnd / 2 : actual ? 8.5 : 4
        const clips = flat ? [t.makeClip('flattened', { trackId: 'video', assetId: 'flat', url: flatAsset.url,
          startTime: 0, duration: flatAsset.duration, trimStart: 0, trimEnd: flatAsset.duration, sourceDuration: flatAsset.duration })]
          : duration ? [first, second] : [first]
        t.reset({ clips, tracks: [t.track('video')], selectedClipIds: [],
          playheadPosition: playbackStart, playheadSeekIntent: null, inPoint: null, outPoint: null, duration: actual ? 14 : 10, zoom: 250,
          transitions: duration && !flat ? [{ id: 'dissolve', kind: 'between', type: type || 'dissolve', clipAId: 'outgoing', clipBId: 'incoming',
            duration, editPoint: cutTime, originalClipAEnd: cutTime, originalClipBStart: cutTime, settings: { alignment: 'center' } }] : [] })
        const asset = flat ? flatAsset : a
        return { playbackStart, playbackEnd, cutTime, incomingTrimStart: second.trimStart,
          mediaDimensions: `${asset.settings.width}x${asset.settings.height}`, compositorDimensions: '960x540' }
      }, testCase)
      await page.waitForFunction(start => { const f = window.compoundTest.getPreviewFrameSnapshot(); return f?.canvas && Math.abs(f.time - start) < 1e-6 }, timing.playbackStart)
      const observed = await page.evaluate(async ({ playbackStart, playbackEnd }) => {
        const t = window.compoundTest, canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 54
        const ctx = canvas.getContext('2d', { willReadFrequently: true }), samples = []
        const before = JSON.stringify(t.timeline.getState().getProjectData())
        window.transitionSeeks = []; window.transitionFrames = []; window.transitionRecording = true
        const start = performance.now()
        t.timeline.setState({ isPlaying: true, playheadSeekIntent: null })
        const sample = () => {
          const f = t.getPreviewFrameSnapshot(); let hash = 2166136261
          if (f?.canvas) { ctx.drawImage(f.canvas, 0, 0, 96, 54)
            for (const v of ctx.getImageData(0, 0, 96, 54).data) hash = Math.imul(hash ^ v, 16777619) >>> 0 }
          samples.push({ at: performance.now() - start, time: t.timeline.getState().playheadPosition,
            frameTime: f?.time, serial: f?.serial, hash })
        }
        const interval = setInterval(sample, 30); sample()
        await new Promise(resolve => {
          const tick = now => {
            const elapsed = (now - start) / 1000
            if (elapsed >= playbackEnd - playbackStart) { resolve(); return }
            t.timeline.getState().setPlayheadPosition(playbackStart + elapsed, { snap: false, source: 'transport' })
            requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        })
        sample(); clearInterval(interval); window.transitionRecording = false
        t.timeline.setState({ isPlaying: false })
        return { samples, seeks: window.transitionSeeks, frames: window.transitionFrames,
          blueUrl: t.getAsset('blue').url, redUrl: t.getAsset('red').url, flatUrl: t.getAsset('flat')?.url, before,
          after: JSON.stringify(t.timeline.getState().getProjectData()), dirty: t.isProjectDirty() }
      }, timing)
      const centerDuration = duration || 0.75, from = timing.cutTime - centerDuration / 2, to = timing.cutTime + centerDuration / 2
      const inside = observed.samples.filter(s => s.time >= from && s.time < to)
      const changes = inside.filter((s, i) => i && s.hash !== inside[i - 1].hash)
      const commits = inside.filter((s, i) => i && s.serial !== inside[i - 1].serial)
      const seeks = observed.seeks.filter(s => s.timeline >= from && s.timeline < to)
      const incomingParks = seeks.filter(s => s.source === observed.blueUrl && s.timeline < timing.cutTime
        && Math.abs(s.to - timing.incomingTrimStart) < 1e-5)
      const report = { mode: baseline ? 'baseline' : 'verification', runtime: native ? 'Electron-visible' : 'Chrome',
        case: testCase.name, mediaDimensions: timing.mediaDimensions, compositorDimensions: timing.compositorDimensions, sampleCount: inside.length,
        pictureChanges: changes.length, commits: commits.length, seekAssignments: seeks.length,
        incomingPreCutParkSeeks: incomingParks.length, maximumFrameLag: Math.max(...inside.map(s => Math.max(0, s.time - s.frameTime))),
        firstTransitionSeeks: seeks.slice(0, 8).map(s => ({ ...s, source: s.source === observed.blueUrl ? 'incoming' : 'outgoing' })) }
      console.log(JSON.stringify(report)); results.push(report)
      assert.equal(observed.after, observed.before, 'playback does not alter document')
      assert.equal(observed.dirty, false)
      if (!baseline && duration && !testCase.flat) {
        assert.ok(changes.length >= (duration > 1 ? 8 : 3), 'transition must present advancing pictures')
        assert.equal(incomingParks.length, 0, 'preloader must not park visible incoming handle footage at nominal source-in')
      }
      if (!baseline && (!duration || testCase.flat)) {
        const source = testCase.flat ? observed.flatUrl : observed.redUrl
        const frames = new Set(observed.frames.filter(f => f.source === source && f.timeline >= from && f.timeline < to)
          .map(f => Math.round(f.presented * FPS)))
        assert.ok(changes.length >= 2 && frames.size >= 2, 'ordinary/flattened control must show advancing decoded pictures')
      }
      if (!baseline && duration === 2 && !testCase.flat) {
        const frames = observed.frames.filter(f => f.timeline >= from && f.timeline < to)
        assert.ok(frames.some(f => f.source === observed.blueUrl && f.timeline < 4 && f.presented < 0.8),
          'incoming transition uses footage before nominal source-in')
        assert.ok(frames.some(f => f.source === observed.redUrl && f.timeline > 4 && f.presented > 5.1),
          'outgoing transition uses footage after nominal source-out')
        for (const [source, beforeCut, label] of [[observed.blueUrl, true, 'incoming pre-cut'],
          [observed.redUrl, false, 'outgoing post-cut']]) {
          const indices = [...new Set(frames.filter(f => f.source === source
            && (beforeCut ? f.timeline < timing.cutTime : f.timeline > timing.cutTime))
            .map(f => Math.round(f.presented * FPS)))]
          assert.ok(indices.length >= 2 && Math.max(...indices) > Math.min(...indices),
            `${label} must present multiple advancing source frames, not only changing blend opacity`)
          console.log(`CHECK moving source: ${label}, ${indices.length} distinct frames, ${Math.min(...indices)}–${Math.max(...indices)}`)
        }
      }
      if (!baseline) {
        // Independent exact-frame decoders, never the capture bridge. The
        // existing export seek path has different sample tolerances, so its
        // high-detail control discrepancy is diagnostic, not this oracle.
        const expected = await page.evaluate(async ({ time, flat, duration }) => {
          const t = window.compoundTest, s = t.timeline.getState(), decoded = []
          const full = document.createElement('canvas'); full.width = 960; full.height = 540
          const ctx = full.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 960, 540)
          const clips = flat || !duration ? [s.clips[0]] : s.clips
          for (let i = 0; i < clips.length; i++) {
            const clip = clips[i], asset = t.getAsset(clip.assetId), sourceTime = clip.trimStart + time - clip.startTime
            const targetFrame = Math.floor(sourceTime * asset.fps + 1e-7)
            const video = document.createElement('video'); video.dataset.reference = 'true'; video.muted = true
            await new Promise((resolve, reject) => {
              video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('Reference metadata failed'))
              video.src = asset.url; video.load()
            })
            const pts = await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('Exact reference frame timed out')), 15000)
              const arm = () => video.requestVideoFrameCallback((now, metadata) => {
                if (Math.round(metadata.mediaTime * asset.fps) === targetFrame) { clearTimeout(timeout); resolve(metadata.mediaTime) }
                else arm()
              })
              arm(); video.currentTime = (targetFrame + 0.25) / asset.fps
            })
            decoded.push({ assetId: asset.id, sourceTime, targetFrame, presentedPTS: pts })
            const scale = Math.min(960 / video.videoWidth, 540 / video.videoHeight)
            const width = video.videoWidth * scale, height = video.videoHeight * scale
            ctx.globalAlpha = i === 1 ? 0.5 : 1
            ctx.drawImage(video, (960 - width) / 2, (540 - height) / 2, width, height)
            video.removeAttribute('src'); video.load()
          }
          const small = document.createElement('canvas'); small.width = 96; small.height = 54
          const x = small.getContext('2d'); x.drawImage(full, 0, 0, 96, 54)
          return { pixels: [...x.getImageData(0, 0, 96, 54).data], decoded }
        }, { time: timing.cutTime, flat: testCase.flat, duration })
        assert.equal(expected.error, undefined, expected.error)
        assert.ok(expected.pixels?.length > 0, 'independent exact-frame reference exists')
        await page.evaluate(time => window.compoundTest.timeline.getState().setPlayheadPosition(time,
          { snap: true, intent: 'frame-step' }), timing.cutTime)
        try { await page.waitForFunction(({ time, pixels }) => {
          const f = window.compoundTest.getPreviewFrameSnapshot()
          if (!f?.canvas || Math.abs(f.time - time) > 1e-6) return false
          const c = document.createElement('canvas'); c.width = 96; c.height = 54
          const x = c.getContext('2d'); x.drawImage(f.canvas, 0, 0, 96, 54)
          const actual = x.getImageData(0, 0, 96, 54).data
          let difference = 0
          for (let i = 0; i < actual.length; i++) if (i % 4 !== 3) difference += Math.abs(actual[i] - pixels[i])
          return difference / (96 * 54 * 3) < 5
        }, { time: timing.cutTime, pixels: expected.pixels }, { polling: 50, timeout: 15000 }) } catch (error) {
          console.error('Paused pixel diagnostic', await page.evaluate(pixels => {
            const f = window.compoundTest.getPreviewFrameSnapshot(), s = window.compoundTest.timeline.getState()
            const c = document.createElement('canvas'); c.width = 96; c.height = 54
            const ctx = c.getContext('2d'); if (f?.canvas) ctx.drawImage(f.canvas, 0, 0, 96, 54)
            const actual = ctx.getImageData(0, 0, 96, 54).data
            let difference = 0
            for (let i = 0; i < actual.length; i++) if (i % 4 !== 3) difference += Math.abs(actual[i] - pixels[i])
            return { time: s.playheadPosition, intent: s.playheadSeekIntent, frame: f && { time: f.time, serial: f.serial },
              meanPixelDifference: difference / (96 * 54 * 3) }
          }, expected.pixels))
          throw error
        }
        console.log(`PASS: ${testCase.name}; running pictures and exact paused source-frame pixels ${JSON.stringify(expected.decoded)}`)
        if (!duration && process.env.VELORN_TRANSITION_EXPORT_DIAGNOSTIC === '1') {
          const diagnostic = await page.evaluate(async ({ time, expected }) => {
            const start = performance.now(), result = await window.compoundTest.exportInMemory(time, { width: 960, height: 540 })
            if (result.error || !result.frames?.[0]) return { error: result.error || 'No export frame' }
            const full = document.createElement('canvas'); full.width = 960; full.height = 540
            full.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(result.frames[0]), 960, 540), 0, 0)
            const c = document.createElement('canvas'); c.width = 96; c.height = 54
            const ctx = c.getContext('2d'); ctx.drawImage(full, 0, 0, 96, 54)
            const pixels = ctx.getImageData(0, 0, 96, 54).data
            let difference = 0
            for (let i = 0; i < pixels.length; i++) if (i % 4 !== 3) difference += Math.abs(pixels[i] - expected[i])
            return { meanPixelDifference: difference / (96 * 54 * 3), observedExportPTS: window.transitionAllFrames.filter(f => f.at >= start) }
          }, { time: timing.cutTime, expected: expected.pixels })
          console.log('Export-control diagnostic only (not a parity assertion): ' + JSON.stringify(diagnostic))
        }
      }
    }
    assert.deepEqual(errors, [])
    console.log(`${baseline ? 'BASELINE' : 'PASS'} ${results.length} transition playback cases; observed diagnostics, not an FPS benchmark`)
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
