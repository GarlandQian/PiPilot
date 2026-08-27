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
import { Checkbox } from '@/components/ui/checkbox'
import { FormDialog, FormRow, KeyValueRows } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useT } from '@/i18n'
import type { ProviderFormValue } from './models-form-model'

const API_TYPES = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'openai-codex-responses',
  'google-generative-ai',
  'google-vertex',
  'azure-openai-responses',
  'mistral-conversations',
  'bedrock-converse-stream',
] as const

const DEFAULT_API_VALUE = '__provider_default__'
const GOOGLE_AI_STUDIO_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

interface ModelsProviderFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'add' | 'edit'
  /** Initial field values for edit mode; ignored in add mode. */
  initial?: ProviderFormValue
  /** Whether the edited provider currently stores an apiKey. */
  hasApiKey?: boolean
  /** Provider ids already taken (case-insensitive); the edited id is excluded. */
  existingIds: readonly string[]
  /** Called with the form value only when every field is valid. */
  onSubmit: (value: ProviderFormValue) => void
}

const DEFAULT_VALUE: ProviderFormValue = {
  id: '',
  name: '',
  baseUrl: '',
  api: '',
  apiKeyDraft: '',
  clearKey: false,
  headers: [],
}

function cloneValue(value: ProviderFormValue): ProviderFormValue {
  return { ...value, headers: value.headers.map((row) => ({ ...row })) }
}

interface FormErrors {
  id?: string
  headers?: string
}

type ErrorField = keyof FormErrors

export function ModelsProviderFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  hasApiKey = false,
  existingIds,
  onSubmit,
}: ModelsProviderFormDialogProps) {
  const t = useT()
  const [draft, setDraft] = React.useState<ProviderFormValue>(() => cloneValue(DEFAULT_VALUE))
  const [baseline, setBaseline] = React.useState('')
  const [touched, setTouched] = React.useState<Partial<Record<ErrorField, boolean>>>({})
  const [submitAttempted, setSubmitAttempted] = React.useState(false)
  const [confirmDiscard, setConfirmDiscard] = React.useState(false)

  const idId = React.useId()
  const nameId = React.useId()
  const baseUrlId = React.useId()
  const apiId = React.useId()
  const apiKeyId = React.useId()
  const clearKeyId = React.useId()

  // Re-initialize once per opening; `initial` is the snapshot for that session.
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

  const update = (patch: Partial<ProviderFormValue>) => {
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
      const lowered = id.toLowerCase()
      const own = mode === 'edit' ? initial?.id.trim().toLowerCase() : undefined
      if (
        existingIds.some((existing) => {
          const candidate = existing.trim().toLowerCase()
            return candidate === lowered && candidate !== own
        })
      ) {
        next.id = t('settings.models.form.idDuplicateProvider')
      }
    }
    if (draft.headers.some((row) => row.key.trim().length === 0)) {
      next.headers = t('settings.models.form.kvEmptyKey')
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
      setTouched({ id: true, headers: true })
      return
    }
    onSubmit({
      ...draft,
      id: draft.id.trim(),
      name: draft.name.trim(),
      baseUrl: draft.baseUrl.trim(),
      api: draft.api.trim(),
      headers: draft.headers.map((row) => ({ key: row.key.trim(), value: row.value })),
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
        title={t(mode === 'add'
          ? 'settings.models.form.titleAddProvider'
          : 'settings.models.form.titleEditProvider')}
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

          <FormRow label={t('settings.models.form.baseUrl')} htmlFor={baseUrlId}>
            <Input
              id={baseUrlId}
              value={draft.baseUrl}
              placeholder={t('settings.models.form.baseUrlPlaceholder')}
              className="font-mono"
              onChange={(event) => update({ baseUrl: event.target.value })}
            />
          </FormRow>

          <FormRow
            label={t('settings.models.form.api')}
            htmlFor={apiId}
            hint={t('settings.models.form.apiHint')}
          >
            <Select
              value={draft.api || DEFAULT_API_VALUE}
              onValueChange={(value) => {
                const api = value === DEFAULT_API_VALUE ? '' : value
                update({
                  api,
                  ...(api === 'google-generative-ai' && draft.baseUrl.trim().length === 0
                    ? { baseUrl: GOOGLE_AI_STUDIO_BASE_URL }
                    : {}),
                })
              }}
            >
              <SelectTrigger id={apiId} className="w-full font-mono">
                <SelectValue placeholder={t('settings.models.form.apiPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_API_VALUE}>
                  {t('settings.models.form.apiProviderDefault')}
                </SelectItem>
                {API_TYPES.map((api) => (
                  <SelectItem key={api} value={api} className="font-mono">
                    {api}
                  </SelectItem>
                ))}
                {draft.api && !API_TYPES.includes(draft.api as (typeof API_TYPES)[number]) && (
                  <SelectItem value={draft.api} className="font-mono">
                    {t('settings.models.form.apiCustom', { api: draft.api })}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            {(draft.api === 'google-generative-ai' || draft.api === 'google-vertex') && (
              <p className="pt-1 text-micro text-muted-foreground">
                {t('settings.models.form.googleHint')}
              </p>
            )}
          </FormRow>

          <FormRow
            label={t('settings.models.form.apiKey')}
            htmlFor={apiKeyId}
            hint={t('settings.models.form.apiKeyHint')}
          >
            <Input
              id={apiKeyId}
              type="password"
              value={draft.apiKeyDraft}
              placeholder={t(mode === 'edit' && hasApiKey
                ? 'settings.models.form.apiKeyPlaceholderEdit'
                : 'settings.models.form.apiKeyPlaceholderAdd')}
              autoComplete="off"
              className="font-mono"
              onChange={(event) => update({ apiKeyDraft: event.target.value })}
            />
            {mode === 'edit' && hasApiKey ? (
              <div className="flex items-center gap-2 pt-1">
                <Checkbox
                  id={clearKeyId}
                  checked={draft.clearKey}
                  onCheckedChange={(checked) => update({ clearKey: checked === true })}
                />
                <label htmlFor={clearKeyId} className="text-caption text-muted-foreground">
                  {t('settings.models.form.clearKey')}
                </label>
              </div>
            ) : null}
          </FormRow>

          <FormRow
            label={t('settings.models.form.headers')}
            error={showError('headers') ? errors.headers : undefined}
          >
            <KeyValueRows
              rows={draft.headers}
              onChange={(rows) => {
                touch('headers')
                update({ headers: rows })
              }}
              addLabel={t('settings.models.form.rowsAdd')}
              removeLabel={t('settings.models.form.rowsRemove')}
              keyPlaceholder={t('settings.models.form.kvKey')}
              valuePlaceholder={t('settings.models.form.kvValue')}
            />
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
