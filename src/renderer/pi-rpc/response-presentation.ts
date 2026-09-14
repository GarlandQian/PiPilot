import type {
  AgentStatus,
  ConversationResponseGroup,
  Turn,
} from '@/types/chat'
import {
  projectToolActivitySequence,
  type ToolActivitySequenceItem,
} from './tool-activity'
import { groupConversationTurns } from './presentation'

export type ResponsePresentationRegion = 'work' | 'answer' | 'persistent'

/** Keep these as keyed siblings when a live answer becomes work commentary. */
export type ResponsePresentationSegment = ToolActivitySequenceItem & {
  region: ResponsePresentationRegion
}

export interface ResponseWorkSummary {
  /** Number of original work turns, before adjacent tools are grouped. */
  count: number
  toolCount: number
  /** Independent thinking records, excluded from count and toolCount. */
  thinkingCount: number
  activeToolCount: number
  failedToolCount: number
  cancelledToolCount: number
  /** Observable activity, including independently visible live thinking. */
  hasActiveWork: boolean
}

export interface ResponsePresentation {
  id: string
  anchorEntryId?: string
  prompt: Extract<Turn, { kind: 'user' }> | null
  segments: readonly ResponsePresentationSegment[]
  /** An answer candidate, not a claim that the response has completed. */
  answerId: string | null
  isActive: boolean
  /** Inactive, unfinished snapshots use idle because no terminal outcome is known. */
  status: AgentStatus
  work: ResponseWorkSummary
}

export interface ResponsePresentationOptions {
  /** Whether this group owns the current session status. */
  active: boolean
  status: AgentStatus
}

function answerCandidateId(turns: readonly Turn[]): string | null {
  let candidate: string | null = null
  for (const turn of turns) {
    // A later tool proves earlier text was commentary. The same boundary is
    // needed for unexpected additional prompts in an already grouped input.
    if (turn.kind === 'tool' || turn.kind === 'user') candidate = null
    if (turn.kind === 'agent' && turn.markdown.trim()) candidate = turn.id
  }
  return candidate
}

function regionForTurn(
  turn: Turn,
  answerId: string | null,
): ResponsePresentationRegion {
  if (turn.kind === 'agent' && turn.id === answerId) return 'answer'
  switch (turn.kind) {
    case 'tool':
      return 'work'
    case 'agent':
      // Partial text carries its own failure/abort label in the renderer.
      return turn.state === 'error' || turn.state === 'aborted'
        ? 'persistent'
        : 'work'
    case 'activity':
      return turn.activity.kind === 'notification' ||
        turn.activity.kind === 'extension-error' ||
        (turn.activity.kind === 'retry' && turn.activity.phase === 'error')
        ? 'persistent'
        : 'work'
    case 'user':
    case 'thinking':
    case 'notice':
    case 'plan':
    case 'response-actions':
      return 'persistent'
  }
}

function turnHasActiveWork(turn: Turn): boolean {
  if (turn.kind === 'agent' || turn.kind === 'thinking') return turn.state === 'streaming'
  if (turn.kind === 'tool') return turn.call.status === 'running' || turn.call.status === 'queued'
  if (turn.kind === 'activity') return turn.activity.state === 'active'
  return false
}

function isFailureStatus(status: AgentStatus): boolean {
  return status === 'failed' || status === 'cancelled'
}

function responseStatus(
  turns: readonly Turn[],
  options: ResponsePresentationOptions,
): AgentStatus {
  if (options.active && options.status !== 'idle') return options.status

  // Historical groups must not inherit the latest response's running state.
  // Later assistant text can recover a failed tool; terminal notices still
  // win when they follow a partial or completed answer. Copy/fork controls do
  // not establish completion and cannot override these observed outcomes.
  let status: AgentStatus = 'idle'
  for (const turn of turns) {
    if (turn.kind === 'agent' && turn.markdown.trim()) {
      status = turn.state === 'error'
        ? 'failed'
        : turn.state === 'aborted'
          ? 'cancelled'
          : turn.state === 'streaming'
            ? 'running'
            : 'completed'
    } else if (turn.kind === 'tool') {
      status = turn.call.status === 'failed'
        ? 'failed'
        : turn.call.status === 'cancelled'
          ? 'cancelled'
          : turn.call.status === 'running' || turn.call.status === 'queued'
            ? 'running'
            : isFailureStatus(status)
              ? status
              : 'completed'
    } else if (turn.kind === 'notice') {
      if (turn.notice === 'response-error') status = 'failed'
      if (turn.notice === 'response-aborted') status = 'cancelled'
    } else if (turn.kind === 'plan') {
      status = turn.lifecycle === 'planning' ? 'planning' : 'completed'
    } else if (turn.kind === 'thinking') {
      if (turn.state === 'error') status = 'failed'
      else if (turn.state === 'aborted') status = 'cancelled'
      else if (turn.state === 'streaming') status = 'running'
      else if (status === 'idle') status = 'completed'
    }
  }
  // A historical streaming snapshot only proves it was unfinished when
  // captured. Preserve that source evidence without claiming it still runs.
  return !options.active && status === 'running' ? 'idle' : status
}

/**
 * Projects one user-led response without rewriting its transcript. Only the
 * leading prompt is extracted; every remaining source turn stays in order.
 * Persistent cards and notices stay visible when work is collapsed. Copy and
 * fork actions remain authoritative source turns, including their provenance.
 *
 * The flat sequence deliberately avoids moving streamed text between separate
 * work/answer parents when a subsequent tool reveals that text was commentary.
 * Thinking is included only when an actual thinking turn exists in the input,
 * and its own disclosure always remains outside the work-log collapse.
 */
export function projectResponsePresentation(
  group: ConversationResponseGroup,
  options: ResponsePresentationOptions,
): ResponsePresentation {
  const first = group.turns[0]
  const prompt = first?.kind === 'user' ? first : null
  const turns = prompt ? group.turns.slice(1) : group.turns
  const answerId = answerCandidateId(turns)
  const isActive = options.active &&
    (options.status === 'running' || options.status === 'planning')
  const work: ResponseWorkSummary = {
    count: 0,
    toolCount: 0,
    thinkingCount: 0,
    activeToolCount: 0,
    failedToolCount: 0,
    cancelledToolCount: 0,
    hasActiveWork: false,
  }

  for (const turn of turns) {
    if (turn.kind === 'thinking') work.thinkingCount += 1
    work.hasActiveWork ||= isActive && turnHasActiveWork(turn)
    if (regionForTurn(turn, answerId) !== 'work') continue
    work.count += 1
    if (turn.kind === 'tool') {
      work.toolCount += 1
      if (turn.call.status === 'running' || turn.call.status === 'queued') work.activeToolCount += 1
      if (turn.call.status === 'failed') work.failedToolCount += 1
      if (turn.call.status === 'cancelled') work.cancelledToolCount += 1
    }
  }

  const segments = projectToolActivitySequence(turns).map<ResponsePresentationSegment>((item) => ({
    ...item,
    region: item.kind === 'activity-run' ? 'work' : regionForTurn(item.turn, answerId),
  }))

  return {
    id: group.id,
    ...(group.anchorEntryId ? { anchorEntryId: group.anchorEntryId } : {}),
    prompt,
    segments,
    answerId,
    isActive,
    status: responseStatus(turns, options),
    work,
  }
}

/** A delta in one response must not rebuild every completed response's tools. */
export function createConversationResponseProjector() {
  let cached = new Map<string, {
    group: ConversationResponseGroup
    active: boolean
    status: AgentStatus
    response: ResponsePresentation
  }>()
  let builds = 0
  return {
    get builds() { return builds },
    project(turns: readonly Turn[], status: AgentStatus): readonly ResponsePresentation[] {
      const groups = groupConversationTurns(turns)
      const next = new Map<string, (typeof cached extends Map<string, infer T> ? T : never)>()
      const responses = groups.map((group, index) => {
        const active = index === groups.length - 1
        const effectiveStatus = active ? status : 'idle'
        const old = cached.get(group.id)
        if (old && old.active === active && old.status === effectiveStatus &&
            old.group.anchorEntryId === group.anchorEntryId && old.group.turns.length === group.turns.length &&
            old.group.turns.every((turn, turnIndex) => turn === group.turns[turnIndex])) {
          next.set(group.id, old)
          return old.response
        }
        const response = projectResponsePresentation(group, { active, status: effectiveStatus })
        builds += 1
        next.set(group.id, { group, active, status: effectiveStatus, response })
        return response
      })
      cached = next
      return responses
    },
  }
}
