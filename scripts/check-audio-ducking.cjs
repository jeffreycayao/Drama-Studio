// Isolated synthetic media only. Chrome/installed Electron, not packaged-OS validation.
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const base = process.env.VELORN_TEST_URL || 'http://127.0.0.1:5198'
async function main() {
  const native = process.env.VELORN_TEST_ELECTRON === '1'
  const browser = native ? await _electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')], env: { ...process.env, VELORN_TEST_URL: base } })
    : await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true })
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-ducking-')), errors = []
  let groups = 0
  const pass = text => console.log(`PASS ${++groups}: ${text}`)
  try {
    const page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    if (native) await browser.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => errors.push(error.message))
    await page.routeWebSocket(url => url.hostname === new URL(base).hostname && url.port === new URL(base).port, socket => socket.close())
    await page.goto(`${base}/tests/fixtures/audio-ducking.html`)
    await page.waitForFunction(() => Boolean(window.duckingTest))
    const snapshot = () => page.evaluate(() => window.duckingTest.snapshot())
    const open = () => page.getByRole('button', { name: 'Duck under dialogue…', exact: true }).click()
    const dialog = page.getByTestId('audio-ducking-dialog')
    const analyze = async () => { await dialog.getByRole('button', { name: 'Analyze dialogue', exact: true }).click(); await dialog.getByRole('button', { name: 'Apply volume points', exact: true }).waitFor(); await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Apply volume points')?.disabled) }
    const before = await snapshot()
    await open(); await analyze()
    assert.equal((await snapshot()).project, before.project)
    assert.equal((await snapshot()).dirty, false)
    assert.equal((await snapshot()).history, 0)
    assert.match(await dialog.getByRole('status').textContent(), /2 ducking regions/)
    await page.screenshot({ path: path.join(out, 'preview.png') })
    pass('analysis previews two dialogue regions without authoring or dirtying the project')

    await dialog.getByRole('button', { name: 'Listen ducked', exact: true }).click()
    await page.waitForFunction(() => window.duckingTest.snapshot().position > 1.5)
    const playing = await snapshot()
    assert.ok(playing.preview); assert.deepEqual([playing.audition.startTime, playing.audition.endTime], [1, 7])
    assert.equal(playing.project, before.project)
    await dialog.getByRole('button', { name: 'Stop preview', exact: true }).click()
    assert.equal((await snapshot()).position, before.position); assert.equal((await snapshot()).preview, null)
    await dialog.getByRole('button', { name: 'Listen original', exact: true }).click()
    await page.waitForFunction(() => window.duckingTest.snapshot().position > 1.3)
    assert.equal((await snapshot()).preview, null)
    await dialog.getByRole('button', { name: 'Stop preview', exact: true }).click()
    pass('original and ducked use the real bounded PreviewPanel clock and restore the cursor')

    // Actual graph: compare identical source positions in the music track,
    // well inside a detected dialogue region, with and without draft points.
    const rms = async mode => {
      await dialog.getByRole('button', { name: `Listen ${mode}`, exact: true }).click()
      await page.waitForFunction(() => window.duckingTest.snapshot().position > 2.55)
      const db = await page.evaluate(() => window.duckingTest.rms())
      await dialog.getByRole('button', { name: 'Stop preview', exact: true }).click()
      return db
    }
    const original = await rms('original'), ducked = await rms('ducked')
    assert.ok(Number.isFinite(original) && Number.isFinite(ducked), `valid RMS ${original}/${ducked}`)
    assert.ok(original - ducked > 10 && original - ducked < 14, `12dB reduction expected, got ${original - ducked}`)
    pass('real Web Audio music-track analyser hears the proposed 12dB reduction')

    await dialog.getByRole('button', { name: 'Apply volume points', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    const applied = await snapshot()
    assert.equal(applied.history, 1); assert.ok(applied.dirty); assert.ok(applied.envelope.points.length > 5)
    assert.ok(applied.envelope.points.some(p => p.id === 'authored'))
    await page.evaluate(() => window.duckingTest.timeline.getState().undo())
    assert.deepEqual((await snapshot()).envelope, before.envelope)
    await page.evaluate(() => window.duckingTest.timeline.getState().redo())
    assert.deepEqual((await snapshot()).envelope, applied.envelope)
    pass('apply creates editable points, preserves existing IDs, and is one Undo/Redo step')

    await page.evaluate(() => { window.duckingTest.reset(); window.duckingTest.setDelay(450) })
    await open(); await dialog.getByRole('button', { name: 'Analyze dialogue', exact: true }).click()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.waitForTimeout(600)
    assert.equal((await snapshot()).history, 0); assert.equal((await snapshot()).preview, null)
    pass('closing during native analysis discards late work without a project edit')

    await page.evaluate(() => window.duckingTest.setDelay(0)); await open(); await analyze()
    await page.evaluate(() => window.duckingTest.timeline.setState(s => ({ clips: s.clips.map(c => ({ ...c })) })))
    await page.waitForFunction(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Apply volume points')?.disabled)
    assert.match(await dialog.getByRole('status').textContent(), /context changed/)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    pass('stale clip identity invalidates analysis and prevents Apply')

    await page.evaluate(() => { window.duckingTest.reset(); window.duckingTest.setSilent(true) })
    await open(); await dialog.getByRole('button', { name: 'Analyze dialogue', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-testid="audio-ducking-dialog"] [role="status"]')?.textContent.includes('No dialogue activity'))
    assert.equal(await dialog.getByRole('button', { name: 'Apply volume points', exact: true }).isDisabled(), true)
    await page.screenshot({ path: path.join(out, 'silence.png') })
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    assert.equal((await snapshot()).history, 0)
    pass('silence provides a useful warning and never writes a neutral envelope')
    assert.deepEqual(errors, [])
    console.log(`${groups} groups passed (${native ? 'isolated Electron' : 'Chrome'}). Artifacts: ${out}`)
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
