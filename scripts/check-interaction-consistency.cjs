// Isolated real components/store interactions, not real media, native IPC,
// transcription, exports, projects, or OS-sandbox/package verification.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const base = process.env.VELORN_TEST_URL || 'http://127.0.0.1:5196'
const native = process.env.VELORN_TEST_ELECTRON === '1'
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-interaction-consistency-'))
async function main() {
  const browser = native ? await _electron.launch({ executablePath: require('electron'),
    args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')], env: { ...process.env, VELORN_TEST_URL: base } })
    : await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true })
  let page
  const errors = [], groups = []
  const pass = text => { groups.push(text); console.log(`PASS ${groups.length}: ${text}`) }
  try {
    page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    if (native) await browser.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
    page.setDefaultTimeout(10000)
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
    await page.routeWebSocket(url => url.hostname === new URL(base).hostname && url.port === new URL(base).port, socket => socket.close())
    await page.route('https://fixture.invalid/**', route => route.abort())
    await page.goto(`${base}/tests/fixtures/interaction-consistency.html`)
    await page.waitForFunction(() => Boolean(window.interactionTest?.seed))
    const snapshot = () => page.evaluate(() => window.interactionTest.snapshot())
    const focus = () => page.evaluate(() => document.activeElement?.blur())
    const seed = async options => { await page.evaluate(options => window.interactionTest.seed(options), options || {}); await page.getByTestId('actual-transport').waitFor(); await focus() }
    const preserved = (before, after) => {
      for (const key of ['document', 'history', 'historyIndex', 'selected', 'inPoint', 'outPoint']) assert.deepEqual(after[key], before[key], key)
      assert.equal(after.dirty, false)
    }
    const playing = source => source ? snapshot().then(s => !s.sourcePaused) : snapshot().then(s => s.playing)
    const guardTargets = () => [page.getByLabel('Typing probe'), page.getByLabel('Choice probe'), page.getByLabel('Checkbox probe'),
      page.getByLabel('Range probe'), page.locator('summary').first(), page.getByTestId('editable-probe')]
    await seed()
    const baseline = await snapshot()
    await page.keyboard.down('Space'); await page.keyboard.down('Space'); await page.keyboard.down('Space')
    assert.equal(await playing(), false)
    await page.keyboard.up('Space'); assert.equal(await playing(), true)
    await page.keyboard.press('Space'); assert.equal(await playing(), false)
    await page.getByTestId('native-button').focus()
    await page.keyboard.press('Space'); assert.equal(await playing(), true)
    await page.keyboard.press('Space'); assert.equal(await playing(), false)
    assert.equal(await page.evaluate(() => window.interactionTest.nativeClicks || 0), 0)
    await page.keyboard.press('Enter')
    assert.equal(await page.evaluate(() => window.interactionTest.nativeClicks), 1)
    assert.equal(await playing(), false)
    await focus(); await page.keyboard.press('Enter'); assert.equal(await playing(), true)
    await page.keyboard.press('k'); assert.equal(await playing(), false)
    await page.keyboard.down('k'); await page.keyboard.press('l'); assert.equal((await snapshot()).rate, 0.5)
    await page.keyboard.up('k'); await page.keyboard.press('l'); assert.equal((await snapshot()).rate, 1)
    await page.keyboard.press('l'); assert.equal((await snapshot()).rate, 2)
    await page.keyboard.press('Shift+j'); assert.equal((await snapshot()).rate, -0.5)
    await page.keyboard.press('k')
    preserved(baseline, await snapshot())
    pass('Editor Space repeat/release and button Enter/Space ownership preserve shuttle grammar and authored state')

    // Mount real PreviewPanel before a fresh TransportControls instance so
    // its pan-modifier listener registers first, as in the actual Editor.
    for (const source of [false, true]) {
      await seed({ preview: true, source })
      const preview = page.getByTestId('actual-preview')
      const viewport = preview.locator('div[style*="background-size: 20px 20px"]').first()
      const stage = preview.locator('div[style*="transform: translate("]').first()
      await stage.waitFor()
      // Source controls/PreviewPanel are real; only their source media clock
      // is deterministic, exactly like the existing source-edit fixture.
      if (source) await page.evaluate(() => window.interactionTest.registerSourceStub())
      const beforePreview = await snapshot()
      await page.keyboard.down('Space'); await page.keyboard.down('Space'); assert.equal(await playing(source), false)
      await page.keyboard.up('Space'); assert.equal(await playing(source), true)
      await page.keyboard.press('Space'); assert.equal(await playing(source), false)
      if (source) assert.equal((await snapshot()).playCalls, 1)
      const dragPreview = async (dx = 20) => {
        const box = await viewport.boundingBox(), px = box.x + 8, py = box.y + 8
        await page.mouse.move(px, py); await page.mouse.down(); await page.mouse.move(px + dx, py + 6, { steps: 3 }); await page.mouse.up()
      }
      const beforePan = await stage.evaluate(node => node.style.transform)
      await page.keyboard.down('Space')
      await page.waitForFunction(() => document.querySelector('[data-testid="actual-preview"] div[style*="background-size: 20px 20px"]')?.style.cursor === 'grab')
      await dragPreview(); await page.keyboard.up('Space')
      assert.notEqual(await stage.evaluate(node => node.style.transform), beforePan, 'real source/timeline Space-drag pans')
      assert.equal(await playing(source), false)
      assert.ok(!['grab', 'grabbing', 'ew-resize'].includes(await viewport.evaluate(node => node.style.cursor)), 'release clears pan cursor')
      const beforeZoom = (await stage.boundingBox()).width
      await page.keyboard.down('Space'); await page.keyboard.down('Control'); await dragPreview(60)
      await page.keyboard.up('Control'); await page.keyboard.up('Space')
      assert.notEqual((await stage.boundingBox()).width, beforeZoom, 'Ctrl+Space drag keeps preview zoom')
      assert.equal(await playing(source), false)
      for (const reason of ['blur', 'visibility']) {
        await page.keyboard.down('Space')
        if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')))
        else await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
        const stoppedPan = await stage.evaluate(node => node.style.transform)
        await dragPreview()
        assert.equal(await stage.evaluate(node => node.style.transform), stoppedPan, `${reason} clears passive pan ownership`)
        assert.ok(!['grab', 'grabbing', 'ew-resize'].includes(await viewport.evaluate(node => node.style.cursor)))
        await page.keyboard.up('Space'); assert.equal(await playing(source), false)
        if (reason === 'visibility') await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')) })
      }
      preserved(beforePreview, await snapshot())
    }
    pass('real timeline/source PreviewPanel Space toggles once; pan/Control-zoom still work, release/blur/hidden clear modifiers without playback or edits')

    for (const source of [false, true]) {
      await seed({ source })
      const before = await snapshot()
      for (const target of guardTargets()) {
        await target.focus()
        for (const key of ['Space', 'i', 'o', 'ArrowRight']) await page.keyboard.press(key)
        assert.equal(await playing(source), false)
        preserved(before, await snapshot())
        assert.equal((await snapshot()).time, before.time)
        assert.equal((await snapshot()).sourceTime, before.sourceTime)
      }
      await focus()
      for (const extra of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { prevented: true }]) {
        await page.evaluate(extra => {
          const event = new KeyboardEvent('keydown', { key: 'i', bubbles: true, cancelable: true, ...extra })
          if (extra.prevented) event.preventDefault()
          window.dispatchEvent(event)
        }, extra)
      }
      preserved(before, await snapshot())
    }
    pass('Editor and Source respect native controls, IME, modifiers, handled events and contenteditable without background transport or marks')

    for (const source of [false, true]) {
      for (const reason of ['focus', 'pointer', 'blur', 'visibility', 'modal', 'busy', 'mode', 'unmount', 'pan']) {
        await seed({ source }); await page.keyboard.down('Space')
        if (reason === 'focus') { await page.getByLabel('Typing probe').focus(); await focus() }
        else if (reason === 'pointer') await page.getByRole('heading').click()
        else if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')))
        else if (reason === 'pan') await page.evaluate(() => window.dispatchEvent(new Event('comfystudio-space-modifier-used')))
        else if (reason === 'visibility') await page.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'))
        })
        else if (reason === 'modal') await page.evaluate(() => window.interactionTest.setCaption(true))
        else if (reason === 'busy') await page.evaluate(() => window.interactionTest.assets.setState({ mediaPreparation: { critical: true } }))
        else if (reason === 'mode') await page.evaluate(source => window.interactionTest.assets.setState({ previewMode: source ? 'timeline' : 'asset' }), source)
        else await page.evaluate(() => window.interactionTest.setMounted(false))
        await page.keyboard.up('Space')
        assert.equal((await snapshot()).playing, false, `${source ? 'Source' : 'Editor'} ${reason}`)
        assert.equal((await snapshot()).sourcePaused, true, `${source ? 'Source' : 'Editor'} ${reason}`)
        if (reason === 'visibility') await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')) })
      }
    }
    pass('pending Space retires on focus/pointer/blur/hidden/caption modal/preparation/mode/unmount and existing Space-pan events')

    for (const source of [false, true]) {
      await seed({ source }); const before = await snapshot()
      await page.evaluate(() => window.interactionTest.setCaption(true))
      await page.getByText('Add Captions', { exact: true }).waitFor()
      await focus()
      for (const key of ['Space', 'Enter', 'i', 'o', 'l', 'ArrowRight']) await page.keyboard.press(key)
      assert.equal(await playing(source), false)
      const captionPlay = page.getByTitle('Play the caption animation in this window')
      await captionPlay.focus(); await page.keyboard.press('Enter'); assert.equal((await captionPlay.innerText()).trim(), 'Pause')
      await page.keyboard.press('Space'); assert.equal((await captionPlay.innerText()).trim(), 'Play')
      preserved(before, await snapshot()); assert.equal((await snapshot()).time, before.time)
      await page.screenshot({ path: path.join(output, `caption-${source ? 'source' : 'editor'}.png`) })
    }
    pass('actual caption modal keeps local native Play/Space/Enter behavior while both background transports and marks remain inert')

    for (const kind of ['caption', 'ducking']) {
      await seed()
      await page.evaluate(() => {
        const t = window.interactionTest
        t.setShowTimeline(true)
        t.timeline.getState().updateClipTransform('shape-a', { positionX: -90 }, true)
        t.markProjectClean()
      })
      await page.getByTestId('actual-timeline').waitFor()
      const before = await snapshot()
      assert.ok(JSON.parse(before.history).length > 0, 'modal Undo probe needs a real undo target')
      const toolBefore = await page.evaluate(() => localStorage.getItem('comfystudio-timeline-active-tool-v1'))
      if (kind === 'caption') await page.evaluate(() => window.interactionTest.setCaption(true))
      else await page.evaluate(() => {
        const modal = document.createElement('div'); modal.id = 'synthetic-ducking-dialog'
        modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true')
        modal.textContent = 'Synthetic ducking dialog keyboard boundary'
        modal.style.cssText = 'position:fixed;inset:20px;z-index:99999;background:#111'
        document.body.append(modal)
      })
      await focus()
      for (const key of ['Delete', 'Backspace', 'Control+z', 'Control+Shift+z', 'x', 'i', 'o', 'b', 'v', 't', 'Space', 'Enter', 'l']) {
        await page.keyboard.press(key)
        preserved(before, await snapshot())
      }
      assert.equal(await page.evaluate(() => localStorage.getItem('comfystudio-timeline-active-tool-v1')), toolBefore)
      if (kind === 'ducking') await page.evaluate(() => document.getElementById('synthetic-ducking-dialog').remove())
    }
    pass('actual Timeline Delete/cut/Undo/Redo/tools/marks and transport stay inert behind caption and ducking-style modal boundaries')

    for (const source of [false, true]) {
      await seed({ source }); const before = await snapshot()
      const opened = native ? browser.waitForEvent('window') : page.waitForEvent('popup')
      await page.getByTestId('open-popout').click()
      const popup = await opened
      await popup.waitForFunction(() => document.title === 'Drama Studio Preview' && Boolean(document.querySelector('canvas')))
      await popup.evaluate(() => { window.fullscreenCalls = 0; document.documentElement.requestFullscreen = () => { window.fullscreenCalls++; return Promise.resolve() } })
      await popup.keyboard.down('Space'); await popup.keyboard.down('Space'); assert.equal(await playing(source), false)
      await popup.keyboard.up('Space'); assert.equal(await playing(source), true)
      await popup.keyboard.press('Space'); assert.equal(await playing(source), false)
      if (source) assert.equal((await snapshot()).playCalls, 1, 'one popout action, no duplicate parent transport')
      await popup.keyboard.down('f'); await popup.keyboard.down('f'); await popup.keyboard.up('f')
      assert.equal(await popup.evaluate(() => window.fullscreenCalls), 1)
      await popup.keyboard.down('Space'); await popup.evaluate(() => window.dispatchEvent(new Event('blur'))); await popup.keyboard.up('Space')
      assert.equal(await playing(source), false)
      await popup.keyboard.down('Space'); await page.evaluate(() => window.interactionTest.setCaption(true)); await popup.keyboard.up('Space')
      assert.equal(await playing(source), false, 'a parent modal invalidates child transport release')
      await page.evaluate(() => window.interactionTest.setCaption(false))
      await popup.keyboard.down('Space')
      const closed = popup.waitForEvent('close')
      await page.evaluate(() => window.interactionTest.setMounted(false))
      await closed
      assert.equal(await playing(source), false)
      preserved(before, await snapshot())
    }
    pass('real preview popouts toggle once per Space release/F press, respect parent modals and blur, and close cleanly on owner unmount')

    await seed({ source: true }); const beforeSource = await snapshot()
    await page.keyboard.down('Space'); await page.keyboard.down('Space'); assert.equal((await snapshot()).playCalls, 0)
    await page.keyboard.up('Space'); assert.equal((await snapshot()).playCalls, 1)
    await page.keyboard.press('Space'); assert.equal((await snapshot()).pauseCalls, 1)
    await page.keyboard.press('i')
    await page.evaluate(() => { window.interactionTest.sourceVideo.currentTime = 6 })
    await page.keyboard.press('o')
    await page.keyboard.press('Enter')
    assert.equal((await snapshot()).sourceTime, 2, 'Enter uses the source marked-range rewind, not global asset toggle')
    assert.equal((await snapshot()).playCalls, 2)
    await page.keyboard.press('ArrowRight')
    assert.ok(Math.abs((await snapshot()).sourceTime - (2 + 1 / 24)) < 1e-8)
    await page.getByTestId('actual-source').getByRole('button', { name: 'Play', exact: true }).focus()
    await page.keyboard.press('Space'); assert.equal((await snapshot()).playCalls, 3)
    await page.keyboard.press('Space'); assert.equal((await snapshot()).sourcePaused, true)
    preserved(beforeSource, await snapshot())
    await page.screenshot({ path: path.join(output, 'source.png') })
    pass('Source owns Space once across both real transport components and Enter uses marked range; source I/O/frame steps never author timeline marks')

    const panel = page.getByTestId('actual-inspector')
    const property = name => panel.locator(`[data-inspector-property="${name}"]`)
    const number = name => panel.locator(`input[type="number"][data-inspector-property="${name}"]`)
    const transform = async options => { await seed(options); await panel.locator('[data-inspector-tab="transform"]').click() }
    const positions = () => page.evaluate(() => window.interactionTest.timeline.getState().clips.filter(c => c.type === 'shape').map(c => c.transform.positionX))
    await transform()
    const beforeNumber = await snapshot()
    await property('positionX').click({ button: 'right' })
    await page.mouse.move(300, 300); assert.deepEqual(await positions(), [-100, 100]); preserved(beforeNumber, await snapshot())
    await property('positionX').dblclick(); await number('positionX').fill('999'); await number('positionX').press('Escape')
    await property('positionX').dblclick(); await number('positionX').fill(''); await number('positionX').blur()
    preserved(beforeNumber, await snapshot())
    await property('positionX').dblclick(); await number('positionX').fill('40')
    await number('positionX').dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
    assert.equal(await number('positionX').count(), 1); assert.deepEqual(await positions(), [-100, 100])
    await number('positionX').press('Enter'); await number('positionX').waitFor({ state: 'detached' })
    assert.deepEqual(await positions(), [40, 100]); assert.equal(JSON.parse((await snapshot()).history).length, 1)
    assert.equal((await snapshot()).playing, false)
    pass('numeric right click/empty/Escape do not author values; IME Enter stays editing and confirmed Enter commits exactly one undo')

    for (const reason of ['blur', 'visibility', 'pointercancel', 'selection', 'blocked', 'unmount']) {
      await transform({ multi: reason === 'blocked' })
      await page.evaluate(() => { document.body.style.cursor = 'crosshair'; document.body.style.userSelect = 'text' })
      const target = property('positionX'); await target.scrollIntoViewIfNeeded()
      const box = await target.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 20, y, { steps: 4 })
      const held = await positions(); assert.notEqual(held[0], -100)
      if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')))
      else if (reason === 'pointercancel') await page.evaluate(() => window.dispatchEvent(new Event('pointercancel')))
      else if (reason === 'visibility') await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'))
      })
      else if (reason === 'selection') await page.evaluate(() => window.interactionTest.timeline.setState({ selectedClipIds: ['shape-b'] }))
      else if (reason === 'blocked') {
        await page.evaluate(() => window.interactionTest.timeline.setState(state => ({ clips: state.clips.map(clip => clip.id === 'shape-a'
          ? { ...clip, keyframes: { positionX: [{ time: 0, value: 0 }] } } : clip) })))
        await page.waitForFunction(() => document.querySelector('[data-inspector-property="positionX"]')?.getAttribute('aria-disabled') === 'true')
        await page.evaluate(() => window.interactionTest.timeline.setState(state => ({ clips: state.clips.map(clip => clip.id === 'shape-a'
          ? { ...clip, keyframes: {} } : clip) })))
        await page.waitForFunction(() => document.querySelector('[data-inspector-property="positionX"]')?.getAttribute('aria-disabled') !== 'true')
      }
      else await page.evaluate(() => window.interactionTest.setMounted(false))
      await page.mouse.move(x + 45, y, { steps: 3 }); await page.mouse.up()
      assert.deepEqual(await positions(), held, `${reason} cannot retain numeric drag ownership`)
      assert.deepEqual(await page.evaluate(() => [document.body.style.cursor, document.body.style.userSelect]), ['crosshair', 'text'])
      if (reason === 'visibility') await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')) })
      await page.evaluate(() => { document.body.style.cursor = ''; document.body.style.userSelect = '' })
    }
    pass('number drags retire on blur/hidden/pointer-cancel/selection/eligibility/unmount and restore prior body styles without late edits')

    await transform({ multi: true })
    const slider = panel.locator('input[type="range"][data-inspector-property="scaleX"]')
    await slider.focus(); const oldScale = Number(await slider.inputValue()), oldTime = (await snapshot()).time
    await page.keyboard.press('ArrowRight')
    assert.ok(Number(await slider.inputValue()) > oldScale)
    assert.equal((await snapshot()).time, oldTime); assert.equal((await snapshot()).playing, false)
    assert.equal(JSON.parse((await snapshot()).history).length, 1)
    await slider.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
    assert.equal(await slider.evaluate(node => node === document.activeElement), true)
    await property('positionX').dblclick(); await number('positionX').fill('700')
    await page.evaluate(() => window.interactionTest.timeline.setState({ selectedClipIds: ['shape-b'] }))
    if (await number('positionX').count()) await number('positionX').blur()
    assert.deepEqual(await positions(), [-100, 100])
    await page.screenshot({ path: path.join(output, 'inspector.png') })
    pass('multi-selection slider retains native arrows/IME and one undo; changing selection cancels stale numeric typing')
    assert.deepEqual(errors, [])
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ runtime: native ? 'isolated Electron UI' : 'Chrome', groups, errors }, null, 2))
    console.log(`PASS ${groups.length} interaction groups; artifacts ${output}`)
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
      fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: error.stack, errors,
        state: await page.evaluate(() => window.interactionTest?.snapshot()).catch(() => null) }, null, 2))
    }
    console.error(`Artifacts ${output}`)
    throw error
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
