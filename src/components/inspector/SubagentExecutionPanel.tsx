import * as React from 'react'
import {
  TbArrowDown,
  TbArrowsMaximize,
  TbArrowsMinimize,
  TbRobot,
} from 'react-icons/tb'
import { SubagentConversation } from '@/components/chat/SubagentConversation'
import { useFollowingViewport } from '@/components/chat/useFollowingViewport'
import { ToolCallStatus } from '@/components/chat/ToolCallStatus'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { useSettings } from '@/store/settings'
import type { ToolCall } from '@/types/chat'

interface SubagentExecutionPanelProps {
  call: ToolCall
  onClose: () => void
  onExpand?: () => void
  expanded?: boolean
}

export function SubagentExecutionPanel({ call, onClose, onExpand, expanded = false }: SubagentExecutionPanelProps) {
  const t = useT()
  const { appearance } = useSettings()
  const panelRef = React.useRef<HTMLDivElement>(null)
  const presentation = call.subagent
  const [selection, setSelection] = React.useState<string>()
  const { scrollRef, contentRef, scrollProps, canJumpToLatest, scrollToLatest } =
    useFollowingViewport({
      ownerKey: `${call.id}:${selection ?? 'first'}`,
      revision: call,
      smooth: !appearance.reducedMotion &&
        typeof window !== 'undefined' &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    })

  React.useEffect(() => {
    setSelection(undefined)
    panelRef.current?.focus()
  }, [call.id])

  const title = presentation?.tasks[0]?.summary ||
    presentation?.tasks[0]?.agent ||
    call.summary ||
    call.title

  return (
    <section
      ref={panelRef}
      id="subagent-execution-panel"
      tabIndex={-1}
      aria-label={t('inspector.subagent.title')}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-sidebar outline-none"
      data-subagent-execution-panel={call.id}
    >
      <header className="flex h-(--frame-header-h) shrink-0 items-center gap-2 border-b border-border px-2.5">
        <TbRobot className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-caption font-medium text-foreground" title={title}>
            {title}
          </h2>
          <p className="truncate text-micro text-muted-foreground">
            {t('inspector.subagent.redesign.readOnly')}
          </p>
        </div>
        <ToolCallStatus status={call.status} live />
        {onExpand ? <Button variant="ghost" size="icon-sm" onClick={onExpand} aria-label={t(expanded ? 'inspector.subagent.redesign.collapse' : 'inspector.subagent.redesign.expand')} title={t(expanded ? 'inspector.subagent.redesign.collapse' : 'inspector.subagent.redesign.expand')}>
          {expanded ? <TbArrowsMinimize aria-hidden /> : <TbArrowsMaximize aria-hidden />}
        </Button> : null}
      </header>

      <div
        ref={scrollRef}
        {...scrollProps}
        tabIndex={0}
        className="scroll-slim min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3 outline-none focus-visible:focus-ring"
      >
        <div ref={contentRef} className="mx-auto w-full min-w-0 max-w-3xl">
          {presentation ? (
            <SubagentConversation
              key={call.id}
              presentation={presentation}
              status={call.status}
              scrollable={false}
              taskDisclosure
              selectedViewId={selection}
              onSelectedViewChange={setSelection}
            />
          ) : (
            <p className="text-caption text-muted-foreground">
              {t('inspector.subagent.unavailable')}
            </p>
          )}
        </div>
      </div>

      {canJumpToLatest ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => scrollToLatest()}
          className="mx-auto my-2 shrink-0 border border-border"
          aria-label={t('inspector.subagent.followLatest')}
        >
          <TbArrowDown aria-hidden />
          {t('inspector.subagent.followLatest')}
        </Button>
      ) : null}
    </section>
  )
}
