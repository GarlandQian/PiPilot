import type * as React from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useT, type MessageKey } from '@/i18n'

/** The protocols Pi speaks, most common first. */
export const MODELS_API_TYPES = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
  'openai-codex-responses',
  'google-vertex',
  'azure-openai-responses',
  'mistral-conversations',
  'bedrock-converse-stream',
] as const

const NAMED_API_TYPES = new Set<string>(['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'])
const PROVIDER_DEFAULT_API = '__provider_default__'

/** The API type picker: a readable name, with the protocol ID beside it. */
export function ModelsApiTypeSelect({ id, value, onChange, allowProviderDefault = false, describedBy }: {
  id: string
  value: string
  onChange(value: string): void
  /** Editing a provider can leave the type to Pi's built-in provider. */
  allowProviderDefault?: boolean
  describedBy?: string
}) {
  const t = useT()
  const label = (api: string) => NAMED_API_TYPES.has(api) ? t(`settings.models.quickAdd.api.${api}` as MessageKey) : api
  const option = (api: string, text: React.ReactNode) => <SelectItem key={api} value={api}>
    <span className="flex min-w-0 items-baseline gap-2"><span className="truncate">{text}</span>
      {NAMED_API_TYPES.has(api) ? <span className="shrink-0 font-mono text-micro text-muted-foreground">{api}</span> : null}</span>
  </SelectItem>
  return <Select value={value || (allowProviderDefault ? PROVIDER_DEFAULT_API : MODELS_API_TYPES[0])}
    onValueChange={(next) => onChange(next === PROVIDER_DEFAULT_API ? '' : next)}>
    <SelectTrigger id={id} aria-describedby={describedBy} className="w-full">
      <SelectValue placeholder={t('settings.models.form.apiPlaceholder')} />
    </SelectTrigger>
    <SelectContent>
      {allowProviderDefault ? <SelectItem value={PROVIDER_DEFAULT_API}>{t('settings.models.form.apiProviderDefault')}</SelectItem> : null}
      {MODELS_API_TYPES.map((api) => option(api, label(api)))}
      {value && !(MODELS_API_TYPES as readonly string[]).includes(value) ? option(value, t('settings.models.form.apiCustom', { api: value })) : null}
    </SelectContent>
  </Select>
}
