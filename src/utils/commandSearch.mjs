/**
 * Ranking for the command palette. Pure, so it is unit tested
 * (commandSearch.test.mjs). Every query word has to match the start of a
 * word in the command's title, keywords, group or "where" text; titles count
 * most. Everyday synonyms reuse the Help Center's list ("srt" finds
 * subtitles, "dub" finds translate).
 */

import { normalizeHelpText } from './helpSearch.mjs'

const SYNONYMS = {
  srt: ['subtitles', 'subtitle'],
  vtt: ['subtitles', 'subtitle'],
  subtitles: ['captions', 'subtitle'],
  subtitle: ['captions', 'subtitles'],
  dub: ['translate', 'language'],
  dubbing: ['translate', 'language'],
  translate: ['language'],
  lipsync: ['lip', 'sync'],
  sfx: ['sound', 'effects'],
  song: ['music'],
  duck: ['ducking', 'duck'],
  beat: ['beats'],
  render: ['export'],
  prefs: ['settings'],
  preferences: ['settings'],
  ai: ['generate'],
  voice: ['lip', 'dialogue'],
  frame: ['still', 'last'],
  screenshot: ['still', 'capture'],
  upscale: ['upscale', 'topaz'],
  tour: ['tour', 'guided'],
  doctor: ['setup', 'doctor'],
}

function words(text) {
  return normalizeHelpText(text).split(' ').filter(Boolean)
}

function indexCommand(command) {
  return {
    title: words(command.title),
    rest: words([command.group, command.where, ...(command.keywords || [])].filter(Boolean).join(' ')),
  }
}

function tokenScore(index, token) {
  const prefix = (list) => list.some((word) => word.startsWith(token))
  const exact = (list) => list.includes(token)
  if (exact(index.title)) return 6
  if (prefix(index.title)) return 4
  if (exact(index.rest)) return 3
  if (prefix(index.rest)) return 2
  return 0
}

/**
 * @param {Array} commands
 * @param {string} query
 * @returns {Array} matching commands, best first (input order on ties).
 *   An empty query returns the commands unchanged.
 */
export function rankCommands(commands = [], query = '') {
  const tokens = words(query)
  if (tokens.length === 0) return [...commands]
  const scored = []
  commands.forEach((command, order) => {
    const index = indexCommand(command)
    let total = 0
    for (const token of tokens) {
      let value = tokenScore(index, token)
      if (value === 0) {
        value = Math.max(0, ...(SYNONYMS[token] || []).map((alt) => tokenScore(index, alt))) * 0.7
      }
      if (value === 0) return
      total += value
    }
    // A title that starts with the whole query is what the user is typing.
    if (normalizeHelpText(command.title).startsWith(normalizeHelpText(query))) total += 5
    scored.push({ command, total, order })
  })
  scored.sort((left, right) => right.total - left.total || left.order - right.order)
  return scored.map((item) => item.command)
}

/** Most recent first, unique, at most `limit`. */
export function pushRecentCommand(recent = [], id, limit = 6) {
  return [id, ...recent.filter((item) => item !== id)].slice(0, limit)
}
