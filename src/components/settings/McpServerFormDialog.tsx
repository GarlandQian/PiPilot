import * as React from 'react'
import { TbAdjustmentsHorizontal, TbPlug, TbTerminal2, TbWorld } from 'react-icons/tb'

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
import { getMcpFormErrors, type McpFormErrorField } from './mcp-server-form-model'

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

type ErrorField = McpFormErrorField

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
  const envId = React.useId()
  const headersId = React.useId()

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

  const errors = React.useMemo(() => getMcpFormErrors(draft, existingNames, mode === 'edit' ? initial?.name : undefined), [draft, existingNames, initial?.name, mode])

  const showError = (field: ErrorField) => submitAttempted || touched[field] === true
  const fieldError = (field: ErrorField, id: string) => showError(field) && errors[field]
    ? <span id={`${id}-error`} role="alert">{t(errors[field]!)}</span>
    : undefined

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
      const field = (Object.keys(errors) as ErrorField[])[0]
      const id = field && ({ name: nameId, command: commandId, url: urlId, env: envId, headers: headersId })[field]
      requestAnimationFrame(() => {
        const target = id ? document.getElementById(id) : null
        if (target?.matches('input')) target.focus()
        else target?.querySelector<HTMLInputElement>('input')?.focus()
      })
      return
    }
    onSubmit({
      ...draft,
      name: draft.name.trim(),
      command: draft.command.trim(),
      args: [...draft.args],
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
        <div className="@container/mcp-form flex min-w-0 flex-col gap-6">
          <fieldset className="min-w-0 space-y-4">
            <legend className="mb-4 flex items-center gap-2 text-app font-semibold text-foreground">
              <TbPlug className="size-4 text-muted-foreground" aria-hidden />
              {t('settings.integrations.mcp.form.connection')}
            </legend>
            <FormRow
              label={
                <span>
                  {t('mcp.form.name')}
                  {requiredMark}
                </span>
              }
              htmlFor={nameId}
              error={fieldError('name', nameId)}
            >
              <Input
                id={nameId}
                value={draft.name}
                placeholder={t('mcp.form.name.placeholder')}
                aria-invalid={(showError('name') && errors.name !== undefined) || undefined}
                aria-describedby={showError('name') && errors.name ? `${nameId}-error` : undefined}
                onChange={(event) => update({ name: event.target.value })}
                onBlur={() => touch('name')}
              />
            </FormRow>

            <FormRow
              label={t('mcp.form.transport')}
              hint={t(
                draft.transport === 'stdio'
                  ? 'settings.integrations.mcp.form.stdioHint'
                  : 'settings.integrations.mcp.form.httpHint',
              )}
            >
              <div
                className="grid min-w-0 grid-cols-1 gap-2 @min-[360px]/mcp-form:grid-cols-2"
                role="group"
                aria-label={t('mcp.form.transport')}
              >
                {(['stdio', 'http'] as const).map((candidate) => (
                  <Button
                    key={candidate}
                    variant="outline"
                    aria-pressed={draft.transport === candidate}
                    className={cn(
                      'h-auto min-w-0 justify-start gap-2 px-3 py-2.5 text-caption',
                      draft.transport === candidate
                        ? 'border-primary/50 bg-primary/5 text-foreground hover:bg-primary/10'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => update({ transport: candidate })}
                  >
                    {candidate === 'stdio' ? (
                      <TbTerminal2 className="size-4 shrink-0" aria-hidden />
                    ) : (
                      <TbWorld className="size-4 shrink-0" aria-hidden />
                    )}
                    <span className="min-w-0 whitespace-normal text-left">
                      {t(`mcp.form.transport.${candidate}`)}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        'ml-auto size-3 shrink-0 rounded-full border',
                        draft.transport === candidate
                          ? 'border-primary bg-primary ring-2 ring-primary/15'
                          : 'border-border',
                      )}
                    />
                  </Button>
                ))}
              </div>
            </FormRow>
          </fieldset>

          <div className="border-t border-border pt-5">
            {draft.transport === 'stdio' ? (
              <fieldset key="stdio" className="min-w-0 space-y-4">
                <legend className="mb-4 flex items-center gap-2 text-app font-semibold text-foreground">
                  <TbTerminal2 className="size-4 text-muted-foreground" aria-hidden />
                  {t('settings.integrations.mcp.form.stdio')}
                </legend>
                <FormRow
                  label={
                    <span>
                      {t('mcp.form.command')}
                      {requiredMark}
                    </span>
                  }
                  htmlFor={commandId}
                  error={fieldError('command', commandId)}
                >
                  <Input
                    id={commandId}
                    value={draft.command}
                    placeholder={t('mcp.form.command.placeholder')}
                    aria-invalid={(showError('command') && errors.command !== undefined) || undefined}
                    aria-describedby={showError('command') && errors.command ? `${commandId}-error` : undefined}
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

                <FormRow label={t('mcp.form.env')} error={fieldError('env', envId)}>
                  <div id={envId} role="group" aria-label={t('mcp.form.env')} aria-invalid={showError('env') && Boolean(errors.env)} aria-describedby={showError('env') && errors.env ? `${envId}-error` : undefined}>
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
                  </div>
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
              </fieldset>
            ) : (
              <fieldset key="http" className="min-w-0 space-y-4">
                <legend className="mb-4 flex items-center gap-2 text-app font-semibold text-foreground">
                  <TbWorld className="size-4 text-muted-foreground" aria-hidden />
                  {t('settings.integrations.mcp.form.http')}
                </legend>
                <FormRow
                  label={
                    <span>
                      {t('mcp.form.url')}
                      {requiredMark}
                    </span>
                  }
                  htmlFor={urlId}
                  error={fieldError('url', urlId)}
                >
                  <Input
                    id={urlId}
                    value={draft.url}
                    placeholder={t('mcp.form.url.placeholder')}
                    aria-invalid={(showError('url') && errors.url !== undefined) || undefined}
                    aria-describedby={showError('url') && errors.url ? `${urlId}-error` : undefined}
                    className="font-mono"
                    onChange={(event) => update({ url: event.target.value })}
                    onBlur={() => touch('url')}
                  />
                </FormRow>

                <FormRow
                  label={t('mcp.form.headers')}
                  error={fieldError('headers', headersId)}
                >
                  <div id={headersId} role="group" aria-label={t('mcp.form.headers')} aria-invalid={showError('headers') && Boolean(errors.headers)} aria-describedby={showError('headers') && errors.headers ? `${headersId}-error` : undefined}>
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
                  </div>
                </FormRow>
              </fieldset>
            )}
          </div>

          <div className="border-t border-border pt-5">
            <fieldset className="min-w-0 space-y-4">
              <legend className="mb-4 flex items-center gap-2 text-app font-semibold text-foreground">
                <TbAdjustmentsHorizontal className="size-4 text-muted-foreground" aria-hidden />
                {t('settings.integrations.mcp.form.preferences')}
              </legend>
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
            </fieldset>
          </div>
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
