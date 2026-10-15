// Real Inspector/store/canvas; synthetic state only, never a user project.
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
    await page.goto((process.env.VELORN_TEST_URL || 'http://127.0.0.1:5184') + '/tests/fixtures/multi-clip-inspector.html')
    const panel = page.getByTestId('multi-clip-inspector')
    const slider = (property, root = panel) => root.locator(`input[type="range"][data-inspector-property="color.${property}"]`).last()
    const wheel = name => panel.locator(`[data-color-wheel="${name}"]`)
    const state = () => page.evaluate(() => {
      const t = window.multiClipInspectorTest, s = t.timeline.getState()
      return { clips: JSON.parse(JSON.stringify(s.clips)), history: s.history.length, dirty: t.isProjectDirty(), playing: s.isPlaying }
    })
    const select = ids => page.evaluate(ids => window.multiClipInspectorTest.timeline.setState({ selectedClipIds: ids }), ids)
    const colorTab = async (root = panel) => { await root.waitFor(); await root.locator('[data-inspector-tab="color"]').click() }
    const reset = async () => { await page.evaluate(() => window.multiClipInspectorTest.reset()); await colorTab() }
    const seed = async patches => page.evaluate(patches => {
      const t = window.multiClipInspectorTest
      t.timeline.setState(s => ({ clips: s.clips.map(c => patches[c.id] ? { ...c, ...patches[c.id] } : c) }))
      t.markProjectClean()
    }, patches)
    const expand = async title => {
      const button = panel.getByRole('button', { name: title, exact: true })
      if (await button.getAttribute('aria-expanded') === 'false') await button.click()
    }
    const range = async (target, value) => {
      await target.focus()
      const start = Number(await target.inputValue()), step = Number(await target.getAttribute('step')) || 1
      // Left/Right belong to timeline frame stepping; Up/Down edit the range.
      const key = value >= start ? 'ArrowUp' : 'ArrowDown'
      for (let i = 0; i < Math.round(Math.abs(value - start) / step); i++) await page.keyboard.down(key)
      await page.keyboard.up(key); await target.blur()
    }
    const drag = async (target, dx, dy = 0) => {
      await target.scrollIntoViewIfNeeded()
      const box = await target.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2
      await page.mouse.move(x, y); await page.mouse.down()
      await page.mouse.move(x + dx, y + dy, { steps: 10 }); await page.mouse.up()
    }
    const undo = () => page.evaluate(() => window.multiClipInspectorTest.timeline.getState().undo())
    const redo = () => page.evaluate(() => window.multiClipInspectorTest.timeline.getState().redo())
    const colorKeys = ['brightness', 'contrast', 'saturation', 'gain', 'gamma', 'offset', 'hue']
    const grades = {
      'visual-a': { adjustments: { brightness: 10, contrast: 7, hue: 20, saturation: 12, blur: 2, shadows: { hue: 5, saturation: 8, gamma: 7 }, midtones: { contrast: 4 }, highlights: { gain: 11 }, lut: { lutId: 'synthetic-look-a', amount: 33 }, futureGrade: { marker: 'a' } }, bypass: { color: false, effects: true } },
      'visual-b': { adjustments: { brightness: 20, contrast: 19, hue: -30, saturation: 22, blur: 4, shadows: { hue: -4, saturation: 18, gamma: 17 }, midtones: { contrast: 14 }, highlights: { gain: 21 }, lut: { lutId: 'synthetic-look-b', amount: 77 }, futureGrade: { marker: 'b' } }, bypass: { color: true, mask: true } },
    }

    await reset(); await seed(grades); await expand('Global')
    assert.equal(await panel.locator('[data-inspector-tab="color"]').isDisabled(), false)
    assert.equal(await panel.locator('[data-inspector-tab="effects"]').isDisabled(), false)
    assert.equal(await slider('brightness').getAttribute('data-mixed'), 'true')
    assert.equal(await wheel('global').getAttribute('data-mixed'), 'true')
    assert.equal(await panel.getByRole('combobox', { name: 'Look (LUT)' }).isDisabled(), true)
    const original = (await state()).clips
    await slider('brightness').focus(); await slider('brightness').blur()
    assert.deepEqual((await state()).clips, original, 'untouched mixed slider must preserve individual grades')
    assert.equal((await state()).dirty, false)
    await range(slider('brightness'), 12)
    let s = await state()
    assert.equal(s.history, 1, 'held keyboard range gesture is one undo')
    assert.equal(s.dirty, true); assert.equal(s.playing, false)
    for (let i = 0; i < 2; i++) assert.deepEqual(s.clips[i], { ...original[i], adjustments: { ...original[i].adjustments, brightness: 12 } })
    assert.deepEqual(s.clips.slice(2), original.slice(2))
    await undo(); assert.deepEqual((await state()).clips, original)
    await redo(); assert.deepEqual((await state()).clips, s.clips)
    console.log('PASS: same Color controls, mixed/read-only safety, absolute sparse writes, LUT/blur preservation, keyboard undo/redo')

    await reset(); await seed(grades); await expand('Shadows')
    const nestedOriginal = (await state()).clips
    await range(slider('shadows.hue'), 8); s = await state()
    for (let i = 0; i < 2; i++) assert.deepEqual(s.clips[i].adjustments, { ...nestedOriginal[i].adjustments, shadows: { ...nestedOriginal[i].adjustments.shadows, hue: 8 } })
    assert.equal(s.history, 1)
    await drag(wheel('global'), 22, -10); s = await state()
    assert.equal(s.history, 2, 'wheel hue/saturation drag is a single separate undo')
    assert.equal(s.clips[0].adjustments.hue, s.clips[1].adjustments.hue)
    assert.equal(s.clips[0].adjustments.saturation, s.clips[1].adjustments.saturation)
    assert.equal(s.clips[0].adjustments.contrast, 7); assert.equal(s.clips[1].adjustments.contrast, 19)
    assert.equal(await wheel('global').getAttribute('data-mixed'), null)
    await undo()
    assert.deepEqual((await state()).clips.slice(0, 2).map(c => [c.adjustments.hue, c.adjustments.saturation]), [[20, 12], [-30, 22]])
    await redo(); assert.deepEqual((await state()).clips, s.clips)
    await drag(slider('brightness'), 10)
    assert.equal((await state()).history, 3, 'mouse level drag is a separate single undo')
    console.log('PASS: nested edits preserve sibling grades, atomic color wheel gestures, mouse range undo')

    await reset(); await seed(grades)
    const resetOriginal = (await state()).clips
    await panel.getByRole('button', { name: 'Reset Shadows', exact: true }).click(); s = await state()
    for (let i = 0; i < 2; i++) {
      const expected = { ...resetOriginal[i].adjustments, shadows: { ...resetOriginal[i].adjustments.shadows } }
      for (const key of colorKeys) if ((expected.shadows[key] || 0) !== 0) expected.shadows[key] = 0
      assert.deepEqual(s.clips[i].adjustments, expected)
    }
    assert.equal(s.history, 1)
    await undo(); assert.deepEqual((await state()).clips, resetOriginal)
    await panel.getByRole('button', { name: 'Reset Global', exact: true }).click(); s = await state()
    for (let i = 0; i < 2; i++) {
      for (const key of colorKeys) assert.equal(s.clips[i].adjustments[key] || 0, 0)
      assert.deepEqual(s.clips[i].adjustments.shadows, resetOriginal[i].adjustments.shadows)
      assert.deepEqual(s.clips[i].adjustments.lut, resetOriginal[i].adjustments.lut)
    }
    await panel.getByRole('button', { name: 'Reset', exact: true }).click(); s = await state()
    for (let i = 0; i < 2; i++) {
      for (const group of ['', 'shadows', 'midtones', 'highlights']) {
        const value = group ? s.clips[i].adjustments[group] || {} : s.clips[i].adjustments
        for (const key of colorKeys) assert.equal(value[key] || 0, 0, `reset ${group}.${key}`)
      }
      for (const key of ['lut', 'blur', 'futureGrade']) assert.deepEqual(s.clips[i].adjustments[key], resetOriginal[i].adjustments[key])
    }
    assert.equal(s.history, 2)
    const beforeNoop = s
    await panel.getByRole('button', { name: 'Reset', exact: true }).click()
    assert.deepEqual(await state(), beforeNoop, 'repeated zero reset creates no undo')
    console.log('PASS: atomic tonal/global/all-color resets preserve LUT, blur, future settings and skip no-ops')

    await reset(); await seed(grades)
    const bypassOriginal = (await state()).clips
    const bypass = panel.getByRole('button', { name: 'Bypass color', exact: true })
    assert.equal(await bypass.getAttribute('aria-pressed'), 'mixed')
    await bypass.click(); s = await state()
    assert.deepEqual(s.clips.slice(0, 2).map(c => c.bypass.color), [true, true]); assert.equal(s.history, 1)
    for (let i = 0; i < 2; i++) assert.deepEqual(s.clips[i], { ...bypassOriginal[i], bypass: { ...bypassOriginal[i].bypass, color: true } })
    await bypass.click(); assert.deepEqual((await state()).clips.slice(0, 2).map(c => c.bypass.color), [false, false])
    assert.equal((await state()).history, 2)
    await undo(); await undo(); assert.deepEqual((await state()).clips, bypassOriginal)
    console.log('PASS: mixed color bypass applies together, preserves other bypass groups/grades, and undoes')

    await reset(); await seed({ ...grades, 'visual-a': { ...grades['visual-a'], keyframes: { brightness: [{ time: 0, value: 10 }], 'shadows.hue': [{ time: 0, value: 5 }] } } })
    await expand('Global'); await expand('Shadows')
    const animatedOriginal = (await state()).clips
    assert.equal(await slider('brightness').isDisabled(), true)
    assert.equal(await slider('shadows.hue').isDisabled(), true)
    assert.equal(await wheel('lift').getAttribute('aria-disabled'), 'true')
    assert.equal(await panel.getByRole('button', { name: 'Reset Shadows', exact: true }).isDisabled(), true)
    assert.equal(await panel.getByRole('button', { name: 'Reset Global', exact: true }).isDisabled(), true)
    assert.equal(await panel.getByRole('button', { name: 'Reset', exact: true }).isDisabled(), true)
    await drag(wheel('lift'), 20, -10)
    assert.deepEqual((await state()).clips, animatedOriginal)
    assert.equal((await state()).history, 0); assert.equal((await state()).dirty, false)
    const rejected = await page.evaluate(() => window.multiClipInspectorTest.timeline.getState().applyMultiClipInspectorEdit({
      clipIds: ['visual-a', 'visual-b'], updates: { 'color.shadows.saturation': 45, 'color.shadows.hue': 55 },
    }))
    assert.equal(rejected.ok, false); assert.deepEqual((await state()).clips, animatedOriginal)
    await range(slider('contrast'), 9)
    assert.deepEqual((await state()).clips.slice(0, 2).map(c => c.adjustments.contrast), [9, 9])
    assert.deepEqual((await state()).clips[0].keyframes, animatedOriginal[0].keyframes)
    console.log('PASS: bare-path keyframe protection, disabled wheel/reset controls, atomic rejection, unrelated editable color')

    await reset(); await seed(grades); await select(['visual-a', 'visual-b', 'audio-a', 'audio-b', 'locked']); await colorTab(); await expand('Global')
    const exclusionOriginal = (await state()).clips
    await range(slider('brightness'), 11); s = await state()
    assert.deepEqual(s.clips.slice(0, 2).map(c => c.adjustments.brightness), [11, 11])
    assert.deepEqual(s.clips.slice(2), exclusionOriginal.slice(2), 'audio/locked clips are excluded')
    const roundTrip = await page.evaluate(async () => {
      const { normalizeAdjustmentSettings } = await import('/src/utils/adjustments.js')
      const store = window.multiClipInspectorTest.timeline, data = JSON.parse(JSON.stringify(store.getState().getProjectData()))
      // Hydration normalizes known grade defaults, as it does for ordinary edits.
      const summarize = clips => clips.map(c => [c.id, normalizeAdjustmentSettings(c.adjustments), c.bypass, c.keyframes])
      const before = summarize(data.clips)
      store.getState().loadFromProject(data, [], 30)
      return { before, after: summarize(store.getState().getProjectData().clips) }
    })
    assert.deepEqual(roundTrip.after, roundTrip.before)
    const stale = await page.evaluate(() => window.multiClipInspectorTest.timeline.getState().applyMultiClipInspectorEdit({ clipIds: ['visual-a', 'visual-b'], updates: { 'color.brightness': 80 } }))
    assert.equal(stale.ok, false)
    console.log('PASS: mixed visual/audio and locked exclusions, portable project save/load, stale selection protection')

    await reset()
    await page.evaluate(async () => {
      const { getClipBakeSignature } = await import('/src/utils/clipBakeSignature.js')
      const t = window.multiClipInspectorTest
      t.timeline.setState(s => ({ clips: s.clips.map(c => {
        if (!['visual-a', 'visual-b'].includes(c.id)) return c
        // Off-playhead synthetic cache metadata exercises freshness without loading a media file.
        const clip = { ...c, startTime: 20, adjustments: { brightness: 4, blur: 3 }, cacheStatus: 'cached', cacheKind: 'full', cacheUrl: 'synthetic-test-cache.mp4' }
        return { ...clip, cacheSignature: getClipBakeSignature(clip) }
      }) }))
      t.markProjectClean()
    })
    const renderState = () => page.evaluate(async () => {
      const { isFullBakeFresh } = await import('/src/utils/clipBakeSignature.js')
      const { getRenderAdjustments } = await import('/src/utils/clipBypass.js')
      return window.multiClipInspectorTest.timeline.getState().clips.slice(0, 2).map(c => ({ fresh: isFullBakeFresh(c), grade: getRenderAdjustments(c, 0) }))
    })
    assert.deepEqual((await renderState()).map(c => c.fresh), [true, true])
    await range(slider('brightness'), 6)
    assert.deepEqual((await renderState()).map(c => [c.fresh, c.grade.brightness, c.grade.blur]), [[false, 6, 3], [false, 6, 3]])
    await undo(); assert.deepEqual((await renderState()).map(c => [c.fresh, c.grade.brightness]), [[true, 4], [true, 4]])
    await panel.getByRole('button', { name: 'Bypass color', exact: true }).click()
    assert.deepEqual((await renderState()).map(c => [c.fresh, c.grade.brightness, c.grade.blur, c.grade.lut]), [[false, 0, 3, null], [false, 0, 3, null]])
    await undo(); assert.deepEqual((await renderState()).map(c => c.fresh), [true, true])
    console.log('PASS: existing full-bake invalidation/undo and shared preview/export grade/bypass interpretation (no movie export)')

    for (const type of ['video', 'image', 'text', 'shape', 'adjustment']) {
      await reset(); await seed({ 'visual-a': { type }, 'visual-b': { type } }); await colorTab()
      if (type === 'adjustment') {
        const commit = panel.getByRole('button', { name: 'Commit render', exact: true })
        if (!(await commit.count())) await panel.getByRole('button', { name: 'Commit Render', exact: true }).click()
        assert.equal(await commit.isDisabled(), true, 'batch Color must not enable single-layer Commit Render')
        assert.match(await commit.getAttribute('title'), /select one/i)
      }
      await range(slider('brightness'), 2)
      s = await state()
      assert.deepEqual(s.clips.slice(0, 2).map(c => c.adjustments.brightness), [2, 2], `${type} Color tab uses normal controls`)
      assert.equal(s.history, 1)
    }
    await reset(); await select(['visual-a'])
    const single = page.getByTestId('single-clip-inspector')
    await colorTab(single)
    await range(slider('brightness', single), 2); s = await state()
    assert.equal(s.clips[0].adjustments.brightness, 2); assert.equal(s.clips[1].adjustments, undefined)
    assert.equal(s.history, 1)
    assert.equal(await single.getByRole('button', { name: 'Import .cube…', exact: true }).isEnabled(), true)
    console.log('PASS: all five visual Inspector variants and single-clip color/LUT regression')

    if (!native) {
      for (const eventName of ['pointercancel', 'lostpointercapture', 'blur']) {
        await reset()
        const disc = wheel('global')
        await disc.scrollIntoViewIfNeeded()
        const box = await disc.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2
        await page.mouse.move(x + 5, y); await page.mouse.down()
        await page.mouse.move(x + 20, y - 10, { steps: 3 })
        const beforeCancel = await state()
        assert.equal(beforeCancel.history, 1)
        if (eventName === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')))
        else await disc.dispatchEvent(eventName, { pointerId: 1, pointerType: 'mouse', isPrimary: true })
        await page.mouse.move(x - 20, y + 10, { steps: 3 })
        assert.deepEqual((await state()).clips, beforeCancel.clips, `${eventName} stops an active color-wheel drag`)
        await page.mouse.up()
        await drag(disc, -12, -20)
        assert.equal((await state()).history, 2, `wheel drag following ${eventName} is a separate undo`)

        await reset()
        const target = slider('brightness')
        await target.focus(); await page.keyboard.down('ArrowUp')
        assert.equal((await state()).history, 1)
        if (eventName === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')))
        else await target.dispatchEvent(eventName, { pointerId: 1, pointerType: 'mouse', isPrimary: true })
        // No keyup/mouseup in between: cancellation itself must close the gesture.
        await page.keyboard.down('ArrowUp')
        assert.equal((await state()).history, 2, `range change after ${eventName} starts a separate undo`)
        await page.keyboard.up('ArrowUp'); await target.blur()
        await undo()
        assert.deepEqual((await state()).clips.slice(0, 2).map(c => c.adjustments.brightness), [1, 1])
      }
      console.log('PASS: wheel/range pointer cancellation, lost capture and window blur safely close gestures')
    }

    await reset()
    await page.waitForFunction(() => {
      const c = document.querySelector('canvas[data-preview-popout-source]')
      return c?.getContext('2d')?.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 !== 3 && v > 20)
    })
    const canvas = page.locator('canvas[data-preview-popout-source]')
    const before = await canvas.evaluate(el => el.toDataURL())
    await range(slider('brightness'), -15)
    await page.waitForFunction(before => document.querySelector('canvas[data-preview-popout-source]').toDataURL() !== before, before)
    assert.equal((await state()).playing, false)
    await undo()
    await page.waitForFunction(before => document.querySelector('canvas[data-preview-popout-source]').toDataURL() === before, before)
    await seed(grades)
    await page.getByTestId('inspector-container').evaluate(el => { el.style.width = '304px' })
    const width = await panel.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }))
    assert.ok(width.scroll <= width.client + 1, 'Color controls fit the standard Inspector width')
    if (process.env.VELORN_TEST_SCREENSHOT) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT })
    assert.deepEqual(errors, [])
    console.log('PASS: paused preview repaints color and undo, standard-width Color layout, no renderer exceptions')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
