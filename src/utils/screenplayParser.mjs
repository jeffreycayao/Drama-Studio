/**
 * Screenplay import: Fountain (.fountain, plain text) and Final Draft (.fdx)
 * into one structured model, plus a Fountain writer. Pure and deterministic;
 * no network or LLM. Used by Short Film's script import and the Idea Pad.
 *
 * @typedef {{ type: 'action'|'dialogue'|'transition'|'lyric'|'centered',
 *   text: string, character?: string, extension?: string|null,
 *   parenthetical?: string|null, dual?: boolean }} ScreenplayElement
 * @typedef {{ heading: string, intExt: string|null, location: string,
 *   timeOfDay: string|null, number: string|null, elements: ScreenplayElement[] }} ScreenplayScene
 * @typedef {{ title: string|null, titlePage: Record<string,string>,
 *   scenes: ScreenplayScene[], characters: string[], format: 'fountain'|'fdx' }} Screenplay
 */

const MAX_SOURCE_CHARS = 2_000_000
const HEADING = /^(?:INT\.?\/EXT|INT\/EXT|I\/E|EXT\.?\/INT|INT|EXT|EST)[.\s]/i
const TRANSITION = /^[A-Z0-9 .'-]+TO:$/

/** "INT. MOTEL ROOM - NIGHT #12#" → parts. */
export function parseSceneHeading(raw) {
  let heading = String(raw || '').trim().replace(/^\.(?!\.)/, '').trim()
  let number = null
  const numbered = /\s*#([^#\s]+)#\s*$/.exec(heading)
  if (numbered) { number = numbered[1]; heading = heading.slice(0, numbered.index).trim() }
  const prefix = /^(INT\.?\/EXT\.?|INT\/EXT|I\/E|EXT\.?\/INT\.?|INT\.?|EXT\.?|EST\.?)\s*/i.exec(heading)
  const intExt = prefix ? prefix[1].replace(/\.$/, '').toUpperCase() : null
  const rest = prefix ? heading.slice(prefix[0].length) : heading
  const dash = rest.lastIndexOf(' - ')
  const location = (dash >= 0 ? rest.slice(0, dash) : rest).trim()
  const timeOfDay = dash >= 0 ? rest.slice(dash + 3).trim() || null : null
  return { heading, intExt, location, timeOfDay, number }
}

const clean = text => String(text || '')
  .replace(/\[\[[\s\S]*?\]\]/g, '') // notes
  .replace(/(\*{1,3}|_)(?=\S)([^*_\n]+?)(?<=\S)\1/g, '$2') // emphasis
  .replace(/\\([*_])/g, '$1')
  .trim()

function isCharacterLine(line, next) {
  if (!next || !next.trim()) return false
  if (line.startsWith('@')) return true
  const name = line.replace(/\s*\^$/, '').replace(/\s*\(.*\)\s*$/, '').trim()
  return name.length > 0 && name.length <= 50 && /[A-Z]/.test(name) && name === name.toUpperCase()
    && !/^[!.>~=#]/.test(line) && !TRANSITION.test(line.trim()) && !HEADING.test(line)
}

/** Parse Fountain text. Tolerant of plain screenplay text without a title page. */
export function parseFountain(source) {
  let text = String(source || '').slice(0, MAX_SOURCE_CHARS).replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
  text = text.replace(/\/\*[\s\S]*?\*\//g, '') // boneyard
  const lines = text.split('\n')
  const titlePage = {}
  let index = 0
  // Title page: "Key: value" lines at the very top, ended by a blank line.
  if (/^[A-Za-z][A-Za-z ]{0,30}:/.test(lines[0] || '') && !HEADING.test(lines[0])) {
    let key = null
    for (; index < lines.length && lines[index].trim(); index += 1) {
      const pair = /^([A-Za-z][A-Za-z ]{0,30}):\s*(.*)$/.exec(lines[index])
      if (pair) { key = pair[1].trim().toLowerCase(); titlePage[key] = pair[2].trim() }
      else if (key) titlePage[key] = `${titlePage[key]} ${lines[index].trim()}`.trim()
    }
  }
  const scenes = []
  const characters = new Set()
  let scene = null
  const ensureScene = () => {
    if (!scene) { scene = { heading: '', intExt: null, location: '', timeOfDay: null, number: null, elements: [] }; scenes.push(scene) }
    return scene
  }
  let action = []
  const flushAction = () => {
    const body = clean(action.join('\n'))
    if (body) ensureScene().elements.push({ type: 'action', text: body })
    action = []
  }
  for (; index < lines.length; index += 1) {
    const raw = lines[index]
    const line = raw.trim()
    const previousBlank = index === 0 || !lines[index - 1].trim()
    if (!line) { flushAction(); continue }
    if (/^#{1,6}\s/.test(line) || /^=(?!=)/.test(line) || /^={3,}$/.test(line)) { flushAction(); continue } // sections, synopses, page breaks
    if (previousBlank && (HEADING.test(line) || /^\.(?!\.)\S/.test(line))) {
      flushAction()
      scene = { ...parseSceneHeading(line), elements: [] }
      scenes.push(scene)
      continue
    }
    if (/^>.*<$/.test(line)) { flushAction(); ensureScene().elements.push({ type: 'centered', text: clean(line.slice(1, -1)) }); continue }
    if (previousBlank && (line.startsWith('>') || TRANSITION.test(line))) {
      flushAction(); ensureScene().elements.push({ type: 'transition', text: clean(line.replace(/^>\s*/, '')) }); continue
    }
    if (line.startsWith('~')) { flushAction(); ensureScene().elements.push({ type: 'lyric', text: clean(line.slice(1)) }); continue }
    if (line.startsWith('!')) { action.push(line.slice(1)); continue }
    if (previousBlank && isCharacterLine(line, lines[index + 1])) {
      flushAction()
      const dual = /\^\s*$/.test(line)
      const bare = line.replace(/^@/, '').replace(/\s*\^\s*$/, '')
      const extension = /\(([^)]*)\)\s*$/.exec(bare)?.[1]?.trim() || null
      const character = bare.replace(/\s*\([^)]*\)\s*$/, '').trim()
      characters.add(character)
      let parenthetical = null
      const speech = []
      for (index += 1; index < lines.length && lines[index].trim(); index += 1) {
        const part = lines[index].trim()
        if (/^\(.*\)$/.test(part)) {
          if (!speech.length && !parenthetical) parenthetical = part
          else speech.push(part)
        } else speech.push(part)
      }
      index -= 1
      ensureScene().elements.push({ type: 'dialogue', character, extension, parenthetical, text: clean(speech.join(' ')), dual })
      continue
    }
    action.push(raw.replace(/^\s{0,3}/, ''))
  }
  flushAction()
  return { title: titlePage.title || null, titlePage, scenes: scenes.filter(item => item.heading || item.elements.length),
    characters: [...characters], format: 'fountain' }
}

const decode = value => String(value || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&amp;/g, '&')

/** Parse Final Draft XML. Regex-based (works in Node and the renderer);
 * only Paragraph/Text elements are read, nothing is executed or fetched. */
export function parseFdx(source) {
  const xml = String(source || '').slice(0, MAX_SOURCE_CHARS)
  if (!/<FinalDraft[\s>]/.test(xml)) throw new Error('This is not a Final Draft (.fdx) file.')
  const content = /<Content>([\s\S]*?)<\/Content>/.exec(xml)?.[1] || ''
  const lines = []
  for (const match of content.matchAll(/<Paragraph\b([^>]*)>([\s\S]*?)<\/Paragraph>/g)) {
    const type = /\bType="([^"]*)"/.exec(match[1])?.[1] || 'Action'
    const text = decode([...match[2].matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/g)].map(part => part[1]).join('')).trim()
    const number = /\bNumber="([^"]*)"/.exec(match[1])?.[1] || null
    if (text) lines.push({ type, text, number })
  }
  const scenes = [], characters = new Set()
  let scene = null, pending = null
  const ensureScene = () => { if (!scene) { scene = { heading: '', intExt: null, location: '', timeOfDay: null, number: null, elements: [] }; scenes.push(scene) } return scene }
  for (const line of lines) {
    if (line.type === 'Scene Heading') { scene = { ...parseSceneHeading(line.text), number: line.number || null, elements: [] }; scenes.push(scene); pending = null; continue }
    if (line.type === 'Character') {
      const extension = /\(([^)]*)\)\s*$/.exec(line.text)?.[1]?.trim() || null
      const character = line.text.replace(/\s*\([^)]*\)\s*$/, '').trim()
      characters.add(character)
      pending = { type: 'dialogue', character, extension, parenthetical: null, text: '', dual: false }
      ensureScene().elements.push(pending)
      continue
    }
    if (line.type === 'Parenthetical' && pending) { if (!pending.text) pending.parenthetical = line.text; else pending.text += ` ${line.text}`; continue }
    if (line.type === 'Dialogue' && pending) { pending.text = `${pending.text} ${line.text}`.trim(); continue }
    pending = null
    if (line.type === 'Transition') ensureScene().elements.push({ type: 'transition', text: line.text })
    else ensureScene().elements.push({ type: 'action', text: line.text })
  }
  const title = decode(/<TitlePage>[\s\S]*?<Text[^>]*>([^<]+)<\/Text>/.exec(xml)?.[1] || '').trim() || null
  return { title, titlePage: title ? { title } : {}, scenes, characters: [...characters], format: 'fdx' }
}

/** Pick the parser from the file name or content. */
export function parseScreenplay(source, fileName = '') {
  const text = String(source || '')
  if (/\.fdx$/i.test(fileName) || /<FinalDraft[\s>]/.test(text.slice(0, 2000))) return parseFdx(text)
  return parseFountain(text)
}

/** Write Fountain. Readable as plain screenplay text too (Short Film input). */
export function toFountain(screenplay, { includeTitlePage = true } = {}) {
  const out = []
  if (includeTitlePage && screenplay?.title) out.push(`Title: ${screenplay.title}`, '')
  for (const scene of screenplay?.scenes || []) {
    if (scene.heading) {
      const heading = HEADING.test(`${scene.heading} `) ? scene.heading : `.${scene.heading}`
      out.push(`${heading}${scene.number ? ` #${scene.number}#` : ''}`, '')
    }
    for (const element of scene.elements || []) {
      if (element.type === 'dialogue') {
        const name = element.character || 'UNKNOWN'
        const forced = name !== name.toUpperCase() ? '@' : ''
        out.push(`${forced}${name}${element.extension ? ` (${element.extension})` : ''}${element.dual ? ' ^' : ''}`)
        if (element.parenthetical) out.push(element.parenthetical)
        out.push(element.text || '...', '')
      } else if (element.type === 'transition') out.push(`> ${element.text}`, '')
      else if (element.type === 'centered') out.push(`>${element.text}<`, '')
      else if (element.type === 'lyric') out.push(`~${element.text}`, '')
      else out.push(element.text, '')
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

export function summarizeScreenplay(screenplay) {
  const elements = (screenplay?.scenes || []).flatMap(scene => scene.elements)
  return { scenes: screenplay?.scenes?.length || 0, characters: screenplay?.characters?.length || 0,
    dialogueLines: elements.filter(item => item.type === 'dialogue').length }
}
