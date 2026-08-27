import * as React from 'react'
import { TbPlus, TbTrash } from 'react-icons/tb'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

/**
 * Shared wide-dialog/form primitives (design §8). All visible text arrives
 * via props so callers keep owning localization.
 */

/* ------------------------------------------------------------------ */
/* FormDialog — 760px dialog: title top-left, close top-right,         */
/* scrollable body, footer with cancel + primary action right-aligned. */
/* Dirty-close confirmation is the consumer's job via onOpenChange.    */
/* ------------------------------------------------------------------ */

interface FormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  cancelLabel: React.ReactNode
  submitLabel: React.ReactNode
  onSubmit: () => void | Promise<void>
  submitDisabled?: boolean
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}

function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  cancelLabel,
  submitLabel,
  onSubmit,
  submitDisabled,
  className,
  bodyClassName,
  children,
}: FormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex max-h-[min(85vh,800px)] flex-col gap-0 p-0 sm:max-w-[760px]',
          className,
        )}
      >
        <DialogHeader className="shrink-0 gap-1 border-b border-border px-6 py-4">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className={cn('scroll-slim min-h-0 flex-1 overflow-y-auto px-6 py-4', bodyClassName)}>
          {children}
        </div>
        <DialogFooter className="shrink-0 border-t border-border px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button variant="accent" onClick={() => void onSubmit()} disabled={submitDisabled}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* FormRow — right-aligned 160px label column + control + optional     */
/* hint/error line; stacks vertically under a 520px container.         */
/* ------------------------------------------------------------------ */

interface FormRowProps {
  label: React.ReactNode
  htmlFor?: string
  hint?: React.ReactNode
  error?: React.ReactNode
  className?: string
  children: React.ReactNode
}

function FormRow({ label, htmlFor, hint, error, className, children }: FormRowProps) {
  return (
    <div className={cn('@container/form-row', className)}>
      <div className="flex flex-col gap-1.5 @min-[520px]/form-row:flex-row @min-[520px]/form-row:gap-4">
        <label
          htmlFor={htmlFor}
          className="shrink-0 text-app text-muted-foreground @min-[520px]/form-row:flex @min-[520px]/form-row:min-h-[var(--control-h)] @min-[520px]/form-row:w-40 @min-[520px]/form-row:items-center @min-[520px]/form-row:justify-end @min-[520px]/form-row:text-right"
        >
          {label}
        </label>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {children}
          {error ? (
            <p className="text-caption text-destructive">{error}</p>
          ) : hint ? (
            <p className="text-caption text-muted-foreground">{hint}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* DynamicRows — ordered rows; each row renders consumer inputs plus a */
/* delete button, with a dashed add-slot after every row and at the    */
/* end. Add-at-index preserves order; no drag.                         */
/* ------------------------------------------------------------------ */

interface DynamicRowsProps<T> {
  rows: readonly T[]
  renderRow: (row: T, index: number) => React.ReactNode
  onAdd: (index: number) => void
  onRemove: (index: number) => void
  /** aria-label for the dashed add-slot buttons */
  addLabel: string
  /** aria-label for the per-row delete icon button */
  removeLabel: string
  /**
   * Stable row identity. Defaults to the row index, which is the right
   * choice for ephemeral edit rows (keeps input focus while typing).
   */
  getKey?: (row: T, index: number) => React.Key
  className?: string
}

function DynamicRows<T>({
  rows,
  renderRow,
  onAdd,
  onRemove,
  addLabel,
  removeLabel,
  getKey,
  className,
}: DynamicRowsProps<T>) {
  const addSlot = (index: number) => (
    <button
      type="button"
      aria-label={addLabel}
      onClick={() => onAdd(index)}
      className="flex h-6 w-full items-center justify-center rounded-md border border-dashed border-border text-muted-foreground/70 transition-colors duration-(--duration-fast) outline-none hover:border-muted-foreground/40 hover:bg-accent/40 hover:text-foreground focus-visible:focus-ring"
    >
      <TbPlus className="size-3.5" aria-hidden />
    </button>
  )
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {rows.length === 0
        ? addSlot(0)
        : rows.map((row, index) => (
            <React.Fragment key={getKey ? getKey(row, index) : index}>
              <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {renderRow(row, index)}
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={removeLabel}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => onRemove(index)}
                >
                  <TbTrash aria-hidden />
                </Button>
              </div>
              {addSlot(index + 1)}
            </React.Fragment>
          ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* KeyValueRows — DynamicRows specialization with key + value inputs   */
/* (env vars, HTTP headers).                                           */
/* ------------------------------------------------------------------ */

interface KeyValueRow {
  key: string
  value: string
}

interface KeyValueRowsProps {
  rows: readonly KeyValueRow[]
  onChange: (rows: KeyValueRow[]) => void
  addLabel: string
  removeLabel: string
  keyPlaceholder?: string
  valuePlaceholder?: string
  keyAriaLabel?: string
  valueAriaLabel?: string
  className?: string
}

function KeyValueRows({
  rows,
  onChange,
  addLabel,
  removeLabel,
  keyPlaceholder,
  valuePlaceholder,
  keyAriaLabel,
  valueAriaLabel,
  className,
}: KeyValueRowsProps) {
  const updateRow = (index: number, patch: Partial<KeyValueRow>) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  return (
    <DynamicRows
      rows={rows}
      onAdd={(index) => {
        const next = [...rows]
        next.splice(index, 0, { key: '', value: '' })
        onChange(next)
      }}
      onRemove={(index) => onChange(rows.filter((_, i) => i !== index))}
      addLabel={addLabel}
      removeLabel={removeLabel}
      className={className}
      renderRow={(row, index) => (
        <>
          <Input
            value={row.key}
            placeholder={keyPlaceholder}
            aria-label={keyAriaLabel ?? keyPlaceholder}
            onChange={(event) => updateRow(index, { key: event.target.value })}
            className="w-[38%] shrink-0 font-mono"
          />
          <Input
            value={row.value}
            placeholder={valuePlaceholder}
            aria-label={valueAriaLabel ?? valuePlaceholder}
            onChange={(event) => updateRow(index, { value: event.target.value })}
            className="min-w-0 flex-1 font-mono"
          />
        </>
      )}
    />
  )
}

export {
  FormDialog,
  FormRow,
  DynamicRows,
  KeyValueRows,
  type FormDialogProps,
  type FormRowProps,
  type DynamicRowsProps,
  type KeyValueRow,
  type KeyValueRowsProps,
}
