// Isolated real Timeline/Inspector/store checks using a generated local WAV.
// Start the dedicated Vite server first (default :5184). Never opens projects
// or production main. Native is explicit opt-in; Playwright's Electron host
// launch is test-only and is not production sandbox/packaging verification.
// Native waveform peaks use the fixture's main-process IPC stand-in because
// installed Electron crashes in bare decodeAudioData on valid PCM WAV data.
// The real AudioLayerRenderer and rendered OfflineAudioContext checks stay on.
const assert = require('node:assert/strict')
const path = require('node:path')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`)
const byId = (state, id = 'envelope-a') => state.clips.find(clip => clip.id === id)
const curve = (points = [{ id: 'p0', time: 0, db: 0 }, { id: 'p4', time: 4, db: -12 }, { id: 'p8', time: 8, db: 0 }], offsetSeconds = 0) => ({ version: 1, offsetSeconds, points })
const timing = clip => ({ id: clip.id, trackId: clip.trackId, assetId: clip.assetId, startTime: clip.startTime,
  duration: clip.duration, trimStart: clip.trimStart, trimEnd: clip.trimEnd, speed: clip.speed,
  gainDb: clip.gainDb, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut, volumeEnvelope: clip.volumeEnvelope })
const documentSnapshot = state => ({ clips: state.clips.map(timing), tracks: state.tracks, markers: state.markers, transitions: state.transitions })

async function main() {
  const native = process.env.VELORN_TEST_ELECTRON === '1'
  const browser = native
    ? await _electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')] })
    : await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true })
  try {
    const page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.setDefaultTimeout(15000)
    const errors = []
    page.on('pageerror', error => { errors.push(error.message); console.error('Renderer:', error.message) })
    await page.goto((process.env.VELORN_TEST_URL || 'http://127.0.0.1:5184') + '/tests/fixtures/audio-volume-envelope.html' + (native ? '?nativeWaveformStub=1' : ''))
    await page.waitForFunction(() => Boolean(window.audioVolumeEnvelopeTest?.timeline.getState().updateAudioVolumeEnvelope), null, { polling: 100 })
    const settle = () => page.waitForTimeout(100)
    const state = () => page.evaluate(() => {
      const t = window.audioVolumeEnvelopeTest, s = t.timeline.getState()
      return JSON.parse(JSON.stringify({ clips: s.clips, tracks: s.tracks, markers: s.markers, transitions: s.transitions,
        selectedClipIds: s.selectedClipIds, history: s.history, historyIndex: s.historyIndex,
        clipCounter: s.clipCounter, playheadPosition: s.playheadPosition, dirty: t.isProjectDirty() }))
    })
    const seed = async ({ envelope, ...options } = {}) => {
      await page.mouse.up()
      await page.evaluate(({ envelope, options }) => {
        const t = window.audioVolumeEnvelopeTest
        t.reset(options)
        if (envelope) t.timeline.setState(s => ({ clips: s.clips.map(clip => clip.id === 'envelope-a' ? { ...clip, volumeEnvelope: envelope } : clip) }))
        t.markProjectClean()
      }, { envelope, options })
      await settle()
    }
    const enable = async () => {
      const toggle = page.getByTestId('audio-envelope-edit')
      await toggle.scrollIntoViewIfNeeded()
      if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click()
      await settle()
    }
    const point = id => page.locator(`[data-testid="audio-envelope-point"][data-envelope-point-id="${id}"]`).first()
    const editNumber = async (id, value) => {
      const input = page.getByTestId(id)
      await input.fill(String(value)); await input.press('Enter'); await settle()
    }
    const addAt = async localTime => {
      await page.evaluate(time => window.audioVolumeEnvelopeTest.timeline.setState({ playheadPosition: 1 + time }), localTime)
      await settle(); await page.getByTestId('audio-envelope-add').click(); await settle()
    }
    const undo = () => page.evaluate(() => window.audioVolumeEnvelopeTest.timeline.getState().undo())
    const redo = () => page.evaluate(() => window.audioVolumeEnvelopeTest.timeline.getState().redo())
    const apiUpdate = (envelope, id = 'envelope-a') => page.evaluate(({ envelope, id }) => {
      const t = window.audioVolumeEnvelopeTest
      return t.timeline.getState().updateAudioVolumeEnvelope(id, envelope)
    }, { envelope, id })
    const dragStart = async id => {
      const handle = point(id); await handle.scrollIntoViewIfNeeded()
      const box = await handle.boundingBox(); assert.ok(box)
      const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      await page.mouse.move(start.x, start.y); await page.mouse.down()
      return start
    }

    // 1. Passive display does not opt into editing; explicit controls author
    // a point and a numeric level without replacing clip gain or fades.
    await seed()
    const initial = await state()
    await enable()
    assert.deepEqual(await state(), initial, 'enabling the editor is UI-only')
    await addAt(2)
    let authored = await state(), points = byId(authored).volumeEnvelope.points
    assert.equal(points.length, 1); near(points[0].time, 2, 'point at local playhead'); near(points[0].db, 0, 'new envelope starts at unity')
    assert.equal(authored.history.length, 1)
    await editNumber('audio-envelope-db', -12)
    authored = await state(); near(byId(authored).volumeEnvelope.points[0].db, -12, 'numeric point level')
    near(byId(authored).gainDb, -3, 'existing clip gain'); near(byId(authored).fadeIn, 0.2, 'existing fade in'); near(byId(authored).fadeOut, 0.3, 'existing fade out')
    const numericBefore = await state()
    await editNumber('audio-envelope-db', -12)
    assert.deepEqual(await state(), numericBefore, 'unchanged numeric commit has no history or dirty mutation')
    await editNumber('audio-envelope-db', -61)
    assert.deepEqual(await state(), numericBefore, 'invalid numeric dB does not change the envelope/history')
    assert.match(await page.getByTestId('audio-envelope-status').innerText(), /-60|level/i)
    console.log('PASS 1: explicit editor, playhead point, numeric dB, existing gain/fades preserved, and no-op input history')

    // 2. Line double-click and exact local-time input share frame snapping.
    await seed({ envelope: curve() }); await enable()
    const line = page.getByTestId('audio-envelope-line').first(), lineBox = await line.boundingBox()
    assert.ok(lineBox && lineBox.width > 100)
    await line.dblclick({ position: { x: lineBox.width * 0.25, y: Math.max(1, lineBox.height / 2) } })
    await settle()
    authored = await state(); assert.equal(byId(authored).volumeEnvelope.points.length, 4)
    const newPoint = byId(authored).volumeEnvelope.points.find(p => !['p0', 'p4', 'p8'].includes(p.id))
    assert.ok(newPoint)
    near(newPoint.db, -3 * newPoint.time, 'double-click inherits interpolated dB, preserving the current curve')
    await editNumber('audio-envelope-time', 2.08)
    authored = await state()
    near(byId(authored).volumeEnvelope.points.find(p => p.id === newPoint.id).time, 50 / 24, 'numeric local time snaps to a timeline frame')
    assert.equal(authored.history.length, 2)
    console.log('PASS 2: waveform line adds an interpolated point and exact time input snaps to timeline frames')

    // 3. Pointer moves are drafts. Release commits one change; Escape/blur
    // cancel without rewriting timeline data or leaving a phantom undo.
    await seed({ envelope: curve() }); await enable()
    const noMoveOriginal = await state()
    await point('p4').click(); await settle()
    assert.deepEqual(await state(), noMoveOriginal, 'click without movement does not create a drag history entry')
    const dragOriginal = await state(), first = await dragStart('p4')
    await page.mouse.move(first.x + 50, first.y + 8, { steps: 4 }); await settle()
    assert.deepEqual(await state(), dragOriginal, 'drag remains local until pointerup')
    await page.mouse.up(); await settle()
    const moved = await state(), movedPoint = byId(moved).volumeEnvelope.points.find(p => p.id === 'p4')
    near(movedPoint.time, 5, 'drag moves by one second at 50 pixels per second')
    assert.ok(movedPoint.db < -12 && movedPoint.db >= -60)
    assert.equal(moved.history.length, 1)
    await undo(); assert.deepEqual(documentSnapshot(await state()), documentSnapshot(dragOriginal))
    for (const cancel of ['Escape', 'blur']) {
      await seed({ envelope: curve() }); await enable()
      const before = await state(), origin = await dragStart('p4')
      await page.mouse.move(origin.x + 30, origin.y + 5)
      if (cancel === 'Escape') await page.keyboard.press('Escape')
      else await page.evaluate(() => window.dispatchEvent(new Event('blur')))
      await page.mouse.up(); await settle()
      assert.deepEqual(await state(), before, `${cancel} cancels the draft without history`)
    }
    console.log('PASS 3: drag is draft-only, commits once on release, and Escape/blur cancel cleanly')

    // 4. Point keyboard deletion is scoped to the editor. Ordinary text and
    // timeline selection must not become accidental envelope operations.
    await seed({ envelope: curve() }); await enable(); await point('p4').click()
    const deleteOriginal = await state()
    const typing = page.getByRole('textbox', { name: 'Typing guard' })
    await typing.fill('abc'); await typing.press('Delete'); await typing.blur()
    assert.deepEqual(await state(), deleteOriginal)
    await page.getByTestId('audio-envelope-delete').click(); await settle()
    let deleted = await state()
    assert.equal(byId(deleted).volumeEnvelope.points.length, 2)
    assert.equal(deleted.clips.length, deleteOriginal.clips.length)
    assert.equal(deleted.history.length, 1)
    await page.getByTestId('audio-envelope-clear').focus(); await page.keyboard.press('Control+z'); await settle()
    assert.equal(byId(await state()).volumeEnvelope.points.length, 3, 'focused envelope button preserves normal timeline Undo')
    await page.keyboard.press('Control+Shift+z'); await settle()
    assert.equal(byId(await state()).volumeEnvelope.points.length, 2, 'focused envelope button preserves normal timeline Redo')
    await point('p8').focus(); await page.keyboard.press('Delete'); await settle()
    deleted = await state()
    assert.equal(byId(deleted).volumeEnvelope.points.length, 1, 'Delete on a focused envelope point removes only that point')
    assert.equal(deleted.clips.length, deleteOriginal.clips.length)
    assert.equal(deleted.history.length, 2)
    await page.getByTestId('audio-envelope-clear').click(); await settle()
    deleted = await state(); assert.equal(byId(deleted).volumeEnvelope?.points?.length || 0, 0)
    near(byId(deleted).gainDb, -3, 'clear preserves base gain')
    assert.equal(deleted.history.length, 3)
    console.log('PASS 4: typing guard, point deletion, and clear leave the underlying audio clip/gain intact')

    // 5. Locks, batch selection, invalid data and stale targets are strict
    // authoring boundaries, not silent partial success.
    await seed({ envelope: curve() })
    for (const invalid of [curve([{ id: 'bad', time: 1, db: -61 }]), curve([{ id: 'bad', time: 1, db: 13 }]),
      curve([{ id: 'same', time: 1, db: 0 }, { id: 'same', time: 2, db: -2 }]),
      curve([{ id: 'a', time: 1, db: 0 }, { id: 'b', time: 1, db: -2 }])]) {
      const before = await state(), result = await apiUpdate(invalid)
      assert.equal(result.ok, false); assert.ok(result.reason); assert.deepEqual(await state(), before)
    }
    const lockedBefore = await state(), locked = await apiUpdate(curve(), 'locked-audio')
    assert.equal(locked.ok, false); assert.deepEqual(await state(), lockedBefore)
    await page.evaluate(() => {
      const t = window.audioVolumeEnvelopeTest
      t.pendingClip = t.timeline.getState().clips.find(c => c.id === 'envelope-a')
      t.timeline.setState(s => ({ clips: s.clips.map(c => c.id === 'envelope-a' ? { ...c, name: 'Changed while editing' } : c) }))
      t.markProjectClean()
    })
    const staleBefore = await state()
    const stale = await page.evaluate(envelope => {
      const t = window.audioVolumeEnvelopeTest
      return t.timeline.getState().updateAudioVolumeEnvelope('envelope-a', envelope, true, t.pendingClip)
    }, curve([{ id: 'replacement', time: 1, db: -20 }]))
    assert.equal(stale.ok, false); assert.deepEqual(await state(), staleBefore)
    await seed({ selectedClipIds: ['envelope-a', 'envelope-b'] })
    const batch = await page.getByTestId('audio-envelope-edit').count()
    if (batch) assert.equal(await page.getByTestId('audio-envelope-edit').isDisabled(), true)
    assert.equal((await state()).history.length, 0)
    await seed({ envelope: curve([{ id: 'off-frame', time: 0.123456789, db: -6 }, { id: 'later', time: 4, db: -12 }]) }); await enable()
    const beforeFocus = await state()
    await page.getByTestId('audio-envelope-time').focus(); await page.getByTestId('audio-envelope-time').blur(); await settle()
    assert.deepEqual(await state(), beforeFocus, 'focusing/blurring an imported off-frame point does not quantize it or add history')
    console.log('PASS 5: invalid points, locked clips, stale references, and batch selection cannot silently author an envelope')

    // 6. Normalized point ordering is stable, and the existing undo/project
    // paths retain version/offset/hidden coordinates without a new file type.
    await seed()
    const undoOriginal = await state()
    const unordered = curve([{ id: 'late', time: 8, db: -2 }, { id: 'early', time: -1, db: -8 }, { id: 'mid', time: 3, db: 0 }], 0.5)
    const update = await apiUpdate(unordered)
    assert.equal(update.ok, true); assert.equal(update.changed, true)
    const saved = await state()
    assert.deepEqual(byId(saved).volumeEnvelope.points.map(p => p.time), [-1, 3, 8])
    const noOp = await apiUpdate(byId(saved).volumeEnvelope)
    assert.equal(noOp.ok, true); assert.equal(noOp.changed, false)
    assert.deepEqual(await state(), saved)
    assert.equal(await undo(), true); assert.deepEqual(documentSnapshot(await state()), documentSnapshot(undoOriginal))
    assert.equal(await redo(), true); assert.deepEqual(documentSnapshot(await state()), documentSnapshot(saved))
    const roundTrip = await page.evaluate(() => {
      const t = window.audioVolumeEnvelopeTest, state = t.timeline.getState()
      const document = JSON.parse(JSON.stringify(state.getProjectData()))
      state.loadFromProject(document, t.assets.getState().assets, 24)
      return t.timeline.getState().clips.find(c => c.id === 'envelope-a').volumeEnvelope
    })
    assert.deepEqual(roundTrip, byId(saved).volumeEnvelope)
    console.log('PASS 6: normalization, no-op store updates, one undo/redo, and JSON save/load retain the exact envelope')

    // 7. Envelope coordinates are clip-local, independent of source-media
    // time. Trim preserves hidden points; moving/slipping does not retime it.
    await seed({ envelope: curve() })
    await page.evaluate(() => {
      const t = window.audioVolumeEnvelopeTest, s = t.timeline.getState()
      s.updateClipTrim('envelope-a', { startTime: 2, duration: 7, trimStart: 3, trimEnd: 10 })
    })
    let trimmed = byId(await state())
    near(trimmed.volumeEnvelope.offsetSeconds, 1, 'head trim advances envelope coordinate')
    assert.deepEqual(trimmed.volumeEnvelope.points, curve().points, 'trim keeps hidden points for later extension')
    await page.evaluate(() => window.audioVolumeEnvelopeTest.timeline.getState().updateClipTrim('envelope-a', { startTime: 1, duration: 8, trimStart: 2, trimEnd: 10 }))
    assert.deepEqual(byId(await state()).volumeEnvelope, curve(), 'extending head restores original envelope')
    await page.evaluate(() => window.audioVolumeEnvelopeTest.timeline.getState().moveClip('envelope-a', 'audio-1', 3, false))
    assert.deepEqual(byId(await state()).volumeEnvelope, curve(), 'timeline move leaves local envelope unchanged')
    await page.evaluate(() => window.audioVolumeEnvelopeTest.timeline.getState().updateClipTrim('envelope-a', { trimStart: 1, trimEnd: 9 }))
    assert.deepEqual(byId(await state()).volumeEnvelope, curve(), 'source slip leaves timeline-local envelope unchanged')
    console.log('PASS 7: reversible head trims preserve hidden points; moves and source slips do not retime the envelope')

    // 8. The real Timeline split command copies the complete envelope while
    // advancing only the right piece's local coordinate.
    await seed({ envelope: curve(), playheadPosition: 5 })
    const splitBefore = await state()
    const shortcut = await page.evaluate(() => window.audioVolumeEnvelopeTest.splitHotkey())
    assert.ok(typeof shortcut === 'string' && shortcut)
    await page.keyboard.press(shortcut.replace(/Ctrl/g, 'Control'))
    await settle()
    const splitState = await state(), left = byId(splitState)
    const right = splitState.clips.find(clip => clip.id !== 'envelope-a' && clip.trackId === 'audio-1')
    assert.ok(right, 'Timeline split creates a right-hand audio clip')
    near(left.duration, 4, 'left split duration'); near(right.startTime, 5, 'right split timeline start')
    near(left.volumeEnvelope.offsetSeconds, 0, 'left envelope origin'); near(right.volumeEnvelope.offsetSeconds, 4, 'right envelope origin')
    assert.deepEqual(left.volumeEnvelope.points, curve().points); assert.deepEqual(right.volumeEnvelope.points, curve().points)
    assert.equal(splitState.history.length, 1)
    await undo(); assert.deepEqual(documentSnapshot(await state()), documentSnapshot(splitBefore))
    console.log('PASS 8: real Timeline split preserves both envelope pieces and remains one undo')

    // 9. Clipboard reconstruction and overwrite-created right pieces are
    // distinct store paths; neither may silently lose/reset automation.
    await seed({ envelope: curve() })
    await page.evaluate(() => {
      const t = window.audioVolumeEnvelopeTest, s = t.timeline.getState()
      s.copySelectedClips(); s.pasteClipsAtPlayhead('audio-1', 10, t.assets.getState().assets)
    })
    const pasted = await state(), copy = pasted.clips.find(clip => clip.trackId === 'audio-1' && clip.id !== 'envelope-a')
    assert.ok(copy); assert.deepEqual(copy.volumeEnvelope, curve())
    const independence = await page.evaluate(() => {
      const t = window.audioVolumeEnvelopeTest, s = t.timeline.getState()
      const a = s.clips.find(c => c.id === 'envelope-a'), b = s.clips.find(c => c.trackId === 'audio-1' && c.id !== a.id)
      return { object: a.volumeEnvelope !== b.volumeEnvelope, points: a.volumeEnvelope.points !== b.volumeEnvelope.points }
    })
    assert.deepEqual(independence, { object: true, points: true })
    await seed({ envelope: curve() })
    await page.evaluate(() => {
      const t = window.audioVolumeEnvelopeTest
      t.timeline.getState().addClip('audio-1', t.asset, 3, 24, { duration: 2, trimStart: 0, trimEnd: 2 })
    })
    const overlap = await state(), retainedRight = overlap.clips.find(c => c.trackId === 'audio-1' && c.id !== 'envelope-a' && c.startTime === 5)
    assert.ok(retainedRight); near(retainedRight.volumeEnvelope.offsetSeconds, 4, 'overwrite retains right piece at original envelope coordinate')
    assert.deepEqual(retainedRight.volumeEnvelope.points, curve().points)
    console.log('PASS 9: copy/paste deep-copies automation and legacy overwrite slices preserve the right-side coordinate')

    // 10. A real silent offline render verifies continuous audio-clock ramps,
    // not just calls made to a mocked AudioParam or video-frame samples.
    const offline = await page.evaluate(async () => {
      const t = window.audioVolumeEnvelopeTest, results = []
      const sampleRate = 48000, contextTime = 0.125
      for (const playbackRate of [0.5, 1, 2]) {
        for (const [localTime, endLocalTime, offsetSeconds] of [[0, 4, 0], [0.75, 3.1, 0.25]]) {
          const clip = t.makeClip('offline', { duration: 4,
            volumeEnvelope: { version: 1, offsetSeconds, points: [{ id: 'a', time: 0, db: 0 }, { id: 'b', time: 2, db: -24 }, { id: 'c', time: 4, db: 0 }] } })
          const renderDuration = contextTime + (endLocalTime - localTime) / playbackRate + 0.1
          const context = new OfflineAudioContext(1, Math.ceil(renderDuration * sampleRate), sampleRate)
          const buffer = context.createBuffer(1, Math.ceil(renderDuration * sampleRate), sampleRate)
          buffer.getChannelData(0).fill(0.1)
          const source = context.createBufferSource(), gain = context.createGain()
          source.buffer = buffer; source.connect(gain); gain.connect(context.destination)
          t.scheduleAudioVolumeEnvelope(gain.gain, clip, { localTime, endLocalTime, contextTime, playbackRate, playing: true })
          source.start(contextTime); source.stop(contextTime + (endLocalTime - localTime) / playbackRate)
          const audio = await context.startRendering(), data = audio.getChannelData(0)
          const samples = [0.001, 0.127, 0.333, 0.653, 0.999].map(fraction => {
            const requested = localTime + (endLocalTime - localTime) * fraction
            const index = Math.round((contextTime + (requested - localTime) / playbackRate) * sampleRate)
            const local = localTime + (index / sampleRate - contextTime) * playbackRate
            return { actual: data[index], expected: 0.1 * t.getAudioVolumeEnvelopeGain(clip, local), local }
          })
          results.push({ playbackRate, localTime, endLocalTime, offsetSeconds, samples, before: data[0] })
        }
      }
      return results
    })
    for (const result of offline) {
      assert.equal(result.before, 0)
      for (const sample of result.samples) assert.ok(Math.abs(sample.actual - sample.expected) < 0.000015,
        `offline exponential amplitude/linear dB ramp at ${result.playbackRate}x, offset ${result.offsetSeconds}, local ${sample.local}: expected ${sample.expected}, got ${sample.actual}`)
    }
    console.log('PASS 10: real OfflineAudioContext samples match linear-dB envelopes at 0.5x/1x/2x, shifted origins, and partial ranges')

    // Also exercise the actual live media-element graph, not only a mounted
    // component or isolated scheduler. Its track analyser is before the
    // monitor mute, so positive signal proves playback without speaker audio.
    await seed({ envelope: curve() })
    const liveAudio = await page.evaluate(async () => {
      const t = window.audioVolumeEnvelopeTest, samples = []
      const started = performance.now()
      t.timeline.setState({ playheadPosition: 2, isPlaying: true })
      try {
        for (let index = 0; index < 10; index += 1) {
          await new Promise(resolve => setTimeout(resolve, 50))
          t.timeline.setState({ playheadPosition: 2 + (performance.now() - started) / 1000 })
          const analyser = t.getTrackAnalyser('audio-1')
          samples.push({ db: t.readAnalyserRmsDb(analyser), contextState: analyser?.context?.state || null })
        }
        return { samples, monitor: t.assets.getState().volume }
      } finally {
        t.timeline.setState({ isPlaying: false })
      }
    })
    assert.equal(liveAudio.monitor, 0, 'live playback smoke never unmutes speakers')
    assert.ok(liveAudio.samples.some(sample => sample.contextState === 'running' && sample.db > -60),
      `actual live media-element graph must produce signal before monitor mute: ${JSON.stringify(liveAudio.samples)}`)
    console.log('PASS 10b: actual AudioLayerRenderer/media-element graph plays through the envelope with nonzero pre-monitor samples and muted speakers')

    // 11. The legacy full mixed-audio proxy cannot reuse sound from before
    // an envelope edit. (Current video-only In/Out chunks play live audio.)
    const signatures = await page.evaluate(envelope => {
      const t = window.audioVolumeEnvelopeTest, s = t.timeline.getState(), id = 'synthetic-timeline'
      const before = t.computePreviewSignature(id, { ...s, assets: t.assets.getState().assets })
      const withCurve = { ...s, clips: s.clips.map(c => c.id === 'envelope-a' ? { ...c, volumeEnvelope: envelope } : c), assets: t.assets.getState().assets }
      const changed = t.computePreviewSignature(id, withCurve)
      const shifted = t.computePreviewSignature(id, { ...withCurve, clips: withCurve.clips.map(c => c.id === 'envelope-a'
        ? { ...c, volumeEnvelope: { ...c.volumeEnvelope, offsetSeconds: 0.25 } } : c) })
      return { before, changed, shifted }
    }, curve([{ id: 'proxy-a', time: 0, db: -3 }, { id: 'proxy-b', time: 8, db: -24 }]))
    assert.notEqual(signatures.before, signatures.changed)
    assert.notEqual(signatures.changed, signatures.shifted)
    console.log('PASS 11: mixed-audio preview proxy signatures invalidate for envelope point and coordinate changes')

    // 12. A normal linked picture-and-sound selection has one audio target,
    // not a batch operation. Endpoint controls must not start clip trimming.
    await seed({ envelope: curve() })
    await page.evaluate(() => {
      const t = window.audioVolumeEnvelopeTest
      t.timeline.setState(s => ({ clips: [...s.clips.map(c => c.id === 'envelope-a' ? { ...c, linkGroupId: 'linked-pair' } : c),
        t.makeClip('linked-picture', { type: 'video', trackId: 'video-1', assetId: null, url: null, linkGroupId: 'linked-pair' })],
        selectedClipIds: ['envelope-a', 'linked-picture'] }))
      t.markProjectClean()
    })
    await settle(); await enable()
    const linkedBefore = await state()
    await point('p4').click(); await editNumber('audio-envelope-db', -9)
    const linkedEdited = await state()
    near(byId(linkedEdited).volumeEnvelope.points.find(p => p.id === 'p4').db, -9, 'linked selection edits audio only')
    assert.deepEqual(byId(linkedEdited, 'linked-picture'), byId(linkedBefore, 'linked-picture'))
    assert.equal(linkedEdited.history.length, 1)
    for (const [id, pixels, expectedTime] of [['p0', 25, 0.5], ['p8', -25, 7.5]]) {
      const clipBefore = byId(await state()), origin = await dragStart(id)
      await page.mouse.move(origin.x + pixels, origin.y + 2)
      await page.mouse.up(); await settle()
      const clipAfter = byId(await state())
      near(clipAfter.volumeEnvelope.points.find(p => p.id === id).time, expectedTime, `${id} endpoint drag selects point, not trim edge`)
      for (const property of ['startTime', 'duration', 'trimStart', 'trimEnd', 'fadeIn', 'fadeOut']) near(clipAfter[property], clipBefore[property], `endpoint preserves ${property}`)
    }
    await page.evaluate(() => window.audioVolumeEnvelopeTest.timeline.setState({ playheadPosition: 0 }))
    await settle()
    const outsideBefore = await state()
    assert.equal(await page.getByTestId('audio-envelope-add').isDisabled(), true, 'outside playhead cannot add a clamped endpoint accidentally')
    assert.match(await page.getByTestId('audio-envelope-inspector').innerText(), /playhead|inside/i)
    assert.deepEqual(await state(), outsideBefore)
    console.log('PASS 12: linked A/V selection targets only sound, endpoint dragging preserves trim/fades, and out-of-clip playheads cannot add points')

    await seed({ envelope: curve() }); await enable()
    const inspector = page.getByTestId('envelope-fixture-inspector')
    for (const width of [350, 300]) {
      await inspector.evaluate((element, width) => { element.style.width = `${width}px` }, width)
      await settle()
      const layout = await page.getByTestId('audio-envelope-inspector').evaluate(element => {
        const root = element.getBoundingClientRect()
        return { scroll: element.scrollWidth, width: element.clientWidth, controls: [...element.querySelectorAll('button,input')].map(control => {
          const box = control.getBoundingClientRect()
          return { id: control.dataset.testid || control.tagName, left: box.left - root.left, right: box.right - root.left }
        }) }
      })
      assert.ok(layout.scroll <= layout.width + 1, `${width}px envelope section does not overflow`)
      for (const control of layout.controls) assert.ok(control.left >= -1 && control.right <= layout.width + 1, `${control.id} fits ${width}px Inspector`)
    }
    if (process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT })
    if (native) assert.ok(await page.evaluate(() => window.audioVolumeEnvelopeTest.getNativeWaveformCalls()) > 0, 'native waveform IPC stand-in was exercised')
    assert.deepEqual(errors, [])
    console.log(`PASS: all 12 envelope integration groups plus narrow Inspector layout; no renderer exceptions (${native ? 'isolated Electron host, native waveform IPC stand-in; real audio graph and OfflineAudioContext' : 'headless Chrome'}).`)
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
