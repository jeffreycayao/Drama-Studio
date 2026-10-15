import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { transformSync } from 'esbuild'
import { normalizeTransparentExportSettings } from './alphaMedia.mjs'
import {
  EXPORT_PRESET_LIBRARY_KEY, MAX_CUSTOM_EXPORT_PRESETS,
  validateCustomExportPresetSettings, validateExportPresetName, parseExportPresetLibrary,
  readExportPresetLibrary, updateExportPresetLibrary, matchCustomExportPreset,
} from './exportPresetLibrary.mjs'

function memoryStorage(raw = null) {
  const values = new Map(raw === null ? [] : [[EXPORT_PRESET_LIBRARY_KEY, raw]])
  let writes = 0
  return { values, writes: () => writes,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { writes++; values.set(key, value) },
  }
}
const source = patch => ({ format: 'mp4', ...patch })
const save = (storage, name = 'My delivery', settings = source()) => updateExportPresetLibrary({ type: 'save', name, settings }, storage)
const validEntry = (patch = {}) => ({ id: 'user-export-12345678', name: 'My delivery', settings: source(), ...patch })
const packed = (presets, version = 1) => JSON.stringify({ version, presets })

test('captures only delivery settings without mutating source or retaining paths/project data', () => {
  const input = Object.freeze(source({ filename: 'Project A', range: 'inout', outputPath: '/private/output.mp4',
    projectPath: '/private/project', destination: '/deliveries', projectSettings: { fps: 60 },
    clips: [{ path: '/private/clip.mov' }], width: 999, mediaPath: '/media', renderMode: 'stems', useCachedRenders: true,
    fastSeek: true, customWidth: 1920, fps: 'project' }))
  const result = validateCustomExportPresetSettings(input)
  assert.equal(result.ok, true)
  for (const key of ['filename', 'range', 'outputPath', 'projectPath', 'destination', 'projectSettings', 'clips', 'width', 'mediaPath', 'renderMode', 'useCachedRenders', 'fastSeek']) {
    assert.equal(Object.hasOwn(result.settings, key), false, key)
  }
  assert.equal(result.settings.resolution, 'project')
  assert.equal(result.settings.fps, 'project')
  assert.equal(input.filename, 'Project A')
})

test('allowlist rejects unknown enums, non-finite/unsafe numeric data and incompatible codecs', () => {
  const bad = [{ format: 'unknown' }, { videoCodec: 'h264;touch /tmp/x' }, { audioCodec: 'wav' }, { useHardwareEncoder: 'false' },
    { customWidth: Infinity }, { customHeight: 32769 }, { bitrateKbps: 0 }, { keyframeInterval: -1 },
    { audioSampleRate: 45000 }, { audioChannels: 3 }, { loudnessTarget: -15 }, { crf: 52 },
    { fps: '60;rm' }, { fps: 240 }, { format: 'webm', videoCodec: 'h264' },
    { format: 'prores', videoCodec: 'h264' }, { resolution: '/private/file' }]
  for (const patch of bad) assert.equal(validateCustomExportPresetSettings(source(patch)).ok, false, JSON.stringify(patch))
  for (const invalid of [null, [], {}, 'mp4']) assert.equal(validateCustomExportPresetSettings(invalid).ok, false)
})

test('current UI formats, FPS strings, quality choices and alpha dependencies are supported', () => {
  for (const fps of ['project', 15, '23.976', '24', 25, '30', 60]) assert.equal(validateCustomExportPresetSettings(source({ fps })).ok, true)
  for (const format of ['mp4', 'png-seq', 'gif']) assert.equal(validateCustomExportPresetSettings(source({ format })).ok, true)
  const prores = validateCustomExportPresetSettings(source({ format: 'prores', videoCodec: 'prores', proresProfile: 3,
    transparent: true, useHardwareEncoder: true, postProcessUpscale: 'rtx-4k' })).settings
  assert.equal(prores.proresProfile, '4')
  assert.equal(prores.useHardwareEncoder, false)
  assert.equal(prores.postProcessUpscale, 'none')
  assert.equal(validateCustomExportPresetSettings(source({ transparent: true })).settings.transparent, false)
  assert.equal(validateCustomExportPresetSettings(source({ format: 'webm', videoCodec: 'vp9', audioCodec: 'opus', crf: 63 })).ok, true)
  const audio = validateCustomExportPresetSettings(source({ format: 'audio', audioCodec: 'wav', includeAudio: false })).settings
  assert.equal(audio.includeAudio, true)
})

test('names are normalized, bounded, and case-insensitively unique without implicit overwrite', () => {
  assert.deepEqual(validateExportPresetName('  Client   delivery  '), { ok: true, name: 'Client delivery' })
  const presets = [{ id: 'one', name: 'Client delivery' }]
  for (const name of ['', ' ', 'x'.repeat(65), 'Bad\nname', '\u202eHidden', null]) assert.equal(validateExportPresetName(name).ok, false)
  assert.equal(validateExportPresetName('CLIENT   DELIVERY', presets).ok, false)
  assert.equal(validateExportPresetName('Client delivery', presets, 'one').ok, true)
  assert.equal(validateExportPresetName('Ｃｌｉｅｎｔ delivery', presets).ok, false)
})

test('library round-trips across project consumers and does not change their authored settings', () => {
  const storage = memoryStorage()
  const a = { filename: 'A', range: 'inout', projectSettings: { width: 1080, height: 1920 }, ...source({ crf: 16 }) }
  const result = save(storage, 'Client', a)
  assert.equal(result.ok, true)
  const b = { filename: 'B', range: 'full', projectSettings: { width: 3840, height: 2160 }, sourcePath: '/project-b' }
  const entry = readExportPresetLibrary(storage).presets[0]
  const applied = { ...b, ...entry.settings }
  for (const key of Object.keys(b)) assert.equal(applied[key], b[key])
  assert.equal(applied.crf, 16)
  assert.deepEqual(result.preset, entry)
  assert.equal(storage.values.size, 1)
  assert.equal([...storage.values.keys()][0], EXPORT_PRESET_LIBRARY_KEY)
  assert.equal(matchCustomExportPreset([entry], { ...applied, filename: 'C', range: 'inout' }).id, entry.id)
  assert.equal(matchCustomExportPreset([entry], { ...applied, crf: 20 }), null)
})

test('duplicate save and rename leave the existing raw library untouched', () => {
  const storage = memoryStorage()
  const first = save(storage, 'One').preset
  const second = save(storage, 'Two').preset
  const before = storage.getItem(EXPORT_PRESET_LIBRARY_KEY)
  assert.equal(save(storage, 'one').ok, false)
  assert.equal(updateExportPresetLibrary({ type: 'rename', id: second.id, expected: second, name: 'ONE' }, storage).ok, false)
  assert.equal(storage.getItem(EXPORT_PRESET_LIBRARY_KEY), before)
  const renamed = updateExportPresetLibrary({ type: 'rename', id: first.id, expected: first, name: 'First' }, storage)
  assert.equal(renamed.ok, true)
  assert.equal(renamed.preset.id, first.id)
  assert.deepEqual(renamed.preset.settings, first.settings)
})

test('delete requires the current exact target and leaves other presets untouched', () => {
  const storage = memoryStorage()
  const first = save(storage, 'One').preset
  const second = save(storage, 'Two').preset
  const renamed = updateExportPresetLibrary({ type: 'rename', id: first.id, expected: first, name: 'Changed elsewhere' }, storage)
  const before = storage.getItem(EXPORT_PRESET_LIBRARY_KEY)
  assert.equal(updateExportPresetLibrary({ type: 'delete', id: first.id, expected: first }, storage).ok, false)
  assert.equal(updateExportPresetLibrary({ type: 'delete', id: first.id }, storage).ok, false)
  assert.equal(storage.getItem(EXPORT_PRESET_LIBRARY_KEY), before)
  const removed = updateExportPresetLibrary({ type: 'delete', id: first.id, expected: renamed.preset }, storage)
  assert.equal(removed.ok, true)
  assert.deepEqual(removed.presets, [second])
  assert.equal(updateExportPresetLibrary({ type: 'delete', id: first.id, expected: renamed.preset }, storage).ok, false)
})

test('corrupt, future, duplicate, oversized and built-in-ID storage is preserved read-only', () => {
  for (const raw of ['not json', 'null', '[]', packed([], 999), 'x'.repeat(150001),
    packed([validEntry({ id: 'youtube-1080p' })]), packed([validEntry(), validEntry()]),
    packed([validEntry({ settings: source({ bitrateKbps: -1 }) })])]) {
    const storage = memoryStorage(raw)
    assert.equal(readExportPresetLibrary(storage).ok, false, raw.slice(0, 80))
    assert.equal(save(storage).ok, false)
    assert.equal(storage.getItem(EXPORT_PRESET_LIBRARY_KEY), raw)
    assert.equal(storage.writes(), 0)
  }
})

test('version-zero migration is lazy and strips stale payload fields before a user save', () => {
  const raw = packed([validEntry({ settings: source({ filename: 'private', range: 'inout', sourcePath: '/private' }) })], 0)
  const storage = memoryStorage(raw)
  const read = readExportPresetLibrary(storage)
  assert.equal(read.migrated, true)
  assert.equal(storage.writes(), 0)
  assert.equal('filename' in read.presets[0].settings, false)
  assert.equal(save(storage, 'New').ok, true)
  const saved = JSON.parse(storage.getItem(EXPORT_PRESET_LIBRARY_KEY))
  assert.equal(saved.version, 1)
  assert.equal(saved.presets.length, 2)
  assert.equal(JSON.stringify(saved).includes('/private'), false)
})

test('writes read the latest cross-window library rather than overwriting another consumer', () => {
  const storage = memoryStorage()
  const first = save(storage, 'One').preset
  const dialogSnapshot = readExportPresetLibrary(storage).presets[0]
  const second = save(storage, 'Two').preset
  const result = updateExportPresetLibrary({ type: 'rename', id: first.id, expected: dialogSnapshot, name: 'Renamed' }, storage)
  assert.equal(result.ok, true)
  assert.deepEqual(result.presets[1], second)
})

test('50-preset limit never evicts a saved preset', () => {
  const storage = memoryStorage()
  for (let index = 0; index < MAX_CUSTOM_EXPORT_PRESETS; index++) assert.equal(save(storage, `Preset ${index}`).ok, true)
  const before = storage.getItem(EXPORT_PRESET_LIBRARY_KEY)
  assert.equal(save(storage, 'Too many').ok, false)
  assert.equal(storage.getItem(EXPORT_PRESET_LIBRARY_KEY), before)
  assert.equal(readExportPresetLibrary(storage).presets.length, MAX_CUSTOM_EXPORT_PRESETS)
})

test('storage read/write errors and blocked localStorage getters never report a successful change', () => {
  assert.equal(readExportPresetLibrary({ getItem() { throw new Error('denied') } }).ok, false)
  assert.equal(save({ getItem: () => null, setItem() { throw new Error('quota') } }).ok, false)
  assert.equal(readExportPresetLibrary(null).ok, false)
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked') } })
    assert.equal(readExportPresetLibrary().ok, false)
    assert.equal(updateExportPresetLibrary({ type: 'save', name: 'Test', settings: source() }).ok, false)
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
    else delete globalThis.localStorage
  }
})

test('prototype and unrecognized schema payloads cannot inject export settings', () => {
  const input = JSON.parse('{"format":"mp4","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"outputPath":"/secret","settings":{"project":"bad"}}')
  const result = validateCustomExportPresetSettings(input)
  assert.equal(result.ok, true)
  assert.equal(Object.hasOwn(result.settings, '__proto__'), false)
  assert.equal(Object.hasOwn(result.settings, 'constructor'), false)
  assert.equal({}.polluted, undefined)
  assert.equal(JSON.stringify(result.settings).includes('/secret'), false)
})

test('actual ExportPanel custom apply preserves project fields and inactive-format codec choices', () => {
  const panel = readFileSync(new URL('../components/ExportPanel.jsx', import.meta.url), 'utf8')
  const readConstant = name => Function(`return (${panel.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n\\})`))[1]})`)()
  const start = panel.indexOf('  const handleApplyExportPreset = ')
  const end = panel.indexOf('  const handleResetSettings = ', start)
  const makeApply = initial => {
    let state = initial
    const apply = Function('setSettings', 'nvencStatus', 'VIDEO_CODECS', 'AUDIO_CODECS', 'validateCustomExportPresetSettings', 'normalizeTransparentExportSettings',
      `${panel.slice(start, end)}; return handleApplyExportPreset`)(
      update => { state = update(state) }, { checked: true, h264: false, h265: false },
      readConstant('VIDEO_CODECS'), readConstant('AUDIO_CODECS'), validateCustomExportPresetSettings, normalizeTransparentExportSettings)
    return { apply, read: () => state }
  }
  for (const format of ['gif', 'png-seq', 'audio']) {
    const initial = { filename: 'Keep', range: 'inout', projectPath: '/private', videoCodec: 'prores', audioCodec: 'aac' }
    const test = makeApply(initial)
    const settings = source({ format, videoCodec: 'h265', audioCodec: format === 'audio' ? 'wav' : 'opus', filename: 'Overwrite', range: 'full' })
    test.apply({ custom: true, settings })
    assert.equal(test.read().format, format)
    assert.equal(test.read().videoCodec, 'h265')
    assert.equal(test.read().audioCodec, settings.audioCodec)
    for (const key of ['filename', 'range', 'projectPath']) assert.equal(test.read()[key], initial[key])
  }
  const hardware = makeApply({ filename: 'Keep', range: 'full' })
  hardware.apply({ custom: true, settings: source({ useHardwareEncoder: true }) })
  assert.equal(hardware.read().useHardwareEncoder, false)
  const before = hardware.read()
  hardware.apply({ custom: true, settings: source({ crf: 'injection' }) })
  assert.equal(hardware.read(), before)
})

test('saved names are rendered as escaped text, never HTML/JSX or translation keys', () => {
  const name = '<img src=x onerror=alert(1)>'
  const storage = memoryStorage()
  const entry = save(storage, name).preset
  const code = transformSync(readFileSync(new URL('../components/ExportPresetPicker.jsx', import.meta.url), 'utf8'),
    { loader: 'jsx', format: 'cjs', jsxFactory: 'React.createElement' }).code
  const module = { exports: {} }
  Function('require', 'module', 'exports', 'React', code)(id => {
    if (id === 'react') return React
    if (id === 'lucide-react') return { Check: () => null, Film: () => null, Play: () => null, Send: () => null }
    if (id === '../i18n/I18nContext') return { useI18n: () => ({ t: (key, vars, fallback) => fallback || key }) }
    if (id === '../hooks/useExportPresetLibrary') return () => ({ presets: [entry], error: '', update() {}, reload() {} })
    if (id === '../utils/exportPresetLibrary.mjs') return { matchCustomExportPreset, readExportPresetLibrary, validateCustomExportPresetSettings, MAX_CUSTOM_EXPORT_PRESETS }
    if (id === './ExportPresetDialog') return () => null
    throw new Error(id)
  }, module, module.exports, React)
  const html = renderToStaticMarkup(React.createElement(module.exports.default, {
    presets: [], activePresetId: null, hardwareLabel: 'NVENC', onApply() {}, settings: entry.settings, active: false,
  }))
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'))
  assert.ok(!html.includes('<img'))
  assert.equal(parseExportPresetLibrary(storage.getItem(EXPORT_PRESET_LIBRARY_KEY)).presets[0].name, name)
})
