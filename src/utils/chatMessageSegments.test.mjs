import test from 'node:test'
import assert from 'node:assert/strict'
import { hasRawSegments, splitAssistantContent } from './chatMessageSegments.mjs'

test('plain text stays as one text segment', () => {
  const segments = splitAssistantContent('The timeline has 3 tracks.\nTrack 1 holds the dialogue.')
  assert.deepEqual(segments, [{ type: 'text', content: 'The timeline has 3 tracks.\nTrack 1 holds the dialogue.' }])
})

test('an inline TOOL RESULT object is pulled out of the reply', () => {
  const text = 'Here is what I found.\nTOOL RESULT: { "ok": true, "tracks": [{ "id": "v1", "name": "Video 1" }] }\nYou have one video track.'
  const segments = splitAssistantContent(text)
  assert.equal(segments.length, 3)
  assert.equal(segments[0].type, 'text')
  assert.equal(segments[0].content, 'Here is what I found.')
  assert.equal(segments[1].type, 'raw')
  assert.match(segments[1].content, /^\{ "ok": true/)
  assert.match(segments[1].content, /\}$/)
  assert.equal(segments[2].content, 'You have one video track.')
})

test('a multi-line result after a label on its own line is hidden', () => {
  const text = 'Tool result:\n{\n  "clips": 4,\n  "duration": 12.5\n}\nThat is four clips.'
  const segments = splitAssistantContent(text)
  assert.deepEqual(segments.map((segment) => segment.type), ['raw', 'text'])
  assert.equal(JSON.parse(segments[0].content).clips, 4)
  assert.equal(segments[1].content, 'That is four clips.')
})

test('fenced JSON blocks are hidden, other code fences are kept', () => {
  const json = splitAssistantContent('Result:\n```json\n{"a":1}\n```\nDone.')
  assert.deepEqual(json.map((segment) => segment.type), ['text', 'raw', 'text'])
  assert.equal(json[1].content, '{"a":1}')

  const prose = splitAssistantContent('Try this caption:\n```\nHello there\n```')
  assert.equal(prose.length, 1)
  assert.equal(prose[0].type, 'text')
  assert.match(prose[0].content, /Hello there/)
})

test('a bare JSON object line is hidden but braces in prose are not', () => {
  assert.equal(hasRawSegments('{"success":true,"message":"Moved 2 clips","changed":true}'), true)
  assert.equal(hasRawSegments('Use {name} as a placeholder in the title.'), false)
})

test('a truncated result with no closing brace is still hidden', () => {
  const segments = splitAssistantContent('TOOL RESULT: {"items":[{"id":"a"},{"id":"b"}')
  assert.equal(segments.length, 1)
  assert.equal(segments[0].type, 'raw')
})

test('labels with a tool name and markdown bold are recognised', () => {
  const segments = splitAssistantContent('**Tool result for get_timeline:** {"clips":[]}\nNo clips yet.')
  assert.deepEqual(segments.map((segment) => segment.type), ['raw', 'text'])
})
