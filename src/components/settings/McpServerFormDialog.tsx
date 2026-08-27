import * as React from 'react'

import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DynamicRows,
  FormDialog,
  FormRow,
  KeyValueRows,
  type KeyValueRow,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

/**
 * Shared MCP server Add/Edit form dialog (design §9). One component serves
 * both flows; the consumer maps the submitted value onto the JSONC document
 * via the comment-preserving draft helpers. All strings come from the
 * `mcp.form.*` i18n namespace.
 */

type McpFormTransport = 'stdio' | 'http'

interface McpServerFormValue {
  name: string
  transport: McpFormTransport
  command: string
  args: string[]
  env: KeyValueRow[]
  cwd: string
  url: string
  headers: KeyValueRow[]
  enabled: boolean
  description: string
}

interface McpServerFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'add' | 'edit'
  /** Initial field values for edit mode; ignored in add mode. */
  initial?: McpServerFormValue
  /**
   * Names already taken in the current scope, compared case-insensitively.
   * In edit mode the edited server's own name (`initial.name`) is excluded.
   */
  existingNames: readonly string[]
  /** Called with the normalized value only when every field is valid. */
  onSubmit: (value: McpServerFormValue) => void
}

const DEFAULT_VALUE: McpServerFormValue = {
  name: '',
  transport: 'stdio',
  command: '',
  args: [],
  env: [],
  cwd: '',
  url: '',
  headers: [],
  enabled: true,
  description: '',
}

function cloneValue(value: McpServerFormValue): McpServerFormValue {
  return {
    ...value,
    args: [...value.args],
    env: value.env.map((row) => ({ ...row })),
    headers: value.headers.map((row) => ({ ...row })),
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

interface FormErrors {
  name?: string
  command?: string
  url?: string
  env?: string
  headers?: string
}

type ErrorField = keyof FormErrors

function McpServerFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  existingNames,
  onSubmit,
}: McpServerFormDialogProps) {
  const t = useT()
  const [draft, setDraft] = React.useState<McpServerFormValue>(() => cloneValue(DEFAULT_VALUE))
  const [baseline, setBaseline] = React.useState('')
  const [touched, setTouched] = React.useState<Partial<Record<ErrorField, boolean>>>({})
  const [submitAttempted, setSubmitAttempted] = React.useState(false)
  const [confirmDiscard, setConfirmDiscard] = React.useState(false)

  const nameId = React.useId()
  const commandId = React.useId()
  const urlId = React.useId()
  const cwdId = React.useId()
  const enabledId = React.useId()
  const descriptionId = React.useId()

  // Re-initialize the draft once per dialog opening; `initial` is the
  // snapshot for that editing session and intentionally not a dependency.
  React.useEffect(() => {
    if (open) {
      const value = cloneValue(initial ?? DEFAULT_VALUE)
      setDraft(value)
      setBaseline(JSON.stringify(value))
      setTouched({})
      setSubmitAttempted(false)
      setConfirmDiscard(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const update = (patch: Partial<McpServerFormValue>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
  }

  const touch = (field: ErrorField) => {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }))
  }

  const errors = React.useMemo<FormErrors>(() => {
    const next: FormErrors = {}
    const name = draft.name.trim()
    if (name.length === 0) {
      next.name = t('mcp.form.name.required')
    } else {
      const lowered = name.toLowerCase()
      const own = mode === 'edit' ? initial?.name.trim().toLowerCase() : undefined
      if (
        existingNames.some((existing) => {
          const candidate = existing.trim().toLowerCase()
          return candidate === lowered && candidate !== own
        })
      ) {
        next.name = t('mcp.form.name.duplicate')
      }
    }
    if (draft.transport === 'stdio' && draft.command.trim().length === 0) {
      next.command = t('mcp.form.command.required')
    }
    if (draft.transport === 'http') {
      const url = draft.url.trim()
      if (url.length === 0) next.url = t('mcp.form.url.required')
      else if (!isHttpUrl(url)) next.url = t('mcp.form.url.invalid')
    }
    if (draft.env.some((row) => row.key.trim().length === 0)) {
      next.env = t('mcp.form.kv.emptyKey')
    }
    if (draft.headers.some((row) => row.key.trim().length === 0)) {
      next.headers = t('mcp.form.kv.emptyKey')
    }
    return next
  }, [draft, existingNames, initial, mode, t])

  const showError = (field: ErrorField) => submitAttempted || touched[field] === true

  const isDirty = JSON.stringify(draft) !== baseline

  const requestOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true)
      return
    }
    if (isDirty) setConfirmDiscard(true)
    else onOpenChange(false)
  }

  const handleSubmit = () => {
    if (Object.keys(errors).length > 0) {
      setSubmitAttempted(true)
      setTouched({ name: true, command: true, url: true, env: true, headers: true })
      return
    }
    onSubmit({
      ...draft,
      name: draft.name.trim(),
      command: draft.command.trim(),
      args: draft.args.map((arg) => arg.trim()).filter((arg) => arg.length > 0),
      env: draft.env.map((row) => ({ key: row.key.trim(), value: row.value })),
      cwd: draft.cwd.trim(),
      url: draft.url.trim(),
      headers: draft.headers.map((row) => ({ key: row.key.trim(), value: row.value })),
      description: draft.description.trim(),
    })
  }

  const requiredMark = (
    <span className="text-destructive" aria-hidden="true">
      {' *'}
    </span>
  )

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={requestOpenChange}
        title={mode === 'add' ? t('mcp.form.title.add') : t('mcp.form.title.edit')}
        cancelLabel={t('mcp.form.cancel')}
        submitLabel={mode === 'add' ? t('mcp.form.submit.add') : t('mcp.form.submit.edit')}
        onSubmit={handleSubmit}
      >
        <div className="flex flex-col gap-4">
          <FormRow
            label={
              <span>
                {t('mcp.form.name')}
                {requiredMark}
              </span>
            }
            htmlFor={nameId}
            error={showError('name') ? errors.name : undefined}
          >
            <Input
              id={nameId}
              value={draft.name}
              placeholder={t('mcp.form.name.placeholder')}
              aria-invalid={(showError('name') && errors.name !== undefined) || undefined}
              onChange={(event) => update({ name: event.target.value })}
              onBlur={() => touch('name')}
            />
          </FormRow>

          <FormRow label={t('mcp.form.transport')}>
            <div className="flex min-h-[var(--control-h)] items-center">
              <div
                className="inline-flex rounded-md bg-muted p-0.5"
                role="group"
                aria-label={t('mcp.form.transport')}
              >
                {(['stdio', 'http'] as const).map((candidate) => (
                  <Button
                    key={candidate}
                    variant="ghost"
                    size="sm"
                    aria-pressed={draft.transport === candidate}
                    className={cn(
                      'h-7 px-3 text-caption',
                      draft.transport === candidate
                        ? 'bg-background text-foreground hover:bg-background'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => update({ transport: candidate })}
                  >
                    {t(`mcp.form.transport.${candidate}`)}
                  </Button>
                ))}
              </div>
            </div>
          </FormRow>

          {draft.transport === 'stdio' ? (
            <>
              <FormRow
                label={
                  <span>
                    {t('mcp.form.command')}
                    {requiredMark}
                  </span>
                }
                htmlFor={commandId}
                error={showError('command') ? errors.command : undefined}
              >
                <Input
                  id={commandId}
                  value={draft.command}
                  placeholder={t('mcp.form.command.placeholder')}
                  aria-invalid={(showError('command') && errors.command !== undefined) || undefined}
                  className="font-mono"
                  onChange={(event) => update({ command: event.target.value })}
                  onBlur={() => touch('command')}
                />
              </FormRow>

              <FormRow label={t('mcp.form.args')}>
                <DynamicRows
                  rows={draft.args}
                  onAdd={(index) => {
                    const next = [...draft.args]
                    next.splice(index, 0, '')
                    update({ args: next })
                  }}
                  onRemove={(index) =>
                    update({ args: draft.args.filter((_, rowIndex) => rowIndex !== index) })
                  }
                  addLabel={t('mcp.form.rows.add')}
                  removeLabel={t('mcp.form.rows.remove')}
                  renderRow={(row, index) => (
                    <Input
                      value={row}
                      placeholder={t('mcp.form.args.placeholder')}
                      aria-label={`${t('mcp.form.args')} ${index + 1}`}
                      className="font-mono"
                      onChange={(event) =>
                        update({
                          args: draft.args.map((arg, rowIndex) =>
                            rowIndex === index ? event.target.value : arg,
                          ),
                        })
                      }
                    />
                  )}
                />
              </FormRow>

              <FormRow label={t('mcp.form.env')} error={showError('env') ? errors.env : undefined}>
                <KeyValueRows
                  rows={draft.env}
                  onChange={(rows) => {
                    touch('env')
                    update({ env: rows })
                  }}
                  addLabel={t('mcp.form.rows.add')}
                  removeLabel={t('mcp.form.rows.remove')}
                  keyPlaceholder={t('mcp.form.kv.keyPlaceholder')}
                  valuePlaceholder={t('mcp.form.kv.valuePlaceholder')}
                />
              </FormRow>

              <FormRow label={t('mcp.form.cwd')} htmlFor={cwdId}>
                <Input
                  id={cwdId}
                  value={draft.cwd}
                  placeholder={t('mcp.form.cwd.placeholder')}
                  className="font-mono"
                  onChange={(event) => update({ cwd: event.target.value })}
                />
              </FormRow>
            </>
          ) : (
            <>
              <FormRow
                label={
                  <span>
                    {t('mcp.form.url')}
                    {requiredMark}
                  </span>
                }
                htmlFor={urlId}
                error={showError('url') ? errors.url : undefined}
              >
                <Input
                  id={urlId}
                  value={draft.url}
                  placeholder={t('mcp.form.url.placeholder')}
                  aria-invalid={(showError('url') && errors.url !== undefined) || undefined}
                  className="font-mono"
                  onChange={(event) => update({ url: event.target.value })}
                  onBlur={() => touch('url')}
                />
              </FormRow>

              <FormRow
                label={t('mcp.form.headers')}
                error={showError('headers') ? errors.headers : undefined}
              >
                <KeyValueRows
                  rows={draft.headers}
                  onChange={(rows) => {
                    touch('headers')
                    update({ headers: rows })
                  }}
                  addLabel={t('mcp.form.rows.add')}
                  removeLabel={t('mcp.form.rows.remove')}
                  keyPlaceholder={t('mcp.form.kv.keyPlaceholder')}
                  valuePlaceholder={t('mcp.form.kv.valuePlaceholder')}
                />
              </FormRow>
            </>
          )}

          <FormRow label={t('mcp.form.enabled')} htmlFor={enabledId}>
            <div className="flex min-h-[var(--control-h)] items-center">
              <Switch
                id={enabledId}
                checked={draft.enabled}
                onCheckedChange={(enabled) => update({ enabled })}
              />
            </div>
          </FormRow>

          <FormRow
            label={t('mcp.form.description')}
            htmlFor={descriptionId}
            hint={t('mcp.form.description.hint')}
          >
            <Input
              id={descriptionId}
              value={draft.description}
              placeholder={t('mcp.form.description.placeholder')}
              onChange={(event) => update({ description: event.target.value })}
            />
          </FormRow>
        </div>
      </FormDialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('mcp.form.dirty.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('mcp.form.dirty.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('mcp.form.dirty.keep')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmDiscard(false)
                onOpenChange(false)
              }}
            >
              {t('mcp.form.dirty.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export {
  McpServerFormDialog,
  type McpFormTransport,
  type McpServerFormDialogProps,
  type McpServerFormValue,
}
