import type {
  SubagentOutputPresentation,
  SubagentPresentation,
  SubagentTaskPresentation,
  SubagentTimelineEvent,
  StructuredValueProjection,
  ToolCall,
  ToolCallDetails,
} from '@/types/chat'
import {
  boundedFirstLine,
  projectPlainText,
  projectStructuredValue,
  readOwnDataProperty,
} from './structured-value'

export interface ToolPresentationInput {
  id: string
  name: string
  args: unknown
  /** Raw Pi streaming tool-call text is not a completed structured argument value. */
  argsPresentation?: 'structured' | 'plain-text'
  /** The source was bounded before it reached this presenter. */
  argsTruncated?: boolean
  phase: 'queued' | 'running' | 'complete'
  resultText?: string
  resultDetails?: unknown
  /** Pi content text is display output, not an independently encoded JSON value. */
  resultPresentation?: 'structured' | 'plain-text'
  /** The source was bounded before it reached this presenter. */
  resultTruncated?: boolean
  resultIsPartial?: boolean
  isError?: boolean | null
  fallback?: Partial<ToolCall>
}

type ToolPresenter = (input: ToolPresentationInput, base: ToolCall) => ToolCall

const INTERNAL_TASK_LINE = /^(?:you are an agent in a team|message type:|task name:|sender:|payload:|active task:|scheduler|workflow(?:\s+(?:id|uuid|instructions?))?|trellis|subagent_wait|wait(?:ing)? guidance|fan[- ]?out|do not revert|you are not alone)/iu
const INTERNAL_TASK_PATH = /\.trellis[\\/]/iu
const SENSITIVE_SUMMARY_LINE = /\b(?:api[-_ ]?key|access[-_ ]?token|password|secret|credential|private[-_ ]?key)\b/iu
const SUBAGENT_ENVELOPE_LINE = /^(?:you are an agent in a team(?: of agents)?\.?|message type:.*|task name:.*|sender:.*)$/iu
const SUBAGENT_ACTIVE_TASK_LINE = /^active task:\s*\.trellis[\\/]/iu
const SUBAGENT_PAYLOAD_LINE = /^payload:\s*(.*)$/iu
const SUBAGENT_SCHEDULER_LINE = /^(?:run fan[- ]?out:|async workflow\s*\[[^\]]+\])/iu
const MAX_SUBAGENT_TASKS = 32
const MAX_SUBAGENT_SINGLE_TASK_BYTES = 64_000
const MAX_SUBAGENT_MULTI_TASK_BYTES = 24_000
const MAX_SUBAGENT_OUTPUT_BYTES = 64_000
const MAX_SUBAGENT_TIMELINE_EVENTS = 96
const MAX_SUBAGENT_TIMELINE_ITEM_BYTES = 8_000
const MAX_SUBAGENT_TIMELINE_BYTES = 96_000
const MAX_SUBAGENT_TIMELINE_RESULTS = 32
const MAX_SUBAGENT_TIMELINE_MESSAGES = 256
const MAX_SUBAGENT_TIMELINE_CONTENT_PARTS = 64

export function toolKind(name: string): ToolCall['kind'] {
  const normalized = name.toLowerCase()
  if (['read', 'grep', 'find', 'ls'].includes(normalized)) return 'read'
  if (['edit', 'write', 'patch'].includes(normalized)) return 'edit'
  if (['bash', 'shell'].includes(normalized)) return 'shell'
  return 'generic'
}

function safeArray(value: unknown): readonly unknown[] | null {
  if (!Array.isArray(value)) return null
  let prototype: object | null
  let lengthDescriptor: PropertyDescriptor | undefined
  try {
    prototype = Object.getPrototypeOf(value)
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  } catch {
    return null
  }
  if (prototype !== Array.prototype || !lengthDescriptor || !('value' in lengthDescriptor)) {
    return null
  }
  const length = lengthDescriptor.value
  if (!Number.isSafeInteger(length) || length < 0 || length > 128) return null
  const items: unknown[] = []
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    } catch {
      return null
    }
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return null
    items.push(descriptor.value)
  }
  return items
}

function ownString(value: unknown, key: string, maxBytes = 160) {
  return boundedFirstLine(readOwnDataProperty(value, key), maxBytes)
}

function ownBoolean(value: unknown, key: string) {
  const candidate = readOwnDataProperty(value, key)
  return typeof candidate === 'boolean' ? candidate : null
}

function boundedMarkdown(value: string, maxBytes: number) {
  const projection = projectPlainText(value, {
    maxStringBytes: maxBytes,
    maxDisplayBytes: maxBytes,
    maxCopyBytes: maxBytes,
  })
  return {
    markdown: projection.copyText.replace(/\r\n?/gu, '\n'),
    truncated: projection.copyText !== value,
  }
}

function cleanTaskMarkdown(value: unknown, maxBytes: number) {
  if (typeof value !== 'string') return null
  const bounded = boundedMarkdown(value, maxBytes)
  let lines = bounded.markdown.split('\n')
  const envelopePresent = lines
    .slice(0, 12)
    .some((line) => SUBAGENT_ENVELOPE_LINE.test(line.trim()))
  const payloadIndex = envelopePresent
    ? lines.findIndex((line, index) =>
        index < 12 && SUBAGENT_PAYLOAD_LINE.test(line.trim()),
      )
    : -1
  if (payloadIndex >= 0) {
    const inlinePayload = lines[payloadIndex]?.trim().match(SUBAGENT_PAYLOAD_LINE)?.[1]?.trim()
    lines = [
      ...(inlinePayload ? [inlinePayload] : []),
      ...lines.slice(payloadIndex + 1),
    ]
  } else {
    while (lines.length > 0) {
      const first = lines[0]?.trim() ?? ''
      if (!first || SUBAGENT_ENVELOPE_LINE.test(first)) {
        lines.shift()
        continue
      }
      break
    }
  }
  while (lines.length > 0) {
    const first = lines[0]?.trim() ?? ''
    if (!first || SUBAGENT_ACTIVE_TASK_LINE.test(first)) {
      lines.shift()
      continue
    }
    break
  }
  const markdown = lines.join('\n').trim()
  return markdown ? { markdown, truncated: bounded.truncated } : null
}

function taskSummary(markdown: string) {
  const source = markdown.slice(0, 8_192)
  if (SENSITIVE_SUMMARY_LINE.test(source)) return null
  for (const rawLine of source.split('\n')) {
    const line = rawLine
      .replace(/^\s*(?:#{1,6}|[-*+]|\d+[.)]|>)\s+/u, '')
      .replace(/\s+/gu, ' ')
      .trim()
    if (
      !line ||
      INTERNAL_TASK_LINE.test(line) ||
      INTERNAL_TASK_PATH.test(line)
    ) {
      continue
    }
    return boundedFirstLine(line, 180)
  }
  return null
}

function subagentTask(
  value: unknown,
  id: string,
  maxBytes: number,
): SubagentTaskPresentation | null {
  const agent = ownString(value, 'agent', 64)
  const cleaned = cleanTaskMarkdown(readOwnDataProperty(value, 'task'), maxBytes)
  if (!agent || !cleaned) return null
  const summary = taskSummary(cleaned.markdown)
  return {
    id,
    agent,
    ...(summary ? { summary } : {}),
    markdown: cleaned.markdown,
    truncated: cleaned.truncated,
  }
}

interface SubagentTaskGroup {
  tasks: readonly SubagentTaskPresentation[]
  totalCount: number
}

function taskItems(value: unknown, key: 'tasks' | 'chain'): SubagentTaskGroup | null {
  const items = safeArray(readOwnDataProperty(value, key))
  if (!items?.length) return null
  const projected = items
    .slice(0, MAX_SUBAGENT_TASKS)
    .map((item, index) => subagentTask(
      item,
      `${key}:${index}`,
      MAX_SUBAGENT_MULTI_TASK_BYTES,
    ))
  if (projected.some((item) => item === null)) return null
  return {
    tasks: projected.filter((item): item is SubagentTaskPresentation => item !== null),
    totalCount: items.length,
  }
}

function isDetached(value: unknown) {
  return ['detached', 'background', 'backgrounded', 'runInBackground']
    .some((key) => ownBoolean(value, key) === true) ||
    ['state', 'status', 'phase'].some((key) => {
      const status = ownString(value, key, 32)?.toLowerCase()
      return status === 'detached' || status === 'background'
    })
}

function resultIndicatesDetached(value: string | undefined) {
  return value !== undefined &&
    schedulerAcknowledgement(value) &&
    /\b(?:detached|background)\b/iu.test(value.slice(0, 16_384))
}

function ownText(value: unknown, key: string) {
  const candidate = readOwnDataProperty(value, key)
  return typeof candidate === 'string' ? candidate : null
}

function escapeMarkdownText(value: string) {
  return value.replace(/[\\`*_[\]<>#]/gu, '\\$&')
}

function knownSubagentResult(value: unknown) {
  for (const key of ['output', 'result', 'message', 'error', 'summary'] as const) {
    const candidate = ownText(value, key)
    if (candidate?.trim()) return candidate
  }

  const results = safeArray(readOwnDataProperty(value, 'results'))
  if (!results?.length) return null
  const sections: string[] = []
  for (const [index, result] of results.slice(0, MAX_SUBAGENT_TASKS).entries()) {
    const text = ['output', 'result', 'message', 'error']
      .map((key) => ownText(result, key))
      .find((candidate) => candidate?.trim())
    if (!text) continue
    const bounded = boundedMarkdown(text, MAX_SUBAGENT_MULTI_TASK_BYTES).markdown.trim()
    if (!bounded) continue
    const agent = ownString(result, 'agent', 64) ?? `#${index + 1}`
    sections.push(`**${escapeMarkdownText(agent)}**\n\n${bounded}`)
  }
  return sections.length > 0 ? sections.join('\n\n---\n\n') : null
}

function schedulerAcknowledgement(value: string) {
  if (value.length > 16_384) return false
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (/^(?:subagent|agent|the async run).{0,96}\b(?:started|running).{0,48}\bbackground[.!]?$/iu.test(normalized)) {
    return true
  }
  const signals = [
    /\brun fan[- ]?out:\s*\d+\/\d+/iu,
    /\basync workflow\s*\[[0-9a-z-]{8,}\]/iu,
    /\bsubagent_wait\b/iu,
    /\breturn control to the user now\b/iu,
    /\bdetached and running in the background\b/iu,
  ].filter((pattern) => pattern.test(normalized)).length
  return signals >= 2
}

function normalizeSubagentOutput(
  input: ToolPresentationInput,
): SubagentOutputPresentation | null | undefined {
  const hasPayload = input.resultText !== undefined ||
    (input.resultDetails !== undefined && input.resultDetails !== null)
  if (!hasPayload) return undefined

  const detailText = knownSubagentResult(input.resultDetails)
  const candidates = [input.resultText, detailText]
  for (const candidate of candidates) {
    if (!candidate?.trim() || schedulerAcknowledgement(candidate)) continue
    const cleaned = candidate
      .split(/\r?\n/u)
      .filter((line) => !SUBAGENT_SCHEDULER_LINE.test(line.trim()))
      .join('\n')
      .trim()
    if (!cleaned) continue
    const bounded = boundedMarkdown(cleaned, MAX_SUBAGENT_OUTPUT_BYTES)
    return {
      kind: input.isError === true
        ? 'error'
        : input.resultIsPartial
          ? 'progress'
          : 'result',
      markdown: bounded.markdown,
      truncated: bounded.truncated,
    }
  }
  return null
}

type TimelineBuildResult = {
  events: readonly SubagentTimelineEvent[]
  omittedCount: number
}

function boundTimelineEvents(
  events: readonly SubagentTimelineEvent[],
  initialOmittedCount = 0,
): TimelineBuildResult {
  const retained: SubagentTimelineEvent[] = []
  let bytes = 0
  let omittedCount = initialOmittedCount
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!event) continue
    const eventBytes = textBytes(event.markdown)
    if (retained.length >= MAX_SUBAGENT_TIMELINE_EVENTS ||
      bytes + eventBytes > MAX_SUBAGENT_TIMELINE_BYTES) {
      omittedCount += 1
      continue
    }
    retained.push(event)
    bytes += eventBytes
  }
  retained.reverse()
  return { events: retained, omittedCount }
}

function textBytes(value: string) {
  try {
    return new TextEncoder().encode(value).byteLength
  } catch {
    return value.length
  }
}

function timelineMarkdown(value: unknown) {
  if (typeof value !== 'string') return null
  const bounded = boundedMarkdown(value, MAX_SUBAGENT_TIMELINE_ITEM_BYTES)
  const cleaned = bounded.markdown
    .split(/\r?\n/u)
    .filter((line) => !SUBAGENT_SCHEDULER_LINE.test(line.trim()))
    .join('\n')
    .trim()
  if (!cleaned || schedulerAcknowledgement(cleaned)) return null
  return {
    markdown: cleaned,
    truncated: bounded.truncated,
  }
}

function messageParts(value: unknown): readonly unknown[] {
  const content = readOwnDataProperty(value, 'content')
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return safeArray(content)?.slice(0, MAX_SUBAGENT_TIMELINE_CONTENT_PARTS) ?? []
}

function toolActionMarkdown(name: string, args: unknown) {
  const normalized = name.trim() || 'tool'
  const key = normalized.toLowerCase()
  const detail = key === 'bash' || key === 'shell'
    ? ownString(args, 'command', 1_200)
    : ['read', 'edit', 'write', 'ls', 'find', 'grep'].includes(key)
      ? ownString(args, 'path', 1_200) ?? ownString(args, 'file_path', 1_200)
      : null
  const boundedName = boundedFirstLine(normalized, 120) ?? 'tool'
  if (!detail) return boundedName
  return detail
}

function resultFailed(value: unknown) {
  const exitCode = readOwnDataProperty(value, 'exitCode')
  const stopReason = ownString(value, 'stopReason', 32)?.toLowerCase()
  return (typeof exitCode === 'number' && exitCode !== 0 && exitCode !== -1) ||
    stopReason === 'error' ||
    stopReason === 'aborted'
}

function resultMessages(value: unknown): readonly unknown[] {
  return safeArray(readOwnDataProperty(value, 'messages')) ?? []
}

function timelineFromResultDetails(
  details: unknown,
  input: ToolPresentationInput,
  fallbackOutput: SubagentOutputPresentation | null | undefined,
): TimelineBuildResult | undefined {
  const resultValues = safeArray(readOwnDataProperty(details, 'results'))
  const results = resultValues?.length
    ? resultValues.slice(0, MAX_SUBAGENT_TIMELINE_RESULTS)
    : resultMessages(details).length > 0
      ? [details]
      : []
  const events: SubagentTimelineEvent[] = []
  let sequence = 0
  let sourceOmittedCount = resultValues
    ? Math.max(0, resultValues.length - results.length)
    : 0

  const append = (
    id: string,
    kind: SubagentTimelineEvent['kind'],
    state: SubagentTimelineEvent['state'],
    markdown: { markdown: string; truncated: boolean },
    metadata: Pick<SubagentTimelineEvent, 'agent' | 'toolName'> = {},
  ) => {
    events.push({
      id,
      sequence,
      kind,
      state,
      markdown: markdown.markdown,
      truncated: markdown.truncated,
      ...(metadata.agent ? { agent: metadata.agent } : {}),
      ...(metadata.toolName ? { toolName: metadata.toolName } : {}),
    })
    sequence += 1
  }

  for (const [resultIndex, result] of results.entries()) {
    const agent = ownString(result, 'agent', 64) ?? undefined
    const allMessages = resultMessages(result)
    const messages = allMessages.slice(0, MAX_SUBAGENT_TIMELINE_MESSAGES)
    sourceOmittedCount += Math.max(0, allMessages.length - messages.length)
    const toolResultState = new Map<string, boolean>()
    for (const message of messages) {
      if (ownString(message, 'role', 32) !== 'toolResult') continue
      const toolCallId = ownString(message, 'toolCallId', 128)
      if (toolCallId) toolResultState.set(toolCallId, ownBoolean(message, 'isError') === true)
    }

    const assistantTextKeys: string[] = []
    for (const [messageIndex, message] of messages.entries()) {
      if (ownString(message, 'role', 32) !== 'assistant') continue
      for (const [contentIndex, part] of messageParts(message).entries()) {
        if (ownString(part, 'type', 32) !== 'text') continue
        const text = ownText(part, 'text')
        if (text?.trim()) assistantTextKeys.push(`${messageIndex}:${contentIndex}`)
      }
    }
    const finalAssistantTextKey = assistantTextKeys[assistantTextKeys.length - 1]
    const failed = resultFailed(result)

    for (const [messageIndex, message] of messages.entries()) {
      const role = ownString(message, 'role', 32)
      const parts = messageParts(message)
      if (role === 'assistant') {
        for (const [contentIndex, part] of parts.entries()) {
          const type = ownString(part, 'type', 32)
          const eventId = `result:${resultIndex}:message:${messageIndex}:content:${contentIndex}`
          if (type === 'thinking') continue
          if (type === 'toolCall') {
            const toolName = ownString(part, 'name', 120) ?? 'tool'
            const toolCallId = ownString(part, 'id', 128)
            const failedTool = toolCallId ? toolResultState.get(toolCallId) : undefined
            const state = failedTool === true
              ? 'failed'
              : failedTool === false
                ? 'complete'
                : input.resultIsPartial
                  ? 'active'
                  : 'complete'
            append(
              `${eventId}:tool`,
              'tool',
              state,
              { markdown: toolActionMarkdown(toolName, readOwnDataProperty(part, 'arguments')), truncated: false },
              { agent, toolName },
            )
            continue
          }
          if (type !== 'text') continue
          const markdown = timelineMarkdown(ownText(part, 'text'))
          if (!markdown) continue
          const key = `${messageIndex}:${contentIndex}`
          const final = key === finalAssistantTextKey
          append(
            `${eventId}:text`,
            final ? (failed ? 'error' : 'result') : 'progress',
            failed && final ? 'failed' : input.resultIsPartial ? 'active' : 'complete',
            markdown,
            { agent },
          )
        }
        continue
      }
      if (role !== 'toolResult') continue
      const toolName = ownString(message, 'toolName', 120) ?? undefined
      const isError = ownBoolean(message, 'isError') === true
      for (const [contentIndex, part] of parts.entries()) {
        const markdown = timelineMarkdown(
          ownString(part, 'type', 32) === 'text' ? ownText(part, 'text') : undefined,
        )
        if (!markdown) continue
        const eventId = `result:${resultIndex}:message:${messageIndex}:content:${contentIndex}:result`
        append(
          eventId,
          isError ? 'error' : input.resultIsPartial ? 'progress' : 'result',
          isError ? 'failed' : input.resultIsPartial ? 'active' : 'complete',
          markdown,
          { agent, toolName },
        )
      }
    }
  }

  if (events.length === 0 && fallbackOutput?.markdown) {
    appendFallbackTimelineEvent(events, fallbackOutput, input)
  }
  if (events.length === 0 && input.resultText) {
    const markdown = timelineMarkdown(input.resultText)
    if (markdown) {
      append(
        'fallback:result',
        input.isError === true ? 'error' : input.resultIsPartial ? 'progress' : 'result',
        input.isError === true ? 'failed' : input.resultIsPartial ? 'active' : 'complete',
        markdown,
      )
    }
  }
  if (events.length === 0) return undefined

  return boundTimelineEvents(events, sourceOmittedCount)
}

function appendFallbackTimelineEvent(
  events: SubagentTimelineEvent[],
  output: SubagentOutputPresentation,
  input: ToolPresentationInput,
) {
  events.push({
    id: 'fallback:output',
    sequence: 0,
    kind: output.kind,
    state: output.kind === 'error' ? 'failed' : input.resultIsPartial ? 'active' : 'complete',
    markdown: output.markdown,
    truncated: output.truncated,
  })
}

function resultValue(input: ToolPresentationInput) {
  if (input.resultDetails === undefined || input.resultDetails === null) {
    return input.resultText
  }
  if (!input.resultText) return input.resultDetails
  return { message: input.resultText, details: input.resultDetails }
}

function projectToolResult(input: ToolPresentationInput) {
  let projection: StructuredValueProjection
  if (input.resultPresentation === 'plain-text' && input.resultText !== undefined) {
    if (input.resultDetails === undefined || input.resultDetails === null) {
      projection = projectPlainText(input.resultText)
    } else {
      projection = projectStructuredValue({ message: input.resultText, details: input.resultDetails })
    }
  } else {
    projection = projectStructuredValue(resultValue(input))
  }
  return input.resultTruncated && !projection.truncated
    ? { ...projection, truncated: true }
    : projection
}

function mergeDetails(
  base: ToolCallDetails | undefined,
  next: ToolCallDetails,
): ToolCallDetails | undefined {
  const merged = { ...base, ...next }
  return Object.keys(merged).length > 0 ? merged : undefined
}

function legacyArgumentBody(
  input: ToolPresentationInput,
  kind: ToolCall['kind'],
  argumentCopyText: string,
) {
  if (kind === 'shell') {
    const command = ownString(input.args, 'command', 24_000)
    if (command) return command
  }
  if (kind === 'read' || kind === 'edit') {
    const path = ownString(input.args, 'path', 24_000)
    if (path) return path
  }
  return argumentCopyText
}

function genericPresentation(input: ToolPresentationInput): ToolCall {
  const kind = input.fallback?.kind ?? toolKind(input.name)
  // Shell commands already have a safe, purpose-built summary. Rendering the
  // full argument object adds noise (and often repeats the command) without
  // giving the user useful context.
  const projectedArguments = kind === 'shell' || input.args === undefined
    ? undefined
    : input.argsPresentation === 'plain-text' && typeof input.args === 'string'
      ? projectPlainText(input.args)
      : projectStructuredValue(input.args)
  const argumentProjection = projectedArguments && input.argsTruncated && !projectedArguments.truncated
    ? { ...projectedArguments, truncated: true }
    : projectedArguments
  const projectedResult = input.resultText || input.resultDetails !== undefined
    ? projectToolResult(input)
    : undefined
  const details: ToolCallDetails = {
    ...(argumentProjection ? { arguments: argumentProjection } : {}),
    ...(projectedResult && input.resultIsPartial ? { progress: projectedResult } : {}),
    ...(projectedResult && !input.resultIsPartial && input.isError !== true
      ? { result: projectedResult }
      : {}),
    ...(projectedResult && !input.resultIsPartial && input.isError === true
      ? { error: projectedResult }
      : {}),
  }
  const status = input.phase === 'queued'
    ? input.fallback?.status ?? 'queued'
    : input.phase === 'running'
      ? 'running'
      : input.isError
        ? 'failed'
        : 'success'
  const body = input.fallback?.body ?? legacyArgumentBody(
    input,
    kind,
    argumentProjection?.copyText ?? '',
  )
  return {
    id: input.id,
    kind,
    title: input.fallback?.title ?? input.name,
    status,
    body,
    summary: input.fallback?.summary ?? (kind === 'generic' ? argumentProjection?.summary : body),
    details: mergeDetails(input.fallback?.details, details),
    malformed: argumentProjection?.malformed || undefined,
    progress: input.resultIsPartial && input.resultText
      ? input.resultText
      : input.fallback?.progress,
    output: !input.resultIsPartial && input.isError !== true && input.resultText
      ? input.resultText
      : input.fallback?.output,
    error: !input.resultIsPartial && input.isError === true && input.resultText
      ? input.resultText
      : input.fallback?.error,
    ...(input.fallback?.duration ? { duration: input.fallback.duration } : {}),
    ...(input.fallback?.patch ? { patch: input.fallback.patch } : {}),
    ...(input.fallback?.diff ? { diff: input.fallback.diff } : {}),
  }
}

function subagentPresenter(input: ToolPresentationInput, base: ToolCall): ToolCall {
  const detached = isDetached(input.args) ||
    isDetached(input.resultDetails) ||
    resultIndicatesDetached(input.resultText)
  const output = normalizeSubagentOutput(input)
  const timeline = timelineFromResultDetails(input.resultDetails, input, output)
  const status: ToolCall['status'] = input.isError === true
    ? 'failed'
    : detached
      ? 'detached'
      : base.status

  if (input.args === undefined) {
    return {
      ...base,
      status,
      body: '',
      summary: undefined,
      details: undefined,
      subagent: {
        mode: 'unknown',
        tasks: [],
        omittedTaskCount: 0,
        malformed: false,
        ...(output === undefined ? {} : { output }),
        ...(timeline ? {
          timeline: timeline.events,
          timelineOmittedCount: timeline.omittedCount,
        } : {}),
      },
      malformed: undefined,
      detached,
      progress: undefined,
      output: undefined,
      error: undefined,
    }
  }

  const single = subagentTask(input.args, 'single:0', MAX_SUBAGENT_SINGLE_TASK_BYTES)
  const parallel = taskItems(input.args, 'tasks')
  const chain = taskItems(input.args, 'chain')
  const modes = Number(Boolean(single)) + Number(Boolean(parallel)) + Number(Boolean(chain))
  const malformed = modes !== 1

  const mode: SubagentPresentation['mode'] = single
    ? 'single'
    : parallel
      ? 'parallel'
      : chain
        ? 'chain'
        : 'unknown'
  const group = single
    ? { tasks: [single], totalCount: 1 }
    : parallel ?? chain
  const tasks = malformed ? [] : group?.tasks ?? []
  const totalCount = malformed ? 0 : group?.totalCount ?? 0
  const firstTask = tasks[0]
  const agentLabel = tasks.length === 1
    ? firstTask?.agent ?? null
    : tasks.slice(0, 2).map((item) => item.agent).join(', ') || null
  const modeSuffix = mode === 'parallel'
    ? `[${totalCount}]`
    : mode === 'chain'
      ? `→${totalCount}`
      : ''
  const identity = [agentLabel, modeSuffix].filter(Boolean).join(' ')
  const summary = malformed
    ? undefined
    : [identity, firstTask?.summary].filter(Boolean).join(' · ') || undefined

  return {
    ...base,
    status,
    body: '',
    summary,
    details: undefined,
    subagent: {
      mode,
      tasks,
      omittedTaskCount: Math.max(0, totalCount - tasks.length),
      malformed,
      ...(output === undefined ? {} : { output }),
      ...(timeline ? {
        timeline: timeline.events,
        timelineOmittedCount: timeline.omittedCount,
      } : {}),
    },
    malformed,
    detached,
    progress: undefined,
    output: undefined,
    error: undefined,
  }
}

const TOOL_PRESENTERS: ReadonlyMap<string, ToolPresenter> = new Map([
  ['subagent', subagentPresenter],
])

export function presentToolCall(input: ToolPresentationInput): ToolCall {
  const base = genericPresentation(input)
  const presenter = TOOL_PRESENTERS.get(input.name)
  return presenter ? presenter(input, base) : base
}

export function mergeSubagentPresentation(
  previous: SubagentPresentation | undefined,
  next: SubagentPresentation | undefined,
): SubagentPresentation | undefined {
  if (!previous) return next
  if (!next) return previous
  const hasNextTasks = next.tasks.length > 0 || next.malformed
  const hasNextTimeline = Boolean(next.timeline?.length) ||
    (next.timelineOmittedCount ?? 0) > 0
  const timelineById = new Map<string, SubagentTimelineEvent>()
  for (const event of previous.timeline ?? []) timelineById.set(event.id, event)
  for (const event of next.timeline ?? []) timelineById.set(event.id, event)
  const mergedTimeline = boundTimelineEvents(
    [...timelineById.values()].sort((left, right) => left.sequence - right.sequence),
    Math.max(previous.timelineOmittedCount ?? 0, next.timelineOmittedCount ?? 0),
  )
  const timeline = hasNextTimeline ? mergedTimeline.events : previous.timeline
  return {
    mode: hasNextTasks ? next.mode : previous.mode,
    tasks: hasNextTasks ? next.tasks : previous.tasks,
    omittedTaskCount: hasNextTasks ? next.omittedTaskCount : previous.omittedTaskCount,
    malformed: hasNextTasks ? next.malformed : previous.malformed,
    output: next.output !== undefined ? next.output : previous.output,
    ...(timeline ? { timeline } : {}),
    ...(hasNextTimeline || next.timelineOmittedCount !== undefined
      ? { timelineOmittedCount: mergedTimeline.omittedCount }
      : previous.timelineOmittedCount !== undefined
        ? { timelineOmittedCount: previous.timelineOmittedCount }
        : {}),
  }
}

export function toolCallCopyText(call: ToolCall) {
  if (call.subagent) {
    const values = call.subagent.tasks.map((task) => `${task.agent}\n${task.markdown}`)
    for (const event of call.subagent.timeline ?? []) values.push(event.markdown)
    if (call.subagent.output && !values.includes(call.subagent.output.markdown)) {
      values.push(call.subagent.output.markdown)
    }
    return projectPlainText(values.join('\n\n'), { maxCopyBytes: 48_000 }).copyText
  }
  if (call.kind === 'shell') {
    const values = [
      call.body,
      call.progress,
      call.output,
      call.error,
      call.patch,
      call.details?.progress?.copyText,
      call.details?.result?.copyText,
      call.details?.error?.copyText,
      call.details?.patch?.copyText,
    ].filter(
      (value, index, candidates): value is string =>
        Boolean(value) && candidates.indexOf(value) === index,
    )
    return projectPlainText(values.join('\n\n'), { maxCopyBytes: 48_000 }).copyText
  }
  const structured = call.details
    ? (['arguments', 'progress', 'result', 'error', 'patch'] as const)
        .flatMap((key) => call.details?.[key]?.copyText ?? [])
    : []
  const values = structured.length > 0
    ? structured
    : [call.body, call.progress, call.output, call.error, call.patch].filter(
        (value): value is string => Boolean(value),
      )
  return projectStructuredValue(values.join('\n\n'), { maxCopyBytes: 48_000 }).copyText
}
