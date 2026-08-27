import * as React from 'react'
import { TbCheck, TbChevronRight, TbCopy } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type {
  StructuredValueNode,
  StructuredValueProjection,
} from '@/types/chat'

function StructuredNodeView({
  node,
  depth,
  truncatedLabel,
  unsupportedLabel,
}: {
  node: StructuredValueNode
  depth: number
  truncatedLabel: string
  unsupportedLabel: string
}) {
  if (node.kind === 'object' || node.kind === 'array') {
    return (
      <details className="group/value min-w-0" open={depth === 0}>
        <summary className="flex min-h-6 cursor-pointer list-none items-center gap-1 rounded-sm px-1 outline-none hover:bg-accent/25 focus-visible:focus-ring [&::-webkit-details-marker]:hidden">
          <TbChevronRight className="size-3 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) group-open/value:rotate-90 motion-reduce:transition-none" aria-hidden />
          {node.label ? (
            <span className="max-w-40 shrink-0 truncate font-mono text-micro text-muted-foreground" title={node.label}>
              {node.label}
            </span>
          ) : null}
          <span className="min-w-0 break-words font-mono text-micro text-foreground/80">
            {node.summary}
          </span>
        </summary>
        <div className="ml-2.5 min-w-0 border-l border-border/70 pl-2">
          {node.children.map((child) => (
            <StructuredNodeView
              key={`${child.kind}:${child.label ?? child.kind}`}
              node={child}
              depth={depth + 1}
              truncatedLabel={truncatedLabel}
              unsupportedLabel={unsupportedLabel}
            />
          ))}
        </div>
      </details>
    )
  }

  if (!node.label) {
    return (
      <div className={cn(
        'min-w-0 whitespace-pre-wrap break-words px-1 py-0.5 font-mono text-micro text-foreground/90',
        node.kind === 'unsupported' && 'text-destructive',
        node.kind === 'truncated' && 'italic text-muted-foreground',
      )}>
        {node.kind === 'scalar'
          ? node.value
          : node.kind === 'unsupported'
            ? unsupportedLabel
            : truncatedLabel}
      </div>
    )
  }

  return (
    <div className="grid min-h-6 min-w-0 grid-cols-[minmax(4rem,10rem)_minmax(0,1fr)] items-start gap-2 px-1 py-0.5">
      <span className="truncate font-mono text-micro text-muted-foreground" title={node.label}>
        {node.label ?? ''}
      </span>
      <span className={cn(
        'min-w-0 whitespace-pre-wrap break-words font-mono text-micro text-foreground/90',
        node.kind === 'unsupported' && 'text-destructive',
        node.kind === 'truncated' && 'italic text-muted-foreground',
      )}>
        {node.kind === 'scalar'
          ? node.value
          : node.kind === 'unsupported'
            ? unsupportedLabel
            : truncatedLabel}
      </span>
    </div>
  )
}

export function StructuredValueView({
  label,
  projection,
  tone = 'default',
}: {
  label: string
  projection: StructuredValueProjection
  tone?: 'default' | 'error'
}) {
  const t = useT()
  const [copied, setCopied] = React.useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(projection.copyText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="min-w-0">
      <div className="mb-1 flex min-h-6 items-center gap-2">
        <h4 className={cn(
          'min-w-0 flex-1 text-micro font-medium text-muted-foreground',
          tone === 'error' && 'text-destructive',
        )}>
          {label}
        </h4>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => void copy()}
              aria-label={copied ? t('tool.copied') : t('tool.copy')}
            >
              {copied ? <TbCheck aria-hidden /> : <TbCopy aria-hidden />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? t('tool.copied') : t('tool.copy')}</TooltipContent>
        </Tooltip>
      </div>
      <div className={cn(
        'scroll-slim max-h-52 min-w-0 overflow-x-hidden overflow-y-auto rounded-md bg-muted/50 p-1.5',
        tone === 'error' && 'bg-destructive/10',
      )}>
        {projection.malformed ? (
          <p className="mb-1 px-1 text-micro text-warning" role="status">
            {t('tool.valueMalformed')}
          </p>
        ) : null}
        {projection.unsupported ? (
          <p className="mb-1 px-1 text-micro text-destructive" role="status">
            {t('tool.valueUnsupported')}
          </p>
        ) : null}
        {projection.nodes.map((node) => (
          <StructuredNodeView
            key={`${node.kind}:${node.label ?? 'root'}`}
            node={node}
            depth={0}
            truncatedLabel={t('tool.valueTruncated')}
            unsupportedLabel={t('tool.valueUnsupported')}
          />
        ))}
        {projection.truncated ? (
          <p className="mt-1 px-1 text-micro italic text-muted-foreground" role="status">
            {t('tool.valueTruncated')}
          </p>
        ) : null}
      </div>
    </section>
  )
}
