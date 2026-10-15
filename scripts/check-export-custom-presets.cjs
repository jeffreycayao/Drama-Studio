// Isolated real ExportPanel UI. Reuses only the existing strict in-memory
// fixture; no user app, project, media output, or native export is touched.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const base = process.env.VELORN_TEST_URL || 'http://127.0.0.1:5196'
const native = process.env.VELORN_TEST_ELECTRON === '1'
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'velorn-custom-presets-'))
const libraryKey = 'velorn-custom-export-presets'

async function main() {
  const browser = native ? await _electron.launch({ executablePath: require('electron'),
    args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')], env: { ...process.env, VELORN_TEST_URL: base } })
    : await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true })
  let page
  const errors = [], reports = []
  const pass = message => { reports.push(message); console.log(`PASS ${reports.length}: ${message}`) }
  try {
    page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    if (native) await browser.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
    page.setDefaultTimeout(10000)
    page.on('pageerror', error => errors.push(error.message))
    await page.routeWebSocket(url => url.hostname === new URL(base).hostname && url.port === new URL(base).port, socket => socket.close())
    await page.goto(`${base}/tests/fixtures/export-workspace.html`)
    await page.waitForFunction(() => Boolean(window.exportWorkspaceTest?.snapshot().settings))
    const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{"presets":[]}').presets, libraryKey)
    const settings = () => page.evaluate(() => {
      const state = window.exportWorkspaceTest.project.getState()
      const key = `comfystudio-export-settings-v1:${String(state.currentProjectHandle || state.currentProject.name).replace(/[^\w.-]+/g, '_').slice(-120)}`
      return JSON.parse(localStorage.getItem(key) || 'null')
    })
    const snapshot = () => page.evaluate(() => window.exportWorkspaceTest.snapshot())
    const picker = page.getByTestId('export-custom-presets')
    const dialog = () => page.getByRole('dialog')
    const save = async name => {
      await page.getByTestId('export-preset-save').click()
      await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill(name)
      await page.getByTestId('export-preset-confirm').click()
      await dialog().waitFor({ state: 'detached' })
    }
    const before = await snapshot()
    assert.equal(await page.locator('.export-preset-tile').count(), 5)
    assert.equal(await page.locator('#export-preset-choice option').count(), 11)
    await page.locator('#export-crf').fill('16')
    await page.getByTestId('export-preset-save').click()
    const presetName = page.getByRole('textbox', { name: 'Preset name', exact: true })
    await presetName.fill('日本語の納品')
    const ime = await presetName.evaluate(input => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '日本語' }))
      const prevented = []
      for (const properties of [
        { key: 'Escape', code: 'Escape', isComposing: true, keyCode: 229 },
        { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 },
        { key: 'Escape', code: 'Escape', keyCode: 27 },
        { key: 'Enter', code: 'Enter', keyCode: 13 },
      ]) {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...properties })
        input.dispatchEvent(event); prevented.push(event.defaultPrevented)
      }
      const character = new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 229, isComposing: true, bubbles: true, cancelable: true })
      input.dispatchEvent(character)
      input.form.requestSubmit()
      return { prevented, characterPrevented: character.defaultPrevented }
    })
    assert.deepEqual(ime.prevented, [true, true, true, true])
    assert.equal(ime.characterPrevented, false)
    assert.equal(await dialog().count(), 1)
    assert.equal(await presetName.inputValue(), '日本語の納品')
    assert.equal((await saved()).length, 0)
    const finalImeKey = await presetName.evaluate(input => {
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本語' }))
      const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, bubbles: true, cancelable: true })
      input.dispatchEvent(event)
      return event.defaultPrevented
    })
    assert.equal(finalImeKey, true)
    assert.equal((await saved()).length, 0)
    await page.keyboard.press('Escape')
    assert.equal(await dialog().count(), 0)
    pass('IME Enter/Escape and implicit submission preserve the name draft without saving or closing')
    await save('Client delivery')
    let entries = await saved()
    assert.equal(entries.length, 1)
    assert.equal(entries[0].settings.crf, 16)
    for (const key of ['filename', 'range', 'projectPath', 'outputPath', 'projectSettings', 'clips', 'destination']) assert.equal(key in entries[0].settings, false)
    const firstId = entries[0].id
    pass('Saves named delivery-only settings while preserving all ten built-in choices')

    await page.getByTestId('export-preset-save').click()
    await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill(' CLIENT DELIVERY ')
    await page.getByTestId('export-preset-confirm').click()
    assert.match(await dialog().getByRole('alert').textContent(), /already exists/)
    assert.equal((await saved()).length, 1)
    await page.keyboard.press('Escape')
    assert.equal(await dialog().count(), 0)
    assert.equal(await page.getByTestId('export-preset-save').evaluate(element => document.activeElement === element), true)
    pass('Duplicate names are refused and Escape restores focus without starting playback')

    await page.evaluate(() => {
      const test = window.exportWorkspaceTest, state = test.project.getState()
      test.project.setState({ currentProjectHandle: `${test.memoryRoot}/second`,
        currentProject: { ...state.currentProject, name: 'Second project', settings: { width: 1080, height: 1920, fps: 24 } } })
    })
    await page.waitForFunction(() => document.querySelector('#export-filename')?.value === 'Second project_export')
    await page.locator('#export-filename').fill('Keep my filename')
    await page.getByTestId('export-range-inout').click()
    await page.locator('#export-crf').fill('28')
    const targetBefore = await settings()
    const projectBefore = await page.evaluate(() => JSON.stringify(window.exportWorkspaceTest.project.getState().currentProject))
    await picker.getByRole('button', { name: 'Apply', exact: true }).click()
    await page.waitForFunction(() => Number(document.querySelector('#export-crf').value) === 16)
    const applied = await settings()
    assert.equal(applied.filename, targetBefore.filename)
    assert.equal(applied.range, targetBefore.range)
    assert.equal(await page.evaluate(() => JSON.stringify(window.exportWorkspaceTest.project.getState().currentProject)), projectBefore)
    assert.equal((await saved())[0].id, firstId)
    pass('Same saved preset applies across projects without replacing filename, range, or project settings')

    await picker.getByRole('button', { name: 'Rename…', exact: true }).click()
    await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Client master')
    await page.getByTestId('export-preset-confirm').click()
    assert.equal((await saved())[0].name, 'Client master')
    assert.equal((await saved())[0].id, firstId)
    await save('Second copy')
    assert.equal((await saved()).length, 2)
    await page.locator('#export-saved-preset-choice').selectOption(firstId)
    await picker.getByRole('button', { name: 'Delete…', exact: true }).click()
    assert.equal(await dialog().getByRole('button', { name: 'Cancel', exact: true }).evaluate(element => document.activeElement === element), true)
    await page.keyboard.press('Escape')
    assert.equal((await saved()).length, 2)
    const beforeDelete = await settings()
    await picker.getByRole('button', { name: 'Delete…', exact: true }).click()
    await page.getByTestId('export-preset-confirm').click()
    assert.equal((await saved()).length, 1)
    assert.deepEqual(await settings(), beforeDelete)
    pass('Rename preserves identity; cancel is safe; confirmed delete removes only the named preset')

    await picker.getByRole('button', { name: 'Rename…', exact: true }).click()
    await page.evaluate(key => {
      const library = JSON.parse(localStorage.getItem(key)); library.presets[0].name = 'Changed elsewhere'
      localStorage.setItem(key, JSON.stringify(library))
    }, libraryKey)
    await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Stale rename')
    await page.getByTestId('export-preset-confirm').click()
    assert.match(await dialog().getByRole('alert').textContent(), /another window/)
    assert.equal((await saved())[0].name, 'Changed elsewhere')
    await page.keyboard.press('Escape')
    pass('An externally changed preset cannot be renamed through a stale dialog')

    const rawBeforeQuota = await page.evaluate(key => localStorage.getItem(key), libraryKey)
    await page.evaluate(key => {
      window.originalPresetSetItem = Storage.prototype.setItem
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new DOMException('Full', 'QuotaExceededError')
        return window.originalPresetSetItem.call(this, name, value)
      }
    }, libraryKey)
    await page.getByTestId('export-preset-save').click()
    await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Cannot save')
    await page.getByTestId('export-preset-confirm').click()
    assert.match(await dialog().getByRole('alert').textContent(), /could not be saved/)
    assert.equal(await page.evaluate(key => localStorage.getItem(key), libraryKey), rawBeforeQuota)
    await page.evaluate(() => { Storage.prototype.setItem = window.originalPresetSetItem; delete window.originalPresetSetItem })
    await page.keyboard.press('Escape')
    pass('Storage quota failures remain visible and do not claim a successful save')

    await page.getByTestId('export-preset-save').click()
    await page.evaluate(() => window.exportWorkspaceTest.setActive(false))
    assert.equal(await dialog().count(), 0)
    await page.evaluate(() => window.exportWorkspaceTest.setActive(true))
    assert.equal(await dialog().count(), 0)
    await save('<img src=x onerror=window.__presetInjection=1>')
    assert.equal(await picker.locator('img').count(), 0)
    assert.equal(await page.evaluate(() => window.__presetInjection), undefined)
    assert.ok(await page.getByTestId('export-active-preset').textContent().then(text => text.includes('<img src=x')))
    pass('Hidden workspaces close dialogs; saved names remain inert text')

    if (native) await browser.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900, 1000))
    else await page.setViewportSize({ width: 900, height: 1000 })
    await picker.scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(output, 'custom-presets.png'), timeout: 30000 })
    const after = await snapshot()
    for (const key of ['timeline', 'history', 'inPoint', 'outPoint', 'selectedClipIds']) assert.deepEqual(after[key], before[key], key)
    assert.equal(after.jobs.length, 0)
    assert.equal(after.writes.length, 0)
    assert.equal(after.forbiddenCalls.length, 0)
    assert.equal(after.dirty, false)
    assert.deepEqual(errors, [])
    pass('No timeline/history/marks/selection/project-dirty changes, exports, or renderer errors')
    console.log(`Artifacts: ${output}`)
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
    console.error(`Artifacts: ${output}`)
    throw error
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
