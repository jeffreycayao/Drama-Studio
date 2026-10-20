import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTimelineCommands } from './timelineCommands.js'
// Same rule as commandContext.commandAppliesToClip (that module pulls in the stores).
const commandAppliesToClip = (command, context) => Array.isArray(command?.clipTypes) && Boolean(context?.clip) && command.clipTypes.includes(context.clipType)

function handlers(overrides = {}) {
  const calls = []
  const record = (name) => (...args) => calls.push([name, ...args])
  return {
    calls,
    value: {
      addCaptions: record('addCaptions'), openTranslateCaptions: record('openTranslateCaptions'), saveSubtitleFile: record('saveSubtitleFile'),
      editCaptions: record('editCaptions'), continueFromLastFrame: record('continueFromLastFrame'), openLipSync: record('openLipSync'),
      openSmartReplace: record('openSmartReplace'), detectBeats: record('detectBeats'), openMusicPopover: record('openMusicPopover'),
      getSmartReplaceEligibility: () => ({ ok: true }),
      openMaskPicker: record('openMaskPicker'), canCreateCompound: () => true, openCompoundCreate: record('openCompoundCreate'),
      hasAttributeClipboard: () => false, openPasteAttributes: record('openPasteAttributes'), openMatchFrame: record('openMatchFrame'),
      openMoveOffset: record('openMoveOffset'), openDurationDelta: record('openDurationDelta'),
      ...overrides,
    },
  }
}

const videoContext = (extra = {}) => ({
  clip: { id: 'c1', type: 'video', assetId: 'a1', trackId: 'v1', duration: 4, startTime: 0 },
  track: { id: 'v1', type: 'video', visible: true },
  asset: { id: 'a1', type: 'video' },
  clipType: 'video',
  selectionCount: 1,
  ...extra,
})

const byId = (commands) => Object.fromEntries(commands.map((command) => [command.id, command]))
const availability = (command, context) => (typeof command.available === 'function' ? command.available(context) : true)

test('pro edit tools are quick actions for a selected video clip', () => {
  const context = videoContext()
  const commands = byId(buildTimelineCommands(handlers().value, context))
  for (const id of ['clip.add-mask', 'clip.compound-create', 'clip.paste-attributes', 'clip.match-frame', 'clip.move-by-offset', 'clip.change-duration']) {
    assert.ok(commands[id], `${id} exists`)
    assert.equal(commands[id].group, 'Edit')
    assert.ok(commandAppliesToClip(commands[id], context), `${id} applies to a video clip`)
  }
})

test('AI tools stay in the AI group and detect beats also fits video clips', () => {
  const context = videoContext()
  const commands = byId(buildTimelineCommands(handlers().value, context))
  assert.equal(commands['clip.continue-last-frame'].group, 'AI')
  assert.equal(commands['clip.lip-sync'].group, 'AI')
  assert.ok(commandAppliesToClip(commands['clip.detect-beats'], context))
})

test('paste attributes explains what to do when nothing was copied', () => {
  const context = videoContext()
  const commands = byId(buildTimelineCommands(handlers().value, context))
  assert.match(String(availability(commands['clip.paste-attributes'], context)), /Copy a clip first/)
  const ready = byId(buildTimelineCommands(handlers({ hasAttributeClipboard: () => true }).value, context))
  assert.equal(availability(ready['clip.paste-attributes'], context), true)
})

test('match frame needs source media; masks need a picture clip', () => {
  const textContext = { clip: { id: 't1', type: 'text' }, track: { id: 'v1', type: 'video' }, asset: null, clipType: 'text', selectionCount: 1 }
  const commands = byId(buildTimelineCommands(handlers().value, textContext))
  assert.equal(commandAppliesToClip(commands['clip.match-frame'], textContext), false)
  assert.equal(commandAppliesToClip(commands['clip.add-mask'], textContext), false)
  assert.ok(commandAppliesToClip(commands['clip.move-by-offset'], textContext))
})

test('compound create is refused inside a compound', () => {
  const context = videoContext()
  const commands = byId(buildTimelineCommands(handlers({ canCreateCompound: () => false }).value, context))
  assert.match(String(availability(commands['clip.compound-create'], context)), /compound/i)
})

test('running a command calls its handler with the clip', () => {
  const context = videoContext()
  const h = handlers()
  const commands = byId(buildTimelineCommands(h.value, context))
  commands['clip.add-mask'].run(context)
  commands['clip.match-frame'].run(context)
  commands['clip.move-by-offset'].run(context)
  assert.deepEqual(h.calls.map(([name]) => name), ['openMaskPicker', 'openMatchFrame', 'openMoveOffset'])
  assert.equal(h.calls[0][1], 'c1')
})
