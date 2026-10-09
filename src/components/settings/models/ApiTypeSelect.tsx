import type * as React from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useT, type MessageKey } from '@/i18n'
import { CUSTOM_ENDPOINT_API_TYPES, customEndpointApiOptions } from './provider-api-profiles'

const NAMED_API_TYPES = new Set<string>([...CUSTOM_ENDPOINT_API_TYPES, 'openai-codex-responses'])
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
  return <Select value={value || (allowProviderDefault ? PROVIDER_DEFAULT_API : CUSTOM_ENDPOINT_API_TYPES[0])}
    onValueChange={(next) => onChange(next === PROVIDER_DEFAULT_API ? '' : next)}>
    <SelectTrigger id={id} aria-describedby={describedBy} className="w-full">
      <SelectValue placeholder={t('settings.models.form.apiPlaceholder')} />
    </SelectTrigger>
    <SelectContent>
      {allowProviderDefault ? <SelectItem value={PROVIDER_DEFAULT_API}>{t('settings.models.form.apiProviderDefault')}</SelectItem> : null}
      {customEndpointApiOptions(value).map((api) => option(api, NAMED_API_TYPES.has(api) ? label(api) : t('settings.models.form.apiCustom', { api })))}
    </SelectContent>
  </Select>
}
