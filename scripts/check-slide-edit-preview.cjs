// Actual Timeline gestures and two independent decoded source viewers. All
// media is generated in memory; no production main, user project or disk cache.
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const FPS = 10, WIDTH = 96, HEIGHT = 54
const near = (actual, expected, label, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`)
const rawSourceAt = (clip, timelineTime) => {
  const rate = clip.sourceTimeScale * clip.speed
  return clip.reverse ? clip.trimEnd - (timelineTime - clip.startTime) * rate
    : clip.trimStart + (timelineTime - clip.startTime) * rate
}
const guardedSourceAt = (clip, time) => Math.max(clip.trimStart, Math.min(rawSourceAt(clip, time), clip.trimEnd - 1e-6))
function makeMedia(alternate = false, fps = FPS, duration = 8) {
  const frames = fps * duration, input = Buffer.alloc(WIDTH * HEIGHT * 3 * frames)
  for (let frame = 0; frame < frames; frame++) {
    const n = alternate ? frames - 1 - frame : frame
    const rgb = [20 + n % 8 * 28, 20 + Math.floor(n / 8) % 8 * 28, 20 + Math.floor(n / 64) * 80]
    for (let index = frame * WIDTH * HEIGHT * 3; index < (frame + 1) * WIDTH * HEIGHT * 3; index += 3) {
      input[index] = rgb[0]; input[index + 1] = rgb[1]; input[index + 2] = rgb[2]
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
  assert.equal(decoded.stdout.length, WIDTH * HEIGHT * 3 * frames)
  return { base64: encoded.stdout.toString('base64'), fps, frames,
    pixels: Array.from({ length: frames }, (_, index) => [...decoded.stdout.subarray(index * WIDTH * HEIGHT * 3, index * WIDTH * HEIGHT * 3 + 3)]) }
}
async function main() {
  const media = { sourceA: makeMedia(), sourceB: makeMedia(true), cached: makeMedia(true, 20, 7) }
  const native = process.env.VELORN_TEST_ELECTRON === '1'
  const browser = native
    ? await _electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')] })
    : await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true })
  try {
    const page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.setDefaultTimeout(15000)
    await page.routeWebSocket(/ws:\/\/(?:127\.0\.0\.1|localhost):5184\//, socket => socket.close())
    const errors = []
    page.on('pageerror', error => { errors.push(error.message); console.error('Renderer:', error.message) })
    page.on('crash', () => console.error('Isolated renderer crashed'))
    await page.goto((process.env.VELORN_TEST_URL || 'http://127.0.0.1:5184') + '/tests/fixtures/multi-clip-inspector.html?timeline=1')
    await page.waitForFunction(() => Boolean(window.multiClipInspectorTest?.project)
      && typeof window.multiClipInspectorTest.timeline.getState().beginSlideEdit === 'function', null, { polling: 100 })
    const urls = await page.evaluate(async media => {
      const t = window.multiClipInspectorTest
      t.project.setState({ currentProject: { name: 'Synthetic Slide preview', settings: { fps: 10, width: 960, height: 540 }, timelines: [] },
        currentProjectHandle: null, currentTimelineId: null })
      const urls = {}
      for (const [id, value] of Object.entries(media)) {
        urls[id] = URL.createObjectURL(new Blob([Uint8Array.from(atob(value.base64), character => character.charCodeAt(0))], { type: 'video/mp4' }))
        const video = document.createElement('video'); video.muted = true
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Synthetic media metadata timed out')), 8000)
          video.onloadedmetadata = () => { clearTimeout(timer); Math.abs(video.duration - value.frames / value.fps) < 0.01 ? resolve() : reject(new Error(`Unexpected duration ${video.duration}`)) }
          video.onerror = () => { clearTimeout(timer); reject(new Error('Synthetic video metadata failed')) }
          video.src = urls[id]; video.load()
        })
        video.removeAttribute('src'); video.load()
      }
      const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 54
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ae2377'; ctx.fillRect(0, 0, 96, 54)
      urls.image = canvas.toDataURL('image/png')
      urls.broken = URL.createObjectURL(new Blob(['not a video'], { type: 'video/mp4' }))
      return urls
    }, media)
    const preview = page.getByTestId('slide-edit-preview')
    const canvases = { outgoing: page.getByTestId('slide-edit-outgoing-canvas'), incoming: page.getByTestId('slide-edit-incoming-canvas') }

    const state = () => page.evaluate(() => {
      const t = window.multiClipInspectorTest, s = t.timeline.getState()
      return JSON.parse(JSON.stringify({ clips: s.clips, tracks: s.tracks, transitions: s.transitions,
        selected: s.selectedClipIds, duration: s.duration, markers: s.markers, inPoint: s.inPoint, outPoint: s.outPoint,
        history: s.history.length, historyIndex: s.historyIndex, playhead: s.playheadPosition,
        zoom: s.zoom, dirty: t.isProjectDirty(), playing: s.isPlaying }))
    })
    const byId = (s, id) => s.clips.find(c => c.id === id)
    const detail = label => { if (native) console.log('CHECK ' + label) }
    let testZoom = 250, gesture
    const seed = async ({ a = {}, middle = {}, b = {}, extras = [], selected = ['middle'], audio = false, zoom = 250 } = {}) => {
      testZoom = zoom
      await page.mouse.up(); await page.keyboard.press('Escape')
      await page.evaluate(({ a, middle, b, extras, selected, audio, urls, zoom }) => {
        const t = window.multiClipInspectorTest; t.reset()
        t.assets.setState({ assets: [
          { id: 'sourceA', type: 'video', name: 'Previous encoded frames', url: urls.sourceA, duration: 8, fps: 10, hasAudio: false, settings: { fps: 10, width: 96, height: 54 } },
          { id: 'sourceB', type: 'video', name: 'Next encoded frames', url: urls.sourceB, duration: 8, fps: 10, hasAudio: false, settings: { fps: 10, width: 96, height: 54 } },
          { id: 'image', type: 'image', name: 'Synthetic still', url: urls.image }],
          previewMode: 'timeline', currentPreview: null, isPlaying: false, volume: 0 })
        const base = { type: audio ? 'audio' : 'video', trackId: audio ? 'audio' : 'visual-a',
          sourceDuration: 8, sourceFps: 10, timelineFps: 10, sourceTimeScale: 1, speed: 1, reverse: false,
          frameSampling: 'frame', effects: [], keyframes: {},
          transform: { positionX: 0, positionY: 0, scaleX: 100, scaleY: 100, rotation: 0, opacity: 100 } }
        t.timeline.setState(s => ({ clips: [
          { ...base, id: 'previous', name: 'Previous A', assetId: audio ? null : 'sourceA', url: audio ? null : urls.sourceA,
            startTime: 2, duration: 3, trimStart: 1, trimEnd: 4, ...a },
          { ...base, id: 'middle', name: 'Middle unchanged source', assetId: audio ? null : 'sourceA', url: audio ? null : urls.sourceA,
            startTime: 5, duration: 2, trimStart: 2, trimEnd: 4, ...middle },
          { ...base, id: 'next', name: 'Next B', assetId: audio ? null : 'sourceB', url: audio ? null : urls.sourceB,
            startTime: 7, duration: 3, trimStart: 2, trimEnd: 5, ...b },
          { id: 'unrelated', name: 'Unrelated overlay', type: 'shape', trackId: 'visual-b',
            startTime: 3, duration: 12, trimStart: 0, trimEnd: 12 },
          { id: 'later', name: 'Later untouched', type: 'shape', trackId: audio ? 'audio' : 'visual-a',
            startTime: 12, duration: 2, trimStart: 0, trimEnd: 2 }, ...extras ],
          selectedClipIds: selected, timelineFps: 10, zoom, viewportNavigation: null, playheadPosition: 1.3,
          timelineSessionId: (s.timelineSessionId || 0) + 1, duration: 30, snappingEnabled: false, rippleEditMode: false,
          history: [], historyIndex: -1, isPlaying: false, transitions: [],
          markers: [{ id: 'marker', name: 'Untouched', time: 11 }], inPoint: 1, outPoint: 12 }))
        t.markProjectClean()
      }, { a, middle, b, extras, selected, audio, urls, zoom })
      await page.getByTestId('timeline-tool-slide').click()
      await preview.waitFor({ state: 'hidden' })
    }
    const pressBody = async () => {
      const body = page.locator('[data-slide-edit-target="middle"]').first()
      await body.scrollIntoViewIfNeeded()
      const box = await body.boundingBox(); assert.ok(box, 'real Slide body target exists')
      gesture = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.65 }
      await page.mouse.move(gesture.x, gesture.y); await page.mouse.down()
    }
    const start = async () => {
      await pressBody(); await preview.waitFor()
      assert.equal(await preview.evaluate(el => getComputedStyle(el).pointerEvents), 'none')
    }
    const move = delta => page.mouse.move(gesture.x + delta * (testZoom / 5), gesture.y)
    const release = async () => { await page.mouse.up(); await preview.waitFor({ state: 'hidden' }) }
    const waitDelta = async delta => { try { await page.waitForFunction(delta => {
      const clips = window.multiClipInspectorTest.timeline.getState().clips
      const a = clips.find(c => c.id === 'previous'), m = clips.find(c => c.id === 'middle'), b = clips.find(c => c.id === 'next')
      return Math.abs(m.startTime - 5 - delta) < 1e-6 && Math.abs(a.duration - 3 - delta) < 1e-6
        && Math.abs(b.startTime - 7 - delta) < 1e-6 && Math.abs(b.duration - 3 + delta) < 1e-6
    }, delta, { polling: 100 }) } catch (error) {
      console.error('Slide delta diagnostic:', JSON.stringify({ delta, state: await state(),
        feedback: await preview.count() ? await preview.innerText() : null,
        refusal: await page.getByTestId('slide-edit-refusal').count() ? await page.getByTestId('slide-edit-refusal').innerText() : null }))
      throw error
    } }
    const readyFrame = async (side, sourceTime, reference, mode = 'original', frameTime = sourceTime) => {
      try {
        await page.waitForFunction(({ side, sourceTime, frameTime }) => {
          const el = document.querySelector(`[data-testid="slide-edit-${side}-canvas"]`)
          return el?.dataset.state === 'ready' && Math.abs(Number(el.dataset.sourceTime) - sourceTime) < 1e-4 && Math.abs(Number(el.dataset.frameTime) - frameTime) < 1e-4
        }, { side, sourceTime, frameTime }, { polling: 100 })
      } catch (error) {
        console.error('Frame readiness diagnostic:', JSON.stringify({ side, sourceTime, frameTime, state: await state(),
          preview: await preview.count() ? await preview.evaluate(el => ({ text: el.innerText,
            canvases: [...el.querySelectorAll('canvas')].map(c => ({ ...c.dataset })),
            videos: [...el.querySelectorAll('video')].map(v => ({ time: v.currentTime, ready: v.readyState, seeking: v.seeking })) })) : null }))
        throw error
      }
      const got = await canvases[side].evaluate(el => ({ ...el.dataset,
        pixel: [...el.getContext('2d').getImageData(Math.floor(el.width / 2), Math.floor(el.height / 2), 1, 1).data] }))
      assert.equal(got.sourceMode, mode)
      const frame = Math.max(0, Math.min(reference.frames - 1, Math.floor((frameTime + 1e-8) * reference.fps)))
      reference.pixels[frame].forEach((value, index) => assert.ok(Math.abs(value - got.pixel[index]) <= 5,
        `${side} decoded frame ${frame}: expected ${reference.pixels[frame]}, actual ${got.pixel}`))
      if (got.presentedTime !== '') assert.equal(Math.floor((Number(got.presentedTime) + 1e-6) * reference.fps), frame, `${side} presented frame`)
      return got
    }
    const pair = async (outgoing, incoming, refs = [media.sourceA, media.sourceB], modes = ['original', 'original']) => {
      const a = await readyFrame('outgoing', outgoing, refs[0], modes[0])
      const b = await readyFrame('incoming', incoming, refs[1], modes[1])
      return [a, b]
    }

    const framesForCurrent = async () => {
      const current = await state(), a = byId(current, 'previous'), b = byId(current, 'next')
      return pair(guardedSourceAt(a, a.startTime + a.duration - 1 / FPS), guardedSourceAt(b, b.startTime))
    }
    const unchanged = (after, before, delta) => {
      const a = byId(after, 'previous'), m = byId(after, 'middle'), b = byId(after, 'next')
      near(a.startTime, 2, 'fixed outside start'); near(b.startTime + b.duration, 10, 'fixed outside end')
      near(a.startTime + a.duration, m.startTime, 'left cut touching'); near(m.startTime + m.duration, b.startTime, 'right cut touching')
      near(m.startTime, 5 + delta, 'middle position')
      assert.deepEqual({ ...m, startTime: 5 }, byId(before, 'middle'), 'middle source, duration and all attributes untouched')
      for (const key of ['tracks', 'transitions', 'markers', 'inPoint', 'outPoint', 'playhead', 'duration']) assert.deepEqual(after[key], before[key], key)
      for (const id of ['unrelated', 'later']) assert.deepEqual(byId(after, id), byId(before, id), id)
    }
    const undo = () => page.evaluate(() => window.multiClipInspectorTest.timeline.getState().undo())

    await seed(); let before = await state(); await start(); await pair(3.9, 2)
    assert.deepEqual(await state(), before, 'begin and private source viewers are read-only')
    const privateVideos = await preview.locator('video').evaluateAll(v => v.map(x => ({ muted: x.muted, volume: x.volume, paused: x.paused })))
    assert.equal(privateVideos.length, 2)
    privateVideos.forEach(v => { assert.equal(v.muted, true); assert.equal(v.volume, 0); assert.equal(v.paused, true) })
    assert.match(await page.getByTestId('slide-edit-middle').innerText(), /Middle unchanged source/)
    await page.keyboard.press('z'); assert.deepEqual(await state(), before, 'Zoom to Selection is blocked during Slide')
    await release()
    await page.keyboard.press('y')
    await page.keyboard.press('u')
    assert.equal(await page.getByTestId('timeline-tool-slide').getAttribute('aria-pressed'), 'true')
    console.log('PASS 1: actual U tool, independent muted decoded viewers, middle readout and idle history/dirty/playhead neutrality')

    for (const delta of [0.4, -0.6]) {
      detail('2 direction ' + delta)
      await seed(); before = await state(); await start(); await move(delta); await waitDelta(delta); await framesForCurrent()
      const after = await state(); unchanged(after, before, delta); assert.equal(after.history, 1)
      assert.match(await page.getByTestId('slide-edit-delta').innerText(), delta > 0 ? /\+4\s*f/i : /[−-]6\s*f/i)
      if (!native && delta > 0 && process.env.VELORN_TEST_SCREENSHOT) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT.replace(/\.png$/, '-wide.png') })
      await release(); await undo(); assert.deepEqual((await state()).clips, before.clips)
    }
    for (const [requested, accepted] of [[0.05, 0.1], [-0.05, 0]]) {
      detail('2 half-frame ' + requested)
      await seed({ zoom: 500 }); before = await state(); await start(); await move(requested); await waitDelta(accepted)
      await framesForCurrent(); unchanged(await state(), before, accepted)
      assert.equal((await state()).history, accepted === 0 ? 0 : 1); await release()
    }
    console.log('PASS 2: both directions and half-frame rounding preserve the outer span and exact decoded neighbor frames')

    await seed({ b: { assetId: 'sourceA', url: urls.sourceA } }); await start()
    let same = await pair(3.9, 2, [media.sourceA, media.sourceA]); assert.notDeepEqual(same[0].pixel, same[1].pixel)
    await page.evaluate(pixels => {
      window.slideObservations = { count: 0, failures: [] }
      window.slideObservers = ['outgoing', 'incoming'].map(side => {
        const c = document.querySelector('[data-testid="slide-edit-' + side + '-canvas"]')
        const observer = new MutationObserver(() => {
          if (c.dataset.state !== 'ready') return
          const frame = Math.floor((Number(c.dataset.frameTime) + 1e-8) * 10)
          const rgb = [...c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data]
          window.slideObservations.count++
          if (!pixels[frame] || pixels[frame].some((v, i) => Math.abs(v - rgb[i]) > 5)) window.slideObservations.failures.push({ side, frame, rgb })
        })
        observer.observe(c, { attributes: true }); return observer
      })
    }, media.sourceA.pixels)
    await page.evaluate(({ x, y }) => {
      for (const delta of [0.5, -0.2, 0.8, 0.1, 0.7]) window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + delta * 50, clientY: y, buttons: 1 }))
    }, gesture)
    await waitDelta(0.7); await pair(4.6, 2.7, [media.sourceA, media.sourceA])
    const observed = await page.evaluate(() => { window.slideObservers.forEach(o => o.disconnect()); return window.slideObservations })
    assert.ok(observed.count > 0); assert.deepEqual(observed.failures, []); await release()
    console.log('PASS 3: same-source independent clocks and every advertised ready frame matches actual pixels during rapid dragging')

    for (const setup of [
      { a: { reverse: true } },
      { b: { reverse: true } },
      { a: { speed: 0.5, trimEnd: 2.5 }, b: { speed: 2, trimStart: 1, trimEnd: 7 } },
      { a: { speed: 2, trimEnd: 7 }, b: { reverse: true, speed: 0.5, trimEnd: 3.5 } },
    ]) {
      detail('4 clock ' + JSON.stringify(setup))
      await seed(setup); before = await state(); await start(); await move(0.4); await waitDelta(0.4)
      const after = await state(); unchanged(after, before, 0.4)
      for (const id of ['previous', 'next']) {
        const old = byId(before, id), current = byId(after, id)
        const startTime = Math.max(old.startTime, current.startTime), endTime = Math.min(old.startTime + old.duration, current.startTime + current.duration)
        for (const time of [startTime, startTime + 0.1, (startTime + endTime) / 2, endTime - 0.1]) near(rawSourceAt(current, time), rawSourceAt(old, time), id + ' retained affine clock')
      }
      await framesForCurrent(); await release()
    }
    const cache = { version: 'rife_ncnn_vulkan_v46_uhd_v1', engine: 'rife-ncnn-vulkan', modelName: 'rife-v4.6',
      status: 'ready', path: 'cache/synthetic-slide.mp4', url: urls.cached, sourceStart: 1, sourceEnd: 8, targetFps: 20, requestedTargetFps: 20 }
    for (const valid of [true, false]) {
      detail('4 RIFE ' + valid)
      await seed({ a: { speed: 0.5, trimStart: 2, trimEnd: 3.5, frameSampling: 'optical-flow', opticalFlowCache: { ...cache, status: valid ? 'ready' : 'invalid' } } })
      await start(); await move(0.4); await waitDelta(0.4)
      await readyFrame('outgoing', 3.65, valid ? media.cached : media.sourceA, valid ? 'optical-flow' : 'original', valid ? 2.65 : 3.65)
      await readyFrame('incoming', 2.4, media.sourceB); await release()
    }
    console.log('PASS 4: reverse/mixed0.5x/2x and nonzero-origin verified RIFE or original fallback preserve source clocks and exact decoded frames')

    for (const setup of [
      { a: { sourceDuration: 4.2 }, requested: 2, accepted: 0.2, label: /source end/i },
      { b: { trimStart: 0.26, trimEnd: 3.26 }, requested: -0.4, accepted: -0.2, label: /source start/i },
      { b: { trimStart: 3, trimEnd: 6 }, requested: -5, accepted: -2.9, label: /minimum|frame/i },
      { requested: 5, accepted: 2.9, label: /minimum|frame/i },
      { a: { reverse: true, trimStart: 0.26, trimEnd: 3.26 }, requested: 1, accepted: 0.2, label: /source start/i },
    ]) {
      detail('5 bound ' + setup.requested + ' ' + setup.accepted)
      await seed(setup); before = await state(); await start(); await move(setup.requested); await waitDelta(setup.accepted)
      await framesForCurrent(); unchanged(await state(), before, setup.accepted)
      assert.match(await page.getByTestId('slide-edit-limit').innerText(), setup.label); await release()
    }
    for (const snapCase of ['exclude-triplet', 'stationary-edge', 'clamped-edge']) {
      detail('5 snapping ' + snapCase)
      await seed(snapCase === 'clamped-edge' ? { a: { sourceDuration: 4.2 } } : {})
      await page.evaluate(snapCase => {
        const t = window.multiClipInspectorTest, s = t.timeline.getState()
        t.timeline.setState({ snappingEnabled: true, snappingThreshold: 10,
          clips: s.clips.map(c => c.id === 'unrelated' && snapCase !== 'exclude-triplet' ? { ...c, startTime: 5.5 } : c) })
        t.markProjectClean()
      }, snapCase)
      await start(); await move(snapCase === 'exclude-triplet' ? 0.06 : 0.44)
      await waitDelta(snapCase === 'exclude-triplet' ? 0.1 : snapCase === 'stationary-edge' ? 0.5 : 0.2)
      await framesForCurrent()
      const snapTime = await page.evaluate(() => window.multiClipInspectorTest.timeline.getState().activeSnapTime)
      if (snapCase === 'stationary-edge') near(snapTime, 5.5, 'stationary edge snap')
      else assert.equal(snapTime, null, 'moving triplet or source-clamped snap must not advertise a false line')
      await release()
    }
    console.log('PASS 5: finite/fractional/duration limits and triplet-excluding snapping explain actual accepted frames without a false snap line')

    await seed(); before = await state()
    await page.evaluate(() => {
      const t = window.multiClipInspectorTest; window.slideAtomicEvents = []
      window.slideUnsubscribe = t.timeline.subscribe((s, p) => {
        const a = s.clips.find(c => c.id === 'previous'), m = s.clips.find(c => c.id === 'middle'), b = s.clips.find(c => c.id === 'next')
        window.slideAtomicEvents.push({ ids: s.clips.filter(c => c !== p.clips.find(old => old.id === c.id)).map(c => c.id),
          leftEnd: a.startTime + a.duration, middleStart: m.startTime, middleEnd: m.startTime + m.duration,
          nextStart: b.startTime, outerEnd: b.startTime + b.duration, history: s.history.length })
      })
    })
    await start(); assert.deepEqual(await page.evaluate(() => window.slideAtomicEvents), [])
    for (const [index, delta] of [0.4, 0.7, -0.2, 0.4].entries()) {
      await move(delta); await waitDelta(delta)
      const events = await page.evaluate(() => window.slideAtomicEvents); assert.equal(events.length, index + 1)
      const event = events.at(-1); assert.deepEqual(event.ids.sort(), ['middle', 'next', 'previous'])
      near(event.leftEnd, event.middleStart, 'atomic left cut'); near(event.middleEnd, event.nextStart, 'atomic right cut')
      near(event.outerEnd, 10, 'atomic outer end'); assert.equal(event.history, 1)
    }
    await page.evaluate(({ x, y }) => window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + 20, clientY: y, buttons: 1 })), gesture)
    assert.equal((await page.evaluate(() => window.slideAtomicEvents)).length, 4)
    const committed = await state(); await release(); await page.evaluate(() => window.slideUnsubscribe())
    await undo(); assert.deepEqual((await state()).clips, before.clips)
    await page.evaluate(() => window.multiClipInspectorTest.timeline.getState().redo()); assert.deepEqual((await state()).clips, committed.clips)
    await seed(); before = await state(); await start(); await move(0.4); await waitDelta(0.4); await move(0); await waitDelta(0); await release()
    assert.deepEqual((await state()).clips, before.clips); assert.equal((await state()).history, 0)
    console.log('PASS 6: all three clips and one history checkpoint publish atomically, repeat/origin are no-op and Undo/Redo is exact')

    const attrs = { keyframes: { opacity: [{ time: 0, value: 50 }, { time: 1, value: 100 }] },
      effects: [{ id: 'brightness', effectId: 'brightness', enabled: false, params: { amount: 0.2 } }],
      gainDb: -3, fadeIn: 0.2, fadeOut: 0.3, audioEq: { version: 1, enabled: true, lowCut: true, bassDb: 3, midDb: -2, trebleDb: 1 },
      volumeEnvelope: { version: 1, offsetSeconds: 0.25, points: [{ id: 'g0', time: 0, db: -6 }, { id: 'g1', time: 2, db: 3 }] } }
    await seed({ middle: attrs, a: attrs, b: attrs }); before = await state(); await start(); await move(0.4); await waitDelta(0.4)
    unchanged(await state(), before, 0.4)
    near(byId(await state(), 'next').volumeEnvelope.offsetSeconds, 0.65, 'next head envelope consumes local time once')
    near(byId(await state(), 'previous').volumeEnvelope.offsetSeconds, 0.25, 'previous tail keeps envelope origin')
    await release()
    const saved = await state()
    await page.evaluate(() => {
      const t = window.multiClipInspectorTest, s = t.timeline.getState()
      s.loadFromProject(JSON.parse(JSON.stringify(s.getProjectData())), t.assets.getState().assets, 10)
      t.timeline.setState({ selectedClipIds: ['middle'] })
    })
    for (const id of ['previous', 'middle', 'next']) {
      const old = byId(saved, id), current = byId(await state(), id)
      for (const key of ['startTime', 'duration', 'trimStart', 'trimEnd', ...Object.keys(attrs)]) assert.deepEqual(current[key], old[key], id + ' reload ' + key)
    }
    await start(); await pair(4.3, 2.4); await release()
    console.log('PASS 7: middle attributes stay exact, head envelope shifts once, and three source windows survive JSON save/reopen')

    for (const kind of ['ramp', 'unknown', 'nonunit', 'linked-middle', 'linked-neighbor', 'locked-middle', 'locked-neighbor', 'sync-track', 'gap', 'overlap', 'ambiguous', 'transition', 'playing', 'compound', 'cache-busy', 'batch']) {
      detail('8 refusal ' + kind)
      await seed()
      const verdict = await page.evaluate(kind => {
        const t = window.multiClipInspectorTest, s = t.timeline.getState()
        let clips = s.clips.map(c => {
          if (c.id === 'middle') {
            if (kind === 'ramp') return { ...c, keyframes: { speed: [{ time: 0, value: 1 }, { time: 1, value: 2 }] } }
            if (kind === 'unknown') return { ...c, sourceDuration: null }
            if (kind === 'nonunit') return { ...c, sourceTimeScale: 2 }
            if (kind === 'linked-middle') return { ...c, linkGroupId: 'group' }
            if (kind === 'locked-middle') return { ...c, locked: true }
            if (kind === 'cache-busy') return { ...c, cacheStatus: 'rendering' }
            if (kind === 'compound') return { ...c, type: 'compound', compound: { version: 1,
              document: { fps: 10, width: 96, height: 54, duration: 8, clips: [], tracks: [], transitions: [] } } }
          }
          if (c.id === 'previous') {
            if (kind === 'locked-neighbor') return { ...c, locked: true }
            if (kind === 'linked-neighbor') return { ...c, linkGroupId: 'group' }
            if (kind === 'gap') return { ...c, duration: 2.9, trimEnd: 3.9 }
            if (kind === 'overlap') return { ...c, duration: 3.1, trimEnd: 4.1 }
          }
          return c
        })
        if (kind === 'ambiguous') clips.push({ ...clips[0], id: 'duplicate-neighbor' })
        if (kind.startsWith('linked')) clips.push({ ...clips[1], id: 'linked-mate', type: 'audio', trackId: 'audio', assetId: null, url: null, linkGroupId: 'group' })
        t.timeline.setState({ clips, ...(kind === 'sync-track' ? { tracks: s.tracks.map(tr => tr.id === 'visual-a' ? { ...tr, lockMode: 'sync' } : tr) } : {}),
          ...(kind === 'batch' ? { selectedClipIds: ['previous', 'middle'] } : {}),
          ...(kind === 'playing' ? { isPlaying: true } : {}),
          ...(kind === 'transition' ? { transitions: [{ id: 'edge', kind: 'between', clipAId: 'previous', clipBId: 'middle', duration: 0.5, editPoint: 5 }] } : {}) })
        t.markProjectClean()
        const before = t.timeline.getState(); let events = 0
        const stop = t.timeline.subscribe(() => events++)
        const result = before.beginSlideEdit({ clipId: 'middle' }); stop()
        return { ok: result.ok, reason: result.reason, same: before === t.timeline.getState(), events, dirty: t.isProjectDirty() }
      }, kind)
      assert.equal(verdict.ok, false, kind); assert.ok(verdict.reason, kind); assert.equal(verdict.same, true, kind)
      assert.equal(verdict.events, 0); assert.equal(verdict.dirty, false)
    }
    for (const setup of [{ middle: { locked: true } }, { a: { locked: true } }, { middle: { keyframes: { speed: [{ time: 0, value: 1 }, { time: 1, value: 2 }] } } }, { selected: ['previous', 'middle'] }, { a: { duration: 2.9, trimEnd: 3.9 } }]) {
      await seed(setup); before = await state(); await pressBody(); await page.getByTestId('slide-edit-refusal').waitFor()
      await move(0.8); await page.mouse.up()
      assert.deepEqual((await state()).clips, before.clips); assert.equal((await state()).history, 0); assert.equal((await state()).dirty, false)
      assert.deepEqual((await state()).selected, before.selected, 'refused gesture preserves the existing selection')
      assert.equal(await preview.count(), 0)
      if (!native && setup.a?.duration && process.env.VELORN_TEST_SCREENSHOT) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT.replace(/\.png$/, '-refusal.png') })
    }
    console.log('PASS 8: invalid triplets/links/locks/transitions/source clocks refuse with zero writes; actual rejected body gestures never become ordinary moves')

    await seed(); await start(); await pair(3.9, 2)
    await page.evaluate(url => window.multiClipInspectorTest.assets.setState(s => ({ assets: s.assets.map(a => a.id === 'sourceA' ? { ...a, url } : a) })), urls.broken)
    await page.waitForFunction(() => document.querySelector('[data-testid="slide-edit-outgoing-canvas"]')?.dataset.state === 'unavailable', null, { polling: 100 })
    assert.equal(await canvases.outgoing.evaluate(c => [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data].every(v => v === 0)), true)
    await readyFrame('incoming', 2, media.sourceB); await release()
    for (const delta of [-5, 5]) {
      detail('9 generators ' + delta)
      await seed({ a: { type: 'image', assetId: 'image', url: urls.image, sourceDuration: null, trimStart: 0, trimEnd: 3 },
        middle: { type: 'image', assetId: 'image', url: urls.image, sourceDuration: null },
        b: { type: 'text', assetId: null, url: null, sourceDuration: undefined, trimStart: 0, trimEnd: 3, textProperties: { text: 'Static title' } } })
      before = await state(); await start(); await move(delta); await waitDelta(delta > 0 ? 2.9 : -2.9)
      unchanged(await state(), before, delta > 0 ? 2.9 : -2.9)
      await page.waitForFunction(() => document.querySelector('[data-testid="slide-edit-outgoing-canvas"]')?.dataset.state === 'ready', null, { polling: 100 })
      assert.deepEqual(await canvases.outgoing.evaluate(c => [...c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data].slice(0, 3)), [174, 35, 119])
      assert.equal(await canvases.incoming.getAttribute('data-state'), 'timing-only')
      assert.match(await page.getByTestId('slide-edit-limit').innerText(), /minimum|frame/i); await release()
    }
    await seed({ audio: true }); await start(); await move(0.2); await waitDelta(0.2)
    for (const c of Object.values(canvases)) {
      assert.equal(await c.getAttribute('data-state'), 'timing-only')
      assert.equal(await c.evaluate(c => [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data].every(v => v === 0)), true)
    }
    await release()
    console.log('PASS 9: unavailable sides clear old pixels, still/title generators have duration-only limits, and audio reports timing-only')

    for (const mutation of ['Escape', 'blur', 'pointercancel', 'tool', 'selection', 'lock', 'load', 'history', 'remove']) {
      detail('10 cleanup ' + mutation)
      await seed(); await start(); await move(0.2); await waitDelta(0.2)
      if (mutation === 'tool') await page.keyboard.press('v')
      else await page.evaluate(mutation => {
        const t = window.multiClipInspectorTest, s = t.timeline.getState()
        if (mutation === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        if (mutation === 'blur') window.dispatchEvent(new Event('blur'))
        if (mutation === 'pointercancel') window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))
        if (mutation === 'selection') t.timeline.setState({ selectedClipIds: ['previous'] })
        if (mutation === 'lock') t.timeline.setState({ clips: s.clips.map(c => c.id === 'next' ? { ...c, locked: true } : c) })
        if (mutation === 'load') s.loadFromProject(JSON.parse(JSON.stringify(s.getProjectData())), t.assets.getState().assets, 10)
        if (mutation === 'history') s.saveToHistory()
        if (mutation === 'remove') t.timeline.setState({ clips: s.clips.filter(c => c.id !== 'next') })
      }, mutation)
      await preview.waitFor({ state: 'hidden' }); const ended = await state(); await move(0.8); await page.mouse.up()
      assert.deepEqual((await state()).clips, ended.clips); assert.equal((await state()).history, ended.history)
    }
    await seed(); await start(); await move(0.2); await waitDelta(0.2)
    await page.evaluate(() => window.multiClipInspectorTest.setTimelineVisible(false)); await preview.waitFor({ state: 'hidden' })
    const ended = await state(); await move(0.8); await page.mouse.up(); assert.deepEqual((await state()).clips, ended.clips)
    await page.evaluate(() => window.multiClipInspectorTest.setTimelineVisible(true))
    console.log('PASS 10: release/cancel/tool/selection/lock/load/history/removal/unmount end the gesture and prevent stale writes')

    await seed(); await start(); await move(0.4); await waitDelta(0.4); await pair(4.3, 2.4)
    for (const width of [600, 350]) {
      detail('11 layout ' + width)
      if (native) await browser.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 850), width)
      else await page.setViewportSize({ width, height: 850 })
      await page.waitForFunction(width => window.innerWidth === width, width, { polling: 100 })
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="slide-edit-preview"]'); if (!el) return false
        const r = el.getBoundingClientRect()
        return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1
      }, null, { polling: 100 })
      for (const c of Object.values(canvases)) {
        const box = await c.boundingBox(); assert.ok(box.width > 0 && box.height > 0)
        assert.ok(box.x >= -1 && box.x + box.width <= width + 1)
      }
      if (!native && width === 350 && process.env.VELORN_TEST_SCREENSHOT) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT })
    }
    await release(); assert.deepEqual(errors, [])
    console.log('PASS: all 11 Slide integration groups; no renderer exceptions' + (native ? ' (isolated installed Electron).' : ' (Chrome).'))
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
