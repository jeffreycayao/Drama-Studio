// Browser-only: real Timeline/shortcuts, synthetic RAM stores, no native IPC,
// real media, user projects, provider/API/WebSocket access, or app writes.
// Run against a separately started, isolated Vite server:
// VELORN_TEST_URL=http://127.0.0.1:PORT PLAYWRIGHT_MODULE_PATH=... node scripts/check-timeline-hotfixes.cjs
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const base = new URL(process.env.VELORN_TEST_URL || 'http://127.0.0.1:5184')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use an isolated loopback Vite server')
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-7, `${label}: ${actual} != ${expected}`)

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true })
  const errors = [], forbiddenRequests = [], groups = []
  const pass = message => { groups.push(message); console.log(`PASS ${groups.length}: ${message}`) }
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      const staticResource = ['document', 'script', 'stylesheet', 'font', 'image', 'other'].includes(request.resourceType())
      const languageAsset = /^\/lang\/(?:languages|lang_en)\.json$/.test(url.pathname)
      const appAsset = /^\/(?:@vite\/|@react-refresh|@id\/|@fs\/|src\/|electron\/[^/]+\.mjs|node_modules\/|tests\/fixtures\/timeline-hotfixes\.(?:html|jsx)|favicon\.ico)/.test(url.pathname)
      if (url.origin === base.origin && request.method() === 'GET' && ((staticResource && appAsset) || languageAsset)) {
        return route.continue()
      }
      forbiddenRequests.push({ method: request.method(), url: request.url(), type: request.resourceType() })
      console.error('Blocked non-fixture request:', request.method(), request.url())
      return route.abort('blockedbyclient')
    })
    await page.routeWebSocket(/.*/, socket => socket.close())
    await page.goto(new URL('/tests/fixtures/timeline-hotfixes.html', base).href)
    await page.waitForFunction(() => Boolean(window.timelineHotfixTest?.seed))
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const snapshot = () => page.evaluate(() => window.timelineHotfixTest.snapshot())
    const split = page.locator('[aria-label="Edit selection"] button[title*="active track"][title*="(X)"]')
    const seed = async options => {
      await page.keyboard.press('Escape')
      await page.evaluate(options => window.timelineHotfixTest.seed(options), options || {})
      await settle()
      await page.getByTestId('timeline-viewport').evaluate(node => { node.scrollLeft = 0 })
      await page.evaluate(() => document.activeElement?.blur())
    }
    const seek = async time => {
      const ruler = await page.getByTestId('timeline-scrub-ruler').boundingBox()
      const zoom = await page.evaluate(() => window.timelineHotfixTest.timeline.getState().zoom)
      await page.mouse.click(ruler.x + time * zoom / 5, ruler.y + ruler.height / 2)
      await settle()
      near((await snapshot()).playheadPosition, time, 'ruler seek')
    }
    const unchanged = (before, after) => {
      for (const key of ['clips', 'tracks', 'transitions', 'markers', 'history', 'historyIndex', 'selectedGap', 'selectedClipIds', 'dirty']) {
        assert.deepEqual(after[key], before[key], `${key} unchanged`)
      }
    }
    const assertSplitState = async disabled => assert.equal(await split.isDisabled(), disabled, `Split disabled = ${disabled}`)

    for (const [trackId, prefix] of [['v', 'video'], ['a1', 'audio']]) {
      await seed({ activeTrackId: trackId })
      await assertSplitState(true)
      await page.locator(`[data-clip-id="${prefix}-first"]`).click({ position: { x: 30, y: 12 } })
      await settle()
      assert.equal((await snapshot()).activeTrackId, trackId)
      await seek(2)
      await assertSplitState(false)
      const original = await snapshot()
      await split.click(); await settle()
      assert.equal((await snapshot()).clips.length, original.clips.length + 1)
      await assertSplitState(true)
      const afterFirstCut = await snapshot()
      await page.keyboard.press('x'); await settle()
      unchanged(afterFirstCut, await snapshot())
      await seek(4)
      await assertSplitState(false)
      await split.click(); await settle()
      await seek(6)
      await assertSplitState(false)
      await page.keyboard.press('x'); await settle()
      const cut = await snapshot()
      assert.equal(cut.clips.length, original.clips.length + 3)
      assert.deepEqual(cut.clips.filter(item => item.trackId === trackId && item.startTime < 8)
        .sort((a, b) => a.startTime - b.startTime).map(item => [item.startTime, item.duration, item.trimStart, item.trimEnd]),
      [[0, 2, 0, 2], [2, 2, 2, 4], [4, 2, 4, 6], [6, 2, 6, 8]])
      assert.deepEqual(cut.clips.filter(item => item.trackId !== trackId), original.clips.filter(item => item.trackId !== trackId))
      assert.equal(cut.activeTrackId, trackId, 'no track toggles needed after successive cuts')
      pass(`${prefix}: successive toolbar Split and X after ruler seeks update eligibility and preserve source trims`)

      for (const time of [0, 2, 4, 6, 8, 9, 10, 14]) {
        await seek(time); await assertSplitState(true)
        const before = await snapshot()
        await page.keyboard.press('x'); await settle()
        unchanged(before, await snapshot())
      }
      await seek(11); await assertSplitState(false)
      await page.keyboard.press('x'); await settle()
      assert.equal((await snapshot()).clips.length, cut.clips.length + 1)
      await seek(1); await assertSplitState(false)
      await seek(12); await assertSplitState(false)
      await split.click(); await settle()
      assert.equal((await snapshot()).clips.length, cut.clips.length + 2)
      assert.ok((await snapshot()).clips.some(item => item.trackId === trackId && item.startTime === 12), 'true-to-true seek splits the live clip')
      assert.equal((await snapshot()).activeTrackId, trackId)
      pass(`${prefix}: exact boundaries/gaps are no-ops; moving between clips refreshes Split without selection/track toggles`)
    }

    for (const lock of ['track:v', 'clip:video-first']) {
      await seed({ activeTrackId: 'v', lock })
      await seek(2); await assertSplitState(true)
      const before = await snapshot()
      await page.keyboard.press('x'); await settle()
      unchanged(before, await snapshot())
    }
    pass('Split honors track and clip locks without adding history')

    const selectGap = async () => {
      const lane = page.locator('[data-track-lane]').first()
      const box = await lane.boundingBox()
      const zoom = await page.evaluate(() => window.timelineHotfixTest.timeline.getState().zoom)
      await page.mouse.click(box.x + 2.5 * zoom / 5, box.y + box.height / 2)
      await settle()
      assert.deepEqual((await snapshot()).selectedGap, { trackId: 'v', startTime: 2, endTime: 3.125 })
    }
    const gapPreview = () => page.evaluate(() => window.timelineHotfixTest.timeline.getState().previewSelectedGapDelete())
    const deleteGap = page.locator('[aria-label="Edit selection"] button:is([title*="Delete or Backspace"], [title^="Close this empty gap"])')
    await seed({ mode: 'gap' }); await selectGap()
    const beforeGap = await snapshot(), preview = await gapPreview()
    assert.equal(preview.ok, true); near(preview.deltaSeconds, 1.125, 'preview duration'); assert.equal(preview.deltaFrames, 27)
    unchanged(beforeGap, await snapshot())
    await deleteGap.click(); await settle()
    const afterGap = await snapshot()
    for (const previous of beforeGap.clips) {
      const updated = afterGap.clips.find(item => item.id === previous.id)
      assert.deepEqual(updated, { ...previous, startTime: previous.startTime >= 3.125 ? previous.startTime - 1.125 : previous.startTime })
    }
    assert.equal(afterGap.history.length, beforeGap.history.length + 1)
    assert.equal(afterGap.selectedGap, null)
    assert.deepEqual(afterGap.markers, beforeGap.markers)
    await page.keyboard.press('Control+z'); await settle()
    const undone = await snapshot()
    for (const key of ['clips', 'tracks', 'transitions', 'markers']) assert.deepEqual(undone[key], beforeGap[key], `Undo restores ${key}`)
    pass('selected 1.125 s global empty gap shifts Video, Dialogue, Music by 27 frames with one checkpoint; Undo restores')

    for (const options of [{ mode: 'occupied' }, { mode: 'gap', lock: 'track:a2' }, { mode: 'gap', lock: 'clip:music-after' }]) {
      await seed(options); await selectGap()
      const before = await snapshot(), plan = await gapPreview()
      assert.equal(plan.ok, false)
      assert.match(plan.reason, /no clips were moved\./i)
      assert.match(plan.reason, /music|locked/i)
      unchanged(before, await snapshot())
      await deleteGap.click(); await settle()
      unchanged(before, await snapshot())
      assert.ok(await page.getByText(plan.reason, { exact: true }).isVisible(), 'readable refusal appears in actual Timeline')
      if (options.mode === 'occupied' && process.env.VELORN_TEST_WARNING_SCREENSHOT) {
        await page.screenshot({ path: process.env.VELORN_TEST_WARNING_SCREENSHOT })
      }
      await page.evaluate(() => document.activeElement?.blur())
      await page.keyboard.press('Delete'); await settle()
      unchanged(before, await snapshot())
    }
    pass('overlapping music and downstream track/clip locks reject gap deletion visibly and atomically, including Delete shortcut')

    await seed({ mode: 'gap' })
    await page.evaluate(() => {
      const state = window.timelineHotfixTest.timeline.getState()
      state.selectClip('video-before')
      state.toggleRippleEdit()
    })
    await settle()
    const beforeLegacy = await snapshot()
    await deleteGap.click(); await settle()
    const afterLegacy = await snapshot()
    assert.equal(afterLegacy.clips.some(item => item.id === 'video-before'), false)
    near(afterLegacy.clips.find(item => item.id === 'video-after').startTime, 1.125, 'legacy selected-clip ripple')
    assert.deepEqual(afterLegacy.clips.filter(item => item.trackId !== 'v'), beforeLegacy.clips.filter(item => item.trackId !== 'v'))
    pass('existing selected-clip ripple remains track-local; unrelated audio is not shifted')

    const isolation = await page.evaluate(() => ({ ...window.__timelineHotfixIsolation,
      preload: Boolean(window.electronAPI), projectHandle: window.timelineHotfixTest.project.getState().currentProjectHandle }))
    assert.equal(isolation.memoryStorage, true); assert.equal(isolation.preload, false); assert.equal(isolation.projectHandle, null)
    assert.deepEqual(isolation.blockedRequests, []); assert.deepEqual(forbiddenRequests, []); assert.deepEqual(errors, [])
    if (process.env.VELORN_TEST_SCREENSHOT) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT })
    pass('no renderer errors, provider/API requests, native preload, or project-folder writes; persistence remains RAM-only')
    console.log(`Verified ${groups.length} browser regression groups.`)
  } finally {
    await browser.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
