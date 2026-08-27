export type Session = {
  id: string
  title: string
  repo: string
  updatedAt: number // epoch ms
  selectionToken?: import('@/shared/conversation-scope').SessionCatalogSelectionToken
}

export type Workspace = {
  id: string
  name: string
  branch: string
  available: boolean
}

export type RecentProject = {
  id: string
  name: string
  lastOpenedAt: number
  pinned: boolean
  available: boolean
}

export type ModelInfo = {
  id: string
  provider: string
}

export type AgentStatus =
  | 'idle'
  | 'planning'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type ContextUsage = {
  usedK: number
  totalK: number
}

type AnchoredTurn<T> = T & { anchorEntryId?: string }

export interface UserMessageImage {
  id: string
  data: string
  mimeType: string
}

export type ResponseActivityState = 'active' | 'settled'

export type StructuredValueNode =
  | {
      kind: 'scalar'
      label?: string
      value: string
    }
  | {
      kind: 'object' | 'array'
      label?: string
      summary: string
      children: readonly StructuredValueNode[]
    }
  | {
      kind: 'truncated' | 'unsupported'
      label?: string
      summary: string
    }

export type StructuredValueProjection = {
  kind: 'empty' | 'text' | 'json' | 'scalar' | 'object' | 'array' | 'malformed' | 'truncated' | 'unsupported'
  valueKind: 'scalar' | 'object' | 'array'
  summary: string
  copyText: string
  nodes: readonly StructuredValueNode[]
  truncated: boolean
  malformed: boolean
  unsupported: boolean
}

export type ToolCallDetailKey = 'arguments' | 'progress' | 'result' | 'error' | 'patch'

export type ToolCallDetails = Partial<Record<ToolCallDetailKey, StructuredValueProjection>>

export type SubagentTaskPresentation = {
  id: string
  agent: string
  summary?: string
  markdown: string
  truncated: boolean
}

export type SubagentOutputPresentation = {
  kind: 'progress' | 'result' | 'error'
  markdown: string
  truncated: boolean
}

export type SubagentTimelineEvent = {
  /** Stable renderer identity derived from the cumulative Pi result snapshot. */
  id: string
  sequence: number
  kind: 'progress' | 'tool' | 'result' | 'error'
  state: 'active' | 'complete' | 'failed'
  markdown: string
  truncated: boolean
  agent?: string
  toolName?: string
}

export type SubagentPresentation = {
  mode: 'single' | 'parallel' | 'chain' | 'unknown'
  tasks: readonly SubagentTaskPresentation[]
  omittedTaskCount: number
  malformed: boolean
  /** null deliberately clears an earlier progress value after settlement. */
  output?: SubagentOutputPresentation | null
  /** Cumulative observable work reported by pi-subagents, never hidden thinking. */
  timeline?: readonly SubagentTimelineEvent[]
  timelineOmittedCount?: number
}

export type ResponseActivity =
  | {
      kind: 'working'
      id: string
      message: string
      state: ResponseActivityState
    }
  | {
      kind: 'status'
      id: string
      label: string
      message: string
      state: ResponseActivityState
    }
  | {
      kind: 'widget'
      id: string
      label: string
      summary: string
      details?: readonly string[]
      state: ResponseActivityState
    }
  | {
      kind: 'notification'
      id: string
      message: string
      tone: 'info' | 'warning' | 'error'
      state: 'settled'
    }
  | {
      kind: 'retry'
      id: string
      retryKind: 'provider' | 'summarization'
      phase: 'waiting' | 'attempting' | 'success' | 'error' | 'finished'
      attempt?: number
      maxAttempts?: number
      delayMs?: number
      message?: string
      state: ResponseActivityState
    }
  | {
      kind: 'extension-error'
      id: string
      message: string
      state: 'settled'
    }

export type Turn =
  | AnchoredTurn<{
      kind: 'user'
      id: string
      text: string
      time: string
      timestamp?: number
      images?: readonly UserMessageImage[]
    }>
  | AnchoredTurn<{ kind: 'agent'; id: string; markdown: string; state?: 'streaming' | 'complete' | 'aborted' | 'error' }>
  | AnchoredTurn<{ kind: 'thinking'; id: string; text: string; state: 'streaming' | 'complete' | 'aborted' | 'error' }>
  | AnchoredTurn<{ kind: 'notice'; id: string; notice: 'compacting' | 'compacted' | 'compaction-failed' | 'response-aborted' | 'response-error' }>
  | AnchoredTurn<{ kind: 'tool'; id: string; call: ToolCall }>
  | AnchoredTurn<{
      kind: 'plan'
      id: string
      markdown: string
      lifecycle: 'planning' | 'ready' | 'saved' | 'implementing'
      sourceEntryId?: string
      actions: readonly (
        | 'show'
        | 'finalize'
        | 'implement'
        | 'save'
        | 'export'
        | 'revise'
        | 'exit'
      )[]
    }>
  | AnchoredTurn<{
      kind: 'response-actions'
      id: string
      copyMarkdown: string
      forkEntryId?: string
    }>
  | AnchoredTurn<{
      kind: 'activity'
      id: string
      activity: ResponseActivity
    }>

export interface ConversationResponseGroup {
  id: string
  anchorEntryId?: string
  turns: readonly Turn[]
}

export type ConversationOutlineStatus =
  | 'pending'
  | 'running'
  | 'complete'
  | 'error'
  | 'aborted'

export type ConversationOutlineItem = {
  entryId: string
  title: string
  summary?: string
  status: ConversationOutlineStatus
  time: string
  timestamp?: number
}

export type ToolCall = {
  id: string
  kind: 'read' | 'shell' | 'edit' | 'generic'
  title: string
  status: 'queued' | 'running' | 'detached' | 'success' | 'failed' | 'cancelled'
  duration?: string
  body: string
  summary?: string
  details?: ToolCallDetails
  subagent?: SubagentPresentation
  malformed?: boolean
  detached?: boolean
  progress?: string
  output?: string
  error?: string
  patch?: string
  diff?: { added: number; deleted: number }
}

export type SubagentInspectorSelection = {
  sessionKey: string
  toolCallId: string
  sequence: number
}

export type SubagentInspectorFocusRequest = SubagentInspectorSelection

export type FileNode = {
  name: string
  path: string
  type: 'file' | 'dir'
  status?: 'modified' | 'added' | 'deleted'
  hasChildren?: boolean
  loaded?: boolean
  truncated?: boolean
  children?: FileNode[]
}
