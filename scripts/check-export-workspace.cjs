// Actual ExportPanel layout and worker lifecycle, using only the fixture's
// strict in-memory desktop bridge. No worker/output or user project exists.
// This does not verify native encoding, export parity or packaged platforms.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const base = process.env.VELORN_TEST_URL || 'http://127.0.0.1:5194'
const native = process.env.VELORN_TEST_ELECTRON === '1'
const output = process.env.VELORN_EXPORT_UI_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-export-workspace-'))

async function main() {
  const browser = native ? await _electron.launch({ executablePath: require('electron'),
    args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')], env: { ...process.env, VELORN_TEST_URL: base } })
    : await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true })
  let page
  const errors = [], reports = []
  try {
    page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    if (native) await browser.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
    page.setDefaultTimeout(10000)
    page.on('pageerror', error => { errors.push(error.message); console.error('Renderer:', error.message) })
    await page.routeWebSocket(url => url.hostname === new URL(base).hostname && url.port === new URL(base).port, socket => socket.close())
    await page.goto(`${base}/tests/fixtures/export-workspace.html`)
    await page.waitForFunction(() => Boolean(window.exportWorkspaceTest?.snapshot().settings))
    const control = key => page.locator(`#export-${key}`)
    const action = name => page.getByTestId(`export-${name}`)
    const snapshot = () => page.evaluate(() => window.exportWorkspaceTest.snapshot())
    const settings = async () => (await snapshot()).settings
    const showControl = async key => {
      const sections = await control(key).evaluate(element => {
        const names = []
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (parent.tagName === 'DETAILS' && !parent.open) names.unshift(parent.querySelector(':scope > summary')?.textContent)
        }
        return names.filter(Boolean)
      })
      for (const name of sections) await openSection(name)
    }
    const select = async (key, value) => {
      if (key === 'range') {
        await action(`range-${value}`).click(); await waitSetting(key, value); return
      }
      await showControl(key)
      await control(key).selectOption(String(value)); await waitSetting(key, value)
    }
    const waitSetting = async (key, value) => page.waitForFunction(({ key, value }) =>
      String(window.exportWorkspaceTest.snapshot().settings?.[key]) === String(value), { key, value })
    const reset = async (options = {}) => {
      await page.evaluate(options => window.exportWorkspaceTest.reset(options), options)
      await action('start').waitFor()
      await page.waitForFunction(() => window.exportWorkspaceTest.snapshot().listenerCounts.progress === 1)
    }
    const openSection = async name => {
      const summary = page.locator('summary').filter({ hasText: name }).first()
      if (await summary.count() && !(await summary.evaluate(element => element.parentElement.open))) await summary.click()
    }
    const waitJob = async count => {
      await page.waitForFunction(count => window.exportWorkspaceTest.jobs.length === count
        && Boolean(window.exportWorkspaceTest.snapshot().activeJobId), count)
      return (await snapshot()).jobs.at(-1)
    }
    const complete = async () => {
      await page.evaluate(() => window.exportWorkspaceTest.complete())
      await page.waitForFunction(() => !window.exportWorkspaceTest.snapshot().activeJobId)
      await action('start').waitFor()
    }
    const resize = async width => {
      if (native) await browser.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 1000), width)
      else await page.setViewportSize({ width, height: 1000 })
    }
    const pass = message => { reports.push(message); console.log(`PASS ${reports.length}: ${message}`) }

    // Layout and real preview are present without starting any output operation.
    for (const width of [1440, 1024, 900]) {
      await resize(width)
      await page.waitForTimeout(100)
      const geometry = await page.evaluate(() => {
        const result = { width: innerWidth, documentWidth: document.documentElement.scrollWidth, panels: {} }
        for (const name of ['export-workspace', 'export-settings', 'export-queue', 'export-review-preview']) {
          const node = document.querySelector(`[data-testid="${name}"]`), rect = node?.getBoundingClientRect()
          result.panels[name] = rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null
        }
        return result
      })
      assert.ok(geometry.documentWidth <= width + 1, `no page-wide horizontal overflow: ${JSON.stringify(geometry)}`)
      for (const [name, rect] of Object.entries(geometry.panels)) {
        assert.ok(rect && rect.width > 30 && rect.height > 20, `${name} must remain usable at ${width}: ${JSON.stringify(rect)}`)
        assert.ok(rect.left >= -1 && rect.right <= width + 1, `${name} must fit ${width}px: ${JSON.stringify(rect)}`)
      }
      await page.screenshot({ path: path.join(output, `export-${width}${native ? '-native' : ''}.png`) })
    }
    assert.equal((await snapshot()).jobs.length, 0)
    assert.equal((await snapshot()).calls.some(call => ['createDirectory', 'writeFile', 'runExportInWorker'].includes(call.method)), false)
    pass('1440/1024/900 layouts keep settings, review and queue visible without export calls')
    await resize(1440)

    const themeColors = []
    for (const theme of ['velorn', 'high-contrast', 'arctic']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      themeColors.push(await action('workspace').evaluate(element => getComputedStyle(element).backgroundColor))
      await page.screenshot({ path: path.join(output, `export-theme-${theme}${native ? '-native' : ''}.png`) })
    }
    assert.equal(new Set(themeColors).size, 3, 'workspace follows all three theme palettes')
    await page.evaluate(() => { delete document.documentElement.dataset.theme })
    const duplicateIds = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id^="export-"]')].map(node => node.id)
      return ids.filter((id, index) => ids.indexOf(id) !== index)
    })
    assert.deepEqual(duplicateIds, [])
    pass('theme variables apply to workspace and export controls have unique IDs')

    // Normalize persisted export defaults once before comparing later remounts;
    // the existing loader explicitly adds its forced safe-render flags.
    await page.evaluate(() => window.exportWorkspaceTest.remount())
    await action('start').waitFor()
    const beforeResize = await snapshot()
    const widthStorageKey = 'velorn-export-panel-widths-v1'
    const divider = side => action(`resize-${side}`)
    const panelWidths = () => page.evaluate(() => {
      const width = selector => document.querySelector(selector)?.getBoundingClientRect().width ?? 0
      return { settings: width('[data-testid="export-settings"]'), queue: width('[data-testid="export-queue"]'),
        preview: width('.export-workspace__review'), body: document.querySelector('.export-workspace__body')?.clientWidth ?? 0,
        viewport: innerWidth, document: document.documentElement.scrollWidth }
    })
    const preferences = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), widthStorageKey)
    const waitPanelWidth = (side, expected) => page.waitForFunction(({ side, expected }) =>
      Math.abs((document.querySelector(`[data-testid="export-${side}"]`)?.getBoundingClientRect().width ?? -1) - expected) < 1,
    { side, expected })
    const globalStyles = () => page.evaluate(() => ({ bodyCursor: document.body.style.cursor, bodySelect: document.body.style.userSelect,
      rootCursor: document.documentElement.style.cursor, rootSelect: document.documentElement.style.userSelect }))
    const beginDividerDrag = async (side, delta) => {
      await divider(side).evaluate(element => element.addEventListener('pointerdown', event => {
        window.exportResizePointerId = event.pointerId
      }, { once: true }))
      const box = await divider(side).boundingBox()
      assert.ok(box && box.width >= 5, `${side} divider has a usable hit target`)
      const point = { x: box.x + box.width / 2, y: box.y + Math.min(100, box.height / 2) }
      await page.mouse.move(point.x, point.y); await page.mouse.down()
      await page.mouse.move(point.x + delta, point.y, { steps: 5 })
    }
    const dragDivider = async (side, delta) => { await beginDividerDrag(side, delta); await page.mouse.up() }
    const waitPreferences = (expected) => page.waitForFunction(({ key, expected }) => {
      const actual = JSON.parse(localStorage.getItem(key) || 'null')
      return actual && actual.settings === expected.settings && actual.queue === expected.queue
    }, { key: widthStorageKey, expected })
    const assertResizeSafe = async () => {
      const state = await snapshot()
      assert.equal(state.timeline, beforeResize.timeline); assert.equal(state.history, beforeResize.history)
      assert.deepEqual(state.selectedClipIds, beforeResize.selectedClipIds)
      assert.deepEqual([state.playheadPosition, state.inPoint, state.outPoint],
        [beforeResize.playheadPosition, beforeResize.inPoint, beforeResize.outPoint])
      assert.deepEqual(state.settings, beforeResize.settings)
      assert.equal(state.dirty, false); assert.equal(state.jobs.length, 0)
      assert.equal(state.calls.some(call => ['saveFileDialog', 'selectDirectory', 'createDirectory', 'writeFile', 'runExportInWorker'].includes(call.method)), false)
    }
    for (const [side, name, panel] of [['settings', 'Resize export settings', 'export-settings-panel'], ['queue', 'Resize export queue', 'export-render-queue']]) {
      assert.equal(await divider(side).getAttribute('role'), 'separator')
      assert.equal(await divider(side).getAttribute('aria-label'), name)
      assert.equal(await divider(side).getAttribute('aria-orientation'), 'vertical')
      assert.equal(await divider(side).getAttribute('aria-controls'), panel)
    }
    const defaultWidths = await panelWidths()
    assert.deepEqual([defaultWidths.settings, defaultWidths.queue], [272, 230])
    await dragDivider('settings', 80); await waitPanelWidth('settings', 352)
    await dragDivider('queue', -60); await waitPanelWidth('queue', 290)
    await waitPreferences({ settings: 352, queue: 290 })
    assert.ok(Math.abs((await panelWidths()).preview - (defaultWidths.preview - 140)) < 1)
    await page.evaluate(() => window.exportWorkspaceTest.remount())
    await waitPanelWidth('settings', 352); await waitPanelWidth('queue', 290)
    await page.locator('button[aria-controls="export-render-queue"]').click()
    assert.equal(await action('queue').count(), 0); assert.equal(await divider('queue').count(), 0)
    assert.ok((await panelWidths()).preview > defaultWidths.preview - 80)
    await page.locator('button[aria-controls="export-render-queue"]').click()
    await waitPanelWidth('queue', 290)
    assert.deepEqual(await preferences(), { settings: 352, queue: 290 })
    await page.screenshot({ path: path.join(output, `export-resized${native ? '-native' : ''}.png`) })
    await assertResizeSafe()
    pass('both dividers drag in the correct direction and persist across remount and queue hide/show without document changes')

    await divider('settings').press('Home'); await waitPanelWidth('settings', 220)
    await divider('queue').press('Home'); await waitPanelWidth('queue', 180)
    await divider('settings').press('End'); await waitPanelWidth('settings', 520)
    await divider('queue').press('End'); await waitPanelWidth('queue', 480)
    assert.ok((await panelWidths()).preview >= 320)
    await divider('settings').press('Shift+ArrowLeft'); await waitPanelWidth('settings', 480)
    await divider('queue').press('Shift+ArrowRight'); await waitPanelWidth('queue', 440)
    await divider('settings').press('ArrowRight'); await waitPanelWidth('settings', 490)
    await divider('queue').press('ArrowLeft'); await waitPanelWidth('queue', 450)
    await divider('settings').press('Enter'); await waitPanelWidth('settings', 272)
    await divider('queue').dblclick(); await waitPanelWidth('queue', 230)
    await waitPreferences({ settings: null, queue: null })
    await dragDivider('settings', -1000); await waitPanelWidth('settings', 220)
    await dragDivider('settings', 1000); await waitPanelWidth('settings', 520)
    await dragDivider('queue', -1000); await waitPanelWidth('queue', 480)
    assert.ok((await panelWidths()).preview >= 320)
    await waitPreferences({ settings: 520, queue: 480 })
    pass('pointer and keyboard resizing enforce width limits, protect preview space and support per-panel reset')

    for (const width of [1024, 900, 780, 500]) {
      await resize(width)
      // Electron's native size call can return before ResizeObserver delivers
      // the new renderer content size. Await the resolved responsive layout;
      // this is a functional check, not a 100ms window-resize benchmark.
      await page.waitForFunction(width => {
        const rectWidth = selector => document.querySelector(selector)?.getBoundingClientRect().width ?? 0
        const preview = rectWidth('.export-workspace__review')
        const body = document.querySelector('.export-workspace__body')?.clientWidth ?? 0
        const queue = rectWidth('[data-testid="export-queue"]')
        return innerWidth === width && (width > 800 ? preview >= 319.5 : width > 560
          ? preview >= 279.5 && Math.abs(queue - body) < 1
          : Math.abs(rectWidth('[data-testid="export-settings"]') - body) < 1 && Math.abs(queue - body) < 1)
      }, width)
      const sizes = await panelWidths()
      assert.ok(sizes.document <= width + 1, `no overflow at ${width}: ${JSON.stringify(sizes)}`)
      assert.deepEqual(await preferences(), { settings: 520, queue: 480 }, 'viewport clamps must not replace saved preferences')
      if (width > 800) {
        assert.ok(sizes.settings >= 220 && sizes.queue >= 180 && sizes.preview >= 319.5, `desktop minima: ${JSON.stringify(sizes)}`)
        assert.ok(await divider('settings').isVisible()); assert.ok(await divider('queue').isVisible())
      } else if (width > 560) {
        assert.ok(sizes.preview >= 279.5, `medium preview minimum: ${JSON.stringify(sizes)}`)
        assert.ok(await divider('settings').isVisible()); assert.equal(await divider('queue').isVisible(), false)
        assert.ok(Math.abs(sizes.queue - sizes.body) < 1, 'queue spans the content width after any native scrollbar')
      } else {
        assert.equal(await divider('settings').isVisible(), false); assert.equal(await divider('queue').isVisible(), false)
        assert.ok(Math.abs(sizes.settings - sizes.body) < 1 && Math.abs(sizes.queue - sizes.body) < 1,
          'stacked panels span the content width after any native scrollbar')
      }
      if (width === 900 || width === 780) {
        const labels = await page.locator('[data-export-overview-tick]').evaluateAll(elements => elements.map(element => {
          const rect = element.getBoundingClientRect()
          return { left: rect.left, right: rect.right, width: rect.width, height: rect.height, text: element.textContent }
        }).filter(rect => rect.width > 0 && rect.height > 0).sort((a, b) => a.left - b.left))
        assert.ok(labels.length >= 2, 'narrow ruler retains both boundary labels')
        for (let index = 1; index < labels.length; index++) {
          assert.ok(labels[index].left >= labels[index - 1].right - 0.5,
            `visible ruler labels must not overlap at ${width}: ${JSON.stringify(labels)}`)
        }
        await page.screenshot({ path: path.join(output, `export-resized-${width}${native ? '-native' : ''}.png`) })
      }
    }
    await resize(1440); await waitPanelWidth('settings', 520); await waitPanelWidth('queue', 480)
    await divider('settings').press('Enter'); await divider('queue').press('Enter')
    await waitPanelWidth('settings', 272); await waitPanelWidth('queue', 230)
    await waitPreferences({ settings: null, queue: null })
    await assertResizeSafe()
    pass('narrow layouts clamp visible widths without overwriting preferences and restore desired widths when widened')

    await dragDivider('settings', 60); await dragDivider('queue', -30)
    await waitPreferences({ settings: 332, queue: 260 })
    const resizeStyles = await globalStyles()
    for (const reason of ['Escape', 'blur', 'pointercancel', 'hidden', 'unmounted', 'container-resize']) {
      await page.evaluate(reason => { window.exportResizeCase = reason }, reason)
      await beginDividerDrag('settings', 45)
      await waitPanelWidth('settings', 377)
      if (reason === 'Escape') await page.keyboard.press('Escape')
      else if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')))
      else if (reason === 'pointercancel') await divider('settings').evaluate(element => element.dispatchEvent(
        new PointerEvent('pointercancel', { bubbles: true, pointerId: window.exportResizePointerId, pointerType: 'mouse' })))
      else if (reason === 'hidden') await page.evaluate(() => window.exportWorkspaceTest.setActive(false))
      else if (reason === 'unmounted') await page.evaluate(() => window.exportWorkspaceTest.setMounted(false))
      else await resize(1024)
      await page.mouse.up()
      assert.deepEqual(await globalStyles(), resizeStyles, `${reason} releases global cursor/selection styles`)
      if (reason === 'hidden') await page.evaluate(() => window.exportWorkspaceTest.setActive(true))
      if (reason === 'unmounted') await page.evaluate(() => window.exportWorkspaceTest.setMounted(true))
      if (reason === 'container-resize') await resize(1440)
      await waitPanelWidth('settings', 332); await waitPanelWidth('queue', 260)
      assert.deepEqual(await preferences(), { settings: 332, queue: 260 }, `${reason} restores the original preference`)
    }
    await divider('settings').click({ button: 'right' })
    await waitPanelWidth('settings', 332)
    assert.deepEqual(await preferences(), { settings: 332, queue: 260 })
    await page.keyboard.press('Escape')
    await divider('settings').press('Enter'); await divider('queue').press('Enter')
    await waitPanelWidth('settings', 272); await waitPanelWidth('queue', 230)
    await assertResizeSafe()
    pass('Escape/blur/pointer-cancel/tab exit/unmount/container resize abandon drags and restore styles without authoring or export calls')

    const beforeReview = await snapshot()
    await page.getByTestId('export-review-play').click()
    await page.waitForFunction(() => window.exportWorkspaceTest.snapshot().isPlaying)
    await page.waitForTimeout(120)
    await page.getByRole('button', { name: 'Other workspace', exact: true }).click()
    await page.waitForFunction(() => !window.exportWorkspaceTest.snapshot().isPlaying)
    assert.equal(await page.getByTestId('export-review-preview').count(), 0)
    assert.equal((await snapshot()).listenerCounts.progress, 1)
    await page.getByRole('button', { name: 'Export workspace', exact: true }).click()
    await page.getByTestId('export-review-preview').waitFor()
    const afterReview = await snapshot()
    assert.equal(afterReview.timeline, beforeReview.timeline)
    assert.equal(afterReview.history, beforeReview.history)
    assert.deepEqual(afterReview.selectedClipIds, beforeReview.selectedClipIds)
    assert.deepEqual([afterReview.inPoint, afterReview.outPoint], [beforeReview.inPoint, beforeReview.outPoint])
    assert.equal(afterReview.dirty, false)
    pass('review transport stops on tab exit, renderer unmounts and authored timeline/selection/marks stay unchanged')

    const beforeRangeReview = await snapshot()
    const overviewSlider = page.getByRole('slider', { name: 'Scrub export preview' })
    await overviewSlider.focus()
    await overviewSlider.press('Home')
    await page.waitForFunction(() => window.exportWorkspaceTest.snapshot().playheadPosition === 0
      && JSON.stringify(window.exportWorkspaceTest.previewPixel()) === '[48,69,94,255]')
    await page.evaluate(() => { window.exportWorkspaceTest.controls.imageLoadDelayMs = 200 })
    await overviewSlider.press('End')
    await page.waitForFunction(() => Math.abs(window.exportWorkspaceTest.snapshot().playheadPosition - 191 / 24) < 1e-6
      && JSON.stringify(window.exportWorkspaceTest.previewPixel()) === '[110,81,65,255]')
    assert.ok((await snapshot()).calls.some(call => call.method === 'delayedImageLoad' && call.delay === 200),
      'the second image must have exercised deliberately delayed cold readiness')
    await page.evaluate(() => { window.exportWorkspaceTest.controls.imageLoadDelayMs = 0 })
    await overviewSlider.press('ArrowLeft')
    await page.waitForFunction(() => Math.abs(window.exportWorkspaceTest.snapshot().playheadPosition - 190 / 24) < 1e-6)
    await select('range', 'inout')
    await page.evaluate(() => window.exportWorkspaceTest.timeline.getState().setPlayheadPosition(6 - 3 / 24, { snap: true }))
    await page.getByTestId('export-review-play').click()
    await page.waitForFunction(() => {
      const state = window.exportWorkspaceTest.snapshot()
      return !state.isPlaying && Math.abs(state.playheadPosition - 143 / 24) < 1e-6
        && JSON.stringify(window.exportWorkspaceTest.previewPixel()) === '[110,81,65,255]'
    })
    await page.waitForTimeout(100)
    const afterRangeReview = await snapshot()
    assert.equal(Math.round(afterRangeReview.playheadPosition * 24), 143, 'review stops at last frame before exclusive Out boundary')
    assert.ok(Math.abs(afterRangeReview.playheadPosition - 143 / 24) < 1e-8, 'review remains frame-aligned')
    assert.equal(afterRangeReview.isPlaying, false)
    assert.equal(afterRangeReview.timeline, beforeRangeReview.timeline)
    assert.equal(afterRangeReview.history, beforeRangeReview.history)
    assert.deepEqual(afterRangeReview.selectedClipIds, beforeRangeReview.selectedClipIds)
    assert.deepEqual([afterRangeReview.inPoint, afterRangeReview.outPoint], [6, 2])
    assert.equal(afterRangeReview.dirty, false)
    pass('overview keyboard seeks redraw deliberately delayed cold image; bounded review stops on the last included frame without edits')

    await page.evaluate(() => window.exportWorkspaceTest.timeline.setState({ inPoint: null, outPoint: null }))
    await page.waitForFunction(() => document.querySelector('[data-testid="export-range-full"]')?.getAttribute('aria-pressed') === 'true')
    assert.equal((await settings()).range, 'inout', 'missing marks do not rewrite the saved preference')
    assert.match(await page.locator('.export-workspace__scope').innerText(), /00:00:08:00/)
    assert.match(await page.locator('[data-testid="export-workspace"] footer').innerText(), /Full Timeline/)
    await page.getByText('In/Out marks are missing; the full timeline will be exported.', { exact: true }).waitFor()
    assert.ok(await action('start').isEnabled())
    await page.evaluate(() => window.exportWorkspaceTest.timeline.setState({ inPoint: 3, outPoint: 3 }))
    await page.waitForFunction(() => document.querySelector('[data-testid="export-range-inout"]')?.getAttribute('aria-pressed') === 'true')
    assert.match(await page.locator('.export-workspace__scope').innerText(), /00:00:00:00/)
    assert.ok(await action('start').isDisabled()); assert.ok(await action('add-queue').isDisabled())
    await page.getByText('In and Out are at the same position. Set distinct marks in the editor or choose Full Timeline.', { exact: true }).waitFor()
    await page.evaluate(() => window.exportWorkspaceTest.timeline.setState({ inPoint: 6, outPoint: 2 }))
    await page.waitForFunction(() => !document.querySelector('[data-testid="export-start"]').disabled)
    assert.equal((await settings()).range, 'inout')
    assert.equal((await snapshot()).jobs.length, 0)
    assert.equal((await snapshot()).dirty, false)
    pass('missing marks truthfully fall back to full timeline; coincident marks keep zero-length In/Out and disable export')

    // Presets are settings-only and preserve the requested filename/range.
    await control('filename').fill('Chosen delivery')
    await waitSetting('filename', 'Chosen delivery')
    await select('range', 'inout')
    await showControl('preset-choice')
    await control('preset-choice').selectOption('small-h265')
    await waitSetting('videoCodec', 'h265')
    assert.equal((await settings()).filename, 'Chosen delivery')
    assert.equal((await settings()).range, 'inout')
    assert.equal((await settings()).crf, 22)
    await control('preset-choice').selectOption('proxy-review')
    await waitSetting('resolution', 'timeline-half')
    assert.equal((await settings()).useProxyMedia, true)
    await control('preset-choice').selectOption('balanced-mp4')
    await waitSetting('videoCodec', 'h264')
    assert.equal((await settings()).filename, 'Chosen delivery')
    pass('presets preserve filename/range and apply codec, quality, resolution and proxy choices')

    const cardIds = ['youtube-1080p', 'youtube-4k', 'h264-master', 'prores-master', 'review-copy']
    const presetCard = id => action(`preset-${id}`)
    const activeCards = () => page.locator('[data-testid^="export-preset-"][aria-pressed="true"]')
    const seedTimelineFormat = dimensions => page.evaluate(dimensions => {
      const test = window.exportWorkspaceTest
      test.project.setState(state => ({ currentProject: { ...state.currentProject,
        settings: { ...state.currentProject.settings, ...dimensions },
        timelines: state.currentProject.timelines.map(timeline => timeline.id === state.currentTimelineId
          ? { ...timeline, ...dimensions } : timeline),
      } }))
      test.timeline.setState({ timelineFps: dimensions.fps })
    }, dimensions)
    await reset({ settings: { filename: 'Card delivery', range: 'inout' } })
    await seedTimelineFormat({ width: 1440, height: 2560, fps: 60 })
    const beforeCards = await snapshot()
    const cardProject = await page.evaluate(() => JSON.stringify(window.exportWorkspaceTest.project.getState().currentProject))
    const cardCases = [
      { id: 'youtube-1080p', resolution: 'youtube-hd', dimensions: [1080, 1920], qualityMode: 'bitrate', bitrateKbps: 12000 },
      { id: 'youtube-4k', resolution: 'youtube-uhd', dimensions: [1440, 2560], qualityMode: 'bitrate', bitrateKbps: 24000 },
      { id: 'h264-master', resolution: 'project', dimensions: [1440, 2560], qualityMode: 'crf', crf: 16 },
      { id: 'prores-master', resolution: 'project', dimensions: [1440, 2560], format: 'prores', videoCodec: 'prores', proresProfile: '3' },
      { id: 'review-copy', resolution: 'timeline-half', dimensions: [720, 1280], qualityMode: 'crf', crf: 24,
        preset: 'veryfast', useProxyMedia: true, audioBitrateKbps: 160 },
    ]
    for (const [index, spec] of cardCases.entries()) {
      await presetCard(spec.id).click()
      await page.waitForFunction(id => document.querySelector(`[data-testid="export-preset-${id}"]`)?.getAttribute('aria-pressed') === 'true', spec.id)
      assert.equal(await activeCards().count(), 1)
      const selected = await settings()
      const expected = { filename: 'Card delivery', range: 'inout', format: 'mp4', videoCodec: 'h264',
        audioCodec: 'aac', audioBitrateKbps: 320, audioSampleRate: 48000, audioChannels: 2, includeAudio: true,
        normalizeAudio: false, useHardwareEncoder: false, keyframeMode: 'auto', fps: 'project',
        postProcessUpscale: 'none', transparent: false, useProxyMedia: false, useDirectFramePipe: true,
        ...Object.fromEntries(Object.entries(spec).filter(([key]) => !['id', 'dimensions'].includes(key))),
      }
      for (const [key, value] of Object.entries(expected)) assert.equal(selected[key], value, `${spec.id} ${key}`)
      await action('add-queue').click()
      await action('queue-start').click()
      const job = await waitJob(index + 1)
      assert.deepEqual([job.options.width, job.options.height, job.options.fps], [...spec.dimensions, 60], `${spec.id} portrait source-frame-rate payload`)
      assert.deepEqual([job.options.rangeStart, job.options.rangeEnd], [2, 6])
      assert.deepEqual([job.options.sourceTimelineWidth, job.options.sourceTimelineHeight], [1440, 2560])
      for (const key of ['format', 'videoCodec', 'audioCodec', 'audioBitrateKbps', 'audioSampleRate', 'audioChannels',
        'normalizeAudio', 'useHardwareEncoder', 'postProcessUpscale', 'transparent', 'useProxyMedia', 'useDirectFramePipe']) {
        assert.equal(job.options[key], expected[key], `${spec.id} queued payload ${key}`)
      }
      if (spec.qualityMode) assert.equal(job.options.qualityMode, spec.qualityMode)
      if (spec.bitrateKbps) assert.equal(job.options.bitrateKbps, spec.bitrateKbps)
      if (spec.crf) assert.equal(job.options.crf, spec.crf)
      await page.getByTestId('export-queue-item').first().getByText('Rendering', { exact: true }).waitFor()
      await page.evaluate(() => window.exportWorkspaceTest.complete())
      await page.getByTestId('export-queue-item').first().getByText('Completed', { exact: true }).waitFor()
    }
    const afterCards = await snapshot()
    assert.equal(afterCards.timeline, beforeCards.timeline); assert.equal(afterCards.history, beforeCards.history)
    assert.deepEqual(afterCards.selectedClipIds, beforeCards.selectedClipIds)
    assert.deepEqual([afterCards.inPoint, afterCards.outPoint], [6, 2]); assert.equal(afterCards.dirty, false)
    assert.equal(await page.evaluate(() => JSON.stringify(window.exportWorkspaceTest.project.getState().currentProject)), cardProject)
    pass('all five recommended cards preserve filename/range, source FPS/orientation and queue their specified quality/audio payloads')

    await reset()
    await seedTimelineFormat({ width: 4096, height: 2304, fps: 24 })
    for (const [index, id] of ['youtube-1080p', 'youtube-4k'].entries()) {
      await presetCard(id).click()
      const dimensions = index === 0 ? [1920, 1080] : [3840, 2160]
      assert.match(await control('resolution').locator('option:checked').innerText(), new RegExp(`${dimensions[0]}.*${dimensions[1]}`))
      await action('start').click()
      const job = await waitJob(index + 1)
      assert.deepEqual([job.options.width, job.options.height, job.options.fps], [...dimensions, 24])
      assert.equal(job.options.bitrateKbps, index === 0 ? 8000 : 45000)
      await complete()
    }
    await reset()
    for (const [index, id] of ['youtube-1080p', 'youtube-4k'].entries()) {
      await presetCard(id).click()
      await action('start').click()
      const job = await waitJob(index + 1)
      assert.deepEqual([job.options.width, job.options.height, job.options.fps], [640, 360, 24], `${id} never upscales a small source`)
      assert.equal(job.options.bitrateKbps, 1000)
      await complete()
    }
    pass('YouTube HD/UHD caps downscale larger timelines, never upscale small sources, and use actual-resolution/source-FPS bitrates')

    await reset()
    await presetCard('h264-master').click()
    await control('filename').fill('Keep my filename'); await select('range', 'inout')
    assert.equal(await presetCard('h264-master').getAttribute('aria-pressed'), 'true', 'filename/range edits do not clear matching card')
    await control('crf').fill('17'); await waitSetting('crf', 17)
    assert.equal(await activeCards().count(), 0, 'custom quality edit clears recommendation highlight')
    await presetCard('h264-master').click()
    assert.equal((await settings()).filename, 'Keep my filename'); assert.equal((await settings()).range, 'inout')
    await showControl('preset-choice')
    const presetOptions = await control('preset-choice').locator('option').evaluateAll(options => options.map(option => option.value))
    for (const id of [...cardIds, 'balanced-mp4', 'fast-nvenc', 'proxy-review', 'small-h265', 'prores-hq']) {
      assert.ok(presetOptions.includes(id), `${id} remains available in More presets`)
    }
    await divider('settings').press('Home'); await waitPanelWidth('settings', 220)
    await action('settings').evaluate(element => { element.scrollTop = 0 })
    const tileRects = []
    for (const id of cardIds) {
      const rect = await presetCard(id).boundingBox()
      const panel = await action('settings').boundingBox()
      assert.ok(rect && rect.width > 140 && rect.x >= panel.x && rect.x + rect.width <= panel.x + panel.width + 1,
        `${id} fits minimum sidebar width`)
      assert.ok(await presetCard(id).evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${id} text does not overflow`)
      tileRects.push(rect)
    }
    for (let index = 1; index < tileRects.length; index++) {
      assert.ok(Math.abs(tileRects[index].x - tileRects[0].x) < 1 && tileRects[index].y >= tileRects[index - 1].y + tileRects[index - 1].height,
        '220px settings sidebar uses a readable single-column card stack')
    }
    await page.screenshot({ path: path.join(output, `export-presets-narrow${native ? '-native' : ''}.png`) })
    await divider('settings').press('Enter'); await waitPanelWidth('settings', 272)
    await reset()
    pass('card selection tracks custom settings, all legacy presets remain accessible, and tiles fit a 220px single-column sidebar')

    await openSection('Advanced encoding')
    await select('videoCodec', 'h265')
    await select('qualityMode', 'bitrate')
    await control('bitrateKbps').fill('4567'); await waitSetting('bitrateKbps', 4567)
    const beforeGif = await settings()
    await select('format', 'gif')
    assert.equal(await control('videoCodec').count(), 0)
    assert.equal(await control('audioCodec').count(), 0)
    await select('format', 'mp4')
    for (const key of ['videoCodec', 'qualityMode', 'bitrateKbps', 'includeAudio', 'useDirectFramePipe']) {
      assert.equal((await settings())[key], beforeGif[key], `GIF round trip preserves ${key}`)
    }
    await select('format', 'webm')
    assert.equal((await settings()).videoCodec, 'vp9'); assert.equal((await settings()).audioCodec, 'opus')
    assert.equal((await settings()).useHardwareEncoder, false)
    await select('format', 'prores')
    await control('transparent').check()
    await waitSetting('transparent', true)
    assert.equal((await settings()).proresProfile, '4')
    await select('proresProfile', '3'); assert.equal((await settings()).transparent, false)
    await select('format', 'audio')
    assert.equal((await settings()).includeAudio, true)
    assert.equal(await control('videoCodec').count(), 0)
    await openSection('Audio settings')
    await select('audioCodec', 'mp3')
    pass('format-specific controls preserve hidden GIF settings and enforce codec/audio/alpha dependencies')

    await reset({ settings: { filename: 'Single review', resolution: 'timeline-half', range: 'inout' } })
    const beforeExport = await snapshot()
    await action('start').click()
    const first = await waitJob(1)
    assert.deepEqual([first.options.width, first.options.height, first.options.fps], [320, 180, 24])
    assert.deepEqual([first.options.rangeStart, first.options.rangeEnd], [2, 6], 'reversed In/Out is normalized')
    assert.equal(first.options.useCachedRenders, false); assert.equal(first.options.fastSeek, false)
    assert.equal(first.projectPath, beforeExport.jobs[0]?.projectPath || '/__export_workspace_memory__')
    assert.equal(await page.getByTestId('export-review-preview').count(), 0, 'busy export suspends review renderer')
    await page.evaluate(() => window.exportWorkspaceTest.progress(37))
    await page.getByText('Synthetic render 37%', { exact: true }).first().waitFor()
    await page.getByRole('button', { name: 'Other workspace', exact: true }).click()
    await page.evaluate(() => window.exportWorkspaceTest.progress(62))
    assert.equal((await snapshot()).listenerCounts.progress, 1, 'hidden panel retains worker subscriptions')
    await page.getByRole('button', { name: 'Export workspace', exact: true }).click()
    await page.getByText('Synthetic render 62%', { exact: true }).first().waitFor()
    await complete()
    await page.getByTestId('export-review-preview').waitFor()
    const afterExport = await snapshot()
    assert.equal(afterExport.timeline, beforeExport.timeline)
    assert.equal(afterExport.history, beforeExport.history)
    assert.deepEqual(afterExport.selectedClipIds, beforeExport.selectedClipIds)
    assert.equal(afterExport.dirty, false)
    pass('simulated worker gets dimensions/range; hidden progress stays mounted and review suspends without document edits')

    await reset()
    await control('filename').fill('Queue A'); await waitSetting('filename', 'Queue A')
    await select('range', 'inout')
    await action('add-queue').click()
    await control('filename').fill('Queue B'); await waitSetting('filename', 'Queue B')
    await select('format', 'gif'); await select('range', 'full')
    await action('add-queue').click()
    await page.getByRole('button', { name: /^Remove from queue:/ }).first().click()
    assert.equal(await page.getByRole('button', { name: /^Remove from queue:/ }).count(), 1)
    await action('add-queue').click()
    await action('queue-start').click()
    const queueB = await waitJob(1)
    assert.equal(queueB.options.filename, 'Queue B'); assert.equal(queueB.options.format, 'gif')
    assert.ok(await action('start').isDisabled(), 'single export cannot overlap the running queue')
    assert.ok(await page.getByTestId('export-queue-item').first().getByRole('button', { name: /^Remove from queue:/ }).isDisabled(),
      'rendering queue item cannot be removed')
    await page.screenshot({ path: path.join(output, `export-queue-running${native ? '-native' : ''}.png`) })
    await action('queue-pause').click()
    await page.evaluate(() => window.exportWorkspaceTest.complete('unrelated-job'))
    assert.equal((await snapshot()).activeJobId, queueB.jobId, 'external completion cannot own UI worker')
    assert.equal((await snapshot()).jobs.length, 1)
    await page.evaluate(() => window.exportWorkspaceTest.complete())
    await action('queue-resume').waitFor()
    await page.waitForFunction(() => !document.querySelector('[data-testid="export-queue-resume"]').disabled)
    assert.equal((await snapshot()).jobs.length, 1, 'pause waits until current finishes before starting another')
    await action('queue-resume').click()
    const queueA = await waitJob(2)
    assert.equal(queueA.options.filename, 'Queue A'); assert.equal(queueA.options.format, 'mp4')
    assert.deepEqual([queueA.options.rangeStart, queueA.options.rangeEnd], [2, 6])
    await page.evaluate(() => window.exportWorkspaceTest.complete())
    await action('queue-start').waitFor()
    assert.ok(await action('queue-start').isDisabled(), 'completed queue has nothing left to start')
    assert.equal(await page.getByTestId('export-queue-item').getByText('Completed', { exact: true }).count(), 2)
    pass('queue Add/Remove snapshots, newest-first order, external-job isolation and pause-after-current/resume are preserved')

    // Exercise every destination kind through the UI, without starting a real worker.
    for (const [format, codec, extension] of [['mp4', null, 'mp4'], ['webm', null, 'webm'], ['prores', null, 'mov'],
      ['audio', 'wav', 'wav'], ['audio', 'mp3', 'mp3'], ['audio', 'aac', 'm4a'], ['gif', null, 'gif'], ['png-seq', null, null]]) {
      await reset({ settings: { filename: 'Format check', range: 'full',
        resolution: 'custom', customWidth: 321, customHeight: 181 } })
      await select('format', format)
      if (codec) await select('audioCodec', codec)
      await action('start').click()
      const job = await waitJob(1), state = await snapshot()
      assert.equal(job.options.format, format)
      assert.deepEqual([job.options.rangeStart, job.options.rangeEnd], [0, 8])
      const visualOnly = format === 'gif' || format === 'png-seq'
      assert.deepEqual([job.options.width, job.options.height], visualOnly ? [321, 181] : [322, 182])
      if (visualOnly) {
        assert.equal(job.options.includeAudio, false); assert.equal(job.options.videoCodec, null)
        assert.equal(job.options.useHardwareEncoder, false); assert.equal(job.options.useDirectFramePipe, false)
      }
      if (format === 'png-seq') {
        assert.equal(state.calls.filter(call => call.method === 'selectDirectory').length, 1)
        assert.equal(state.calls.filter(call => call.method === 'saveFileDialog').length, 0)
        assert.match(job.outputPath, /\/Format check_png$/)
      } else {
        const dialog = state.calls.find(call => call.method === 'saveFileDialog')
        assert.deepEqual(dialog.options.filters[0].extensions, [extension])
        assert.ok(job.outputPath.endsWith(`.${extension}`))
      }
      await complete()
    }
    pass('MP4/WebM/ProRes/WAV/MP3/M4A/GIF/PNG destination calls and format-specific worker payloads stay intact')

    await reset()
    await openSection('Send to another editor')
    await page.getByRole('combobox', { name: 'XML export format' }).selectOption('fcpxml')
    await page.getByRole('button', { name: 'Export FCPXML', exact: true }).click()
    await page.waitForFunction(() => window.exportWorkspaceTest.writes.length === 1)
    assert.match((await snapshot()).writes[0].contents, /<fcpxml/)
    await page.getByRole('combobox', { name: 'XML export format' }).selectOption('premiere')
    await page.getByRole('button', { name: 'Export Premiere XML', exact: true }).click()
    await page.waitForFunction(() => window.exportWorkspaceTest.writes.length === 2)
    assert.match((await snapshot()).writes[1].contents, /<xmeml/)
    assert.equal((await snapshot()).jobs.length, 0)
    pass('FCPXML and Premiere XML retain separate dialogs/builders with memory-only output and no render worker')

    await reset({ settings: { filename: 'RTX summary', format: 'mp4', resolution: 'project', postProcessUpscale: 'rtx-4k' } })
    assert.match(await page.locator('[data-testid="export-workspace"] footer').innerText(), /RTX summary_rtx4k\.mp4/)
    assert.match(await page.locator('[data-testid="export-workspace"] footer').innerText(), /3840 × 2160/)
    await action('add-queue').click()
    assert.match(await page.getByTestId('export-queue-item').innerText(), /RTX summary_rtx4k\.mp4/)
    assert.match(await page.getByTestId('export-queue-item').innerText(), /3840 × 2160/)
    assert.equal((await snapshot()).jobs.length, 0)
    assert.equal((await snapshot()).calls.some(call => ['saveFileDialog', 'createDirectory', 'runExportInWorker'].includes(call.method)), false)
    pass('seeded RTX output summary and queue show final 4K dimensions/filename without invoking RTX or export')

    await reset()
    await page.evaluate(() => { window.exportWorkspaceTest.controls.nextDialog = null })
    await action('start').click()
    await page.waitForFunction(() => !document.querySelector('[data-testid="export-start"]').disabled)
    assert.equal((await snapshot()).jobs.length, 0)
    await action('start').click(); await waitJob(1)
    await page.evaluate(() => window.exportWorkspaceTest.progress(20))
    await action('stop').click()
    await page.getByText('Export stopped', { exact: true }).first().waitFor()
    assert.equal((await snapshot()).calls.filter(call => call.method === 'cancelExport').length, 1)
    await action('start').click(); await waitJob(2)
    await page.evaluate(() => window.exportWorkspaceTest.fail('Synthetic worker decode failure'))
    await page.getByText('Synthetic worker decode failure', { exact: true }).first().waitFor()
    pass('dialog cancellation, Stop and worker errors remain distinct visible outcomes')

    for (const kind of ['empty', 'audio']) {
      await reset({ kind, settings: kind === 'audio' ? { format: 'audio', audioCodec: 'wav' } : null })
      await resize(900)
      assert.ok(await action('start').isVisible())
      assert.equal(await action('start').isDisabled(), kind === 'empty')
      assert.ok(await page.getByTestId('export-queue').isVisible())
      assert.equal((await snapshot()).jobs.length, 0)
      assert.equal((await snapshot()).dirty, false)
      await page.screenshot({ path: path.join(output, `export-${kind}${native ? '-native' : ''}.png`) })
    }
    pass('empty and audio-only timelines retain usable export controls without starting jobs or dirtying projects')

    await reset()
    await resize(1440)
    const beforeKeys = await snapshot()
    const transportState = () => page.evaluate(() => {
      const state = window.exportWorkspaceTest.timeline.getState()
      return { playing: state.isPlaying, rate: state.playbackRate, time: state.playheadPosition, playAround: state.playAround }
    })
    const focusWorkspace = () => page.evaluate(() => document.activeElement?.blur())
    const pauseAt = async (time = 4) => {
      await page.evaluate(time => {
        const state = window.exportWorkspaceTest.timeline.getState()
        state.shuttlePause(); state.setPlayheadPosition(time, { snap: true, intent: 'frame-step' })
        document.activeElement?.blur()
      }, time)
    }
    const waitPlaying = playing => page.waitForFunction(playing => window.exportWorkspaceTest.timeline.getState().isPlaying === playing, playing)
    const assertKeysReadOnly = async () => {
      const after = await snapshot()
      assert.equal(after.timeline, beforeKeys.timeline); assert.equal(after.history, beforeKeys.history)
      assert.deepEqual(after.selectedClipIds, beforeKeys.selectedClipIds)
      assert.deepEqual([after.inPoint, after.outPoint], [beforeKeys.inPoint, beforeKeys.outPoint])
      assert.equal(after.dirty, false)
    }
    await pauseAt()
    await page.evaluate(() => {
      const test = window.exportWorkspaceTest
      test.keyPlayingEdges = []
      test.stopKeyObservation = test.timeline.subscribe((state, previous) => {
        if (state.isPlaying !== previous.isPlaying) test.keyPlayingEdges.push(state.isPlaying)
      })
    })
    await page.keyboard.down('Space'); await page.keyboard.down('Space'); await page.keyboard.down('Space')
    assert.equal((await transportState()).playing, false, 'Space keydown/repeat must not toggle')
    await page.keyboard.up('Space'); await waitPlaying(true)
    await page.keyboard.press('Space'); await waitPlaying(false)
    assert.deepEqual(await page.evaluate(() => window.exportWorkspaceTest.keyPlayingEdges), [true, false], 'one toggle per Space release')
    await presetCard('h264-master').click()
    await presetCard('h264-master').evaluate(element => {
      window.exportKeyPresetClicks = 0; element.addEventListener('click', () => window.exportKeyPresetClicks++)
    })
    await page.keyboard.press('Space'); await waitPlaying(true)
    await page.keyboard.press('Space'); await waitPlaying(false)
    assert.equal(await page.evaluate(() => window.exportKeyPresetClicks), 0, 'Space on a preset must not also trigger native button activation')
    const reviewPlay = page.getByTestId('export-review-play')
    await reviewPlay.evaluate(element => {
      window.exportKeyPlayClicks = 0; element.addEventListener('click', () => window.exportKeyPlayClicks++)
    })
    await reviewPlay.click(); await waitPlaying(true)
    await page.keyboard.press('Space'); await waitPlaying(false)
    assert.equal(await page.evaluate(() => window.exportKeyPlayClicks), 1, 'focused Play button Space must not double-toggle')
    await action('start').focus()
    await page.keyboard.press('Space'); await waitPlaying(true)
    await page.keyboard.press('Space'); await waitPlaying(false)
    assert.equal((await snapshot()).jobs.length, 0, 'Space on Export now must not activate export')
    await focusWorkspace(); await page.keyboard.press('Enter'); await waitPlaying(true)
    await page.keyboard.press('Enter'); await waitPlaying(false)
    await presetCard('h264-master').focus(); await page.keyboard.press('Enter')
    assert.equal((await transportState()).playing, false, 'Enter on a preset keeps native activation without global playback')
    await page.getByRole('slider', { name: 'Scrub export preview' }).click()
    await page.keyboard.press('Space'); await waitPlaying(true)
    await page.keyboard.press('Space'); await waitPlaying(false)
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Scrub export preview')
    await page.evaluate(() => window.exportWorkspaceTest.stopKeyObservation())
    await assertKeysReadOnly()
    pass('Space toggles once on release after preset/Play/scrubber focus; Enter outside native controls toggles without double activation')

    for (const [key, sign] of [['l', 1], ['j', -1]]) {
      await pauseAt()
      for (const rate of [1, 2, 4, 8, 8]) {
        await page.keyboard.press(key)
        const state = await transportState()
        assert.equal(state.playing, true); assert.equal(state.rate, sign * rate)
      }
      await page.keyboard.press('k'); await waitPlaying(false)
      await pauseAt()
      for (const rate of [0.5, 0.25, 0.125, 0.125]) {
        await page.keyboard.press(`Shift+${key}`)
        assert.equal((await transportState()).rate, sign * rate)
      }
    }
    await pauseAt(); await page.keyboard.down('k')
    await page.keyboard.press('l'); assert.equal((await transportState()).rate, 0.5)
    await page.keyboard.press('l'); assert.equal((await transportState()).rate, 0.5)
    await page.keyboard.up('k'); await page.keyboard.press('l'); assert.equal((await transportState()).rate, 1)
    await pauseAt(); await page.keyboard.down('l'); await page.keyboard.down('l')
    assert.equal((await transportState()).rate, 1, 'OS repeat cannot advance the shuttle ladder')
    await page.keyboard.up('l'); await page.keyboard.press('k')
    await select('range', 'inout'); await pauseAt(3)
    await page.keyboard.press('ArrowRight'); assert.ok(Math.abs((await transportState()).time - 73 / 24) < 1e-8)
    await page.keyboard.press('ArrowLeft'); assert.equal((await transportState()).time, 3)
    await page.keyboard.press('Home'); assert.equal((await transportState()).time, 2)
    await page.keyboard.press('ArrowLeft'); assert.equal((await transportState()).time, 2)
    await page.keyboard.press('End'); assert.ok(Math.abs((await transportState()).time - 143 / 24) < 1e-8)
    await page.keyboard.press('ArrowRight'); assert.ok(Math.abs((await transportState()).time - 143 / 24) < 1e-8)
    await page.evaluate(() => window.exportWorkspaceTest.timeline.setState({ inPoint: 1 / 24, outPoint: 9 / 24 }))
    await page.waitForFunction(() => document.querySelector('[data-testid="export-review-preview"]')?.textContent.includes('00:00:00:09'))
    await page.keyboard.press('End'); assert.ok(Math.abs((await transportState()).time - 8 / 24) < 1e-8)
    // Capture the synchronous play edge, not a later transport tick, so a
    // one-third-second range proves its exact rewind without timing luck.
    await page.evaluate(() => {
      const test = window.exportWorkspaceTest
      test.keyRangeStarts = []
      test.stopRangeObservation = test.timeline.subscribe((state, previous) => {
        if (state.isPlaying && !previous.isPlaying) test.keyRangeStarts.push(state.playheadPosition)
      })
    })
    await page.keyboard.press('Space')
    const rangeStarts = await page.evaluate(() => {
      window.exportWorkspaceTest.stopRangeObservation()
      return window.exportWorkspaceTest.keyRangeStarts
    })
    assert.equal(rangeStarts.length, 1)
    assert.ok(Math.abs(rangeStarts[0] - 1 / 24) < 1e-8, 'Space at a fractional-frame range endpoint must rewind to its first frame')
    await pauseAt(3)
    await page.evaluate(() => window.exportWorkspaceTest.timeline.setState({ inPoint: 6, outPoint: 2 }))
    await page.waitForFunction(() => document.querySelector('[data-testid="export-review-preview"]')?.textContent.includes('00:00:06:00'))
    await assertKeysReadOnly()
    pass('JKL fast/slow/K-held transport ladders, frame navigation and fractional-frame endpoint rewind obey the selected range without timeline edits')

    await pauseAt()
    await page.evaluate(() => {
      const host = document.createElement('div'); host.id = 'export-key-guard-probe'
      host.style.cssText = 'position:fixed;top:80px;left:10px;z-index:99999'
      host.innerHTML = '<div contenteditable="true" tabindex="0" data-key-probe="editable">Editable probe</div><input type="range" data-key-probe="range" min="0" max="10" value="5">'
      document.body.append(host)
    })
    for (const target of [control('filename'), control('crf'), control('format'), control('includeAudio'),
      page.locator('[data-key-probe="editable"]'), page.locator('[data-key-probe="range"]'),
      page.locator('summary').first(), divider('settings')]) {
      await target.focus()
      const before = await transportState()
      await page.keyboard.press('l')
      assert.deepEqual(await transportState(), before, 'focused native/editable controls must not shuttle')
    }
    await focusWorkspace()
    for (const extra of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { prevented: true }]) {
      await page.evaluate(extra => {
        const event = new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', bubbles: true, cancelable: true, ...extra })
        if (extra.prevented) event.preventDefault()
        window.dispatchEvent(event)
      }, extra)
      assert.equal((await transportState()).playing, false)
    }
    await page.evaluate(() => {
      const dialog = document.createElement('div'); dialog.id = 'export-key-modal'; dialog.setAttribute('role', 'dialog')
      dialog.style.cssText = 'position:fixed;inset:20px;z-index:99999'
      dialog.setAttribute('aria-modal', 'true'); dialog.textContent = 'Synthetic modal'; document.body.append(dialog)
    })
    for (const key of ['Space', 'Enter', 'j', 'l', 'ArrowLeft', 'Home', 'End']) await page.keyboard.press(key)
    assert.deepEqual(await transportState(), { playing: false, rate: 1, time: 4, playAround: null })
    await page.evaluate(() => document.getElementById('export-key-modal').remove())
    for (const key of ['i', 'o', 'Alt+x', 'Delete', 'Backspace', 'Control+z', 'Shift+k']) await page.keyboard.press(key)
    assert.equal((await transportState()).playAround, null)
    await page.evaluate(() => document.getElementById('export-key-guard-probe').remove())
    await assertKeysReadOnly()
    assert.equal((await snapshot()).jobs.length, 0)
    pass('native/editable focus, modal, handled/composing/modified events and Editor-only editing/I/O keys cannot drive Export transport or edits')

    for (const reason of ['mouse', 'focus', 'modal', 'blur', 'visibility', 'hidden', 'unmounted', 'busy']) {
      await pauseAt()
      await page.keyboard.down('Space')
      if (reason === 'mouse') await page.getByText('Velorn · isolated export verification', { exact: true }).click()
      else if (reason === 'focus') { await control('filename').focus(); await focusWorkspace() }
      else if (reason === 'modal') await page.evaluate(() => {
        const dialog = document.createElement('div'); dialog.id = 'export-key-modal'; dialog.setAttribute('role', 'dialog')
        dialog.style.cssText = 'position:fixed;inset:20px;z-index:99999'
        dialog.setAttribute('aria-modal', 'true'); dialog.textContent = 'Synthetic modal'; document.body.append(dialog)
      })
      else if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')))
      else if (reason === 'visibility') await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      else if (reason === 'hidden') await page.evaluate(() => window.exportWorkspaceTest.setActive(false))
      else if (reason === 'unmounted') await page.evaluate(() => window.exportWorkspaceTest.setMounted(false))
      else {
        await page.evaluate(() => document.querySelector('[data-testid="export-start"]').click())
        await waitJob(1)
        await page.keyboard.press('l'); assert.equal((await transportState()).playing, false)
        await complete(); await page.getByTestId('export-review-preview').waitFor()
      }
      await page.keyboard.up('Space')
      if (reason === 'modal') await page.evaluate(() => document.getElementById('export-key-modal').remove())
      if (reason === 'visibility') await page.evaluate(() => {
        delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange'))
      })
      if (reason === 'hidden') await page.evaluate(() => window.exportWorkspaceTest.setActive(true))
      if (reason === 'unmounted') await page.evaluate(() => window.exportWorkspaceTest.setMounted(true))
      assert.equal((await transportState()).playing, false, `${reason} must cancel pending Space even across a fresh preview mount`)
    }
    await assertKeysReadOnly()
    await page.evaluate(() => window.exportWorkspaceTest.setActive(false)); await focusWorkspace()
    for (const key of ['Space', 'Enter', 'l']) await page.keyboard.press(key)
    assert.equal((await transportState()).playing, false)
    await page.evaluate(() => window.exportWorkspaceTest.setActive(true))
    await reset({ kind: 'empty' }); await focusWorkspace()
    const emptyTransport = await transportState()
    for (const key of ['Space', 'Enter', 'j', 'l', 'ArrowRight', 'Home', 'End']) await page.keyboard.press(key)
    assert.deepEqual(await transportState(), emptyTransport)
    assert.equal((await snapshot()).jobs.length, 0)
    pass('mouse/focus/modal/blur/visibility/tab/unmount/busy transitions cancel pending Space; hidden, busy and empty Export cannot start transport')

    // Simulate a still-open renderer whose language dictionary predates the
    // new export workspace. Only this test page's fetched responses change;
    // language files, the real app and its existing in-memory state do not.
    const strippedDictionaries = new Set()
    await page.route(url => /\/lang\/lang_(?:en|jp)\.json$/.test(url.pathname), async route => {
      const response = await route.fetch()
      const dictionary = await response.json()
      delete dictionary.export.workspace
      delete dictionary.export.deliveryPresets
      strippedDictionaries.add(new URL(route.request().url()).pathname.split('/').at(-1))
      await route.fulfill({ response, json: dictionary })
    })
    const assertReadableWorkspace = async () => {
      const raw = await action('workspace').evaluate(root => {
        const failures = []
        const pattern = /export\.(?:workspace|deliveryPresets)\.[\w.]+/g
        failures.push(...(root.textContent.match(pattern) || []).map(value => `text: ${value}`))
        for (const element of [root, ...root.querySelectorAll('*')]) {
          for (const attribute of element.attributes) {
            if (attribute.name === 'title' || attribute.name === 'placeholder' || attribute.name.startsWith('aria-')) {
              failures.push(...(attribute.value.match(pattern) || []).map(value => `${attribute.name}: ${value}`))
            }
          }
        }
        return failures
      })
      assert.deepEqual(raw, [], 'older dictionaries must not leak raw workspace/preset keys into text/options/accessibility labels')
    }
    for (const [locale, legacySettingsLabel] of [['en', 'Export Settings'], ['ja', '書き出し設定']]) {
      await resize(1440)
      await page.evaluate(locale => localStorage.setItem('velorn-language', locale), locale)
      await page.reload()
      await page.waitForFunction(({ locale, label }) => document.documentElement.lang === locale
        && document.querySelector('[data-testid="export-settings"]')?.getAttribute('aria-label') === label,
      { locale, label: legacySettingsLabel })
      assert.ok(strippedDictionaries.has('lang_en.json'))
      if (locale === 'ja') assert.ok(strippedDictionaries.has('lang_jp.json'))
      const beforeStaleDictionary = await snapshot()
      await assertReadableWorkspace()
      for (const [index, id] of cardIds.entries()) {
        const expectedName = [/YouTube.*1080/i, /YouTube.*4K/i, /H\.?264.*master/i, /ProRes.*master/i, /review.*copy/i][index]
        assert.match(await presetCard(id).getAttribute('aria-label'), expectedName, `${id} accessible fallback is readable`)
        await presetCard(id).click()
        await assertReadableWorkspace()
      }
      assert.equal((await action('start').innerText()).trim(), 'Export now')
      assert.equal(await divider('settings').getAttribute('aria-label'), 'Resize export settings')
      assert.equal(await divider('queue').getAttribute('aria-label'), 'Resize export queue')
      assert.match(await divider('settings').getAttribute('title'), /Drag to resize/)
      await showControl('preset-choice')
      assert.equal((await control('preset-choice').locator('option[value=""]').innerText()).trim(), 'Custom settings')
      for (const summary of ['Audio settings', 'Advanced encoding', 'Encoding & performance', 'Send to another editor', 'More presets']) {
        assert.ok(await page.locator('summary').filter({ hasText: summary }).count(), `${summary} has readable fallback text`)
      }
      await select('resolution', 'custom')
      assert.equal((await page.locator('label[for="export-customWidth"]').innerText()).trim(), 'Width')
      assert.equal((await page.locator('label[for="export-customHeight"]').innerText()).trim(), 'Height')
      await select('range', 'inout')
      await page.evaluate(() => window.exportWorkspaceTest.timeline.setState({ inPoint: null, outPoint: null }))
      await page.getByText('In/Out marks are missing; the full timeline will be exported.', { exact: true }).waitFor()
      await assertReadableWorkspace()
      await page.evaluate(() => window.exportWorkspaceTest.timeline.setState({ inPoint: 3, outPoint: 3 }))
      await page.getByText('In and Out are at the same position. Set distinct marks in the editor or choose Full Timeline.', { exact: true }).waitFor()
      await assertReadableWorkspace()
      await page.evaluate(() => window.exportWorkspaceTest.timeline.setState({ inPoint: 6, outPoint: 2 }))
      await select('range', 'full')
      const queueToggle = page.locator('button[aria-controls="export-render-queue"]')
      assert.equal(await queueToggle.getAttribute('title'), 'Hide queue')
      await queueToggle.click()
      assert.equal(await queueToggle.getAttribute('title'), 'Show queue')
      await assertReadableWorkspace()
      await queueToggle.click()

      for (const [index, status] of ['Completed', 'Failed', 'Stopped'].entries()) {
        await control('filename').fill(`Stale dictionary ${status}`)
        await action('add-queue').click()
        await page.getByTestId('export-queue-item').first().getByText('Queued', { exact: true }).waitFor()
        await assertReadableWorkspace()
        await action('queue-start').click(); await waitJob(index + 1)
        await page.getByTestId('export-queue-item').first().getByText('Rendering', { exact: true }).waitFor()
        assert.equal((await action('queue-pause').innerText()).trim(), 'Pause after current')
        await assertReadableWorkspace()
        if (status === 'Completed') await page.evaluate(() => window.exportWorkspaceTest.complete())
        else if (status === 'Failed') await page.evaluate(() => window.exportWorkspaceTest.fail('Synthetic stale-dictionary failure'))
        else await action('stop').click()
        await page.getByTestId('export-queue-item').first().getByText(status, { exact: true }).waitFor()
        await page.waitForFunction(() => !window.exportWorkspaceTest.snapshot().activeJobId)
        await assertReadableWorkspace()
      }
      const afterStaleDictionary = await snapshot()
      assert.equal(afterStaleDictionary.timeline, beforeStaleDictionary.timeline)
      assert.equal(afterStaleDictionary.history, beforeStaleDictionary.history)
      assert.deepEqual(afterStaleDictionary.selectedClipIds, beforeStaleDictionary.selectedClipIds)
      assert.equal(afterStaleDictionary.dirty, false)
      assert.deepEqual(afterStaleDictionary.forbiddenCalls, [])
      await page.screenshot({ path: path.join(output, `export-stale-${locale}${native ? '-native' : ''}.png`) })
      pass(`${locale} dictionary without workspace/preset labels uses readable fallbacks for cards/controls/options/aria/titles and all queue statuses`)
    }

    const finalState = await snapshot()
    assert.deepEqual(finalState.forbiddenCalls, [])
    assert.deepEqual(errors, [])
    fs.writeFileSync(path.join(output, `report${native ? '-native' : ''}.json`), JSON.stringify({
      runtime: native ? 'installed Electron isolated host with mocked desktop bridge' : 'Chrome with mocked desktop bridge',
      groups: reports, errors, claims: 'UI/settings/worker-lifecycle only. No export files, native encoder, user project or packaged-release verification.',
    }, null, 2))
    console.log(`PASS ${reports.length} export workspace groups; artifacts ${output}`)
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(output, `failure${native ? '-native' : ''}.png`) }).catch(() => {})
      fs.writeFileSync(path.join(output, `failure${native ? '-native' : ''}.json`), JSON.stringify({
        error: error.stack, errors, state: await page.evaluate(() => window.exportWorkspaceTest?.snapshot()).catch(() => null),
        resize: await page.evaluate(() => ({ reason: window.exportResizeCase, preferences: localStorage.getItem('velorn-export-panel-widths-v1'),
          resizing: document.querySelector('.export-workspace__body')?.dataset.resizing,
          settings: document.querySelector('[data-testid="export-settings"]')?.getBoundingClientRect().width,
          queue: document.querySelector('[data-testid="export-queue"]')?.getBoundingClientRect().width })).catch(() => null),
      }, null, 2))
    }
    throw error
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
