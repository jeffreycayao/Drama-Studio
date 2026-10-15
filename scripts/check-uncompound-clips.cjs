// Synthetic decoded media, real renderer/store/UI and actual export compositor.
// Export destinations/audio IPC are in-memory stand-ins. Installed Electron uses
// the existing test-only waveform IPC stub, not production main or sandboxing.
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const near = (actual, expected, label, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`)
const parent = state => state.clips.find(clip => clip.type === 'compound')
const documentState = state => ({ clips: state.clips, tracks: state.tracks, transitions: state.transitions, markers: state.markers })
const pixelCounts = data => {
  let red = 0, blue = 0, black = 0
  for (let index = 0; index < data.length; index += 4) {
    if (data[index] > 120 && data[index] > data[index + 2] * 2) red++
    if (data[index + 2] > 120 && data[index + 2] > data[index] * 2) blue++
    if (Math.max(data[index], data[index + 1], data[index + 2]) < 10) black++
  }
  return { red, blue, black }
}
const pixelsEqual = (actual, expected, label) => {
  assert.equal(actual.length, expected.length, label)
  const maximum = Math.max(...actual.map((value, index) => Math.abs(value - expected[index])))
  assert.ok(maximum <= 3, `${label}: max difference ${maximum}; actual ${JSON.stringify(pixelCounts(actual))}, expected ${JSON.stringify(pixelCounts(expected))}`)
}
function encode(color) {
  const result = spawnSync(process.env.FFMPEG_PATH || require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${color}:s=96x54:r=24:d=8`, '-an',
    '-vf', "drawbox=x=2:y=2:w=8:h=8:color=white:t=fill:enable='lt(mod(t,1),0.5)'", '-c:v', 'libx264', '-preset', 'ultrafast',
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
    await page.routeWebSocket(/ws:\/\/(?:127\.0\.0\.1|localhost):5184\//, socket => socket.close())
    const errors = []
    page.on('pageerror', error => { errors.push(error.message); console.error('Renderer:', error.message) })
    page.on('crash', () => console.error('Isolated renderer crashed'))
    await page.goto((process.env.VELORN_TEST_URL || 'http://127.0.0.1:5184') + '/tests/fixtures/compound-clips.html' + (native ? '?nativeWaveformStub=1' : ''))
    await page.waitForFunction(() => Boolean(window.compoundTest?.timeline.getState().previewUncompound), null, { polling: 100 })
    const metadata = await page.evaluate(media => window.compoundTest.initializeMedia(media), { red: encode('red'), blue: encode('blue') })
    metadata.forEach(asset => near(asset.duration, 8, `${asset.id} duration`, 0.05))
    const settle = () => page.waitForTimeout(150)
    const dialog = page.getByTestId('compound-uncompound-dialog')
    const apply = page.getByTestId('compound-uncompound-apply')
    const state = () => page.evaluate(() => {
      const t = window.compoundTest, s = t.timeline.getState()
      return JSON.parse(JSON.stringify({ clips: s.clips, tracks: s.tracks, transitions: s.transitions, markers: s.markers,
        inPoint: s.inPoint, outPoint: s.outPoint, selectedClipIds: s.selectedClipIds, history: s.history, historyIndex: s.historyIndex,
        clipCounter: s.clipCounter, duration: s.duration, playhead: s.playheadPosition, playing: s.isPlaying,
        context: s.compoundEditContext, assets: t.assets.getState().assets, dirty: t.isProjectDirty() }))
    })
    const seed = async () => {
      if (await dialog.count()) await page.getByTestId('compound-uncompound-cancel').click()
      await page.keyboard.press('Escape'); await page.mouse.up()
      await page.evaluate(() => window.compoundTest.reset())
      await settle()
    }
    const create = async () => {
      const result = await page.evaluate(() => {
        const t = window.compoundTest, s = t.timeline.getState()
        const request = { clipIds: s.selectedClipIds, name: 'Intro compound', width: 960, height: 540 }
        const preview = s.previewCreateCompound(request)
        return preview.ok ? s.applyCreateCompound(request, preview.token) : preview
      })
      assert.equal(result.ok, true, result.reason)
      await settle()
    }
    const uncompound = () => page.evaluate(() => {
      const s = window.compoundTest.timeline.getState(), request = { clipId: s.clips.find(c => c.type === 'compound').id }
      const preview = s.previewUncompound(request)
      return { preview: { ...preview, token: undefined }, result: preview.ok ? s.applyUncompound(request, preview.token) : null }
    })
    const trimParent = async (startTime = 6, trimStart = 1, trimEnd = 3) => {
      await page.evaluate(({ startTime, trimStart, trimEnd }) => {
        const s = window.compoundTest.timeline.getState(), p = s.clips.find(c => c.type === 'compound')
        s.updateClipTrim(p.id, { startTime, duration: trimEnd - trimStart, trimStart, trimEnd })
        s.setPlayheadPosition(startTime + 0.5)
      }, { startTime, trimStart, trimEnd })
      await settle()
    }
    const openDialog = async (from = 'inspector') => {
      if (from === 'inspector') await page.getByTestId('compound-inspector-uncompound').click()
      else {
        const clipId = parent(await state()).id
        const clip = page.locator(`[data-clip-id="${clipId}"]`).first()
        await clip.scrollIntoViewIfNeeded()
        await clip.click({ button: 'right', position: { x: 35, y: 16 } })
        await page.getByTestId('compound-uncompound-open').click()
      }
      await dialog.waitFor(); await settle()
    }
    const previewFrame = time => page.evaluate(async time => {
      const capture = window.compoundTest.getLivePreviewCapture()
      if (!capture) throw new Error('Real preview capture bridge unavailable')
      const frame = await capture(time, { timeoutMs: 8000 })
      if (!frame) throw new Error(`No fresh decoded preview frame at ${time}`)
      const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 54
      const ctx = canvas.getContext('2d'); ctx.drawImage(frame, 0, 0, 96, 54)
      return [...ctx.getImageData(0, 0, 96, 54).data]
    }, time)
    const exportFrame = async time => {
      const result = await page.evaluate(time => window.compoundTest.exportInMemory(time), time)
      assert.equal(result.error, undefined, result.error); assert.equal(result.frames.length, 1)
      return result.frames[0]
    }
    const undo = () => page.evaluate(() => window.compoundTest.timeline.getState().undo())
    const redo = () => page.evaluate(() => window.compoundTest.timeline.getState().redo())
    const assertUnchangedSurroundings = (after, before) => {
      for (const old of before.clips.filter(c => c.type !== 'compound')) assert.deepEqual(after.clips.find(c => c.id === old.id), old)
      assert.deepEqual(after.tracks.filter(track => before.tracks.some(old => old.id === track.id)), before.tracks)
      assert.deepEqual(after.markers, before.markers); assert.deepEqual(after.transitions, before.transitions)
      near(after.inPoint, before.inPoint, 'In marker'); near(after.outPoint, before.outPoint, 'Out marker')
      near(after.duration, before.duration, 'timeline extent'); assert.deepEqual(after.assets, before.assets)
    }

    // 1. Both real entry points review the exact plan without modifying a document.
    await seed()
    await page.evaluate(() => {
      const t = window.compoundTest, s = t.timeline.getState()
      t.timeline.setState({ tracks: [t.track('unselected-foreground'), ...s.tracks], clips: [...s.clips,
        t.makeClip('foreground', { assetId: 'blue', url: t.getAsset('blue').url, trackId: 'unselected-foreground',
          transform: { positionX: 370, positionY: 180, scaleX: 15, scaleY: 20, rotation: 0, opacity: 70 } })] })
    })
    await create(); await page.evaluate(() => window.compoundTest.markProjectClean())
    const beforeReview = await state()
    for (const entry of ['inspector', 'timeline']) {
      await openDialog(entry)
      assert.equal(await apply.isDisabled(), false)
      assert.match(await page.getByTestId('compound-uncompound-summary').innerText(), /3 clips.*3 fresh tracks/s)
      assert.equal(await page.getByTestId('compound-uncompound-cancel').evaluate(el => document.activeElement === el), true)
      assert.deepEqual(documentState(await state()), documentState(beforeReview))
      assert.equal((await state()).history.length, beforeReview.history.length); assert.equal((await state()).dirty, false)
      await page.getByTestId('compound-uncompound-cancel').click(); await dialog.waitFor({ state: 'hidden' })
      if (entry === 'inspector') assert.equal(await page.getByTestId('compound-inspector-uncompound').evaluate(el => document.activeElement === el), true)
    }
    console.log('PASS 1: Inspector/context review and cancellation are document/history/dirty neutral and restore focus')

    // 2. Untrimmed flattening keeps the decoded composition, its layer order and linked audio.
    const before = await state(), oldPreview = await previewFrame(3), oldExport = await exportFrame(3), oldLater = await exportFrame(3.5)
    assert.ok(pixelCounts(oldPreview).red > 100, 'strict preview contains decoded red source')
    assert.ok(pixelCounts(oldExport).red > 100 && pixelCounts(oldExport).blue > 20, 'export contains both decoded sources')
    assert.notDeepEqual(oldExport, oldLater, 'authored transform animation changes pixels')
    await openDialog()
    if (process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT.replace(/\.png$/, '-wide.png') })
    await apply.click(); await dialog.waitFor({ state: 'hidden' }); await settle()
    const flattened = await state()
    assert.equal(parent(flattened), undefined); assert.equal(flattened.clips.length, before.clips.length - 1 + 3)
    assert.equal(flattened.history.length, before.history.length + 1)
    assert.equal(flattened.selectedClipIds.length, 3)
    assertUnchangedSurroundings(flattened, before)
    const children = flattened.clips.filter(c => flattened.selectedClipIds.includes(c.id)), picture = children.find(c => c.name === 'picture'), sound = children.find(c => c.name === 'sound')
    assert.ok(picture.linkGroupId); assert.equal(picture.linkGroupId, sound.linkGroupId)
    assert.equal(sound.metadata.linkedVideoClipId, picture.id)
    assert.equal(children.every(c => !c.compoundParentId && !c.compound && c.playbackWindowStart === undefined), true)
    pixelsEqual(await previewFrame(3), oldPreview, 'untrimmed strict preview')
    pixelsEqual(await exportFrame(3), oldExport, 'untrimmed actual export'); pixelsEqual(await exportFrame(3.5), oldLater, 'animated actual export')
    assert.equal(await page.locator('[data-compound-timeline-focus]').evaluate(el => document.activeElement === el), true)
    if (process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT.replace(/\.png$/, '-restored.png') })
    console.log('PASS 2: untrimmed Uncompound preserves strict decoded preview/export, linked audio, stack and all unrelated content')

    // 3. A single Undo restores the complete compound; Redo and portable save/load retain editable leaves.
    await undo(); assert.deepEqual(documentState(await state()), documentState(before))
    await redo(); assert.deepEqual(documentState(await state()), documentState(flattened))
    const loaded = await page.evaluate(() => {
      const t = window.compoundTest, data = JSON.parse(JSON.stringify(t.timeline.getState().getProjectData()))
      t.timeline.getState().loadFromProject(data, t.assets.getState().assets, 24)
      return data
    })
    assert.equal(loaded.clips.some(c => c.type === 'compound'), false)
    assert.equal((await state()).clips.find(c => c.name === 'overlay').shapeMask.shape, 'ellipse')
    assert.equal((await state()).clips.find(c => c.name === 'sound').audioEq.bassDb, 2)
    pixelsEqual(await exportFrame(3.5), oldLater, 'save/load actual export')
    console.log('PASS 3: one Undo/Redo and save/load preserve the full parent or restored editable child data')

    // 4. Exact head/tail cuts translate all animation keys, including negative keys, rather than restarting.
    for (const start of [6, 0]) {
      await seed()
      await page.evaluate(() => window.compoundTest.timeline.setState(s => ({ clips: s.clips.map(c => c.id === 'overlay'
        ? { ...c, keyframes: { positionX: c.keyframes.positionX.map(key => ({ ...key, easing: 'cubic-bezier(0.2,0.7,0.8,0.1)' })) } } : c) })))
      await create(); await trimParent(start)
      const bounded = await state(), times = [start, start + 0.5, start + 1.75]
      const samples = []
      for (const time of times) samples.push(await exportFrame(time))
      const preview = await previewFrame(start + 0.5)
      const result = await uncompound(); assert.equal(result.result?.ok, true, result.preview.reason)
      const restored = await state(); assertUnchangedSurroundings(restored, bounded)
      const visible = restored.clips.filter(c => c.id !== 'outside')
      visible.forEach(c => { assert.ok(c.startTime >= start); assert.ok(c.startTime + c.duration <= start + 2 + 1e-7) })
      const overlay = visible.find(c => c.name === 'overlay')
      near(overlay.keyframes.positionX[0].time, -0.5, 'outside-range key preserved at negative local time')
      near(overlay.keyframes.positionX[1].time, 2, 'later key translated exactly')
      const restoredSound = visible.find(c => c.name === 'sound')
      near(restoredSound.volumeEnvelope.offsetSeconds, 1.25, 'envelope original phase')
      assert.equal(restoredSound.audioEq.bassDb, 2)
      pixelsEqual(await previewFrame(start + 0.5), preview, `trimmed strict preview at ${start}`)
      for (let index = 0; index < times.length; index++) pixelsEqual(await exportFrame(times[index]), samples[index], `trimmed/moved export at ${times[index]}`)
      const afterTail = await exportFrame(start + 2)
      assert.equal(pixelCounts(afterTail).black, 96 * 54, 'no cropped-out child leaks after tail')
      await undo(); assert.deepEqual(documentState(await state()), documentState(bounded))
      await redo(); assert.deepEqual(documentState(await state()), documentState(restored))
      await page.evaluate(() => {
        const t = window.compoundTest, data = JSON.parse(JSON.stringify(t.timeline.getState().getProjectData()))
        t.timeline.getState().loadFromProject(data, t.assets.getState().assets, 24)
      })
      const afterLoad = (await state()).clips.find(c => c.name === 'overlay')
      assert.deepEqual(afterLoad.keyframes, overlay.keyframes, 'negative/offscreen keyframes survive ordinary load')
      pixelsEqual(await exportFrame(start + 0.5), samples[1], `cropped save/load export at ${start}`)
    }
    console.log('PASS 4: moved head/tail trims and negative virtual origins retain source/animation/audio clocks and exact visible bounds')

    // 5. The latest edited child document, not a stale creation snapshot, is restored.
    await seed(); await create()
    await page.getByTestId('compound-inspector-open').click(); await page.getByTestId('compound-breadcrumb').waitFor()
    await page.evaluate(() => {
      const t = window.compoundTest, s = t.timeline.getState()
      s.updateClipTransform('overlay', { rotation: 17 }, true)
      s.updateClipAdjustments('overlay', { saturation: -15, contrast: 10, midtones: { brightness: 3 } }, true)
      s.updateAudioEq('sound', { version: 1, enabled: true, lowCut: true, bassDb: 4, midDb: -2, trebleDb: 3 })
      s.updateAudioVolumeEnvelope('sound', { version: 1, offsetSeconds: 0.75, points: [{ id: 'latest', time: 0, db: -7 }] })
    })
    await page.getByTestId('compound-back').click(); await page.getByTestId('compound-breadcrumb').waitFor({ state: 'hidden' })
    const latest = await state(), latestFrame = await exportFrame(3.5), latestPreview = await previewFrame(3.5)
    assert.equal((await uncompound()).result.ok, true)
    const afterLatest = await state(), latestChildren = parent(latest).compound.document.clips
    for (const old of latestChildren) {
      const actual = afterLatest.clips.find(c => c.name === old.name)
      for (const key of ['transform', 'keyframes', 'effects', 'shapeMask', 'adjustments', 'audioEq', 'volumeEnvelope']) assert.deepEqual(actual[key], old[key], `${old.name} ${key}`)
    }
    pixelsEqual(await exportFrame(3.5), latestFrame, 'latest child edits actual export')
    pixelsEqual(await previewFrame(3.5), latestPreview, 'latest child edits strict preview')
    console.log('PASS 5: reopen/edit/Back restores the latest transforms, effects, masks, keyframes, EQ and envelope')

    // 6. Cropped timing-dependent processing is refused before any mutation/history.
    for (const kind of ['partial-fade', 'speed-ramp', 'procedural', 'motion-blur', 'locked-parent', 'locked-track', 'locked-child', 'playing']) {
      await seed(); await create(); await trimParent()
      const verdict = await page.evaluate(kind => {
        const t = window.compoundTest, s = t.timeline.getState(), p = s.clips.find(c => c.type === 'compound')
        const edit = structuredClone(p)
        if (kind === 'partial-fade') edit.compound.document.clips.find(c => c.id === 'sound').fadeIn = 2
        if (kind === 'speed-ramp') edit.compound.document.clips.find(c => c.id === 'picture').keyframes = { speed: [{ time: 0, value: 1 }, { time: 4, value: 2 }] }
        if (kind === 'procedural') edit.compound.document.clips.find(c => c.id === 'picture').effects = [{ id: 'grain', type: 'filmGrain', enabled: true, settings: { amount: 0.2 } }]
        if (kind === 'motion-blur') edit.compound.document.clips.find(c => c.id === 'overlay').transform.motionBlurEnabled = true
        if (kind === 'locked-parent') edit.locked = true
        if (kind === 'locked-child') edit.compound.document.clips.find(c => c.id === 'overlay').locked = true
        t.timeline.setState({ clips: s.clips.map(c => c.id === p.id ? edit : c),
          ...(kind === 'locked-track' ? { tracks: s.tracks.map(track => track.id === p.trackId ? { ...track, locked: true } : track) } : {}),
          ...(kind === 'playing' ? { isPlaying: true } : {}) })
        t.markProjectClean(); const current = t.timeline.getState(), before = JSON.stringify(current.getProjectData())
        const history = current.history.length, counter = current.clipCounter
        const preview = current.previewUncompound({ clipId: p.id })
        return { preview, unchanged: before === JSON.stringify(t.timeline.getState().getProjectData()),
          sameHistory: t.timeline.getState().history.length === history, sameCounter: t.timeline.getState().clipCounter === counter, dirty: t.isProjectDirty() }
      }, kind)
      assert.equal(verdict.preview.ok, false, `${kind}: ${JSON.stringify(verdict.preview)}`)
      assert.ok(verdict.preview.reason, kind); assert.equal(verdict.unchanged, true, kind)
      assert.equal(verdict.sameHistory, true, kind); assert.equal(verdict.sameCounter, true, kind); assert.equal(verdict.dirty, false, kind)
    }
    console.log('PASS 6: unsafe partial fades/ramps/procedural effects/motion blur, locks and playback refuse atomically')

    // 7. Exact preview tokens protect against stale requests, history, selection and replay.
    for (const change of ['request', 'history', 'selection', 'clips', 'replay', 'public-summary']) {
      await seed(); await create()
      const verdict = await page.evaluate(change => {
        const t = window.compoundTest, s = t.timeline.getState(), p = s.clips.find(c => c.type === 'compound'), request = { clipId: p.id }
        t.markProjectClean(); const before = JSON.stringify(s.getProjectData()), history = s.history.length, counter = s.clipCounter
        const preview = s.previewUncompound(request)
        if (!preview.ok) throw new Error(preview.reason)
        const pure = before === JSON.stringify(t.timeline.getState().getProjectData()) && history === t.timeline.getState().history.length
          && counter === t.timeline.getState().clipCounter && !t.isProjectDirty()
        if (change === 'request') request.clipId = 'outside'
        if (change === 'history') s.saveToHistory()
        if (change === 'selection') t.timeline.setState({ selectedClipIds: [p.id, 'outside'] })
        if (change === 'clips') t.timeline.setState({ clips: [...s.clips] })
        if (change === 'public-summary') { preview.summary.clipCount = 999; preview.summary.compoundName = 'Injected' }
        const current = t.timeline.getState(), beforeApply = JSON.stringify(current.getProjectData()), beforeHistory = current.history.length
        const result = current.applyUncompound(request, preview.token)
        const replay = change === 'replay' ? t.timeline.getState().applyUncompound(request, preview.token) : null
        return { pure, result, replay, unchanged: beforeApply === JSON.stringify(t.timeline.getState().getProjectData()),
          historyDelta: t.timeline.getState().history.length - beforeHistory, clips: t.timeline.getState().clips }
      }, change)
      assert.equal(verdict.pure, true, change)
      if (['replay', 'public-summary'].includes(change)) {
        assert.equal(verdict.result.ok, true, change); assert.equal(verdict.historyDelta, 1, change); assert.equal(verdict.clips.length, 4)
        if (verdict.replay) assert.equal(verdict.replay.ok, false)
      } else { assert.equal(verdict.result.ok, false, change); assert.equal(verdict.unchanged, true, change); assert.equal(verdict.historyDelta, 0, change) }
    }
    await seed(); await create(); await openDialog()
    await page.evaluate(() => window.compoundTest.timeline.setState(s => ({ clips: [...s.clips] })))
    await settle(); assert.equal(await apply.isDisabled(), true)
    assert.match(await page.getByTestId('compound-uncompound-status').innerText(), /changed|review/i)
    await page.getByTestId('compound-uncompound-cancel').click()
    console.log('PASS 7: preview is pure; changed requests/history/selection/identity, replay and stale UI cannot apply a stale plan')

    // 8. Real export audio payload and live track graph retain the cropped source, envelope and EQ.
    await seed(); await create(); await trimParent()
    const beforeAudio = await page.evaluate(() => {
      const t = window.compoundTest, s = t.getCompoundRenderState(t.timeline.getState()), sound = s.clips.find(c => c.compoundSourceClipId === 'sound')
      return [6, 6.25, 7, 7.75].map(time => ({ time, source: t.getClipPlaybackTimeAtTimeline(sound, time),
        gain: t.getAudioClipFadeGain(sound, time - sound.startTime) * t.getAudioVolumeEnvelopeGain(sound, time - sound.startTime) }))
    })
    assert.equal((await uncompound()).result.ok, true)
    const audioExport = await page.evaluate(() => window.compoundTest.exportInMemory(6, { format: 'audio', audioCodec: 'wav', rangeEnd: 8,
      outputPath: '/__compound_memory__/audio.wav', includeAudio: true }))
    assert.equal(audioExport.error, undefined, audioExport.error); assert.equal(audioExport.mixes.length, 1)
    const serializedSound = audioExport.mixes[0].clips.find(c => c.assetId === 'tone')
    near(serializedSound.startTime, 6, 'restored audio start'); near(serializedSound.duration, 2, 'restored audio duration')
    assert.equal(serializedSound.playbackWindowStart, undefined); assert.equal(serializedSound.audioEq.bassDb, 2)
    const afterAudio = await page.evaluate(() => {
      const t = window.compoundTest, sound = t.timeline.getState().clips.find(c => c.name === 'sound')
      return [6, 6.25, 7, 7.75].map(time => ({ time, source: t.getClipPlaybackTimeAtTimeline(sound, time),
        gain: t.getAudioClipFadeGain(sound, time - sound.startTime) * t.getAudioVolumeEnvelopeGain(sound, time - sound.startTime) }))
    })
    beforeAudio.forEach((sample, index) => { near(afterAudio[index].source, sample.source, 'audio source time'); near(afterAudio[index].gain, sample.gain, 'audio gain phase') })
    await page.evaluate(() => { const s = window.compoundTest.timeline.getState(); s.setPlayheadPosition(6.25); window.compoundTest.timeline.setState({ isPlaying: true }) })
    let heard = false
    for (let index = 0; index < 12; index++) {
      await page.waitForTimeout(100)
      heard = await page.evaluate(index => { const t = window.compoundTest; t.timeline.getState().setPlayheadPosition(6.25 + index * 0.1, { source: 'transport' })
        const c = t.timeline.getState().clips.find(c => c.name === 'sound'); return t.readAnalyserRmsDb(t.getTrackAnalyser(c.trackId)) > -90 }, index) || heard
    }
    await page.evaluate(() => window.compoundTest.timeline.setState({ isPlaying: false }))
    assert.equal(heard, true, 'restored audio reaches the real track graph, with monitor volume zero')
    console.log('PASS 8: actual export serializer and real live muted-monitor audio retain cropped source, EQ and envelope timing')

    // 9. Whole-child restoration does not need to rebase procedural or ramp clocks.
    await seed()
    await page.evaluate(() => window.compoundTest.timeline.setState(s => ({ clips: s.clips.map(c => c.id === 'picture'
      ? { ...c, keyframes: { speed: [{ time: 0, value: 1 }, { time: 4, value: 1.5 }] },
        effects: [{ id: 'retained-grain', type: 'filmGrain', enabled: true, settings: { amount: 12, size: 1, colored: false } }] }
      : c.id === 'overlay' ? { ...c, transform: { ...c.transform, motionBlurEnabled: true, motionBlurSamples: 8, motionBlurShutter: 180 } } : c) })))
    await create()
    const temporal = await state(), temporalFrame = await exportFrame(3.25), temporalPreview = await previewFrame(3.25)
    const temporalResult = await uncompound(); assert.equal(temporalResult.result?.ok, true, temporalResult.preview.reason)
    const restoredTemporal = await state()
    for (const old of parent(temporal).compound.document.clips) {
      const actual = restoredTemporal.clips.find(c => c.name === old.name)
      for (const key of ['duration', 'trimStart', 'trimEnd', 'keyframes', 'effects', 'transform', 'fadeIn', 'fadeOut']) assert.deepEqual(actual[key], old[key])
    }
    pixelsEqual(await exportFrame(3.25), temporalFrame, 'untrimmed ramp/procedural/motion-blur export')
    pixelsEqual(await previewFrame(3.25), temporalPreview, 'untrimmed ramp/procedural/motion-blur strict preview')
    console.log('PASS 9: untrimmed ramps, procedural effects, motion blur and fades keep their full original clocks')

    // 10. Hidden children/markers are disclosed and omitted; Undo restores the full document.
    await seed(); await create(); await page.getByTestId('compound-inspector-open').click()
    await page.getByTestId('compound-breadcrumb').waitFor()
    await page.evaluate(() => {
      const t = window.compoundTest, s = t.timeline.getState()
      t.timeline.setState({ clips: [...s.clips, t.makeClip('hidden-child', { startTime: 3.5, duration: 0.5, trimStart: 0, trimEnd: 0.5 })],
        markers: [{ id: 'inside-child-marker', name: 'Kept child marker', time: 1.5 }, { id: 'outside-child-marker', name: 'Hidden child marker', time: 3.5 }] })
    })
    await page.getByTestId('compound-back').click(); await page.getByTestId('compound-breadcrumb').waitFor({ state: 'hidden' })
    await trimParent(); const boundedWithHidden = await state(), omittedBaseline = await exportFrame(6.5)
    await openDialog()
    const warning = await page.getByTestId('compound-uncompound-warnings').innerText()
    assert.match(warning, /1 child clip.*outside/s); assert.match(warning, /1 child marker.*outside/s)
    await apply.click(); await dialog.waitFor({ state: 'hidden' })
    const withMarker = await state()
    assert.equal(withMarker.clips.some(c => c.name === 'hidden-child'), false)
    assert.deepEqual(withMarker.markers.filter(m => boundedWithHidden.markers.some(old => old.id === m.id)), boundedWithHidden.markers)
    const keptMarker = withMarker.markers.find(m => m.name === 'Kept child marker')
    near(keptMarker.time, 6.5, 'child marker translated'); assert.notEqual(keptMarker.id, 'inside-child-marker')
    assert.equal(withMarker.markers.some(m => m.name === 'Hidden child marker'), false)
    pixelsEqual(await exportFrame(6.5), omittedBaseline, 'omitted child actual export')
    await undo(); assert.deepEqual(documentState(await state()), documentState(boundedWithHidden))
    console.log('PASS 10: cropped-out children/markers are disclosed, visible markers translate, and Undo recovers omitted contents')

    // 11. Modal keys never leak into Timeline and both narrow layouts remain usable.
    await seed(); await create(); await openDialog(); const keyboardBefore = await state()
    for (const key of ['Delete', 'j', 'k', 'l', 'Control+z', 'Control+c', 'Control+v']) await page.keyboard.press(key)
    for (let index = 0; index < 12; index++) { await page.keyboard.press('Tab'); assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true) }
    assert.deepEqual(documentState(await state()), documentState(keyboardBefore)); assert.equal((await state()).playing, false)
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.getByTestId('compound-inspector-uncompound').evaluate(el => document.activeElement === el), true)
    await openDialog()
    for (const width of [600, 350]) {
      await page.setViewportSize({ width, height: 850 }); await settle()
      const geometry = await dialog.evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right,
        width: el.clientWidth, scroll: el.scrollWidth, controls: [...el.querySelectorAll('button,input')].map(control => {
          const box = control.getBoundingClientRect(); return { left: box.left, right: box.right }
        }) } })
      assert.ok(geometry.left >= 0 && geometry.right <= width + 1 && geometry.scroll <= geometry.width + 1)
      geometry.controls.forEach(control => assert.ok(control.left >= -1 && control.right <= width + 1))
    }
    if (process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT })
    await page.getByTestId('compound-uncompound-backdrop').click({ position: { x: 2, y: 2 } })
    await dialog.waitFor({ state: 'hidden' }); assert.deepEqual(documentState(await state()), documentState(keyboardBefore))
    await page.setViewportSize({ width: 1440, height: 1100 }); await settle()
    await page.evaluate(() => { const t = window.compoundTest, p = t.timeline.getState().clips.find(c => c.type === 'compound'); t.timeline.setState({ selectedClipIds: [p.id, 'outside'] }) })
    const parentId = parent(await state()).id, selectedTile = page.locator(`[data-clip-id="${parentId}"]`).first()
    await selectedTile.click({ button: 'right', position: { x: 35, y: 16 } })
    assert.equal(await page.getByTestId('compound-uncompound-open').isDisabled(), true, 'UI does not offer a batch Uncompound')
    await page.keyboard.press('Escape')

    // 12. Verified source-cache reuse survives the changed IDs in Undo/Redo.
    // The blue video is a deterministic stand-in for already-generated RIFE
    // media, not an interpolation quality test or real cache-file operation.
    await seed()
    await page.evaluate(() => {
      const t = window.compoundTest
      t.timeline.setState(s => ({ clips: s.clips.map(c => c.id === 'picture' ? { ...c, frameSampling: 'optical-flow',
        opticalFlowCache: { version: 'rife_ncnn_vulkan_v46_uhd_v1', engine: 'rife-ncnn-vulkan', modelName: 'rife-v4.6',
          status: 'ready', path: 'cache/synthetic-rife.mp4', url: t.getAsset('blue').url,
          sourceStart: 0, sourceEnd: 8, targetFps: 48, sourceSignature: 'synthetic-source-verified' } } : c) }))
    })
    await create()
    const cacheBaseline = await previewFrame(3)
    const cacheCounts = pixelCounts(cacheBaseline)
    assert.ok(cacheCounts.blue > 96 * 54 / 2, `verified cache must dominate the frame, beyond the small blue overlay: ${JSON.stringify(cacheCounts)}`)
    console.log('Verified cache baseline pixel counts:', JSON.stringify(cacheCounts))
    const cacheResult = await uncompound(); assert.equal(cacheResult.result?.ok, true, cacheResult.preview.reason)
    pixelsEqual(await previewFrame(3), cacheBaseline, 'retained verified cache after Uncompound')
    for (const action of [undo, redo]) {
      await action()
      const cache = await page.evaluate(() => {
        const t = window.compoundTest, s = t.getCompoundRenderState(t.timeline.getState()), picture = s.clips.find(c => c.name === 'picture')
        return { ready: picture.opticalFlowCache?.status, url: picture.opticalFlowCache?.url, expected: t.getAsset('blue').url }
      })
      assert.equal(cache.ready, 'ready'); assert.equal(cache.url, cache.expected)
      pixelsEqual(await previewFrame(3), cacheBaseline, 'verified cache survives cross-ID Undo/Redo')
    }
    assert.deepEqual(errors, [])
    console.log('PASS 12: verified source-cache reuse and decoded paused preview survive cross-ID Uncompound/Undo/Redo')
    console.log(`PASS: all 12 Uncompound groups; no renderer exceptions (${native ? 'isolated Electron with waveform/export IPC stand-ins' : 'Chrome with in-memory export IPC stand-ins'}).`)
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
