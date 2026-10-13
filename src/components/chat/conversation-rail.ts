import type { ResponsePresentation } from '@/renderer/pi-rpc/response-presentation'

export interface ConversationRailItem {
  entryId: string
  title: string
  /** The latest assistant body in this user turn, without thinking or tool output. */
  markdown: string
  status: 'pending' | 'running' | 'complete' | 'error' | 'aborted'
  label?: string
}

const RESPONSE_STATUSES: Record<ResponsePresentation['status'], ConversationRailItem['status']> = {
  idle: 'pending',
  planning: 'running',
  running: 'running',
  completed: 'complete',
  failed: 'error',
  cancelled: 'aborted',
}

/** Derive exactly one chronological tick from each navigable user prompt. */
export function projectConversationRailItems(
  responses: readonly ResponsePresentation[],
  labels: ReadonlyMap<string, string>,
): ConversationRailItem[] {
  return responses.flatMap((response) => {
    if (!response.prompt || !response.anchorEntryId) return []
    let markdown = ''
    for (let index = response.segments.length - 1; index >= 0; index -= 1) {
      const segment = response.segments[index]
      if (segment.kind === 'turn' && segment.turn.kind === 'agent' && segment.turn.markdown.trim()) {
        markdown = segment.turn.markdown
        break
      }
    }
    const label = labels.get(response.anchorEntryId)
    return [{
      entryId: response.anchorEntryId,
      title: response.prompt.text,
      markdown,
      status: RESPONSE_STATUSES[response.status],
      ...(label !== undefined ? { label } : {}),
    }]
  })
}

export interface ConversationRailPosition {
  entryId: string
  top: number
}

/** Read positions in conversation order; scrolling never changes the session branch. */
export function conversationRailReadingEntry(
  positions: readonly ConversationRailPosition[],
  readingLine: number,
  atBottom = false,
): string | null {
  const visiblePositions = positions.filter((position) => Number.isFinite(position.top))
  if (!visiblePositions.length) return null
  if (atBottom) return visiblePositions[visiblePositions.length - 1].entryId
  let current = visiblePositions[0].entryId
  for (const position of visiblePositions) {
    if (position.top > readingLine) break
    current = position.entryId
  }
  return current
}

function boundedText(text: string, limit: number) {
  const clipped = text.slice(0, limit)
  // A UTF-16 boundary must not leave half an emoji in a preview or saved label.
  return /[\uD800-\uDBFF]$/u.test(clipped) ? clipped.slice(0, -1) : clipped
}

/** Keep Markdown intact for the shared safe renderer, with a strict parsing budget. */
export function conversationRailPreview(markdown: string, limit = 1_600) {
  const source = markdown.trim()
  const budget = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 1_600
  if (source.length <= budget) return { markdown: source, truncated: false }
  return { markdown: boundedText(source, budget).trimEnd(), truncated: true }
}

/** Native Pi labels have a 120-character limit; bookmarks use the prompt as a name. */
export function conversationRailBookmarkTitle(title: string, fallback: string) {
  const normalized = title.replace(/\s+/gu, ' ').trim()
    || fallback.replace(/\s+/gu, ' ').trim()
  return boundedText(normalized, 120).trimEnd()
}
