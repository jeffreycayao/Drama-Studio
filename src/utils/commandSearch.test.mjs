import test from 'node:test'
import assert from 'node:assert/strict'
import { pushRecentCommand, rankCommands } from './commandSearch.mjs'

const commands = [
  { id: 'go-editor', title: 'Go to Editor', group: 'Go to' },
  { id: 'translate', title: 'Translate captions…', group: 'Captions', where: 'Right-click the captions clip', keywords: ['language'] },
  { id: 'save-srt', title: 'Save subtitles (.srt)…', group: 'Captions', keywords: ['subtitle file', 'vtt'] },
  { id: 'lipsync', title: 'Lip-sync to dialogue…', group: 'AI', where: 'Right-click a video clip' },
  { id: 'duck', title: 'Auto-duck music under dialogue', group: 'Audio', keywords: ['ducking'] },
  { id: 'settings-agents', title: 'Settings: Agents (MCP)', group: 'Settings', keywords: ['assistant', 'claude'] },
]
const ids = (query) => rankCommands(commands, query).map((command) => command.id)

test('an empty query keeps the original order', () => {
  assert.deepEqual(ids(''), commands.map((command) => command.id))
})

test('title prefixes win and every word must match', () => {
  assert.equal(ids('trans')[0], 'translate')
  assert.equal(ids('go ed')[0], 'go-editor')
  assert.deepEqual(ids('translate music'), [])
  assert.deepEqual(ids('dialogue'), ['lipsync', 'duck'])
})

test('keywords, groups, where-text and synonyms match too', () => {
  assert.ok(ids('srt').includes('save-srt'))
  assert.ok(ids('vtt').includes('save-srt'))
  assert.equal(ids('dub')[0], 'translate')
  assert.ok(ids('claude').includes('settings-agents'))
  assert.ok(ids('right click video').includes('lipsync'))
  assert.ok(ids('subtitles').includes('translate'), 'subtitles also finds caption actions')
})

test('punctuation and case are ignored', () => {
  assert.equal(ids('LIP SYNC')[0], 'lipsync')
  assert.equal(ids('auto-duck')[0], 'duck')
})

test('recent list is unique, newest first, capped', () => {
  assert.deepEqual(pushRecentCommand(['a', 'b', 'c'], 'b'), ['b', 'a', 'c'])
  assert.deepEqual(pushRecentCommand(['a', 'b', 'c'], 'd', 3), ['d', 'a', 'b'])
})
