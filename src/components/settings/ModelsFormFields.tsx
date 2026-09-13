import type * as React from 'react'
import { TbChevronRight } from 'react-icons/tb'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

export function ModelsFormField({ label, htmlFor, hint, error, feedbackId, children }: {
  label: React.ReactNode
  htmlFor?: string
  hint?: React.ReactNode
  error?: React.ReactNode
  feedbackId?: string
  children: React.ReactNode
}) {
  return <div className="min-w-0 space-y-1.5">
    <label htmlFor={htmlFor} className="block text-caption font-medium text-foreground">{label}</label>
    <div className="min-w-0 space-y-1.5">{children}</div>
    {error ? <p id={feedbackId ?? (htmlFor ? `${htmlFor}-feedback` : undefined)} className="text-caption text-destructive" role="alert">{error}</p>
      : hint ? <p id={feedbackId ?? (htmlFor ? `${htmlFor}-feedback` : undefined)} className="text-micro leading-relaxed text-muted-foreground">{hint}</p> : null}
  </div>
}

export function ModelsFormGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="min-w-0 space-y-4 border-t border-border pt-5 first:border-t-0 first:pt-0" aria-label={title}>
    <h3 className="text-caption font-semibold">{title}</h3>
    {children}
  </section>
}

export function ModelsAdvancedFields({ open, onOpenChange, title, description, children }: {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  description?: string
  children: React.ReactNode
}) {
  return <Collapsible open={open} onOpenChange={onOpenChange} className="min-w-0 border-t border-border pt-2">
    <CollapsibleTrigger asChild><button type="button" className="flex w-full items-start gap-2 rounded-md py-3 text-left outline-none focus-visible:focus-ring" aria-expanded={open}>
      <TbChevronRight className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden />
      <span><span className="block text-caption font-medium">{title}</span>{description ? <span className="mt-1 block text-micro leading-relaxed text-muted-foreground">{description}</span> : null}</span>
    </button></CollapsibleTrigger>
    <CollapsibleContent><div className="space-y-4 pb-2 pt-2">{children}</div></CollapsibleContent>
  </Collapsible>
}
