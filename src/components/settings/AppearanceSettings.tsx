import * as React from 'react'
import { TbCheck, TbRefresh } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { SettingSection, SettingRow } from './common'
import { AppearanceFontField } from './AppearanceFontField'
import { AppearancePreview, ThemePreview } from './AppearancePreview'
import { type MessageKey, useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useSettings, useUpdateSettings } from '@/store/settings'
import { MONO_FONT_OPTIONS, UI_FONT_OPTIONS } from '@/types/settings'

export function AppearanceSettings() {
  const t = useT()
  const { appearance } = useSettings()
  const { updateAppearance, resetAppearance } = useUpdateSettings()
  const [confirmReset, setConfirmReset] = React.useState(false)
  const [fontRevision, setFontRevision] = React.useState(0)
  const fontOptions = (options: typeof UI_FONT_OPTIONS) => options.map((option) => ({
    value: option.value,
    label: option.labelKey.startsWith('settings.') ? t(option.labelKey as MessageKey) : option.labelKey,
  }))

  return <>
    <SettingSection title={t('settings.appearance.theme')}>
      <div role="group" aria-label={t('settings.appearance.theme')} className="grid grid-cols-3 gap-3">
        {(['system', 'light', 'dark'] as const).map((mode) => <button
          key={mode}
          type="button"
          aria-label={t(`settings.appearance.theme.${mode}`)}
          aria-pressed={appearance.theme === mode}
          onClick={() => updateAppearance({ theme: mode })}
          className={cn('min-w-0 rounded-md border p-2 text-left outline-none transition-colors focus-visible:focus-ring motion-reduce:transition-none', appearance.theme === mode ? 'border-ring bg-accent/40' : 'border-border hover:bg-accent/30')}
        >
          <ThemePreview mode={mode} />
          <span className="mt-2 flex min-h-5 items-center justify-between gap-1 text-caption">
            <span>{t(`settings.appearance.theme.${mode}`)}</span>
            <TbCheck className={cn('size-3.5 shrink-0 text-sage', appearance.theme !== mode && 'invisible')} aria-hidden />
          </span>
        </button>)}
      </div>
    </SettingSection>
    <SettingSection title={t('settings.redesign.typography')}>
      <AppearancePreview appearance={appearance} />
      <AppearanceFontField key={`ui-${fontRevision}`}
        label={t('settings.appearance.uiFont')} description={t('settings.appearance.uiFontDesc')}
        customLabel={t('settings.appearance.customUiFontName')} placeholder={t('settings.appearance.customUiPlaceholder')}
        value={appearance.uiFontFamily} options={fontOptions(UI_FONT_OPTIONS)} onChange={(uiFontFamily) => updateAppearance({ uiFontFamily })}
      />
      <AppearanceFontField key={`mono-${fontRevision}`}
        label={t('settings.appearance.monoFont')} description={t('settings.appearance.monoFontDesc')}
        customLabel={t('settings.appearance.customMonoFontName')} placeholder={t('settings.appearance.customMonoPlaceholder')}
        value={appearance.monoFontFamily} options={fontOptions(MONO_FONT_OPTIONS)} onChange={(monoFontFamily) => updateAppearance({ monoFontFamily })}
      />
      {([
        ['uiFontSize', 12, 18],
        ['codeFontSize', 11, 18],
      ] as const).map(([field, min, max]) => <SettingRow key={field} label={t(`settings.appearance.${field}`)} desc={t(`settings.appearance.${field}Desc`)}>
        <input type="range" min={min} max={max} step={1} value={appearance[field]} aria-label={t(`settings.appearance.${field}`)} onChange={(event) => updateAppearance({ [field]: Number(event.target.value) })} className="w-36 accent-[var(--color-sage)]" />
        <span className="w-12 text-right text-caption tabular-nums text-muted-foreground">{t('settings.appearance.fontSizePx', { size: appearance[field] })}</span>
      </SettingRow>)}
    </SettingSection>
    <SettingSection title={t('settings.redesign.reading')}>
      <SettingRow label={t('settings.appearance.density')} desc={t('settings.appearance.densityDesc')}>
        <RadioGroup value={appearance.density} onValueChange={(value) => { if (value === 'compact' || value === 'comfortable') updateAppearance({ density: value }) }} className="flex flex-wrap gap-4">
          {(['comfortable', 'compact'] as const).map((value) => <label key={value} className="flex cursor-pointer items-center gap-2 text-caption"><RadioGroupItem value={value} aria-label={t(`settings.appearance.density.${value}`)} />{t(`settings.appearance.density.${value}`)}</label>)}
        </RadioGroup>
      </SettingRow>
      {(['reducedMotion', 'codeLigatures', 'wordWrap', 'showLineNumbers', 'compactToolCards'] as const).map((field) => <SettingRow key={field} label={t(`settings.appearance.${field}`)} desc={t(`settings.appearance.${field}Desc`)}>
        <Switch checked={appearance[field]} onCheckedChange={(value) => updateAppearance({ [field]: value })} aria-label={t(`settings.appearance.${field}`)} />
      </SettingRow>)}
    </SettingSection>
    <SettingSection title={t('settings.appearance.reset')} desc={t('settings.appearance.resetDesc')}>
      <div><Button variant="outline" size="sm" onClick={() => setConfirmReset(true)}><TbRefresh aria-hidden />{t('settings.appearance.reset')}</Button></div>
    </SettingSection>
    <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t('settings.appearance.resetConfirm')}</AlertDialogTitle><AlertDialogDescription>{t('settings.appearance.resetDesc')}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('settings.appearance.resetConfirmNo')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => { resetAppearance(); setFontRevision((revision) => revision + 1) }}>{t('settings.appearance.resetConfirmYes')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}
