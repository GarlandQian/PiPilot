import * as React from 'react'
import { TbTerminal2 } from 'react-icons/tb'
import { ShellToolDetails } from '@/components/chat/ShellToolDetails'
import { ToolCallStatus } from '@/components/chat/ToolCallStatus'
import { useT } from '@/i18n'
import type { ToolCall } from '@/types/chat'

/** Read-only execution evidence. Interactive input belongs to the bottom terminal. */
export function CommandExecutionPanel({ call, onClose }: { call: ToolCall; onClose(): void }) {
  const t = useT()
  const panelRef = React.useRef<HTMLElement>(null)
  React.useEffect(() => { panelRef.current?.focus() }, [call.id])
  return <section ref={panelRef} tabIndex={-1} data-command-execution-panel={call.id}
    aria-label={t('inspector.tab.command')}
    className="flex h-full min-h-0 min-w-0 flex-col outline-none"
    onKeyDown={(event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }}>
    <header className="flex min-h-11 shrink-0 items-center gap-2 border-b border-border px-2.5">
      <TbTerminal2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <h2 className="min-w-0 flex-1 truncate font-mono text-caption" title={call.body ?? call.title}>{call.body ?? call.title}</h2>
      <ToolCallStatus status={call.status} live />
    </header>
    <div className="scroll-slim min-h-0 flex-1 overflow-auto p-3 [--command-output-height:65vh] [&_[data-shell-log-output]]:max-h-(--command-output-height)">
      <div className="mx-auto min-w-0 max-w-5xl"><ShellToolDetails key={call.id} call={call} /></div>
    </div>
  </section>
}
