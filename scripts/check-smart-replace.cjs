// Isolated real Timeline/preview/export-compositor checks. Encoded synthetic
// MP4s remain in memory. Never opens a user project or production Electron main.
// Native waveform and export destinations are explicit fixture-only stand-ins;
// these checks do not verify production IPC, packaging, sandboxing or encoding.
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const byId = (state, id = 'replace-target') => state.clips.find(clip => clip.id === id)
const near = (actual, expected, label, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${label}: expected ${expected}, got ${actual}`)
const preserved = ['id', 'name', 'type', 'trackId', 'startTime', 'duration', 'speed', 'reverse', 'sourceTimeScale', 'timelineFps',
  'frameSampling', 'transform', 'adjustments', 'effects', 'keyframes', 'shapeMask', 'trackingMetadata', 'gainDb', 'fadeIn', 'fadeOut',
  'audioEq', 'volumeEnvelope', 'linkGroupId', 'customMetadata']
const sameEdit = (actual, expected) => { for (const key of preserved) assert.deepEqual(actual[key], expected[key], `preserve ${key}`) }
const documentSnapshot = state => ({ clips: state.clips, tracks: state.tracks, markers: state.markers, transitions: state.transitions, inPoint: state.inPoint, outPoint: state.outPoint })
function encode(color, duration, fps) {
  const result = spawnSync(process.env.FFMPEG_PATH || require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=${color}:s=96x54:r=${fps}:d=${duration}`, '-an', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-crf', '12', '-g', '1', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'],
  { timeout: 30000, maxBuffer: 8 * 1024 * 1024 })
  assert.equal(result.status, 0, String(result.stderr)); assert.ok(result.stdout.length > 500)
  return { base64: result.stdout.toString('base64'), fps }
}

async function main() {
  const media = { red: encode('red', 8, 24), blue: encode('blue', 10, 30), short: encode('blue', 2, 24) }
  const native = process.env.VELORN_TEST_ELECTRON === '1'
  const browser = native
    ? await _electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '../tests/fixtures/inspector-electron.cjs')] })
    : await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true })
  try {
    const page = native ? await browser.firstWindow() : await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    page.setDefaultTimeout(15000)
    const errors = []
    page.on('pageerror', error => { errors.push(error.message); console.error('Renderer:', error.message) })
    await page.goto((process.env.VELORN_TEST_URL || 'http://127.0.0.1:5184') + '/tests/fixtures/smart-replace.html' + (native ? '?nativeWaveformStub=1' : ''))
    await page.waitForFunction(() => Boolean(window.smartReplaceTest?.timeline.getState().previewSmartReplace), null, { polling: 100 })
    const metadata = await page.evaluate(media => window.smartReplaceTest.initializeMedia(media), media)
    for (const [id, duration] of [['red', 8], ['blue', 10], ['short', 2]]) near(metadata.find(asset => asset.id === id).duration, duration, `${id} real decoded duration`, 0.05)
    const settle = () => page.waitForTimeout(100)
    const dialog = page.getByTestId('smart-replace-dialog')
    const apply = page.getByTestId('smart-replace-apply')
    const status = page.getByTestId('smart-replace-status')
    const candidate = id => page.locator(`[data-testid="smart-replace-asset"][data-asset-id="${id}"]`)
    const state = () => page.evaluate(() => {
      const t = window.smartReplaceTest, s = t.timeline.getState()
      return JSON.parse(JSON.stringify({ clips: s.clips, tracks: s.tracks, transitions: s.transitions, markers: s.markers,
        inPoint: s.inPoint, outPoint: s.outPoint, selectedClipIds: s.selectedClipIds, history: s.history, historyIndex: s.historyIndex,
        clipCounter: s.clipCounter, duration: s.duration, playhead: s.playheadPosition, playing: s.isPlaying,
        assets: t.assets.getState().assets, dirty: t.isProjectDirty() }))
    })
    const seed = async ({ patches = {}, assetPatches = {}, ...options } = {}) => {
      if (await dialog.count()) await page.getByTestId('smart-replace-cancel').click()
      await page.keyboard.press('Escape'); await page.mouse.up()
      await page.evaluate(({ patches, assetPatches, options }) => {
        const t = window.smartReplaceTest
        t.reset(options)
        t.timeline.setState(s => ({ clips: s.clips.map(c => ({ ...c, ...(patches[c.id] || {}) })) }))
        t.assets.setState(s => ({ assets: s.assets.map(a => ({ ...a, ...(assetPatches[a.id] || {}) })) }))
        t.markProjectClean()
      }, { patches, assetPatches, options })
      await settle()
    }
    const menu = async (id = 'replace-target') => {
      const element = page.locator(`[data-clip-id="${id}"]`).first()
      await element.scrollIntoViewIfNeeded()
      await element.click({ button: 'right', position: { x: 30, y: 15 } })
      await page.getByTestId('smart-replace-open').waitFor()
      return page.getByTestId('smart-replace-open')
    }
    const open = async id => { await (await menu(id)).click(); await dialog.waitFor(); await settle() }
    const choose = async id => { await candidate(id).click(); await settle() }
    const close = async () => { await page.getByTestId('smart-replace-cancel').click(); await dialog.waitFor({ state: 'hidden' }) }
    const undo = () => page.evaluate(() => window.smartReplaceTest.timeline.getState().undo())
    const redo = () => page.evaluate(() => window.smartReplaceTest.timeline.getState().redo())
    const pixel = async color => {
      try {
        await page.waitForFunction(color => {
          const snapshot = window.smartReplaceTest.getPreviewFrameSnapshot(), canvas = snapshot?.canvas
          if (!canvas?.width) return false
          const rgb = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
          return color === 'red' ? rgb[0] > 80 && rgb[0] > rgb[2] * 2 : rgb[2] > 80 && rgb[2] > rgb[0] * 2
        }, color, { polling: 100 })
      } catch (error) {
        console.error('Preview diagnostic', await page.evaluate(() => {
          const frame = window.smartReplaceTest.getPreviewFrameSnapshot(), canvas = frame?.canvas
          return { time: frame?.time, serial: frame?.serial, pixel: canvas && [...canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data] }
        }))
        throw error
      }
      return page.evaluate(() => {
        const { canvas, time, serial } = window.smartReplaceTest.getPreviewFrameSnapshot()
        return { time, serial, color: [...canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data] }
      })
    }
    const replaceApi = (assetId = 'blue', sourceInSeconds, clipId = 'replace-target') => page.evaluate(({ assetId, sourceInSeconds, clipId }) => {
      const t = window.smartReplaceTest, s = t.timeline.getState()
      const request = { clipId, asset: t.assets.getState().assets.find(a => a.id === assetId), ...(sourceInSeconds === undefined ? {} : { sourceInSeconds }) }
      const preview = s.previewSmartReplace(request)
      return { preview: { ...preview, token: undefined }, result: preview.ok ? s.applySmartReplace(request, preview.token) : null }
    }, { assetId, sourceInSeconds, clipId })

    // 1. Opening, filtering, searching and cancelling are read-only.
    await seed(); await pixel('red')
    const initial = await state(); await open()
    assert.deepEqual(await state(), initial)
    assert.equal(await page.getByTestId('smart-replace-source-in').inputValue(), '1')
    assert.equal(await candidate('image-blue').count(), 0); assert.equal(await candidate('audio-b').count(), 0)
    await page.getByTestId('smart-replace-search').fill('Blue replacement')
    assert.equal(await candidate('blue').count(), 1); assert.equal(await candidate('red').count(), 0)
    await choose('blue'); assert.equal(await apply.isDisabled(), false)
    assert.match(await page.getByTestId('smart-replace-summary').innerText(), /linked|unchanged/i)
    assert.deepEqual(await state(), initial, 'candidate preview does not change media/history/counters/dirty state')
    await close(); assert.deepEqual(await state(), initial)
    console.log('PASS 1: real context-menu picker filters same-kind media; search, preview and Cancel are read-only')

    // 2. Exactly one instance changes; paused compositor repaints in place.
    await open(); await choose('blue')
    const redFrame = await pixel('red')
    await apply.click(); await dialog.waitFor({ state: 'hidden' })
    const replaced = await state(), target = byId(replaced)
    sameEdit(target, byId(initial)); assert.equal(target.assetId, 'blue'); assert.equal(target.url, replaced.assets.find(a => a.id === 'blue').url)
    near(target.trimStart, 1, 'default source In'); near(target.trimEnd, 4, 'preserved source span'); near(target.sourceDuration, 10, 'new source metadata')
    near(target.sourceFps, 30, 'replacement FPS'); near(target.sourceTimeScale, 1, 'mixed FPS keeps old authored scale')
    for (const other of initial.clips.filter(c => c.id !== target.id)) assert.deepEqual(byId(replaced, other.id), other)
    for (const key of ['markers', 'transitions', 'inPoint', 'outPoint', 'selectedClipIds', 'playhead', 'assets', 'duration', 'clipCounter']) assert.deepEqual(replaced[key], initial[key], `unchanged ${key}`)
    assert.equal(replaced.history.length, 1); assert.equal(replaced.playing, false)
    const blueFrame = await pixel('blue'); assert.ok(blueFrame.serial > redFrame.serial); near(blueFrame.time, redFrame.time, 'paused frame time stays fixed')
    await undo(); await pixel('red'); assert.deepEqual(documentSnapshot(await state()), documentSnapshot(initial))
    await redo(); await pixel('blue'); assert.deepEqual(documentSnapshot(await state()), documentSnapshot(replaced))
    console.log('PASS 2: only chosen clip source changes, all authored edits/partners remain, paused pixels repaint and one Undo/Redo restores both sources')

    // 3. Real export compositor output uses the new source and retained
    // animated transform, with in-memory destinations instead of native IO.
    const blueExport = await page.evaluate(() => window.smartReplaceTest.exportFrameInMemory(2.5))
    assert.equal(blueExport.frames.length, 1)
    assert.ok(blueExport.frames[0].center[2] > blueExport.frames[0].center[0] * 2)
    assert.ok(blueExport.reads.some(path => path.endsWith('/media/blue.mp4')))
    assert.ok(blueExport.reads.every(path => !path.endsWith('/media/red.mp4')))
    const later = await page.evaluate(() => window.smartReplaceTest.exportFrameInMemory(4.5))
    assert.ok(later.frames[0].centroidX > blueExport.frames[0].centroidX + 5, 'retained position keyframes move actual exported pixels')
    await undo(); await pixel('red')
    const redExport = await page.evaluate(() => window.smartReplaceTest.exportFrameInMemory(2.5))
    assert.ok(redExport.frames[0].center[0] > redExport.frames[0].center[2] * 2)
    near(redExport.frames[0].centroidX, blueExport.frames[0].centroidX, 'same edit placement for old/new export source', 1)
    await redo(); await pixel('blue')
    console.log('PASS 3: actual in-memory export compositor renders replacement pixels, resolves new source identity and retains animated transform')

    // 4. Default/current source no-op and malformed/short/unavailable
    // candidates never shorten, stretch, freeze, or create history.
    await seed(); const invalidBefore = await state(); await open()
    for (const id of ['short', 'unknown', 'offline']) {
      await choose(id); assert.equal(await apply.isDisabled(), true)
      assert.match(await status.innerText(), /source|duration|unavailable|load|relink|seconds/i)
      assert.deepEqual(await state(), invalidBefore)
    }
    await choose('red'); assert.equal(await apply.isDisabled(), true); assert.match(await status.innerText(), /nothing|already/i)
    await choose('blue')
    for (const value of ['-1', '8', '']) {
      await page.getByTestId('smart-replace-source-in').fill(value); await settle()
      assert.equal(await apply.isDisabled(), true); assert.deepEqual(await state(), invalidBefore)
    }
    await close()
    for (const id of ['image-blue', 'audio-b', 'short', 'unknown', 'offline']) {
      const result = await replaceApi(id)
      assert.equal(result.preview.ok, false); assert.deepEqual(await state(), invalidBefore)
    }
    const noop = await replaceApi('red'); assert.equal(noop.preview.changed, false); assert.equal(noop.result.changed, false)
    assert.deepEqual(await state(), invalidBefore)
    await seed({ assetPatches: { blue: { duration: 10, fps: 30, settings: { duration: 2, fps: 120, width: 96, height: 54 } } } })
    await open(); await choose('blue')
    assert.match(await candidate('blue').innerText(), /10 s/)
    assert.equal(await apply.isDisabled(), false); await apply.click(); await dialog.waitFor({ state: 'hidden' })
    near(byId(await state()).sourceDuration, 10, 'measured duration wins over generation-request duration')
    near(byId(await state()).sourceFps, 30, 'measured FPS wins over generation-request FPS')
    await seed({ assetPatches: { blue: { duration: 2, settings: { duration: 10, fps: 30 } } } })
    assert.equal((await replaceApi('blue')).preview.ok, false, 'short measured media cannot borrow longer requested duration')
    console.log('PASS 4: same-source no-op, wrong kind, short/unknown/offline media and invalid Source In refuse without history or retiming')

    // 5. Explicit source offset changes only source bounds, including reverse
    // and variable-speed edits; mask/tracking settings are retained/warned.
    await seed({ patches: { 'replace-target': { shapeMask: { shape: 'ellipse', centerX: 50, centerY: 50, width: 90, height: 90, feather: 0 },
      trackingMetadata: { sourceAssetId: 'red', points: [{ time: 0, x: 10, y: 20 }] } } } })
    const maskBefore = await state(); await open(); await choose('blue')
    assert.match(await page.getByTestId('smart-replace-summary').innerText(), /mask|tracking|alignment/i)
    await page.getByTestId('smart-replace-from-start').click(); await settle(); assert.equal(await page.getByTestId('smart-replace-source-in').inputValue(), '0')
    await apply.click(); await dialog.waitFor({ state: 'hidden' })
    const offset = byId(await state()); sameEdit(offset, byId(maskBefore)); near(offset.trimStart, 0, 'explicit beginning'); near(offset.trimEnd, 3, 'span shifted equally')
    for (const patch of [{ speed: 2, duration: 1.5 }, { reverse: true },
      { keyframes: { speed: [{ time: 0, value: 0.5 }, { time: 3, value: 1.5 }], positionX: [{ time: 0, value: 0 }, { time: 3, value: 180 }] } }]) {
      await seed({ patches: { 'replace-target': patch } }); const before = await state()
      const result = await replaceApi('blue', 2); assert.equal(result.preview.ok, true); assert.equal(result.result.ok, true)
      sameEdit(byId(await state()), byId(before)); near(byId(await state()).trimStart, 2, 'offset source In'); near(byId(await state()).trimEnd, 5, 'offset source Out')
    }
    console.log('PASS 5: explicit Source In preserves timing/speed/reverse/ramp, while masks/tracking survive with review warnings')

    // 6. Protected targets/batch selection are unavailable. A valid linked
    // pair remains a context-target-only replacement.
    await seed({ selectedClipIds: ['replace-target', 'same-source-instance'] })
    assert.equal(await (await menu()).isDisabled(), true); await page.keyboard.press('Escape')
    await seed()
    await page.evaluate(() => window.smartReplaceTest.timeline.setState(s => ({ tracks: s.tracks.map(track => track.id === 'video-1' ? { ...track, locked: true } : track) })))
    await settle()
    assert.equal(await page.evaluate(() => {
      const t = window.smartReplaceTest
      return t.getSmartReplaceEligibility(t.timeline.getState(), 'replace-target').ok
    }), false, 'locked-track context command is ineligible (locked tracks also block clip pointer events)')
    const lockedBefore = await state(), lockedResult = await replaceApi('blue')
    assert.equal(lockedResult.preview.ok, false); assert.deepEqual(await state(), lockedBefore)
    await seed({ selectedClipIds: ['replace-target', 'linked-audio'] }); const linkedBefore = await state()
    await open(); await choose('blue'); await apply.click(); await dialog.waitFor({ state: 'hidden' })
    assert.deepEqual(byId(await state(), 'linked-audio'), byId(linkedBefore, 'linked-audio'))
    assert.equal(byId(await state()).assetId, 'blue')
    await seed({ patches: { 'replace-target': { syncLocked: true } } }); const syncBefore = await state()
    assert.equal((await replaceApi('blue')).preview.ok, false); assert.deepEqual(await state(), syncBefore)
    console.log('PASS 6: batch/locked/sync-locked targets refuse; linked selection changes only the explicitly chosen instance')

    // 7. Modal keyboard/focus guards and every cancellation path are inert.
    await seed(); const keyboardBefore = await state(); await open(); await choose('blue')
    await page.getByTestId('smart-replace-search').focus()
    for (const key of ['Delete', 'j', 'k', 'l', 'Control+z', 'Control+c', 'Control+v']) await page.keyboard.press(key)
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press('Tab')
      assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true)
    }
    assert.deepEqual(await state(), keyboardBefore)
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); assert.deepEqual(await state(), keyboardBefore)
    await open(); await choose('blue'); await page.getByTestId('smart-replace-backdrop').click({ position: { x: 2, y: 2 } })
    await dialog.waitFor({ state: 'hidden' }); assert.deepEqual(await state(), keyboardBefore)
    console.log('PASS 7: modal focus trapping/keyboard shielding, Escape and backdrop cancellation preserve the timeline')

    // 8. Immutable and in-place metadata updates cannot apply an older
    // reviewed candidate. Timeline/selection changes visibly invalidate it.
    for (const race of ['asset-record', 'asset-in-place', 'asset-removed', 'timeline', 'selection']) {
      await seed(); await open(); await choose('blue')
      await page.evaluate(race => {
        const t = window.smartReplaceTest
        if (race === 'asset-record') t.assets.setState(s => ({ assets: s.assets.map(a => a.id === 'blue' ? { ...a, duration: 1, settings: { ...a.settings, duration: 1 } } : a) }))
        if (race === 'asset-in-place') t.assets.setState(s => {
          const a = s.assets.find(a => a.id === 'blue'); a.duration = 1; a.settings = { ...a.settings, duration: 1 }
          return { assets: [...s.assets] }
        })
        if (race === 'asset-removed') t.assets.setState(s => ({ assets: s.assets.filter(a => a.id !== 'blue') }))
        if (race === 'timeline') t.timeline.setState(s => ({ clips: s.clips.map(c => c.id === 'replace-target' ? { ...c, name: 'Externally edited' } : c) }))
        if (race === 'selection') t.timeline.setState({ selectedClipIds: ['same-source-instance'] })
        t.markProjectClean()
      }, race)
      await settle(); const afterRace = await state()
      if (!(await apply.isDisabled())) await apply.click()
      assert.equal(await dialog.count(), 1); assert.match(await status.innerText(), /changed|review|choose|reopen|seconds|source/i)
      assert.deepEqual(await state(), afterRace, `${race} cannot commit an older preview`)
      await close()
    }
    console.log('PASS 8: candidate metadata/identity/removal races and changed timeline/selection cannot apply stale reviewed sources')

    // 9. Keep tokens inside the renderer: serializing them would reject for
    // identity alone and would not actually test replay/request/history guards.
    for (const mutation of ['request', 'asset', 'history', 'playing']) {
      await seed()
      await page.evaluate(() => {
        const t = window.smartReplaceTest, request = { clipId: 'replace-target', asset: structuredClone(t.assets.getState().assets.find(a => a.id === 'blue')), sourceInSeconds: 1 }
        t.pending = { request, preview: t.timeline.getState().previewSmartReplace(request) }
      })
      const beforeMutation = await state()
      await page.evaluate(mutation => {
        const t = window.smartReplaceTest
        if (mutation === 'request') t.pending.request.sourceInSeconds = 2
        if (mutation === 'asset') t.pending.request.asset.settings.duration = 0.5
        if (mutation === 'history') t.timeline.getState().saveToHistory()
        if (mutation === 'playing') t.timeline.setState({ isPlaying: true })
        t.markProjectClean()
      }, mutation)
      const afterMutation = await state()
      const result = await page.evaluate(() => {
        const t = window.smartReplaceTest
        return t.timeline.getState().applySmartReplace(t.pending.request, t.pending.preview.token)
      })
      assert.equal(result.ok, false); assert.deepEqual(await state(), afterMutation)
      if (['request', 'asset'].includes(mutation)) assert.deepEqual(afterMutation, beforeMutation)
    }
    await seed()
    const receipts = await page.evaluate(() => {
      const t = window.smartReplaceTest, s = t.timeline.getState(), request = { clipId: 'replace-target', asset: t.assets.getState().assets.find(a => a.id === 'blue') }
      const preview = s.previewSmartReplace(request); preview.summary.linkedCompanionsUnchanged.push('not-a-real-clip')
      const first = s.applySmartReplace(request, preview.token), replay = t.timeline.getState().applySmartReplace(request, preview.token)
      return { first, replay }
    })
    assert.equal(receipts.first.ok, true); assert.equal(receipts.replay.ok, false)
    assert.deepEqual(receipts.first.summary.linkedCompanionsUnchanged, ['linked-audio'])
    assert.equal((await state()).history.length, 1)
    console.log('PASS 9: in-memory tokens reject changed requests/assets/history/playback and replay; public summary mutation cannot alter the committed plan')

    // 10. Image/audio replacements use the same instance-safe persistence
    // path; imported audio settings remain exact and sources stay portable.
    for (const [kind, source, replacement] of [['image', 'image-red', 'image-blue'], ['audio', 'audio-a', 'audio-b'], ['legacy-audio', 'audio-a', 'audio-b']]) {
      await seed()
      await page.evaluate(({ kind, source }) => {
        const t = window.smartReplaceTest, asset = t.assets.getState().assets.find(a => a.id === source)
        const audio = kind === 'audio' || kind === 'legacy-audio'
        t.timeline.setState(s => ({ clips: s.clips.map(c => c.id === 'replace-target' ? { ...c, type: kind === 'legacy-audio' ? 'video' : kind,
          trackId: audio ? 'audio-1' : 'video-1', assetId: asset.id, url: asset.url, sourceDuration: kind === 'image' ? 3 : 10,
          ...(kind === 'image' ? { trimStart: 0, trimEnd: 3 } : {}) }
          : audio && c.id === 'linked-audio' ? { ...c, startTime: 8 } : c), activeTrackId: audio ? 'audio-1' : 'video-1' }))
        t.markProjectClean()
      }, { kind, source })
      await settle(); const before = await state(); await open(); await choose(replacement)
      assert.equal(await page.getByTestId('smart-replace-source-in').count(), kind === 'image' ? 0 : 1)
      await apply.click(); await dialog.waitFor({ state: 'hidden' })
      const after = await state(); sameEdit(byId(after), { ...byId(before), ...(kind === 'legacy-audio' ? { type: 'audio' } : {}) }); assert.equal(byId(after).assetId, replacement)
      for (const key of ['audioEq', 'volumeEnvelope', 'gainDb', 'fadeIn', 'fadeOut']) assert.deepEqual(byId(after)[key], byId(before)[key])
      const loaded = await page.evaluate(() => {
        const t = window.smartReplaceTest, document = JSON.parse(JSON.stringify(t.timeline.getState().getProjectData()))
        t.timeline.getState().loadFromProject(document, t.assets.getState().assets, 24)
        return t.timeline.getState().clips.find(c => c.id === 'replace-target')
      })
      assert.equal(loaded.assetId, replacement)
      for (const key of ['audioEq', 'volumeEnvelope', 'transform', 'adjustments', 'effects', 'keyframes', 'startTime', 'duration', 'trimStart', 'trimEnd']) assert.deepEqual(loaded[key], byId(after)[key], `save/load ${kind} ${key}`)
    }
    if (native) assert.ok(await page.evaluate(() => window.smartReplaceTest.getNativeWaveformCalls()) > 0)
    console.log('PASS 10: still/audio replacement retains exact edit and sound settings through real modal and JSON save/load')

    // 11. Exercise VideoLayerRenderer's real disk-cache hook and persistent
    // map. Only the asynchronous native file result is represented in memory.
    await seed()
    await page.evaluate(() => {
      const t = window.smartReplaceTest, root = '/__smart_replace_cache__'
      t.diskFixture = { previousApi: window.electronAPI, previousHandle: t.project.getState().currentProjectHandle, requests: [] }
      const validate = value => { if (!value.startsWith(`${root}/`)) throw new Error('Unexpected cache fixture path'); return value }
      window.electronAPI = {
        isElectron: true,
        pathJoin: async (...parts) => validate(parts.join('/')),
        exists: async value => !validate(value).endsWith('.meta.json'),
        getFileUrlDirect: async value => new Promise(resolve => t.diskFixture.requests.push({ path: validate(value), resolve })),
      }
      t.project.setState({ currentProjectHandle: root })
      t.timeline.setState(s => ({ clips: s.clips.map(c => c.id === 'replace-target' ? { ...c,
        cacheStatus: 'cached', cachePath: 'cache/held.webm', cacheKind: 'mask', cacheUrl: null, cacheSignature: null } : c) }))
      t.setLegacyVisible(true)
      t.markProjectClean()
    })
    await page.waitForFunction(() => window.smartReplaceTest.diskFixture.requests.length >= 1, null, { polling: 100 })
    const cachedBefore = await state(), cacheReplacement = await replaceApi('blue')
    assert.equal(cacheReplacement.result.ok, true)
    const afterCacheReplace = await state()
    assert.equal(byId(afterCacheReplace).cacheStatus, 'none'); assert.equal(byId(afterCacheReplace).cacheUrl, null)
    await page.evaluate(() => {
      const t = window.smartReplaceTest
      t.diskFixture.requests[0].resolve(t.getAsset('red').url)
    })
    await page.waitForTimeout(300)
    assert.deepEqual(await state(), afterCacheReplace, 'late old-source cache read cannot reattach stale render or dirty history')
    await pixel('blue')
    // Populate the old same-ID cache map, then reuse that ID/path in a new
    // source/session. It must issue a fresh read instead of using the old URL.
    await undo()
    await page.waitForFunction(() => window.smartReplaceTest.diskFixture.requests.length >= 2, null, { polling: 100 })
    await page.evaluate(() => { const t = window.smartReplaceTest; t.diskFixture.requests[1].resolve(t.getAsset('red').url) })
    await page.waitForFunction(() => {
      const t = window.smartReplaceTest
      return t.timeline.getState().clips.find(c => c.id === 'replace-target').cacheUrl === t.getAsset('red').url
    }, null, { polling: 100 })
    const again = await replaceApi('blue'); assert.equal(again.result.ok, true)
    await page.evaluate(() => {
      const t = window.smartReplaceTest
      t.timeline.setState(s => ({ timelineSessionId: s.timelineSessionId + 1,
        clips: s.clips.map(c => c.id === 'replace-target' ? { ...c, cacheStatus: 'cached', cachePath: 'cache/held.webm', cacheKind: 'mask', cacheUrl: null, cacheSignature: null } : c) }))
    })
    await page.waitForFunction(() => window.smartReplaceTest.diskFixture.requests.length >= 3, null, { polling: 100 })
    assert.equal(byId(await state()).cacheUrl, null, 'same ID/path cannot immediately revive prior-source map URL')
    await page.evaluate(() => { const t = window.smartReplaceTest; t.diskFixture.requests[2].resolve(t.getAsset('blue').url) })
    await page.waitForFunction(() => {
      const t = window.smartReplaceTest
      return t.timeline.getState().clips.find(c => c.id === 'replace-target').cacheUrl === t.getAsset('blue').url
    }, null, { polling: 100 })
    assert.equal(byId(await state()).assetId, 'blue')
    assert.equal(byId(cachedBefore).assetId, 'red')
    await page.evaluate(() => {
      const t = window.smartReplaceTest
      t.setLegacyVisible(false)
      window.electronAPI = t.diskFixture.previousApi
      t.project.setState({ currentProjectHandle: t.diskFixture.previousHandle })
    })
    await settle()
    console.log('PASS 11: real VideoLayerRenderer rejects delayed old-source cache reads and reloads same-ID/path disk-map entries for changed source/session')

    await seed(); await open(); await choose('blue')
    for (const width of [600, 350]) {
      await page.setViewportSize({ width, height: 850 }); await settle()
      const geometry = await dialog.evaluate(element => {
        const box = element.getBoundingClientRect()
        return { left: box.left, right: box.right, viewport: innerWidth, scroll: element.scrollWidth, width: element.clientWidth,
          controls: [...element.querySelectorAll('button,input')].map(control => { const r = control.getBoundingClientRect(); return { left: r.left, right: r.right } }) }
      })
      assert.ok(geometry.left >= 0 && geometry.right <= width + 1 && geometry.scroll <= geometry.width + 1)
      for (const control of geometry.controls) assert.ok(control.left >= -1 && control.right <= width + 1)
    }
    if (process.env.VELORN_TEST_SCREENSHOT && !native) await page.screenshot({ path: process.env.VELORN_TEST_SCREENSHOT })
    await close(); assert.deepEqual(errors, [])
    console.log(`PASS: all11 Smart Replace groups, decoded preview/export pixels and narrow modal; no renderer exceptions (${native ? 'isolated Electron; waveform/export/cache IPC stand-ins' : 'headless Chrome; in-memory export/cache destinations'}).`)
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
