import assert from 'node:assert/strict'
import test from 'node:test'
import { parseFountain, parseFdx, parseScreenplay, parseSceneHeading, toFountain, summarizeScreenplay } from './screenplayParser.mjs'

const fountain = `Title: Last Bus Home
Author: J. Cayao

INT. ROADSIDE MOTEL ROOM - NIGHT #1#

Rain hammers the window. MAYA (30s) paces, phone in hand.
[[note: keep it tense]]

MAYA
(whispering)
He's outside. I can see his car.

DANNY (V.O.) ^
Don't open the door.

/* cut this later
BOONEYARD
nothing */

CUT TO:

EXT. PARKING LOT - CONTINUOUS

A *single* headlight flickers.

.FLASHBACK - THE PIER

@McCLANE
Yippee ki-yay.

>THE END<
`

test('Fountain: title page, scenes, dialogue, extensions, parentheticals, dual, transitions', () => {
  const play = parseFountain(fountain)
  assert.equal(play.title, 'Last Bus Home')
  assert.equal(play.titlePage.author, 'J. Cayao')
  assert.deepEqual(play.scenes.map(scene => scene.heading), ['INT. ROADSIDE MOTEL ROOM - NIGHT', 'EXT. PARKING LOT - CONTINUOUS', 'FLASHBACK - THE PIER'])
  const [first] = play.scenes
  assert.equal(first.intExt, 'INT')
  assert.equal(first.location, 'ROADSIDE MOTEL ROOM')
  assert.equal(first.timeOfDay, 'NIGHT')
  assert.equal(first.number, '1')
  assert.equal(first.elements[0].text, 'Rain hammers the window. MAYA (30s) paces, phone in hand.', 'notes removed')
  const maya = first.elements.find(item => item.character === 'MAYA')
  assert.equal(maya.parenthetical, '(whispering)')
  assert.equal(maya.text, "He's outside. I can see his car.")
  const danny = first.elements.find(item => item.character === 'DANNY')
  assert.equal(danny.extension, 'V.O.')
  assert.equal(danny.dual, true)
  assert.ok(!JSON.stringify(play).includes('BOONEYARD'), 'boneyard removed')
  assert.deepEqual(first.elements.at(-1), { type: 'transition', text: 'CUT TO:' })
  assert.equal(play.scenes[1].elements[0].text, 'A single headlight flickers.', 'emphasis stripped')
  assert.equal(play.scenes[2].elements[0].character, 'McCLANE', 'forced character')
  assert.deepEqual(play.scenes[2].elements.at(-1), { type: 'centered', text: 'THE END' })
  assert.deepEqual(play.characters.sort(), ['DANNY', 'MAYA', 'McCLANE'])
  assert.deepEqual(summarizeScreenplay(play), { scenes: 3, characters: 3, dialogueLines: 3 })
})

test('plain text without a title page still parses; all-caps action is not a character without dialogue after it', () => {
  const play = parseFountain('INT. KITCHEN - DAY\n\nBANG!\n\nTOM\nWho is there?\n')
  assert.equal(play.title, null)
  assert.equal(play.scenes[0].elements[0].type, 'action')
  assert.equal(play.scenes[0].elements[1].character, 'TOM')
})

test('Fountain round-trips through toFountain', () => {
  const play = parseFountain(fountain)
  const again = parseFountain(toFountain(play))
  assert.deepEqual(again.scenes.map(scene => [scene.heading, scene.elements.length]), play.scenes.map(scene => [scene.heading, scene.elements.length]))
  assert.deepEqual(again.characters.sort(), play.characters.sort())
})

const fdx = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
    <Paragraph Number="4" Type="Scene Heading"><Text>EXT. ROOFTOP - DAWN</Text></Paragraph>
    <Paragraph Type="Action"><Text>Wind. </Text><Text Style="Bold">Sirens</Text><Text> below.</Text></Paragraph>
    <Paragraph Type="Character"><Text>LENA (CONT'D)</Text></Paragraph>
    <Paragraph Type="Parenthetical"><Text>(to herself)</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>Ten floors &amp; no way down.</Text></Paragraph>
    <Paragraph Type="Transition"><Text>SMASH CUT TO:</Text></Paragraph>
  </Content>
  <TitlePage><Content><Paragraph><Text>Rooftop</Text></Paragraph></Content></TitlePage>
</FinalDraft>`

test('Final Draft: scene numbers, styled runs, characters, parentheticals, entities', () => {
  const play = parseScreenplay(fdx, 'rooftop.fdx')
  assert.equal(play.format, 'fdx')
  assert.equal(play.title, 'Rooftop')
  const [scene] = play.scenes
  assert.equal(scene.heading, 'EXT. ROOFTOP - DAWN')
  assert.equal(scene.number, '4')
  assert.equal(scene.elements[0].text, 'Wind. Sirens below.')
  assert.deepEqual(scene.elements[1], { type: 'dialogue', character: 'LENA', extension: "CONT'D", parenthetical: '(to herself)', text: 'Ten floors & no way down.', dual: false })
  assert.equal(scene.elements[2].type, 'transition')
  assert.match(toFountain(play), /^EXT\. ROOFTOP - DAWN #4#$/m)
  assert.throws(() => parseFdx('<html></html>'), /not a Final Draft/)
})

test('scene headings: I/E, INT./EXT., forced headings without time of day', () => {
  assert.equal(parseSceneHeading('I/E. CAR - MOVING - DAY').intExt, 'I/E')
  assert.equal(parseSceneHeading('INT./EXT. HOUSE - NIGHT').intExt, 'INT./EXT')
  assert.deepEqual(parseSceneHeading('.DREAMSCAPE'), { heading: 'DREAMSCAPE', intExt: null, location: 'DREAMSCAPE', timeOfDay: null, number: null })
})
