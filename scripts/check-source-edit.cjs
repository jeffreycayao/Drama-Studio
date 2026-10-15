// Isolated real source controls, Timeline and store integration checks.
// Start a dedicated Vite server (default :5184), never a user's app/project.
// PLAYWRIGHT_MODULE_PATH / CHROME_PATH may select already-installed runtimes.
// VELORN_TEST_ELECTRON=1 opts into the test-only inspector Electron host.
// VELORN_TEST_ELECTRON_NO_SANDBOX=1 is a separate test-only opt-in for hosts
// unable to launch sandboxed Electron; it is NOT packaged-app verification.
const assert = require('node:assert/strict')
const path = require('node:path')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')

const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-6,
  `${label}: expected ${expected}, got ${actual}`)
const byId = (state, id) => state.clips.find(clip => clip.id === id)
const clipTiming = clip => ({ id: clip.id, trackId: clip.trackId, assetId: clip.assetId, type: clip.type,
  startTime: clip.startTime, duration: clip.duration, trimStart: clip.trimStart, trimEnd: clip.trimEnd,
  speed: clip.speed, sourceTimeScale: clip.sourceTimeScale, reverse: clip.reverse, linkGroupId: clip.linkGroupId })
const timingSnapshot = state => ({ clips: state.clips.map(clipTiming), tracks: state.tracks,
  markers: state.markers, transitions: state.transitions })

async function main() {
  const native = process.env.VELORN_TEST_ELECTRON === '1'
  const noSandbox = process.env.VELORN_TEST_ELECTRON_NO_SANDBOX === '1'
  if (native && noSandbox) console.warn('TEST ONLY: Electron sandbox disabled; this is not packaged-platform verification.')
  const browser = native
    ? await _electron.launch({ executablePath: require('electron'), args: [
      ...(noSandbox ? ['--no-sandbox'] : []), path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs'),
    ] })
    : await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true })
  try {
    const page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.setDefaultTimeout(15000)
    const errors = []
    page.on('pageerror', error => { errors.push(error.message); console.error('Renderer:', error.message) })
    const fixtureBase = new URL(process.env.VELORN_TEST_URL || 'http://127.0.0.1:5184')
    await page.routeWebSocket(url => url.hostname === fixtureBase.hostname && url.port === fixtureBase.port, socket => socket.close())
    await page.goto((process.env.VELORN_TEST_URL || 'http://127.0.0.1:5184') + '/tests/fixtures/source-edit.html')
    // Explicit timed polling avoids relying on RAF progress in hidden Electron.
    await page.waitForFunction(() => Boolean(window.sourceEditTest?.timeline.getState().previewSourceEdit), null, { polling: 100 })
    await page.getByTestId('source-edit-insert').waitFor()
    const settle = () => page.waitForTimeout(100)
    const state = () => page.evaluate(() => {
      const t = window.sourceEditTest, s = t.timeline.getState()
      return JSON.parse(JSON.stringify({ clips: s.clips, tracks: s.tracks, markers: s.markers,
        transitions: s.transitions, duration: s.duration, selectedClipIds: s.selectedClipIds,
        history: s.history, historyIndex: s.historyIndex, clipCounter: s.clipCounter,
        markerCounter: s.markerCounter, transitionCounter: s.transitionCounter,
        playheadPosition: s.playheadPosition, inPoint: s.inPoint, outPoint: s.outPoint,
        dirty: t.isProjectDirty() }))
    })
    const seed = async (options = {}) => {
      await page.evaluate(options => window.sourceEditTest.reset(options), options)
      await settle()
    }
    const preview = (mode = 'insert', overrides = {}) => page.evaluate(({ mode, overrides }) => {
      const t = window.sourceEditTest
      return t.timeline.getState().previewSourceEdit(t.request(mode, overrides))
    }, { mode, overrides })
    const apply = (mode = 'insert', overrides = {}) => page.evaluate(({ mode, overrides }) => {
      const t = window.sourceEditTest, request = t.request(mode, overrides), s = t.timeline.getState()
      const plan = s.previewSourceEdit(request)
      return { plan, result: s.applySourceEdit(request, plan.token) }
    }, { mode, overrides })
    const undo = () => page.evaluate(() => window.sourceEditTest.timeline.getState().undo())
    const redo = () => page.evaluate(() => window.sourceEditTest.timeline.getState().redo())
    const markRange = async (start = 1, end = 3) => {
      await page.evaluate(time => window.sourceEditTest.seekSource(time), start)
      await page.keyboard.press('i')
      await page.evaluate(time => window.sourceEditTest.seekSource(time), end)
      await page.keyboard.press('o')
      await settle()
    }
    const assertPair = (s, ids, start, duration, trimStart, trimEnd) => {
      assert.equal(ids.length, 2, 'video source creates one picture and one embedded-audio clip')
      const pair = ids.map(id => byId(s, id))
      assert.deepEqual(new Set(pair.map(clip => clip.type)), new Set(['video', 'audio']))
      assert.ok(pair[0].linkGroupId, 'new clips have a link group')
      assert.equal(pair[0].linkGroupId, pair[1].linkGroupId)
      assert.notEqual(pair[0].linkGroupId, 'existing-main')
      for (const clip of pair) {
        near(clip.startTime, start, 'inserted start'); near(clip.duration, duration, 'inserted duration')
        near(clip.trimStart, trimStart, 'source in'); near(clip.trimEnd, trimEnd, 'source out')
      }
      return pair
    }

    // 1. Real source controls retain existing range and keyboard behavior.
    await seed()
    const beforeControls = await state()
    await page.evaluate(() => window.sourceEditTest.seekSource(1))
    await page.keyboard.press('ArrowRight')
    near(await page.evaluate(() => window.sourceEditTest.sourceVideo.currentTime), 1.05, 'source-frame stepping uses 20 fps, not timeline 10 fps')
    const typing = page.getByRole('textbox', { name: 'Typing guard' })
    await typing.fill('io')
    await typing.blur()
    assert.match(await page.getByTestId('fixture-source-controls').innerText(), /full clip/i)
    await markRange()
    assert.match(await page.getByTestId('fixture-source-controls').innerText(), /00:02\.0/)
    assert.match(await page.getByTestId('source-edit-targets').innerText(), /Video 1/)
    assert.match(await page.getByTestId('source-edit-targets').innerText(), /Audio 1/)
    assert.deepEqual(await state(), beforeControls, 'range edits and preview planning do not dirty the timeline or add history')
    console.log('PASS 1: real source In/Out, source-frame stepping, typing guard, live destinations, and read-only preview')

    // 2. The visible Insert action opens space across the sequence, splitting
    // crossing media on all tracks and moving markers at/after the cut.
    const original = await state()
    await page.getByTestId('source-edit-insert').click()
    await settle()
    const inserted = await state()
    assertPair(inserted, inserted.selectedClipIds, 2, 2, 1, 3)
    for (const id of ['main-video', 'main-audio', 'overlay']) {
      const left = byId(inserted, id)
      near(left.startTime, 0, `${id} left start`); near(left.duration, 2, `${id} left duration`)
      near(left.trimStart, 0, `${id} left source in`); near(left.trimEnd, 2, `${id} left source out`)
      const right = inserted.clips.find(clip => clip.name === id && clip.id !== id)
      assert.ok(right, `${id} crossing clip retains a right half`)
      near(right.startTime, 4, `${id} right start`); near(right.duration, 4, `${id} right duration`)
      near(right.trimStart, 2, `${id} right source in`); near(right.trimEnd, 6, `${id} right source out`)
    }
    for (const id of ['later-video', 'later-audio', 'other-audio']) {
      near(byId(inserted, id).startTime, byId(original, id).startTime + 2, `${id} sequence shift`)
    }
    assert.deepEqual(inserted.markers.map(marker => marker.time), [1, 4, 10])
    assert.equal(inserted.history.length, 1); assert.equal(inserted.dirty, true)
    assert.match(await page.getByTestId('source-edit-status').innerText(), /insert/i)
    if (process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT })
    console.log('PASS 2: actual Insert button splits crossings, shifts every later track/marker, and creates exactly trimmed linked A/V')

    // 3. Both halves, new linked clips, and moved markers belong to one undo.
    assert.equal(await undo(), true)
    assert.deepEqual(timingSnapshot(await state()), timingSnapshot(original))
    assert.equal(await undo(), false, 'there is no hidden second undo for embedded audio')
    assert.equal(await redo(), true)
    assert.deepEqual(timingSnapshot(await state()), timingSnapshot(inserted))
    const roundTrip = await page.evaluate(() => {
      const t = window.sourceEditTest, s = t.timeline.getState()
      const saved = JSON.parse(JSON.stringify(s.getProjectData()))
      s.loadFromProject(saved, t.assets.getState().assets, 10)
      const loaded = t.timeline.getState()
      return { clips: loaded.clips, tracks: loaded.tracks, markers: loaded.markers, transitions: loaded.transitions, history: loaded.history }
    })
    assert.deepEqual(timingSnapshot(roundTrip), timingSnapshot(inserted))
    assert.equal(roundTrip.history.length, 0)
    console.log('PASS 3: one complete undo/redo and JSON project save/load preserve edit timing, links, tracks, and markers')

    // 4. Overwrite trims only destination tracks, retaining all other timing.
    await seed(); await markRange()
    const beforeOverwrite = await state()
    await page.getByTestId('source-edit-overwrite').click(); await settle()
    const overwritten = await state()
    assertPair(overwritten, overwritten.selectedClipIds, 2, 2, 1, 3)
    assert.deepEqual(byId(overwritten, 'overlay'), byId(beforeOverwrite, 'overlay'))
    assert.deepEqual(byId(overwritten, 'other-audio'), byId(beforeOverwrite, 'other-audio'))
    assert.deepEqual(overwritten.markers, beforeOverwrite.markers)
    for (const id of ['later-video', 'later-audio']) assert.deepEqual(byId(overwritten, id), byId(beforeOverwrite, id))
    for (const id of ['main-video', 'main-audio']) {
      near(byId(overwritten, id).duration, 2, `${id} overwrite left duration`)
      const right = overwritten.clips.find(clip => clip.name === id && clip.id !== id)
      near(right.startTime, 4, `${id} overwrite right start`)
      near(right.duration, 2, `${id} overwrite right duration`)
      near(right.trimStart, 4, `${id} overwritten source is skipped`)
      near(right.trimEnd, 6, `${id} right source end retained`)
    }
    assert.equal(overwritten.history.length, 1)
    await undo(); assert.deepEqual(timingSnapshot(await state()), timingSnapshot(beforeOverwrite))
    console.log('PASS 4: actual Overwrite button replaces only target V/A intervals without moving other tracks, later edits, or markers')

    // 5. Add to End remains append, independent of current playhead.
    await seed({ playheadPosition: 1 }); await markRange()
    const beforeAppend = await state()
    const appendPlan = await preview('append')
    assert.equal(appendPlan.ok, true, appendPlan.reason); near(appendPlan.startTime, 10, 'append destination end')
    await page.getByTestId('source-edit-append').click(); await settle()
    const appended = await state()
    assertPair(appended, appended.selectedClipIds, 10, 2, 1, 3)
    for (const clip of beforeAppend.clips) assert.deepEqual(byId(appended, clip.id), clip)
    assert.deepEqual(appended.markers, beforeAppend.markers)
    assert.equal(appended.history.length, 1)
    console.log('PASS 5: actual Add to End appends the source range with linked audio and leaves all earlier edits unchanged')

    // 6. Source range arithmetic retains source-frame precision even when
    // the source and sequence frame rates differ.
    await seed({ clips: [], markers: [], playheadPosition: 0 })
    const precision = await apply('overwrite', { inPoint: 1.05, outPoint: 2.05 })
    assert.equal(precision.plan.ok, true, precision.plan.reason)
    assert.equal(precision.result.ok, true, precision.result.reason)
    assertPair(await state(), precision.result.clipIds, 0, 1, 1.05, 2.05)
    for (const type of ['audio', 'video']) {
      await seed({ clips: [], markers: [], assetPatch: { type, hasAudio: false }, playheadPosition: 0 })
      const single = await apply('insert')
      assert.equal(single.result.ok, true, single.result.reason)
      assert.equal(single.result.clipIds.length, 1)
      assert.equal(byId(await state(), single.result.clipIds[0]).type, type)
    }
    console.log('PASS 6: exact cross-FPS source trims, standalone audio, and silent video placement')

    // 7. Refusals are atomic: preview/apply must not create history or dirty
    // the document. No passing by silently ignoring locked/complex media.
    const refusals = [
      ['locked destinations', 'overwrite', t => t.timeline.setState(s => ({ tracks: s.tracks.map(track => track.type === 'video' ? { ...track, locked: true } : track) }))],
      ['locked downstream track', 'insert', t => t.timeline.setState(s => ({ tracks: s.tracks.map(track => track.id === 'audio-2' ? { ...track, locked: true } : track) }))],
      ['sync-locked crossing', 'insert', t => t.timeline.setState(s => ({ clips: s.clips.map(clip => clip.id === 'main-video'
        ? { ...clip, lockMode: 'sync', syncLock: { mode: 'sync', startTime: 0, duration: 6 } } : clip) }))],
      ['transition crossing', 'insert', t => t.timeline.setState({ transitions: [{ id: 'transition-1', kind: 'between',
        clipAId: 'main-video', clipBId: 'later-video', duration: 1, editPoint: 6, originalClipAEnd: 6, originalClipBStart: 8 }] })],
      ['speed-ramp crossing', 'insert', t => t.timeline.setState(s => ({ clips: s.clips.map(clip => clip.id === 'main-video'
        ? { ...clip, keyframes: { speed: [{ time: 0, value: 1 }, { time: 4, value: 2 }] } } : clip) }))],
    ]
    for (const [label, mode, mutate] of refusals) {
      await seed()
      await page.evaluate(mutation => { const t = window.sourceEditTest; (0, eval)(`(${mutation})`)(t); t.markProjectClean() }, mutate.toString())
      await settle()
      const before = await state(), blocked = await apply(mode)
      assert.equal(blocked.plan.ok, false, `${label} preview refuses`)
      assert.ok(blocked.plan.reason, `${label} explains why`)
      assert.equal(blocked.result.ok, false, `${label} apply refuses`)
      assert.deepEqual(await state(), before, `${label} leaves all document/history/dirty state untouched`)
      if (mode === 'insert') assert.equal(await page.getByTestId('source-edit-insert').isDisabled(), true)
      if (mode === 'overwrite') assert.equal(await page.getByTestId('source-edit-overwrite').isDisabled(), true)
      assert.ok((await page.getByTestId('source-edit-status').innerText()).trim(), `${label} is visible in the source monitor`)
    }
    console.log('PASS 7: locked destination/downstream tracks, sync locks, transition cuts and speed ramps refuse atomically with visible reasons')

    // 8. A click must apply the preview the user actually reviewed, not a
    // silently re-planned edit after another timeline/request change.
    await seed()
    await page.evaluate(() => {
      const t = window.sourceEditTest, s = t.timeline.getState(), request = t.request()
      const plan = s.previewSourceEdit(request)
      // Opaque token identity stays in this page; serializing it through
      // Playwright would invalidate it before the actual stale-state check.
      t.pendingEdit = { request, token: plan.token }
      t.timeline.setState({ playheadPosition: 3 })
      t.markProjectClean()
    })
    const beforeStale = await state()
    const rejected = await page.evaluate(() => {
      const t = window.sourceEditTest
      return t.timeline.getState().applySourceEdit(t.pendingEdit.request, t.pendingEdit.token)
    })
    assert.equal(rejected.ok, false); assert.ok(rejected.reason)
    assert.deepEqual(await state(), beforeStale)
    const mismatched = await page.evaluate(() => {
      const t = window.sourceEditTest, s = t.timeline.getState(), request = t.request()
      const plan = s.previewSourceEdit(request)
      return s.applySourceEdit({ ...request, outPoint: 4 }, plan.token)
    })
    assert.equal(mismatched.ok, false)
    assert.deepEqual(await state(), beforeStale)
    console.log('PASS 8: stale playhead and changed-range preview tokens refuse without history or dirty mutations')

    // 9. Existing legacy addClip/drop placement remains overwrite behavior,
    // even when the unrelated ripple edit toggle is enabled.
    await seed({ rippleEditMode: true })
    const legacyBefore = await state()
    const legacyClip = await page.evaluate(() => {
      const t = window.sourceEditTest
      return t.timeline.getState().addClip('video-1', t.asset, 2, 10, { trimStart: 1, duration: 2 })
    })
    const legacyAfter = await state()
    near(legacyClip.startTime, 2, 'legacy placement'); near(byId(legacyAfter, 'main-video').duration, 2, 'legacy overwrite')
    near(byId(legacyAfter, 'later-video').startTime, 8, 'legacy later clip stays put')
    assert.deepEqual(byId(legacyAfter, 'main-audio'), byId(legacyBefore, 'main-audio'))
    assert.deepEqual(byId(legacyAfter, 'overlay'), byId(legacyBefore, 'overlay'))
    assert.deepEqual(legacyAfter.markers, legacyBefore.markers)
    console.log('PASS 9: legacy addClip placement keeps overwrite semantics and is independent of the ripple toggle')

    // 10. Real Timeline Match Frame still opens the source monitor with the
    // clip's source range, then the new edit controls use that exact range.
    await seed({ clips: [], markers: [] })
    await page.evaluate(() => {
      const t = window.sourceEditTest
      t.timeline.setState({ clips: [t.makeClip('match-frame', 'video-1', 0, 4, { trimStart: 2, trimEnd: 6 })],
        selectedClipIds: ['match-frame'], playheadPosition: 1 })
      t.assets.setState({ previewMode: 'timeline' })
      t.markProjectClean()
    })
    await settle()
    await page.locator('[data-clip-id="match-frame"]').first().click({ button: 'right' })
    await page.getByText('Match Frame in Source Player', { exact: true }).click()
    await page.getByTestId('source-edit-overwrite').waitFor(); await settle()
    near(await page.evaluate(() => window.sourceEditTest.sourceVideo.currentTime), 3, 'Match Frame source time')
    assert.match(await page.getByTestId('fixture-source-controls').innerText(), /00:04\.0/)
    assert.equal((await state()).history.length, 0)
    assert.equal((await state()).dirty, false)
    await page.getByTestId('source-edit-append').click(); await settle()
    assertPair(await state(), (await state()).selectedClipIds, 4, 4, 2, 6)
    console.log('PASS 10: real Timeline Match Frame preserves source seek/In/Out and feeds the exact selected range to Add to End')

    // 11. Bridge routing never quietly loses expected source audio and never
    // selects a caption-role track merely because it is a video track.
    const assertRefusal = async (mode, overrides, label) => {
      const before = await state(), checked = await apply(mode, overrides)
      assert.equal(checked.plan.ok, false, `${label}: preview must refuse`)
      assert.ok(checked.plan.reason, `${label}: refusal explains the required action`)
      assert.equal(checked.result.ok, false, `${label}: apply must refuse`)
      assert.deepEqual(await state(), before, `${label}: no counter/history/dirty/document mutation`)
    }
    for (const missingAudio of ['removed', 'hidden', 'locked']) {
      await seed({ clips: [], markers: [] })
      await page.evaluate(kind => {
        const t = window.sourceEditTest
        t.timeline.setState(s => ({ tracks: kind === 'removed' ? s.tracks.filter(track => track.type !== 'audio')
          : s.tracks.map(track => track.type !== 'audio' ? track : { ...track, ...(kind === 'hidden' ? { visible: false } : { locked: true }) }) }))
        t.markProjectClean()
      }, missingAudio)
      await assertRefusal('insert', {}, `expected embedded audio ${missingAudio}`)
      const reason = (await preview()).reason
      assert.match(reason, /audio/i)
    }
    await seed({ clips: [], markers: [], assetPatch: { hasAudio: true, audioEnabled: false } })
    const mutedSource = await apply()
    assert.equal(mutedSource.result.ok, true, mutedSource.result.reason)
    assert.equal(mutedSource.result.clipIds.length, 1)
    assert.equal(byId(await state(), mutedSource.result.clipIds[0]).trackId, 'video-1')
    await seed({ clips: [], markers: [], activeTrackId: 'audio-2', assetPatch: { type: 'audio' } })
    const audioOnly = await apply()
    assert.equal(audioOnly.result.ok, true, audioOnly.result.reason)
    assert.equal(audioOnly.result.clipIds.length, 1)
    assert.equal(byId(await state(), audioOnly.result.clipIds[0]).trackId, 'audio-2')
    await seed({ clips: [], markers: [] })
    await page.evaluate(() => {
      const t = window.sourceEditTest
      t.timeline.setState(s => ({ tracks: [{ ...t.track('captions', 'Captions', 'video', -1), role: 'captions' }, ...s.tracks], activeTrackId: 'captions' }))
      t.markProjectClean()
    })
    const captionFallback = await apply()
    assert.equal(captionFallback.result.ok, true, captionFallback.result.reason)
    assertPair(await state(), captionFallback.result.clipIds, 2, 2, 1, 3)
    const routed = (await state()).clips.filter(clip => captionFallback.result.clipIds.includes(clip.id))
    assert.deepEqual(new Set(routed.map(clip => clip.trackId)), new Set(['video-1', 'audio-1']))
    await seed({ clips: [], markers: [], assetPatch: { yolo: { mode: 'music', stage: 'video', shotType: 'performance', audioStart: 4, length: 2 } } })
    await assertRefusal('insert', {}, 'source with inferred song sync')
    assert.match((await preview()).reason, /song|sync/i)
    console.log('PASS 11: routing respects disabled/silent/audio-only sources, refuses missing embedded-audio destinations, skips caption tracks, and preserves song sync')

    // 12. Append waits for BOTH destinations, and frame-flooring never grows
    // the selected source range or invents an unloaded source duration.
    await seed({ clips: [], markers: [], playheadPosition: 1 })
    await page.evaluate(() => {
      const t = window.sourceEditTest
      t.timeline.setState({ clips: [t.makeClip('short-video', 'video-1', 0, 4), t.makeClip('longer-audio', 'audio-1', 5, 4)] })
      t.markProjectClean()
    })
    const beforeLongAudioAppend = await state()
    const afterBoth = await apply('append')
    assert.equal(afterBoth.result.ok, true, afterBoth.result.reason)
    near(afterBoth.result.startTime, 9, 'append waits for the longer audio destination')
    assertPair(await state(), afterBoth.result.clipIds, 9, 2, 1, 3)
    for (const clip of beforeLongAudioAppend.clips) assert.deepEqual(byId(await state(), clip.id), clip)
    await seed({ clips: [], markers: [], playheadPosition: 0 })
    const fractional = await apply('insert', { inPoint: 1.05, outPoint: 2.09 })
    assert.equal(fractional.result.ok, true, fractional.result.reason)
    assertPair(await state(), fractional.result.clipIds, 0, 1, 1.05, 2.05)
    for (const id of fractional.result.clipIds) assert.ok(byId(await state(), id).trimEnd <= 2.09, 'trim cannot extend beyond the selected Out')
    await seed({ clips: [], markers: [] })
    await assertRefusal('insert', { inPoint: 1, outPoint: 1.05 }, 'less than one timeline frame')
    await assertRefusal('insert', { inPoint: 9, outPoint: 10.1 }, 'range beyond source end')
    await assertRefusal('insert', { inPoint: -0.1, outPoint: 1 }, 'negative source In')
    await seed({ clips: [], markers: [], assetPatch: { duration: null, settings: { duration: null } } })
    await assertRefusal('insert', { inPoint: null, outPoint: null, sourceDuration: null }, 'unloaded source duration')
    console.log('PASS 12: append protects the longer audio destination; fractional source ranges floor safely and short/out-of-bounds/unloaded ranges refuse')

    // 13. Opaque tokens bind the request and history; public arrays must not
    // expose the stored plan/selection to accidental external mutation.
    await seed({ clips: [], markers: [] })
    const untouchedPreview = await state()
    await page.evaluate(() => {
      const t = window.sourceEditTest, request = t.request(), plan = t.timeline.getState().previewSourceEdit(request)
      t.pendingEdit = { request, token: plan.token }
      request.asset.settings.fps = 40
    })
    const mutatedAsset = await page.evaluate(() => {
      const t = window.sourceEditTest
      return t.timeline.getState().applySourceEdit(t.pendingEdit.request, t.pendingEdit.token)
    })
    assert.equal(mutatedAsset.ok, false, 'mutating the source asset invalidates its displayed preview')
    assert.deepEqual(await state(), untouchedPreview)
    await seed({ clips: [], markers: [] })
    await page.evaluate(() => {
      const t = window.sourceEditTest, request = t.request(), plan = t.timeline.getState().previewSourceEdit(request)
      t.pendingEdit = { request, token: plan.token }
      t.timeline.getState().saveToHistory()
      t.markProjectClean()
    })
    const newHistory = await state()
    const historyChanged = await page.evaluate(() => {
      const t = window.sourceEditTest
      return t.timeline.getState().applySourceEdit(t.pendingEdit.request, t.pendingEdit.token)
    })
    assert.equal(historyChanged.ok, false, 'a new history checkpoint invalidates the displayed preview')
    assert.deepEqual(await state(), newHistory)
    await seed({ clips: [], markers: [] })
    const publicArrayIsolation = await page.evaluate(() => {
      const t = window.sourceEditTest, request = t.request(), s = t.timeline.getState()
      const plan = s.previewSourceEdit(request), expected = [...plan.clipIds]
      plan.clipIds.splice(0, plan.clipIds.length, 'forged-preview-id')
      t.pendingEdit = { request, token: plan.token }
      const result = s.applySourceEdit(request, plan.token)
      const selectedAfterApply = [...t.timeline.getState().selectedClipIds]
      result.clipIds.splice(0, result.clipIds.length, 'forged-result-id')
      return { ok: result.ok, expected, selectedAfterApply, selectedAfterResultMutation: [...t.timeline.getState().selectedClipIds] }
    })
    assert.equal(publicArrayIsolation.ok, true)
    assert.deepEqual(publicArrayIsolation.selectedAfterApply, publicArrayIsolation.expected, 'changing preview clipIds cannot change committed selection')
    assert.deepEqual(publicArrayIsolation.selectedAfterResultMutation, publicArrayIsolation.expected, 'changing result clipIds cannot mutate live selection')
    const beforeReplay = await state()
    const replay = await page.evaluate(() => {
      const t = window.sourceEditTest
      return t.timeline.getState().applySourceEdit(t.pendingEdit.request, t.pendingEdit.token)
    })
    assert.equal(replay.ok, false, 'a source edit token can be consumed only once')
    assert.deepEqual(await state(), beforeReplay)
    console.log('PASS 13: source-asset/history changes and token replay refuse; returned clip-ID arrays cannot corrupt the planned or committed selection')

    // 14. The source request must belong to the currently previewed asset,
    // not the previous asset's duration left in the shared playback store.
    // Switch assets without remounting the source panel or resetting store
    // duration, matching the production setPreview navigation boundary.
    await seed({ clips: [], markers: [], playheadPosition: 0, assetPatch: { duration: 2, settings: { duration: 2 } } })
    await markRange(0.2, 0.8)
    const beforeSourceSwitch = await state()
    const knownId = await page.evaluate(() => {
      const t = window.sourceEditTest, previous = t.asset
      t.provenancePreviousSource = previous
      const next = { ...previous, id: 'known-long-source', name: 'Known 20-second source',
        url: URL.createObjectURL(new Blob([], { type: 'video/mp4' })), duration: 20,
        settings: { ...previous.settings, duration: 20 } }
      // The media element and global duration still describe the old source.
      t.setSourceMetadata({ url: previous.url, duration: 2, readyState: 4 })
      t.assets.setState({ assets: [previous, next], duration: 2 })
      t.assets.getState().setPreview(next)
      return next.id
    })
    await settle()
    assert.match(await page.getByTestId('fixture-source-controls').innerText(), /full clip/i, 'asset change clears old In/Out marks')
    assert.match(await page.getByTestId('fixture-source-controls').innerText(), /00:20\.0/, 'current asset metadata wins over stale 2-second playback duration')
    assert.deepEqual(await state(), beforeSourceSwitch, 'changing source/marks does not dirty or checkpoint the timeline')
    await page.getByTestId('source-edit-insert').click(); await settle()
    const longInsert = await state()
    assertPair(longInsert, longInsert.selectedClipIds, 0, 20, 0, 20)
    assert.ok(longInsert.selectedClipIds.every(id => byId(longInsert, id).assetId === knownId))
    await undo()
    await page.evaluate(() => {
      const t = window.sourceEditTest, previous = t.provenancePreviousSource
      const unknown = { ...previous, id: 'unknown-source', name: 'Metadata pending source',
        url: URL.createObjectURL(new Blob([], { type: 'video/mp4' })), duration: null,
        settings: { ...previous.settings, duration: null } }
      t.setSourceMetadata({ url: previous.url, duration: 2, readyState: 4 })
      t.assets.setState(s => ({ assets: [...s.assets, unknown], duration: 2 }))
      t.assets.getState().setPreview(unknown)
      t.markProjectClean()
    })
    await settle()
    const pendingMetadata = await state()
    for (const mode of ['insert', 'overwrite', 'append']) {
      assert.equal(await page.getByTestId(`source-edit-${mode}`).isDisabled(), true, `${mode} cannot adopt stale source metadata`)
    }
    assert.match(await page.getByTestId('source-edit-status').innerText(), /duration|load/i)
    // A metadata event from the stale decoder must not unlock the new source.
    await page.evaluate(() => window.sourceEditTest.sourceVideo.dispatchEvent(new Event('loadedmetadata')))
    await settle()
    assert.equal(await page.getByTestId('source-edit-insert').isDisabled(), true)
    assert.deepEqual(await state(), pendingMetadata)
    await page.evaluate(() => {
      const t = window.sourceEditTest
      t.setSourceMetadata({ url: t.asset.url, duration: 7, readyState: 1 })
      t.sourceVideo.dispatchEvent(new Event('loadedmetadata'))
    })
    await settle()
    for (const mode of ['insert', 'overwrite', 'append']) assert.equal(await page.getByTestId(`source-edit-${mode}`).isDisabled(), false)
    assert.match(await page.getByTestId('fixture-source-controls').innerText(), /00:07\.0/)
    assert.deepEqual(await state(), pendingMetadata, 'matching decoder metadata only refreshes the source preview')
    for (const eventType of ['emptied', 'error']) {
      await page.evaluate(type => window.sourceEditTest.sourceVideo.dispatchEvent(new Event(type)), eventType)
      await settle()
      assert.equal(await page.getByTestId('source-edit-insert').isDisabled(), true, `${eventType} invalidates decoder-owned duration`)
      assert.deepEqual(await state(), pendingMetadata)
      await page.evaluate(() => window.sourceEditTest.sourceVideo.dispatchEvent(new Event('loadedmetadata')))
      await settle()
      assert.equal(await page.getByTestId('source-edit-insert').isDisabled(), false, 'fresh matching metadata restores availability')
    }
    await page.getByTestId('source-edit-append').click(); await settle()
    assertPair(await state(), (await state()).selectedClipIds, 0, 7, 0, 7)
    await page.evaluate(() => {
      const t = window.sourceEditTest
      t.assets.getState().setPreview(t.provenancePreviousSource)
    })
    await settle()
    assert.match(await page.getByTestId('fixture-source-controls').innerText(), /full clip/i)
    assert.match(await page.getByTestId('fixture-source-controls').innerText(), /00:02\.0/)
    console.log('PASS 14: same-panel asset switches discard old source marks/duration, reject stale decoder metadata, and enable edits only from matching loaded metadata')

    // Source controls must wrap into an ordinary narrow side-panel width.
    // Keep the real timeline at its desktop width: this is not a mobile-app
    // test and does not resize/reconfigure the user's editor or display.
    await seed({ clips: [], markers: [] })
    for (const width of [600, 350]) {
      await page.getByTestId('fixture-source-controls').evaluate((element, width) => {
        element.style.width = `${width}px`
      }, width)
      await settle()
      const layout = await page.getByTestId('fixture-source-controls').evaluate(element => {
        const outer = element.getBoundingClientRect()
        return { width: outer.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
          controls: [...element.querySelectorAll('[data-testid^="source-edit-"]')].map(control => {
            const box = control.getBoundingClientRect()
            return { id: control.dataset.testid, left: box.left - outer.left, right: box.right - outer.left, width: box.width, height: box.height }
          }) }
      })
      assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `${width}px source monitor does not horizontally overflow`)
      for (const control of layout.controls) {
        assert.ok(control.left >= -1 && control.right <= width + 1, `${control.id} stays within ${width}px source panel`)
        if (/insert|overwrite|append|targets/.test(control.id)) assert.ok(control.width > 0 && control.height > 0, `${control.id} remains visible`)
      }
    }
    console.log('PASS: source destination/readout/action layout remains contained and visible at 600px and 350px panel widths')

    await seed({ clips: [], markers: [] }); await settle()
    assert.deepEqual(errors, [], 'no renderer exceptions across source controls, Timeline, and store checks')
    console.log(`PASS: all 14 source-edit integration groups plus narrow-layout smoke; no renderer exceptions (${native ? 'isolated Electron test host' : 'headless Chrome'}).`)
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
