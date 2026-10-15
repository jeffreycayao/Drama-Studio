// Real ExportPanel readiness integration, using the existing strict in-memory
// fixture. No native export, source file, user project, or authored edit is
// created by readiness actions. This is UI safety, not decode/export parity.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const base = process.env.VELORN_TEST_URL || 'http://127.0.0.1:5196'
const native = process.env.VELORN_TEST_ELECTRON === '1'
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-export-readiness-'))

async function main() {
  const browser = native ? await _electron.launch({ executablePath: require('electron'),
    args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')], env: { ...process.env, VELORN_TEST_URL: base } })
    : await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true })
  const errors = [], reports = []
  let page
  const pass = message => { reports.push(message); console.log(`PASS ${reports.length}: ${message}`) }
  try {
    page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    if (native) await browser.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(1440, 1000); window.showInactive()
    })
    page.setDefaultTimeout(10000)
    page.on('pageerror', error => { errors.push(error.message); console.error('Renderer:', error.message) })
    await page.routeWebSocket(url => url.hostname === new URL(base).hostname && url.port === new URL(base).port, socket => socket.close())
    await page.goto(`${base}/tests/fixtures/export-workspace.html`)
    await page.waitForFunction(() => Boolean(window.exportWorkspaceTest?.snapshot().settings))
    const panel = page.locator('[data-export-readiness]')
    const snapshot = () => page.evaluate(() => window.exportWorkspaceTest.snapshot())
    const authored = async () => {
      const state = await snapshot()
      return { timeline: state.timeline, history: state.history, selection: state.selectedClipIds,
        inPoint: state.inPoint, outPoint: state.outPoint, dirty: state.dirty }
    }
    const assertUnchanged = async before => assert.deepEqual(await authored(), before)
    const open = async () => {
      if (!(await panel.evaluate(element => element.open))) await panel.locator('summary').click()
    }
    const check = async () => {
      await open()
      await panel.getByRole('button', { name: /^(Check this range|Refresh checks)$/ }).click()
      await page.waitForFunction(() => /\d+ warnings/.test(document.querySelector('[data-export-readiness] > summary')?.textContent || ''))
    }
    const available = () => page.evaluate(() => {
      const test = window.exportWorkspaceTest
      for (const asset of test.assets.getState().assets) {
        if (asset.path) test.existingPaths.add(`${test.memoryRoot}/${asset.path.replace(/\\/g, '/')}`)
        if (asset.absolutePath) test.existingPaths.add(asset.absolutePath)
      }
    })
    const reset = async options => {
      await page.evaluate(options => window.exportWorkspaceTest.reset(options), options || {})
      await panel.waitFor()
      await open()
    }
    const waitStale = () => panel.getByText('Refresh needed', { exact: true }).waitFor()
    const holdExists = () => page.evaluate(() => {
      const test = window.exportWorkspaceTest
      const original = window.electronAPI.exists
      test.readinessHeld = []
      window.electronAPI.exists = path => {
        // Preserve the fixture's memory-only path validation and call log.
        const initial = original(path)
        return new Promise(resolve => test.readinessHeld.push({ path, resolve: value => resolve(value ?? initial) }))
      }
      test.releaseReadiness = value => {
        window.electronAPI.exists = original
        test.readinessHeld.splice(0).forEach(item => item.resolve(value))
      }
    })
    const releaseExists = value => page.evaluate(value => window.exportWorkspaceTest.releaseReadiness(value), value)
    const waitHeld = () => page.waitForFunction(() => window.exportWorkspaceTest.readinessHeld?.length >= 1)

    await open()
    assert.match(await panel.textContent(), /Warnings are advisory/)
    const before = await authored(), initialCalls = (await snapshot()).calls.length
    await page.waitForTimeout(150)
    assert.equal((await snapshot()).calls.length, initialCalls, 'opening the optional section does not auto-scan')
    await check()
    assert.equal(await panel.getByText('Source file is unavailable', { exact: true }).count(), 3)
    assert.match(await panel.textContent(), /not a decode or render test/)
    assert.equal((await snapshot()).calls.filter(call => call.method === 'exists').length, 3)
    await assertUnchanged(before)
    pass('Check finds only three used missing source files and is advisory/read-only')

    await panel.locator('li').filter({ hasText: 'Second shot' }).getByRole('button', { name: 'Inspect', exact: true }).click()
    await page.waitForFunction(() => window.exportWorkspaceTest.snapshot().playheadPosition === 4)
    await assertUnchanged(before)
    assert.equal((await snapshot()).isPlaying, false)
    pass('Inspect seeks the real Export playhead without selection, marks, history or project writes')

    await available()
    await check()
    assert.match(await panel.textContent(), /No warnings found by these checks/)
    assert.equal(await panel.locator('li').count(), 0)
    await assertUnchanged(before)
    pass('Refresh observes newly available files without repairing or modifying media records')

    await page.getByTestId('export-range-inout').click()
    await waitStale()
    await check()
    assert.match(await panel.textContent(), /No warnings found by these checks/)
    await page.evaluate(() => {
      const test = window.exportWorkspaceTest
      test.assets.setState(state => ({ assets: state.assets.map(asset => asset.id === 'still-b' ? { ...asset, name: 'Renamed synthetic source' } : asset) }))
    })
    await waitStale()
    await check()
    assert.match(await panel.textContent(), /No warnings found by these checks/)
    pass('Range changes and source-record replacements invalidate results until Refresh')

    await holdExists()
    await panel.getByRole('button', { name: 'Refresh checks', exact: true }).click()
    await waitHeld()
    await page.evaluate(() => {
      const test = window.exportWorkspaceTest
      test.assets.setState(state => ({ assets: state.assets.map(asset => ({ ...asset })) }))
    })
    await waitStale()
    await releaseExists(false)
    await page.waitForTimeout(80)
    assert.match(await panel.textContent(), /Refresh needed/)
    assert.equal(await panel.getByText('Source file is unavailable', { exact: true }).count(), 0, 'late source results were discarded')
    await check()
    pass('A source replacement during a pending scan discards late results instead of publishing them')

    await holdExists()
    await panel.getByRole('button', { name: 'Refresh checks', exact: true }).click()
    await waitHeld()
    const pendingBefore = await authored()
    await panel.getByRole('button', { name: 'Cancel check', exact: true }).click()
    await releaseExists(false)
    await page.waitForTimeout(80)
    assert.equal(await panel.getByRole('button', { name: 'Cancel check', exact: true }).count(), 0)
    assert.equal(await panel.getByText('Source file is unavailable', { exact: true }).count(), 0)
    await assertUnchanged(pendingBefore)
    await holdExists()
    await panel.getByRole('button', { name: 'Refresh checks', exact: true }).click()
    await waitHeld()
    await page.evaluate(() => window.exportWorkspaceTest.setActive(false))
    await releaseExists(false)
    await page.evaluate(() => window.exportWorkspaceTest.setActive(true))
    await open()
    assert.equal(await panel.getByRole('button', { name: 'Cancel check', exact: true }).count(), 0)
    assert.equal(await panel.getByText('Source file is unavailable', { exact: true }).count(), 0)
    await assertUnchanged(pendingBefore)
    pass('Cancel and leaving Export retire pending checks without stale publication or authored writes')

    await reset({ settings: { includeAudio: false } })
    await page.evaluate(async () => {
      const test = window.exportWorkspaceTest
      const constants = await import('/src/utils/frameSampling.js')
      const state = test.timeline.getState(), first = state.clips.find(clip => clip.id === 'First shot')
      test.assets.setState(state => ({ assets: [...state.assets, { id: 'optical-source', name: 'Optical fixture source',
        type: 'video', path: 'assets/optical.mp4', duration: 8, hasAudio: false }] }))
      test.timeline.setState({ playheadPosition: 0, clips: [
        { ...first, duration: 2, trimEnd: 2 },
        { ...first, id: 'Optical shot', name: 'Optical shot', assetId: 'optical-source', type: 'video', url: null,
          startTime: 3, duration: 1, trimEnd: 1, frameSampling: 'optical-flow', opticalFlowCache: {
            version: constants.OPTICAL_FLOW_CACHE_VERSION, engine: constants.OPTICAL_FLOW_CACHE_ENGINE,
            modelName: constants.OPTICAL_FLOW_CACHE_MODEL, status: 'ready', path: 'cache/optical.mp4',
            sourceStart: 0, sourceEnd: 8, targetFps: 24, sourceSignature: 'synthetic-only',
          } },
        state.clips.find(clip => clip.type === 'audio'),
      ] })
    })
    await available()
    const opticalBefore = await authored()
    await check()
    assert.equal(await panel.getByText('Optical Flow file is unavailable', { exact: true }).count(), 1)
    assert.equal(await panel.getByText('Possible picture gap', { exact: true }).count(), 1)
    assert.equal(await panel.getByText('Possible blank ending', { exact: true }).count(), 1)
    await panel.locator('li').filter({ hasText: 'Possible picture gap' }).getByRole('button', { name: 'Inspect', exact: true }).click()
    await page.waitForFunction(() => window.exportWorkspaceTest.snapshot().playheadPosition === 2)
    await assertUnchanged(opticalBefore)
    await panel.scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(output, native ? 'readiness-native.png' : 'readiness-chrome.png') })
    pass('Actual ExportPanel reports a missing Optical Flow file, uncovered picture gap and blank tail; Inspect remains read-only')

    await page.evaluate(() => {
      const test = window.exportWorkspaceTest
      test.timeline.setState(state => ({ clips: state.clips.map(clip => clip.id === 'Optical shot'
        ? { ...clip, opticalFlowCache: { ...clip.opticalFlowCache, version: 'old-cache-version' } } : clip) }))
    })
    await waitStale()
    for (const button of await panel.getByRole('button', { name: 'Inspect', exact: true }).all()) assert.equal(await button.isDisabled(), true)
    const editedBefore = await authored()
    await check()
    assert.equal(await panel.getByText('Optical Flow needs attention', { exact: true }).count(), 1)
    assert.equal(await panel.getByText('Optical Flow file is unavailable', { exact: true }).count(), 0)
    await assertUnchanged(editedBefore)
    pass('Authored cache metadata changes make old Inspect buttons unavailable, then Refresh reports stale Optical Flow')

    await holdExists()
    await panel.getByRole('button', { name: 'Refresh checks', exact: true }).click()
    await waitHeld()
    await page.evaluate(() => window.exportWorkspaceTest.setMounted(false))
    await releaseExists(false)
    await page.evaluate(() => window.exportWorkspaceTest.setMounted(true))
    await open()
    assert.match(await panel.locator('summary').textContent(), /Optional/)
    await assertUnchanged(editedBefore)
    const final = await snapshot()
    assert.equal(final.jobs.length, 0)
    assert.equal(final.writes.length, 0)
    assert.deepEqual(final.forbiddenCalls, [])
    assert.equal(final.calls.some(call => ['writeFile', 'createDirectory', 'runExportInWorker', 'saveFileDialog', 'selectDirectory'].includes(call.method)), false)
    assert.deepEqual(errors, [])
    pass('Unmount cleanup discards pending work; all readiness scenarios use zero exports, file writes or output dialogs')
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ native, reports, errors }, null, 2))
    console.log(`Verified ${reports.length} readiness UI checks. Artifacts: ${output}`)
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
    console.error(`Artifacts: ${output}`)
    throw error
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
