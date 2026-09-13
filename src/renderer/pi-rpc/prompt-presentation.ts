export interface PromptSkillEnvelope {
  name: string
  location: string
  content: string
  userMessage: string
}

/** Read the SDK's leading skill envelope as presentation metadata only. */
export function parsePromptSkillEnvelope(text: string): PromptSkillEnvelope | null {
  const header = /^<skill name="([^"\r\n]+)" location="([^"\r\n]+)">\n/u.exec(text)
  if (!header) return null

  const contentStart = header[0].length
  let lineStart = contentStart
  let fence: { marker: string; length: number } | null = null
  while (lineStart < text.length) {
    const newline = text.indexOf('\n', lineStart)
    const lineEnd = newline === -1 ? text.length : newline
    const line = text.slice(lineStart, lineEnd)

    if (!fence && line === '</skill>') {
      const remainder = text.slice(lineEnd)
      if (lineStart === contentStart || (remainder !== '' &&
        (!remainder.startsWith('\n\n') || remainder.length === 2))) return null
      return {
        name: header[1],
        location: header[2],
        content: text.slice(contentStart, lineStart - 1),
        userMessage: remainder === '' ? '' : remainder.slice(2),
      }
    }

    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line)
    if (delimiter) {
      const marker = delimiter[1][0]
      if (fence) {
        if (marker === fence.marker && delimiter[1].length >= fence.length &&
          /^[ \t]*$/u.test(delimiter[2])) fence = null
      } else if (marker !== '`' || !delimiter[2].includes('`')) {
        fence = { marker, length: delimiter[1].length }
      }
    }
    if (newline === -1) break
    lineStart = newline + 1
  }
  return null
}

/** A readable tooltip without exposing the SDK envelope or changing its source. */
export function promptDisplaySummary(text: string): string {
  const skill = parsePromptSkillEnvelope(text)
  return skill ? `${skill.name}${skill.userMessage ? ` · ${skill.userMessage}` : ''}` : text
}
