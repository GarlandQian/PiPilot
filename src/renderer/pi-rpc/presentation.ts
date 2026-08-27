import type {
  LocalPiAgentMessage,
  LocalPiAssistantMessage,
  LocalPiUserMessage,
} from '@/shared/local-pi'
import type {
  LocalPiProjectedTool,
  LocalPiProjectorState,
} from './projector'
import {
  PLAN_STATUS_KEY,
  PLAN_WIDGET_KEY,
  parsePlanCompletionDetails,
  parseProposedPlanMessage,
  type PlanLifecycle,
  type PlanModeProjection,
} from './adapters/plan-mode'
import { alignLocalPiMessageOrigins } from './response-provenance'
import { mergeSubagentPresentation, presentToolCall } from './tool-presenters'
import type {
  ConversationOutlineItem,
  ConversationOutlineStatus,
  ConversationResponseGroup,
  ResponseActivity,
  ToolCall,
  Turn,
  UserMessageImage,
} from '@/types/chat'

const MAX_TOOL_DETAIL_CHARS = 24_000
const MAX_OUTLINE_TITLE_CHARS = 120
const MAX_OUTLINE_SUMMARY_CHARS = 180
const MAX_RESPONSE_ACTIVITIES = 64

export interface LocalPiResponseActivityRecord {
  scopeKey: string
  generation: number
  sessionId: string
  anchorEntryId: string
  order: number
  activity: ResponseActivity
}

interface LocalPiResponseActivityScope {
  scopeKey: string
  generation: number
  sessionId: string
  anchorEntryId: string
}

function sameActivityScope(
  record: LocalPiResponseActivityRecord,
  scope: LocalPiResponseActivityScope,
) {
  return record.scopeKey === scope.scopeKey &&
    record.generation === scope.generation &&
    record.sessionId === scope.sessionId &&
    record.anchorEntryId === scope.anchorEntryId
}

export function upsertLocalPiResponseActivity(
  records: readonly LocalPiResponseActivityRecord[],
  next: LocalPiResponseActivityRecord,
): readonly LocalPiResponseActivityRecord[] {
  const index = records.findIndex((record) =>
    sameActivityScope(record, next) && record.activity.id === next.activity.id)
  if (index === -1) return [...records, next].slice(-MAX_RESPONSE_ACTIVITIES)
  const previous = records[index]
  if (!previous) return records
  const replacement = {
    ...next,
    order: previous.order,
  }
  const updated = [...records]
  updated[index] = replacement
  return updated
}

export function settleLocalPiResponseActivities(
  records: readonly LocalPiResponseActivityRecord[],
  scope: LocalPiResponseActivityScope,
  activityId?: string,
): readonly LocalPiResponseActivityRecord[] {
  let changed = false
  const next = records.map((record) => {
    if (
      !sameActivityScope(record, scope) ||
      (activityId !== undefined && record.activity.id !== activityId) ||
      record.activity.state === 'settled'
    ) {
      return record
    }
    changed = true
    return {
      ...record,
      activity: { ...record.activity, state: 'settled' } as ResponseActivity,
    }
  })
  return changed ? next : records
}

export function latestLocalPiResponseAnchor(
  state: LocalPiProjectorState,
): string | null {
  if (!state.entrySnapshot) return null
  const origins = alignLocalPiMessageOrigins(state.entrySnapshot, state.messages)
  if (!origins) return null
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    if (state.messages[index]?.role !== 'user') continue
    const origin = origins[index]
    if (origin?.role === 'user') return origin.entryId
  }
  return null
}

function textContent(
  content: string | readonly { type: string; text?: string; thinking?: string }[],
) {
  if (typeof content === 'string') return content
  return content
    .map((part) => part.type === 'text'
      ? part.text ?? ''
      : part.type === 'thinking'
        ? part.thinking ?? ''
        : '')
    .filter(Boolean)
    .join('\n')
}

function userMessageImages(
  content: LocalPiUserMessage['content'],
  key: string,
): readonly UserMessageImage[] {
  if (typeof content === 'string') return []
  return content.flatMap((part, index) => part.type === 'image'
    ? [{
        id: `${key}:image:${index}`,
        data: part.data,
        mimeType: part.mimeType,
      }]
    : [])
}

function boundedToolText(value: string) {
  if (value.length <= MAX_TOOL_DETAIL_CHARS) return value
  return `${value.slice(0, MAX_TOOL_DETAIL_CHARS)}\n...`
}

function toolResultText(
  result: LocalPiProjectedTool['result'],
  toolName: string,
) {
  if (!result) return ''
  const text = textContent(result.content)
  return toolName === 'subagent' ? text : boundedToolText(text)
}

function projectedToolCall(
  tool: LocalPiProjectedTool,
  fallback?: Partial<ToolCall>,
): ToolCall {
  const result = toolResultText(tool.result, tool.toolName)
  return presentToolCall({
    id: tool.toolCallId,
    name: tool.toolName,
    args: tool.args,
    phase: tool.phase,
    resultText: result || undefined,
    resultDetails: tool.result?.details,
    resultPresentation: 'plain-text',
    resultIsPartial: tool.resultIsPartial,
    isError: tool.isError,
    fallback,
  })
}

function assistantState(
  message: LocalPiAssistantMessage,
  streaming: boolean,
): NonNullable<Extract<Turn, { kind: 'agent' }>['state']> {
  if (streaming || message.stopReason === 'pending') return 'streaming'
  if (message.stopReason === 'aborted') return 'aborted'
  if (message.stopReason === 'error') return 'error'
  return 'complete'
}

interface TurnProjection {
  turns: Turn[]
  toolIndexes: Map<string, number>
}

interface ResponseGroup {
  id: string
  markdown: string[]
  anchorEntryId: string | null
  forkEntryId: string | null
  lastAssistantStopReason: LocalPiAssistantMessage['stopReason'] | null
  streaming: boolean
}

function responseMarkdown(fragments: readonly string[]) {
  let markdown = ''
  for (const fragment of fragments) {
    if (!markdown) {
      markdown = fragment
      continue
    }
    const trailingNewlines = markdown.match(/\n*$/u)?.[0].length ?? 0
    const leadingNewlines = fragment.match(/^\n*/u)?.[0].length ?? 0
    const missingNewlines = Math.max(0, 2 - trailingNewlines - leadingNewlines)
    markdown += `${'\n'.repeat(missingNewlines)}${fragment}`
  }
  return markdown
}

function appendResponseActions(
  projection: TurnProjection,
  group: ResponseGroup | null,
  provenanceReady: boolean,
) {
  if (
    !group ||
    !provenanceReady ||
    group.streaming ||
    (group.lastAssistantStopReason !== 'stop' &&
      group.lastAssistantStopReason !== 'length')
  ) {
    return
  }

  const markdown = responseMarkdown(group.markdown)
  if (!markdown.trim()) return
  projection.turns.push({
    kind: 'response-actions',
    id: `${group.id}:response-actions`,
    copyMarkdown: markdown,
    ...(group.anchorEntryId ? { anchorEntryId: group.anchorEntryId } : {}),
    ...(group.forkEntryId ? { forkEntryId: group.forkEntryId } : {}),
  })
}

function captureAssistantResponse(
  group: ResponseGroup | null,
  message: LocalPiAssistantMessage,
  streaming: boolean,
) {
  if (!group) return
  for (const part of message.content) {
    if (part.type === 'text' && part.text.trim()) group.markdown.push(part.text)
  }
  group.lastAssistantStopReason = message.stopReason
  group.streaming ||= streaming || message.stopReason === 'pending'
}

function appendTool(
  projection: TurnProjection,
  call: ToolCall,
  turnId: string,
  anchorEntryId?: string,
) {
  const existingIndex = projection.toolIndexes.get(call.id)
  if (existingIndex !== undefined) {
    const existing = projection.turns[existingIndex]
    if (existing?.kind === 'tool') {
      const subagent = mergeSubagentPresentation(existing.call.subagent, call.subagent)
      projection.turns[existingIndex] = {
        ...existing,
        call: {
          ...existing.call,
          ...call,
          body: call.body || existing.call.body,
          summary: call.summary || existing.call.summary,
          details: {
            ...existing.call.details,
            ...call.details,
          },
          output: call.output ?? existing.call.output,
          ...(subagent ? { subagent } : {}),
        },
      }
    }
    return
  }
  projection.toolIndexes.set(call.id, projection.turns.length)
  projection.turns.push({
    kind: 'tool',
    id: turnId,
    call,
    ...(anchorEntryId ? { anchorEntryId } : {}),
  })
}

function appendPlan(
  projection: TurnProjection,
  planMode: PlanModeProjection,
  markdown: string,
  turnId: string,
  sourceEntryId: string,
  sourceLifecycle: PlanLifecycle,
  toolCallId?: string,
  anchorEntryId?: string,
) {
  const active = planMode.sourceEntryId === sourceEntryId
  const turn: Extract<Turn, { kind: 'plan' }> = {
    kind: 'plan',
    id: turnId,
    markdown,
    lifecycle: active ? planMode.lifecycle : sourceLifecycle,
    sourceEntryId,
    actions: active ? planMode.actions : [],
    ...(anchorEntryId ? { anchorEntryId } : {}),
  }
  const existingIndex = toolCallId
    ? projection.toolIndexes.get(toolCallId)
    : undefined
  if (existingIndex === undefined) {
    projection.turns.push(turn)
  } else {
    projection.turns[existingIndex] = turn
  }
}

function appendMessage(
  projection: TurnProjection,
  message: LocalPiAgentMessage,
  key: string,
  tools: ReadonlyMap<string, LocalPiProjectedTool>,
  planMode: PlanModeProjection | null,
  anchorEntryId?: string,
  messageIndex?: number,
  streaming = false,
) {
  if (message.role === 'user') {
    projection.turns.push({
      kind: 'user',
      id: key,
      text: textContent(message.content),
      images: userMessageImages(message.content, key),
      time: '',
      timestamp: message.timestamp,
      ...(anchorEntryId ? { anchorEntryId } : {}),
    })
    return
  }

  if (message.role === 'assistant') {
    const state = assistantState(message, streaming)
    let hasVisibleText = false
    message.content.forEach((part, index) => {
      if (part.type === 'text') {
        hasVisibleText ||= Boolean(part.text)
        projection.turns.push({
          kind: 'agent',
          id: `${key}:text:${index}`,
          markdown: part.text,
          state,
          ...(anchorEntryId ? { anchorEntryId } : {}),
        })
      } else if (part.type === 'thinking') {
        projection.turns.push({
          kind: 'thinking',
          id: `${key}:thinking:${index}`,
          text: part.thinking,
          state,
          ...(anchorEntryId ? { anchorEntryId } : {}),
        })
      } else {
        const live = tools.get(part.id)
        const base = presentToolCall({
          id: part.id,
          name: part.name,
          args: part.arguments,
          phase: streaming ? 'running' : 'queued',
        })
        appendTool(
          projection,
          live ? projectedToolCall(live, base) : base,
          `${key}:tool:${part.id}`,
          anchorEntryId,
        )
      }
    })
    if (!streaming && !hasVisibleText) {
      if (message.errorMessage) {
        projection.turns.push({
          kind: 'agent',
          id: `${key}:error`,
          markdown: message.errorMessage,
          state: 'error',
          ...(anchorEntryId ? { anchorEntryId } : {}),
        })
      } else if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        projection.turns.push({
          kind: 'notice',
          id: `${key}:${message.stopReason}`,
          notice: message.stopReason === 'error'
            ? 'response-error'
            : 'response-aborted',
          ...(anchorEntryId ? { anchorEntryId } : {}),
        })
      }
    }
    return
  }

  if (message.role === 'toolResult') {
    const plan = planMode?.completionToolCallIds.has(message.toolCallId)
      ? parsePlanCompletionDetails(message.details)
      : null
    if (plan && !message.isError && planMode) {
      appendPlan(
        projection,
        planMode,
        plan.plan,
        `${key}:plan:${message.toolCallId}`,
          message.toolCallId,
          'ready',
          message.toolCallId,
          anchorEntryId,
      )
      return
    }
    const rawResult = textContent(message.content)
    const result = message.toolName === 'subagent'
      ? rawResult
      : boundedToolText(rawResult)
    appendTool(projection, presentToolCall({
      id: message.toolCallId,
      name: message.toolName,
      args: undefined,
      phase: 'complete',
      resultText: result || undefined,
      resultDetails: message.details,
      resultPresentation: 'plain-text',
      resultIsPartial: false,
      isError: message.isError,
    }), `${key}:result:${message.toolCallId}`, anchorEntryId)
    return
  }

  if (message.role === 'bashExecution') {
    appendTool(projection, {
      id: key,
      kind: 'shell',
      title: 'bash',
      status: message.cancelled
        ? 'cancelled'
        : message.exitCode === 0
          ? 'success'
          : 'failed',
      body: message.command,
      output: message.output,
    }, key, anchorEntryId)
    return
  }

  if (message.role === 'custom') {
    const proposed = planMode ? parseProposedPlanMessage(message) : null
    if (proposed && planMode) {
      const sourceEntryId = `custom:${message.timestamp}:${messageIndex ?? -1}`
      appendPlan(
        projection,
        planMode,
        proposed.markdown,
        `${key}:plan`,
        sourceEntryId,
        proposed.lifecycle,
        undefined,
        anchorEntryId,
      )
      return
    }
    if (message.display) {
      projection.turns.push({
        kind: 'agent',
        id: key,
        markdown: textContent(message.content),
        state: 'complete',
        ...(anchorEntryId ? { anchorEntryId } : {}),
      })
    }
    return
  }

  projection.turns.push({
    kind: 'agent',
    id: key,
    markdown: message.summary,
    state: 'complete',
    ...(anchorEntryId ? { anchorEntryId } : {}),
  })
}

interface LocalPiTurnProjectionOptions {
  planMode?: PlanModeProjection | null
  scopeKey?: string
  responseActivities?: readonly LocalPiResponseActivityRecord[]
}

function attachResponseActivities(
  turns: readonly Turn[],
  state: LocalPiProjectorState,
  options: LocalPiTurnProjectionOptions,
): Turn[] {
  const scopeKey = options.scopeKey
  const activities = options.responseActivities
  if (!scopeKey || !activities?.length) return [...turns]

  const userAnchors = new Set(turns.flatMap((turn) =>
    turn.kind === 'user' && turn.anchorEntryId ? [turn.anchorEntryId] : []))
  const planAnchors = new Set(turns.flatMap((turn) =>
    turn.kind === 'plan' && turn.anchorEntryId ? [turn.anchorEntryId] : []))
  const visible = activities
    .filter((record) =>
      record.scopeKey === scopeKey &&
      record.generation === state.generation &&
      record.sessionId === state.sessionId &&
      userAnchors.has(record.anchorEntryId))
    .sort((left, right) => left.order - right.order)

  const displayable = visible.filter((record) => !(
    planAnchors.has(record.anchorEntryId) &&
    ((record.activity.kind === 'status' && record.activity.label === PLAN_STATUS_KEY) ||
      (record.activity.kind === 'widget' && record.activity.label === PLAN_WIDGET_KEY))
  ))
  const latestSettledProgress = new Map<string, LocalPiResponseActivityRecord>()
  for (const record of displayable) {
    const activity = record.activity
    if (
      activity.state === 'settled' &&
      (activity.kind === 'working' ||
        activity.kind === 'status' ||
        activity.kind === 'widget' ||
        (activity.kind === 'retry' && activity.phase !== 'error'))
    ) {
      latestSettledProgress.set(record.anchorEntryId, record)
    }
  }
  const compressed = displayable.filter((record) => {
    const activity = record.activity
    if (
      activity.state !== 'settled' ||
      activity.kind === 'notification' ||
      activity.kind === 'extension-error' ||
      (activity.kind === 'retry' && activity.phase === 'error')
    ) {
      return true
    }
    return latestSettledProgress.get(record.anchorEntryId) === record
  })

  const projected = [...turns]
  for (const record of compressed) {
    const turn: Turn = {
      kind: 'activity',
      id: `${state.generation}:${state.sessionId}:${record.anchorEntryId}:${record.activity.id}`,
      anchorEntryId: record.anchorEntryId,
      activity: record.activity,
    }
    const actionIndex = projected.findIndex((candidate) =>
      candidate.kind === 'response-actions' &&
      candidate.anchorEntryId === record.anchorEntryId)
    if (actionIndex !== -1) {
      projected.splice(actionIndex, 0, turn)
      continue
    }
    let lastGroupIndex = -1
    for (let index = projected.length - 1; index >= 0; index -= 1) {
      if (projected[index]?.anchorEntryId === record.anchorEntryId) {
        lastGroupIndex = index
        break
      }
    }
    projected.splice(lastGroupIndex + 1, 0, turn)
  }
  return projected
}

export function projectLocalPiTurns(
  state: LocalPiProjectorState,
  adapters: LocalPiTurnProjectionOptions = {},
): Turn[] {
  const projection: TurnProjection = {
    turns: [],
    toolIndexes: new Map(),
  }
  const prefix = `${state.generation}:${state.sessionId}`
  const provenanceReady = state.entrySnapshot !== null
  const origins = state.entrySnapshot
    ? alignLocalPiMessageOrigins(state.entrySnapshot, state.messages)
    : null
  let responseGroup: ResponseGroup | null = null
  let activeAnchorEntryId: string | undefined

  for (const [index, message] of state.messages.entries()) {
    const key = `${prefix}:message:${index}:${message.timestamp}`
    if (message.role === 'user') {
      appendResponseActions(projection, responseGroup, provenanceReady)
      const origin = origins?.[index]
      activeAnchorEntryId = origin?.role === 'user'
        ? origin.entryId
        : undefined
      responseGroup = {
        id: key,
        markdown: [],
        anchorEntryId: activeAnchorEntryId ?? null,
        forkEntryId: origins?.[index]?.forkEntryId ?? null,
        lastAssistantStopReason: null,
        streaming: false,
      }
    } else if (message.role === 'assistant') {
      captureAssistantResponse(responseGroup, message, false)
    }
    appendMessage(
      projection,
      message,
      key,
      state.tools,
      adapters.planMode ?? null,
      activeAnchorEntryId,
      index,
    )
  }

  if (state.streamingMessage) {
    captureAssistantResponse(responseGroup, state.streamingMessage, true)
    appendMessage(
      projection,
      state.streamingMessage,
      `${prefix}:stream:${state.messages.length}:${state.streamingMessage.timestamp}`,
      state.tools,
      adapters.planMode ?? null,
      activeAnchorEntryId,
      undefined,
      true,
    )
  }

  for (const [index, delta] of state.streamingToolCallDeltas) {
    appendTool(projection, presentToolCall({
      id: `${prefix}:stream-tool:${index}`,
      name: 'tool',
      // Pi emits raw, incrementally assembled argument JSON here. It is not a
      // completed LocalPiToolCall.arguments value until toolcall_end.
      args: boundedToolText(delta),
      argsPresentation: 'plain-text',
      phase: 'running',
    }), `${prefix}:stream-tool:${index}`, activeAnchorEntryId)
  }

  for (const tool of state.tools.values()) {
    if (
      adapters.planMode?.completionToolCallIds.has(tool.toolCallId) &&
      tool.result &&
      !tool.resultIsPartial &&
      !tool.isError
    ) {
      const plan = parsePlanCompletionDetails(tool.result.details)
      if (plan) {
        appendPlan(
          projection,
          adapters.planMode,
          plan.plan,
          `${prefix}:live-plan:${tool.toolCallId}`,
          tool.toolCallId,
          'ready',
          tool.toolCallId,
          activeAnchorEntryId,
        )
        continue
      }
    }
    appendTool(
      projection,
      projectedToolCall(tool),
      `${prefix}:live-tool:${tool.toolCallId}`,
      activeAnchorEntryId,
    )
  }

  if (state.isStreaming || state.isTurnActive) {
    if (responseGroup) responseGroup.streaming = true
  }
  appendResponseActions(projection, responseGroup, provenanceReady)

  const latestPlanIndexes = new Map<string, number>()
  projection.turns.forEach((turn, index) => {
    if (turn.kind === 'plan') latestPlanIndexes.set(turn.markdown, index)
  })
  const deduplicated = projection.turns.filter((turn, index) =>
    turn.kind !== 'plan' || latestPlanIndexes.get(turn.markdown) === index)
  return attachResponseActivities(deduplicated, state, adapters)
}

export function groupConversationTurns(
  turns: readonly Turn[],
): ConversationResponseGroup[] {
  const groups: Array<{
    id: string
    anchorEntryId?: string
    turns: Turn[]
  }> = []
  const anchoredGroups = new Map<string, (typeof groups)[number]>()
  let current: (typeof groups)[number] | null = null

  for (const turn of turns) {
    if (turn.kind === 'user') {
      current = {
        id: `response:${turn.id}`,
        ...(turn.anchorEntryId ? { anchorEntryId: turn.anchorEntryId } : {}),
        turns: [turn],
      }
      groups.push(current)
      if (turn.anchorEntryId) anchoredGroups.set(turn.anchorEntryId, current)
      continue
    }

    const anchored = turn.anchorEntryId
      ? anchoredGroups.get(turn.anchorEntryId)
      : undefined
    if (anchored) {
      anchored.turns.push(turn)
      continue
    }
    if (current && !turn.anchorEntryId) {
      current.turns.push(turn)
      continue
    }

    current = {
      id: `response:${turn.anchorEntryId ?? turn.id}`,
      ...(turn.anchorEntryId ? { anchorEntryId: turn.anchorEntryId } : {}),
      turns: [turn],
    }
    groups.push(current)
    if (turn.anchorEntryId) anchoredGroups.set(turn.anchorEntryId, current)
  }

  return groups
}

function outlineText(value: string, maxChars: number) {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized.length <= maxChars
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

function outlineStatusForTurn(
  current: ConversationOutlineStatus,
  turn: Turn,
): ConversationOutlineStatus {
  if (turn.kind === 'agent' || turn.kind === 'thinking') {
    if (turn.state === 'streaming') return 'running'
    if (turn.state === 'error') return 'error'
    if (turn.state === 'aborted') return 'aborted'
    return 'complete'
  }
  if (turn.kind === 'tool') {
    if (turn.call.status === 'queued' || turn.call.status === 'running') return 'running'
    if (turn.call.status === 'failed') return 'error'
    if (turn.call.status === 'cancelled') return 'aborted'
    return current === 'running' ? current : 'complete'
  }
  if (turn.kind === 'notice') {
    if (turn.notice === 'response-error' || turn.notice === 'compaction-failed') return 'error'
    if (turn.notice === 'response-aborted') return 'aborted'
    if (turn.notice === 'compacting') return 'running'
    return current
  }
  if (turn.kind === 'activity') {
    const activity = turn.activity
    if (
      activity.kind === 'extension-error' ||
      (activity.kind === 'notification' && activity.tone === 'error') ||
      (activity.kind === 'retry' && activity.phase === 'error')
    ) {
      return 'error'
    }
    if (activity.state === 'active') return 'running'
    return current === 'pending' ? 'complete' : current
  }
  if (turn.kind === 'response-actions') return 'complete'
  if (turn.kind === 'plan') return turn.lifecycle === 'planning' ? 'running' : 'complete'
  return current
}

function outlineSummary(turn: Turn) {
  if (turn.kind === 'agent') return outlineText(turn.markdown, MAX_OUTLINE_SUMMARY_CHARS)
  if (turn.kind === 'plan') return outlineText(turn.markdown, MAX_OUTLINE_SUMMARY_CHARS)
  if (turn.kind === 'tool') {
    return outlineText(
      turn.call.malformed ? turn.call.title : turn.call.summary ?? turn.call.title,
      MAX_OUTLINE_SUMMARY_CHARS,
    )
  }
  if (turn.kind === 'activity') {
    const activity = turn.activity
    if (activity.kind === 'working' || activity.kind === 'notification' || activity.kind === 'extension-error') {
      return outlineText(activity.message, MAX_OUTLINE_SUMMARY_CHARS)
    }
    if (activity.kind === 'status') return outlineText(activity.message, MAX_OUTLINE_SUMMARY_CHARS)
    if (activity.kind === 'widget') return outlineText(activity.summary, MAX_OUTLINE_SUMMARY_CHARS)
    return outlineText(activity.message ?? '', MAX_OUTLINE_SUMMARY_CHARS)
  }
  return ''
}

export function projectConversationOutline(
  turns: readonly Turn[],
): ConversationOutlineItem[] {
  const items: ConversationOutlineItem[] = []
  const indexes = new Map<string, number>()

  for (const turn of turns) {
    const entryId = turn.anchorEntryId
    if (!entryId) continue

    if (turn.kind === 'user') {
      let index = indexes.get(entryId)
      if (index === undefined) {
        index = items.length
        indexes.set(entryId, index)
        items.push({
          entryId,
          title: outlineText(turn.text, MAX_OUTLINE_TITLE_CHARS),
          status: 'pending',
          time: turn.time,
          ...(turn.timestamp === undefined ? {} : { timestamp: turn.timestamp }),
        })
      }
      continue
    }

    const index = indexes.get(entryId)
    if (index === undefined) continue
    const item = items[index]
    if (!item) continue
    const summary = outlineSummary(turn)
    items[index] = {
      ...item,
      status: outlineStatusForTurn(item.status, turn),
      ...(!item.summary && summary ? { summary } : {}),
    }
  }

  return items
}
