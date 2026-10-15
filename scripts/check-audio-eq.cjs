// Dedicated synthetic fixture only, never production main or user projects.
// Native opt-in uses an isolated test host, not packaging/sandbox verification.
// Its waveform IPC stand-in avoids an independently reproduced installed
// Electron decodeAudioData crash; actual live/offline audio remains enabled.
const assert = require('node:assert/strict')
const path = require('node:path')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const eq = patch => ({ version: 1, enabled: true, lowCut: false, bassDb: 0, midDb: 0, trebleDb: 0, ...patch })
const clip = (state, id = 'eq-a') => state.clips.find(item => item.id === id)
const near = (actual, expected, label, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${label}: expected ${expected}, got ${actual}`)
const documentSnapshot = state => ({ clips: state.clips, tracks: state.tracks })

async function main() {
  const native = process.env.VELORN_TEST_ELECTRON === '1'
  const browser = native
    ? await _electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')] })
    : await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true })
  try {
    const page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    page.setDefaultTimeout(15000)
    const errors = []
    page.on('pageerror', error => { errors.push(error.message); console.error('Renderer:', error.message) })
    await page.goto((process.env.VELORN_TEST_URL || 'http://127.0.0.1:5184') + '/tests/fixtures/audio-eq.html' + (native ? '?nativeWaveformStub=1' : ''))
    await page.waitForFunction(() => Boolean(window.audioEqTest?.timeline.getState().updateAudioEq), null, { polling: 100 })
    const settle = () => page.waitForTimeout(100)
    const state = () => page.evaluate(() => {
      const t = window.audioEqTest, s = t.timeline.getState()
      return JSON.parse(JSON.stringify({ clips: s.clips, tracks: s.tracks, selectedClipIds: s.selectedClipIds,
        history: s.history, historyIndex: s.historyIndex, clipCounter: s.clipCounter, dirty: t.isProjectDirty() }))
    })
    const preview = () => page.evaluate(() => {
      const t = window.audioEqTest, p = t.preview.getState()
      return { clipId: p.clip?.id || null, eq: p.eq, current: p.clip === t.timeline.getState().clips.find(c => c.id === 'eq-a') }
    })
    const seed = async ({ audioEq, ...options } = {}) => {
      await page.mouse.up()
      await page.evaluate(({ audioEq, options }) => {
        const t = window.audioEqTest
        t.reset(options)
        if (audioEq) t.timeline.setState(s => ({ clips: s.clips.map(c => c.id === 'eq-a' ? { ...c, audioEq } : c) }))
        t.markProjectClean()
      }, { audioEq, options })
      await settle()
    }
    const apiUpdate = (audioEq, id = 'eq-a') => page.evaluate(({ audioEq, id }) => window.audioEqTest.timeline.getState().updateAudioEq(id, audioEq), { audioEq, id })
    const undo = () => page.evaluate(() => window.audioEqTest.timeline.getState().undo())
    const redo = () => page.evaluate(() => window.audioEqTest.timeline.getState().redo())
    const input = band => page.getByTestId(`audio-eq-${band}-input`)
    const slider = band => page.getByTestId(`audio-eq-${band}-slider`)
    const typeBand = async (band, value) => { await input(band).fill(String(value)); await input(band).press('Enter'); await settle() }
    const beginDrag = async (band = 'mid', fraction = 0.75) => {
      const element = slider(band)
      await element.scrollIntoViewIfNeeded()
      const box = await element.boundingBox(); assert.ok(box && box.width > 60)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2, { steps: 4 })
      await settle()
      return box
    }

    // 1. Numeric bands, fixed low cut, bypass and reset are clip settings;
    // none replace gain/fades/envelope or write no-op checkpoints.
    await seed()
    const initial = await state()
    await input('bass').focus(); await input('bass').blur(); await settle()
    assert.deepEqual(await state(), initial, 'focus/blur without edits does not create EQ or history')
    await typeBand('bass', 4.5); await typeBand('mid', -2); await typeBand('treble', 3)
    await page.getByTestId('audio-eq-low-cut').click(); await settle()
    let authored = await state()
    assert.deepEqual(clip(authored).audioEq, eq({ lowCut: true, bassDb: 4.5, midDb: -2, trebleDb: 3 }))
    assert.equal(authored.history.length, 4)
    for (const key of ['gainDb', 'fadeIn', 'fadeOut', 'volumeEnvelope']) assert.deepEqual(clip(authored)[key], clip(initial)[key])
    await page.getByTestId('audio-eq-bypass').click(); await settle()
    assert.equal(await page.getByTestId('audio-eq-bypass').isChecked(), true)
    assert.deepEqual(clip(await state()).audioEq, { ...clip(authored).audioEq, enabled: false }, 'bypass retains authored settings')
    await page.getByTestId('audio-eq-bypass').click(); await settle()
    assert.deepEqual(clip(await state()).audioEq, clip(authored).audioEq)
    const beforeNoop = await state()
    await typeBand('bass', 4.5)
    assert.deepEqual(await state(), beforeNoop, 'same numeric value has no dirty/history mutation')
    await typeBand('bass', 13)
    assert.deepEqual(await state(), beforeNoop, 'out-of-range numeric text is refused')
    assert.match(await page.getByTestId('audio-eq-status').innerText(), /12|range|level/i)
    await page.getByTestId('audio-eq-reset').click(); await settle()
    const reset = await state()
    assert.deepEqual(await page.evaluate(() => window.audioEqTest.normalizeAudioEq(window.audioEqTest.timeline.getState().clips.find(c => c.id === 'eq-a').audioEq)), eq())
    assert.equal(reset.history.length, 7)
    const noop = await apiUpdate(eq())
    assert.equal(noop.ok, true); assert.equal(noop.changed, false); assert.deepEqual(await state(), reset)
    console.log('PASS 1: numeric EQ/low cut, retained bypass settings, reset, and no-op history preserve gain/fades/envelope')

    // 2. Range gestures audition outside the document, committing one undo.
    await seed()
    const dragOriginal = await state()
    await beginDrag()
    const draft = await preview()
    assert.equal(draft.clipId, 'eq-a'); assert.equal(draft.current, true)
    assert.ok(draft.eq.midDb > 3 && draft.eq.midDb < 10)
    assert.deepEqual(await state(), dragOriginal, 'range draft is not project data or dirty history')
    await page.mouse.up(); await settle()
    const committed = await state()
    near(clip(committed).audioEq.midDb, draft.eq.midDb, 'release commits the displayed draft')
    assert.equal(committed.history.length, 1); assert.equal((await preview()).clipId, null)
    await undo(); assert.deepEqual(documentSnapshot(await state()), documentSnapshot(dragOriginal))
    await redo(); assert.deepEqual(documentSnapshot(await state()), documentSnapshot(committed))
    for (const cancellation of ['Escape', 'blur', 'pointercancel']) {
      await seed(); const before = await state(); const box = await beginDrag()
      if (cancellation === 'Escape') await page.keyboard.press('Escape')
      else if (cancellation === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')))
      else await slider('mid').dispatchEvent('pointercancel', { pointerId: 1 })
      await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 3 })
      await page.mouse.up(); await settle()
      assert.deepEqual(await state(), before, `${cancellation} cancels audition without history`)
      assert.equal((await preview()).clipId, null)
    }
    await seed()
    const beforeDirectFocus = await state()
    await input('bass').fill('5')
    await beginDrag('mid')
    const duringDirectFocus = await state()
    near(clip(duringDirectFocus).audioEq.bassDb, 5, 'direct slider focus commits prior edited numeric field')
    near(clip(duringDirectFocus).audioEq.midDb, 0, 'new slider value stays transient after prior field commit')
    assert.equal(duringDirectFocus.history.length, 1)
    assert.equal((await preview()).current, true, 'slider audition uses the newly committed clip identity')
    await page.mouse.up(); await settle()
    assert.equal((await state()).history.length, 2)
    assert.ok(clip(await state()).audioEq.midDb > 3)
    await undo(); assert.deepEqual(documentSnapshot(await state()), documentSnapshot(duringDirectFocus))
    await undo(); assert.deepEqual(documentSnapshot(await state()), documentSnapshot(beforeDirectFocus))
    await seed()
    const beforeInvalidFocus = await state()
    await input('bass').fill('13'); await beginDrag('mid'); await page.mouse.up(); await settle()
    assert.deepEqual(await state(), beforeInvalidFocus, 'invalid prior numeric field blocks slider without history')
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.testid), 'audio-eq-bass-input', 'refused slider leaves invalid numeric field focused')
    await input('bass').fill('5'); await input('bass').press('Enter'); await settle()
    near(clip(await state()).audioEq.bassDb, 5, 'correcting still-focused invalid field commits normally')
    assert.equal((await state()).history.length, 1)
    console.log('PASS 2: slider audition is transient, release commits one undo, and Escape/blur/pointercancel discard drafts')

    // 3. Keyboard range repeats are one gesture. Text/editor keys cannot
    // invoke timeline playback/deletion; ordinary timeline undo remains.
    await seed()
    const keyboardOriginal = await state()
    await slider('mid').focus()
    await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowRight')
    await settle()
    assert.deepEqual(await state(), keyboardOriginal)
    assert.ok((await preview()).eq.midDb > 0)
    await page.keyboard.up('ArrowRight'); await settle()
    assert.equal((await state()).history.length, 1)
    await page.getByTestId('audio-eq-bypass').focus(); await page.keyboard.press('Control+z'); await settle()
    assert.deepEqual(documentSnapshot(await state()), documentSnapshot(keyboardOriginal))
    await page.keyboard.press('Control+Shift+z'); await settle()
    const beforeTyping = await state()
    await input('mid').fill('7')
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await input('mid').blur(); await settle()
    assert.deepEqual(await state(), beforeTyping, 'window blur discards pending numeric text even when the input later blurs')
    await input('mid').focus(); await page.keyboard.press('Delete'); await page.keyboard.press('j'); await page.keyboard.press('k'); await page.keyboard.press('l')
    await page.keyboard.press('Escape'); await settle()
    assert.deepEqual(await state(), beforeTyping)
    assert.equal(await page.evaluate(() => window.audioEqTest.timeline.getState().isPlaying), false)
    const typing = page.getByRole('textbox', { name: 'Typing guard' })
    await typing.fill('abc'); await typing.press('Delete'); await typing.blur()
    assert.deepEqual(await state(), beforeTyping)
    await seed()
    // Native range value changes may arrive from accessibility controls
    // without any preceding pointer or navigation-key event.
    const inputOnly = async value => slider('mid').evaluate((element, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, String(value))
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
    await slider('mid').focus(); await inputOnly(6); await settle()
    near(clip(await state()).audioEq.midDb, 6, 'focused input-only slider change is accepted')
    assert.equal((await state()).history.length, 1)
    await seed(); await beginDrag(); await page.keyboard.press('Escape'); await page.mouse.up(); await settle()
    await typing.focus(); await slider('mid').focus(); await inputOnly(-3); await settle()
    near(clip(await state()).audioEq.midDb, -3, 'ordinary refocus after cancellation allows a new input-only change')
    assert.equal((await state()).history.length, 1)
    console.log('PASS 3: keyboard audition commits once, Undo/Redo remains available, and editing keys do not trigger timeline actions')

    // 4. Strict API boundaries and stale gesture cancellation.
    await seed()
    const legacyFlat = await state()
    assert.equal((await apiUpdate(eq())).changed, false)
    assert.deepEqual(await state(), legacyFlat, 'legacy absent EQ and canonical flat EQ are a no-op')
    for (const invalid of [eq({ bassDb: -13 }), eq({ midDb: '2' }), eq({ enabled: 'true' }), eq({ lowCut: 1 }), eq({ version: 2 })]) {
      const before = await state(), result = await apiUpdate(invalid)
      assert.equal(result.ok, false); assert.ok(result.reason); assert.deepEqual(await state(), before)
    }
    const lockedBefore = await state(), locked = await apiUpdate(eq({ bassDb: 6 }), 'locked-audio')
    assert.equal(locked.ok, false); assert.deepEqual(await state(), lockedBefore)
    await page.evaluate(() => {
      const t = window.audioEqTest
      t.pendingClip = t.timeline.getState().clips.find(c => c.id === 'eq-a')
      t.timeline.setState(s => ({ clips: s.clips.map(c => c.id === 'eq-a' ? { ...c, name: 'Externally changed' } : c) }))
      t.markProjectClean()
    })
    const staleBefore = await state()
    const stale = await page.evaluate(audioEq => {
      const t = window.audioEqTest
      return t.timeline.getState().updateAudioEq('eq-a', audioEq, true, t.pendingClip)
    }, eq({ bassDb: 3 }))
    assert.equal(stale.ok, false); assert.deepEqual(await state(), staleBefore)
    await seed(); await beginDrag()
    await page.evaluate(() => {
      const t = window.audioEqTest
      t.timeline.setState(s => ({ clips: s.clips.map(c => c.id === 'eq-a' ? { ...c, name: 'Changed during audition' } : c) }))
      t.markProjectClean()
    })
    await settle(); const afterExternal = await state()
    await page.mouse.up(); await settle()
    assert.deepEqual(await state(), afterExternal); assert.equal((await preview()).clipId, null)
    await seed({ selectedClipIds: ['locked-audio'] })
    if (await slider('mid').count()) assert.equal(await slider('mid').isDisabled(), true)
    console.log('PASS 4: invalid settings, locked tracks and stale clip references reject without destructive or phantom history')

    // 5. One normal linked pair is one audio target; unrelated multi-select
    // is not a hidden batch EQ operation. Selection change cancels audition.
    await seed({ selectedClipIds: ['eq-a', 'eq-b'] })
    if (await slider('mid').count()) assert.equal(await slider('mid').isDisabled(), true)
    assert.equal((await state()).history.length, 0)
    await seed()
    await page.evaluate(() => {
      const t = window.audioEqTest
      t.timeline.setState(s => ({ clips: [...s.clips.map(c => c.id === 'eq-a' ? { ...c, linkGroupId: 'eq-linked' } : c),
        t.makeClip('linked-picture', { type: 'video', trackId: 'video-1', assetId: null, url: null, linkGroupId: 'eq-linked', volumeEnvelope: undefined })],
      selectedClipIds: ['eq-a', 'linked-picture'] }))
      t.markProjectClean()
    })
    await settle(); const linkedBefore = await state()
    await typeBand('mid', 6)
    assert.deepEqual(clip(await state(), 'linked-picture'), clip(linkedBefore, 'linked-picture'))
    near(clip(await state()).audioEq.midDb, 6, 'linked picture/sound selection edits audio only')
    await seed(); await beginDrag()
    await page.evaluate(() => window.audioEqTest.timeline.setState({ selectedClipIds: ['eq-b'] }))
    await settle(); const selected = await state()
    await page.mouse.up(); await settle()
    assert.deepEqual(await state(), selected); assert.equal((await preview()).clipId, null)
    console.log('PASS 5: linked A/V selection targets sound only; unrelated batches and changed selection cannot receive draft EQ')

    // 6. Canonical settings survive one undo/redo and the JSON project path.
    const authoredEq = eq({ enabled: false, lowCut: true, bassDb: -4.5, midDb: 3, trebleDb: 7 })
    await seed(); const beforeApi = await state()
    const result = await apiUpdate(authoredEq)
    assert.equal(result.ok, true); assert.equal(result.changed, true)
    const saved = await state(); assert.equal(saved.history.length, 1)
    assert.deepEqual(clip(saved).audioEq, authoredEq)
    assert.equal((await apiUpdate(authoredEq)).changed, false); assert.deepEqual(await state(), saved)
    await undo(); assert.deepEqual(documentSnapshot(await state()), documentSnapshot(beforeApi))
    await redo(); assert.deepEqual(documentSnapshot(await state()), documentSnapshot(saved))
    const restored = await page.evaluate(() => {
      const t = window.audioEqTest, s = t.timeline.getState(), document = JSON.parse(JSON.stringify(s.getProjectData()))
      s.loadFromProject(document, t.assets.getState().assets, 24)
      return t.timeline.getState().clips.find(c => c.id === 'eq-a').audioEq
    })
    assert.deepEqual(restored, authoredEq)
    console.log('PASS 6: bypassed EQ settings retain exact values through API no-op, one Undo/Redo and JSON save/load')

    // 7. Timeline changes never silently reset, share or retime static EQ.
    await seed({ audioEq: authoredEq })
    await page.evaluate(() => {
      const s = window.audioEqTest.timeline.getState()
      s.updateClipTrim('eq-a', { startTime: 2, duration: 7, trimStart: 3, trimEnd: 10 })
      s.moveClip('eq-a', 'audio-1', 3, false)
    })
    assert.deepEqual(clip(await state()).audioEq, authoredEq)
    await seed({ audioEq: authoredEq, playheadPosition: 5 })
    const splitBefore = await state(), shortcut = await page.evaluate(() => window.audioEqTest.splitHotkey())
    await page.keyboard.press(shortcut.replace(/Ctrl/g, 'Control')); await settle()
    const split = await state(), right = split.clips.find(c => c.trackId === 'audio-1' && c.id !== 'eq-a')
    assert.ok(right); assert.deepEqual(right.audioEq, authoredEq); assert.deepEqual(clip(split).audioEq, authoredEq)
    assert.equal(split.history.length, 1)
    await undo(); assert.deepEqual(documentSnapshot(await state()), documentSnapshot(splitBefore))
    await seed({ audioEq: authoredEq })
    await page.evaluate(() => {
      const t = window.audioEqTest, s = t.timeline.getState()
      s.copySelectedClips(); s.pasteClipsAtPlayhead('audio-1', 10, t.assets.getState().assets)
    })
    const pasted = await state(), copy = pasted.clips.find(c => c.trackId === 'audio-1' && c.id !== 'eq-a')
    assert.ok(copy); assert.deepEqual(copy.audioEq, authoredEq)
    assert.equal(await page.evaluate(() => {
      const clips = window.audioEqTest.timeline.getState().clips.filter(c => c.trackId === 'audio-1')
      return clips[0].audioEq !== clips[1].audioEq
    }), true)
    await seed({ audioEq: authoredEq })
    await page.evaluate(() => {
      const t = window.audioEqTest
      t.timeline.getState().addClip('audio-1', t.asset, 3, 24, { duration: 2, trimStart: 0, trimEnd: 2 })
    })
    const retainedRight = (await state()).clips.find(c => c.trackId === 'audio-1' && c.startTime === 5)
    assert.ok(retainedRight); assert.deepEqual(retainedRight.audioEq, authoredEq)
    console.log('PASS 7: trim/move/split/copy/overwrite preserve clip EQ, copied settings are independent, and split is one undo')

    // 8. Mixed-audio cache signatures include EQ but never audition drafts.
    await seed()
    const signatures = await page.evaluate(audioEq => {
      const t = window.audioEqTest, s = t.timeline.getState(), assets = t.assets.getState().assets
      const before = t.computePreviewSignature('eq-signature', { ...s, assets })
      t.preview.getState().setPreview(s.clips.find(c => c.id === 'eq-a'), audioEq)
      const draft = t.computePreviewSignature('eq-signature', { ...t.timeline.getState(), assets })
      t.preview.getState().clearPreview()
      const changed = t.computePreviewSignature('eq-signature', { ...s, clips: s.clips.map(c => c.id === 'eq-a' ? { ...c, audioEq } : c), assets })
      return { before, draft, changed }
    }, eq({ bassDb: 8 }))
    assert.equal(signatures.before, signatures.draft); assert.notEqual(signatures.before, signatures.changed)
    console.log('PASS 8: authored EQ invalidates mixed-audio caches while transient auditions never enter project signatures')

    // 9. Real rendered samples from the BiquadFilter graph agree with the
    // separate coefficient path used by native export, including low rates.
    const offline = await page.evaluate(async () => {
      const t = window.audioEqTest, results = []
      const flat = { version: 1, enabled: true, lowCut: false, bassDb: 0, midDb: 0, trebleDb: 0 }
      const settings = [flat, { ...flat, enabled: false, lowCut: true, bassDb: 12, midDb: -12, trebleDb: 12 },
        { ...flat, lowCut: true, bassDb: 12, midDb: -12, trebleDb: 12 },
        { ...flat, bassDb: -12, midDb: 12, trebleDb: -12 }, { ...flat, lowCut: true }]
      for (const sampleRate of [8000, 44100, 48000]) {
        for (const [index, audioEq] of settings.entries()) {
          const channels = index % 2 + 1, frames = Math.round(sampleRate * 0.4)
          const context = new OfflineAudioContext(channels, frames, sampleRate)
          const buffer = context.createBuffer(channels, frames, sampleRate)
          for (let channel = 0; channel < channels; channel++) {
            const data = buffer.getChannelData(channel)
            for (let frame = 0; frame < frames; frame++) {
              const time = frame / sampleRate, phase = channel * 0.31
              data[frame] = 0.025 * Math.sin(2 * Math.PI * 37 * time + phase)
                + 0.02 * Math.sin(2 * Math.PI * 1000 * time + phase)
                + 0.01 * Math.sin(2 * Math.PI * Math.min(10000, sampleRate * 0.31) * time + phase)
            }
          }
          const source = context.createBufferSource(), chain = t.createAudioEqChain(context, audioEq)
          source.buffer = buffer; source.connect(chain.input); chain.output.connect(context.destination); source.start()
          const rendered = await context.startRendering()
          let maximumError = 0
          for (let channel = 0; channel < channels; channel++) {
            let expected = Float64Array.from(buffer.getChannelData(channel))
            for (const { b0, b1, b2, a1, a2 } of t.getAudioEqCoefficients(audioEq, sampleRate)) {
              const filtered = new Float64Array(frames)
              let x1 = 0, x2 = 0, y1 = 0, y2 = 0
              for (let frame = 0; frame < frames; frame++) {
                const x = expected[frame], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
                filtered[frame] = y; x2 = x1; x1 = x; y2 = y1; y1 = y
              }
              expected = filtered
            }
            const actual = rendered.getChannelData(channel)
            for (let frame = 0; frame < frames; frame++) maximumError = Math.max(maximumError, Math.abs(actual[frame] - expected[frame]))
          }
          chain.dispose(); chain.dispose()
          results.push({ sampleRate, channels, audioEq, maximumError })
        }
      }
      return results
    })
    for (const result of offline) assert.ok(result.maximumError < 0.000025,
      `real offline EQ samples agree with export coefficients: ${JSON.stringify(result)}`)
    const smoothUpdate = await page.evaluate(async () => {
      const t = window.audioEqTest, sampleRate = 48000, frames = sampleRate / 2
      const context = new OfflineAudioContext(1, frames, sampleRate), buffer = context.createBuffer(1, frames, sampleRate)
      const data = buffer.getChannelData(0)
      for (let index = 0; index < frames; index++) data[index] = 0.02 * Math.sin(2 * Math.PI * 1000 * index / sampleRate)
      const audioEq = { version: 1, enabled: true, lowCut: false, bassDb: 0, midDb: 12, trebleDb: 0 }
      const chain = t.createAudioEqChain(context, audioEq), input = chain.input, output = chain.output, source = context.createBufferSource()
      source.buffer = buffer; source.connect(chain.input); chain.output.connect(context.destination); source.start()
      const paused = context.suspend(0.125), rendering = context.startRendering()
      await paused
      chain.update({ ...audioEq, enabled: false })
      const sameEndpoints = chain.input === input && chain.output === output
      await context.resume()
      const rendered = (await rendering).getChannelData(0)
      const rms = (start, end) => {
        let sum = 0, count = 0
        for (let index = Math.round(start * sampleRate); index < end * sampleRate; index++) { sum += rendered[index] ** 2; count++ }
        return Math.sqrt(sum / count)
      }
      const result = { sameEndpoints, boostedDb: 20 * Math.log10(rms(0.025, 0.1) / (0.02 / Math.SQRT2)),
        bypassDb: 20 * Math.log10(rms(0.35, 0.45) / (0.02 / Math.SQRT2)) }
      chain.dispose()
      return result
    })
    assert.equal(smoothUpdate.sameEndpoints, true)
    near(smoothUpdate.boostedDb, 12, 'offline initialized mid boost', 0.03)
    near(smoothUpdate.bypassDb, 0, 'in-place bypass update settles to unity', 0.03)
    console.log('PASS 9: real OfflineAudioContext sample parity with export coefficients at8/44.1/48k, mono/stereo, bypass, low cut and extreme combined bands')

    // 10. Audition changes the real live graph, not the project. The track
    // analyser is before the muted monitor, so no sound reaches speakers.
    await seed()
    const liveBefore = await state()
    const live = await page.evaluate(async () => {
      const t = window.audioEqTest, levels = {}, started = performance.now()
      const target = t.timeline.getState().clips.find(c => c.id === 'eq-a')
      const sample = async key => {
        const readings = []
        for (let index = 0; index < 10; index++) {
          await new Promise(resolve => setTimeout(resolve, 50))
          t.timeline.setState({ playheadPosition: 2 + (performance.now() - started) / 1000 })
          if (index >= 5) readings.push(t.readAnalyserRmsDb(t.getTrackAnalyser('audio-1')))
        }
        levels[key] = readings.reduce((sum, value) => sum + value, 0) / readings.length
      }
      t.timeline.setState({ playheadPosition: 2, isPlaying: true })
      try {
        await sample('baseline')
        t.preview.getState().setPreview(target, { version: 1, enabled: true, lowCut: false, bassDb: 0, midDb: -12, trebleDb: 0 })
        await sample('audition')
        t.preview.getState().clearPreview(target)
        await sample('restored')
        t.preview.getState().setPreview({ ...target }, { version: 1, enabled: true, lowCut: false, bassDb: 0, midDb: -12, trebleDb: 0 })
        await sample('stale')
        return { levels, contextState: t.getTrackAnalyser('audio-1')?.context?.state, monitor: t.assets.getState().volume }
      } finally { t.preview.getState().clearPreview(); t.timeline.setState({ isPlaying: false }) }
    })
    assert.equal(live.monitor, 0); assert.equal(live.contextState, 'running'); assert.ok(live.levels.baseline > -60)
    near(live.levels.audition - live.levels.baseline, -12, 'live transient Mid cut at1kHz', 1)
    near(live.levels.restored, live.levels.baseline, 'clearing audition restores real live sound', 1)
    near(live.levels.stale, live.levels.baseline, 'stale preview object cannot affect current live clip', 1)
    assert.deepEqual(await state(), liveBefore, 'audition never mutates project clips, dirty state or undo history')
    console.log('PASS 10: actual muted live graph auditions -12dB at1kHz and restores sound without project/history mutation')

    await seed({ audioEq: eq({ bassDb: 3, midDb: -2, trebleDb: 1 }) })
    await page.getByTestId('audio-eq-inspector').scrollIntoViewIfNeeded()
    const inspector = page.getByTestId('eq-fixture-inspector')
    for (const width of [350, 300]) {
      await inspector.evaluate((element, value) => { element.style.width = `${value}px` }, width)
      await settle()
      const layout = await page.getByTestId('audio-eq-inspector').evaluate(element => {
        const root = element.getBoundingClientRect()
        return { scroll: element.scrollWidth, width: element.clientWidth, controls: [...element.querySelectorAll('button,input')].map(control => {
          const box = control.getBoundingClientRect()
          return { id: control.dataset.testid || control.tagName, left: box.left - root.left, right: box.right - root.left }
        }) }
      })
      assert.ok(layout.scroll <= layout.width + 1, `${width}px EQ section does not overflow`)
      for (const control of layout.controls) assert.ok(control.left >= -1 && control.right <= layout.width + 1, `${control.id} fits ${width}px Inspector`)
    }
    if (process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT })
    if (native) assert.ok(await page.evaluate(() => window.audioEqTest.getNativeWaveformCalls()) > 0)
    assert.deepEqual(errors, [])
    console.log(`PASS: clip EQ integration plus narrow Inspector layout; no renderer exceptions (${native ? 'isolated Electron with waveform IPC stand-in' : 'headless Chrome'}).`)
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
