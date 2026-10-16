// Real Inspector/store/canvas; synthetic state only, never a user project.
const assert = require('node:assert/strict')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const path = require('node:path')
async function main() {
  const native = process.env.DRAMA_STUDIO_TEST_ELECTRON === '1'
  const browser = native
    ? await _electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')] })
    : await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true })
  try {
    const page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    const errors = []
    page.on('pageerror', error => { errors.push(error.message); console.error('Renderer:', error.message) })
    const fixtureBase = new URL(process.env.DRAMA_STUDIO_TEST_URL || 'http://127.0.0.1:5184')
    await page.routeWebSocket(url => url.hostname === fixtureBase.hostname && url.port === fixtureBase.port, socket => socket.close())
    await page.goto((process.env.DRAMA_STUDIO_TEST_URL || 'http://127.0.0.1:5184') + '/tests/fixtures/multi-clip-inspector.html')
    const panel = page.getByTestId('multi-clip-inspector')
    await panel.waitFor()
    const control = property => panel.locator(`[data-inspector-property="${property}"]`)
    const slider = property => panel.locator(`input[type="range"][data-inspector-property="${property}"]`)
    const number = property => panel.locator(`input[type="number"][data-inspector-property="${property}"]`)
    const state = () => page.evaluate(() => {
      const t = window.multiClipInspectorTest, s = t.timeline.getState()
      return { clips: JSON.parse(JSON.stringify(s.clips)), history: s.history.length, dirty: t.isProjectDirty(), playing: s.isPlaying }
    })
    const select = ids => page.evaluate(ids => window.multiClipInspectorTest.timeline.setState({ selectedClipIds: ids }), ids)
    const tab = name => panel.locator(`[data-inspector-tab="${name.toLowerCase()}"]`).click()
    const reset = async () => { await page.evaluate(() => window.multiClipInspectorTest.reset()); await panel.waitFor(); await tab('Transform') }
    const typeDragNumber = async (property, value) => {
      await control(property).dblclick()
      await number(property).fill(String(value))
      await number(property).press('Enter')
      await number(property).waitFor({ state: 'detached' })
    }
    const drag = async (target, delta) => {
      await target.scrollIntoViewIfNeeded()
      const box = await target.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2
      await page.mouse.move(x, y); await page.mouse.down()
      await page.mouse.move(x + delta, y, { steps: 10 }); await page.mouse.up()
    }
    const range = async (property, value) => {
      const target = slider(property)
      await target.focus()
      const start = Number(await target.inputValue()), step = Number(await target.getAttribute('step')) || 1
      // Drama Studio reserves Left/Right for frame stepping even on a range input.
      const key = value >= start ? 'ArrowUp' : 'ArrowDown'
      for (let i = 0; i < Math.round(Math.abs(value - start) / step); i++) await page.keyboard.down(key)
      await page.keyboard.up(key); await target.blur()
    }
    const original = (await state()).clips
    assert.equal(await panel.getByRole('button', { name: 'Set values', exact: true }).count(), 0)
    assert.equal(await panel.getByRole('button', { name: 'Apply', exact: true }).count(), 0)
    assert.equal(await control('positionX').textContent(), 'Mixed')
    await control('positionX').click(); await control('positionX').dblclick(); await number('positionX').blur()
    assert.equal((await state()).dirty, false, 'untouched mixed field must not homogenize')
    await control('positionX').dblclick(); await number('positionX').fill('999'); await number('positionX').press('Escape')
    assert.deepEqual((await state()).clips, original)
    await typeDragNumber('positionX', 40)
    let s = await state()
    assert.deepEqual(s.clips.slice(0, 2).map(c => c.transform.positionX), [40, 40])
    assert.equal(s.history, 1); assert.equal(s.playing, false)
    await page.evaluate(() => window.multiClipInspectorTest.timeline.getState().undo())
    assert.deepEqual((await state()).clips, original)
    await page.evaluate(() => window.multiClipInspectorTest.timeline.getState().redo())
    assert.deepEqual((await state()).clips, s.clips)
    console.log('PASS: familiar Inspector, mixed display, click/blur/Escape safety, typed absolute edits, undo/redo')

    await reset(); await drag(control('positionX'), 30)
    s = await state()
    assert.deepEqual(s.clips.slice(0, 2).map(c => c.transform.positionX), [-150, -150], 'drag sets shared value, not offsets')
    assert.equal(s.history, 1, 'one undo per continuous number drag')
    await drag(control('positionX'), 10)
    assert.equal((await state()).history, 2, 'second gesture is separate')
    await page.evaluate(() => window.multiClipInspectorTest.timeline.getState().undo())
    assert.deepEqual((await state()).clips, s.clips)
    console.log('PASS: real mouse number drags, existing sensitivity, separate undo per gesture')

    await reset()
    await page.waitForFunction(() => {
      const c = document.querySelector('canvas[data-preview-popout-source]')
      return c?.getContext('2d')?.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 !== 3 && v > 20)
    })
    const before = await page.locator('canvas[data-preview-popout-source]').evaluate(el => el.toDataURL())
    await range('scaleX', 110); s = await state()
    assert.deepEqual(s.clips.slice(0, 2).map(c => [c.transform.scaleX, c.transform.scaleY]), [[110, 110], [110, 100]])
    assert.equal(s.history, 1)
    await page.waitForFunction(before => document.querySelector('canvas[data-preview-popout-source]').toDataURL() !== before, before)
    await tab('Mix'); await range('opacity', 90)
    assert.deepEqual((await state()).clips.slice(0, 2).map(c => c.transform.opacity), [90, 90])
    assert.equal((await state()).history, 2)
    await panel.getByRole('combobox', { name: 'Blend Mode' }).selectOption('screen')
    assert.deepEqual((await state()).clips.slice(0, 2).map(c => c.transform.blendMode), ['screen', 'screen'])
    console.log('PASS: existing sliders and held-arrow input, linked scales, blend selector, paused preview refresh')

    await reset(); await drag(slider('scaleX'), 20)
    s = await state()
    assert.equal(s.history, 1, 'mouse slider drag is one undo step')
    assert.equal(s.clips[0].transform.scaleX, s.clips[1].transform.scaleX)
    assert.equal(s.clips[0].transform.scaleX, s.clips[0].transform.scaleY)
    assert.equal(s.clips[1].transform.scaleY, 100)
    for (const type of ['video', 'text', 'adjustment']) {
      await reset()
      await page.evaluate(type => window.multiClipInspectorTest.timeline.setState(s => ({ clips: s.clips.map(c => ['visual-a', 'visual-b'].includes(c.id) ? { ...c, type } : c) })), type)
      await tab('Transform'); await typeDragNumber('positionX', 25)
      assert.deepEqual((await state()).clips.slice(0, 2).map(c => c.transform.positionX), [25, 25], `${type} original Inspector controls`)
      assert.equal((await state()).history, 1)
    }
    console.log('PASS: real mouse slider drag and video/text/adjustment Inspector variants')

    await reset(); await select(['visual-a', 'visual-b', 'audio-a', 'audio-b', 'locked'])
    await page.getByRole('button', { name: 'Audio (2)', exact: true }).click()
    assert.equal(await number('gainDb').getAttribute('placeholder'), 'Mixed')
    await number('gainDb').focus(); await number('gainDb').blur()
    assert.equal((await state()).dirty, false)
    await number('gainDb').fill('-3'); await number('gainDb').press('Enter'); s = await state()
    assert.deepEqual(s.clips.slice(2, 4).map(c => c.gainDb), [-3, -3])
    assert.deepEqual(s.clips.slice(0, 2), original.slice(0, 2)); assert.equal(s.history, 1)
    await range('gainDb', -1); assert.equal((await state()).history, 2)
    await number('fadeIn').fill('0.5'); await number('fadeIn').blur()
    assert.deepEqual((await state()).clips.slice(2, 4).map(c => c.fadeIn), [0.5, 0.5])
    await page.getByRole('button', { name: 'Video (2)', exact: true }).click(); await tab('Transform')
    await typeDragNumber('positionX', 80); s = await state()
    assert.deepEqual(s.clips[4], original[4])
    const roundTrip = await page.evaluate(() => {
      const store = window.multiClipInspectorTest.timeline
      const data = JSON.parse(JSON.stringify(store.getState().getProjectData()))
      store.getState().loadFromProject(data, [], 30)
      return store.getState().getProjectData().clips
    })
    assert.deepEqual(roundTrip.map(c => [c.id, c.transform, c.gainDb, c.fadeIn, c.fadeOut]), s.clips.map(c => [c.id, c.transform, c.gainDb, c.fadeIn, c.fadeOut]))
    console.log('PASS: normal audio gain/fades, mixed family switching, locked exclusion, save/load semantics')

    await reset()
    await page.evaluate(() => {
      const t = window.multiClipInspectorTest
      t.timeline.setState(s => ({ clips: s.clips.map(c => c.id === 'visual-a' ? { ...c, keyframes: { positionX: [{ time: 0, value: 0 }], scaleY: [{ time: 0, value: 100 }] } } : c) }))
      t.markProjectClean()
    })
    assert.equal(await control('positionX').getAttribute('aria-disabled'), 'true')
    assert.equal(await slider('scaleX').isDisabled(), true)
    assert.equal(await panel.getByRole('button', { name: 'Color', exact: true }).isDisabled(), false)
    assert.equal(await panel.getByRole('button', { name: 'Effects', exact: true }).isDisabled(), false)
    assert.equal(await panel.locator('fieldset button[title="Add keyframe"]').first().isDisabled(), true)
    await panel.getByRole('button', { name: 'Reset', exact: true }).click()
    assert.equal((await state()).dirty, false); assert.equal((await state()).history, 0)
    await control('positionY').dblclick(); await number('positionY').fill('999')
    await select(['visual-b', 'locked']); await panel.waitFor()
    assert.equal((await state()).dirty, false, 'selection change discards typed draft')
    const stale = await page.evaluate(() => window.multiClipInspectorTest.timeline.getState().applyMultiClipInspectorEdit({ clipIds: ['visual-a', 'visual-b'], updates: { positionY: 999 } }))
    assert.equal(stale.ok, false); assert.equal((await state()).dirty, false)
    console.log('PASS: animation protection, atomic reset rejection, unavailable sections, stale draft guard')

    await reset(); await select(['visual-a']); await panel.waitFor({ state: 'detached' })
    await page.getByTestId('single-clip-inspector').locator('[data-inspector-tab="transform"]').click()
    await drag(page.getByTestId('single-clip-inspector').locator('[data-inspector-property="positionX"]'), 10)
    assert.deepEqual((await state()).clips.slice(0, 2).map(c => c.transform.positionX), [-170, 180])
    await page.evaluate(() => {
      const store = window.multiClipInspectorTest.timeline
      store.setState(s => ({ clips: s.clips.map(c => ['visual-a', 'audio-a'].includes(c.id) ? { ...c, linkGroupId: 'pair' } : c), selectedClipIds: ['visual-a', 'audio-a'] }))
    })
    await page.getByText('Linked Pair', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Audio', exact: true }).click(); assert.equal(await panel.count(), 0)
    await page.getByRole('button', { name: 'Video', exact: true }).click()
    console.log('PASS: single-clip mouse editing and original linked-pair Inspector retained')
    await reset()
    await page.getByTestId('inspector-container').evaluate(el => { el.style.width = '304px' })
    const width = await panel.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }))
    assert.ok(width.scroll <= width.client + 1, 'no standard-width overflow')
    if (process.env.DRAMA_STUDIO_TEST_SCREENSHOT) await page.screenshot({ path: process.env.DRAMA_STUDIO_TEST_SCREENSHOT })
    assert.deepEqual(errors, [])
    console.log('PASS: normal-width layout, no renderer exceptions')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
