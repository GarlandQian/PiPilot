import { MAX_REFERENCE_TEXT, type PrecisionReference } from './precision-reference'
import { parsePromptSkillEnvelope } from '../pi-rpc/prompt-presentation'
import { parseConversationPlanKickoff } from '@/shared/conversation-task'

/** The visible question, without injected skill instructions or plan runtime metadata. */
export function userMessageMarkdown(text: string, planLabel: (title: string) => string): string {
  const kickoff = parseConversationPlanKickoff(text)
  return kickoff ? planLabel(kickoff.title) : parsePromptSkillEnvelope(text)?.userMessage ?? text
}

export function messageSnapshotIsCurrent(snapshot: { ownerKey?: string; sourceId: string } | null, ownerKey: string | undefined, sourceId: string): boolean {
  return snapshot !== null && snapshot.ownerKey === ownerKey && snapshot.sourceId === sourceId
}

/** Snapshot only a selection wholly inside this message, never a neighbouring turn. */
export function messageSelectionText(root: HTMLElement, selection: Selection | null): string | null {
  if (!selection?.rangeCount || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const text = selection.toString()
  return text.trim() ? text : null
}

export function messageReference(source: Pick<PrecisionReference, 'sourceId' | 'label'>, ownerKey: string | undefined, text: string): PrecisionReference | null {
  if (!ownerKey || !text.trim() || text.length > MAX_REFERENCE_TEXT) return null
  return { id: crypto.randomUUID(), ownerKey, kind: 'message', sourceId: source.sourceId, label: source.label, text }
}
