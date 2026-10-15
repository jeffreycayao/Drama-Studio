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
      && typeof window.multiClipInspectorTest.timeline.getState().beginRollEdit === 'function', null, { polling: 100 })
    const urls = await page.evaluate(async media => {
      const t = window.multiClipInspectorTest
      t.project.setState({ currentProject: { name: 'Synthetic rolling preview', settings: { fps: 10, width: 960, height: 540 }, timelines: [] },
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
    const preview = page.getByTestId('roll-edit-preview')
    const canvases = { outgoing: page.getByTestId('roll-edit-outgoing-canvas'), incoming: page.getByTestId('roll-edit-incoming-canvas') }
    const state = () => page.evaluate(() => {
      const t = window.multiClipInspectorTest, s = t.timeline.getState()
      return JSON.parse(JSON.stringify({ clips: s.clips, tracks: s.tracks, selected: s.selectedClipIds, duration: s.duration,
        markers: s.markers, inPoint: s.inPoint, outPoint: s.outPoint, history: s.history.length, historyIndex: s.historyIndex,
        playhead: s.playheadPosition, dirty: t.isProjectDirty(), playing: s.isPlaying }))
    })
    const byId = (s, id = 'visual-a') => s.clips.find(c => c.id === id)
    let testZoom = 250
    const seed = async ({ a = {}, b = {}, selected = ['visual-a'], audio = false, zoom = 250 } = {}) => {
      testZoom = zoom
      await page.mouse.up(); await page.keyboard.press('Escape')
      await page.evaluate(({ a, b, selected, audio, urls, zoom }) => {
        const t = window.multiClipInspectorTest; t.reset()
        t.assets.setState({ assets: [
          { id: 'sourceA', type: 'video', name: 'Outgoing encoded frames', url: urls.sourceA, duration: 8, fps: 10, hasAudio: false, settings: { fps: 10, width: 96, height: 54 } },
          { id: 'sourceB', type: 'video', name: 'Incoming encoded frames', url: urls.sourceB, duration: 8, fps: 10, hasAudio: false, settings: { fps: 10, width: 96, height: 54 } },
          { id: 'image', type: 'image', name: 'Synthetic still', url: urls.image }], previewMode: 'timeline', currentPreview: null, isPlaying: false, volume: 0 })
        const base = { type: audio ? 'audio' : 'video', trackId: audio ? 'audio' : 'visual-a', sourceDuration: 8,
          sourceFps: 10, timelineFps: 10, sourceTimeScale: 1, speed: 1, reverse: false, frameSampling: 'frame', effects: [], keyframes: {},
          transform: { positionX: 0, positionY: 0, scaleX: 100, scaleY: 100, rotation: 0, opacity: 100 } }
        t.timeline.setState(s => ({ clips: [
          { ...base, id: 'visual-a', name: 'Outgoing A', assetId: audio ? null : 'sourceA', url: audio ? null : urls.sourceA,
            startTime: 2, duration: 3, trimStart: 1, trimEnd: 4, ...a },
          { ...base, id: 'visual-b', name: 'Incoming B', assetId: audio ? null : 'sourceB', url: audio ? null : urls.sourceB,
            startTime: 5, duration: 2, trimStart: 2, trimEnd: 4, ...b },
          { id: 'unrelated', name: 'Unrelated', type: 'shape', trackId: 'visual-b', startTime: 9, duration: 2, trimStart: 0, trimEnd: 2 }],
          selectedClipIds: selected, timelineFps: 10, zoom, playheadPosition: 1.3,
          timelineSessionId: (s.timelineSessionId || 0) + 1, duration: 30, snappingEnabled: false, history: [], historyIndex: -1,
          isPlaying: false, transitions: [], markers: [{ id: 'marker', name: 'Untouched', time: 11 }], inPoint: 1, outPoint: 12 }))
        t.markProjectClean()
      }, { a, b, selected, audio, urls, zoom })
      await page.locator('[aria-label="Timeline edit tools"] button').nth(2).click()
      await preview.waitFor({ state: 'hidden' })
    }
    let gesture
    const pressHandle = async () => {
      const handle = page.locator('[data-testid="roll-edit-handle"][data-clip-a-id="visual-a"][data-clip-b-id="visual-b"]').first()
      await handle.scrollIntoViewIfNeeded(); const box = await handle.boundingBox(); assert.ok(box, 'real roll handle exists')
      // Avoid the centered Add Transition button and upper audio fade handles.
      gesture = { x: box.x + box.width / 2, y: box.y + box.height * 0.78 }
      await page.mouse.move(gesture.x, gesture.y); await page.mouse.down()
    }
    const start = async () => {
      await pressHandle(); await preview.waitFor()
      assert.equal(await preview.evaluate(el => getComputedStyle(el).pointerEvents), 'none')
    }
    const move = delta => page.mouse.move(gesture.x + delta * (testZoom / 5), gesture.y)
    const release = async () => { await page.mouse.up(); await preview.waitFor({ state: 'hidden' }) }
    const waitCut = cut => page.waitForFunction(cut => {
      const s = window.multiClipInspectorTest.timeline.getState(), a = s.clips.find(c => c.id === 'visual-a'), b = s.clips.find(c => c.id === 'visual-b')
      return Math.abs(a.startTime + a.duration - cut) < 1e-6 && Math.abs(b.startTime - cut) < 1e-6
    }, cut, { polling: 100 })
    const readyFrame = async (side, sourceTime, reference, mode = 'original', frameTime = sourceTime) => {
      try {
        await page.waitForFunction(({ side, sourceTime, frameTime }) => {
          const el = document.querySelector(`[data-testid="roll-edit-${side}-canvas"]`)
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
    const unchangedOuter = (after, before) => {
      near(after.playhead, before.playhead, 'fixed timeline playhead'); near(after.duration, before.duration, 'sequence extent')
      near(byId(after).startTime, byId(before).startTime, 'fixed outer start')
      near(byId(after, 'visual-b').startTime + byId(after, 'visual-b').duration, byId(before, 'visual-b').startTime + byId(before, 'visual-b').duration, 'fixed outer end')
      assert.deepEqual(byId(after, 'unrelated'), byId(before, 'unrelated')); assert.deepEqual(after.tracks, before.tracks)
      assert.deepEqual(after.markers, before.markers); assert.equal(after.inPoint, before.inPoint); assert.equal(after.outPoint, before.outPoint)
    }
    const undo = () => page.evaluate(() => window.multiClipInspectorTest.timeline.getState().undo())

    // 1. Merely viewing both sides never changes the document or playhead.
    await seed(); const idle = await state(); await start(); await pair(3.9, 2)
    assert.match(await page.getByTestId('roll-edit-cut-time').innerText(), /00:00:05:00/)
    assert.match(await page.getByTestId('roll-edit-delta').innerText(), /0\s*f/i)
    assert.deepEqual((await state()).clips, idle.clips); assert.equal((await state()).dirty, false)
    assert.equal((await state()).history, 0, 'read-only begin creates no checkpoint')
    const privateVideos = await preview.locator('video').evaluateAll(videos => videos.map(v => ({ muted: v.muted, volume: v.volume, paused: v.paused })))
    assert.equal(privateVideos.length, 2); privateVideos.forEach(v => { assert.equal(v.muted, true); assert.equal(v.volume, 0); assert.equal(v.paused, true) })
    await release(); unchangedOuter(await state(), idle)
    console.log('PASS 1: independent muted two-up source viewers are document/dirty/playhead neutral and add no history')

    // 2. Forward and backward rolls show last retained A and first retained B.
    for (const [delta, outgoing, incoming] of [[0.4, 4.3, 2.4], [-0.6, 3.3, 1.4]]) {
      await seed(); const before = await state(); await start(); await move(delta); await waitCut(5 + delta)
      await pair(outgoing, incoming); const after = await state(); unchangedOuter(after, before)
      near(byId(after).duration, 3 + delta, 'outgoing duration'); near(byId(after, 'visual-b').duration, 2 - delta, 'incoming duration')
      assert.equal(after.history, 1); assert.equal(after.playing, false)
      assert.match(await page.getByTestId('roll-edit-delta').innerText(), delta > 0 ? /\+4\s*f/i : /[−-]6\s*f/i)
      if (delta > 0 && process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT.replace(/\.png$/, '-wide.png') })
      await release(); await undo(); assert.deepEqual((await state()).clips, before.clips)
    }
    // At 100px/s, +/-5 pixels is exactly half a 10fps frame. A single
    // accepted delta must drive both clips, preserving Math.round tie policy.
    for (const [requested, accepted] of [[0.05, 0.1], [-0.05, 0]]) {
      await seed({ zoom: 500 }); const before = await state(); await start(); await move(requested)
      await waitCut(5 + accepted); await pair(3.9 + accepted, 2 + accepted)
      unchangedOuter(await state(), before); assert.equal((await state()).history, accepted === 0 ? 0 : 1)
      await release(); await undo(); assert.deepEqual((await state()).clips, before.clips)
    }
    console.log('PASS 2: both roll directions show exact decoded retained frames, signed delta, unchanged outer bounds and one Undo')

    // 3. Same URL, independent clocks; rapid coalesced seeks cannot advertise stale pixels.
    await seed({ b: { assetId: 'sourceA', url: urls.sourceA } }); await start()
    const sameUrl = await pair(3.9, 2, [media.sourceA, media.sourceA]); assert.notDeepEqual(sameUrl[0].pixel, sameUrl[1].pixel)
    await page.evaluate(pixels => {
      window.rollReadyObservations = { count: 0, failures: [] }
      window.rollReadyObservers = ['outgoing', 'incoming'].map(side => {
        const canvas = document.querySelector(`[data-testid="roll-edit-${side}-canvas"]`)
        const observer = new MutationObserver(() => {
          if (canvas.dataset.state !== 'ready') return
          const frame = Math.floor((Number(canvas.dataset.frameTime) + 1e-8) * 10)
          const actual = [...canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data]
          window.rollReadyObservations.count++
          if (!pixels[frame] || pixels[frame].some((value, index) => Math.abs(value - actual[index]) > 5)) window.rollReadyObservations.failures.push({ side, frame, actual })
        })
        observer.observe(canvas, { attributes: true }); return observer
      })
    }, media.sourceA.pixels)
    await page.evaluate(({ x, y }) => { for (const delta of [0.5, -0.2, 0.8, 0.1, 0.7]) window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + delta * 50, clientY: y, buttons: 1 })) }, gesture)
    await waitCut(5.7); await pair(4.6, 2.7, [media.sourceA, media.sourceA])
    const observed = await page.evaluate(() => { window.rollReadyObservers.forEach(o => o.disconnect()); return window.rollReadyObservations })
    assert.ok(observed.count > 0); assert.deepEqual(observed.failures, []); assert.equal((await state()).history, 1)
    await release()
    console.log('PASS 3: same-source private decoders hold separate times and every advertised ready frame matches its actual pixels')

    // 4. Source mapping follows actual speed/reverse clips, independent of playhead.
    for (const test of [
      { a: { speed: 0.5, trimEnd: 2.5 }, b: { speed: 0.5, trimEnd: 3 }, delta: 0.4, out: 2.65, incoming: 2.2 },
      { a: { speed: 2, trimEnd: 7 }, b: { speed: 2, trimEnd: 6 }, delta: 0.2, out: 7.2, incoming: 2.4 },
      { a: { reverse: true }, b: { reverse: true }, delta: 0.4, out: 0.7, incoming: 3.599999 },
    ]) {
      await seed(test); const before = await state(); await start(); await move(test.delta); await waitCut(5 + test.delta)
      await pair(test.out, test.incoming); unchangedOuter(await state(), before); await release()
    }
    const cache = { version: 'rife_ncnn_vulkan_v46_uhd_v1', engine: 'rife-ncnn-vulkan', modelName: 'rife-v4.6',
      status: 'ready', path: 'cache/synthetic-roll.mp4', url: urls.cached, sourceStart: 1, sourceEnd: 8, targetFps: 20, requestedTargetFps: 20 }
    for (const valid of [true, false]) {
      await seed({ a: { speed: 0.5, trimStart: 2, trimEnd: 3.5, frameSampling: 'optical-flow', opticalFlowCache: { ...cache, status: valid ? 'ready' : 'invalid' } } })
      await start(); await move(0.4); await waitCut(5.4)
      await readyFrame('outgoing', 3.65, valid ? media.cached : media.sourceA, valid ? 'optical-flow' : 'original', valid ? 2.65 : 3.65)
      await readyFrame('incoming', 2.4, media.sourceB); await release()
    }
    console.log('PASS 4: slow/fast/reverse actual source mapping and verified Optical Flow or original fallback show decoded matching frames')

    // 5. Feedback identifies the actual reached source/minimum-duration boundary.
    for (const test of [
      { a: { sourceDuration: 4.2 }, delta: 1, cut: 5.2, out: 4.1, incoming: 2.2, label: /source|media/i },
      { b: { trimStart: 0.2, trimEnd: 2.2 }, delta: -1, cut: 4.8, out: 3.7, incoming: 0, label: /source|media/i },
      { b: { trimStart: 5, trimEnd: 7 }, delta: -5, cut: 2.1, out: 1, incoming: 2.1, label: /minimum|1\s*frame/i },
      { delta: 5, cut: 6.9, out: 5.8, incoming: 3.9, label: /minimum|1\s*frame/i },
    ]) {
      await seed(test); const before = await state(); await start(); await move(test.delta); await waitCut(test.cut)
      await pair(test.out, test.incoming); assert.match(await page.getByTestId('roll-edit-limit').innerText(), test.label)
      unchangedOuter(await state(), before); assert.equal((await state()).history, 1); await release()
    }
    // The raw incoming handle can lie between timeline frames. Reaching the
    // same accepted frame by natural rounding is not yet a physical limit;
    // pulling beyond that handle must explain the inward-rounded stop.
    await seed({ b: { trimStart: 0.26, trimEnd: 2.26 } })
    const fractionalBefore = await state(); await start(); await move(-0.22); await waitCut(4.8)
    await pair(3.7, 0.06); assert.equal(await page.getByTestId('roll-edit-limit').count(), 0)
    const naturallyRounded = await state(); await move(-0.4)
    await page.getByTestId('roll-edit-limit').waitFor()
    assert.match(await page.getByTestId('roll-edit-limit').innerText(), /incoming source start/i)
    await pair(3.7, 0.06); assert.deepEqual((await state()).clips, naturallyRounded.clips)
    assert.equal((await state()).history, 1); unchangedOuter(await state(), fractionalBefore)
    await release(); await undo(); assert.deepEqual((await state()).clips, fractionalBefore.clips)
    console.log('PASS 5: media/one-frame limits and inward-rounded source stops are truthful, decoded correctly and preserve sequence length')

    // 6. A broken side clears its old pixels without poisoning the healthy side.
    await seed(); await start(); await pair(3.9, 2)
    await page.evaluate(url => window.multiClipInspectorTest.assets.setState(s => ({ assets: s.assets.map(a => a.id === 'sourceA' ? { ...a, url } : a) })), urls.broken)
    await page.waitForFunction(() => document.querySelector('[data-testid="roll-edit-outgoing-canvas"]')?.dataset.state === 'unavailable', null, { polling: 100 })
    const blank = await canvases.outgoing.evaluate(el => ({ state: el.dataset.state, source: el.dataset.sourceTime,
      pixels: [...el.getContext('2d').getImageData(0, 0, el.width, el.height).data] }))
    assert.equal(blank.pixels.every(value => value === 0), true, 'missing source clears all old pixels'); assert.equal(blank.source, '')
    await readyFrame('incoming', 2, media.sourceB)
    await page.evaluate(url => window.multiClipInspectorTest.assets.setState(s => ({ assets: s.assets.map(a => a.id === 'sourceA' ? { ...a, url } : a) })), urls.sourceA)
    await pair(3.9, 2); await release()
    await seed({ a: { type: 'image', assetId: 'image', url: urls.image } }); await start()
    await page.waitForFunction(() => document.querySelector('[data-testid="roll-edit-outgoing-canvas"]')?.dataset.state === 'ready', null, { polling: 100 })
    assert.equal(await canvases.outgoing.getAttribute('data-source-mode'), 'image')
    assert.deepEqual(await canvases.outgoing.evaluate(el => [...el.getContext('2d').getImageData(el.width / 2, el.height / 2, 1, 1).data].slice(0, 3)), [174, 35, 119])
    await readyFrame('incoming', 2, media.sourceB); await release()
    await seed({ audio: true }); await start(); await move(0.2); await waitCut(5.2)
    for (const canvas of Object.values(canvases)) {
      assert.equal(await canvas.getAttribute('data-state'), 'timing-only')
      assert.equal(await canvas.evaluate(el => [...el.getContext('2d').getImageData(0, 0, el.width, el.height).data].every(v => v === 0)), true)
    }
    assert.match(await preview.innerText(), /audio|timing/i); await release()
    console.log('PASS 6: decode failure clears stale pixels, the other side stays valid, and still/audio sources report honest content or timing only')

    // 7. All gesture termination routes hide feedback and prevent stale writes.
    for (const kind of ['clip-a', 'clip-b-sync', 'track', 'track-sync']) {
      await seed()
      await page.evaluate(kind => {
        const t = window.multiClipInspectorTest, s = t.timeline.getState()
        if (kind === 'clip-a') t.timeline.setState({ clips: s.clips.map(c => c.id === 'visual-a' ? { ...c, locked: true } : c) })
        if (kind === 'clip-b-sync') t.timeline.setState({ clips: s.clips.map(c => c.id === 'visual-b' ? { ...c, syncLocked: true } : c) })
        if (kind === 'track') t.timeline.setState({ tracks: s.tracks.map(track => track.id === 'visual-a' ? { ...track, locked: true } : track) })
        if (kind === 'track-sync') t.timeline.setState({ tracks: s.tracks.map(track => track.id === 'visual-a' ? { ...track, lockMode: 'sync' } : track) })
        t.markProjectClean()
      }, kind)
      const locked = await state(), handle = page.locator('[data-testid="roll-edit-handle"][data-clip-a-id="visual-a"][data-clip-b-id="visual-b"]').first()
      if (await handle.count()) {
        const box = await handle.boundingBox()
        await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.78); await page.mouse.down()
        await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height * 0.78); await page.mouse.up()
      }
      await preview.waitFor({ state: 'hidden' }); const after = await state()
      assert.deepEqual(after.clips, locked.clips, `${kind} prevents starting a roll`); assert.equal(after.history, 0); assert.equal(after.dirty, false)
    }
    for (const mutation of ['escape', 'blur', 'pointercancel', 'tool', 'selection', 'lock', 'load', 'remove', 'history']) {
      await seed(); await start(); await move(0.2); await waitCut(5.2)
      if (mutation === 'tool') await page.keyboard.press('v')
      else await page.evaluate(mutation => {
        const t = window.multiClipInspectorTest, s = t.timeline.getState()
        if (mutation === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        if (mutation === 'blur') window.dispatchEvent(new Event('blur'))
        if (mutation === 'pointercancel') window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))
        if (mutation === 'selection') t.timeline.setState({ selectedClipIds: ['visual-b'] })
        if (mutation === 'lock') t.timeline.setState({ tracks: s.tracks.map(track => track.id === 'visual-a' ? { ...track, locked: true } : track) })
        if (mutation === 'load') s.loadFromProject(JSON.parse(JSON.stringify(s.getProjectData())), t.assets.getState().assets, 10)
        if (mutation === 'remove') t.timeline.setState({ clips: s.clips.filter(c => c.id !== 'visual-b') })
        if (mutation === 'history') s.saveToHistory()
      }, mutation)
      await preview.waitFor({ state: 'hidden' }); const ended = await state(); await move(0.8); await page.mouse.up()
      assert.deepEqual((await state()).clips, ended.clips, `${mutation} prevents stale writes`)
      assert.equal((await state()).history, ended.history); near((await state()).playhead, ended.playhead, `${mutation} playhead`)
    }
    await seed(); await start(); await move(0.2); await waitCut(5.2)
    await page.evaluate(() => window.multiClipInspectorTest.setTimelineVisible(false)); await preview.waitFor({ state: 'hidden' })
    const unmounted = await state(); await move(0.8); await page.mouse.up(); assert.deepEqual((await state()).clips, unmounted.clips)
    await page.evaluate(() => window.multiClipInspectorTest.setTimelineVisible(true))
    console.log('PASS 7: release/Escape/blur/cancel/tool/selection/lock/load/removal/history/unmount clean up viewers and stale gesture listeners')

    // 8. Stills/titles have unlimited media handles, including null/missing
    // duration metadata; only the two visible clip durations bound the roll.
    for (const orientation of ['image-title', 'title-image']) {
      for (const delta of [-5, 5]) {
        const imageClip = { type: 'image', assetId: 'image', url: urls.image, trimStart: 0, sourceDuration: null }
        const titleClip = { type: 'text', assetId: null, url: null, trimStart: 0, sourceDuration: undefined,
          textProperties: { text: 'A static title', fontFamily: 'Arial', fontSize: 64, color: '#ffffff' } }
        await seed({ a: { ...(orientation === 'image-title' ? imageClip : titleClip), trimEnd: 3 },
          b: { ...(orientation === 'image-title' ? titleClip : imageClip), trimEnd: 2 } })
        const before = await state(); await start(); await move(delta)
        const cut = delta > 0 ? 6.9 : 2.1
        await waitCut(cut); unchangedOuter(await state(), before)
        assert.match(await page.getByTestId('roll-edit-limit').innerText(), /minimum|1\s*frame/i)
        assert.doesNotMatch(await page.getByTestId('roll-edit-limit').innerText(), /source|media/i)
        const imageSide = orientation === 'image-title' ? 'outgoing' : 'incoming', titleSide = orientation === 'image-title' ? 'incoming' : 'outgoing'
        await page.waitForFunction(side => document.querySelector(`[data-testid="roll-edit-${side}-canvas"]`)?.dataset.state === 'ready', imageSide, { polling: 100 })
        assert.equal(await canvases[imageSide].getAttribute('data-source-mode'), 'image')
        assert.deepEqual(await canvases[imageSide].evaluate(el => [...el.getContext('2d').getImageData(el.width / 2, el.height / 2, 1, 1).data].slice(0, 3)), [174, 35, 119])
        assert.equal(await canvases[titleSide].getAttribute('data-state'), 'timing-only')
        assert.equal((await state()).history, 1)
        await release(); await undo(); assert.deepEqual((await state()).clips, before.clips)
      }
    }
    console.log('PASS 8: still/title pairs in both orders roll both directions to duration-only limits without invented source bounds')

    // 9. Every retained source clock stays anchored to absolute timeline time.
    // The first reverse sample retains the existing exclusive-outpoint guard;
    // raw affine clocks match even there, while interior guarded clocks match.
    for (const setup of [
      { a: { reverse: true }, b: {} },
      { a: {}, b: { reverse: true } },
      { a: { reverse: true, speed: 0.5, trimEnd: 2.5 }, b: { speed: 2, trimEnd: 6 } },
      { a: { speed: 2, trimEnd: 7 }, b: { reverse: true, speed: 0.5, trimEnd: 3 } },
    ]) {
      for (const delta of [-0.4, 0.4]) {
        await seed(setup); const before = await state(); await start(); await move(delta); await waitCut(5 + delta)
        const after = await state(); unchangedOuter(after, before)
        for (const id of ['visual-a', 'visual-b']) {
          const old = byId(before, id), current = byId(after, id)
          const overlapStart = Math.max(old.startTime, current.startTime), overlapEnd = Math.min(old.startTime + old.duration, current.startTime + current.duration)
          for (const time of [overlapStart, overlapStart + 0.1, (overlapStart + overlapEnd) / 2, overlapEnd - 0.1]) {
            near(rawSourceAt(current, time), rawSourceAt(old, time), `${id} raw affine clock at ${time}`)
            if (time > overlapStart) near(guardedSourceAt(current, time), guardedSourceAt(old, time), `${id} retained guarded clock at ${time}`)
          }
        }
        const a = byId(after), b = byId(after, 'visual-b')
        await pair(guardedSourceAt(a, b.startTime - 1 / FPS), guardedSourceAt(b, b.startTime))
        await release(); await undo(); assert.deepEqual((await state()).clips, before.clips)
      }
    }
    for (const test of [
      { a: { reverse: true, trimStart: 0.2, trimEnd: 3.2 }, delta: 1, cut: 5.2, out: 0.1, incoming: 2.2, label: /source start/i },
      { b: { reverse: true, trimStart: 5.8, trimEnd: 7.8 }, delta: -1, cut: 4.8, out: 3.7, incoming: 7.999999, label: /source end/i },
    ]) {
      await seed(test); const before = await state(); await start(); await move(test.delta); await waitCut(test.cut)
      await pair(test.out, test.incoming); assert.match(await page.getByTestId('roll-edit-limit').innerText(), test.label)
      unchangedOuter(await state(), before); await release()
    }
    console.log('PASS 9: reverse A/B and mixed0.5x/2x edits preserve absolute source clocks, decoded cut frames and orientation-correct source limits')

    // 10. A move publishes BOTH changed clips plus its first history checkpoint
    // in one store notification. Later moves stay relative to the original pair.
    await seed(); const atomicBefore = await state()
    await page.evaluate(() => {
      const t = window.multiClipInspectorTest
      window.rollAtomicEvents = []
      window.rollAtomicUnsubscribe = t.timeline.subscribe((state, previous) => {
        const a = state.clips.find(c => c.id === 'visual-a'), b = state.clips.find(c => c.id === 'visual-b')
        window.rollAtomicEvents.push({ changedIds: state.clips.filter(c => c !== previous.clips.find(old => old.id === c.id)).map(c => c.id),
          cutA: a.startTime + a.duration, cutB: b.startTime, outerEnd: b.startTime + b.duration, history: state.history.length })
      })
    })
    await start(); assert.deepEqual(await page.evaluate(() => window.rollAtomicEvents), [])
    for (const [index, delta] of [0.4, 0.7, -0.2, 0.4].entries()) {
      await move(delta); await waitCut(5 + delta)
      const events = await page.evaluate(() => window.rollAtomicEvents)
      assert.equal(events.length, index + 1, 'one atomic publication per distinct accepted delta')
      const event = events.at(-1); assert.deepEqual(event.changedIds.sort(), ['visual-a', 'visual-b'])
      near(event.cutA, event.cutB, 'no subscriber observes a gap/overlap'); near(event.outerEnd, 7, 'subscriber outer bound'); assert.equal(event.history, 1)
    }
    await page.evaluate(({ x, y }) => window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + 20, clientY: y, buttons: 1 })), gesture)
    assert.equal((await page.evaluate(() => window.rollAtomicEvents)).length, 4, 'same accepted delta publishes nothing')
    const atomicAfter = await state(); unchangedOuter(atomicAfter, atomicBefore); await release()
    await page.evaluate(() => window.rollAtomicUnsubscribe())
    await undo(); assert.deepEqual((await state()).clips, atomicBefore.clips)
    await page.evaluate(() => window.multiClipInspectorTest.timeline.getState().redo()); assert.deepEqual((await state()).clips, atomicAfter.clips)
    await seed(); const origin = await state(); await start(); await move(0.4); await waitCut(5.4); await move(0); await waitCut(5); await release()
    assert.deepEqual((await state()).clips, origin.clips); assert.equal((await state()).history, 0, 'return to origin removes its own empty checkpoint')
    console.log('PASS 10: pair/history publication is atomic, repeated delta is a true no-op, cumulative gestures do not drift and Undo/Redo is one step')

    // 11. Unsupported clocks or invalid pairs never enter a mutating gesture.
    for (const kind of ['ramp', 'gap', 'overlap', 'different-track', 'invalid-span', 'unknown-video-duration', 'nonunit-video-clock', 'locked', 'playing']) {
      await seed()
      const verdict = await page.evaluate(kind => {
        const t = window.multiClipInspectorTest, s = t.timeline.getState()
        t.timeline.setState({ clips: s.clips.map(c => {
          if (kind === 'ramp' && c.id === 'visual-a') return { ...c, keyframes: { speed: [{ time: 0, value: 1 }, { time: 3, value: 2 }] } }
          if (kind === 'gap' && c.id === 'visual-b') return { ...c, startTime: 5.1 }
          if (kind === 'overlap' && c.id === 'visual-b') return { ...c, startTime: 4.9 }
          if (kind === 'different-track' && c.id === 'visual-b') return { ...c, trackId: 'visual-b' }
          if (kind === 'invalid-span' && c.id === 'visual-a') return { ...c, trimEnd: 1.1 }
          if (kind === 'unknown-video-duration' && c.id === 'visual-a') return { ...c, sourceDuration: null }
          if (kind === 'nonunit-video-clock' && c.id === 'visual-a') return { ...c, sourceTimeScale: 2, trimEnd: 7 }
          if (kind === 'locked' && c.id === 'visual-a') return { ...c, locked: true }
          return c
        }), ...(kind === 'playing' ? { isPlaying: true } : {}) })
        t.markProjectClean(); const before = t.timeline.getState(); let emissions = 0
        const off = t.timeline.subscribe(() => emissions++)
        const result = before.beginRollEdit({ clipAId: 'visual-a', clipBId: 'visual-b' })
        off(); const after = t.timeline.getState()
        return { result, emissions, same: before === after, history: after.history.length, dirty: t.isProjectDirty() }
      }, kind)
      assert.equal(verdict.result.ok, false, `${kind}: ${JSON.stringify(verdict.result)}`); assert.ok(verdict.result.reason)
      assert.equal(verdict.emissions, 0, kind); assert.equal(verdict.same, true, kind); assert.equal(verdict.history, 0); assert.equal(verdict.dirty, false)
    }
    await seed({ a: { keyframes: { speed: [{ time: 0, value: 1 }, { time: 3, value: 2 }] } } })
    const refusedBefore = await state(); await pressHandle()
    await page.getByTestId('roll-edit-refusal').waitFor(); assert.match(await page.getByTestId('roll-edit-refusal').innerText(), /ramp|speed/i)
    await move(0.4); await page.mouse.up(); await preview.waitFor({ state: 'hidden' })
    assert.deepEqual((await state()).clips, refusedBefore.clips); assert.equal((await state()).history, 0); assert.equal((await state()).dirty, false)
    if (process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT.replace(/\.png$/, '-refusal.png') })
    await seed()
    const stale = await page.evaluate(() => {
      const t = window.multiClipInspectorTest, s = t.timeline.getState(), begun = s.beginRollEdit({ clipAId: 'visual-a', clipBId: 'visual-b' })
      if (!begun.ok) throw new Error(begun.reason)
      t.timeline.setState({ selectedClipIds: ['visual-b'] }); t.markProjectClean(); const before = t.timeline.getState(); let count = 0
      const off = t.timeline.subscribe(() => count++), result = t.timeline.getState().applyRollEdit(begun.token, 0.4)
      off(); return { result, count, same: before === t.timeline.getState(), dirty: t.isProjectDirty() }
    })
    assert.equal(stale.result.ok, false); assert.equal(stale.count, 0); assert.equal(stale.same, true); assert.equal(stale.dirty, false)
    console.log('PASS 11: ramps, invalid geometry/source timing, locks/playback and stale sessions refuse without document/history/dirty writes')

    // 12. Both sides remain inside narrow viewports without capturing the drag.
    await seed(); await start(); await move(0.4); await waitCut(5.4); await pair(4.3, 2.4)
    for (const width of [600, 350]) {
      // Hidden Electron can change CDP metrics without delivering a native
      // resize event. Resize its real isolated window, as a desktop user does.
      if (native) await browser.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 850), width)
      else await page.setViewportSize({ width, height: 850 })
      await page.waitForFunction(width => {
        const box = document.querySelector('[data-testid="roll-edit-preview"]')?.getBoundingClientRect()
        return window.innerWidth === width && window.innerHeight === 850 && box?.right <= width + 1 && box?.bottom <= 851
      }, width, { polling: 100 })
      const geometry = await preview.evaluate(el => {
        const box = el.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
          viewport: { width: window.innerWidth, height: window.innerHeight }, width: el.clientWidth, scroll: el.scrollWidth,
          canvases: [...el.querySelectorAll('canvas')].map(c => { const r = c.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height } }) }
      })
      assert.deepEqual(geometry.viewport, { width, height: 850 }, 'requested size is the actual renderer viewport')
      assert.ok(geometry.left >= 0 && geometry.right <= width + 1 && geometry.top >= 0 && geometry.bottom <= 851, `Popup geometry at requested ${width}×850: ${JSON.stringify(geometry)}`)
      assert.ok(geometry.scroll <= geometry.width + 1); assert.equal(geometry.canvases.length, 2)
      geometry.canvases.forEach(c => assert.ok(c.left >= 0 && c.right <= width + 1 && c.width > 60 && c.height > 30))
      assert.equal(await preview.evaluate(el => getComputedStyle(el).pointerEvents), 'none')
    }
    if (process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT })
    await release(); assert.deepEqual(errors, [])
    console.log(`PASS: all 12 rolling-edit reliability/preview groups; no renderer exceptions (${native ? 'isolated installed Electron' : 'Chrome'}).`)
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
