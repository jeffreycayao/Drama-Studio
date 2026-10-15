// Isolated real Timeline/Inspector/Effects gestures with synthetic blob media.
// Start dedicated Vite :5193; never point this at the user's app or project.
// Optional VELORN_TRANSITION_BASELINE=1 records the former compact-cut blocker.
// VELORN_TEST_ELECTRON=1 uses the isolated test host and makes its window visible.
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`)
const byId = (state, id) => state.clips.find(clip => clip.id === id)
const documentState = state => ({ clips: state.clips, tracks: state.tracks, transitions: state.transitions,
  markers: state.markers, inPoint: state.inPoint, outPoint: state.outPoint })
function encode(color) {
  const encoded = spawnSync(process.env.FFMPEG_PATH || require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${color}:s=96x54:r=24:d=8`, '-an', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-g', '1', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'],
  { timeout: 30000, maxBuffer: 8 * 1024 * 1024 })
  assert.equal(encoded.status, 0, String(encoded.stderr))
  return { base64: encoded.stdout.toString('base64'), fps: 24 }
}
async function main() {
  const native = process.env.VELORN_TEST_ELECTRON === '1'
  const noSandbox = process.env.VELORN_TEST_ELECTRON_NO_SANDBOX === '1'
  if (native && noSandbox) console.warn('TEST ONLY: Electron sandbox disabled; not packaged-platform verification.')
  const browser = native
    ? await _electron.launch({ executablePath: require('electron'), args: [
      ...(noSandbox ? ['--no-sandbox'] : []), path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')] })
    : await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true })
  try {
    const page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    if (native) await browser.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(1440, 1000); window.show(); window.focus()
    })
    page.setDefaultTimeout(10000)
    await page.addInitScript(() => {
      localStorage.setItem('comfystudio-timeline-track-height-preset', 'compact')
      localStorage.setItem('comfystudio-timeline-active-tool-v1', 'auto')
    })
    const errors = []
    page.on('pageerror', error => { errors.push(error.message); console.error('Renderer:', error.message) })
    await page.routeWebSocket(/ws:\/\/(?:127\.0\.0\.1|localhost):5193\//, socket => socket.close())
    await page.goto((process.env.VELORN_TEST_URL || 'http://127.0.0.1:5193') + '/tests/fixtures/transition-affordances.html' + (native ? '?nativeWaveformStub=1' : ''))
    await page.waitForFunction(() => Boolean(window.compoundTest?.timeline), null, { polling: 100 })
    await page.evaluate(media => window.compoundTest.initializeMedia(media), { red: encode('red'), blue: encode('blue') })
    const settle = () => page.waitForTimeout(120)
    const screenshot = async suffix => {
      if (process.env.VELORN_TEST_SCREENSHOT) await page.screenshot({
        path: process.env.VELORN_TEST_SCREENSHOT.replace(/\.png$/, `-${suffix}.png`) })
    }
    const state = () => page.evaluate(() => {
      const t = window.compoundTest, s = t.timeline.getState()
      return JSON.parse(JSON.stringify({ clips: s.clips, tracks: s.tracks, transitions: s.transitions, markers: s.markers,
        inPoint: s.inPoint, outPoint: s.outPoint, selectedClipIds: s.selectedClipIds, selectedTransitionId: s.selectedTransitionId,
        history: s.history.length, historyIndex: s.historyIndex, dirty: t.isProjectDirty(), playhead: s.playheadPosition }))
    })
    const seed = async (options = {}) => {
      await page.mouse.up(); await page.keyboard.press('Escape')
      await page.evaluate(options => {
        const t = window.compoundTest
        t.reset({ clips: [
          t.makeClip('a', { trackId: 'video-1', startTime: 1, duration: 3, trimStart: 1, trimEnd: 4, ...options.a }),
          t.makeClip('b', { trackId: 'video-1', assetId: 'blue', url: t.getAsset('blue').url,
            startTime: 4, duration: 3, trimStart: 2, trimEnd: 5, ...options.b }),
          t.makeClip('c', { trackId: 'video-1', startTime: 7, duration: 2, trimStart: 2, trimEnd: 4 }),
          t.makeClip('unrelated', { trackId: 'video-2', startTime: 2, duration: 2, trimStart: 1, trimEnd: 3 })],
          tracks: [t.track('video-1', 'video', options.track), t.track('video-2')],
          selectedClipIds: options.selected || [], playheadPosition: 0, zoom: options.zoom || 500,
          rippleEditMode: options.ripple === true, transitions: [] })
      }, options)
      await page.locator('[aria-label="Timeline edit tools"] button').nth({ auto: 0, trim: 2, razor: 3 }[options.tool || 'auto']).click()
      await settle()
    }
    const undo = () => page.evaluate(() => window.compoundTest.timeline.getState().undo())
    const cutPoint = async (id = 'a', offset = 0) => {
      const clip = page.locator(`[data-clip-id="${id}"]`).first()
      await clip.scrollIntoViewIfNeeded(); const box = await clip.boundingBox()
      assert.ok(box && box.height <= 28, 'compact 32px lane is under test')
      return { x: box.x + box.width + offset, y: box.y + box.height / 2, box }
    }
    const drag = async (point, delta) => {
      await page.mouse.move(point.x, point.y); await page.mouse.down()
      await page.mouse.move(point.x + delta, point.y, { steps: 8 }); await page.mouse.up(); await settle()
    }
    const rightClickCut = async offset => {
      const point = await cutPoint('a', offset)
      await page.mouse.click(point.x, point.y, { button: 'right' }); await settle()
      return page.getByRole('button', { name: /^Add transition$/i })
    }
    const transition = () => page.locator('[class~="group/trans"]').first()
    const noEdit = (after, before, label) => {
      assert.deepEqual(documentState(after), documentState(before), label)
      assert.equal(after.history, before.history, `${label}: history`)
      assert.equal(after.historyIndex, before.historyIndex, `${label}: history cursor`)
      assert.equal(after.dirty, before.dirty, `${label}: dirty`)
    }

    // Baseline mode remains a reproducible real-pointer proof, not a source
    // string assertion. The former center button and its wrapper stole these.
    if (process.env.VELORN_TRANSITION_BASELINE === '1') {
      for (const [edge, offset, delta] of [['tail', -2, -50], ['head', 2, 50]]) {
        await seed(); const before = await state(), point = await cutPoint('a', offset)
        const target = await page.evaluate(({ x, y }) => {
          const element = document.elementFromPoint(x, y)
          return { tag: element.tagName, button: element.closest('button')?.title || null,
            trim: Boolean(element.closest('[data-trim-handle]')), className: element.getAttribute('class') }
        }, point)
        await drag(point, delta); noEdit(await state(), before, `former ${edge} is blocked`)
        console.log(`BASELINE compact ${edge}:`, JSON.stringify({ target, point, unchanged: true }))
      }
      return
    }

    // 1. Idle pixels belong to actual trims; no force-click or synthetic input.
    for (const [edge, offset, delta] of [['tail', -2, -50], ['head', 2, 50]]) {
      await seed(); const before = await state(), point = await cutPoint('a', offset)
      assert.equal(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[data-trim-handle]')), point), true,
        `${edge} owns its visible hit area`)
      assert.equal(await page.locator('button[title="Add transition"]').count(), 0, 'no idle center plus')
      if (edge === 'tail') await screenshot('idle')
      await drag(point, delta); const after = await state()
      if (edge === 'tail') { near(byId(after, 'a').duration, 2.5, 'tail trim'); assert.deepEqual(byId(after, 'b'), byId(before, 'b')) }
      else { near(byId(after, 'b').startTime, 4.5, 'head trim'); near(byId(after, 'b').trimStart, 2.5, 'head source in'); assert.deepEqual(byId(after, 'a'), byId(before, 'a')) }
      assert.equal(after.transitions.length, 0); assert.equal(after.history, 1)
      await undo(); assert.deepEqual(documentState(await state()), documentState(before))
    }
    console.log('PASS 1: compact Auto head/tail trim hit areas, actual drag, one Undo, no idle plus')

    // 2. Trim tool still has a distinct real rolling gesture at the exact cut.
    await seed({ tool: 'trim' }); const beforeRoll = await state()
    await drag(await cutPoint(), 50); const rolled = await state()
    near(byId(rolled, 'a').duration, 3.5, 'roll outgoing'); near(byId(rolled, 'b').startTime, 4.5, 'roll incoming')
    near(byId(rolled, 'b').duration, 2.5, 'roll incoming duration'); assert.equal(rolled.history, 1)
    assert.equal(rolled.transitions.length, 0); await undo(); assert.deepEqual(documentState(await state()), documentState(beforeRoll))
    await seed({ ripple: true }); const beforeRipple = await state(), ripplePoint = await cutPoint('a', -2)
    assert.equal(await page.evaluate(({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('[data-ripple-trim-handle]')), ripplePoint), true,
      'Ripple owns its visible cut-edge hit area')
    await drag(ripplePoint, -50); const rippled = await state()
    near(byId(rippled, 'a').duration, 2.5, 'ripple tail'); near(byId(rippled, 'b').startTime, 3.5, 'ripple downstream shift')
    assert.equal(rippled.history, 1); assert.equal(rippled.transitions.length, 0)
    await undo(); assert.deepEqual(documentState(await state()), documentState(beforeRipple))
    console.log('PASS 2: compact Trim-tool roll and Ripple trim remain distinct edits with one Undo')

    // 3. Direct right-click works with no selected clips. Opening/cancelling is
    // read-only; applying scopes to this cut even if another clip was selected.
    for (const selected of [[], ['unrelated', 'b', 'c']]) {
      await seed({ selected }); const before = await state()
      let menu = await rightClickCut(0); await menu.waitFor(); noEdit(await state(), before, 'menu open is read-only')
      assert.deepEqual((await state()).selectedClipIds, selected, 'direct-cut menu preserves existing selection')
      if (!selected.length) await screenshot('cut-menu')
      await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' }); noEdit(await state(), before, 'cancel is read-only')
      menu = await rightClickCut(-2); await menu.click(); await settle(); const after = await state()
      assert.equal(after.transitions.length, 1); assert.equal(after.transitions[0].clipAId, 'a'); assert.equal(after.transitions[0].clipBId, 'b')
      assert.equal(after.history, 1); await undo(); assert.deepEqual(documentState(await state()), documentState(before))
    }
    for (const tool of ['trim', 'razor']) {
      await seed({ tool }); const before = await state(), menu = await rightClickCut(-2)
      await menu.waitFor(); noEdit(await state(), before, `${tool} right-button must not start a cut/trim gesture`)
      await page.keyboard.press('Escape')
    }
    for (const change of ['source reference', 'timeline session', 'track lock']) {
      await seed(); const menu = await rightClickCut(0); await menu.waitFor()
      await page.evaluate(change => {
        const t = window.compoundTest, s = t.timeline.getState()
        if (change === 'source reference') t.timeline.setState({ clips: s.clips.map(clip => clip.id === 'a'
          ? { ...clip, url: t.getAsset('blue').url, assetId: 'blue' } : clip) })
        if (change === 'timeline session') t.timeline.setState({ timelineSessionId: s.timelineSessionId + 1 })
        if (change === 'track lock') t.timeline.setState({ tracks: s.tracks.map(track => track.id === 'video-1' ? { ...track, locked: true } : track) })
        t.markProjectClean()
      }, change)
      const changed = await state(); await menu.waitFor({ state: 'hidden' }); await settle()
      noEdit(await state(), changed, `${change} invalidates open menu without edit`)
    }
    console.log('PASS 3: unselected-cut menu, exact pair scope, right-button safety, stale-menu dismissal and one Undo')

    // 4. The existing selection hotkey and applied-transition controls survive.
    await seed({ selected: ['a', 'b'] }); const beforeHotkey = await state()
    await page.keyboard.press('Shift+t'); await settle(); const hotkey = await state()
    assert.equal(hotkey.transitions.length, 1); assert.equal(hotkey.history, 1)
    await transition().click(); await page.getByText('Transition Type', { exact: true }).waitFor()
    assert.equal((await state()).selectedTransitionId, hotkey.transitions[0].id)
    const typeSelect = page.locator('label').filter({ hasText: /^Transition Type$/ }).locator('..').locator('select')
    await typeSelect.selectOption('fade-black'); await settle(); assert.equal((await state()).transitions[0].type, 'fade-black')
    const resizeBox = await transition().locator('[title="Drag to adjust transition duration"]').first().boundingBox()
    assert.ok(resizeBox, 'selected transition retains its duration edge')
    const durationBeforeDrag = (await state()).transitions[0].duration
    await drag({ x: resizeBox.x + 2, y: resizeBox.y + resizeBox.height / 2 }, -10)
    assert.notEqual((await state()).transitions[0].duration, durationBeforeDrag, 'actual transition-edge drag changes duration')
    const durationCard = page.locator('label').filter({ hasText: /^Duration$/ }).locator('..')
    const durationInput = durationCard.locator('input[type="number"]')
    await durationInput.fill('18'); await settle(); near((await state()).transitions[0].duration, 18 / 24, 'Inspector duration')
    await page.getByRole('button', { name: 'Set as Default Duration', exact: true }).click()
    assert.equal(await page.evaluate(() => localStorage.getItem('comfystudio-transition-default-duration-frames')), '18')
    await screenshot('inspector')
    await transition().getByTitle('Remove transition', { exact: true }).click(); await settle()
    assert.equal((await state()).transitions.length, 0)
    await seed({ selected: ['a', 'b'] }); await page.keyboard.press('Shift+t'); await settle(); await undo()
    assert.deepEqual(documentState(await state()), documentState(beforeHotkey))
    console.log('PASS 4: Shift+T, transition selection/edge drag, Inspector type/duration/default and removal controls')

    // 5. Real HTML drag from the real EffectsPanel validates the browser's
    // protected dragover payload mode (getData is empty until the actual drop).
    const effects = page.locator('#fixture-effects-bin')
    await effects.getByRole('textbox').first().fill('Dissolve')
    const source = effects.locator('[draggable="true"]').filter({ hasText: 'Dissolve' }).first()
    await page.evaluate(() => {
      window.transitionDragProof = []
      for (const type of ['dragover', 'drop']) window.addEventListener(type, event => {
        const mime = 'application/x-comfystudio-transition'
        if (Array.from(event.dataTransfer?.types || []).includes(mime)) window.transitionDragProof.push({
          type, trusted: event.isTrusted, raw: event.dataTransfer.getData(mime), x: event.clientX, y: event.clientY })
      }, true)
    })
    const startTransitionDrag = async (item = source) => {
      await item.scrollIntoViewIfNeeded(); const box = await item.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 15, box.y + box.height / 2, { steps: 5 })
    }
    const hoverTransitionAt = async point => {
      await page.mouse.move(point.x, point.y, { steps: 12 })
      // Entering a new native HTML drop target may emit dragenter first.
      // A second real move delivers dragover consistently in both hosts.
      await page.mouse.move(point.x + 1, point.y); await page.mouse.move(point.x, point.y); await settle()
    }
    await seed(); const beforeDrop = await state(), dropPoint = await cutPoint()
    await startTransitionDrag(); await hoverTransitionAt(dropPoint)
    const highlight = page.getByTestId('transition-drop-highlight')
    if (!await highlight.count()) console.error('Native transition drag diagnostic:', JSON.stringify({ dropPoint,
      source: await source.boundingBox(), state: await state(), proof: await page.evaluate(() => window.transitionDragProof),
      hit: await page.evaluate(({ x, y }) => { const hit = document.elementFromPoint(x, y); return {
        tag: hit?.tagName, className: hit?.getAttribute('class'), text: hit?.textContent, parent: hit?.parentElement?.outerHTML.slice(0, 1200) } }, dropPoint) }))
    assert.equal(await highlight.count(), 1, 'highlight exists during transition dragover only')
    assert.equal(await page.evaluate(() => window.transitionDragProof.some(event => event.type === 'dragover' && event.trusted && event.raw === '')), true,
      'real browser dragover protects payload contents')
    noEdit(await state(), beforeDrop, 'drag hover is read-only')
    await screenshot('drag-highlight')
    await page.mouse.up(); await settle(); const dropped = await state()
    assert.equal(dropped.transitions.length, 1); assert.equal(dropped.transitions[0].clipAId, 'a'); assert.equal(dropped.transitions[0].clipBId, 'b')
    assert.equal(dropped.history, 1); assert.equal(await highlight.count(), 0, 'drop clears highlight')
    assert.equal(await page.evaluate(() => window.transitionDragProof.some(event => event.type === 'drop' && event.trusted && JSON.parse(event.raw).type === 'dissolve')), true,
      'actual browser drop exposes the EffectsPanel payload')
    await effects.getByRole('textbox').first().fill('Fade to Black')
    const replacement = effects.locator('[draggable="true"]').filter({ hasText: 'Fade to Black' }).first()
    await startTransitionDrag(replacement); await hoverTransitionAt(dropPoint)
    assert.equal(await highlight.count(), 1, 'existing transition accepts replacement hover')
    await page.mouse.up(); await settle(); const replaced = await state()
    assert.equal(replaced.transitions.length, 1); assert.equal(replaced.transitions[0].id, dropped.transitions[0].id)
    assert.equal(replaced.transitions[0].type, 'fade-black'); assert.equal(replaced.history, dropped.history + 1)
    assert.deepEqual(replaced.clips, dropped.clips, 'replacement keeps exact clip timings')
    await undo(); assert.deepEqual(documentState(await state()), documentState(dropped))
    await undo(); assert.deepEqual(documentState(await state()), documentState(beforeDrop))
    await effects.getByRole('textbox').first().fill('Dissolve')
    await seed(); await startTransitionDrag(); const cancelPoint = await cutPoint()
    await hoverTransitionAt(cancelPoint)
    assert.equal(await highlight.count(), 1); await page.keyboard.press('Escape'); await page.mouse.up(); await settle()
    assert.equal(await highlight.count(), 0, 'cancelled native drag clears highlight'); assert.equal((await state()).transitions.length, 0)
    console.log('PASS 5: native Effects transition dragover highlight, actual drop, Undo and cancelled-drag cleanup')

    // 6. Non-transition drops still reach established effect/asset handlers.
    // These payload-contract checks complement the genuine transition drag.
    const dispatchDrop = (point, mime, payload) => page.evaluate(({ point, mime, payload }) => {
      const transfer = new DataTransfer(); transfer.setData(mime, JSON.stringify(payload))
      const element = document.elementFromPoint(point.x, point.y)
      for (const type of ['dragenter', 'dragover', 'drop']) element.dispatchEvent(new DragEvent(type,
        { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, dataTransfer: transfer }))
    }, { point, mime, payload })
    await seed(); await dispatchDrop(await cutPoint('a', 2), 'application/x-comfystudio-effect', { effectType: 'gaussianBlur', settings: { amount: 1 } })
    await settle(); const effected = await state()
    assert.equal(effected.transitions.length, 0); assert.equal(byId(effected, 'b').effects.length, 1)
    assert.equal(await highlight.count(), 0)
    await seed(); await dispatchDrop(await cutPoint('a', 2), 'application/x-comfystudio-asset-ids', ['blue'])
    await settle(); const assetDropped = await state()
    assert.equal(assetDropped.transitions.length, 0); assert.ok(assetDropped.clips.some(clip => !['a', 'b', 'c', 'unrelated'].includes(clip.id)))
    assert.equal(await highlight.count(), 0)
    await seed(); const beforeBody = await state(), body = (await cutPoint()).box
    await drag({ x: body.x + body.width / 2, y: body.y + body.height / 2 }, -50)
    near(byId(await state(), 'a').startTime, 0.5, 'ordinary body move'); assert.equal((await state()).transitions.length, 0)
    await undo(); assert.deepEqual(documentState(await state()), documentState(beforeBody))
    console.log('PASS 6: non-transition effect/asset drop routing and ordinary clip-body dragging remain intact')

    // 7. Invalid edit points never become a drop affordance or mutate history.
    for (const [name, options] of [
      ['gap', { b: { startTime: 4.25 } }], ['overlap', { b: { startTime: 3.75 } }],
      ['locked track', { track: { locked: true } }],
      ['unsupported compound', { a: { type: 'compound', assetId: null, url: null, compound: { version: 1, document: {
        fps: 24, width: 960, height: 540, duration: 8, clips: [], tracks: [], transitions: [], markers: [],
      } } } }], ['unsupported audio', { a: { type: 'audio', assetId: null, url: null } }],
    ]) {
      await seed(options); const beforeContext = await state()
      const menu = await rightClickCut(-2); assert.equal(await menu.count(), 0, `${name} has no Add transition action`)
      noEdit(await state(), beforeContext, `${name} context fallback does not create an edit`)
      // Ordinary clip context menus retain their existing behavior outside a
      // valid cut. Start a fresh document to isolate rejected transition DnD.
      await seed(options); const before = await state(), point = await cutPoint()
      await startTransitionDrag(); await hoverTransitionAt(point)
      assert.equal(await highlight.count(), 0, `${name} has no drop highlight`)
      await page.mouse.up(); await settle(); noEdit(await state(), before, `${name} refuses without history`)
    }
    // A sync lock preserves source/timeline timing; it is not a ban on
    // cut-anchored visual effects. Do not expand this affordance's lock policy.
    await seed({ a: { lockMode: 'sync', syncLock: { mode: 'sync', startTime: 1, duration: 3 } } })
    const beforeSync = await state(), syncMenu = await rightClickCut(0)
    await syncMenu.click(); await settle(); const syncAfter = await state()
    assert.equal(syncAfter.transitions.length, 1); assert.deepEqual(syncAfter.clips, beforeSync.clips)
    await undo(); assert.deepEqual(documentState(await state()), documentState(beforeSync))
    console.log('PASS 7: invalid cuts/locked tracks/unsupported sources refuse; allowed sync-locked effects preserve timing')

    // 8. A compact narrow window still exposes direct-cut context/trim actions.
    if (native) await browser.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900, 800))
    else await page.setViewportSize({ width: 900, height: 800 })
    await seed({ zoom: 250 }); const beforeNarrow = await state()
    const menu = await rightClickCut(0); await menu.waitFor()
    const menuBox = await menu.boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= viewport.width && menuBox.y >= 0 && menuBox.y + menuBox.height <= viewport.height,
      'narrow-window cut menu is fully reachable')
    await menu.click(); await settle(); assert.equal((await state()).transitions.length, 1)
    await undo(); assert.deepEqual(documentState(await state()), documentState(beforeNarrow))
    await seed({ zoom: 250 }); await drag(await cutPoint('a', -2), -25); near(byId(await state(), 'a').duration, 2.5, 'narrow compact tail trim')
    if (process.env.VELORN_TEST_SCREENSHOT) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT })
    assert.deepEqual(errors, [])
    console.log(`PASS 8: narrow 900px compact menu/apply/Undo/trim; no renderer errors (${native ? 'visible isolated Electron' : 'Chrome'})`)
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
