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
    const single = page.getByTestId('single-clip-inspector')
    const card = (type, ordinal = 0, root = panel) => root.locator(`[data-effect-type="${type}"][data-effect-ordinal="${ordinal}"]`)
    const param = (type, key, ordinal = 0, root = panel) => card(type, ordinal, root).locator(`[data-effect-param="${key}"]`)
    const action = (type, name, ordinal = 0, root = panel) => card(type, ordinal, root).locator(`[data-effect-action="${name}"]`)
    const state = () => page.evaluate(() => {
      const t = window.multiClipInspectorTest, s = t.timeline.getState()
      return { clips: JSON.parse(JSON.stringify(s.clips)), history: s.history.length, dirty: t.isProjectDirty(), playing: s.isPlaying }
    })
    const select = ids => page.evaluate(ids => window.multiClipInspectorTest.timeline.setState({ selectedClipIds: ids }), ids)
    const effectsTab = async (root = panel) => { await root.waitFor(); await root.locator('[data-inspector-tab="effects"]').click() }
    const reset = async () => { await page.evaluate(() => window.multiClipInspectorTest.reset()); await effectsTab() }
    const seed = patches => page.evaluate(patches => {
      const t = window.multiClipInspectorTest
      t.timeline.setState(s => ({ clips: s.clips.map(c => patches[c.id] ? { ...c, ...patches[c.id] } : c) }))
      t.markProjectClean()
    }, patches)
    const range = async (target, value) => {
      await target.focus()
      const start = Number(await target.inputValue()), step = Number(await target.getAttribute('step')) || 1
      // Left/Right are timeline frame stepping; Up/Down edit the slider.
      const key = value >= start ? 'ArrowUp' : 'ArrowDown'
      for (let i = 0; i < Math.round(Math.abs(value - start) / step); i++) await page.keyboard.down(key)
      await page.keyboard.up(key); await target.blur()
    }
    const drag = async (target, dx) => {
      await target.scrollIntoViewIfNeeded()
      const box = await target.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2
      await page.mouse.move(x, y); await page.mouse.down()
      await page.mouse.move(x + dx, y, { steps: 10 }); await page.mouse.up()
    }
    const add = async (type, root = panel) => {
      await root.locator('[data-effect-action="add"]').click()
      await root.locator(`[data-effect-add="${type}"]`).click()
    }
    const undo = () => page.evaluate(() => window.multiClipInspectorTest.timeline.getState().undo())
    const redo = () => page.evaluate(() => window.multiClipInspectorTest.timeline.getState().redo())
    const groups = () => page.evaluate(async () => {
      const { getMultiClipSelection } = await import('/src/utils/multiClipInspector.js')
      const { getMultiClipEffectGroups } = await import('/src/utils/multiClipEffects.js')
      const { getEffectTypeDefinition } = await import('/src/utils/effects.js')
      const s = window.multiClipInspectorTest.timeline.getState()
      return getMultiClipEffectGroups(getMultiClipSelection(s.clips, s.tracks, s.selectedClipIds), getEffectTypeDefinition)
    })
    const request = payload => page.evaluate(payload => window.multiClipInspectorTest.timeline.getState().applyMultiClipEffectsEdit(payload), payload)
    const fx = (id, type, settings, enabled = true) => ({ id, type, enabled, settings })
    const pairs = {
      'visual-a': { effects: [fx('grain-a', 'glslFilmGrain', { amount: 10, size: 1.2, color: 50, stock: 2, futureSetting: 'keep-a' }), fx('unknown-a', 'future-effect', { keep: 'a' })] },
      'visual-b': { effects: [fx('unknown-b', 'future-effect', { keep: 'b' }), fx('grain-b', 'glslFilmGrain', { amount: 20, size: 2.1, color: 80, stock: 7, futureSetting: 'keep-b' }, false)] },
    }

    // Tail-only mode can verify the isolated library/registry after native
    // Inspector coverage has already completed (e.g. a capture-only timeout).
    let s
    if (process.env.VELORN_TEST_EFFECTS_TAIL !== '1') {
    await reset(); await select(['visual-a', 'visual-b', 'audio-a', 'audio-b', 'locked']); await effectsTab()
    const addOriginal = (await state()).clips
    await add('glslFilmGrain')
    s = await state()
    assert.equal(s.history, 1); assert.equal(s.dirty, true)
    const added = s.clips.slice(0, 2).map(c => c.effects[0])
    assert.equal(added.every(e => e.type === 'glslFilmGrain' && e.enabled === true), true)
    assert.notEqual(added[0].id, added[1].id, 'new effects have independent unique IDs')
    assert.deepEqual(s.clips.slice(2), addOriginal.slice(2), 'audio and locked clips remain untouched')
    await undo(); assert.deepEqual((await state()).clips, addOriginal)
    await redo(); assert.deepEqual((await state()).clips, s.clips)
    console.log('PASS: multi-add uses one undo, unique IDs, existing picker, and visual/locked eligibility')

    await reset(); await seed(pairs)
    assert.equal(await panel.locator('[data-inspector-tab="effects"]').isDisabled(), false)
    assert.equal(await param('glslFilmGrain', 'amount').getAttribute('data-mixed'), 'true')
    assert.equal(await action('glslFilmGrain', 'up').isDisabled(), true)
    assert.equal(await action('glslFilmGrain', 'down').isDisabled(), true)
    const editOriginal = (await state()).clips
    await param('glslFilmGrain', 'amount').focus(); await param('glslFilmGrain', 'amount').blur()
    assert.deepEqual((await state()).clips, editOriginal); assert.equal((await state()).dirty, false)
    await range(param('glslFilmGrain', 'amount'), 12); s = await state()
    assert.equal(s.history, 1)
    for (let i = 0; i < 2; i++) {
      const expected = editOriginal[i].effects.map(e => e.type === 'glslFilmGrain' ? { ...e, settings: { ...e.settings, amount: 12 } } : e)
      assert.deepEqual(s.clips[i].effects, expected, 'only the changed parameter is shared; IDs, other settings and order remain')
    }
    await undo(); assert.deepEqual((await state()).clips, editOriginal)
    await redo(); assert.deepEqual((await state()).clips, s.clips)
    await drag(param('glslFilmGrain', 'amount'), 10)
    assert.equal((await state()).history, 2, 'a separate mouse drag adds exactly one undo')
    console.log('PASS: common effects retain regular sliders, mixed values, sparse edits and one undo per keyboard/mouse gesture')

    await reset(); await seed(pairs)
    await card('glslFilmGrain').locator('[data-effect-preset="fine5245"]').click(); s = await state()
    for (const clip of s.clips.slice(0, 2)) {
      const effect = clip.effects.find(e => e.type === 'glslFilmGrain')
      assert.deepEqual({ ...effect.settings, futureSetting: undefined }, { amount: 22, size: 1, color: 55, stock: 0, futureSetting: undefined })
    }
    assert.equal(s.history, 1)
    await action('glslFilmGrain', 'enabled').click(); s = await state()
    assert.deepEqual(s.clips.slice(0, 2).map(c => c.effects.find(e => e.type === 'glslFilmGrain').enabled), [true, true])
    assert.equal(s.history, 2)
    await action('glslFilmGrain', 'enabled').click()
    assert.deepEqual((await state()).clips.slice(0, 2).map(c => c.effects.find(e => e.type === 'glslFilmGrain').enabled), [false, false])
    await action('glslFilmGrain', 'reset').click(); s = await state()
    const defaults = await page.evaluate(async () => (await import('/src/utils/effects.js')).getEffectTypeDefinition('glslFilmGrain').defaults)
    for (const clip of s.clips.slice(0, 2)) {
      const effect = clip.effects.find(e => e.type === 'glslFilmGrain')
      for (const [key, value] of Object.entries(defaults)) assert.equal(effect.settings[key], value)
      assert.equal(effect.enabled, false, 'resetting parameters preserves enabled state')
      assert.match(effect.settings.futureSetting, /^keep-/)
    }
    assert.equal(s.history, 4)
    await action('glslFilmGrain', 'reset').click(); assert.equal((await state()).history, 4, 'no-op reset has no undo')
    await action('glslFilmGrain', 'remove').click(); s = await state()
    assert.equal(s.history, 5)
    assert.deepEqual(s.clips.slice(0, 2).map(c => c.effects), [[pairs['visual-a'].effects[1]], [pairs['visual-b'].effects[0]]])
    await undo(); assert.equal((await state()).clips[0].effects.length, 2)
    console.log('PASS: presets, mixed enabled state, reset/no-op and remove preserve unrelated effects/settings')

    await reset(); await seed({ ...pairs, 'visual-b': { ...pairs['visual-b'], keyframes: { 'effect.grain-b.amount': [{ time: 0, value: 20 }], 'effect.unknown-b.keep': [{ time: 0, value: 1 }] } } })
    const protectedOriginal = (await state()).clips
    assert.equal(await param('glslFilmGrain', 'amount').isDisabled(), true)
    assert.equal(await param('glslFilmGrain', 'size').isDisabled(), false)
    assert.equal(await action('glslFilmGrain', 'reset').isDisabled(), true)
    assert.equal(await action('glslFilmGrain', 'remove').isDisabled(), true)
    assert.equal(await card('glslFilmGrain').locator('[data-effect-preset="fine5245"]').isDisabled(), true)
    const diamonds = await card('glslFilmGrain').locator('[data-effect-keyframe]').all()
    for (const button of diamonds) assert.equal(await button.isDisabled(), true)
    const protectedGroup = (await groups()).find(g => g.type === 'glslFilmGrain')
    const rejected = await request({ clipIds: ['visual-a', 'visual-b'], action: 'update', group: protectedGroup, settings: { size: 4, amount: 30 } })
    assert.equal(rejected.ok, false); assert.deepEqual((await state()).clips, protectedOriginal)
    assert.equal((await state()).history, 0); assert.equal((await state()).dirty, false)
    await range(param('glslFilmGrain', 'color'), 52)
    s = await state(); assert.equal(s.history, 1)
    assert.deepEqual(s.clips[1].keyframes, protectedOriginal[1].keyframes)
    assert.deepEqual(s.clips.slice(0, 2).map(c => c.effects.find(e => e.type === 'glslFilmGrain').settings.color), [52, 52])
    console.log('PASS: per-target ID animation guards, disabled batch keyframes/presets/reset/remove and atomic protected rejection')

    const duplicatePatches = {
      'visual-a': { effects: [fx('a-0', 'glslFilmGrain', { amount: 10 }), fx('cpu-a', 'filmGrain', { amount: 9, monochrome: 1 }), fx('a-1', 'glslFilmGrain', { amount: 30 })] },
      'visual-b': { effects: [fx('b-0', 'glslFilmGrain', { amount: 20 }), fx('b-1', 'glslFilmGrain', { amount: 40 }), fx('cpu-b', 'filmGrain', { amount: 19, monochrome: 0 })] },
    }
    await reset(); await seed(duplicatePatches)
    assert.equal(await panel.locator('[data-effect-type="glslFilmGrain"]').count(), 2)
    assert.equal(await panel.locator('[data-effect-type="filmGrain"]').count(), 1, 'CPU/GPU labels do not merge types')
    const oldGroups = await groups(), duplicateOriginal = (await state()).clips
    await range(param('glslFilmGrain', 'amount', 1), 32); s = await state()
    assert.deepEqual(s.clips.slice(0, 2).map(c => c.effects.filter(e => e.type === 'glslFilmGrain').map(e => e.settings.amount)), [[10, 32], [20, 32]])
    assert.deepEqual(s.clips.slice(0, 2).map(c => c.effects.find(e => e.type === 'filmGrain').settings.amount), [9, 19])
    await param('filmGrain', 'monochrome').click(); s = await state()
    assert.deepEqual(s.clips.slice(0, 2).map(c => c.effects.find(e => e.type === 'filmGrain').settings.monochrome), [1, 1])
    assert.equal(s.history, 2)
    await seed({ 'visual-b': { effects: [fx('replacement-b-0', 'glslFilmGrain', { amount: 20 }), ...duplicatePatches['visual-b'].effects.slice(1)] } })
    const staleBefore = await state()
    const staleGroup = await request({ clipIds: ['visual-a', 'visual-b'], action: 'update', group: oldGroups.find(g => g.key === 'glslFilmGrain:0'), settings: { amount: 50 } })
    assert.equal(staleGroup.ok, false); assert.deepEqual(await state(), staleBefore)
    await seed({ 'visual-b': { effects: duplicatePatches['visual-b'].effects.slice(1) } })
    assert.equal(await panel.locator('[data-effect-type="glslFilmGrain"]').count(), 0, 'unequal occurrence counts are excluded rather than guessed')
    assert.equal(await panel.locator('[data-effect-type="filmGrain"]').count(), 1)
    await select(['visual-a'])
    const staleSelection = await request({ clipIds: ['visual-a', 'visual-b'], action: 'remove', group: oldGroups[0] })
    assert.equal(staleSelection.ok, false)
    assert.equal(duplicateOriginal[0].effects[0].settings.amount, 10)
    console.log('PASS: duplicate occurrences, CPU/GPU separation, mixed toggles, unequal-count omission and stale group/selection guards')

    await reset(); await seed({
      'visual-a': { ...pairs['visual-a'], startTime: 20, cacheStatus: 'cached', cacheUrl: 'synthetic-cache-a.mp4', cacheKind: 'full', cacheSignature: 'keep-signature-a' },
      'visual-b': { ...pairs['visual-b'], startTime: 20, cacheStatus: 'cached', cacheUrl: 'synthetic-cache-b.mp4', cacheKind: 'full', cacheSignature: 'keep-signature-b' },
    })
    const cacheOriginal = (await state()).clips
    await range(param('glslFilmGrain', 'amount'), 11); s = await state()
    assert.deepEqual(s.clips.slice(0, 2).map(c => c.cacheStatus), ['invalid', 'invalid'])
    for (let i = 0; i < 2; i++) for (const key of ['cacheUrl', 'cacheKind', 'cacheSignature']) assert.equal(s.clips[i][key], cacheOriginal[i][key])
    await undo(); assert.deepEqual((await state()).clips, cacheOriginal)
    await redo()
    const roundTrip = await page.evaluate(() => {
      const store = window.multiClipInspectorTest.timeline, data = JSON.parse(JSON.stringify(store.getState().getProjectData()))
      const summarize = clips => clips.map(c => ({ id: c.id, effects: c.effects || [], keyframes: c.keyframes, bypass: c.bypass }))
      const before = summarize(data.clips)
      store.getState().loadFromProject(data, [], 30)
      return { before, after: summarize(store.getState().getProjectData().clips) }
    })
    assert.deepEqual(roundTrip.after, roundTrip.before)
    console.log('PASS: cache invalidation/undo and portable project effect/ID/keyframe round-trip')

    await reset(); await seed({
      'visual-a': { effects: [fx('last-a', 'gaussianBlur', { amount: 2 })], startTime: 20, cacheStatus: 'cached', cacheUrl: 'synthetic-a.mp4' },
      'visual-b': { effects: [fx('last-b', 'gaussianBlur', { amount: 3 })], startTime: 20, cacheStatus: 'cached', cacheUrl: 'synthetic-b.mp4' },
    })
    await action('gaussianBlur', 'remove').click(); s = await state()
    assert.deepEqual(s.clips.slice(0, 2).map(c => [c.effects.length, c.cacheStatus, c.cacheUrl]), [[0, 'none', null], [0, 'none', null]])
    assert.equal(s.history, 1)
    await undo(); assert.deepEqual((await state()).clips.slice(0, 2).map(c => c.cacheStatus), ['cached', 'cached'])

    await reset(); await seed({
      'visual-a': { ...pairs['visual-a'], adjustments: { brightness: 7, blur: 2 }, bypass: { effects: false, color: true }, transform: { positionX: -180, motionBlurEnabled: true, motionBlurSamples: 8 } },
      'visual-b': { ...pairs['visual-b'], adjustments: { brightness: 17, blur: 4 }, bypass: { effects: true, mask: true }, transform: { positionX: 180, motionBlurEnabled: false, motionBlurSamples: 16 } },
    })
    const blur = panel.locator('input[data-inspector-property="effects.blur"]')
    const auxiliaryOriginal = (await state()).clips
    assert.equal(await blur.getAttribute('data-mixed'), 'true')
    assert.equal(await panel.getByTestId('batch-motion-blur-unavailable').isVisible(), true)
    assert.equal(await panel.getByRole('button', { name: 'Render Cache', exact: true }).count(), 0)
    await range(blur, 2.5); s = await state()
    assert.equal(s.history, 1)
    assert.deepEqual(s.clips.slice(0, 2).map(c => c.adjustments), [{ brightness: 7, blur: 2.5 }, { brightness: 17, blur: 2.5 }])
    for (let i = 0; i < 2; i++) {
      assert.deepEqual(s.clips[i].effects, auxiliaryOriginal[i].effects)
      assert.deepEqual(s.clips[i].transform, auxiliaryOriginal[i].transform)
    }
    const bypass = panel.getByRole('button', { name: 'Bypass effects', exact: true })
    assert.equal(await bypass.getAttribute('aria-pressed'), 'mixed')
    await bypass.click(); s = await state()
    assert.deepEqual(s.clips.slice(0, 2).map(c => c.bypass.effects), [true, true]); assert.equal(s.history, 2)
    assert.equal(s.clips[0].bypass.color, true); assert.equal(s.clips[1].bypass.mask, true)
    await undo(); await undo(); assert.deepEqual((await state()).clips, auxiliaryOriginal)
    await seed({ 'visual-b': { keyframes: { blur: [{ time: 0, value: 4 }] } } })
    assert.equal(await blur.isDisabled(), true)
    console.log('PASS: last-effect cache clearing, shared blur/bypass, blur animation protection and guarded single-only controls')

    for (const type of ['video', 'image', 'text', 'shape', 'adjustment']) {
      await reset(); await seed({ 'visual-a': { type }, 'visual-b': { type } }); await effectsTab()
      await add('gaussianBlur'); await range(param('gaussianBlur', 'amount'), 8.5)
      s = await state()
      assert.deepEqual(s.clips.slice(0, 2).map(c => c.effects[0].settings.amount), [8.5, 8.5], `${type} Effects tab routes shared controls`)
      assert.equal(s.history, 2)
    }
    await reset(); await select(['visual-a']); await effectsTab(single)
    await add('gaussianBlur', single); await range(param('gaussianBlur', 'amount', 0, single), 9)
    s = await state(); assert.equal(s.clips[0].effects[0].settings.amount, 9); assert.equal(s.clips[1].effects.length, 0)
    assert.equal(await single.locator('[data-effect-keyframe="toggle"]').first().isEnabled(), true)
    await reset(); await seed({ 'visual-a': { linkGroupId: 'pair' }, 'audio-a': { linkGroupId: 'pair' } })
    await select(['visual-a', 'audio-a']); await effectsTab(single)
    await add('gaussianBlur', single); s = await state()
    assert.equal(s.clips[0].effects[0].type, 'gaussianBlur'); assert.equal(s.clips[2].effects.length, 0)
    console.log('PASS: all visual Inspector variants, single-clip effects and linked video/audio pair regression')

    if (!native) {
      for (const eventName of ['pointercancel', 'lostpointercapture', 'blur']) {
        await reset(); await seed(pairs)
        const target = param('glslFilmGrain', 'amount')
        await target.focus(); await page.keyboard.down('ArrowUp')
        assert.equal((await state()).history, 1)
        if (eventName === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')))
        else await target.dispatchEvent(eventName, { pointerId: 1, pointerType: 'mouse', isPrimary: true })
        await page.keyboard.down('ArrowUp')
        assert.equal((await state()).history, 2, `${eventName} closes the previous effect adjustment gesture`)
        await page.keyboard.up('ArrowUp'); await target.blur()
        await undo()
        assert.deepEqual((await state()).clips.slice(0, 2).map(c => c.effects.find(e => e.type === 'glslFilmGrain').settings.amount), [11, 11])
      }
      console.log('PASS: pointer cancellation, lost capture and window blur separate effect edit gestures')
    }

    await reset(); await seed({ 'visual-a': { effects: [fx('chroma-a', 'chromaticAberration', { amount: 0, angle: 0 })] }, 'visual-b': { effects: [fx('chroma-b', 'chromaticAberration', { amount: 0, angle: 0 })] } })
    await page.waitForFunction(() => {
      const c = document.querySelector('canvas[data-preview-popout-source]')
      return c?.getContext('2d')?.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 !== 3 && v > 20)
    })
    const canvas = page.locator('canvas[data-preview-popout-source]')
    const before = await canvas.evaluate(el => el.toDataURL())
    await range(param('chromaticAberration', 'amount'), 1)
    await page.waitForFunction(before => document.querySelector('canvas[data-preview-popout-source]').toDataURL() !== before, before)
    assert.equal((await state()).playing, false)
    await undo()
    await page.waitForFunction(before => document.querySelector('canvas[data-preview-popout-source]').toDataURL() === before, before)
    await seed(pairs)
    await page.getByTestId('inspector-container').evaluate(el => { el.style.width = '304px' })
    const width = await panel.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }))
    assert.ok(width.scroll <= width.client + 1, 'effect controls fit the normal Inspector width')
    // Hidden Electron windows can stall screenshot capture on Linux. The same
    // normal-width UI is captured in Chromium; native mode verifies behavior.
    if (process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT })
    assert.deepEqual(errors, [])
    console.log('PASS: paused effects preview and undo repaint, normal-width Inspector layout, no renderer exceptions')
    }

    await page.goto((process.env.VELORN_TEST_URL || 'http://127.0.0.1:5184') + '/tests/fixtures/multi-clip-inspector.html?effectsLibrary=1')
    await panel.waitFor(); await select(['visual-a', 'visual-b', 'audio-a', 'locked'])
    const library = page.getByTestId('effects-library')
    await library.getByRole('button', { name: 'Effects', exact: true }).click()
    await library.getByRole('button', { name: /Film & Color/ }).click()
    const libraryOriginal = (await state()).clips
    await library.getByText('Film Grain', { exact: true }).click(); s = await state()
    assert.equal(s.history, 1)
    assert.deepEqual(s.clips.slice(0, 2).map(c => c.effects[0].type), ['glslFilmGrain', 'glslFilmGrain'])
    assert.notEqual(s.clips[0].effects[0].id, s.clips[1].effects[0].id)
    assert.deepEqual(s.clips.slice(2), libraryOriginal.slice(2))
    await undo(); assert.deepEqual((await state()).clips, libraryOriginal)
    await library.getByRole('button', { name: 'Fine 5245', exact: true }).click(); s = await state()
    assert.deepEqual(s.clips.slice(0, 2).map(c => c.effects[0].settings.amount), [22, 22])
    assert.deepEqual(s.clips.slice(2), libraryOriginal.slice(2))
    assert.equal(s.history, 1)
    assert.deepEqual(errors, [])
    console.log('PASS: separate Effects library defaults/presets use atomic multi-add with locked/audio exclusions')

    const registryChecks = await page.evaluate(async () => {
      const { EFFECT_TYPES } = await import('/src/utils/effects.js')
      const t = window.multiClipInspectorTest, failures = []
      let count = 0
      for (const definition of EFFECT_TYPES) {
        for (const candidate of [{ id: 'defaults', settings: definition.defaults }, ...(definition.presets || [])]) {
          t.reset()
          const settings = { ...definition.defaults, ...candidate.settings }
          const result = t.timeline.getState().applyMultiClipEffectsEdit({ clipIds: ['visual-a', 'visual-b'], action: 'add', type: definition.id, settings })
          count++
          if (!result.ok) { failures.push(`${definition.id}/${candidate.id}: ${result.error}`); continue }
          const s = t.timeline.getState()
          if (s.history.length !== 1 || s.clips[0].effects[0].id === s.clips[1].effects[0].id) failures.push(`${definition.id}/${candidate.id}: history or IDs`)
          for (const clip of s.clips.slice(0, 2)) for (const param of definition.params) {
            const value = clip.effects[0].settings[param.key]
            if (value !== settings[param.key]) failures.push(`${definition.id}/${candidate.id}/${param.key}: ${value} != ${settings[param.key]}`)
          }
        }
      }
      t.reset()
      return { count, failures }
    })
    assert.deepEqual(registryChecks.failures, [])
    assert.ok(registryChecks.count > 50)
    assert.deepEqual(errors, [])
    console.log(`PASS: ${registryChecks.count} real effect-registry defaults/presets accepted with correct parameters, unique IDs and atomic history`)
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
