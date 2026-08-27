import * as React from 'react'
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
import { FormDialog, FormRow } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useT } from '@/i18n'
import {
  costFieldValid,
  costGroupComplete,
  tokenFieldValid,
  type ModelFormValue,
} from './models-form-model'

interface ModelsModelFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'add' | 'edit'
  /** Initial field values for edit mode; ignored in add mode. */
  initial?: ModelFormValue
  /** Model ids already taken in the provider; the edited id is excluded. */
  existingIds: readonly string[]
  /** Called with the form value only when every field is valid. */
  onSubmit: (value: ModelFormValue) => void
}

const DEFAULT_VALUE: ModelFormValue = {
  id: '',
  name: '',
  reasoning: false,
  inputText: true,
  inputImage: false,
  contextWindow: '',
  maxTokens: '',
  costInput: '',
  costOutput: '',
  costCacheRead: '',
  costCacheWrite: '',
}

interface FormErrors {
  id?: string
  contextWindow?: string
  maxTokens?: string
  cost?: string
}

type ErrorField = keyof FormErrors

export function ModelsModelFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  existingIds,
  onSubmit,
}: ModelsModelFormDialogProps) {
  const t = useT()
  const [draft, setDraft] = React.useState<ModelFormValue>({ ...DEFAULT_VALUE })
  const [baseline, setBaseline] = React.useState('')
  const [touched, setTouched] = React.useState<Partial<Record<ErrorField, boolean>>>({})
  const [submitAttempted, setSubmitAttempted] = React.useState(false)
  const [confirmDiscard, setConfirmDiscard] = React.useState(false)

  const idId = React.useId()
  const nameId = React.useId()
  const reasoningId = React.useId()
  const inputTextId = React.useId()
  const inputImageId = React.useId()
  const contextWindowId = React.useId()
  const maxTokensId = React.useId()
  const costInputId = React.useId()
  const costOutputId = React.useId()
  const costCacheReadId = React.useId()
  const costCacheWriteId = React.useId()

  // Re-initialize once per opening; `initial` is the snapshot for that session.
  React.useEffect(() => {
    if (open) {
      const value = { ...(initial ?? DEFAULT_VALUE) }
      setDraft(value)
      setBaseline(JSON.stringify(value))
      setTouched({})
      setSubmitAttempted(false)
      setConfirmDiscard(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const update = (patch: Partial<ModelFormValue>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
  }

  const touch = (field: ErrorField) => {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }))
  }

  const errors = React.useMemo<FormErrors>(() => {
    const next: FormErrors = {}
    const id = draft.id.trim()
    if (id.length === 0) {
      next.id = t('settings.models.form.idRequired')
    } else {
      const own = mode === 'edit' ? initial?.id : undefined
      if (existingIds.some((existing) => existing === id && existing !== own)) {
        next.id = t('settings.models.form.idDuplicateModel')
      }
    }
    if (!tokenFieldValid(draft.contextWindow)) {
      next.contextWindow = t('settings.models.form.tokenInvalid')
    }
    if (!tokenFieldValid(draft.maxTokens)) {
      next.maxTokens = t('settings.models.form.tokenInvalid')
    }
    if (
      !costFieldValid(draft.costInput) ||
      !costFieldValid(draft.costOutput) ||
      !costFieldValid(draft.costCacheRead) ||
      !costFieldValid(draft.costCacheWrite)
    ) {
      next.cost = t('settings.models.form.costInvalid')
    } else if (!costGroupComplete(draft)) {
      next.cost = t('settings.models.form.costIncomplete')
    }
    return next
  }, [draft, existingIds, initial, mode, t])

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
      setTouched({ id: true, contextWindow: true, maxTokens: true, cost: true })
      return
    }
    onSubmit({ ...draft, id: draft.id.trim(), name: draft.name.trim() })
  }

  const requiredMark = (
    <span className="text-destructive" aria-hidden="true">
      {' *'}
    </span>
  )

  const costField = (
    id: string,
    label: string,
    value: string,
    patch: (next: string) => void,
  ) => (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-micro text-muted-foreground">{label}</span>
      <Input
        id={id}
        value={value}
        inputMode="decimal"
        aria-invalid={(showError('cost') && errors.cost !== undefined) || undefined}
        className="font-mono"
        onChange={(event) => patch(event.target.value)}
        onBlur={() => touch('cost')}
      />
    </label>
  )

  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={requestOpenChange}
        title={t(mode === 'add'
          ? 'settings.models.form.titleAddModel'
          : 'settings.models.form.titleEditModel')}
        cancelLabel={t('common.cancel')}
        submitLabel={t(mode === 'add'
          ? 'settings.models.form.submitAdd'
          : 'settings.models.form.submitEdit')}
        onSubmit={handleSubmit}
      >
        <div className="flex flex-col gap-4">
          <FormRow
            label={<span>{t('settings.models.form.id')}{requiredMark}</span>}
            htmlFor={idId}
            error={showError('id') ? errors.id : undefined}
            hint={mode === 'add' ? t('settings.models.form.idPlaceholder') : undefined}
          >
            <Input
              id={idId}
              value={draft.id}
              aria-invalid={(showError('id') && errors.id !== undefined) || undefined}
              className="font-mono"
              onChange={(event) => update({ id: event.target.value })}
              onBlur={() => touch('id')}
            />
          </FormRow>

          <FormRow label={t('settings.models.form.name')} htmlFor={nameId}>
            <Input
              id={nameId}
              value={draft.name}
              placeholder={t('settings.models.form.namePlaceholder')}
              onChange={(event) => update({ name: event.target.value })}
            />
          </FormRow>

          <FormRow label={t('settings.models.form.reasoning')} htmlFor={reasoningId}>
            <div className="flex min-h-[var(--control-h)] items-center">
              <Switch
                id={reasoningId}
                checked={draft.reasoning}
                onCheckedChange={(reasoning) => update({ reasoning })}
              />
            </div>
          </FormRow>

          <FormRow label={t('settings.models.form.input')}>
            <div className="flex min-h-[var(--control-h)] flex-wrap items-center gap-x-5 gap-y-1">
              <div className="flex items-center gap-2">
                <Switch id={inputTextId} checked={draft.inputText} disabled />
                <label htmlFor={inputTextId} className="text-caption text-foreground">
                  {t('settings.models.form.inputText')}
                </label>
                <span className="text-micro text-muted-foreground">
                  {t('settings.models.form.inputTextHint')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id={inputImageId}
                  checked={draft.inputImage}
                  onCheckedChange={(inputImage) => update({ inputImage })}
                />
                <label htmlFor={inputImageId} className="text-caption text-foreground">
                  {t('settings.models.form.inputImage')}
                </label>
              </div>
            </div>
          </FormRow>

          <FormRow
            label={t('settings.models.form.contextWindow')}
            htmlFor={contextWindowId}
            error={showError('contextWindow') ? errors.contextWindow : undefined}
          >
            <Input
              id={contextWindowId}
              value={draft.contextWindow}
              inputMode="numeric"
              placeholder="200000"
              aria-invalid={
                (showError('contextWindow') && errors.contextWindow !== undefined) || undefined
              }
              className="font-mono"
              onChange={(event) => update({ contextWindow: event.target.value })}
              onBlur={() => touch('contextWindow')}
            />
          </FormRow>

          <FormRow
            label={t('settings.models.form.maxTokens')}
            htmlFor={maxTokensId}
            error={showError('maxTokens') ? errors.maxTokens : undefined}
          >
            <Input
              id={maxTokensId}
              value={draft.maxTokens}
              inputMode="numeric"
              placeholder="8192"
              aria-invalid={(showError('maxTokens') && errors.maxTokens !== undefined) || undefined}
              className="font-mono"
              onChange={(event) => update({ maxTokens: event.target.value })}
              onBlur={() => touch('maxTokens')}
            />
          </FormRow>

          <FormRow
            label={t('settings.models.form.cost')}
            error={showError('cost') ? errors.cost : undefined}
          >
            <div className="flex flex-wrap gap-2">
              {costField(
                costInputId,
                t('settings.models.form.costInput'),
                draft.costInput,
                (next) => update({ costInput: next }),
              )}
              {costField(
                costOutputId,
                t('settings.models.form.costOutput'),
                draft.costOutput,
                (next) => update({ costOutput: next }),
              )}
              {costField(
                costCacheReadId,
                t('settings.models.form.costCacheRead'),
                draft.costCacheRead,
                (next) => update({ costCacheRead: next }),
              )}
              {costField(
                costCacheWriteId,
                t('settings.models.form.costCacheWrite'),
                draft.costCacheWrite,
                (next) => update({ costCacheWrite: next }),
              )}
            </div>
          </FormRow>
        </div>
      </FormDialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.models.form.dirtyTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.models.form.dirtyDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('settings.models.form.dirtyKeep')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmDiscard(false)
                onOpenChange(false)
              }}
            >
              {t('settings.models.form.dirtyDiscard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
