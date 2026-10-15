// Actual Slip-tool gestures and independently decoded first/last source frames. All
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
      && typeof window.multiClipInspectorTest.timeline.getState().beginSlipEdit === 'function', null, { polling: 100 })
    const urls = await page.evaluate(async media => {
      const t = window.multiClipInspectorTest
      t.project.setState({ currentProject: { name: 'Synthetic slipping preview', settings: { fps: 10, width: 960, height: 540 }, timelines: [] },
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
    const preview = page.getByTestId('slip-edit-preview')
    const canvases = { first: page.getByTestId('slip-edit-first-canvas'), last: page.getByTestId('slip-edit-last-canvas') }
    const state = () => page.evaluate(() => {
      const t = window.multiClipInspectorTest, s = t.timeline.getState()
      return JSON.parse(JSON.stringify({ clips: s.clips, tracks: s.tracks, selected: s.selectedClipIds,
        duration: s.duration, markers: s.markers, inPoint: s.inPoint, outPoint: s.outPoint,
        history: s.history.length, historyIndex: s.historyIndex, playhead: s.playheadPosition,
        dirty: t.isProjectDirty(), playing: s.isPlaying }))
    })
    const target = s => s.clips.find(c => c.id === 'visual-a')
    let testZoom = 250, gesture
    const seed = async ({ clip = {}, selected = ['visual-a'], audio = false, zoom = 250 } = {}) => {
      testZoom = zoom
      await page.mouse.up(); await page.keyboard.press('Escape')
      await page.evaluate(({ clip, selected, audio, zoom, urls }) => {
        const t = window.multiClipInspectorTest; t.reset()
        t.assets.setState({ assets: [
          { id: 'sourceA', type: 'video', name: 'Encoded source frames', url: urls.sourceA, duration: 8, fps: 10,
            hasAudio: false, settings: { fps: 10, width: 96, height: 54 } },
          { id: 'sourceB', type: 'video', name: 'Untouched neighbor', url: urls.sourceB, duration: 8, fps: 10,
            hasAudio: false, settings: { fps: 10, width: 96, height: 54 } },
          { id: 'image', type: 'image', name: 'Synthetic still', url: urls.image }],
          previewMode: 'timeline', currentPreview: null, isPlaying: false, volume: 0 })
        const base = { type: 'video', trackId: 'visual-a', sourceDuration: 8, sourceFps: 10, timelineFps: 10,
          sourceTimeScale: 1, speed: 1, reverse: false, frameSampling: 'frame', effects: [], keyframes: {},
          transform: { positionX: 0, positionY: 0, scaleX: 100, scaleY: 100, rotation: 0, opacity: 100 } }
        t.timeline.setState(s => ({ clips: [
          { ...base, id: 'visual-a', name: 'Slipped source', assetId: audio ? null : 'sourceA',
            type: audio ? 'audio' : 'video', trackId: audio ? 'audio' : 'visual-a', url: audio ? null : urls.sourceA,
            startTime: 2, duration: 3, trimStart: 1, trimEnd: 4, ...clip },
          { ...base, id: 'visual-b', name: 'Untouched neighbor', assetId: 'sourceB', url: urls.sourceB,
            startTime: 6, duration: 2, trimStart: 0, trimEnd: 2 },
          { id: 'unrelated', name: 'Untouched layer', type: 'shape', trackId: 'visual-b', startTime: 9, duration: 2,
            trimStart: 0, trimEnd: 2 }],
          selectedClipIds: selected, timelineFps: 10, zoom, playheadPosition: 1.3,
          timelineSessionId: (s.timelineSessionId || 0) + 1, duration: 30, snappingEnabled: false,
          history: [], historyIndex: -1, isPlaying: false, transitions: [],
          markers: [{ id: 'marker', name: 'Untouched', time: 11 }], inPoint: 1, outPoint: 12 }))
        t.markProjectClean()
      }, { clip, selected, audio, zoom, urls })
      await page.locator('[aria-label="Timeline edit tools"] button[title*="(Y)"]').click()
      await preview.waitFor({ state: 'hidden' })
    }
    const pressBody = async () => {
      const clip = page.locator('[data-clip-id="visual-a"]').first()
      await clip.scrollIntoViewIfNeeded()
      const box = await clip.boundingBox(); assert.ok(box, 'actual timeline clip body exists')
      gesture = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.78 }
      await page.mouse.move(gesture.x, gesture.y); await page.mouse.down()
    }
    const start = async () => {
      await pressBody(); await preview.waitFor()
      assert.equal(await preview.evaluate(el => getComputedStyle(el).pointerEvents), 'none')
    }
    const move = delta => page.mouse.move(gesture.x + delta * (testZoom / 5), gesture.y)
    const release = async () => { await page.mouse.up(); await preview.waitFor({ state: 'hidden' }) }
    const waitTrim = trimStart => page.waitForFunction(trimStart => {
      const clip = window.multiClipInspectorTest.timeline.getState().clips.find(c => c.id === 'visual-a')
      return Math.abs(clip.trimStart - trimStart) < 1e-6
    }, trimStart, { polling: 100 })
    const readyFrame = async (side, sourceTime, reference = media.sourceA, mode = 'original', frameTime = sourceTime) => {
      try {
        await page.waitForFunction(({ side, sourceTime, frameTime }) => {
          const el = document.querySelector('[data-testid="slip-edit-' + side + '-canvas"]')
          return el?.dataset.state === 'ready' && Math.abs(Number(el.dataset.sourceTime) - sourceTime) < 1e-4
            && Math.abs(Number(el.dataset.frameTime) - frameTime) < 1e-4
        }, { side, sourceTime, frameTime }, { polling: 100 })
      } catch (error) {
        console.error('Slip frame diagnostic:', JSON.stringify({ side, sourceTime, frameTime, state: await state(),
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
        side + ' decoded frame ' + frame + ': expected ' + reference.pixels[frame] + ', actual ' + got.pixel))
      if (got.presentedTime !== '') assert.equal(Math.floor((Number(got.presentedTime) + 1e-6) * reference.fps), frame, side + ' presented frame')
      return got
    }
    const pair = async (first, last) => [await readyFrame('first', first), await readyFrame('last', last)]
    const framesForCurrent = async () => {
      const clip = target(await state())
      return pair(guardedSourceAt(clip, clip.startTime), guardedSourceAt(clip, clip.startTime + clip.duration - 1 / FPS))
    }
    const fixed = (after, before) => {
      near(after.playhead, before.playhead, 'fixed timeline playhead'); near(after.duration, before.duration, 'sequence extent')
      near(target(after).startTime, target(before).startTime, 'fixed clip placement')
      near(target(after).duration, target(before).duration, 'fixed clip duration')
      assert.deepEqual(after.clips.filter(c => c.id !== 'visual-a'), before.clips.filter(c => c.id !== 'visual-a'))
      assert.deepEqual(after.tracks, before.tracks); assert.deepEqual(after.markers, before.markers)
      assert.equal(after.inPoint, before.inPoint); assert.equal(after.outPoint, before.outPoint)
    }
    const undo = () => page.evaluate(() => window.multiClipInspectorTest.timeline.getState().undo())

    // 1. Click-only feedback is read-only, and two decoders hold separate times.
    await seed(); const idle = await state(); await start(); const initial = await pair(1, 3.9)
    assert.notDeepEqual(initial[0].pixel, initial[1].pixel)
    const privateVideos = await preview.locator('video').evaluateAll(videos => videos.map(v => ({ muted: v.muted, volume: v.volume, paused: v.paused })))
    assert.equal(privateVideos.length, 2)
    privateVideos.forEach(v => { assert.equal(v.muted, true); assert.equal(v.volume, 0); assert.equal(v.paused, true) })
    assert.match(await page.getByTestId('slip-edit-delta').innerText(), /0\s*f/i)
    assert.deepEqual(await state(), idle); await release(); assert.deepEqual(await state(), idle)
    console.log('PASS 1: first/last independent muted decoded viewers add no document, history or dirty writes')

    // 2. Both directions and half-frame tie policy shift only the source window.
    for (const delta of [0.4, -0.6]) {
      await seed(); const before = await state(); await start(); await move(delta); await waitTrim(1 + delta)
      await pair(1 + delta, 3.9 + delta); const after = await state(); fixed(after, before)
      near(target(after).trimEnd, 4 + delta, 'source Out moves with In'); assert.equal(after.history, 1)
      assert.match(await page.getByTestId('slip-edit-delta').innerText(), delta > 0 ? /\+4\s*f/i : /[−-]6\s*f/i)
      if (delta > 0 && process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT.replace(/\.png$/, '-wide.png') })
      await release(); await undo(); assert.deepEqual((await state()).clips, before.clips)
    }
    for (const [requested, accepted] of [[0.05, 0.1], [-0.05, 0]]) {
      await seed({ zoom: 500 }); const before = await state(); await start(); await move(requested); await waitTrim(1 + accepted)
      await pair(1 + accepted, 3.9 + accepted); fixed(await state(), before)
      assert.equal((await state()).history, accepted === 0 ? 0 : 1)
      if (accepted === 0) assert.equal((await state()).dirty, false)
      await release(); await undo(); assert.deepEqual((await state()).clips, before.clips)
    }
    console.log('PASS 2: source-only shifts, signed offset and common frame rounding preserve placement, neighbors and one Undo')

    // 3. Rapid same-source seeks never advertise stale pixels on either canvas.
    await seed(); await start(); await pair(1, 3.9)
    await page.evaluate(pixels => {
      window.slipReadyObservations = { count: 0, failures: [] }
      window.slipReadyObservers = ['first', 'last'].map(side => {
        const canvas = document.querySelector('[data-testid="slip-edit-' + side + '-canvas"]')
        const observer = new MutationObserver(() => {
          if (canvas.dataset.state !== 'ready') return
          const frame = Math.floor((Number(canvas.dataset.frameTime) + 1e-8) * 10)
          const actual = [...canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data]
          window.slipReadyObservations.count++
          if (!pixels[frame] || pixels[frame].some((value, index) => Math.abs(value - actual[index]) > 5))
            window.slipReadyObservations.failures.push({ side, frame, actual })
        })
        observer.observe(canvas, { attributes: true }); return observer
      })
    }, media.sourceA.pixels)
    await page.evaluate(({ x, y }) => {
      for (const delta of [0.5, -0.2, 0.8, 0.1, 0.7])
        window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + delta * 50, clientY: y, buttons: 1 }))
    }, gesture)
    await waitTrim(1.7); await pair(1.7, 4.6)
    const observed = await page.evaluate(() => { window.slipReadyObservers.forEach(o => o.disconnect()); return window.slipReadyObservations })
    assert.ok(observed.count > 0); assert.deepEqual(observed.failures, []); assert.equal((await state()).history, 1)
    await release()
    console.log('PASS 3: coalesced first/last source seeks present only independently verified decoded frames')

    // 4. Reverse and constant speeds use actual playback frames, including the
    // existing exclusive source-Out guard on the first reversed sample.
    for (const clip of [
      { reverse: true }, { speed: 0.5, trimEnd: 2.5 }, { speed: 2, trimEnd: 7 },
      { speed: 0.5, trimEnd: 2.5, reverse: true }, { speed: 2, trimEnd: 7, reverse: true },
    ]) {
      for (const delta of [-0.4, 0.4]) {
        await seed({ clip }); const before = await state(); await start(); await move(delta)
        await waitTrim(1 + delta * (clip.speed ?? 1))
        const after = await state(); fixed(after, before)
        const rate = target(before).speed * target(before).sourceTimeScale
        for (const time of [2, 2.1, 3.5, 4.9]) {
          near(rawSourceAt(target(after), time) - rawSourceAt(target(before), time), delta * rate, 'raw source translation')
          near(guardedSourceAt(target(after), time) - guardedSourceAt(target(before), time), delta * rate, 'guarded source translation')
        }
        await framesForCurrent(); await release(); await undo(); assert.deepEqual((await state()).clips, before.clips)
      }
    }
    const cache = { version: 'rife_ncnn_vulkan_v46_uhd_v1', engine: 'rife-ncnn-vulkan', modelName: 'rife-v4.6',
      status: 'ready', path: 'cache/synthetic-slip.mp4', url: urls.cached, sourceStart: 1, sourceEnd: 8,
      targetFps: 20, requestedTargetFps: 20 }
    for (const valid of [true, false]) {
      await seed({ clip: { speed: 0.5, trimStart: 2, trimEnd: 3.5, frameSampling: 'optical-flow',
        opticalFlowCache: { ...cache, status: valid ? 'ready' : 'invalid' } } })
      await start(); await move(0.4); await waitTrim(2.2)
      if (valid) {
        await readyFrame('first', 2.2, media.cached, 'optical-flow', 1.2)
        await readyFrame('last', 3.65, media.cached, 'optical-flow', 2.65)
      } else await pair(2.2, 3.65)
      await release()
    }
    console.log('PASS 4: reverse/0.5x/2x clocks and nonzero-origin verified RIFE or original fallback show exact source frames')

    // 5. Both media ends round inward; a limit is labelled only once the
    // pointer attempts to cross the physical source bound, not ordinary rounding.
    for (const [delta, accepted, label] of [[-5, -1, /source start/i], [9, 4, /source end/i]]) {
      await seed(); const before = await state(); await start(); await move(delta); await waitTrim(1 + accepted)
      await pair(1 + accepted, 3.9 + accepted); fixed(await state(), before)
      assert.match(await page.getByTestId('slip-edit-limit').innerText(), label); await release()
    }
    for (const test of [
      { natural: -0.22, beyond: -0.4, accepted: -0.2, label: /source start/i },
      { natural: 4.72, beyond: 5, accepted: 4.7, label: /source end/i },
    ]) {
      await seed({ clip: { trimStart: 0.26, trimEnd: 3.26 } }); const before = await state(); await start()
      await move(test.natural); await waitTrim(0.26 + test.accepted); await pair(0.26 + test.accepted, 3.16 + test.accepted)
      assert.equal(await page.getByTestId('slip-edit-limit').count(), 0)
      const natural = await state(); await move(test.beyond); await page.getByTestId('slip-edit-limit').waitFor()
      assert.match(await page.getByTestId('slip-edit-limit').innerText(), test.label)
      assert.deepEqual((await state()).clips, natural.clips); assert.equal((await state()).history, 1)
      fixed(await state(), before); await release(); await undo(); assert.deepEqual((await state()).clips, before.clips)
    }
    console.log('PASS 5: source limits, fractional floor/ceil and offset labels are truthful without changing the clip span')

    // 6. One store publication per effective source shift; same delta is no-op.
    await seed(); const atomicBefore = await state()
    await page.evaluate(() => {
      const t = window.multiClipInspectorTest; window.slipAtomicEvents = []
      window.slipAtomicUnsubscribe = t.timeline.subscribe((state, previous) => {
        const clip = state.clips.find(c => c.id === 'visual-a')
        window.slipAtomicEvents.push({ ids: state.clips.filter(c => c !== previous.clips.find(old => old.id === c.id)).map(c => c.id),
          start: clip.startTime, duration: clip.duration, trimStart: clip.trimStart, trimEnd: clip.trimEnd, history: state.history.length })
      })
    })
    await start(); assert.deepEqual(await page.evaluate(() => window.slipAtomicEvents), [])
    for (const [index, delta] of [0.4, 0.7, -0.2, 0.4].entries()) {
      await move(delta); await waitTrim(1 + delta)
      const events = await page.evaluate(() => window.slipAtomicEvents)
      assert.equal(events.length, index + 1); const event = events.at(-1)
      assert.deepEqual(event.ids, ['visual-a']); near(event.start, 2, 'atomic placement'); near(event.duration, 3, 'atomic duration')
      near(event.trimEnd - event.trimStart, 3, 'atomic source span'); assert.equal(event.history, 1)
    }
    await page.evaluate(({ x, y }) => window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + 20, clientY: y, buttons: 1 })), gesture)
    assert.equal((await page.evaluate(() => window.slipAtomicEvents)).length, 4)
    const atomicAfter = await state(); await release(); await page.evaluate(() => window.slipAtomicUnsubscribe())
    await undo(); assert.deepEqual((await state()).clips, atomicBefore.clips)
    await page.evaluate(() => window.multiClipInspectorTest.timeline.getState().redo()); assert.deepEqual((await state()).clips, atomicAfter.clips)
    await seed(); const origin = await state(); await start(); await move(0.4); await waitTrim(1.4); await move(0); await waitTrim(1); await release()
    assert.deepEqual((await state()).clips, origin.clips); assert.equal((await state()).history, 0)
    console.log('PASS 6: source bounds and first history checkpoint publish atomically, no drift/repeat writes, one Undo/Redo')

    // 7. Slipping does not offset local animation/envelope attributes; the saved
    // synthetic document reloads with the same source window and editor data.
    const attributes = { transform: { positionX: 12, positionY: -4, scaleX: 90, scaleY: 90, rotation: 5, opacity: 80 },
      keyframes: { opacity: [{ time: 0, value: 50 }, { time: 2, value: 100 }] },
      effects: [{ id: 'synthetic-brightness', effectId: 'brightness', enabled: false, params: { amount: 0.2 } }],
      gainDb: -3, fadeIn: 0.2, fadeOut: 0.3,
      audioEq: { version: 1, enabled: true, lowCut: true, bassDb: 3, midDb: -2, trebleDb: 1 },
      volumeEnvelope: { version: 1, offsetSeconds: 0.25, points: [{ id: 'g0', time: 0, db: -6 }, { id: 'g1', time: 2, db: 3 }] } }
    await seed({ clip: attributes }); const attributeBefore = await state(); await start(); await move(0.4); await waitTrim(1.4)
    await pair(1.4, 4.3); const attributeAfter = await state(); fixed(attributeAfter, attributeBefore)
    for (const key of Object.keys(attributes)) assert.deepEqual(target(attributeAfter)[key], attributes[key], key + ' is not offset')
    await release()
    const reopened = await page.evaluate(() => {
      const t = window.multiClipInspectorTest, s = t.timeline.getState()
      const document = JSON.parse(JSON.stringify(s.getProjectData()))
      s.loadFromProject(document, t.assets.getState().assets, 10)
      return JSON.parse(JSON.stringify(t.timeline.getState().clips.find(c => c.id === 'visual-a')))
    })
    near(reopened.startTime, 2, 'reload placement'); near(reopened.duration, 3, 'reload duration')
    near(reopened.trimStart, 1.4, 'reload In'); near(reopened.trimEnd, 4.4, 'reload Out')
    for (const key of Object.keys(attributes)) assert.deepEqual(reopened[key], attributes[key], 'reload ' + key)
    await page.evaluate(() => window.multiClipInspectorTest.timeline.setState({ selectedClipIds: ['visual-a'] }))
    await start(); await pair(1.4, 4.3); await release()
    console.log('PASS 7: effects/keyframes/gain/fades/EQ/envelope retain coordinates and source frames survive JSON save/reopen')

    // 8. Bad/unsupported clocks and stale sessions are read-only refusals;
    // rejected actual Slip body drags must never become ordinary clip moves.
    for (const kind of ['ramp', 'invalid-span', 'unknown-duration', 'nonunit-clock', 'locked', 'track-sync', 'linked', 'playing', 'image']) {
      await seed()
      const verdict = await page.evaluate(kind => {
        const t = window.multiClipInspectorTest, s = t.timeline.getState()
        t.timeline.setState({ clips: s.clips.map(c => {
          if (kind === 'linked' && ['visual-a', 'visual-b'].includes(c.id)) return { ...c, linkGroupId: 'synthetic-link' }
          if (c.id !== 'visual-a') return c
          if (kind === 'ramp') return { ...c, keyframes: { speed: [{ time: 0, value: 1 }, { time: 3, value: 2 }] } }
          if (kind === 'invalid-span') return { ...c, trimEnd: 1.1 }
          if (kind === 'unknown-duration') return { ...c, sourceDuration: null }
          if (kind === 'nonunit-clock') return { ...c, sourceTimeScale: 2, trimEnd: 7 }
          if (kind === 'locked') return { ...c, locked: true }
          if (kind === 'image') return { ...c, type: 'image' }
          return c
        }), ...(kind === 'track-sync' ? { tracks: s.tracks.map(t => t.id === 'visual-a' ? { ...t, lockMode: 'sync' } : t) } : {}),
        ...(kind === 'playing' ? { isPlaying: true } : {}) })
        t.markProjectClean(); const before = t.timeline.getState(); let emissions = 0
        const off = t.timeline.subscribe(() => emissions++), result = before.beginSlipEdit({ clipId: 'visual-a' })
        off(); return { result, emissions, same: before === t.timeline.getState(), history: t.timeline.getState().history.length, dirty: t.isProjectDirty() }
      }, kind)
      assert.equal(verdict.result.ok, false, kind + ': ' + JSON.stringify(verdict.result)); assert.ok(verdict.result.reason)
      assert.equal(verdict.emissions, 0); assert.equal(verdict.same, true); assert.equal(verdict.history, 0); assert.equal(verdict.dirty, false)
    }
    for (const clip of [
      { type: 'image', assetId: 'image', url: urls.image, sourceDuration: null },
      { sourceDuration: null },
      { keyframes: { speed: [{ time: 0, value: 1 }, { time: 3, value: 2 }] } },
    ]) {
      await seed({ clip }); const before = await state(); await pressBody(); await page.getByTestId('slip-edit-refusal').waitFor()
      await move(0.8); await page.mouse.up(); await preview.waitFor({ state: 'hidden' })
      assert.deepEqual((await state()).clips, before.clips); assert.equal((await state()).history, 0); assert.equal((await state()).dirty, false)
      if (clip.keyframes && process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT.replace(/\.png$/, '-refusal.png') })
    }
    for (const kind of ['clip-lock', 'track-lock', 'track-sync', 'linked']) {
      await seed()
      await page.evaluate(kind => {
        const t = window.multiClipInspectorTest, s = t.timeline.getState()
        if (kind === 'clip-lock') t.timeline.setState({ clips: s.clips.map(c => c.id === 'visual-a' ? { ...c, locked: true } : c) })
        if (kind === 'track-lock' || kind === 'track-sync') t.timeline.setState({ tracks: s.tracks.map(track => track.id === 'visual-a'
          ? { ...track, ...(kind === 'track-lock' ? { locked: true } : { lockMode: 'sync' }) } : track) })
        if (kind === 'linked') t.timeline.setState({ clips: s.clips.map(c => ['visual-a', 'visual-b'].includes(c.id) ? { ...c, linkGroupId: 'test-linked' } : c) })
        t.markProjectClean()
      }, kind)
      const before = await state(); await pressBody(); await page.getByTestId('slip-edit-refusal').waitFor()
      await move(0.8); await page.mouse.up(); await preview.waitFor({ state: 'hidden' })
      assert.deepEqual((await state()).clips, before.clips, kind + ' actual body drag refuses')
      assert.equal((await state()).history, 0); assert.equal((await state()).dirty, false)
    }
    // An existing unrelated multi-selection does not turn a body slip into a
    // batch action: only the clicked instance may change, never its neighbors.
    await seed({ selected: ['visual-a', 'visual-b'] }); const multiBefore = await state()
    await start(); await move(0.4); await waitTrim(1.4); fixed(await state(), multiBefore)
    assert.deepEqual((await state()).selected, multiBefore.selected); await pair(1.4, 4.3); await release()
    await undo(); assert.deepEqual((await state()).clips, multiBefore.clips)
    await seed()
    const stale = await page.evaluate(() => {
      const t = window.multiClipInspectorTest, begun = t.timeline.getState().beginSlipEdit({ clipId: 'visual-a' })
      if (!begun.ok) throw new Error(begun.reason)
      t.timeline.setState({ selectedClipIds: ['visual-b'] }); t.markProjectClean(); const before = t.timeline.getState(); let count = 0
      const off = t.timeline.subscribe(() => count++), result = t.timeline.getState().applySlipEdit(begun.token, 0.4)
      off(); return { result, count, same: before === t.timeline.getState(), dirty: t.isProjectDirty() }
    })
    assert.equal(stale.result.ok, false); assert.equal(stale.count, 0); assert.equal(stale.same, true); assert.equal(stale.dirty, false)
    console.log('PASS 8: unsupported/malformed/locked/stale Slip refuses cleanly and never falls through to moving a clip')

    // 9. Missing sources clear both old images; audio honestly shows timing only.
    await seed(); await start(); await pair(1, 3.9)
    const independentView = await state()
    await page.evaluate(() => {
      const assets = window.multiClipInspectorTest.assets
      assets.setState({ previewMode: 'source', currentPreview: assets.getState().assets[0] })
    })
    await preview.waitFor(); await pair(1, 3.9); assert.deepEqual(await state(), independentView)
    await page.evaluate(() => window.multiClipInspectorTest.assets.setState({ previewMode: 'timeline', currentPreview: null }))
    assert.deepEqual(await state(), independentView)
    await page.evaluate(url => window.multiClipInspectorTest.assets.setState(s => ({ assets: s.assets.map(a => a.id === 'sourceA' ? { ...a, url } : a) })), urls.broken)
    for (const side of ['first', 'last']) {
      await page.waitForFunction(side => document.querySelector('[data-testid="slip-edit-' + side + '-canvas"]')?.dataset.state === 'unavailable', side, { polling: 100 })
      const blank = await canvases[side].evaluate(el => ({ source: el.dataset.sourceTime,
        blank: [...el.getContext('2d').getImageData(0, 0, el.width, el.height).data].every(value => value === 0) }))
      assert.equal(blank.source, ''); assert.equal(blank.blank, true)
    }
    await page.evaluate(url => window.multiClipInspectorTest.assets.setState(s => ({ assets: s.assets.map(a => a.id === 'sourceA' ? { ...a, url } : a) })), urls.sourceA)
    await pair(1, 3.9); await release()
    await seed({ audio: true }); const audioBefore = await state(); await start(); await move(0.2); await waitTrim(1.2)
    for (const canvas of Object.values(canvases)) {
      assert.equal(await canvas.getAttribute('data-state'), 'timing-only')
      assert.equal(await canvas.evaluate(el => [...el.getContext('2d').getImageData(0, 0, el.width, el.height).data].every(v => v === 0)), true)
    }
    fixed(await state(), audioBefore); await release()
    console.log('PASS 9: source-preview mode is independent, failed media clears old pixels, and audio feedback stays silent/timing-only')

    // 10. End/cancel/stale routes discard the viewer/session, retaining the last
    // accepted edit; any later mouse motion must have no surviving write path.
    for (const mutation of ['Escape', 'blur', 'pointercancel', 'tool', 'selection', 'lock', 'load', 'remove', 'history', 'playing']) {
      await seed(); await start(); await move(0.2); await waitTrim(1.2)
      if (mutation === 'Escape') await page.keyboard.press('Escape')
      else if (mutation === 'tool') await page.keyboard.press('v')
      else await page.evaluate(mutation => {
        const t = window.multiClipInspectorTest, s = t.timeline.getState()
        if (mutation === 'blur') window.dispatchEvent(new Event('blur'))
        if (mutation === 'pointercancel') window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))
        if (mutation === 'selection') t.timeline.setState({ selectedClipIds: ['visual-b'] })
        if (mutation === 'lock') t.timeline.setState({ tracks: s.tracks.map(track => track.id === 'visual-a' ? { ...track, locked: true } : track) })
        if (mutation === 'load') s.loadFromProject(JSON.parse(JSON.stringify(s.getProjectData())), t.assets.getState().assets, 10)
        if (mutation === 'remove') t.timeline.setState({ clips: s.clips.filter(c => c.id !== 'visual-a') })
        if (mutation === 'history') s.saveToHistory()
        if (mutation === 'playing') t.timeline.setState({ isPlaying: true })
      }, mutation)
      try { await preview.waitFor({ state: 'hidden' }) } catch (error) {
        console.error('Slip cleanup did not finish:', mutation); throw error
      }
      if (mutation === 'playing') await page.evaluate(() => window.multiClipInspectorTest.timeline.setState({ isPlaying: false }))
      const ended = await state(); await move(0.8); await page.mouse.up()
      assert.deepEqual((await state()).clips, ended.clips, mutation + ' prevents stale writes'); assert.equal((await state()).history, ended.history)
    }
    await seed(); await start(); await move(0.2); await waitTrim(1.2)
    await page.evaluate(() => window.multiClipInspectorTest.setTimelineVisible(false)); await preview.waitFor({ state: 'hidden' })
    const unmounted = await state(); await move(0.8); await page.mouse.up(); assert.deepEqual((await state()).clips, unmounted.clips)
    await page.evaluate(() => window.multiClipInspectorTest.setTimelineVisible(true))
    console.log('PASS 10: Escape/blur/cancel/tool/selection/lock/load/removal/history/playback/unmount clean up the viewer and writes')

    // 11. Two source frames stay visible in real narrow desktop window sizes.
    await seed(); await start(); await move(0.4); await waitTrim(1.4); await pair(1.4, 4.3)
    for (const width of [600, 350]) {
      if (native) await browser.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 850), width)
      else await page.setViewportSize({ width, height: 850 })
      await page.waitForFunction(width => {
        const box = document.querySelector('[data-testid="slip-edit-preview"]')?.getBoundingClientRect()
        return window.innerWidth === width && window.innerHeight === 850 && box?.right <= width + 1 && box?.bottom <= 851
      }, width, { polling: 100 })
      const geometry = await preview.evaluate(el => {
        const box = el.getBoundingClientRect()
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: el.clientWidth, scroll: el.scrollWidth,
          canvases: [...el.querySelectorAll('canvas')].map(c => { const r = c.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height } }) }
      })
      assert.ok(geometry.left >= 0 && geometry.right <= width + 1 && geometry.top >= 0 && geometry.bottom <= 851, JSON.stringify(geometry))
      assert.ok(geometry.scroll <= geometry.width + 1); assert.equal(geometry.canvases.length, 2)
      geometry.canvases.forEach(c => assert.ok(c.left >= 0 && c.right <= width + 1 && c.width > 60 && c.height > 30))
      assert.equal(await preview.evaluate(el => getComputedStyle(el).pointerEvents), 'none')
    }
    if (process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT })
    await release(); assert.deepEqual(errors, [])
    console.log('PASS: all 11 Slip-tool reliability/preview groups; no renderer exceptions (' + (native ? 'isolated installed Electron' : 'Chrome') + ').')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
