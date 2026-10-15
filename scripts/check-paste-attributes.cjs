// Real Timeline, Inspector and canvas; synthetic state only, never a user project.
const assert = require('node:assert/strict')
const path = require('node:path')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')

async function main() {
  const native = process.env.VELORN_TEST_ELECTRON === '1'
  const browser = native
    ? await _electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')] })
    : await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true })
  try {
    const page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = []
    page.on('pageerror', error => { errors.push(error.message); console.error('Renderer:', error.message) })
    await page.goto((process.env.VELORN_TEST_URL || 'http://127.0.0.1:5184') + '/tests/fixtures/multi-clip-inspector.html?timeline=1')
    await page.waitForFunction(() => Boolean(window.multiClipInspectorTest))
    const dialog = page.getByTestId('paste-attributes-dialog')
    const checkbox = group => page.getByTestId(`paste-attributes-group-${group}`)
    const clip = id => page.locator(`[data-clip-id="${id}"]`).first()
    const state = () => page.evaluate(() => {
      const t = window.multiClipInspectorTest, s = t.timeline.getState()
      return JSON.parse(JSON.stringify({ clips: s.clips, tracks: s.tracks, selection: s.selectedClipIds,
        history: s.history.length, historyIndex: s.historyIndex, dirty: t.isProjectDirty(),
        playing: s.isPlaying, playhead: s.playheadPosition, clipboard: s.attributeClipboard }))
    })
    const reset = async () => {
      if (await dialog.count()) await page.keyboard.press('Escape')
      await page.evaluate(() => window.multiClipInspectorTest.reset())
    }
    const select = ids => page.evaluate(ids => window.multiClipInspectorTest.timeline.setState({ selectedClipIds: ids }), ids)
    const seed = patches => page.evaluate(patches => {
      const t = window.multiClipInspectorTest
      t.timeline.setState(s => ({ clips: s.clips.map(c => patches[c.id] ? { ...c, ...patches[c.id] } : c) }))
      t.markProjectClean()
    }, patches)
    const context = async id => { await clip(id).scrollIntoViewIfNeeded(); await clip(id).click({ button: 'right', position: { x: 45, y: 20 } }) }
    const copy = async ids => {
      await select(ids); await context(ids[0])
      await page.getByTitle('Copy selected clips to paste at playhead', { exact: true }).click()
    }
    const open = async (ids, clicked = ids[0]) => {
      await select(ids); await context(clicked)
      await page.getByTestId('paste-attributes-open').click(); await dialog.waitFor()
    }
    const apply = async groups => {
      for (const group of groups) await checkbox(group).check()
      await page.getByTestId('paste-attributes-apply').click()
      await dialog.waitFor({ state: 'hidden' })
    }
    const undo = () => page.evaluate(() => window.multiClipInspectorTest.timeline.getState().undo())
    const redo = () => page.evaluate(() => window.multiClipInspectorTest.timeline.getState().redo())
    const fx = (id, type, settings, enabled = true) => ({ id, type, settings, enabled })
    const byId = (s, id) => s.clips.find(c => c.id === id)

    await reset(); await context('visual-b')
    assert.equal(await page.getByTestId('paste-attributes-open').isDisabled(), true, 'empty clipboard cannot open attribute paste')
    await page.keyboard.press('Escape')
    await seed({
      'visual-a': { adjustments: { brightness: 24, contrast: 8, blur: 3, shadows: { saturation: 12 }, lut: { lutId: 'synthetic-look', amount: 45 } },
        effects: [fx('source-grain', 'glslFilmGrain', { amount: 25, size: 1.1, color: 65, stock: 2 })], bypass: { color: true, effects: false },
        transform: { positionX: 22, positionY: 17, scaleX: 80, scaleY: 90, scaleLinked: false, opacity: 88 } },
      'visual-b': { adjustments: { brightness: -8, contrast: -6, blur: 8, futureGrade: 'preserve' },
        effects: [fx('target-blur', 'gaussianBlur', { amount: 7 })],
        bypass: { color: false, effects: true, mask: true }, cacheStatus: 'cached', cacheUrl: 'synthetic-cache.mp4',
        keyframes: { 'future-property': [{ time: 0, value: 1 }] }, customMetadata: { keep: 'target' } },
    })
    await copy(['visual-a'])
    const copied = (await state()).clipboard
    assert.ok(copied?.id); assert.equal(copied.clips.length, 1)
    // Editing a source after Copy must not mutate either the attribute snapshot or
    // what the user is about to paste. This deliberately uses an in-place nested
    // mutation to detect shallow clipboard copies, then restores immutable state.
    await page.evaluate(() => {
      const store = window.multiClipInspectorTest.timeline, s = store.getState()
      s.clips[0].adjustments.brightness = 60
      s.clips[0].effects[0].settings.amount = 80
      store.setState({ clips: [...s.clips] })
      window.multiClipInspectorTest.markProjectClean()
    })
    assert.deepEqual((await state()).clipboard, copied)
    const original = await state()
    await open(['visual-b', 'audio-a', 'locked'], 'visual-b')
    for (const group of ['transform', 'color', 'effects', 'audio']) assert.equal(await checkbox(group).isChecked(), false, 'categories start opt-in')
    assert.equal(await checkbox('audio').isDisabled(), true)
    assert.equal(await page.getByTestId('paste-attributes-apply').isDisabled(), true)
    assert.match(await dialog.innerText(), /replac/i, 'replacement semantics are visible before apply')
    assert.match(await dialog.innerText(), /lock/i, 'locked exclusion is visible')
    if (process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT })
    await apply(['color', 'effects'])
    let s = await state(), target = byId(s, 'visual-b'), beforeTarget = byId(original, 'visual-b')
    assert.equal(s.history, 1); assert.equal(s.dirty, true)
    assert.equal(target.adjustments.brightness, 24); assert.equal(target.adjustments.contrast, 8)
    assert.equal(target.adjustments.blur, 3); assert.deepEqual(target.adjustments.lut, { lutId: 'synthetic-look', amount: 45 })
    assert.equal(target.adjustments.futureGrade, 'preserve')
    assert.deepEqual(target.transform, beforeTarget.transform)
    assert.deepEqual(target.keyframes, beforeTarget.keyframes)
    assert.deepEqual(target.customMetadata, beforeTarget.customMetadata)
    for (const key of ['id', 'trackId', 'type', 'name', 'startTime', 'duration', 'trimStart', 'trimEnd', 'shapeProperties']) assert.deepEqual(target[key], beforeTarget[key], `${key} is not an attribute-paste side effect`)
    assert.equal(target.effects.filter(e => e.type === 'gaussianBlur').length, 0)
    const pastedGrain = target.effects.find(e => e.type === 'glslFilmGrain')
    assert.equal(pastedGrain.settings.amount, 25); assert.notEqual(pastedGrain.id, 'source-grain')
    assert.equal(target.bypass.color, true); assert.equal(target.bypass.effects, false); assert.equal(target.bypass.mask, true)
    assert.equal(target.cacheStatus, 'invalid')
    for (const id of ['visual-a', 'audio-a', 'audio-b', 'locked']) assert.deepEqual(byId(s, id), byId(original, id))
    await undo(); assert.deepEqual((await state()).clips, original.clips)
    await redo(); assert.deepEqual((await state()).clips, s.clips)
    console.log('PASS: real context menu, immutable copied source, explicit categories, managed replacement, exclusions and atomic undo/redo')

    await reset(); await seed({ 'visual-a': { transform: { positionX: 29, positionY: 16, scaleX: 75, scaleY: 82, scaleLinked: false, opacity: 92 } },
      'visual-b': { transform: { positionX: 180, positionY: 0, scaleX: 100, scaleY: 100, scaleLinked: false, motionBlurEnabled: true, futureTransform: 7 }, adjustments: { brightness: 33, blur: 4 } } })
    await copy(['visual-a']); const transformOriginal = await state()
    // Right-clicking outside the old selection must target the clicked clip, not
    // accidentally paste attributes back onto the source selection.
    await context('visual-b'); await page.getByTestId('paste-attributes-open').click(); await dialog.waitFor()
    assert.deepEqual((await state()).selection, ['visual-b'])
    await apply(['transform']); s = await state(); target = byId(s, 'visual-b')
    assert.equal(target.transform.positionX, 29); assert.equal(target.transform.scaleY, 82)
    assert.equal(target.transform.motionBlurEnabled, true); assert.equal(target.transform.futureTransform, 7)
    assert.deepEqual(target.adjustments, byId(transformOriginal, 'visual-b').adjustments)
    await open(['visual-b']); await apply(['transform'])
    assert.equal((await state()).history, 1, 'identical paste is a no-op, without new undo')
    await undo(); assert.deepEqual((await state()).clips, transformOriginal.clips)
    console.log('PASS: unselected right-click targets correctly, Transform preserves unrelated settings, no-op adds no history')

    // Modal keyboard isolation is tested with the real Timeline and Transport
    // listeners mounted. Space must operate the checkbox, not start playback.
    await reset(); await copy(['visual-a']); await open(['visual-b'])
    const modalBefore = await state()
    await checkbox('transform').focus(); await page.keyboard.press('Space')
    assert.equal(await checkbox('transform').isChecked(), true)
    for (const key of ['j', 'k', 'l', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace', 'Control+z', 'Control+c', 'Control+v']) await page.keyboard.press(key)
    s = await state()
    assert.deepEqual(s.clips, modalBefore.clips); assert.deepEqual(s.selection, modalBefore.selection)
    assert.equal(s.history, modalBefore.history); assert.equal(s.playhead, modalBefore.playhead); assert.equal(s.playing, false)
    assert.deepEqual(s.clipboard, modalBefore.clipboard)
    const focusable = dialog.locator('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')
    await focusable.last().focus(); await page.keyboard.press('Tab')
    assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true)
    assert.equal(await focusable.first().evaluate(el => el === document.activeElement), true, 'Tab loops to first dialog control')
    await page.keyboard.press('Shift+Tab')
    assert.equal(await focusable.last().evaluate(el => el === document.activeElement), true, 'Shift-Tab loops back')
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
    assert.deepEqual((await state()).clips, modalBefore.clips)
    await open(['visual-b']); await checkbox('transform').check()
    await page.getByTestId('paste-attributes-apply').focus(); await page.keyboard.press('Enter')
    await dialog.waitFor({ state: 'hidden' })
    const submitted = await state()
    assert.equal(submitted.history, modalBefore.history + 1)
    assert.equal(byId(submitted, 'visual-b').transform.positionX, byId(modalBefore, 'visual-a').transform.positionX)
    assert.equal(submitted.playing, false, 'Enter submits without starting Transport playback')
    await page.keyboard.press('ArrowRight')
    assert.ok((await state()).playhead > submitted.playhead, 'editor frame stepping resumes once the dialog closes')
    console.log('PASS: modal isolates editor keys, traps focus, cancels with Escape, submits with Enter, and restores frame stepping after close')

    for (const [group, sourceKeyframes, targetKeyframes] of [
      ['transform', { positionX: [{ time: 0, value: 0 }] }, {}],
      ['color', {}, { brightness: [{ time: 0, value: 0 }] }],
      ['effects', {}, { 'effect.target-grain.amount': [{ time: 0, value: 5 }] }],
    ]) {
      await reset(); await seed({ 'visual-a': { keyframes: sourceKeyframes }, 'visual-b': { keyframes: targetKeyframes,
        effects: [fx('target-grain', 'glslFilmGrain', { amount: 5, size: 1, color: 50, stock: 0 })] } })
      await copy(['visual-a']); await open(['visual-b'])
      assert.equal(await checkbox(group).isDisabled(), true, `${group} animation blocks its category`)
      assert.match(await dialog.innerText(), /animat|keyframe/i)
      const untouched = await state()
      await page.getByTestId('paste-attributes-cancel').click()
      assert.deepEqual(await state(), untouched)
    }
    console.log('PASS: source/target category animation is protected without transferring or deleting keyframes')

    await reset(); await seed({ 'visual-b': { effects: [fx('target-future', 'future-effect', { keep: true })] } })
    await copy(['visual-a']); await open(['visual-b'])
    assert.equal(await checkbox('effects').isDisabled(), true, 'unknown stacks cannot be partly replaced or reordered')
    assert.equal(await checkbox('color').isDisabled(), false, 'an unsupported stack does not block unrelated attributes')
    const unknownOriginal = await state()
    await apply(['color']); assert.deepEqual(byId(await state(), 'visual-b').effects, byId(unknownOriginal, 'visual-b').effects)
    console.log('PASS: unknown/non-managed effect stacks are protected, while unrelated categories remain available')

    await reset(); await seed({ 'audio-a': { gainDb: -9, fadeIn: 0.5, fadeOut: 0.7 }, 'audio-b': { startTime: 12, gainDb: 6, fadeIn: 0.2, fadeOut: 0.3 } })
    await copy(['audio-a']); const audioOriginal = await state(); await open(['audio-b', 'visual-b'])
    for (const group of ['transform', 'color', 'effects']) assert.equal(await checkbox(group).isDisabled(), true)
    await apply(['audio']); s = await state()
    assert.equal(s.history, 1)
    for (const key of ['gainDb', 'fadeIn', 'fadeOut']) assert.equal(byId(s, 'audio-b')[key], byId(audioOriginal, 'audio-a')[key])
    assert.deepEqual(byId(s, 'visual-b'), byId(audioOriginal, 'visual-b'))
    await undo(); assert.deepEqual((await state()).clips, audioOriginal.clips)
    await reset(); await seed({ 'visual-a': { linkGroupId: 'synthetic-pair' }, 'audio-a': { linkGroupId: 'synthetic-pair', gainDb: -12 }, 'audio-b': { startTime: 12 } })
    await copy(['visual-a']); assert.equal((await state()).clipboard.clips.length, 2, 'Copy includes the linked pair')
    await open(['visual-b', 'audio-b'])
    const sourceSelect = page.getByTestId('paste-attributes-source')
    assert.equal(await sourceSelect.inputValue(), '', 'multiple copied clips require an explicit source choice')
    assert.equal(await page.getByTestId('paste-attributes-apply').isDisabled(), true)
    await sourceSelect.selectOption('audio-a'); await apply(['audio'])
    assert.equal(byId(await state(), 'audio-b').gainDb, -12)
    console.log('PASS: Audio-only routing and explicit source selection for copied linked video/audio pairs')

    for (const mutation of ['selection', 'clips', 'tracks', 'clipboard', 'load']) {
      await reset(); await copy(['visual-a']); await open(['visual-b']); await checkbox('transform').check()
      await page.evaluate(mutation => {
        const t = window.multiClipInspectorTest, store = t.timeline, s = store.getState()
        if (mutation === 'selection') store.setState({ selectedClipIds: ['audio-b'] })
        if (mutation === 'clips') store.setState({ clips: s.clips.map(c => c.id === 'visual-b' ? { ...c, name: 'changed while dialog open' } : c) })
        if (mutation === 'tracks') store.setState({ tracks: s.tracks.map(t => t.id === 'visual-b' ? { ...t, locked: true } : t) })
        if (mutation === 'clipboard') s.copySelectedClips()
        if (mutation === 'load') s.loadFromProject(JSON.parse(JSON.stringify(s.getProjectData())), [], 30)
      }, mutation)
      const staleBefore = await state()
      if (await dialog.isVisible()) {
        const applyButton = page.getByTestId('paste-attributes-apply')
        if (await applyButton.isEnabled()) await applyButton.click()
      }
      assert.deepEqual((await state()).clips, staleBefore.clips, `${mutation} invalidates old dialog without writes`)
      assert.equal((await state()).history, staleBefore.history)
      if (await dialog.isVisible()) await page.keyboard.press('Escape')
    }
    console.log('PASS: selection, clip, track, clipboard and project-load changes invalidate stale dialogs without mutation')

    const storeGuards = await page.evaluate(() => {
      const t = window.multiClipInspectorTest, store = t.timeline, failures = []
      for (const mutation of ['selection', 'clips', 'tracks', 'clipboard', 'load']) {
        t.reset(); store.setState({ selectedClipIds: ['visual-a'] }); store.getState().copySelectedClips()
        store.setState({ selectedClipIds: ['visual-b'] })
        const s = store.getState()
        const request = { clipboardId: s.attributeClipboard.id, sourceId: 'visual-a', clipIds: ['visual-b'], groups: ['transform'], expectedClips: s.clips, expectedTracks: s.tracks }
        if (mutation === 'selection') store.setState({ selectedClipIds: ['audio-b'] })
        if (mutation === 'clips') store.setState({ clips: [...s.clips] })
        if (mutation === 'tracks') store.setState({ tracks: [...s.tracks] })
        if (mutation === 'clipboard') store.getState().copySelectedClips()
        if (mutation === 'load') s.loadFromProject(JSON.parse(JSON.stringify(s.getProjectData())), [], 30)
        t.markProjectClean()
        const before = store.getState(), result = before.applyPasteAttributes(request), after = store.getState()
        if (result.ok || after.clips !== before.clips || after.history !== before.history || t.isProjectDirty()) failures.push(mutation)
      }
      t.reset(); store.setState({ selectedClipIds: ['visual-a'] }); store.getState().copySelectedClips()
      const serialized = store.getState().getProjectData()
      if ('attributeClipboard' in serialized || 'copiedClips' in serialized) failures.push('clipboard persisted into project')
      store.getState().loadFromProject(JSON.parse(JSON.stringify(serialized)), [], 30)
      if (store.getState().attributeClipboard !== null) failures.push('clipboard survived project load')
      return failures
    })
    assert.deepEqual(storeGuards, [])
    console.log('PASS: store independently rejects stale requests, does not dirty on rejection, and never persists the attribute clipboard')

    // Existing ordinary copy/paste remains clip creation, not attribute paste.
    // Use a text clip because ordinary shape paste is not supported pre-existing.
    await reset(); await seed({ 'visual-a': { type: 'text', textProperties: { text: 'Original copy-paste', fontSize: 40 } } })
    await select(['visual-a'])
    await page.evaluate(() => window.multiClipInspectorTest.timeline.setState({ activeTrackId: 'visual-b', playheadPosition: 15 }))
    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('Control+c')
    const copiedBefore = await state()
    await page.keyboard.press('Control+v'); s = await state()
    assert.equal(s.clips.length, copiedBefore.clips.length + 1)
    assert.equal(s.history, copiedBefore.history + 1)
    const pastedClip = s.clips.find(c => !copiedBefore.clips.some(old => old.id === c.id))
    assert.equal(pastedClip.type, 'text'); assert.equal(pastedClip.startTime, 15)
    assert.equal(pastedClip.textProperties.text, 'Original copy-paste')
    assert.equal(await dialog.count(), 0)
    await undo(); assert.deepEqual((await state()).clips, copiedBefore.clips)
    console.log('PASS: normal Ctrl+C/Ctrl+V still creates a clip at the playhead with original undo semantics')

    await reset(); await seed({ 'visual-a': { effects: [fx('preview-chroma', 'chromaticAberration', { amount: 4, angle: 0 })] } })
    await copy(['visual-a'])
    await page.waitForFunction(() => {
      const c = document.querySelector('canvas[data-preview-popout-source]')
      return c?.getContext('2d')?.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 !== 3 && v > 20)
    })
    const canvas = page.locator('canvas[data-preview-popout-source]'), canvasBefore = await canvas.evaluate(el => el.toDataURL())
    await open(['visual-b']); await apply(['effects'])
    await page.waitForFunction(before => document.querySelector('canvas[data-preview-popout-source]').toDataURL() !== before, canvasBefore)
    assert.equal((await state()).playing, false)
    await undo()
    await page.waitForFunction(before => document.querySelector('canvas[data-preview-popout-source]').toDataURL() === before, canvasBefore)
    assert.deepEqual(errors, [])
    console.log('PASS: paused shader preview repaints on paste and undo, with no renderer exceptions')

    const registryChecks = await page.evaluate(async () => {
      const { EFFECT_TYPES } = await import('/src/utils/effects.js')
      const t = window.multiClipInspectorTest, store = t.timeline, failures = []
      let count = 0
      for (const definition of EFFECT_TYPES) {
        for (const candidate of [{ id: 'defaults', settings: definition.defaults }, ...(definition.presets || [])]) {
          t.reset()
          const settings = { ...definition.defaults, ...candidate.settings }
          store.setState(s => ({ clips: s.clips.map(c => c.id === 'locked' ? { ...c, effects: [{ id: 'donor-effect', type: definition.id, enabled: true, settings }] } : c), selectedClipIds: ['locked'] }))
          store.getState().copySelectedClips()
          store.setState({ selectedClipIds: ['visual-a', 'visual-b'] })
          const current = store.getState()
          const request = { clipboardId: current.attributeClipboard.id, sourceId: 'locked', clipIds: current.selectedClipIds, groups: ['effects'], expectedClips: current.clips, expectedTracks: current.tracks }
          const result = current.applyPasteAttributes(request)
          count++
          const label = `${definition.id}/${candidate.id}`
          if (!result.ok || result.changedCount !== 2) { failures.push(`${label}: ${result.error || 'wrong target count'}`); continue }
          const pasted = store.getState(), [a, b] = pasted.clips
          if (pasted.history.length !== 1 || a.effects[0].id === b.effects[0].id || [a, b].some(c => c.effects[0].id === 'donor-effect')) failures.push(`${label}: history or unique effect IDs`)
          for (const clip of [a, b]) for (const param of definition.params) {
            if (clip.effects[0].settings[param.key] !== settings[param.key]) failures.push(`${label}/${param.key}: wrong copied value`)
          }
          t.markProjectClean()
          const again = pasted.applyPasteAttributes({ ...request, expectedClips: pasted.clips, expectedTracks: pasted.tracks })
          const final = store.getState()
          if (!again.ok || again.changedCount !== 0 || final.clips !== pasted.clips || final.history.length !== 1 || t.isProjectDirty()) failures.push(`${label}: second paste was not a clean semantic no-op`)
          final.undo()
          if (store.getState().clips !== current.clips && JSON.stringify(store.getState().clips) !== JSON.stringify(current.clips)) failures.push(`${label}: undo did not restore the whole paste`)
        }
      }
      t.reset()
      return { count, failures }
    })
    assert.deepEqual(registryChecks.failures, [])
    assert.ok(registryChecks.count > 50)
    assert.deepEqual(errors, [])
    console.log(`PASS: ${registryChecks.count} real effect-registry defaults/presets paste to two targets with unique IDs, one undo and clean semantic no-op`)
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
