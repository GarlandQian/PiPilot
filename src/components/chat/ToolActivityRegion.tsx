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
  selectedSubagentId?: string | null
  focusRequest?: SubagentInspectorFocusRequest | null
  onOpenSubagent?: (toolCallId: string) => void
}

function SubagentActivityRow({
  call,
  sessionKey,
  selected,
  focusRequest,
  onOpen,
}: {
  call: ToolCall
  sessionKey: string | null
  selected: boolean
  focusRequest?: SubagentInspectorFocusRequest | null
  onOpen?: (toolCallId: string) => void
}) {
  const t = useT()
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (
      focusRequest &&
      focusRequest.sessionKey === sessionKey &&
      focusRequest.toolCallId === call.id
    ) buttonRef.current?.focus()
  }, [call.id, focusRequest, sessionKey])

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
        'flex h-[var(--tool-row-h)] w-full min-w-0 items-center gap-2 rounded-sm px-1.5 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-accent/30 focus-visible:focus-ring disabled:cursor-default disabled:opacity-100 motion-reduce:transition-none',
        selected && 'bg-accent/45',
      )}
    >
      <TbChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex w-4 shrink-0 justify-center">
        <TbRobot className="size-3.5 text-muted-foreground" aria-hidden />
      </span>
      <span className="shrink-0 text-caption font-medium text-foreground">{call.title}</span>
      {call.summary ? (
        <span className="min-w-0 flex-1 truncate text-micro text-muted-foreground" title={call.summary}>
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
  focusRequest,
  onOpenSubagent,
}: Omit<ToolActivityRegionProps, 'run'> & { call: ToolCall }) {
  if (call.subagent) {
    return (
      <SubagentActivityRow
        call={call}
        sessionKey={sessionKey}
        selected={selectedSubagentId === call.id}
        focusRequest={focusRequest}
        onOpen={onOpenSubagent}
      />
    )
  }
  return <ToolCallCard call={call} />
}

function ActivitySection({
  section,
  ...props
}: Omit<ToolActivityRegionProps, 'run'> & { section: ToolActivitySection }) {
  const t = useT()
  const [open, setOpen] = React.useState(section.failedCount > 0)
  const previousFailedCountRef = React.useRef(section.failedCount)
  const Icon = categoryIcon[section.category]

  React.useEffect(() => {
    if (section.failedCount > previousFailedCountRef.current) setOpen(true)
    previousFailedCountRef.current = section.failedCount
  }, [section.failedCount])

  if (section.items.length === 1) {
    const item = section.items[0]
    return item ? <ActivityItem call={item.call} {...props} /> : null
  }

  const contentId = `${section.id}:content`
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div data-tool-activity-category={section.category}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex h-[var(--tool-row-h)] w-full min-w-0 items-center gap-2 rounded-sm px-1.5 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-accent/30 focus-visible:focus-ring motion-reduce:transition-none"
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
            <span className="min-w-0 flex-1 truncate text-caption font-medium text-foreground">
              {t(categoryLabelKey[section.category], { count: section.items.length })}
            </span>
            {section.failedCount > 0 ? (
              <span className="shrink-0 text-micro text-destructive">
                {t('tool.activity.failed', { count: section.failedCount })}
              </span>
            ) : null}
            <ToolCallStatus status={section.status} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent id={contentId}>
          <div className="ml-3.5 border-l border-border/70 py-0.5 pl-3">
            {section.items.map((item) => (
              <ActivityItem key={item.id} call={item.call} {...props} />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

export const ToolActivityRegion = React.memo(function ToolActivityRegion({
  run,
  ...props
}: ToolActivityRegionProps) {
  return (
    <div
      className="min-w-0 space-y-0.5"
      data-tool-activity-run={run.id}
    >
      {run.sections.map((section) => (
        <ActivitySection key={section.id} section={section} {...props} />
      ))}
    </div>
  )
})
