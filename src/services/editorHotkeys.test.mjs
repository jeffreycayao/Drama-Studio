import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_EDITOR_HOTKEYS,
  EDITOR_HOTKEY_DEFINITIONS,
  EDITOR_HOTKEY_IDS,
  EDITOR_HOTKEY_PRESETS,
  assignEditorHotkeyBinding,
  getEditorHotkeyPresetMatch,
  hotkeyEventToBinding,
  matchEditorHotkey,
  mergeEditorHotkeys,
} from './editorHotkeys.js'

function keyboardEvent({
  key,
  code = '',
  ctrlKey = false,
  metaKey = false,
  altKey = false,
  shiftKey = false,
} = {}) {
  return { key, code, ctrlKey, metaKey, altKey, shiftKey }
}

test('play around defaults to Shift+K without taking unmodified or primary-modified K', () => {
  const definition = EDITOR_HOTKEY_DEFINITIONS.find(item => item.id === EDITOR_HOTKEY_IDS.PLAY_AROUND)
  assert.equal(definition.label, 'Play around edit')
  const binding = DEFAULT_EDITOR_HOTKEYS[EDITOR_HOTKEY_IDS.PLAY_AROUND]
  assert.equal(binding, 'Shift+K')
  assert.equal(matchEditorHotkey(keyboardEvent({ key: 'K', code: 'KeyK', shiftKey: true }), binding), true)
  assert.equal(matchEditorHotkey(keyboardEvent({ key: 'k', code: 'KeyK' }), binding), false)
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    assert.equal(matchEditorHotkey(keyboardEvent({ key: 'K', code: 'KeyK', shiftKey: true, [modifier]: true }), binding), false)
  }
})

test('play around is available in all existing editor presets', () => {
  for (const preset of EDITOR_HOTKEY_PRESETS) {
    assert.equal(preset.bindings[EDITOR_HOTKEY_IDS.PLAY_AROUND], 'Shift+K', preset.id)
    assert.equal(getEditorHotkeyPresetMatch(preset.bindings), preset.id)
  }
})

test('play around migration preserves legacy Shift+K owners and explicit custom choices', () => {
  assert.equal(mergeEditorHotkeys({})[EDITOR_HOTKEY_IDS.PLAY_AROUND], 'Shift+K')
  const legacy = mergeEditorHotkeys({ [EDITOR_HOTKEY_IDS.ADD_MARKER]: 'shift+k' })
  assert.equal(legacy[EDITOR_HOTKEY_IDS.ADD_MARKER], 'Shift+K')
  assert.equal(legacy[EDITOR_HOTKEY_IDS.PLAY_AROUND], '')
  for (const binding of ['', 'G', 'Ctrl+Shift+P', 'Shift+K']) {
    const merged = mergeEditorHotkeys({ [EDITOR_HOTKEY_IDS.PLAY_AROUND]: binding })
    assert.equal(merged[EDITOR_HOTKEY_IDS.PLAY_AROUND], binding)
  }
  const reassigned = assignEditorHotkeyBinding(legacy, EDITOR_HOTKEY_IDS.PLAY_AROUND, 'Shift+K')
  assert.equal(reassigned[EDITOR_HOTKEY_IDS.PLAY_AROUND], 'Shift+K')
  assert.equal(reassigned[EDITOR_HOTKEY_IDS.ADD_MARKER], '')
})

test('timeline view shortcuts default to frame all on 1 and zoom on 2/3', () => {
  assert.equal(DEFAULT_EDITOR_HOTKEYS[EDITOR_HOTKEY_IDS.FRAME_ALL], '1')
  assert.equal(DEFAULT_EDITOR_HOTKEYS[EDITOR_HOTKEY_IDS.ZOOM_OUT], '2')
  assert.equal(DEFAULT_EDITOR_HOTKEYS[EDITOR_HOTKEY_IDS.ZOOM_IN], '3')
})

test('selection view defaults to Z without taking Undo or modified Z', () => {
  const binding = DEFAULT_EDITOR_HOTKEYS[EDITOR_HOTKEY_IDS.ZOOM_TO_SELECTION]
  assert.equal(binding, 'Z')
  assert.equal(matchEditorHotkey(keyboardEvent({ key: 'z', code: 'KeyZ' }), binding), true)
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
    assert.equal(matchEditorHotkey(keyboardEvent({ key: 'z', code: 'KeyZ', [modifier]: true }), binding), false)
  }
})

test('selection view migration preserves a previous custom Z owner and explicit choices', () => {
  assert.equal(mergeEditorHotkeys({})[EDITOR_HOTKEY_IDS.ZOOM_TO_SELECTION], 'Z')
  const legacy = mergeEditorHotkeys({ [EDITOR_HOTKEY_IDS.ADD_MARKER]: 'Z' })
  assert.equal(legacy[EDITOR_HOTKEY_IDS.ADD_MARKER], 'Z')
  assert.equal(legacy[EDITOR_HOTKEY_IDS.ZOOM_TO_SELECTION], '')
  for (const binding of ['', 'G']) {
    assert.equal(mergeEditorHotkeys({ [EDITOR_HOTKEY_IDS.ZOOM_TO_SELECTION]: binding })[EDITOR_HOTKEY_IDS.ZOOM_TO_SELECTION], binding)
  }
  const reassigned = assignEditorHotkeyBinding(legacy, EDITOR_HOTKEY_IDS.ZOOM_TO_SELECTION, 'Z')
  assert.equal(reassigned[EDITOR_HOTKEY_IDS.ZOOM_TO_SELECTION], 'Z')
  assert.equal(reassigned[EDITOR_HOTKEY_IDS.ADD_MARKER], '')
})

test('legacy saved keymaps receive the new timeline view defaults', () => {
  const merged = mergeEditorHotkeys({
    [EDITOR_HOTKEY_IDS.ADD_MARKER]: 'G',
  })

  assert.equal(merged[EDITOR_HOTKEY_IDS.ADD_MARKER], 'G')
  assert.equal(merged[EDITOR_HOTKEY_IDS.FRAME_ALL], '1')
  assert.equal(merged[EDITOR_HOTKEY_IDS.ZOOM_OUT], '2')
  assert.equal(merged[EDITOR_HOTKEY_IDS.ZOOM_IN], '3')
})

test('legacy custom digit assignments win over newly introduced defaults', () => {
  const merged = mergeEditorHotkeys({
    [EDITOR_HOTKEY_IDS.ADD_MARKER]: '1',
    [EDITOR_HOTKEY_IDS.TOGGLE_SNAPPING]: '2',
  })

  assert.equal(merged[EDITOR_HOTKEY_IDS.ADD_MARKER], '1')
  assert.equal(merged[EDITOR_HOTKEY_IDS.TOGGLE_SNAPPING], '2')
  assert.equal(merged[EDITOR_HOTKEY_IDS.FRAME_ALL], '')
  assert.equal(merged[EDITOR_HOTKEY_IDS.ZOOM_OUT], '')
  assert.equal(merged[EDITOR_HOTKEY_IDS.ZOOM_IN], '3')
})

test('explicit timeline view assignments remain authoritative', () => {
  const merged = mergeEditorHotkeys({
    [EDITOR_HOTKEY_IDS.FRAME_ALL]: '4',
    [EDITOR_HOTKEY_IDS.ZOOM_OUT]: '',
    [EDITOR_HOTKEY_IDS.ZOOM_IN]: 'Ctrl+3',
  })

  assert.equal(merged[EDITOR_HOTKEY_IDS.FRAME_ALL], '4')
  assert.equal(merged[EDITOR_HOTKEY_IDS.ZOOM_OUT], '')
  assert.equal(merged[EDITOR_HOTKEY_IDS.ZOOM_IN], 'Ctrl+3')
})

test('assigning or restoring a binding clears the previous configurable owner', () => {
  const legacy = mergeEditorHotkeys({
    [EDITOR_HOTKEY_IDS.ADD_MARKER]: '1',
  })
  const reassigned = assignEditorHotkeyBinding(
    legacy,
    EDITOR_HOTKEY_IDS.FRAME_ALL,
    DEFAULT_EDITOR_HOTKEYS[EDITOR_HOTKEY_IDS.FRAME_ALL],
  )

  assert.equal(reassigned[EDITOR_HOTKEY_IDS.ADD_MARKER], '')
  assert.equal(reassigned[EDITOR_HOTKEY_IDS.FRAME_ALL], '1')
})

test('numeric bindings match top-row and numpad keys without modifiers', () => {
  assert.equal(matchEditorHotkey(keyboardEvent({ key: '3', code: 'Digit3' }), '3'), true)
  assert.equal(matchEditorHotkey(keyboardEvent({ key: '3', code: 'Numpad3' }), '3'), true)
  assert.equal(matchEditorHotkey(keyboardEvent({ key: '3', code: 'Digit3', shiftKey: true }), '3'), false)
})

test('physical number-row keys stay stable across keyboard layouts', () => {
  const nonUsDigitEvent = keyboardEvent({ key: '&', code: 'Digit1' })

  assert.equal(hotkeyEventToBinding(nonUsDigitEvent), '1')
  assert.equal(matchEditorHotkey(nonUsDigitEvent, '1'), true)
  assert.equal(matchEditorHotkey(nonUsDigitEvent, '&'), true)
})
