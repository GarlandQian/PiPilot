import * as React from 'react'
import {
  TbChevronRight,
  TbFileDiff,
  TbFiles,
  TbRobot,
  TbTerminal2,
  TbTool,
} from 'react-icons/tb'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useT, type MessageKey } from '@/i18n'
import { cn } from '@/lib/utils'
import type {
  ToolActivityCategory,
  ToolActivityRun,
  ToolActivitySection,
} from '@/renderer/pi-rpc/tool-activity'
import type {
  SubagentInspectorFocusRequest,
  ToolCall,
} from '@/types/chat'
import { ToolCallCard } from './ToolCallCard'
import { ToolCallStatus } from './ToolCallStatus'

const categoryIcon = {
  commands: TbTerminal2,
  subagents: TbRobot,
  files: TbFiles,
  edits: TbFileDiff,
  other: TbTool,
} as const

const categoryLabelKey = {
  commands: 'tool.activity.commands',
  subagents: 'tool.activity.subagents',
  files: 'tool.activity.files',
  edits: 'tool.activity.edits',
  other: 'tool.activity.other',
} as const satisfies Record<ToolActivityCategory, MessageKey>

interface ToolActivityRegionProps {
  run: ToolActivityRun
  sessionKey: string | null
  visible?: boolean
  selectedSubagentId?: string | null
  focusRequest?: SubagentInspectorFocusRequest | null
  onOpenSubagent?: (toolCallId: string) => void
}

function SubagentActivityRow({
  call,
  sessionKey,
  selected,
  visible,
  focusRequest,
  onFocusReturned,
  onOpen,
}: {
  call: ToolCall
  sessionKey: string | null
  selected: boolean
  visible: boolean
  focusRequest?: SubagentInspectorFocusRequest | null
  onFocusReturned(sequence: number): void
  onOpen?: (toolCallId: string) => void
}) {
  const t = useT()
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (
      visible &&
      focusRequest &&
      focusRequest.sessionKey === sessionKey &&
      focusRequest.toolCallId === call.id
    ) {
      const button = buttonRef.current
      button?.focus()
      if (button && document.activeElement === button) onFocusReturned(focusRequest.sequence)
    }
  }, [call.id, focusRequest, onFocusReturned, sessionKey, visible])

  return (
    <button
      ref={buttonRef}
      type="button"
      data-tool-kind="generic"
      data-tool-id={call.id}
      data-subagent-call-id={call.id}
      aria-controls="subagent-execution-panel"
      aria-expanded={selected}
      aria-label={selected
        ? t('inspector.subagent.close')
        : t('tool.subagent.openExecution', { task: call.summary ?? call.title })}
      onClick={() => onOpen?.(call.id)}
      disabled={!onOpen}
      className={cn(
        'flex min-h-[var(--tool-row-h)] w-full min-w-0 items-center gap-2 rounded-sm px-1.5 py-1 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-accent/35 focus-visible:focus-ring disabled:cursor-default disabled:opacity-100 motion-reduce:transition-none',
        selected && 'bg-accent/45',
      )}
    >
      <TbChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground', selected && 'rotate-90')} aria-hidden />
      <span className="flex w-4 shrink-0 justify-center">
        <TbRobot className="size-3.5 text-muted-foreground" aria-hidden />
      </span>
      <span className="shrink-0 text-caption font-medium text-muted-foreground">{call.title}</span>
      {call.summary ? (
        <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground" title={call.summary}>
          {call.summary}
        </span>
      ) : <span className="min-w-0 flex-1" />}
      {call.duration ? (
        <span className="shrink-0 text-micro tabular-nums text-muted-foreground/70">
          {call.duration}
        </span>
      ) : null}
      <ToolCallStatus status={call.status} />
    </button>
  )
}

function ActivityItem({
  call,
  sessionKey,
  selectedSubagentId,
  visible = true,
  focusRequest,
  onFocusReturned,
  onOpenSubagent,
}: Omit<ToolActivityRegionProps, 'run'> & { call: ToolCall; onFocusReturned(sequence: number): void }) {
  if (call.subagent) {
    return (
      <SubagentActivityRow
        call={call}
        sessionKey={sessionKey}
        selected={selectedSubagentId === call.id}
        visible={visible}
        focusRequest={focusRequest}
        onFocusReturned={onFocusReturned}
        onOpen={onOpenSubagent}
      />
    )
  }
  return <ToolCallCard call={call} />
}

function ActivitySection({
  section,
  visible = true,
  ...props
}: Omit<ToolActivityRegionProps, 'run'> & { section: ToolActivitySection }) {
  const t = useT()
  const single = section.items.length === 1
  const active = section.items.some(({ call }) => call.status === 'running' || call.status === 'queued')
  const [open, setOpen] = React.useState(single || active || section.failedCount > 0)
  const manuallyToggledRef = React.useRef(false)
  const previousFailedCountRef = React.useRef(section.failedCount)
  const lastFocusSequenceRef = React.useRef<number | null>(null)
  // Keep consumption above the disclosure: its rows unmount when a category
  // closes, but reopening it must not replay an earlier return-focus request.
  const returnedFocusSequenceRef = React.useRef<number | null>(null)
  const onFocusReturned = React.useCallback((sequence: number) => {
    returnedFocusSequenceRef.current = sequence
  }, [])
  const Icon = categoryIcon[section.category]

  const { focusRequest, sessionKey } = props
  const pendingFocusRequest = focusRequest?.sequence === returnedFocusSequenceRef.current
    ? null : focusRequest
  const containsFocusTarget = focusRequest?.sessionKey === sessionKey &&
    section.items.some(({ call }) => call.id === focusRequest.toolCallId)
  React.useLayoutEffect(() => {
    if (
      !visible || !containsFocusTarget || !focusRequest ||
      lastFocusSequenceRef.current === focusRequest.sequence
    ) return
    lastFocusSequenceRef.current = focusRequest.sequence
    setOpen(true)
  }, [containsFocusTarget, focusRequest, visible])

  React.useEffect(() => {
    if (section.failedCount > previousFailedCountRef.current) setOpen(true)
    previousFailedCountRef.current = section.failedCount
  }, [section.failedCount])

  React.useEffect(() => {
    if (active && !manuallyToggledRef.current) setOpen(true)
  }, [active])

  const contentId = `${section.id}:content`
  return (
    <Collapsible open={single || open} onOpenChange={(nextOpen) => {
      manuallyToggledRef.current = true
      setOpen(nextOpen)
    }}>
      <div data-tool-activity-category={single ? undefined : section.category}>
        {!single ? <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-h-[var(--tool-row-h)] w-full min-w-0 items-center gap-2 rounded-sm px-1.5 py-1 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-accent/35 focus-visible:focus-ring motion-reduce:transition-none"
            aria-expanded={open}
            aria-controls={contentId}
          >
            <TbChevronRight
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) motion-reduce:transition-none',
                open && 'rotate-90',
              )}
              aria-hidden
            />
            <span className="flex w-4 shrink-0 justify-center">
              <Icon className="size-3.5 text-muted-foreground" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
              {t(categoryLabelKey[section.category], { count: section.items.length })}
            </span>
            {section.failedCount > 0 ? (
              <span className="shrink-0 text-micro text-destructive">
                {t('tool.activity.failed', { count: section.failedCount })}
              </span>
            ) : null}
            <ToolCallStatus status={section.status} />
          </button>
        </CollapsibleTrigger> : null}
        <CollapsibleContent id={contentId}>
          <div className={single ? undefined : 'min-w-0 space-y-0.5 pl-4'}>
            {section.items.map((item) => (
              <ActivityItem
                key={item.id}
                call={item.call}
                {...props}
                focusRequest={pendingFocusRequest}
                onFocusReturned={onFocusReturned}
                visible={visible && (single || open)}
              />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

export const ToolActivityRegion = React.memo(function ToolActivityRegion({
  run,
  visible = true,
  ...props
}: ToolActivityRegionProps) {
  return (
    <div
      className="min-w-0 space-y-0.5"
      data-tool-activity-run={run.id}
    >
      {run.sections.map((section) => (
        <ActivitySection key={section.id} section={section} {...props} visible={visible} />
      ))}
    </div>
  )
})
