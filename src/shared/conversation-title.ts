/** Long enough to tell conversations apart, short enough for a toolbar title. */
export const CONVERSATION_TITLE_LIMIT = 60

const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/u
const FENCE = /^(?:```|~~~)/u
const SKILL_BLOCK = /<skill\b[^>]*>[\s\S]*?<\/skill>/giu
const SKILL_NAME = /<skill\b[^>]*\bname="([^"]+)"/iu

function plainLine(line: string) {
  return line
    .replace(/^#{1,6}\s+/u, '')
    .replace(/^>\s?/u, '')
    .replace(/^(?:[-*+]|\d+[.)])\s+/u, '')
    .replace(/^\[[ xX]\]\s+/u, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/<\/?[a-z][^>]*>/giu, '')
    // Paired emphasis only, so identifiers like file_name keep their underscores.
    .replace(/(\*\*|__|~~)(.+?)\1/gu, '$2')
    .replace(/(^|[\s(])\*(\S(?:.*?\S)?)\*(?=[\s).,!?:;]|$)/gu, '$1$2')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim()
}

function shorten(text: string, limit: number) {
  if (text.length <= limit) return text
  const cut = text.slice(0, limit)
  const space = cut.lastIndexOf(' ')
  // Latin text breaks at a word; CJK text has no spaces and is cut as is.
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/**
 * A conversation title from its first message: the first meaningful line,
 * without Markdown syntax, skill instructions, rules or code blocks.
 */
export function conversationTitleFromText(text: string, limit = CONVERSATION_TITLE_LIMIT): string {
  const skill = SKILL_NAME.exec(text)?.[1]
  let fenced = false
  for (const raw of text.replace(SKILL_BLOCK, '\n').split(/\r?\n/u)) {
    const line = raw.trim()
    if (FENCE.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced || !line || RULE.test(line)) continue
    const plain = plainLine(line)
    if (plain) return shorten(plain, limit)
  }
  return skill ? `/${skill}` : ''
}
