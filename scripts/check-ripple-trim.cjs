// Actual ripple edge gestures, decoded source feedback, and atomic linked-track edits. All
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
      && typeof window.multiClipInspectorTest.timeline.getState().beginRippleTrim === 'function', null, { polling: 100 })
    const urls = await page.evaluate(async media => {
      const t = window.multiClipInspectorTest
      t.project.setState({ currentProject: { name: 'Synthetic ripple trim verification', settings: { fps: 10, width: 960, height: 540 }, timelines: [] },
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
    const preview = page.getByTestId('ripple-trim-preview')
    const canvas = page.getByTestId('ripple-trim-canvas')
    const normalPreview = page.getByTestId('trim-edge-preview')
    const state = () => page.evaluate(() => {
      const t = window.multiClipInspectorTest, s = t.timeline.getState()
      return JSON.parse(JSON.stringify({ clips: s.clips, tracks: s.tracks, transitions: s.transitions,
        selected: s.selectedClipIds, duration: s.duration, markers: s.markers, inPoint: s.inPoint, outPoint: s.outPoint,
        history: s.history.length, historyIndex: s.historyIndex, playhead: s.playheadPosition,
        dirty: t.isProjectDirty(), playing: s.isPlaying, ripple: s.rippleEditMode }))
    })
    const byId = (s, id = 'visual-a') => s.clips.find(c => c.id === id)
    const progress = label => { if (native) console.log('CHECK ' + label) }
    let gesture, testZoom = 250
    const seed = async ({ patches = {}, linked = false, selected = ['visual-a'], extras = [], extraTracks = [],
      transitions = [], ripple = true, snapping = false, zoom = 250 } = {}) => {
      testZoom = zoom
      await page.mouse.up(); await page.keyboard.press('Escape')
      await page.evaluate(({ patches, linked, selected, extras, extraTracks, transitions, ripple, snapping, zoom, urls }) => {
        const t = window.multiClipInspectorTest; t.reset()
        t.assets.setState({ assets: [
          { id: 'sourceA', type: 'video', name: 'Target encoded frames', url: urls.sourceA, duration: 8, fps: 10,
            hasAudio: false, settings: { fps: 10, width: 96, height: 54 } },
          { id: 'sourceB', type: 'video', name: 'Follower encoded frames', url: urls.sourceB, duration: 8, fps: 10,
            hasAudio: false, settings: { fps: 10, width: 96, height: 54 } },
          { id: 'image', type: 'image', name: 'Synthetic still', url: urls.image }],
          previewMode: 'timeline', currentPreview: null, isPlaying: false, volume: 0 })
        const media = { type: 'video', trackId: 'visual-a', sourceDuration: 8, sourceFps: 10, timelineFps: 10,
          sourceTimeScale: 1, speed: 1, reverse: false, frameSampling: 'frame', effects: [], keyframes: {},
          transform: { positionX: 0, positionY: 0, scaleX: 100, scaleY: 100, rotation: 0, opacity: 100 } }
        const audio = { ...media, type: 'audio', trackId: 'audio', assetId: null, url: null }
        const clips = [
          { ...media, id: 'visual-a', name: 'Target picture', assetId: 'sourceA', url: urls.sourceA,
            startTime: 2, duration: 3, trimStart: 1, trimEnd: 4, ...(linked ? { linkGroupId: 'target-link' } : {}) },
          { ...audio, id: 'audio-a', name: 'Target dialog', startTime: 2, duration: 3, trimStart: 1, trimEnd: 4,
            ...(linked ? { linkGroupId: 'target-link' } : {}) },
          { ...media, id: 'visual-b', name: 'Picture follower', assetId: 'sourceB', url: urls.sourceB,
            startTime: 6, duration: 2, trimStart: 0, trimEnd: 2 },
          { ...audio, id: 'audio-b', name: 'Dialog follower', startTime: 6, duration: 2, trimStart: 0, trimEnd: 2 },
          { ...media, id: 'late', name: 'Late picture', assetId: 'sourceB', url: urls.sourceB,
            startTime: 10, duration: 1, trimStart: 0, trimEnd: 1 },
          { ...media, id: 'upstream', name: 'Earlier picture', assetId: 'sourceB', url: urls.sourceB,
            startTime: 0, duration: 1, trimStart: 0, trimEnd: 1 },
          { id: 'overlay', name: 'Independent overlay', type: 'shape', trackId: 'visual-b',
            startTime: 3, duration: 8, trimStart: 0, trimEnd: 8 },
          { ...audio, id: 'music-bed', name: 'Independent music', trackId: 'music',
            startTime: 0, duration: 20, trimStart: 0, trimEnd: 20, sourceDuration: 30 },
        ].map(clip => ({ ...clip, ...(patches[clip.id] || {}) }))
        t.timeline.setState(s => ({ clips: [...clips, ...extras], tracks: [
          { id: 'visual-a', name: 'Picture', type: 'video', visible: true, locked: false, order: 0 },
          { id: 'visual-b', name: 'Overlay', type: 'video', visible: true, locked: false, order: 1 },
          { id: 'audio', name: 'Dialog', type: 'audio', volume: 1, muted: false, order: 2 },
          { id: 'music', name: 'Music', type: 'audio', volume: 1, muted: false, locked: true, order: 3 },
          ...extraTracks ],
          selectedClipIds: selected, timelineFps: 10, zoom, playheadPosition: 1.3,
          timelineSessionId: (s.timelineSessionId || 0) + 1, duration: 30,
          snappingEnabled: snapping, history: [], historyIndex: -1, isPlaying: false, transitions,
          markers: [{ id: 'marker', name: 'Unaffected marker', time: 11 }], inPoint: 1, outPoint: 12,
          rippleEditMode: ripple }))
        t.markProjectClean()
      }, { patches, linked, selected, extras, extraTracks, transitions, ripple, snapping, zoom, urls })
      await page.locator('[aria-label="Timeline edit tools"] button[title*="(T)"]').click()
      await preview.waitFor({ state: 'hidden' }); await normalPreview.waitFor({ state: 'hidden' })
    }
    const pressEdge = async (edge = 'right', id = 'visual-a') => {
      const handle = page.locator('[data-clip-id="' + id + '"]').first().locator('[data-trim-handle]').nth(edge === 'left' ? 0 : 1)
      await handle.scrollIntoViewIfNeeded()
      const box = await handle.boundingBox(); assert.ok(box, 'actual timeline edge handle exists')
      gesture = { x: box.x + box.width / 2, y: box.y + box.height * 0.78 }
      await page.mouse.move(gesture.x, gesture.y); await page.mouse.down()
    }
    const start = async (edge = 'right', id = 'visual-a') => {
      await pressEdge(edge, id); await preview.waitFor()
      assert.equal(await preview.getAttribute('data-clip-id'), id); assert.equal(await preview.getAttribute('data-edge'), edge)
      assert.equal(await preview.evaluate(el => getComputedStyle(el).pointerEvents), 'none')
    }
    const move = delta => page.mouse.move(gesture.x + delta * (testZoom / 5), gesture.y)
    const release = async () => { await page.mouse.up(); await preview.waitFor({ state: 'hidden' }) }
    const waitClip = (id, key, value) => page.waitForFunction(({ id, key, value }) => {
      const clip = window.multiClipInspectorTest.timeline.getState().clips.find(c => c.id === id)
      return Math.abs(clip?.[key] - value) < 1e-6
    }, { id, key, value }, { polling: 100 })
    const readyFrame = async (sourceTime, reference = media.sourceA, mode = 'original', frameTime = sourceTime) => {
      try {
        await page.waitForFunction(({ sourceTime, frameTime }) => {
          const el = document.querySelector('[data-testid="ripple-trim-canvas"]')
          return el?.dataset.state === 'ready' && Math.abs(Number(el.dataset.sourceTime) - sourceTime) < 1e-4
            && Math.abs(Number(el.dataset.frameTime) - frameTime) < 1e-4
        }, { sourceTime, frameTime }, { polling: 100 })
      } catch (error) {
        console.error('Ripple frame diagnostic:', JSON.stringify({ sourceTime, frameTime, state: await state(),
          preview: await preview.count() ? await preview.evaluate(el => ({ text: el.innerText,
            canvas: { ...el.querySelector('canvas')?.dataset },
            videos: [...el.querySelectorAll('video')].map(v => ({ time: v.currentTime, ready: v.readyState, seeking: v.seeking })) })) : null }))
        throw error
      }
      const got = await canvas.evaluate(el => ({ ...el.dataset,
        pixel: [...el.getContext('2d').getImageData(el.width / 2, el.height / 2, 1, 1).data] }))
      assert.equal(got.sourceMode, mode)
      const frame = Math.max(0, Math.min(reference.frames - 1, Math.floor((frameTime + 1e-8) * reference.fps)))
      reference.pixels[frame].forEach((value, index) => assert.ok(Math.abs(value - got.pixel[index]) <= 5,
        'decoded frame ' + frame + ': expected ' + reference.pixels[frame] + ', actual ' + got.pixel))
      if (got.presentedTime !== '') assert.equal(Math.floor((Number(got.presentedTime) + 1e-6) * reference.fps), frame, 'presented source frame')
      return got
    }
    const currentFrame = async (edge, id = 'visual-a', reference = media.sourceA) => {
      const clip = byId(await state(), id), time = edge === 'left' ? clip.startTime : clip.startTime + clip.duration - 1 / FPS
      return readyFrame(guardedSourceAt(clip, time), reference)
    }
    const unchangedContext = (after, before) => {
      near(after.playhead, before.playhead, 'fixed playhead'); near(after.duration, before.duration, 'viewport extent')
      assert.deepEqual(after.tracks, before.tracks); assert.deepEqual(after.markers, before.markers)
      assert.equal(after.inPoint, before.inPoint); assert.equal(after.outPoint, before.outPoint)
      for (const id of ['upstream', 'overlay', 'music-bed']) assert.deepEqual(byId(after, id), byId(before, id), id + ' unchanged')
    }
    const assertPlan = (after, before, durationDelta, linked = false) => {
      unchangedContext(after, before)
      for (const id of linked ? ['visual-a', 'audio-a'] : ['visual-a']) {
        near(byId(after, id).startTime, byId(before, id).startTime, 'fixed target start ' + id)
        near(byId(after, id).duration, byId(before, id).duration + durationDelta, 'target duration ' + id)
      }
      for (const id of linked ? ['visual-b', 'audio-b', 'late'] : ['visual-b', 'late']) {
        const expected = { ...byId(before, id), startTime: byId(before, id).startTime + durationDelta }
        assert.deepEqual(byId(after, id), expected, 'only follower position moves: ' + id)
      }
      if (!linked) for (const id of ['audio-a', 'audio-b']) assert.deepEqual(byId(after, id), byId(before, id), 'unrelated Dialog remains fixed')
      near(byId(after, 'visual-b').startTime - (byId(after).startTime + byId(after).duration), 1, 'original target-follower gap')
      near(byId(after, 'late').startTime - (byId(after, 'visual-b').startTime + byId(after, 'visual-b').duration), 2, 'original follower gap')
    }
    const undo = () => page.evaluate(() => window.multiClipInspectorTest.timeline.getState().undo())

    // 1. Actual Ripple toggle and a no-movement edge viewer add no checkpoint.
    await seed({ ripple: false }); await page.keyboard.press('r')
    await page.waitForFunction(() => window.multiClipInspectorTest.timeline.getState().rippleEditMode === true, null, { polling: 100 })
    await page.evaluate(() => window.multiClipInspectorTest.markProjectClean())
    const idle = await state(); await start(); await readyFrame(3.9)
    assert.deepEqual(await state(), idle); assert.match(await page.getByTestId('ripple-trim-tracks').innerText(), /Picture/)
    assert.doesNotMatch(await page.getByTestId('ripple-trim-tracks').innerText(), /Music|Overlay|Dialog/)
    const privateVideo = await preview.locator('video').evaluate(v => ({ muted: v.muted, volume: v.volume, paused: v.paused }))
    assert.deepEqual(privateVideo, { muted: true, volume: 0, paused: true }); await release(); assert.deepEqual(await state(), idle)
    console.log('PASS 1: Ripple toggle reaches a read-only, private decoded edge viewer with explicit affected tracks')

    // 2. Head/tail, shorten/extend: fixed target start, exact frame, preserved gaps.
    for (const edge of ['left', 'right']) for (const delta of [-0.4, 0.4]) {
      progress('2 ' + edge + ' ' + delta)
      await seed(); const before = await state(); await start(edge); await move(delta)
      const durationDelta = edge === 'left' ? -delta : delta
      await waitClip('visual-a', 'duration', 3 + durationDelta); await currentFrame(edge)
      assertPlan(await state(), before, durationDelta); assert.equal((await state()).history, 1)
      assert.match(await page.getByTestId('ripple-trim-delta').innerText(), durationDelta > 0 ? /\+4\s*f/i : /[−-]4\s*f/i)
      await page.getByTestId('ripple-trim-guide').waitFor()
      near(Number(await page.getByTestId('ripple-trim-guide').getAttribute('data-guide-time')),
        (edge === 'left' ? 2 : 5) + delta, 'uncollapsed pointer guide')
      if (edge === 'left' && delta > 0 && process.env.VELORN_TEST_SCREENSHOT && !native)
        await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT.replace(/\.png$/, '-head.png') })
      await release(); await undo(); assert.deepEqual((await state()).clips, before.clips)
    }
    console.log('PASS 2: all edge/direction combinations show exact retained source frames and shift only following picture clips')

    // 3. Shared-cut outer handles stay reachable in Trim+Ripple, not Roll.
    await seed({ patches: { 'visual-b': { startTime: 5 } } }); const sharedTail = await state()
    await start('right'); await move(0.4); await waitClip('visual-a', 'duration', 3.4); await readyFrame(4.3)
    near(byId(await state(), 'visual-b').startTime, 5.4, 'shared-cut follower start')
    near(byId(await state(), 'visual-b').duration, 2, 'follower is not rolling shorter')
    assert.equal(await page.getByTestId('roll-edit-preview').count(), 0); await release(); await undo()
    assert.deepEqual((await state()).clips, sharedTail.clips)
    await seed({ patches: { 'visual-b': { startTime: 5 } } }); const sharedHead = await state()
    await start('left', 'visual-b'); await move(0.4); await waitClip('visual-b', 'duration', 1.6); await readyFrame(0.4, media.sourceB)
    near(byId(await state(), 'visual-b').startTime, 5, 'incoming head retains fixed placement')
    assert.deepEqual(byId(await state()), byId(sharedHead)); near(byId(await state(), 'late').startTime, 9.6, 'later clip shifts')
    assert.equal(await page.getByTestId('roll-edit-preview').count(), 0); await release()
    console.log('PASS 3: outgoing tail and incoming head at a shared cut invoke Ripple, never the rolling catcher')

    // 4. Aligned linked targets share a limiting source; downstream linked mates
    // outside target tracks move too, but unrelated clips on those tracks do not.
    await seed({ linked: true, patches: { 'audio-a': { sourceDuration: 4.2 } } }); const linkedBefore = await state()
    await start(); await move(1); await waitClip('visual-a', 'duration', 3.2); await readyFrame(4.1)
    assertPlan(await state(), linkedBefore, 0.2, true)
    assert.match(await page.getByTestId('ripple-trim-tracks').innerText(), /Picture/); assert.match(await page.getByTestId('ripple-trim-tracks').innerText(), /Dialog/)
    assert.match(await page.getByTestId('ripple-trim-limit').innerText(), /source/i); await release(); await undo()
    assert.deepEqual((await state()).clips, linkedBefore.clips)
    const outsideTrack = { id: 'side', name: 'Linked side', type: 'audio', volume: 1, muted: false, order: 4 }
    const outside = { id: 'outside-mate', type: 'audio', name: 'External linked mate', trackId: 'side',
      startTime: 6, duration: 2, trimStart: 0, trimEnd: 2, sourceDuration: 8, sourceTimeScale: 1, speed: 1,
      linkGroupId: 'follower-link', assetId: null, url: null }
    const sideStatic = { id: 'side-static', type: 'audio', name: 'Independent side clip', trackId: 'side',
      startTime: 9, duration: 1, trimStart: 0, trimEnd: 1, sourceDuration: 8, assetId: null, url: null }
    await seed({ patches: { 'visual-b': { linkGroupId: 'follower-link' } }, extraTracks: [outsideTrack], extras: [outside, sideStatic] })
    const externalBefore = await state(); await start(); await move(3); await waitClip('visual-a', 'duration', 4)
    assertPlan(await state(), externalBefore, 1); near(byId(await state(), 'outside-mate').startTime, 7, 'linked mate shifts to safe bound')
    assert.deepEqual(byId(await state(), 'side-static'), sideStatic); assert.match(await page.getByTestId('ripple-trim-tracks').innerText(), /Linked side/)
    assert.match(await page.getByTestId('ripple-trim-limit').innerText(), /neighbor|collision|clip/i)
    await release(); await undo(); assert.deepEqual((await state()).clips, externalBefore.clips)
    console.log('PASS 4: linked source bounds and foreign mate closure preserve sync, gaps and independent tracks without overwrites')

    // 5. Source/minimum bounds, unlimited generators, modern speed/reverse and RIFE.
    for (const test of [
      { edge: 'left', delta: -3, duration: 4, source: 0, label: /source start/i },
      { edge: 'left', delta: 5, duration: 0.1, source: 3.9, label: /minimum|1\s*frame/i },
      { edge: 'right', delta: -5, duration: 0.1, source: 1, label: /minimum|1\s*frame/i },
      { edge: 'right', delta: 9, duration: 7, source: 7.9, label: /source end/i },
    ]) {
      progress('5 bound ' + test.edge + ' ' + test.delta)
      await seed(); await start(test.edge); await move(test.delta); await waitClip('visual-a', 'duration', test.duration)
      await readyFrame(test.source); assert.match(await page.getByTestId('ripple-trim-limit').innerText(), test.label); await release()
    }
    for (const edge of ['left', 'right']) {
      await seed({ patches: { 'visual-a': { type: 'image', assetId: 'image', url: urls.image, trimStart: 0, trimEnd: 3, sourceDuration: null } } })
      await start(edge); await move(edge === 'left' ? -5 : 5); await waitClip('visual-a', 'duration', 8)
      await page.waitForFunction(() => document.querySelector('[data-testid="ripple-trim-canvas"]')?.dataset.state === 'ready', null, { polling: 100 })
      assert.equal(await canvas.getAttribute('data-source-mode'), 'image')
      assert.deepEqual(await canvas.evaluate(el => [...el.getContext('2d').getImageData(el.width / 2, el.height / 2, 1, 1).data].slice(0, 3)), [174, 35, 119])
      await release()
    }
    for (const patch of [{ reverse: true }, { speed: 0.5, trimEnd: 2.5 }, { speed: 2, trimEnd: 7 }]) {
      for (const edge of ['left', 'right']) {
        progress('5 clock ' + JSON.stringify(patch) + ' ' + edge)
        await seed({ patches: { 'visual-a': patch } }); await start(edge); await move(0.4)
        await waitClip('visual-a', 'duration', edge === 'left' ? 2.6 : 3.4); await currentFrame(edge); await release()
      }
    }
    const cache = { version: 'rife_ncnn_vulkan_v46_uhd_v1', engine: 'rife-ncnn-vulkan', modelName: 'rife-v4.6',
      status: 'ready', path: 'cache/synthetic-ripple.mp4', url: urls.cached, sourceStart: 1, sourceEnd: 8, targetFps: 20, requestedTargetFps: 20 }
    await seed({ patches: { 'visual-a': { speed: 0.5, trimStart: 2, trimEnd: 3.5, frameSampling: 'optical-flow', opticalFlowCache: cache } } })
    await start(); await move(0.4); await waitClip('visual-a', 'duration', 3.4)
    await readyFrame(3.65, media.cached, 'optical-flow', 2.65); await release()
    console.log('PASS 5: actual decoded source clocks, finite bounds and unbounded stills remain correct under ripple duration changes')

    // 6. All linked target/follower mutations and the first checkpoint publish together.
    await seed({ linked: true }); const atomicBefore = await state()
    await page.evaluate(() => {
      const t = window.multiClipInspectorTest; window.rippleEvents = []
      window.rippleOff = t.timeline.subscribe((state, previous) => {
        const get = id => state.clips.find(c => c.id === id)
        window.rippleEvents.push({ ids: state.clips.filter(c => c !== previous.clips.find(old => old.id === c.id)).map(c => c.id),
          targetA: get('visual-a').duration, targetB: get('audio-a').duration,
          gapA: get('visual-b').startTime - get('visual-a').startTime - get('visual-a').duration,
          gapB: get('audio-b').startTime - get('audio-a').startTime - get('audio-a').duration,
          history: state.history.length })
      })
    })
    await start(); assert.deepEqual(await page.evaluate(() => window.rippleEvents), [])
    for (const [index, delta] of [0.4, 0.7, -0.2, 0.4].entries()) {
      await move(delta); await waitClip('visual-a', 'duration', 3 + delta)
      const events = await page.evaluate(() => window.rippleEvents); assert.equal(events.length, index + 1)
      const event = events.at(-1)
      assert.deepEqual(event.ids.sort(), ['visual-a', 'audio-a', 'visual-b', 'audio-b', 'late'].sort())
      near(event.targetA, event.targetB, 'no subscriber observes desync'); near(event.gapA, 1, 'picture gap'); near(event.gapB, 1, 'dialog gap')
      assert.equal(event.history, 1)
    }
    await page.evaluate(({ x, y }) => window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + 20, clientY: y, buttons: 1 })), gesture)
    assert.equal((await page.evaluate(() => window.rippleEvents)).length, 4)
    const atomicAfter = await state(); await release(); await page.evaluate(() => window.rippleOff())
    await undo(); assert.deepEqual((await state()).clips, atomicBefore.clips)
    await page.evaluate(() => window.multiClipInspectorTest.timeline.getState().redo()); assert.deepEqual((await state()).clips, atomicAfter.clips)
    await seed(); const origin = await state(); await start(); await move(0.4); await waitClip('visual-a', 'duration', 3.4)
    await move(0); await waitClip('visual-a', 'duration', 3); await release()
    assert.deepEqual((await state()).clips, origin.clips); assert.equal((await state()).history, 0)
    console.log('PASS 6: targets, linked mates, followers and history publish atomically; repeated/origin deltas and Undo/Redo stay exact')

    // 7. A transition entirely within the moved follower set translates with it.
    const downstreamTransition = { id: 'following-transition', kind: 'between', type: 'dissolve',
      clipAId: 'visual-b', clipBId: 'late', duration: 0.5, editPoint: 8, originalClipAEnd: 8, originalClipBStart: 8 }
    await seed({ patches: { late: { startTime: 8, duration: 2, trimEnd: 2 } }, transitions: [downstreamTransition] })
    const transitionBefore = await state(); await start(); await move(0.4); await waitClip('visual-a', 'duration', 3.4)
    const movedTransition = (await state()).transitions[0]
    for (const key of ['editPoint', 'originalClipAEnd', 'originalClipBStart']) near(movedTransition[key], downstreamTransition[key] + 0.4, key)
    assert.equal(movedTransition.duration, downstreamTransition.duration)
    await release(); await undo(); assert.deepEqual((await state()).transitions, transitionBefore.transitions)
    console.log('PASS 7: fully moved downstream transitions translate timing and restore with the same Undo')

    // 8. Head audio-envelope offset moves once; all other local attributes and
    // follower origins remain intact through one synthetic JSON save/reopen.
    const envelope = { version: 1, offsetSeconds: 0.25, points: [{ id: 'g0', time: 0, db: -6 }, { id: 'g1', time: 2, db: 3 }] }
    const audioEq = { version: 1, enabled: true, lowCut: true, bassDb: 3, midDb: -2, trebleDb: 1 }
    const keyframes = { opacity: [{ time: 0, value: 50 }, { time: 2, value: 100 }] }
    await seed({ linked: true, patches: { 'visual-a': { keyframes },
      'audio-a': { volumeEnvelope: envelope, audioEq, gainDb: -3, fadeIn: 0.2, fadeOut: 0.3 },
      'audio-b': { volumeEnvelope: envelope, audioEq } } })
    const attrBefore = await state(); await start('left'); await move(0.4); await waitClip('visual-a', 'duration', 2.6); await readyFrame(1.4)
    const attrAfter = await state(); assertPlan(attrAfter, attrBefore, -0.4, true)
    near(byId(attrAfter, 'audio-a').volumeEnvelope.offsetSeconds, 0.65, 'head origin moves once')
    assert.deepEqual(byId(attrAfter, 'audio-a').volumeEnvelope.points, envelope.points)
    assert.deepEqual(byId(attrAfter, 'audio-b').volumeEnvelope, envelope); assert.deepEqual(byId(attrAfter).keyframes, keyframes)
    assert.deepEqual(byId(attrAfter, 'audio-a').audioEq, audioEq); await release()
    const reopened = await page.evaluate(() => {
      const t = window.multiClipInspectorTest, s = t.timeline.getState(), document = JSON.parse(JSON.stringify(s.getProjectData()))
      s.loadFromProject(document, t.assets.getState().assets, 10)
      return JSON.parse(JSON.stringify(t.timeline.getState().clips))
    })
    for (const id of ['visual-a', 'audio-a', 'visual-b', 'audio-b', 'late']) {
      const got = reopened.find(c => c.id === id), expected = byId(attrAfter, id)
      for (const key of ['startTime', 'duration', 'trimStart', 'trimEnd']) near(got[key], expected[key], 'reload ' + id + ' ' + key)
      if (expected.volumeEnvelope) assert.deepEqual(got.volumeEnvelope, expected.volumeEnvelope)
      if (expected.audioEq) assert.deepEqual(got.audioEq, expected.audioEq)
    }
    console.log('PASS 8: consumed head/envelope convention, follower attributes and source timing survive JSON save/reopen')

    // 9. Invalid targets/graphs are rejected before ANY history or dirty write.
    for (const kind of ['ramp', 'unknown-source', 'misaligned-link', 'locked-target', 'locked-follower',
      'locked-mate-track', 'crossing-clip', 'target-transition', 'partial-transition', 'playing']) {
      progress('9 refusal ' + kind); await seed()
      const verdict = await page.evaluate(kind => {
        const t = window.multiClipInspectorTest, s = t.timeline.getState()
        let clips = s.clips.map(c => {
          if (kind === 'misaligned-link' && ['visual-a', 'audio-a'].includes(c.id)) return { ...c, linkGroupId: 'bad-align', ...(c.id === 'audio-a' ? { startTime: 2.1 } : {}) }
          if (kind === 'locked-mate-track' && ['visual-b', 'music-bed'].includes(c.id)) return { ...c, linkGroupId: 'locked-side' }
          if (kind === 'ramp' && c.id === 'visual-a') return { ...c, keyframes: { speed: [{ time: 0, value: 1 }, { time: 3, value: 2 }] } }
          if (kind === 'unknown-source' && c.id === 'visual-a') return { ...c, sourceDuration: null }
          if (kind === 'locked-target' && c.id === 'visual-a') return { ...c, locked: true }
          if (kind === 'locked-follower' && c.id === 'visual-b') return { ...c, locked: true }
          return c
        })
        if (kind === 'crossing-clip') clips.push({ ...clips.find(c => c.id === 'visual-b'), id: 'crossing', startTime: 4, duration: 2 })
        const transition = kind === 'target-transition'
          ? { id: 'target-t', kind: 'between', clipAId: 'visual-a', clipBId: 'visual-b', duration: 0.5, editPoint: 5, originalClipAEnd: 5, originalClipBStart: 6 }
          : kind === 'partial-transition' ? { id: 'partial-t', kind: 'between', clipAId: 'upstream', clipBId: 'visual-b', duration: 0.5, editPoint: 1, originalClipAEnd: 1, originalClipBStart: 6 } : null
        t.timeline.setState({ clips, ...(transition ? { transitions: [transition] } : {}), ...(kind === 'playing' ? { isPlaying: true } : {}) })
        t.markProjectClean(); const before = t.timeline.getState(); let count = 0
        const off = t.timeline.subscribe(() => count++), result = before.beginRippleTrim({ clipId: 'visual-a', edge: 'right' })
        off(); return { result, count, same: before === t.timeline.getState(), history: t.timeline.getState().history.length, dirty: t.isProjectDirty() }
      }, kind)
      assert.equal(verdict.result.ok, false, kind + ': ' + JSON.stringify(verdict.result)); assert.ok(verdict.result.reason)
      assert.equal(verdict.count, 0); assert.equal(verdict.same, true); assert.equal(verdict.history, 0); assert.equal(verdict.dirty, false)
    }
    for (const patches of [{ 'visual-a': { locked: true } }, { 'visual-b': { locked: true } },
      { 'visual-a': { keyframes: { speed: [{ time: 0, value: 1 }, { time: 3, value: 2 }] } } }]) {
      await seed({ patches }); const before = await state(); await pressEdge(); await page.getByTestId('ripple-trim-refusal').waitFor()
      await move(0.4); await page.mouse.up(); assert.deepEqual((await state()).clips, before.clips)
      assert.equal((await state()).history, 0); assert.equal((await state()).dirty, false)
      assert.equal(await normalPreview.count(), 0); assert.equal(await page.getByTestId('roll-edit-preview').count(), 0)
      if (patches['visual-a']?.keyframes && process.env.VELORN_TEST_SCREENSHOT && !native)
        await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT.replace(/\.png$/, '-refusal.png') })
    }
    console.log('PASS 9: locks, invalid sources/links, crossings and unsafe transitions refuse without fallback or state/history/dirty writes')

    // 10. Moving targets/followers must not attract their own snapping gesture.
    await seed({ snapping: true, patches: { overlay: { startTime: 14, duration: 1, trimEnd: 1 },
      'audio-b': { startTime: 18 } } })
    await start(); await move(0.94); await waitClip('visual-a', 'duration', 3.9); await readyFrame(4.8)
    near(byId(await state(), 'visual-b').startTime, 6.9, 'moving follower excluded from snap'); await release()
    await seed({ snapping: true, patches: { overlay: { startTime: 5.5, duration: 1, trimEnd: 1 } } })
    await start(); await move(0.44); await waitClip('visual-a', 'duration', 3.5); await readyFrame(4.4); await release()
    console.log('PASS 10: snapping excludes the complete moving set but still honors a stationary cross-track boundary')

    // 11. Mode OFF retains normal edge behavior; stale/cancel/mode-change ends
    // Ripple feedback without allowing later pointer movement to write.
    for (const edge of ['left', 'right']) {
      await seed({ ripple: false }); const before = await state(); await pressEdge(edge); await normalPreview.waitFor()
      await move(0.4); await waitClip('visual-a', 'duration', edge === 'left' ? 2.6 : 3.4)
      assert.deepEqual(byId(await state(), 'visual-b'), byId(before, 'visual-b'))
      near(byId(await state()).startTime, edge === 'left' ? 2.4 : 2, 'ordinary edge convention')
      assert.equal(await preview.count(), 0); await page.mouse.up(); await normalPreview.waitFor({ state: 'hidden' })
    }
    for (const mutation of ['Escape', 'blur', 'pointercancel', 'tool', 'selection', 'lock', 'load', 'history', 'mode', 'playing']) {
      progress('11 cleanup ' + mutation); await seed(); await start(); await move(0.2); await waitClip('visual-a', 'duration', 3.2)
      if (mutation === 'Escape') await page.keyboard.press('Escape')
      else if (mutation === 'tool') await page.keyboard.press('v')
      else await page.evaluate(mutation => {
        const t = window.multiClipInspectorTest, s = t.timeline.getState()
        if (mutation === 'blur') window.dispatchEvent(new Event('blur'))
        if (mutation === 'pointercancel') window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))
        if (mutation === 'selection') t.timeline.setState({ selectedClipIds: ['visual-b'] })
        if (mutation === 'lock') t.timeline.setState({ clips: s.clips.map(c => c.id === 'visual-b' ? { ...c, locked: true } : c) })
        if (mutation === 'load') s.loadFromProject(JSON.parse(JSON.stringify(s.getProjectData())), t.assets.getState().assets, 10)
        if (mutation === 'history') s.saveToHistory()
        if (mutation === 'mode') s.toggleRippleEdit()
        if (mutation === 'playing') t.timeline.setState({ isPlaying: true })
      }, mutation)
      try { await preview.waitFor({ state: 'hidden' }) } catch (error) { console.error('Ripple cleanup:', mutation); throw error }
      if (mutation === 'playing') await page.evaluate(() => window.multiClipInspectorTest.timeline.setState({ isPlaying: false }))
      const ended = await state(); await move(0.8); await page.mouse.up()
      assert.deepEqual((await state()).clips, ended.clips, mutation + ' prevents stale writes'); assert.equal((await state()).history, ended.history)
    }
    await seed(); await start(); await move(0.2); await waitClip('visual-a', 'duration', 3.2)
    await page.evaluate(() => window.multiClipInspectorTest.setTimelineVisible(false)); await preview.waitFor({ state: 'hidden' })
    const unmounted = await state(); await move(0.8); await page.mouse.up(); assert.deepEqual((await state()).clips, unmounted.clips)
    await page.evaluate(() => window.multiClipInspectorTest.setTimelineVisible(true))
    console.log('PASS 11: normal trim stays unchanged and cancellation/stale state/mode changes/unmount end Ripple cleanly')

    // 12. Affected-track readout and the decoded frame fit real narrow windows.
    await seed({ linked: true }); await start('left'); await move(0.4); await waitClip('visual-a', 'duration', 2.6); await readyFrame(1.4)
    if (process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT.replace(/\.png$/, '-wide.png') })
    for (const width of [600, 350]) {
      if (native) await browser.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 850), width)
      else await page.setViewportSize({ width, height: 850 })
      await page.waitForFunction(width => {
        const box = document.querySelector('[data-testid="ripple-trim-preview"]')?.getBoundingClientRect()
        return window.innerWidth === width && window.innerHeight === 850 && box?.right <= width + 1 && box?.bottom <= 851
      }, width, { polling: 100 })
      const geometry = await preview.evaluate(el => {
        const box = el.getBoundingClientRect(), c = el.querySelector('canvas').getBoundingClientRect()
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: el.clientWidth,
          scroll: el.scrollWidth, canvas: { left: c.left, right: c.right, width: c.width, height: c.height } }
      })
      assert.ok(geometry.left >= 0 && geometry.right <= width + 1 && geometry.top >= 0 && geometry.bottom <= 851, JSON.stringify(geometry))
      assert.ok(geometry.scroll <= geometry.width + 1)
      assert.ok(geometry.canvas.left >= 0 && geometry.canvas.right <= width + 1 && geometry.canvas.width > 60 && geometry.canvas.height > 30)
      assert.match(await page.getByTestId('ripple-trim-tracks').innerText(), /Picture/); assert.match(await page.getByTestId('ripple-trim-tracks').innerText(), /Dialog/)
      assert.equal(await preview.evaluate(el => getComputedStyle(el).pointerEvents), 'none')
    }
    if (process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT })
    await release(); assert.deepEqual(errors, [])
    console.log('PASS: all 12 Ripple edge-trim integration groups; no renderer exceptions (' + (native ? 'isolated installed Electron' : 'Chrome') + ').')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
