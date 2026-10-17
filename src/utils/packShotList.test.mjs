import test from 'node:test'
import assert from 'node:assert/strict'
import {
  detectDelimiter,
  interpretPackTemplate,
  isSafePackRelativePath,
  parseDelimited,
  parseDurationSeconds,
  rowsToShots,
  shotRowsFromDelimited,
  templateFilesFromPackRecord,
  templateTitleFromFileName,
} from './packShotList.mjs'

const locations = [
  { slug: 'room_12', name: 'Room 12' },
  { slug: 'second_floor_hallway', name: 'Second floor hallway' },
]
const characters = [
  { slug: 'james', name: 'James' },
  { slug: 'mara', name: 'Mara' },
]

test('parses quoted CSV with commas, escaped quotes, line breaks, CRLF and a BOM', () => {
  const text = '\uFEFFshot,prompt\r\n1,"Wide, rainy motel ""Room 12"" at night"\r\n2,"Close-up of James\nholding a key"\r\n\r\n'
  assert.deepEqual(parseDelimited(text, ','), [
    ['shot', 'prompt'],
    ['1', 'Wide, rainy motel "Room 12" at night'],
    ['2', 'Close-up of James\nholding a key'],
  ])
})

test('detects tab for .tsv and the delimiter the header line uses', () => {
  assert.equal(detectDelimiter('a,b\tc', 'list.tsv'), '\t')
  assert.equal(detectDelimiter('shot;prompt;duration\n1;x;4', 'list.csv'), ';')
  assert.equal(detectDelimiter('shot\tprompt\n1\tx', 'list.csv'), '\t')
  assert.equal(detectDelimiter('just one column', 'list.csv'), ',')
})

test('shot,prompt CSV becomes shots with ids, titles, motion and default length', () => {
  const result = interpretPackTemplate('shots.csv', 'Shot,Prompt\n1,Wide establishing shot of a roadside motel in rain\n2,Close-up of a flickering bathroom light\n', { locations, characters })
  assert.equal(result.kind, 'shots')
  assert.equal(result.shots.length, 2)
  const [first, second] = result.shots
  assert.equal(first.id, 'shot-001')
  assert.equal(second.id, 'shot-002')
  assert.equal(first.keyframe, 'Wide establishing shot of a roadside motel in rain')
  assert.equal(first.motion, 'Wide establishing shot of a roadside motel in rain')
  assert.equal(first.title, 'Wide establishing shot of a roadside motel in rain')
  assert.equal(first.type, 'wide')
  assert.equal(second.type, 'close-up')
  assert.equal(first.duration, 5)
  assert.equal(first.locationSlug, 'room_12')
  assert.equal(first.characterSlug, '')
  assert.equal(first.dialogueId, '')
})

test('maps the common column names and reports the ones it does not use', () => {
  const tsv = [
    'Shot #\tShot Title\tDescription\tMotion Prompt\tCamera\tLength\tShot Type\tScene\tLocation\tCharacters\tDialogue',
    '1A\tThe key\tJames stares at the wrong key\tHe turns it over slowly\tslow push in\t4s\tinsert\tCheck-in\tRoom 12\tJames, Mara\tThis is not my room',
    '2\t\tMara by the window\t\t\t0:07\t\tCheck-in\tsecond_floor_hallway\tmara\t',
  ].join('\n')
  const result = interpretPackTemplate('list.tsv', tsv, { locations, characters })
  assert.equal(result.kind, 'shots')
  assert.deepEqual(result.ignoredColumns, ['Dialogue'])
  const [first, second] = result.shots
  assert.equal(first.title, 'The key')
  assert.equal(first.keyframe, 'James stares at the wrong key')
  assert.equal(first.motion, 'slow push in. He turns it over slowly')
  assert.equal(first.duration, 4)
  assert.equal(first.type, 'insert')
  assert.equal(first.scene, 'Check-in')
  assert.equal(first.locationSlug, 'room_12')
  assert.equal(first.characterSlug, 'james')
  assert.equal(second.duration, 7)
  assert.equal(second.locationSlug, 'second_floor_hallway')
  assert.equal(second.characterSlug, 'mara')
  assert.equal(second.motion, 'Mara by the window')
})

test('headerless lists: one column is the prompt, a label column and a numeric length are used', () => {
  const single = interpretPackTemplate('prompts.csv', 'A neon sign buzzing\nRain on the window\n', { locations })
  assert.equal(single.kind, 'shots')
  assert.deepEqual(single.shots.map((shot) => shot.keyframe), ['A neon sign buzzing', 'Rain on the window'])

  const labelled = shotRowsFromDelimited('1,Wide of the motel,6\nInsert,Key in the lock,abc\n', 'x.csv')
  assert.equal(labelled.hasHeader, false)
  const shots = rowsToShots(labelled.rows, { locations }).shots
  assert.equal(shots[0].title, 'Wide of the motel')
  assert.equal(shots[0].duration, 6)
  assert.equal(shots[1].title, 'Insert')
  assert.equal(shots[1].duration, 5)
})

test('skips empty rows, falls back to the first location and lists unknown names', () => {
  const csv = 'title,prompt,location,character\n,,,\n,,Room 12,James\nArrival,Car pulls in,Parking lot,Stranger\n'
  const result = interpretPackTemplate('a.csv', csv, { locations, characters, sceneLabel: 'Motel pack' })
  assert.equal(result.shots.length, 1)
  assert.equal(result.skippedRows, 1)
  assert.equal(result.shots[0].locationSlug, 'room_12')
  assert.equal(result.shots[0].scene, 'Motel pack')
  assert.deepEqual(result.unmatchedLocations, ['Parking lot'])
  assert.deepEqual(result.unmatchedCharacters, ['Stranger'])
})

test('caps very long lists', () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({ keyframe: `Shot ${index}` }))
  const result = rowsToShots(rows, { maxShots: 5 })
  assert.equal(result.shots.length, 5)
  assert.equal(result.truncated, true)
})

test('a CSV with no usable rows is reported, not turned into empty shots', () => {
  assert.deepEqual(interpretPackTemplate('a.csv', 'shot,prompt\n1,\n2,\n'), { kind: 'unsupported', reason: 'no-shots' })
  assert.deepEqual(interpretPackTemplate('a.csv', '   \n'), { kind: 'unsupported', reason: 'empty' })
})

test('length parsing', () => {
  assert.equal(parseDurationSeconds('4'), 4)
  assert.equal(parseDurationSeconds('3.6 sec'), 4)
  assert.equal(parseDurationSeconds('2,5s'), 3)
  assert.equal(parseDurationSeconds('0:12'), 12)
  assert.equal(parseDurationSeconds('120'), 30)
  assert.equal(parseDurationSeconds('0'), 5)
  assert.equal(parseDurationSeconds(''), 5)
})

test('JSON shot arrays become shots; prompt JSON and text files become text', () => {
  const json = JSON.stringify({ shots: [{ title: 'Open', prompt: 'Motel sign', duration: 3 }, { description: 'Hallway', camera: 'dolly left' }] })
  const shots = interpretPackTemplate('shots.json', json, { locations })
  assert.equal(shots.kind, 'shots')
  assert.equal(shots.shots[0].duration, 3)
  assert.equal(shots.shots[1].motion, 'dolly left. Hallway')

  assert.deepEqual(interpretPackTemplate('style.json', '{"prompt":"35mm film, warm grade"}'), { kind: 'text', text: '35mm film, warm grade' })
  assert.deepEqual(interpretPackTemplate('bad.json', '{nope'), { kind: 'unsupported', reason: 'format' })
  assert.deepEqual(interpretPackTemplate('idea.md', '\r\n# Idea\r\nA motel room.\r\n'), { kind: 'text', text: '# Idea\nA motel room.' })
  assert.equal(interpretPackTemplate('room.fountain', 'INT. ROOM - NIGHT\n').kind, 'script')
})

test('pack.json file lists: only safe template paths, never the read-me', () => {
  assert.equal(isSafePackRelativePath('prompts/shots.csv'), true)
  assert.equal(isSafePackRelativePath('../secrets.txt'), false)
  assert.equal(isSafePackRelativePath('a/../../b.txt'), false)
  assert.equal(isSafePackRelativePath('C:/Windows/win.ini'), false)
  assert.equal(isSafePackRelativePath('/etc/passwd'), false)
  assert.equal(isSafePackRelativePath('\\\\server\\share\\x.txt'), false)

  const files = templateFilesFromPackRecord(['README.md', 'prompts/shots.csv', 'prompts/shots.csv', 'script.fountain', 'idea.txt', 'style.json', 'cover.png', '../x.csv', 42])
  assert.deepEqual(files.map((file) => [file.rel, file.kind]), [
    ['prompts/shots.csv', 'shots'],
    ['script.fountain', 'script'],
    ['idea.txt', 'text'],
    ['style.json', 'json'],
  ])
  assert.deepEqual(templateFilesFromPackRecord('nope'), [])
  assert.equal(templateTitleFromFileName('prompts/seedance_long-shot_v2.csv'), 'seedance long-shot v2')
})
