import { TbArrowsExchange } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useLocale, useT } from '@/i18n'
import { localizedText, type ProviderPreset, type ProviderPresetVersion } from '@/shared/model-provider-presets'
import { ProviderIcon } from './ProviderIcon'

/** Which preset this provider comes from; while adding, its version can change, or the preset itself. */
export function PresetBar({ preset, version, name, icon, onVersion, onChange, children }: {
  preset?: ProviderPreset | null
  version?: ProviderPresetVersion | null
  /** Shown without a preset (a provider added by hand). */
  name: string
  icon?: string
  onVersion?(key: string): void
  onChange?(): void
  children?: import('react').ReactNode
}) {
  const t = useT()
  const locale = useLocale()
  const title = preset ? localizedText(preset.name, locale) : name
  return <div className="mac-box flex min-w-0 flex-wrap items-center gap-3 px-4 py-3" data-models-preset-bar>
    <ProviderIcon icon={icon ?? preset?.icon} name={title} size="lg" />
    <div className="min-w-0 flex-1">
      <p className="break-words text-title">{title}</p>
      {preset && version && preset.versions.length > 1 && onVersion ? <Select value={version.key} onValueChange={onVersion}>
        <SelectTrigger size="sm" className="mt-1 h-6 w-auto max-w-full" aria-label={t('settings.models.editor.version')}><SelectValue /></SelectTrigger>
        <SelectContent>{preset.versions.map((candidate) => <SelectItem key={candidate.key} value={candidate.key}>{localizedText(candidate.label, locale)}</SelectItem>)}</SelectContent>
      </Select> : version ? <p className="mt-0.5 text-caption text-muted-foreground">{localizedText(version.label, locale)}</p> : null}
      {children}
    </div>
    {onChange ? <Button variant="outline" size="sm" onClick={onChange}><TbArrowsExchange aria-hidden />{t('settings.models.editor.changePreset')}</Button> : null}
  </div>
}
