import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { SettingSection } from './common'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { useSettings, useUpdateSettings } from '@/store/settings'

export function LanguageSettings() {
  const t = useT()
  const { locale } = useSettings()
  const { update } = useUpdateSettings()

  return (
    <SettingSection title={t('settings.language.title')} desc={t('settings.language.uiDesc')}>
        <RadioGroup
          value={locale}
          onValueChange={(value) => { if (value === 'system' || value === 'zh-CN' || value === 'en-US') update({ locale: value }) }}
          aria-label={t('settings.language.ui')}
          className="mac-group-raw gap-0 divide-y divide-border"
        >
          {(['system', 'zh-CN', 'en-US'] as const).map((value) => {
            const label = t(value === 'system' ? 'settings.language.system' : value === 'zh-CN' ? 'settings.language.zh' : 'settings.language.en')
            return <label key={value} className={cn('flex min-h-11 items-center gap-3 px-3.5 py-2.5 text-app', locale === value ? 'text-foreground' : 'text-foreground/80')}>
              <RadioGroupItem value={value} aria-label={label} />
              <span className="flex-1">{label}</span>
              {value !== 'system' ? <span className="text-caption text-muted-foreground">{value}</span> : null}
            </label>
          })}
        </RadioGroup>
      <p className="text-caption text-muted-foreground">{t('settings.language.note')}</p>
    </SettingSection>
  )
}
