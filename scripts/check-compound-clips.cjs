// Real renderer/store/UI checks with synthetic media only. Native waveform,
// export destinations and mixer IPC are explicit in-memory stand-ins; this
// does not exercise production main, real encoding, projects or sandboxing.
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const near = (actual, expected, label, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${label}: ${actual} != ${expected}`)
const parent = state => state.clips.find(clip => clip.type === 'compound')
const document = state => ({ clips: state.clips, tracks: state.tracks, markers: state.markers, transitions: state.transitions })
const pixelsEqual = (actual, expected, label) => {
  assert.equal(actual.length, expected.length, label)
  const differences = actual.map((value, index) => Math.abs(value - expected[index]))
  const summary = data => {
    let red = 0, blue = 0, black = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 120 && data[i] > data[i + 2] * 2) red++
      if (data[i + 2] > 120 && data[i + 2] > data[i] * 2) blue++
      if (Math.max(data[i], data[i + 1], data[i + 2]) < 10) black++
    }
    return { red, blue, black }
  }
  assert.ok(Math.max(...differences) <= 3, `${label}: max pixel difference ${Math.max(...differences)}, actual ${JSON.stringify(summary(actual))}, expected ${JSON.stringify(summary(expected))}`)
}
function encode(color) {
  const result = spawnSync(process.env.FFMPEG_PATH || require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${color}:s=96x54:r=24:d=8`, '-an', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-crf', '12', '-g', '1', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'],
  { timeout: 30000, maxBuffer: 8 * 1024 * 1024 })
  assert.equal(result.status, 0, String(result.stderr))
  return { base64: result.stdout.toString('base64'), fps: 24 }
}
async function main() {
  const native = process.env.VELORN_TEST_ELECTRON === '1'
  const browser = native
    ? await _electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')] })
    : await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true })
  try {
    const page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    page.setDefaultTimeout(15000)
    // The fixture has no application websocket traffic. Keep Vite's
    // development-only hot reload from replacing modules midway through a
    // test while another agent edits a separate source route.
    await page.routeWebSocket(/ws:\/\/(?:127\.0\.0\.1|localhost):5184\//, socket => socket.close())
    const errors = []
    page.on('pageerror', error => { errors.push(error.message); console.error('Renderer:', error.message) })
    page.on('crash', () => console.error('Isolated renderer crashed'))
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) console.log('Fixture navigation:', frame.url()) })
    await page.goto((process.env.VELORN_TEST_URL || 'http://127.0.0.1:5184') + '/tests/fixtures/compound-clips.html' + (native ? '?nativeWaveformStub=1' : ''))
    await page.waitForFunction(() => Boolean(window.compoundTest?.timeline.getState().previewCreateCompound), null, { polling: 100 })
    const metadata = await page.evaluate(media => window.compoundTest.initializeMedia(media), { red: encode('red'), blue: encode('blue') })
    metadata.forEach(asset => near(asset.duration, 8, `${asset.id} source duration`, 0.05))
    const settle = () => page.waitForTimeout(150)
    const dialog = page.getByTestId('compound-create-dialog')
    const apply = page.getByTestId('compound-create-apply')
    const state = () => page.evaluate(() => {
      const t = window.compoundTest, s = t.timeline.getState()
      return JSON.parse(JSON.stringify({ clips: s.clips, tracks: s.tracks, transitions: s.transitions, markers: s.markers,
        inPoint: s.inPoint, outPoint: s.outPoint, selectedClipIds: s.selectedClipIds, history: s.history, historyIndex: s.historyIndex,
        clipCounter: s.clipCounter, duration: s.duration, playhead: s.playheadPosition, playing: s.isPlaying,
        context: s.compoundEditContext, assets: t.assets.getState().assets, dirty: t.isProjectDirty() }))
    })
    const seed = async (patch = {}) => {
      if (await dialog.count()) await page.getByTestId('compound-create-cancel').click()
      await page.evaluate(patch => {
        const t = window.compoundTest
        if (t.getCompoundRenderState(t.timeline.getState()).compoundRenderErrors?.length) t.reset(patch)
      }, patch)
      await page.keyboard.press('Escape'); await page.mouse.up()
      await page.evaluate(patch => window.compoundTest.reset(patch), patch)
      await settle()
    }
    const openDialog = async () => {
      const clip = page.locator('[data-clip-id="overlay"]').first()
      await clip.scrollIntoViewIfNeeded()
      await clip.click({ button: 'right', position: { x: 35, y: 16 } })
      await page.getByTestId('compound-create-open').click()
      await dialog.waitFor(); await settle()
    }
    const create = () => page.evaluate(() => {
      const t = window.compoundTest, s = t.timeline.getState()
      const request = { clipIds: s.selectedClipIds, name: 'Intro compound', width: 960, height: 540 }
      const preview = s.previewCreateCompound(request)
      return { preview: { ...preview, token: undefined }, result: preview.ok ? s.applyCreateCompound(request, preview.token) : null }
    })
    const undo = () => page.evaluate(() => window.compoundTest.timeline.getState().undo())
    const redo = () => page.evaluate(() => window.compoundTest.timeline.getState().redo())
    const exportFrame = async (time, options = {}) => {
      const result = await page.evaluate(({ time, options }) => window.compoundTest.exportInMemory(time, options), { time, options })
      assert.equal(result.error, undefined, result.error)
      assert.equal(result.frames.length, 1)
      return result
    }
    const previewFrame = async time => {
      return page.evaluate(async time => {
        const capture = window.compoundTest.getLivePreviewCapture()
        if (!capture) throw new Error('Real preview capture bridge is unavailable')
        const frame = await capture(time, { timeoutMs: 8000 })
        if (!frame) throw new Error(`Real preview did not commit a fresh decoded frame at ${time}`)
        const canvas = document.createElement('canvas')
        canvas.width = 96; canvas.height = 54
        const ctx = canvas.getContext('2d'); ctx.drawImage(frame, 0, 0, 96, 54)
        return [...ctx.getImageData(0, 0, 96, 54).data]
      }, time)
    }

    // 1. Actual create dialog previews are read-only, cancellation restores no state.
    await seed(); const before = await state(), originalPreview = await previewFrame(3)
    const originalExport = await exportFrame(3), laterExport = await exportFrame(3.5)
    assert.ok(originalExport.frames[0].some((value, index, data) => index % 4 === 0 && value > 120 && value > data[index + 2] * 2), 'decoded red backing is visible')
    assert.ok(originalExport.frames[0].some((value, index, data) => index % 4 === 2 && value > 120 && value > data[index - 2] * 2), 'decoded masked blue overlay is visible')
    assert.notDeepEqual(originalExport.frames[0], laterExport.frames[0], 'retained keyframe animation changes the actual pixels')
    await openDialog(); assert.equal(await apply.isDisabled(), false)
    assert.match(await page.getByTestId('compound-create-summary').innerText(), /3 clips/)
    await page.getByTestId('compound-create-name').fill('Four second intro')
    assert.deepEqual(document(await state()), document(before))
    assert.equal((await state()).history.length, 0); assert.equal((await state()).dirty, false)
    await page.getByTestId('compound-create-cancel').click()
    assert.deepEqual(document(await state()), document(before))
    console.log('PASS 1: real create review, naming and cancellation are document/history/dirty neutral')

    // 2. One parent replaces the exact stack; real preview and export are unchanged.
    await openDialog(); await page.getByTestId('compound-create-name').fill('Four second intro'); await apply.click()
    await dialog.waitFor({ state: 'hidden' }); await settle()
    const created = await state(), compound = parent(created)
    assert.ok(compound); assert.equal(compound.name, 'Four second intro')
    assert.equal(compound.compound.document.clips.length, 3); near(compound.startTime, 2, 'parent start'); near(compound.duration, 4, 'parent duration')
    assert.deepEqual(created.clips.find(clip => clip.id === 'outside'), before.clips.find(clip => clip.id === 'outside'))
    assert.deepEqual(created.markers, before.markers); assert.equal(created.inPoint, before.inPoint); assert.equal(created.outPoint, before.outPoint)
    for (const child of compound.compound.document.clips) {
      const original = before.clips.find(clip => clip.id === child.id)
      assert.deepEqual(child, { ...original, startTime: original.startTime - 2 })
    }
    assert.equal(created.history.length, 1)
    if (process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT.replace(/\.png$/, '-parent.png') })
    pixelsEqual(await previewFrame(3), originalPreview, 'paused preview after creation')
    const combined = await exportFrame(3); pixelsEqual(combined.frames[0], originalExport.frames[0], 'real compositor after creation')
    const solo = await exportFrame(3, { soloClipIds: [compound.id] }); pixelsEqual(solo.frames[0], originalExport.frames[0], 'solo parent includes child layers')
    await page.locator('[data-preview-popout-source="canvas"]').click({ position: { x: 40, y: 40 } })
    assert.deepEqual((await state()).selectedClipIds, [compound.id])
    await undo(); assert.deepEqual(document(await state()), document(before)); await redo()
    pixelsEqual((await exportFrame(3)).frames[0], originalExport.frames[0], 'redo compositor')
    console.log('PASS 2: editable stack, decoded preview/export, parent hit selection and one Undo/Redo preserve the original composition')

    // 3. Parent trim/move windows do not restart child source/keyframe/audio clocks.
    await page.evaluate(() => {
      const t = window.compoundTest, s = t.timeline.getState(), p = s.clips.find(clip => clip.type === 'compound')
      s.saveToHistory(); s.updateClipTrim(p.id, { startTime: 6, duration: 2, trimStart: 1, trimEnd: 3 })
    })
    await settle(); const trimmed = parent(await state())
    assert.deepEqual(trimmed.compound.document, compound.compound.document)
    pixelsEqual((await exportFrame(6.5)).frames[0], laterExport.frames[0], 'trimmed/moved parent retains local visual time')
    const beforeEdge = await exportFrame(5.95), afterEdge = await exportFrame(8)
    for (const rendered of [beforeEdge, afterEdge]) assert.ok(rendered.frames[0].every((value, index) => index % 4 === 3 || value === 0), 'no leaked child outside parent window')
    const timing = await page.evaluate(() => {
      const t = window.compoundTest, s = t.getCompoundRenderState(t.timeline.getState())
      return s.clips.filter(c => c.compoundParentId).map(c => ({ id: c.compoundSourceClipId, start: c.startTime,
        duration: c.duration, window: t.getClipPlaybackWindow(c), source: t.getClipPlaybackTimeAtTimeline(c, 6.5),
        transform: t.getAnimatedTransform(c, 6.5 - c.startTime), fade: t.getAudioClipFadeGain(c, 6.5 - c.startTime),
        envelope: t.getAudioVolumeEnvelopeGain(c, 6.5 - c.startTime) }))
    })
    near(timing.find(c => c.id === 'picture').start, 5, 'virtual original start')
    near(timing.find(c => c.id === 'picture').source, 2.5, 'source time after parent trim')
    assert.deepEqual(timing.find(c => c.id === 'sound').window, { start: 6, end: 8 })
    near(timing.find(c => c.id === 'overlay').transform.positionX, -36, 'keyframe clock retained')
    await page.evaluate(() => { const s = window.compoundTest.timeline.getState(), p = s.clips.find(c => c.type === 'compound'); s.updateClipTrim(p.id, { startTime: 0, duration: 2, trimStart: 1, trimEnd: 3 }) })
    pixelsEqual((await exportFrame(0.5)).frames[0], laterExport.frames[0], 'negative virtual child origin preserves media/keyframe clock')
    await page.evaluate(() => { const s = window.compoundTest.timeline.getState(), p = s.clips.find(c => c.type === 'compound'); s.updateClipTrim(p.id, { startTime: 5, duration: 4, trimStart: 0, trimEnd: 4 }) })
    pixelsEqual((await exportFrame(6.5)).frames[0], laterExport.frames[0], 'extension recovers original contents')
    console.log('PASS 3: parent move/head-tail trim/extension gates output while retaining child clocks and hidden handles')

    // 4. Navigation is not a mutation; child edits remain editable and save as root.
    await seed(); assert.equal((await create()).result.ok, true)
    const preOpen = await state(); await page.getByTestId('compound-inspector-open').click(); await page.getByTestId('compound-breadcrumb').waitFor()
    if (process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT.replace(/\.png$/, '-contents.png') })
    assert.ok((await state()).context); assert.equal((await state()).clips.some(c => c.type === 'compound'), false)
    await page.getByTestId('compound-back').click(); await page.getByTestId('compound-breadcrumb').waitFor({ state: 'hidden' })
    const noEditBack = await state(); assert.deepEqual(document(noEditBack), document(preOpen)); assert.deepEqual(noEditBack.history, preOpen.history)
    await page.getByTestId('compound-inspector-open').click()
    await page.evaluate(() => window.compoundTest.timeline.getState().updateClipTransform('overlay', { rotation: 15 }, true))
    const savedInside = await page.evaluate(() => window.compoundTest.timeline.getState().getProjectData())
    assert.equal(savedInside.clips.some(c => c.id === 'outside'), true)
    assert.equal(savedInside.clips.find(c => c.type === 'compound').compound.document.clips.find(c => c.id === 'overlay').transform.rotation, 15)
    await page.getByTestId('compound-back').click(); await settle()
    const edited = await state(); assert.equal(edited.history.length, preOpen.history.length + 1)
    assert.equal(parent(edited).compound.document.clips.find(c => c.id === 'overlay').transform.rotation, 15)
    await undo(); assert.equal(parent(await state()).compound.document.clips.find(c => c.id === 'overlay').transform.rotation, 0)
    await redo(); assert.equal(parent(await state()).compound.document.clips.find(c => c.id === 'overlay').transform.rotation, 15)
    await page.evaluate(() => { const t = window.compoundTest, data = JSON.parse(JSON.stringify(t.timeline.getState().getProjectData())); t.timeline.getState().loadFromProject(data, t.assets.getState().assets, 24) })
    assert.equal(parent(await state()).compound.document.clips.find(c => c.id === 'overlay').transform.rotation, 15)
    console.log('PASS 4: reopen/Back, root serialization while inside, child editing and parent Undo/Redo/save-load remain editable')

    // 5. Conservative dependency/lock guards reject without partial documents/history.
    for (const kind of ['locked', 'partial-link', 'transition', 'matte', 'caption', 'solo', 'inserts', 'interleaved', 'busy']) {
      await seed()
      const verdict = await page.evaluate(kind => {
        const t = window.compoundTest, s = t.timeline.getState()
        if (kind === 'locked') t.timeline.setState({ tracks: s.tracks.map(track => track.id === 'video-2' ? { ...track, locked: true } : track) })
        if (kind === 'partial-link') t.timeline.setState({ selectedClipIds: ['picture', 'overlay'] })
        if (kind === 'transition') t.timeline.setState({ transitions: [{ id: 'edge', kind: 'edge', clipId: 'picture', edge: 'in', duration: 0.5 }] })
        if (kind === 'matte') t.timeline.setState({ clips: s.clips.map(c => c.id === 'overlay' ? { ...c, trackMatte: 'alpha' } : c) })
        if (kind === 'caption') t.timeline.setState({ clips: s.clips.map(c => c.id === 'overlay' ? { ...c, type: 'captions' } : c) })
        if (kind === 'solo') t.timeline.setState({ tracks: s.tracks.map(track => track.id === 'video-2' ? { ...track, solo: true } : track) })
        if (kind === 'inserts') t.timeline.setState({ tracks: s.tracks.map(track => track.type === 'audio' ? { ...track, inserts: [{ type: 'compressor', enabled: true }] } : track) })
        if (kind === 'interleaved') t.timeline.setState({ clips: [...s.clips, t.makeClip('interleaved', { startTime: 3, duration: 1 })] })
        if (kind === 'busy') t.timeline.setState({ clips: s.clips.map(c => c.id === 'picture' ? { ...c, cacheStatus: 'rendering' } : c) })
        t.markProjectClean(); const current = t.timeline.getState(), before = JSON.stringify(current.getProjectData())
        const preview = current.previewCreateCompound({ clipIds: current.selectedClipIds, name: 'Blocked', width: 960, height: 540 })
        return { preview, same: JSON.stringify(t.timeline.getState().getProjectData()) === before, history: t.timeline.getState().history.length, dirty: t.isProjectDirty() }
      }, kind)
      assert.equal(verdict.preview.ok, false, kind); assert.ok(verdict.preview.reason, kind)
      assert.equal(verdict.same, true, kind); assert.equal(verdict.history, 0, kind); assert.equal(verdict.dirty, false, kind)
    }
    console.log('PASS 5: locks, linked selection, transitions/mattes/captions/solo/inserts/interleaving and render jobs fail safely')

    // 6. Exact rendered tokens cannot be replayed or applied after a race.
    await seed()
    const tokens = await page.evaluate(() => {
      const t = window.compoundTest, request = () => ({ clipIds: t.timeline.getState().selectedClipIds, name: 'Token', width: 960, height: 540 })
      let r = request(), p = t.timeline.getState().previewCreateCompound(r)
      const changed = t.timeline.getState().applyCreateCompound({ ...r, name: 'Changed' }, p.token)
      t.reset(); r = request(); p = t.timeline.getState().previewCreateCompound(r); t.timeline.getState().saveToHistory()
      const history = t.timeline.getState().applyCreateCompound(r, p.token)
      t.reset(); r = request(); p = t.timeline.getState().previewCreateCompound(r); p.summary.name = 'Injected'
      const good = t.timeline.getState().applyCreateCompound(r, p.token), replay = t.timeline.getState().applyCreateCompound(r, p.token)
      return { changed, history, good, replay, name: t.timeline.getState().clips.find(c => c.type === 'compound').name }
    })
    assert.equal(tokens.changed.ok, false); assert.equal(tokens.history.ok, false); assert.equal(tokens.good.ok, true); assert.equal(tokens.replay.ok, false); assert.equal(tokens.name, 'Token')
    await seed(); await openDialog()
    await page.evaluate(() => window.compoundTest.timeline.setState(s => ({ clips: [...s.clips] })))
    await settle(); assert.equal(await apply.isDisabled(), true); assert.match(await page.getByTestId('compound-create-status').innerText(), /changed|reopen/i)
    await page.getByTestId('compound-create-cancel').click()
    console.log('PASS 6: reviewed creation tokens reject changed requests/history, replay and stale modal state')

    // 7. Real live audio graph and export serializer honor bounded original-time leaves.
    await seed(); assert.equal((await create()).result.ok, true)
    await page.evaluate(() => { const s = window.compoundTest.timeline.getState(), p = s.clips.find(c => c.type === 'compound'); s.updateClipTrim(p.id, { startTime: 6, duration: 2, trimStart: 1, trimEnd: 3 }); s.setPlayheadPosition(6.25) })
    const audioExport = await page.evaluate(() => window.compoundTest.exportInMemory(6, { format: 'audio', audioCodec: 'wav', rangeEnd: 8, outputPath: '/__compound_memory__/audio.wav', includeAudio: true }))
    assert.equal(audioExport.error, undefined, audioExport.error); assert.equal(audioExport.mixes.length, 1)
    const sound = audioExport.mixes[0].clips.find(c => c.assetId === 'tone')
    near(sound.startTime, 5, 'serialized authored start'); near(sound.duration, 4, 'serialized authored duration')
    near(sound.playbackWindowStart, 6, 'serialized parent head'); near(sound.playbackWindowEnd, 8, 'serialized parent tail')
    near(sound.fadeIn, 1, 'fade origin retained'); near(sound.volumeEnvelope.offsetSeconds, 0.25, 'envelope origin retained')
    assert.equal(sound.audioEq.bassDb, 2)
    await page.evaluate(() => window.compoundTest.timeline.setState({ isPlaying: true }))
    let heard = false
    for (let index = 0; index < 12; index++) {
      await page.waitForTimeout(100)
      heard = await page.evaluate(index => {
        const t = window.compoundTest; t.timeline.getState().setPlayheadPosition(6.25 + index * 0.1, { source: 'transport' })
        const rendered = t.getCompoundRenderState(t.timeline.getState()), clip = rendered.clips.find(c => c.compoundSourceClipId === 'sound')
        return t.readAnalyserRmsDb(t.getTrackAnalyser(clip.trackId)) > -90
      }, index) || heard
    }
    await page.evaluate(() => window.compoundTest.timeline.setState({ isPlaying: false }))
    assert.equal(heard, true, 'live virtual child audio reached its real track bus with monitor muted')
    console.log('PASS 7: live muted-monitor audio graph and actual audio export payload retain EQ/envelope/fades and parent windows')

    // 8. Bad persisted data is visible and refuses export before any destination call.
    await seed(); assert.equal((await create()).result.ok, true)
    await page.evaluate(() => {
      // Deliberately bypass validated load/edit APIs to exercise the renderer
      // backstop. Persist correctly rejects this unsupported raw state.
      try { window.compoundTest.timeline.setState(s => ({ clips: s.clips.map(c => c.type === 'compound' ? { ...c, compound: { ...c.compound, version: 9 } } : c) })) }
      catch (error) { if (!/Unsupported compound version/.test(error.message)) throw error }
    })
    await page.getByTestId('compound-preview-error').waitFor()
    const invalidExport = await page.evaluate(() => window.compoundTest.exportInMemory(3))
    assert.match(invalidExport.error, /compound|unsupported/i); assert.deepEqual(invalidExport.calls, []); assert.deepEqual(invalidExport.frames, [])
    console.log('PASS 8: malformed persisted compounds show a preview warning and fail export before destination writes')

    // 9. Modal hotkeys/focus and small layouts stay bounded; cancellation is inert.
    await seed(); await openDialog(); const keyboardBefore = await state()
    for (const key of ['Delete', 'j', 'k', 'l', 'Control+z', 'Control+c', 'Control+v']) await page.keyboard.press(key)
    for (let index = 0; index < 14; index++) { await page.keyboard.press('Tab'); assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true) }
    assert.deepEqual(document(await state()), document(keyboardBefore))
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
    await openDialog()
    if (process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT.replace(/\.png$/, '-wide.png') })
    for (const width of [600, 350]) {
      await page.setViewportSize({ width, height: 850 }); await settle()
      const geometry = await dialog.evaluate(el => { const box = el.getBoundingClientRect(); return { left: box.left, right: box.right, width: el.clientWidth, scroll: el.scrollWidth,
        controls: [...el.querySelectorAll('button,input')].map(control => { const r = control.getBoundingClientRect(); return { left: r.left, right: r.right } }) } })
      assert.ok(geometry.left >= 0 && geometry.right <= width + 1 && geometry.scroll <= geometry.width + 1)
      geometry.controls.forEach(control => assert.ok(control.left >= -1 && control.right <= width + 1))
    }
    if (process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT })
    await page.getByTestId('compound-create-cancel').click()
    assert.deepEqual(errors, [])
    console.log(`PASS: all 9 editable-compound groups; no renderer exceptions (${native ? 'isolated Electron with waveform/export IPC stand-ins' : 'Chrome with in-memory export IPC stand-ins'}).`)
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
