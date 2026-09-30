import { findTextMatches, searchSnippet } from '@/shared/conversation-search'
import type { ToolCall, Turn } from '@/types/chat'

export interface TranscriptSearchHit {
  id: string
  anchorEntryId: string
  kind: 'user' | 'assistant' | 'toolResult'
  toolCallId?: string
  snippet: string
  matchStart: number
  matchLength: number
}

export function searchTranscript(turns: readonly Turn[], query: string) {
  const hits: TranscriptSearchHit[] = []
  for (const turn of turns) {
    if (!turn.anchorEntryId) continue
    const kind = turn.kind === 'user' ? 'user' : turn.kind === 'agent' || turn.kind === 'plan' ? 'assistant' : turn.kind === 'tool' ? 'toolResult' : null
    if (!kind) continue
    const text = turn.kind === 'user' ? turn.text : turn.kind === 'agent' || turn.kind === 'plan' ? turn.markdown
      : turn.kind === 'tool' ? [turn.call.title, turn.call.body, turn.call.progress, turn.call.output, turn.call.error, turn.call.patch].filter(Boolean).join('\n') : ''
    for (const match of findTextMatches(text, query, 501)) {
      if (hits.length >= 500) return { hits, limited: true }
      hits.push({ id: `${turn.id}:${match.start}`, anchorEntryId: turn.anchorEntryId, kind, ...(turn.kind === 'tool' ? { toolCallId: turn.call.id } : {}), ...searchSnippet(text, match.start, match.length) })
    }
  }
  return { hits, limited: false }
}

export interface ToolSearchRequest { sequence: number; query: string; toolCallId?: string }
export function toolMatchesSearch(call: ToolCall, request?: ToolSearchRequest) {
  if (!request) return false
  if (request.toolCallId) return call.id === request.toolCallId
  return findTextMatches([call.title, call.body, call.progress, call.output, call.error, call.patch].filter(Boolean).join('\n'), request.query, 1).length > 0
}

/** Native ranges preserve React ownership and Markdown formatting. */
export function highlightSearchText(root: HTMLElement, query: string) {
  if (typeof Highlight === 'undefined' || !CSS.highlights) return () => undefined
  let current: Highlight | undefined
  let frame: number | undefined
  const refresh = () => {
    frame = undefined
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement
        return parent && !parent.closest('button,script,style,[aria-hidden="true"]') && parent.checkVisibility()
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
      },
    })
    const nodes: { node: Text; start: number; end: number }[] = []
    let text = ''
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      nodes.push({ node, start: text.length, end: text.length + node.length })
      text += node.data
    }
    const highlight = new Highlight()
    for (const match of findTextMatches(text, query, 100)) {
      const start = nodes.find((part) => part.end > match.start)
      const end = nodes.find((part) => part.end >= match.start + match.length)
      if (!start || !end) continue
      const range = new Range()
      range.setStart(start.node, match.start - start.start)
      range.setEnd(end.node, match.start + match.length - end.start)
      highlight.add(range)
    }
    CSS.highlights.set('pipilot-search', highlight)
    current = highlight
  }
  refresh()
  const observer = new MutationObserver(() => { if (frame === undefined) frame = requestAnimationFrame(refresh) })
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'data-state', 'aria-hidden'] })
  // Dialog closing animations can temporarily hide the entire workbench from
  // accessibility after navigation has already installed this highlight.
  for (let ancestor = root.parentElement; ancestor; ancestor = ancestor.parentElement) {
    observer.observe(ancestor, { attributes: true, attributeFilter: ['aria-hidden', 'hidden', 'class', 'style'] })
  }
  return () => {
    observer.disconnect()
    if (frame !== undefined) cancelAnimationFrame(frame)
    if (CSS.highlights.get('pipilot-search') === current) CSS.highlights.delete('pipilot-search')
  }
}
