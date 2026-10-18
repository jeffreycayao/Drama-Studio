// Splits an assistant reply into readable text and raw tool output.
// Some models (local ones in particular) echo tool results back into their
// reply as "TOOL RESULT: { ... }" or as fenced JSON. The chat shows those
// chunks behind a collapsed "Details" toggle instead of in the message body.

const RESULT_LABEL = /^[ \t>*_-]*(?:\*\*)?(?:drama studio )?tool (?:result|output|response)(?: for [\w.-]+)?\s*[:：]?\s*(?:\*\*)?\s*[:：-]?\s*/i
const FENCE = /^```([\w-]*)[ \t]*$/

// Index just past the bracket that closes the one at `start`, or -1.
function matchBracket(text, start) {
  const open = text[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (char === '\\') index += 1
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === open) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return -1
}

function looksLikeJson(text) {
  const value = String(text || '').trim()
  if (!/^[[{]/.test(value)) return false
  try {
    JSON.parse(value)
    return true
  } catch {
    // Truncated or loosely formatted output still counts when it is mostly
    // keys and punctuation.
    return /"[\w\s-]+"\s*:/.test(value) && value.length > 40
  }
}

function pushText(segments, text) {
  if (!text) return
  const last = segments[segments.length - 1]
  if (last && last.type === 'text') last.content += text
  else segments.push({ type: 'text', content: text })
}

/**
 * @param {string} text
 * @returns {Array<{ type: 'text' | 'raw', content: string, label?: string }>}
 */
export function splitAssistantContent(text) {
  const source = String(text || '')
  const lines = source.split('\n')
  const segments = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]

    // Fenced block: hide it when it holds JSON or is tagged as tool output.
    const fence = line.trim().match(FENCE)
    if (fence) {
      let end = index + 1
      while (end < lines.length && !/^```\s*$/.test(lines[end].trim())) end += 1
      const body = lines.slice(index + 1, end).join('\n')
      const tag = fence[1].toLowerCase()
      if (tag === 'json' || /tool/.test(tag) || looksLikeJson(body)) {
        segments.push({ type: 'raw', label: 'Details', content: body.trim() })
        index = Math.min(end + 1, lines.length)
        continue
      }
      pushText(segments, `${lines.slice(index, Math.min(end + 1, lines.length)).join('\n')}\n`)
      index = Math.min(end + 1, lines.length)
      continue
    }

    // "TOOL RESULT: {...}" or a bare JSON object on its own line.
    const labelMatch = line.match(RESULT_LABEL)
    const afterLabel = labelMatch ? line.slice(labelMatch[0].length) : line
    const trimmedStart = afterLabel.trimStart()
    if ((labelMatch || /^\s*[[{]/.test(line)) && /^[[{]/.test(trimmedStart)) {
      const rest = [afterLabel, ...lines.slice(index + 1)].join('\n')
      const open = rest.indexOf(trimmedStart[0])
      const close = matchBracket(rest, open)
      const candidate = close === -1 ? rest.slice(open) : rest.slice(open, close)
      if (labelMatch || looksLikeJson(candidate)) {
        segments.push({ type: 'raw', label: 'Tool result', content: candidate.trim() })
        const remainder = close === -1 ? '' : rest.slice(close)
        const consumed = remainder.split('\n')
        // Re-queue whatever followed the closing bracket on its line.
        lines.splice(index, lines.length - index, ...consumed)
        if (!consumed[0].trim()) lines.splice(index, 1)
        continue
      }
    }
    if (labelMatch && !trimmedStart) {
      // Label on its own line; the payload follows on the next lines.
      let next = index + 1
      while (next < lines.length && !lines[next].trim()) next += 1
      if (next < lines.length && /^\s*([[{]|```)/.test(lines[next])) {
        lines.splice(index, next - index)
        if (/^\s*[[{]/.test(lines[index])) lines[index] = `TOOL RESULT: ${lines[index].trimStart()}`
        continue
      }
    }

    pushText(segments, `${line}${index < lines.length - 1 ? '\n' : ''}`)
    index += 1
  }

  return segments
    .map((segment) => (segment.type === 'text'
      ? { ...segment, content: segment.content.replace(/\n{3,}/g, '\n\n').trim() }
      : segment))
    .filter((segment) => segment.content.trim())
}

export function hasRawSegments(text) {
  return splitAssistantContent(text).some((segment) => segment.type === 'raw')
}
