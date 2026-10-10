import * as React from 'react'
import { TbChevronRight, TbInfoCircle, TbLoader2 } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/*
 * The settings kit (macOS 27 System Settings). A page is a column of
 * groups; a group is a rounded box of rows; a row is a label on the left and
 * its control on the right. Explanations stay out of the way behind ⓘ, and
 * narrow widths (under 420px) stack a row's label above its control.
 */

export function SettingsPage({ children, className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('min-w-0 space-y-6', className)} {...props}>{children}</div>
}

/** ⓘ beside a label: the explanation appears on hover or focus. */
export function InfoTip({ children, label }: { children: React.ReactNode; label?: string }) {
  const t = useT()
  return <Tooltip delayDuration={150}>
    <TooltipTrigger asChild>
      <button type="button" aria-label={label ?? t('settings.kit.moreInfo')}
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/80 outline-none hover:text-foreground focus-visible:focus-ring">
        <TbInfoCircle className="size-3.5" aria-hidden />
      </button>
    </TooltipTrigger>
    <TooltipContent side="top" className="max-w-72 px-2.5 py-1.5 text-caption leading-snug">{children}</TooltipContent>
  </Tooltip>
}

/** A titled box of rows; actions sit at the end of the title line, a note below the box. */
export function SettingsGroup({ title, info, actions, footer, children, className, boxClassName, boxRole, ...props }: Omit<React.ComponentProps<'section'>, 'title'> & {
  title?: React.ReactNode
  info?: React.ReactNode
  actions?: React.ReactNode
  footer?: React.ReactNode
  boxClassName?: string
  /** "list" when the rows are the items of a list. */
  boxRole?: string
}) {
  return <section className={cn('min-w-0', className)} aria-label={typeof title === 'string' ? title : undefined} {...props}>
    {title || actions ? <header className="mb-1.5 flex min-h-7 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-2.5">
      {title ? <div className="flex min-w-0 items-center gap-1.5">
        <h2 className="min-w-0 text-app font-semibold text-foreground">{title}</h2>
        {info ? <InfoTip>{info}</InfoTip> : null}
      </div> : null}
      {actions ? <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1">{actions}</div> : null}
    </header> : null}
    <div role={boxRole} className={cn('settings-group min-w-0', boxClassName)}>{children}</div>
    {footer ? <div className="mt-1.5 px-2.5 text-caption leading-snug text-muted-foreground">{footer}</div> : null}
  </section>
}

function RowLabel({ label, info, description, htmlFor, id }: { label: React.ReactNode; info?: React.ReactNode; description?: React.ReactNode; htmlFor?: string; id?: string }) {
  const Label = htmlFor ? 'label' : 'span'
  return <div className="min-w-0 flex-1">
    <div className="flex min-w-0 items-center gap-1.5">
      <Label id={id} htmlFor={htmlFor} className="min-w-0 text-app text-foreground">{label}</Label>
      {info ? <InfoTip>{info}</InfoTip> : null}
    </div>
    {description ? <div className="mt-0.5 text-caption leading-snug text-muted-foreground">{description}</div> : null}
  </div>
}

/** One setting: label (with an optional ⓘ and one short line) on the left, its control on the right. */
export function SettingsRow({ label, info, description, icon, htmlFor, children, className, labelId, ...props }: Omit<React.ComponentProps<'div'>, 'children'> & {
  label: React.ReactNode
  info?: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  htmlFor?: string
  labelId?: string
  children?: React.ReactNode
}) {
  return <div data-settings-row className={cn('flex min-h-[40px] min-w-0 flex-col gap-2 px-3 py-1.5 @min-[420px]/settings-workspace:flex-row @min-[420px]/settings-workspace:items-center @min-[420px]/settings-workspace:gap-4', className)}
    style={icon ? { '--settings-row-inset': '46px' } as React.CSSProperties : undefined} {...props}>
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      {icon}
      <RowLabel label={label} info={info} description={description} htmlFor={htmlFor} id={labelId} />
    </div>
    {children !== undefined ? <div className="flex min-w-0 flex-wrap items-center gap-2 @min-[420px]/settings-workspace:max-w-[62%] @min-[420px]/settings-workspace:shrink-0 @min-[420px]/settings-workspace:justify-end">{children}</div> : null}
  </div>
}

/**
 * A form field on a detail page or in a sheet: the label in a column on the
 * left, the field filling the rest, its hint or error below the field.
 */
export function SettingsField({ label, info, htmlFor, error, hint, children, className, feedbackId }: {
  label: React.ReactNode
  info?: React.ReactNode
  htmlFor?: string
  error?: React.ReactNode
  hint?: React.ReactNode
  children: React.ReactNode
  className?: string
  feedbackId?: string
}) {
  const feedback = feedbackId ?? (htmlFor ? `${htmlFor}-feedback` : undefined)
  return <div data-settings-row className={cn('grid min-w-0 gap-1.5 px-3 py-1.5 @min-[420px]/settings-workspace:grid-cols-[168px_minmax(0,1fr)] @min-[420px]/settings-workspace:items-start @min-[420px]/settings-workspace:gap-4', className)}>
    <div className="flex min-w-0 items-center gap-1.5 @min-[420px]/settings-workspace:min-h-[var(--control-h)]">
      <label htmlFor={htmlFor} className="min-w-0 text-app text-foreground">{label}</label>
      {info ? <InfoTip>{info}</InfoTip> : null}
    </div>
    <div className="min-w-0 space-y-1">
      {children}
      {error ? <p id={feedback} className="text-caption text-destructive" role="alert">{error}</p>
        : hint ? <p id={feedback} className="text-caption leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  </div>
}

/** A row that opens a page of its own: label, current value, ›. */
export function SettingsLinkRow({ label, value, icon, onClick, disabled, ...props }: Omit<React.ComponentProps<'button'>, 'value'> & {
  label: React.ReactNode
  value?: React.ReactNode
  icon?: React.ReactNode
}) {
  const labelId = React.useId()
  return <div data-settings-row data-pressable className="flex min-h-[40px] min-w-0 items-center gap-2.5 px-3 py-1.5"
    style={icon ? { '--settings-row-inset': '46px' } as React.CSSProperties : undefined}>
    <button type="button" data-settings-row-action disabled={disabled} onClick={onClick} aria-labelledby={labelId}
      className="absolute inset-0 rounded-[inherit] outline-none focus-visible:focus-ring disabled:cursor-default" {...props} />
    {icon ? <span className="pointer-events-none relative">{icon}</span> : null}
    <span id={labelId} className="pointer-events-none relative min-w-0 flex-1 text-app">{label}</span>
    {value ? <span className="pointer-events-none relative min-w-0 truncate text-app text-muted-foreground">{value}</span> : null}
    <TbChevronRight className="pointer-events-none relative size-4 shrink-0 text-muted-foreground/70" aria-hidden />
  </div>
}

/**
 * One item in a list (a provider, a server): its icon, name and one line of
 * status; actions hide in ⋯, and the whole row opens its page.
 */
export function SettingsListRow({ icon, title, badges, subtitle, status, accessory, menu, onOpen, openLabel, disabled, dimmed, recent, className, ...props }: Omit<React.ComponentProps<'div'>, 'title'> & {
  icon?: React.ReactNode
  title: React.ReactNode
  badges?: React.ReactNode
  subtitle?: React.ReactNode
  status?: React.ReactNode
  /** A control that works without opening the row, such as an enable switch. */
  accessory?: React.ReactNode
  menu?: React.ReactNode
  onOpen?(): void
  openLabel?: string
  disabled?: boolean
  dimmed?: boolean
  recent?: boolean
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!recent) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reducedMotion === 'true'
    ref.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  }, [recent])
  return <div ref={ref} role="listitem" data-settings-row data-pressable={onOpen ? true : undefined} data-recent={recent || undefined}
    className={cn('flex min-h-[48px] min-w-0 items-center gap-3 px-3 py-1.5', className)}
    style={icon ? { '--settings-row-inset': '56px' } as React.CSSProperties : undefined} {...props}>
    {onOpen ? <button type="button" data-settings-row-action aria-label={openLabel} disabled={disabled} onClick={onOpen}
      className="absolute inset-0 rounded-[inherit] outline-none focus-visible:focus-ring disabled:cursor-default" /> : null}
    {icon ? <span className={cn('pointer-events-none relative shrink-0', dimmed && 'opacity-50')}>{icon}</span> : null}
    <span className={cn('pointer-events-none relative min-w-0 flex-1', dimmed && 'opacity-60')}>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-app text-foreground">{title}</span>
        {badges}
      </span>
      {subtitle ? <span className="mt-0.5 block truncate text-caption text-muted-foreground">{subtitle}</span> : null}
    </span>
    {status ? <span className="pointer-events-none relative flex min-w-0 max-w-[40%] shrink-0 items-center justify-end text-caption">{status}</span> : null}
    {accessory || menu ? <span className="relative z-10 flex shrink-0 items-center gap-1">{accessory}{menu}</span> : null}
    {onOpen ? <TbChevronRight className="pointer-events-none relative -mr-0.5 size-4 shrink-0 text-muted-foreground/70" aria-hidden /> : null}
  </div>
}

/** A short colored state line: ✓ Connected, Needs a key… */
export function StatusText({ tone = 'neutral', icon, children, title, className }: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
  icon?: React.ReactNode
  children: React.ReactNode
  title?: string
  className?: string
}) {
  return <span title={title} className={cn('inline-flex min-w-0 items-center gap-1 text-caption', {
    neutral: 'text-muted-foreground', success: 'text-success', warning: 'text-warning', danger: 'text-destructive',
  }[tone], className)}>{icon}<span className="truncate">{children}</span></span>
}

export function SettingsBadge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'accent' | 'success' | 'warning'; children: React.ReactNode; className?: string }) {
  return <span className={cn('inline-flex h-[17px] shrink-0 items-center rounded-full px-1.5 text-micro font-medium', {
    neutral: 'bg-fill-strong text-secondary-foreground', accent: 'bg-primary/12 text-primary', success: 'bg-success/14 text-success', warning: 'bg-warning/14 text-warning',
  }[tone], className)}>{children}</span>
}

/** The object a detail page edits: its icon, name and state, and the one action that matters most. */
export function SettingsIdentity({ icon, title, subtitle, actions, children, ...props }: Omit<React.ComponentProps<'div'>, 'title'> & {
  icon?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
}) {
  return <div className="settings-group flex min-w-0 flex-wrap items-center gap-3 px-3.5 py-3" data-settings-identity {...props}>
    {icon}
    <div className="min-w-0 flex-1">
      <p className="break-words text-[calc(var(--app-font-size)+2px)] font-semibold leading-tight text-foreground">{title}</p>
      {subtitle ? <div className="mt-1 text-caption text-muted-foreground">{subtitle}</div> : null}
      {children}
    </div>
    {actions ? <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div> : null}
  </div>
}

/** A row that hides a group of rarely needed rows until opened. */
export function SettingsDisclosure({ label, summary, open, onOpenChange, children }: {
  label: React.ReactNode
  summary?: React.ReactNode
  open: boolean
  onOpenChange(open: boolean): void
  children: React.ReactNode
}) {
  const labelId = React.useId()
  return <>
    <div data-settings-row data-pressable className="flex min-h-[40px] min-w-0 items-center gap-2 px-3 py-1.5">
      <button type="button" data-settings-row-action aria-expanded={open} aria-labelledby={labelId} onClick={() => onOpenChange(!open)}
        className="absolute inset-0 rounded-[inherit] outline-none focus-visible:focus-ring" />
      <span id={labelId} className="pointer-events-none relative min-w-0 flex-1 text-app">{label}</span>
      {summary && !open ? <span className="pointer-events-none relative min-w-0 truncate text-caption text-muted-foreground">{summary}</span> : null}
      <TbChevronRight className={cn('pointer-events-none relative size-4 shrink-0 text-muted-foreground/70 transition-transform motion-reduce:transition-none', open && 'rotate-90')} aria-hidden />
    </div>
    {open ? children : null}
  </>
}

/** Cancel and Save at the end of a page (or a sheet), right-aligned like a sheet's buttons. */
export function FormActions({ onCancel, onSave, saving = false, canSave = true, saveLabel, cancelLabel, error, status, leading, className }: {
  onCancel?(): void
  onSave(): void
  saving?: boolean
  canSave?: boolean
  saveLabel?: string
  cancelLabel?: string
  error?: string | null
  status?: React.ReactNode
  leading?: React.ReactNode
  className?: string
}) {
  const t = useT()
  return <div className={cn('flex min-w-0 flex-wrap items-center justify-end gap-2', className)} data-settings-actions>
    {leading}
    <div className="mr-auto min-w-0 flex-1 basis-48">
      {error ? <div className="text-caption text-destructive [&_.md-body]:text-caption [&_.md-body]:text-destructive" role="alert"><MarkdownContent markdown={error} /></div>
        : status ? <div className="text-caption text-muted-foreground" role="status">{status}</div> : null}
    </div>
    {onCancel ? <Button variant="outline" className="min-w-[76px]" disabled={saving} onClick={onCancel}>{cancelLabel ?? t('common.cancel')}</Button> : null}
    <Button className="min-w-[76px]" disabled={!canSave || saving} onClick={onSave}>
      {saving ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}{saveLabel ?? t('common.save')}
    </Button>
  </div>
}

/** A sheet: slides from under the toolbar over the settings, for picking or editing something small. */
export function SettingsSheet({ open, onOpenChange, title, description, children, footer, wide = false, ...props }: {
  open: boolean
  onOpenChange(open: boolean): void
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean
} & Omit<React.ComponentProps<typeof DialogContent>, 'title' | 'children'>) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    {/* Like a macOS sheet, a click beside it does not dismiss it (and lose what was typed); Esc and Cancel do. */}
    <DialogContent showCloseButton={false} {...props} onPointerDownOutside={(event) => { props.onPointerDownOutside?.(event); event.preventDefault() }}
      className={cn('top-[calc(var(--frame-header-h)+6px)] flex max-h-[calc(100vh-var(--frame-header-h)-24px)] translate-y-0 flex-col gap-0 overflow-hidden rounded-[20px] p-0',
        wide ? 'sm:max-w-[640px]' : 'sm:max-w-[540px]', props.className)}>
      <div className="shrink-0 px-5 pt-4 pb-3">
        {/* A command's ellipsis stays on its button or menu item; the sheet it opens is titled without one. */}
        <DialogTitle className="pr-0 text-app font-semibold">{typeof title === 'string' ? title.replace(/…$/u, '') : title}</DialogTitle>
        {/* A div, so a description may hold block content (an extension's Markdown) and still be the dialog's description. */}
        {description ? <DialogDescription asChild><div className="mt-1 text-caption leading-snug text-muted-foreground">{description}</div></DialogDescription>
          : <DialogDescription asChild><div className="sr-only">{title}</div></DialogDescription>}
      </div>
      <div className="@container/settings-workspace scroll-slim min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
      {footer ? <div className="shrink-0 border-t border-border/70 px-5 py-3">{footer}</div> : null}
    </DialogContent>
  </Dialog>
}
