import { Node, type NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { TbQuote, TbX } from 'react-icons/tb'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { isPrecisionReference, PRECISION_REFERENCE_NODE, precisionReferenceLabel, serializePrecisionReference } from '@/renderer/composer/precision-reference'

function ReferenceView({ node, selected, deleteNode }: NodeViewProps) {
  const t = useT()
  const reference = node.attrs.reference
  if (!isPrecisionReference(reference)) return null
  const label = precisionReferenceLabel(reference)
  return <NodeViewWrapper as="span" contentEditable={false} data-precision-reference={reference.kind}
    className={cn('mx-0.5 inline-flex max-w-full items-center gap-1 rounded border border-border bg-muted/70 px-1 py-0.5 align-baseline text-caption', selected && 'ring-1 ring-ring')}>
    <Popover><PopoverTrigger asChild><button type="button" className="inline-flex min-w-0 items-center gap-1 text-left outline-none focus-visible:focus-ring" aria-label={t('precision.inspectReference', { label })}>
      <TbQuote className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{label}</span>
    </button></PopoverTrigger><PopoverContent className="max-h-96 w-96 max-w-[90vw] overflow-auto text-caption" align="start">
      <p className="font-medium">{label}</p>
      <p className="my-1 text-micro text-muted-foreground">{t('precision.snapshot')}</p>
      {reference.stale ? <p role="status" className="my-2 text-warning">{t('precision.stale')}</p> : null}
      <pre className="scroll-slim my-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-micro">{reference.text}</pre>
      {reference.comment ? <p className="whitespace-pre-wrap">{reference.comment}</p> : null}
    </PopoverContent></Popover>
    <button type="button" className="shrink-0 rounded outline-none hover:bg-accent focus-visible:focus-ring" onClick={deleteNode} aria-label={t('precision.removeReference', { label })}><TbX className="size-3" aria-hidden /></button>
  </NodeViewWrapper>
}

export const PrecisionReferenceNode = Node.create({
  name: PRECISION_REFERENCE_NODE,
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  addAttributes: () => ({ reference: { default: null, rendered: false } }),
  parseHTML: () => [],
  renderHTML: ({ node }) => ['span', {}, isPrecisionReference(node.attrs.reference) ? precisionReferenceLabel(node.attrs.reference) : ''],
  renderText: ({ node }) => isPrecisionReference(node.attrs.reference) ? serializePrecisionReference(node.attrs.reference) : '',
  addNodeView: () => ReactNodeViewRenderer(ReferenceView),
})
