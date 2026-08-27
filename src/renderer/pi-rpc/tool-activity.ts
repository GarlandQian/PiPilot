import type { ToolCall, Turn } from '@/types/chat'
import { truncateUtf8 } from './structured-value'

export type ToolActivityCategory =
  | 'commands'
  | 'subagents'
  | 'files'
  | 'edits'
  | 'other'

export type ToolActivityItem = {
  id: string
  category: ToolActivityCategory
  order: number
  call: ToolCall
}

export type ToolActivitySection = {
  id: string
  category: ToolActivityCategory
  items: readonly ToolActivityItem[]
  status: ToolCall['status']
  failedCount: number
}

export type ToolActivityRun = {
  id: string
  sections: readonly ToolActivitySection[]
}

export type ToolActivitySequenceItem =
  | { kind: 'turn'; id: string; turn: Turn }
  | { kind: 'activity-run'; id: string; run: ToolActivityRun }

export type ShellEvidencePresentation = {
  source: string
  defaultView: 'formatted' | 'raw'
  formattedMarkdown?: string
  truncated: boolean
}

const MAX_SHELL_EVIDENCE_BYTES = 96 * 1_024

const STATUS_PRIORITY: Record<ToolCall['status'], number> = {
  failed: 6,
  running: 5,
  queued: 4,
  detached: 3,
  cancelled: 2,
  success: 1,
}

function activityCategory(call: ToolCall): ToolActivityCategory {
  if (call.subagent) return 'subagents'
  if (call.kind === 'shell') return 'commands'
  if (call.kind === 'read') return 'files'
  if (call.kind === 'edit') return 'edits'
  return 'other'
}

function aggregateStatus(items: readonly ToolActivityItem[]): ToolCall['status'] {
  let status: ToolCall['status'] = 'success'
  for (const item of items) {
    if (STATUS_PRIORITY[item.call.status] > STATUS_PRIORITY[status]) {
      status = item.call.status
    }
  }
  return status
}

function projectActivityRun(toolTurns: readonly Extract<Turn, { kind: 'tool' }>[]): ToolActivityRun {
  const items = toolTurns.map<ToolActivityItem>((turn, order) => ({
    id: turn.call.id,
    category: activityCategory(turn.call),
    order,
    call: turn.call,
  }))
  const sections: Array<{
    id: string
    category: ToolActivityCategory
    items: ToolActivityItem[]
    status: ToolCall['status']
    failedCount: number
  }> = []

  for (const item of items) {
    const previous = sections[sections.length - 1]
    if (!previous || previous.category !== item.category) {
      sections.push({
        id: `tool-activity-section:${item.category}:${item.id}`,
        category: item.category,
        items: [item],
        status: item.call.status,
        failedCount: item.call.status === 'failed' ? 1 : 0,
      })
      continue
    }
    previous.items.push(item)
    previous.status = aggregateStatus(previous.items)
    if (item.call.status === 'failed') previous.failedCount += 1
  }

  return {
    id: `tool-activity-run:${items[0]?.id ?? 'empty'}`,
    sections,
  }
}

/**
 * Replaces only contiguous tool turns. Narrative, notices, plans, and response
 * actions retain their exact source position and split activity runs.
 */
export function projectToolActivitySequence(
  turns: readonly Turn[],
): readonly ToolActivitySequenceItem[] {
  const sequence: ToolActivitySequenceItem[] = []
  let pending: Extract<Turn, { kind: 'tool' }>[] = []

  const flush = () => {
    if (pending.length === 0) return
    const run = projectActivityRun(pending)
    sequence.push({ kind: 'activity-run', id: run.id, run })
    pending = []
  }

  for (const turn of turns) {
    if (turn.kind === 'tool') {
      pending.push(turn)
      continue
    }
    flush()
    sequence.push({ kind: 'turn', id: turn.id, turn })
  }
  flush()
  return sequence
}

function parseableJson(source: string) {
  const trimmed = source.trim()
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function hasMarkdownStructure(source: string) {
  if (/^#{1,6}\s+\S/mu.test(source)) return true
  if (/^>\s+\S/mu.test(source)) return true
  if (/^```[^\n]*$/mu.test(source)) return true
  if (/\[[^\]\n]+\]\([^\s)]+(?:\s+"[^"]*")?\)/u.test(source)) return true
  if (/^\s*\|?.+\|.+\n\s*\|?\s*:?-{3,}:?\s*\|/mu.test(source)) return true

  const listLines = source.match(/^\s*(?:[-*+] |\d+\. )\S.*$/gmu)
  return (listLines?.length ?? 0) >= 2
}

function hasTerminalShape(source: string) {
  if (/\u001b\[[0-?]*[ -/]*[@-~]/u.test(source)) return true
  if (/\r(?!\n)/u.test(source) || source.includes('\t')) return true
  if (parseableJson(source)) return true

  const lines = source.split(/\r?\n/u).filter(Boolean)
  if (lines.length < 2) return false
  const logLines = lines.filter((line) =>
    /^\s*(?:\d{4}-\d{2}-\d{2}[T\s]|\[?(?:trace|debug|info|warn|error|fatal)\]?\b)/iu.test(line),
  )
  return logLines.length >= 2 && logLines.length >= Math.ceil(lines.length / 2)
}

export function projectShellEvidence(source: string): ShellEvidencePresentation {
  const bounded = truncateUtf8(source, MAX_SHELL_EVIDENCE_BYTES)
  const formatted = hasMarkdownStructure(bounded.value) && !hasTerminalShape(bounded.value)
  return {
    source: bounded.value,
    defaultView: formatted ? 'formatted' : 'raw',
    ...(formatted ? { formattedMarkdown: bounded.value } : {}),
    truncated: bounded.truncated,
  }
}
