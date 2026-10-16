/** First JSON object in a model reply: plain, inside ```json fences, or
 * surrounded by prose. Returns null instead of throwing. */
export function extractJsonObject(text) {
  const source = String(text || '')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(source)
  for (const candidate of [fenced?.[1], source]) {
    if (!candidate) continue
    const start = candidate.indexOf('{')
    if (start < 0) continue
    let depth = 0, inString = false, escaped = false
    for (let index = start; index < candidate.length; index += 1) {
      const char = candidate[index]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') inString = true
      else if (char === '{') depth += 1
      else if (char === '}' && --depth === 0) {
        try {
          const value = JSON.parse(candidate.slice(start, index + 1))
          return value && typeof value === 'object' && !Array.isArray(value) ? value : null
        } catch { break }
      }
    }
  }
  return null
}
