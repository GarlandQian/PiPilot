import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { SettingSection, SettingRow } from './common'
import { useT } from '@/i18n'
import { useSettings, useUpdateSettings } from '@/store/settings'
import type { Locale } from '@/types/settings'

export function LanguageSettings() {
  const t = useT()
  const { locale } = useSettings()
  const { update } = useUpdateSettings()

  return (
    <SettingSection title={t('settings.language.title')} desc={t('settings.language.uiDesc')}>
      <SettingRow label={t('settings.language.ui')}>
        <RadioGroup
          value={locale}
          onValueChange={(v) => update({ locale: v as Locale })}
          className="flex gap-4"
        >
          <label className="flex cursor-pointer items-center gap-1.5 text-app">
            <RadioGroupItem value="system" aria-label={t('settings.language.system')} />
            {t('settings.language.system')}
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-app">
            <RadioGroupItem value="zh-CN" aria-label={t('settings.language.zh')} />
            {t('settings.language.zh')}
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-app">
            <RadioGroupItem value="en-US" aria-label={t('settings.language.en')} />
            {t('settings.language.en')}
          </label>
        </RadioGroup>
      </SettingRow>
      <p className="px-2 pt-2 text-caption text-muted-foreground">{t('settings.language.note')}</p>
    </SettingSection>
  )
}
