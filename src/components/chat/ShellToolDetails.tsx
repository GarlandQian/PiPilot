import * as React from 'react'
import { TbChevronRight, TbExternalLink } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ToolCall } from '@/types/chat'
import { ShellEvidence } from './ShellEvidence'

/** Keep one output stream visible; structured invocation data is secondary. */
export function ShellToolDetails({ call, onOpenCommand }: { call: ToolCall; onOpenCommand?: (toolCallId: string) => void }) {
  const t = useT()
  const [argumentsOpen, setArgumentsOpen] = React.useState(false)
  const argumentsId = React.useId()
  const live = call.status === 'running' || call.status === 'queued'
  const progress = call.progress ?? call.details?.progress?.copyText
  const result = call.output ?? call.details?.result?.copyText
  const error = call.error ?? call.details?.error?.copyText
  const output = live ? progress ?? result : result ?? progress
  const outputKind = (live && progress !== undefined) || result === undefined ? 'progress' : 'result'
  const argumentSource = call.details?.arguments

  return <div className="min-w-0 space-y-2" data-shell-tool-details>
    {call.body || onOpenCommand ? <section className="min-w-0 space-y-1">
      <header className="flex min-w-0 items-center justify-between gap-2">
        {call.body ? <h4 className="text-micro font-medium text-muted-foreground">{t('tool.command')}</h4> : <span />}
        {onOpenCommand ? <Button variant="ghost" size="xs" className="h-auto min-h-6 max-w-full whitespace-normal text-micro"
          aria-label={t('tool.redesign.openOutput')} onClick={() => onOpenCommand(call.id)}>
          <TbExternalLink className="shrink-0" aria-hidden />{t('tool.redesign.openOutput')}
        </Button> : null}
      </header>
      {call.body ? <pre className="scroll-slim max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 px-3 py-2 font-mono text-caption text-foreground/90"><code>{call.body}</code></pre> : null}
    </section> : null}
    {output !== undefined && output.length > 0 ? <ShellEvidence
      label={t(outputKind === 'progress' ? 'tool.progress' : 'tool.result')}
      source={output}
      sourceTruncated={call.details?.[outputKind]?.truncated}
      live={live}
      followOutput
    /> : live ? <p className="text-micro text-muted-foreground" role="status">{t('tool.redesign.waitingOutput')}</p> : null}
    {error && error !== output ? <ShellEvidence label={t('tool.error')} source={error}
      sourceTruncated={call.details?.error?.truncated} tone="error" followOutput /> : null}
    {call.patch || call.details?.patch?.copyText ? <ShellEvidence label={t('tool.patch')}
      source={call.patch ?? call.details?.patch?.copyText ?? ''} format="verbatim" /> : null}
    {argumentSource ? <Collapsible open={argumentsOpen} onOpenChange={setArgumentsOpen}>
      <CollapsibleTrigger asChild><button type="button"
        className="flex min-h-6 items-center gap-1.5 rounded-sm text-micro text-muted-foreground outline-none hover:text-foreground focus-visible:focus-ring"
        aria-expanded={argumentsOpen} aria-controls={argumentsId}>
        <TbChevronRight className={cn('size-3', argumentsOpen && 'rotate-90')} aria-hidden />
        {t('tool.redesign.rawArguments')}
      </button></CollapsibleTrigger>
      <CollapsibleContent id={argumentsId}><div className="pt-2">
        <ShellEvidence label={t('tool.arguments')} source={argumentSource.copyText}
          sourceTruncated={argumentSource.truncated} format="verbatim" />
      </div></CollapsibleContent>
    </Collapsible> : null}
  </div>
}
