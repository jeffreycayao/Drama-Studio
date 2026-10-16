/** AI songwriter: prompt + strict parser. The model writes a title, style
 * tags (genre, mood, instruments, BPM), key and sectioned lyrics; the parser
 * keeps only what the music generator (ACE-Step) understands. Pure. */
import { extractJsonObject } from './llmJson.mjs'

export const SONG_SECTIONS = Object.freeze(['intro', 'verse', 'pre-chorus', 'chorus', 'bridge', 'outro', 'hook', 'interlude', 'inst'])
const KEY_SCALES = ['C major', 'G major', 'D major', 'A major', 'E major', 'F major',
  'A minor', 'E minor', 'B minor', 'D minor', 'C minor', 'F minor']

export const SONGWRITER_SYSTEM = `You are a professional songwriter and music producer for films and short dramas.
Reply with ONE JSON object and nothing else:
{"title": string, "genre": string, "tags": string, "bpm": number, "key": string, "lyrics": string}
- tags: comma-separated style tags for a music model: genre, mood, instruments, vocal type, tempo (e.g. "cinematic pop, bittersweet, piano, strings, female vocal, 92 bpm").
- key: one of ${KEY_SCALES.join(', ')}.
- lyrics: section names on their own line in square brackets: [intro], [verse], [pre-chorus], [chorus], [bridge], [outro]. Short singable lines. Repeat the chorus. No commentary.
- For an instrumental, lyrics is "".`

export function buildSongwriterPrompt({ brief, mood = '', genre = '', durationSeconds = 60, instrumental = false, language = 'English' } = {}) {
  const text = String(brief || '').trim()
  if (!text) throw new Error('Describe the scene or story the song is for.')
  const sections = durationSeconds <= 40
    ? 'verse + chorus'
    : durationSeconds <= 120 ? 'verse, chorus, verse, chorus, bridge, chorus' : 'intro, two verses with pre-choruses, choruses, bridge, final chorus, outro'
  return [`Write a song for this story moment: ${text.slice(0, 2000)}`,
    genre ? `Genre: ${genre}.` : '', mood ? `Mood: ${mood}.` : '',
    `Length about ${Math.round(durationSeconds)} seconds (${sections}).`,
    instrumental ? 'Instrumental: lyrics must be "".' : `Lyrics language: ${language}.`].filter(Boolean).join('\n')
}

function normalizeLyrics(raw) {
  const out = []
  for (const line of String(raw || '').replace(/\r\n?/g, '\n').split('\n').map(item => item.trimEnd())) {
    const section = /^\s*[[(]\s*([A-Za-z -]+?)(?:\s*\d+)?\s*[\])]\s*:?\s*$/.exec(line)
    if (section) {
      const name = section[1].toLowerCase().trim().replace(/\s+/g, '-').replace('prechorus', 'pre-chorus').replace('instrumental', 'inst')
      out.push(`[${SONG_SECTIONS.includes(name) ? name : 'verse'}]`)
    } else out.push(line.replace(/^\s*(?:\d+\.|-|\*)\s+/, ''))
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000)
}

/** → { ok, title, tags, bpm, keyScale, lyrics } or { ok: false, reason }. */
export function parseSongwriterResponse(text, { instrumental = false } = {}) {
  const data = extractJsonObject(text)
  if (!data) return { ok: false, reason: 'The model did not return a song in the expected format. Try again.' }
  const rawBpm = Number(data.bpm ?? /(\d{2,3})\s*bpm/i.exec(String(data.tags || ''))?.[1])
  const bpm = Number.isFinite(rawBpm) ? Math.min(220, Math.max(40, Math.round(rawBpm))) : 90
  const key = String(data.key || data.keyScale || '').trim().toLowerCase()
  const keyScale = KEY_SCALES.find(item => item.toLowerCase() === key) || 'C major'
  const tagParts = [data.genre, data.tags].flatMap(value => String(value || '').split(',')).map(part => part.trim()).filter(Boolean)
  if (tagParts.length && !tagParts.some(part => /\bbpm\b/i.test(part))) tagParts.push(`${bpm} bpm`)
  const tags = [...new Set(tagParts.map(part => part.toLowerCase()))].join(', ').slice(0, 400)
  const lyrics = instrumental ? '' : normalizeLyrics(data.lyrics)
  if (!tags) return { ok: false, reason: 'The song has no style tags. Try again.' }
  if (!instrumental && !/\[(verse|chorus)\]/.test(lyrics)) return { ok: false, reason: 'The lyrics have no [verse] or [chorus] sections. Try again.' }
  return { ok: true, title: String(data.title || 'Untitled').trim().slice(0, 120), tags, bpm, keyScale, lyrics }
}
