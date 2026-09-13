import * as React from 'react'
import {
  TbArrowBackUp,
  TbArrowDown,
  TbRobot,
  TbX,
} from 'react-icons/tb'
import { SubagentDetails } from '@/components/chat/ToolCallCard'
import { useFollowingViewport } from '@/components/chat/useFollowingViewport'
import { ToolCallStatus } from '@/components/chat/ToolCallStatus'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useSettings } from '@/store/settings'
import type { ToolCall } from '@/types/chat'

interface SubagentExecutionPanelProps {
  call: ToolCall
  onClose: () => void
}

export function SubagentExecutionPanel({ call, onClose }: SubagentExecutionPanelProps) {
  const t = useT()
  const { appearance } = useSettings()
  const panelRef = React.useRef<HTMLDivElement>(null)
  const presentation = call.subagent
  const { scrollRef, contentRef, scrollProps, canJumpToLatest, scrollToLatest } =
    useFollowingViewport({
      ownerKey: call.id,
      revision: call,
      smooth: !appearance.reducedMotion &&
        typeof window !== 'undefined' &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    })

  React.useEffect(() => {
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
        onClose()
      }}
      className="absolute inset-0 z-10 flex min-h-0 flex-col bg-sidebar outline-none"
      data-subagent-execution-panel={call.id}
    >
      <header className="flex h-(--frame-header-h) shrink-0 items-center gap-2 border-b border-border px-2.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label={t('inspector.subagent.back')}
            >
              <TbArrowBackUp aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('inspector.subagent.back')}</TooltipContent>
        </Tooltip>
        <TbRobot className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-caption font-medium text-foreground" title={title}>
            {title}
          </h2>
          <p className="truncate text-micro text-muted-foreground">
            {t('inspector.subagent.execution')}
          </p>
        </div>
        <ToolCallStatus status={call.status} live />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label={t('inspector.subagent.close')}
            >
              <TbX aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('inspector.subagent.close')}</TooltipContent>
        </Tooltip>
      </header>

      <div
        ref={scrollRef}
        {...scrollProps}
        tabIndex={0}
        className="scroll-slim min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3 outline-none focus-visible:focus-ring"
      >
        <div ref={contentRef} className="min-w-0">
          {presentation ? (
            <SubagentDetails
              key={call.id}
              presentation={presentation}
              scrollable={false}
              taskDisclosure
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
          className={cn(
            'absolute bottom-3 left-1/2 -translate-x-1/2 border border-border',
          )}
          aria-label={t('inspector.subagent.followLatest')}
        >
          <TbArrowDown aria-hidden />
          {t('inspector.subagent.followLatest')}
        </Button>
      ) : null}
    </section>
  )
}
