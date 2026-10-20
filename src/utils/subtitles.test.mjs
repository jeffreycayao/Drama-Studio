import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ORIGINAL_VERSION_KEY,
  addCaptionVersion,
  buildSrt,
  buildSubtitleFile,
  buildTranslationPrompt,
  buildWebVtt,
  chunkCuesForTranslation,
  collectTimelineSubtitleCues,
  formatSubtitleTimestamp,
  getCaptionVersions,
  listTimelineCaptionVersions,
  maxCharsForCue,
  parseTranslationReply,
  prepareSubtitleCues,
  removeCaptionVersion,
  subtitleFileSuffix,
  switchCaptionVersion,
  translateCues,
} from './subtitles.mjs'

const cue = (id, start, end, text, extra = {}) => ({ id, start, end, text, ...extra })

test('timestamps round to the millisecond in both formats', () => {
  assert.equal(formatSubtitleTimestamp(0), '00:00:00,000')
  assert.equal(formatSubtitleTimestamp(3661.2345), '01:01:01,235')
  assert.equal(formatSubtitleTimestamp(59.9996), '00:01:00,000')
  assert.equal(formatSubtitleTimestamp(-4), '00:00:00,000')
  assert.equal(formatSubtitleTimestamp(12.5, { separator: '.' }), '00:00:12.500')
})

test('cues are cleaned, sorted and empty ones dropped', () => {
  const prepared = prepareSubtitleCues([
    cue('b', 4, 6, '  second\r\n  line  '),
    cue('empty', 1, 2, '   '),
    cue('a', 1, 3, 'first'),
    cue('bad-end', 7, 6, 'no end'),
    cue('arrow', 9, 10, 'a --> b'),
  ])
  assert.deepEqual(prepared.map((item) => item.text), ['first', 'second\nline', 'no end', 'a → b'])
  assert.equal(prepared[2].end, 8, 'an end before the start gets a one-second cue')
})

test('SRT output is numbered, comma timestamps, blank line between cues', () => {
  const srt = buildSrt([cue('1', 0, 1.5, 'Hello'), cue('2', 2, 3.25, 'Two\nlines')])
  assert.equal(srt, '1\n00:00:00,000 --> 00:00:01,500\nHello\n\n2\n00:00:02,000 --> 00:00:03,250\nTwo\nlines\n')
  assert.equal(buildSrt([]), '')
})

test('WebVTT has a header, dot timestamps and escaped markup', () => {
  const vtt = buildWebVtt([cue('1', 0, 1, 'Tom & <Jerry>')], { language: 'es' })
  assert.equal(vtt, 'WEBVTT\nLanguage: es\n\n1\n00:00:00.000 --> 00:00:01.000\nTom &amp; &lt;Jerry&gt;\n')
  assert.equal(buildWebVtt([]), 'WEBVTT\n')
  assert.throws(() => buildSubtitleFile('ass', []), /Unknown subtitle format/)
})

test('file suffixes', () => {
  assert.equal(subtitleFileSuffix(ORIGINAL_VERSION_KEY), '')
  assert.equal(subtitleFileSuffix('pt-BR'), '.pt-BR')
  assert.equal(subtitleFileSuffix('../x y'), '.xy')
})

test('timeline cues follow clip position, trim, speed and visibility', () => {
  const live = {
    id: 'c1', type: 'captions', trackId: 'cap', startTime: 10, trimStart: 2, duration: 4,
    captions: { cues: [cue('a', 0, 1, 'cut off'), cue('b', 1.5, 3, 'partly in'), cue('c', 3, 5, 'inside'), cue('d', 7, 8, 'after')] },
  }
  const cues = collectTimelineSubtitleCues({ clips: [live], tracks: [{ id: 'cap', visible: true }] })
  assert.deepEqual(cues, [
    { start: 10, end: 11, text: 'partly in' },
    { start: 11, end: 13, text: 'inside' },
  ])
  const fast = { ...live, speed: 2, duration: 2 }
  assert.deepEqual(collectTimelineSubtitleCues({ clips: [fast] }).map(({ start, end }) => [start, end]), [[10, 10.5], [10.5, 11.5]])
  assert.deepEqual(collectTimelineSubtitleCues({ clips: [live], tracks: [{ id: 'cap', visible: false }] }), [])
  assert.deepEqual(collectTimelineSubtitleCues({ clips: [{ ...live, enabled: false }] }), [])
})

test('baked overlays use sidecar cues and the In/Out range rebases time', () => {
  const overlay = { id: 'o1', assetId: 'asset-1', trackId: 'v', startTime: 5, trimStart: 0, duration: 10 }
  const cues = collectTimelineSubtitleCues({
    clips: [overlay, { id: 'plain', assetId: 'video-2', startTime: 0, duration: 3 }],
    sidecarCues: { 'asset-1': [cue('x', 0, 2, 'one'), cue('y', 4, 6, 'two')] },
    range: { start: 6, end: 10 },
  })
  assert.deepEqual(cues, [{ start: 0, end: 1, text: 'one' }, { start: 3, end: 4, text: 'two' }])
})

test('language versions: add, switch, keep edits, remove', () => {
  const original = { preset: { id: 'p' }, cues: [cue('a', 0, 1, 'Hello')] }
  assert.deepEqual(getCaptionVersions(original).versions.map((v) => v.key), ['original'])

  const spanish = addCaptionVersion(original, { key: 'es', label: 'Spanish', cues: [cue('a', 0, 1, 'Hola')], translatedFrom: 'original', now: 't1' })
  assert.equal(spanish.activeVersion, 'es')
  assert.equal(spanish.cues[0].text, 'Hola')
  assert.equal(spanish.versions.original.cues[0].text, 'Hello')
  assert.equal(spanish.preset.id, 'p', 'other payload fields survive')

  // An edit made to the shown cues (e.g. through update_caption_cues) is kept on switch.
  const edited = { ...spanish, cues: [cue('a', 0, 1, '¡Hola!')] }
  const back = switchCaptionVersion(edited, 'original', { now: 't2' })
  assert.equal(back.cues[0].text, 'Hello')
  assert.equal(back.versions.es.cues[0].text, '¡Hola!')
  assert.equal(switchCaptionVersion(back, 'es').cues[0].text, '¡Hola!')
  assert.throws(() => switchCaptionVersion(back, 'fr'), /no "fr" caption version/)

  const listed = getCaptionVersions(back)
  assert.deepEqual(listed.versions.map((v) => [v.key, v.label, v.isActive]), [['original', 'Original', true], ['es', 'Spanish', false]])

  const removed = removeCaptionVersion(edited, 'es')
  assert.equal(removed.activeVersion, 'original')
  assert.equal(removed.cues[0].text, 'Hello')
  assert.equal(removed.versions.es, undefined)
  assert.throws(() => removeCaptionVersion(edited, 'original'), /cannot be removed/)
  assert.throws(() => addCaptionVersion(original, { key: 'original', cues: [cue('a', 0, 1, 'x')] }), /own language key/)
})

test('a chosen version is exported without switching the clip', () => {
  const clip = { type: 'captions', startTime: 0, trimStart: 0, duration: 5, captions: addCaptionVersion({ cues: [cue('a', 0, 1, 'Hello')] }, { key: 'es', cues: [cue('a', 0, 1, 'Hola')] }) }
  assert.equal(collectTimelineSubtitleCues({ clips: [clip] })[0].text, 'Hola')
  assert.equal(collectTimelineSubtitleCues({ clips: [clip], versionKey: 'original' })[0].text, 'Hello')
  assert.equal(collectTimelineSubtitleCues({ clips: [clip], versionKey: 'fr' })[0].text, 'Hola', 'an unknown key falls back to the shown version')
  assert.deepEqual(listTimelineCaptionVersions([clip]).map((v) => v.key), ['original', 'es'])
})

test('translation batches and prompt', () => {
  const cues = Array.from({ length: 70 }, (_, index) => cue(String(index), index, index + 2, `line ${index}`))
  assert.deepEqual(chunkCuesForTranslation(cues).map((batch) => batch.length), [30, 30, 10])
  assert.deepEqual(chunkCuesForTranslation([cue('a', 0, 1, 'x'.repeat(50)), cue('b', 1, 2, 'y'.repeat(50))], { maxChars: 60 }).map((b) => b.length), [1, 1])
  assert.equal(maxCharsForCue(cue('a', 0, 2, '')), 34)
  assert.equal(maxCharsForCue(cue('a', 0, 0.1, '')), 12)
  const prompt = buildTranslationPrompt([cue('a', 0, 2, 'Hi')], { targetLanguage: 'Spanish' })
  assert.match(prompt, /into Spanish/)
  assert.match(prompt, /"i":0,"text":"Hi","max":34/)
  assert.throws(() => buildTranslationPrompt([], {}), /Choose a language/)
})

test('translation replies: fenced JSON, plain strings, and missing lines', () => {
  const batch = [cue('a', 0, 1, 'Hi'), cue('b', 1, 2, 'Bye')]
  assert.deepEqual(parseTranslationReply('```json\n[{"i":1,"text":"Adiós"},{"i":0,"text":"Hola"}]\n```', batch), ['Hola', 'Adiós'])
  assert.deepEqual(parseTranslationReply('Sure! ["Hola", "Adiós"]', batch), ['Hola', 'Adiós'])
  assert.throws(() => parseTranslationReply('[{"i":0,"text":"Hola"}]', batch), /skipped 1 of 2/)
  assert.throws(() => parseTranslationReply('no json here', batch), /Could not read the translation/)
})

test('translateCues keeps timing and ids, retries a bad batch once, reports progress', async () => {
  const cues = [cue('a', 0, 1, 'Hi', { globalOverrides: { x: 1 } }), cue('b', 1, 2, 'Bye'), cue('blank', 2, 3, ' ')]
  let calls = 0
  const progress = []
  const ask = async ({ prompt }) => {
    calls += 1
    if (calls === 1) return 'oops'
    const input = JSON.parse(prompt.split('\n').pop())
    return JSON.stringify(input.map((line) => ({ i: line.i, text: `[es] ${line.text}` })))
  }
  const translated = await translateCues(cues, { ask, targetLanguage: 'Spanish', onProgress: (p) => progress.push(p) })
  assert.equal(calls, 2)
  assert.deepEqual(translated.map((c) => [c.id, c.start, c.end, c.text]), [['a', 0, 1, '[es] Hi'], ['b', 1, 2, '[es] Bye']])
  assert.deepEqual(translated[0].globalOverrides, { x: 1 }, 'styling rides along')
  assert.deepEqual(progress, [{ done: 2, total: 2 }])

  await assert.rejects(() => translateCues(cues, { ask: async () => 'nope', targetLanguage: 'Spanish' }), /Could not read/)
  await assert.rejects(() => translateCues([], { ask, targetLanguage: 'Spanish' }), /no caption lines/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => translateCues(cues, { ask, targetLanguage: 'Spanish', signal: controller.signal }), /cancelled/)
})
