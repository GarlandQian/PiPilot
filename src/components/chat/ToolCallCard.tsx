import * as React from 'react'
import {
  TbCheck,
  TbChevronRight,
  TbCopy,
  TbFileDiff,
  TbFileText,
  TbTerminal2,
  TbTool,
} from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { classifyWorkspaceFile } from '@/components/inspector/workspace-file-kind'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { projectPlainText } from '@/renderer/pi-rpc/structured-value'
import { toolCallCopyText } from '@/renderer/pi-rpc/tool-presenters'
import { useSettings } from '@/store/settings'
import type {
  StructuredValueNode,
  StructuredValueProjection,
  ToolCall,
} from '@/types/chat'
import { MarkdownContent } from './markdown/MarkdownContent'
import { isVerbatimToolEvidence, ShellEvidence } from './ShellEvidence'
import { SubagentDetails } from './SubagentConversation'
import { ShellToolDetails } from './ShellToolDetails'
import { ToolCallStatus } from './ToolCallStatus'

const kindIcon = {
  read: TbFileText,
  shell: TbTerminal2,
  edit: TbFileDiff,
  generic: TbTool,
} as const

const detailLabelKey = {
  arguments: 'tool.arguments',
  progress: 'tool.progress',
  result: 'tool.result',
  error: 'tool.error',
  patch: 'tool.patch',
} as const

function ValueFields({ nodes, verbatim = false }: {
  nodes: readonly StructuredValueNode[]
  verbatim?: boolean
}) {
  const t = useT()
  return (
    <div className="min-w-0 space-y-2">
      {nodes.map((node, index) => {
        const literalField = verbatim || /^(?:commands?|paths?|files?|file_?path|file_?name|cwd|code|source|patch|diff|old_?text|new_?text|old_string|new_string)$/iu.test(node.label ?? '')
        return (
          <div key={`${node.label ?? node.kind}:${index}`} className="min-w-0">
            {node.label ? (
              <p className="mb-0.5 break-words text-micro text-muted-foreground">{node.label}</p>
            ) : null}
            <div className={cn('min-w-0', node.label && 'pl-2')}>
              {node.kind === 'object' || node.kind === 'array' ? (
                node.children.length > 0 ? (
                  <ValueFields nodes={node.children} verbatim={literalField} />
                ) : (
                  <span className="font-mono text-caption text-muted-foreground">
                    {node.kind === 'object' ? '{}' : '[]'}
                  </span>
                )
              ) : node.kind === 'scalar' ? (
                literalField || isVerbatimToolEvidence(node.value) ? (
                  <pre className="whitespace-pre-wrap break-words font-mono text-caption leading-relaxed text-foreground/85">
                    {node.value}
                  </pre>
                ) : <MarkdownContent markdown={node.value} />
              ) : (
                <p className={cn('text-micro', node.kind === 'unsupported' ? 'text-destructive' : 'text-muted-foreground')}>
                  {t(node.kind === 'unsupported' ? 'tool.valueUnsupported' : 'tool.valueTruncated')}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ToolValueEvidence({
  label,
  projection,
  source,
  format = 'markdown',
  tone = 'default',
}: {
  label: string
  projection?: StructuredValueProjection
  source?: string
  format?: 'auto' | 'markdown' | 'verbatim'
  tone?: 'default' | 'error'
}) {
  const t = useT()
  if (!projection && !source) return null
  const text = source ?? projection?.copyText ?? ''
  const fields = format !== 'verbatim' && projection &&
    !projection.malformed && !projection.unsupported &&
    (projection.valueKind === 'object' || projection.valueKind === 'array')

  return (
    <div className="min-w-0 space-y-1">
      {projection?.malformed ? (
        <p className="text-micro text-warning" role="status">{t('tool.valueMalformed')}</p>
      ) : null}
      {projection?.unsupported ? (
        <p className="text-micro text-destructive" role="status">{t('tool.valueUnsupported')}</p>
      ) : null}
      {fields ? (
        <section className="min-w-0 space-y-1.5">
          <h4 className={cn('text-micro font-medium text-muted-foreground', tone === 'error' && 'text-destructive')}>
            {label}
          </h4>
          <div className="scroll-slim max-h-[min(28rem,55vh)] min-w-0 overflow-auto pr-1">
            <ValueFields nodes={projection.nodes} />
          </div>
          {projection.truncated ? (
            <p className="text-micro text-muted-foreground">{t('tool.valueTruncated')}</p>
          ) : null}
        </section>
      ) : (
        <ShellEvidence
          label={label}
          source={text}
          sourceTruncated={projection?.truncated}
          tone={tone}
          format={source === undefined && (projection?.malformed || projection?.unsupported) ? 'verbatim' : format}
        />
      )}
    </div>
  )
}

export { SubagentDetails } from './SubagentConversation'

export function ToolCallCard({ call, onOpenCommand }: { call: ToolCall; onOpenCommand?: (toolCallId: string) => void }) {
  const t = useT()
  const { appearance } = useSettings()
  const [open, setOpen] = React.useState(!appearance.compactToolCards || call.status === 'failed')
  const [sourceOpen, setSourceOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const previousFailedRef = React.useRef(call.status === 'failed')
  const copyFeedbackTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentId = React.useId()
  const sourceContentId = React.useId()
  const Icon = kindIcon[call.kind]
  const details = {
    arguments: call.kind === 'shell'
      ? undefined
      : call.details?.arguments ?? (call.body ? projectPlainText(call.body) : undefined),
    progress: call.details?.progress ?? (call.progress ? projectPlainText(call.progress) : undefined),
    result: call.details?.result ?? (call.output ? projectPlainText(call.output) : undefined),
    error: call.details?.error ?? (call.error ? projectPlainText(call.error) : undefined),
    patch: call.details?.patch ?? (call.patch ? projectPlainText(call.patch) : undefined),
  }
  const argumentProjection = call.kind === 'shell' ? undefined : call.details?.arguments
  const summary = call.malformed || argumentProjection?.kind === 'malformed'
    ? t('tool.valueMalformed')
    : argumentProjection?.kind === 'unsupported'
      ? t('tool.valueUnsupported')
      : argumentProjection?.kind === 'truncated'
        ? t('tool.valueTruncated')
        : call.summary ?? call.body
  const argumentRoot = argumentProjection?.nodes[0]
  const argumentFields = argumentRoot?.kind === 'object' ? argumentRoot.children : []
  const contentFields = call.kind === 'edit' && !details.patch
    ? argumentFields.filter((node) => node.kind === 'scalar' && ['content', 'oldText', 'newText'].includes(node.label ?? ''))
    : []
  const readFileKind = call.kind === 'read' ? classifyWorkspaceFile(call.body.trim()).kind : null
  const resultFormat = readFileKind === 'source' || ['grep', 'find', 'ls'].includes(call.title.toLowerCase())
    ? 'verbatim' : readFileKind === 'plain' ? 'auto' : 'markdown'
  const sourceEntries = Object.entries(details).filter(
    (entry): entry is [keyof typeof detailLabelKey, StructuredValueProjection] => entry[1] !== undefined,
  )

  React.useEffect(() => () => {
    if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current)
  }, [])

  React.useEffect(() => {
    const failed = call.status === 'failed'
    if (!previousFailedRef.current && failed) setOpen(true)
    previousFailedRef.current = failed
  }, [call.status])

  const copy = async () => {
    const value = toolCallCopyText(call)
    if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current)
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      copyFeedbackTimer.current = setTimeout(() => {
        setCopied(false)
        copyFeedbackTimer.current = null
      }, 1_200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="group/tool min-w-0" data-tool-kind={call.kind} data-tool-id={call.id}>
        <div className="flex min-w-0 items-center gap-0.5 rounded-sm hover:bg-accent/35">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-h-[var(--tool-row-h)] min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-left outline-none transition-colors duration-(--duration-fast) focus-visible:focus-ring motion-reduce:transition-none"
              aria-expanded={open}
              aria-controls={contentId}
            >
              <TbChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) motion-reduce:transition-none', open && 'rotate-90')} aria-hidden />
              <span className="flex w-4 shrink-0 justify-center"><Icon className="size-3.5 text-muted-foreground" aria-hidden /></span>
              {call.kind !== 'shell' ? <span className="shrink-0 text-caption font-medium text-muted-foreground">{call.title}</span> : null}
              {call.kind === 'shell' ? (
                <span className="min-w-0 flex-1 truncate font-mono text-caption text-foreground/85" title={call.body || call.title}>
                  <span className="mr-1.5 text-muted-foreground" aria-hidden>$</span>{call.body || call.title}
                </span>
              ) : summary ? (
                <span className={cn(
                  'min-w-0 flex-1 truncate text-caption text-muted-foreground',
                  !call.subagent && 'font-mono',
                )} title={summary}>
                  {summary}
                </span>
              ) : <span className="min-w-0 flex-1" />}
              {call.diff && (
                <span className="shrink-0 text-micro tabular-nums">
                  <span className="text-sage">+{call.diff.added}</span>
                  {' / '}
                  <span className="text-destructive">-{call.diff.deleted}</span>
                </span>
              )}
              {call.kind === 'shell' && typeof call.exitCode === 'number' && Number.isInteger(call.exitCode) ? <span className="shrink-0 text-micro tabular-nums text-muted-foreground/70">{t('tool.redesign.exitCode', { code: call.exitCode })}</span> : null}
              {call.duration && <span className="shrink-0 text-micro tabular-nums text-muted-foreground/70">{call.duration}</span>}
              <ToolCallStatus status={call.status} />
            </button>
          </CollapsibleTrigger>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className={cn(
                  'mr-1 shrink-0 opacity-0 group-hover/tool:opacity-100 focus-visible:opacity-100',
                  (open || copied) && 'opacity-100',
                )}
                onClick={() => void copy()}
                aria-label={copied ? t('tool.copied') : t('tool.copy')}
              >
                {copied ? <TbCheck className="text-sage" aria-hidden /> : <TbCopy aria-hidden />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{copied ? t('tool.copied') : t('tool.copy')}</TooltipContent>
          </Tooltip>
        </div>
        <CollapsibleContent id={contentId}>
          <div className="ml-7 min-w-0 space-y-3 pb-3 pl-1 pt-1">
            {call.subagent ? (
              <SubagentDetails presentation={call.subagent} status={call.status} />
            ) : call.kind === 'shell' ? (
              <ShellToolDetails call={call} onOpenCommand={onOpenCommand} />
            ) : (
              <>
                {call.kind === 'generic' ? (
                  <ToolValueEvidence label={t('tool.arguments')} projection={details.arguments} />
                ) : argumentProjection?.malformed || argumentProjection?.unsupported ? (
                  <p className="text-micro text-destructive" role="status">
                    {t(argumentProjection.malformed ? 'tool.valueMalformed' : 'tool.valueUnsupported')}
                  </p>
                ) : null}
                {contentFields.map((field) => field.kind === 'scalar' ? (
                  <ShellEvidence
                    key={field.label}
                    label={t(field.label === 'oldText'
                      ? 'tool.previousContent'
                      : field.label === 'newText'
                        ? 'tool.newContent'
                        : 'tool.content')}
                    source={field.value}
                    sourceTruncated={argumentProjection?.truncated}
                    format="verbatim"
                  />
                ) : null)}
                <ToolValueEvidence label={t('tool.progress')} projection={details.progress} source={call.progress} format={resultFormat} />
                <ToolValueEvidence label={t('tool.result')} projection={details.result} source={call.output} format={resultFormat} />
                <ToolValueEvidence label={t('tool.error')} projection={details.error} source={call.error} tone="error" />
                <ToolValueEvidence label={t('tool.patch')} projection={details.patch} source={call.patch} format="verbatim" />
                {sourceEntries.length > 0 ? (
                  <Collapsible open={sourceOpen} onOpenChange={setSourceOpen}>
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex min-h-6 items-center gap-1.5 rounded-sm text-micro text-muted-foreground outline-none hover:text-foreground focus-visible:focus-ring"
                        aria-expanded={sourceOpen}
                        aria-controls={sourceContentId}
                      >
                        <TbChevronRight className={cn('size-3 transition-transform duration-(--duration-fast) motion-reduce:transition-none', sourceOpen && 'rotate-90')} aria-hidden />
                        {t('tool.source')}
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent id={sourceContentId}>
                      <div className="min-w-0 space-y-3 pt-2">
                        {sourceEntries.map(([key, projection]) => (
                          <ShellEvidence
                            key={key}
                            label={t(detailLabelKey[key])}
                            source={projection.copyText}
                            sourceTruncated={projection.truncated}
                            tone={key === 'error' ? 'error' : 'default'}
                            format="verbatim"
                          />
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ) : null}
              </>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
