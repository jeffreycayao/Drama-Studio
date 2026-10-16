import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSongwriterPrompt, parseSongwriterResponse } from './songwriter.mjs'
import { extractJsonObject } from './llmJson.mjs'

test('JSON is found in fences, prose and with braces inside strings', () => {
  assert.deepEqual(extractJsonObject('Sure!\n```json\n{"a": "x}y"}\n```'), { a: 'x}y' })
  assert.deepEqual(extractJsonObject('Here: {"a": {"b": 1}} done'), { a: { b: 1 } })
  assert.equal(extractJsonObject('no json'), null)
  assert.equal(extractJsonObject('[1,2]'), null)
})

test('a full song becomes tags, BPM, key and lowercase sectioned lyrics', () => {
  const reply = '```json\n' + JSON.stringify({ title: 'Last Bus Home', genre: 'Cinematic Pop', tags: 'bittersweet, piano, strings, female vocal',
    bpm: 92, key: 'a minor', lyrics: '[Verse 1]\n1. Rain on the glass\n[Pre-Chorus]\nhold on\n(Chorus)\nWe run, we run\n[Bridge]:\nquiet now' }) + '\n```'
  const song = parseSongwriterResponse(reply)
  assert.equal(song.ok, true)
  assert.equal(song.title, 'Last Bus Home')
  assert.equal(song.tags, 'cinematic pop, bittersweet, piano, strings, female vocal, 92 bpm')
  assert.equal(song.bpm, 92)
  assert.equal(song.keyScale, 'A minor')
  assert.equal(song.lyrics, '[verse]\nRain on the glass\n[pre-chorus]\nhold on\n[chorus]\nWe run, we run\n[bridge]\nquiet now')
})

test('out-of-range BPM, unknown keys, missing sections and refusals are handled', () => {
  const song = parseSongwriterResponse(JSON.stringify({ tags: 'drum and bass, 174 bpm', bpm: 400, key: 'H# lydian', lyrics: '[verse]\nGo' }))
  assert.equal(song.bpm, 220)
  assert.equal(song.keyScale, 'C major')
  assert.equal(parseSongwriterResponse(JSON.stringify({ tags: 'x', lyrics: 'no sections' })).ok, false)
  assert.equal(parseSongwriterResponse(JSON.stringify({ tags: 'ambient score' }), { instrumental: true }).lyrics, '')
  assert.equal(parseSongwriterResponse('I cannot help with that').ok, false)
})

test('the prompt asks for a structure that fits the duration', () => {
  assert.match(buildSongwriterPrompt({ brief: 'a breakup at a bus stop', durationSeconds: 30 }), /verse \+ chorus/)
  assert.match(buildSongwriterPrompt({ brief: 'x', durationSeconds: 180, instrumental: true }), /Instrumental/)
  assert.throws(() => buildSongwriterPrompt({ brief: ' ' }), /Describe/)
})
