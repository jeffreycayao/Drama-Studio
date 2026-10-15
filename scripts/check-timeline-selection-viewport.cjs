// Real timeline/shortcuts, synthetic state only; no production IPC or user project.
const assert = require('node:assert/strict')
const path = require('node:path')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const near = (a, b, label, tolerance = 1.1) => assert.ok(Math.abs(a - b) <= tolerance, `${label}: ${a} != ${b}`)
async function main() {
  const native = process.env.VELORN_TEST_ELECTRON === '1'
  const browser = native
    ? await _electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')] })
    : await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true })
  try {
    const page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.setDefaultTimeout(15000)
    await page.routeWebSocket(/ws:\/\/(?:127\.0\.0\.1|localhost):5184\//, socket => socket.close())
    const errors = []
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
    await page.goto((process.env.VELORN_TEST_URL || 'http://127.0.0.1:5184') + '/tests/fixtures/timeline-selection-viewport.html')
    const viewport = page.getByTestId('timeline-viewport'), content = page.getByTestId('timeline-track-content')
    await viewport.waitFor()
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const metrics = () => page.evaluate(() => {
      const t = window.timelineSelectionViewportTest, s = t.timeline.getState()
      const v = document.querySelector('[data-testid="timeline-viewport"]'), c = document.querySelector('[data-testid="timeline-track-content"]')
      return { zoom: s.zoom, left: v.scrollLeft, top: c.scrollTop, width: v.clientWidth, scrollWidth: v.scrollWidth,
        headerTop: document.querySelector('[data-testid="timeline-track-headers"]').scrollTop }
    })
    const snapshot = () => page.evaluate(() => {
      const t = window.timelineSelectionViewportTest, s = t.timeline.getState()
      return JSON.parse(JSON.stringify({ document: s.getProjectData(), history: s.history, historyIndex: s.historyIndex,
        selected: s.selectedClipIds, playhead: s.playheadPosition, playing: s.isPlaying, rate: s.playbackRate,
        inPoint: s.inPoint, outPoint: s.outPoint, dirty: t.isProjectDirty() }))
    })
    const scroll = async (left, top) => {
      await viewport.evaluate((el, left) => { el.scrollLeft = left }, left)
      await content.evaluate((el, top) => { el.scrollTop = top }, top)
      await settle()
    }
    const seed = async () => {
      await page.keyboard.press('Escape'); await page.mouse.up()
      await page.evaluate(async () => {
        const t = window.timelineSelectionViewportTest
        t.reset(); await t.setEditorHotkeys(t.DEFAULT_EDITOR_HOTKEYS)
        document.activeElement?.blur()
      })
      await settle(); await scroll(300, 130)
      await page.locator('[aria-label="Timeline edit tools"] button[title*="(V)"]').click()
    }
    const toggle = async key => { await page.keyboard.press(key || 'z'); await settle() }
    const assertRestored = (after, before) => {
      near(after.zoom, before.zoom, 'zoom restored', 1e-6)
      near(after.left, before.left, 'horizontal restored')
      near(after.top, before.top, 'vertical restored')
      near(after.headerTop, before.top, 'header synchronized')
    }
    await seed()
    let before = await metrics(), original = await snapshot()
    await toggle()
    let fitted = await metrics()
    near(fitted.zoom, fitted.width * 4 / 12, 'independent fit calculation', 1e-6)
    const leftMargin = 120 * fitted.zoom / 5 - fitted.left
    const rightMargin = fitted.width - (132 * fitted.zoom / 5 - fitted.left)
    near(leftMargin, rightMargin, 'symmetric selected bounds')
    assert.ok(leftMargin > 30)
    assert.deepEqual(await snapshot(), original, 'focus is view-only')
    await scroll(fitted.left + 30, 300)
    await toggle(); assertRestored(await metrics(), before)
    assert.deepEqual(await snapshot(), original)
    console.log('PASS 1: multi-selection fit, balanced margins, exact zoom/scroll return and clean document')

    await seed(); before = await metrics()
    await toggle()
    await page.evaluate(() => window.timelineSelectionViewportTest.timeline.setState({ selectedClipIds: ['Far'] }))
    await toggle(); fitted = await metrics()
    assert.ok(200 * fitted.zoom / 5 >= fitted.left, 'locked selection start visible')
    assert.ok(208 * fitted.zoom / 5 <= fitted.left + fitted.width + 1, 'locked selection end visible')
    await toggle(); assertRestored(await metrics(), before)
    await toggle()
    await page.evaluate(() => window.timelineSelectionViewportTest.timeline.setState({ selectedClipIds: [] }))
    await toggle(); assertRestored(await metrics(), before)
    console.log('PASS 2: changed selection refits with original baseline; empty selection can return')

    await seed(); before = await metrics()
    await page.evaluate(() => window.timelineSelectionViewportTest.timeline.setState({ selectedClipIds: [] }))
    original = await snapshot(); await toggle(); assertRestored(await metrics(), before); assert.deepEqual(await snapshot(), original)
    await page.evaluate(() => window.timelineSelectionViewportTest.timeline.setState({ selectedClipIds: ['missing'] }))
    await toggle(); assertRestored(await metrics(), before)
    await page.evaluate(() => window.timelineSelectionViewportTest.timeline.setState({ selectedClipIds: ['Start'] }))
    await toggle(); fitted = await metrics()
    assert.equal(fitted.zoom, 2000); assert.equal(fitted.left, 0)
    await toggle(); assertRestored(await metrics(), before)
    console.log('PASS 3: empty/stale selection is a no-op; timeline-zero short clip is bounded')

    await seed(); before = await metrics(); await toggle()
    let selected = (await snapshot()).selected
    await page.locator('[data-clip-id="A"]').first().click({ button: 'right' })
    await page.getByTestId('zoom-to-selection').waitFor()
    assert.match(await page.getByTestId('zoom-to-selection').innerText(), /Restore Previous View/i)
    await page.getByTestId('zoom-to-selection').click(); await settle()
    assertRestored(await metrics(), before)
    assert.deepEqual((await snapshot()).selected, selected)
    await page.keyboard.press('1'); await settle()
    await page.locator('[data-clip-id="A"]').first().click({ button: 'right' })
    before = await metrics()
    assert.match(await page.getByTestId('zoom-to-selection').innerText(), /Zoom to Selection/i)
    await page.getByTestId('zoom-to-selection').click(); await settle()
    fitted = await metrics(); near(fitted.zoom, fitted.width * 4 / 12, 'context fits selection', 1e-6)
    await toggle(); assertRestored(await metrics(), before)
    console.log('PASS 4: actual context-menu toggle preserves multi-selection')

    await seed(); before = await metrics()
    await page.getByRole('textbox', { name: 'Typing guard', exact: true }).fill('z')
    await page.keyboard.press('z'); assertRestored(await metrics(), before)
    await page.getByRole('textbox', { name: 'Editable guard', exact: true }).click()
    await page.keyboard.press('z'); assertRestored(await metrics(), before)
    await page.evaluate(() => document.activeElement.blur())
    await page.keyboard.down('z'); await settle(); fitted = await metrics()
    await page.keyboard.down('z'); await settle(); assertRestored(await metrics(), fitted)
    await page.keyboard.up('z'); await toggle(); assertRestored(await metrics(), before)
    await page.keyboard.press('Alt+z'); await page.keyboard.press('Shift+z'); await settle(); assertRestored(await metrics(), before)
    console.log('PASS 5: text/contenteditable, held-key repeat and modifier guards')

    await seed()
    await page.evaluate(async () => {
      const t = window.timelineSelectionViewportTest
      await t.setEditorHotkeys({ ...t.DEFAULT_EDITOR_HOTKEYS, 'timeline.zoomToSelection': 'Shift+Q' })
    })
    await settle()
    before = await metrics(); await toggle(); assertRestored(await metrics(), before)
    await toggle('Shift+Q'); assert.notEqual((await metrics()).zoom, before.zoom)
    await toggle('Shift+Q'); assertRestored(await metrics(), before)
    await page.evaluate(() => window.timelineSelectionViewportTest.timeline.getState().updateClipTransform('A', { positionX: 42 }, true))
    await toggle('Shift+Q')
    await page.keyboard.press('Control+z'); await settle()
    assert.equal(await page.evaluate(() => window.timelineSelectionViewportTest.timeline.getState().clips.find(c => c.id === 'A').transform.positionX), 0)
    await page.keyboard.press('Control+Shift+z'); await settle()
    assert.equal(await page.evaluate(() => window.timelineSelectionViewportTest.timeline.getState().clips.find(c => c.id === 'A').transform.positionX), 42)
    console.log('PASS 6: configurable shortcut; authoring Undo/Redo unaffected by view navigation')

    await seed(); await toggle()
    await page.keyboard.press('1'); await settle()
    before = await metrics(); await toggle(); await toggle(); assertRestored(await metrics(), before)
    await toggle()
    await page.evaluate(() => {
      const t = window.timelineSelectionViewportTest, saved = t.timeline.getState().getProjectData()
      t.timeline.getState().loadFromProject({ ...saved, zoom: 130 })
      t.timeline.setState({ selectedClipIds: ['A', 'B'] }); t.markProjectClean()
    })
    await settle(); await scroll(500, 100); before = await metrics()
    await toggle(); fitted = await metrics(); near(fitted.zoom, fitted.width * 4 / 12, 'new session fits rather than stale restore', 1e-6)
    await toggle(); assertRestored(await metrics(), before)
    console.log('PASS 7: Frame All resets toggle; same IDs after project load never restore stale view')

    await seed(); await toggle()
    await page.evaluate(() => window.timelineSelectionViewportTest.setVisible(false)); await viewport.waitFor({ state: 'hidden' })
    await page.evaluate(() => window.timelineSelectionViewportTest.setVisible(true)); await viewport.waitFor(); await settle()
    before = await metrics(); await toggle(); await toggle(); assertRestored(await metrics(), before)
    // A load in the same event turn invalidates the queued focus scroll callback.
    await seed()
    await page.evaluate(() => {
      const t = window.timelineSelectionViewportTest
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', bubbles: true }))
      t.timeline.getState().loadFromProject({ ...t.timeline.getState().getProjectData(), zoom: 160 })
      t.timeline.setState({ selectedClipIds: [] })
      document.querySelector('[data-testid="timeline-viewport"]').scrollLeft = 200
    })
    await settle(); before = await metrics(); assert.equal(before.zoom, 160)
    near(before.left, 200, 'stale queued scroll cannot replace post-load viewport')
    await toggle(); assertRestored(await metrics(), before)
    console.log('PASS 8: unmount/remount and queued-callback session cancellation')

    await seed()
    await page.evaluate(() => {
      const t = window.timelineSelectionViewportTest, s = t.timeline.getState()
      const input = { clipIds: ['A', 'B'], name: 'Synthetic scene', width: 1920, height: 1080 }
      const plan = s.previewCreateCompound(input); if (!plan.ok) throw new Error(plan.reason)
      const result = s.applyCreateCompound(input, plan.token); if (!result.ok) throw new Error(result.reason)
      window.viewportCompoundId = result.clipId
      t.markProjectClean()
    })
    original = await snapshot()
    await toggle()
    await page.evaluate(() => {
      const t = window.timelineSelectionViewportTest
      const result = t.timeline.getState().openCompound(window.viewportCompoundId)
      if (!result.ok) throw new Error(result.reason)
      t.timeline.setState({ selectedClipIds: ['A', 'B'] })
    })
    await settle(); await toggle()
    assert.equal((await snapshot()).dirty, false)
    await page.evaluate(() => {
      const result = window.timelineSelectionViewportTest.timeline.getState().closeCompound()
      if (!result.ok || result.changed) throw new Error('View-only compound falsely edited')
    })
    await settle()
    assert.deepEqual(await snapshot(), original)
    before = await metrics(); await toggle(); await toggle(); assertRestored(await metrics(), before)
    console.log('PASS 9: compound Open/Back isolates views and preserves authoring/cache/history')

    const resize = async (width, height) => {
      if (native) await browser.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height })
      else await page.setViewportSize({ width, height })
      await settle()
    }
    await resize(760, 800); await seed(); before = await metrics(); original = await snapshot()
    await toggle(); fitted = await metrics()
    assert.ok(fitted.width > 0)
    assert.ok(120 * fitted.zoom / 5 >= fitted.left - 1)
    assert.ok(132 * fitted.zoom / 5 <= fitted.left + fitted.width + 1)
    if (!native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT || '/tmp/velorn-selection-viewport.png' })
    await toggle(); assertRestored(await metrics(), before); assert.deepEqual(await snapshot(), original)
    console.log('PASS 10: narrow timeline fit/restore; no renderer exceptions')

    await resize(1440, 900); await seed(); before = await metrics()
    for (const legacy of [false, true]) {
      await page.evaluate(legacy => {
        const overlay = document.createElement('div'); overlay.id = 'synthetic-modal'
        if (legacy) overlay.className = 'fixed inset-0'
        else overlay.setAttribute('role', 'dialog')
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0001'
        document.body.append(overlay)
      }, legacy)
      await toggle(); assertRestored(await metrics(), before)
      await page.evaluate(() => document.getElementById('synthetic-modal').remove())
    }
    await toggle(); fitted = await metrics()
    await page.locator('[aria-label="Timeline edit tools"] button[title*="(T)"]').click()
    const handle = page.locator('[data-clip-id="A"] [data-trim-handle]').first()
    await handle.scrollIntoViewIfNeeded()
    const box = await handle.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down(); await settle(); before = await metrics()
    await toggle(); assertRestored(await metrics(), before)
    await page.mouse.up(); await page.keyboard.press('Escape'); await settle()
    console.log('PASS 11: visible dialog/backdrop and actual held trim-pointer block navigation')

    await seed()
    await page.evaluate(() => window.timelineSelectionViewportTest.timeline.setState({ isPlaying: true, playbackRate: 0.5 }))
    original = await snapshot()
    await toggle()
    assert.deepEqual(await snapshot(), original, 'navigation does not pause, seek or retime playback')
    await toggle()
    assert.deepEqual(await snapshot(), original)
    assert.deepEqual(errors, [])
    console.log('PASS 12: playing transport state is preserved; no renderer exceptions')
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
