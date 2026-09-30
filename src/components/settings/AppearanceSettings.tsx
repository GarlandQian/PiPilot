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
import { GLASS_TINT_MAX, GLASS_TINT_MIN } from '@/shared/settings'

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
      {/* System Settings › Appearance: thumbnails with an accent ring, label below. */}
      <div role="group" aria-label={t('settings.appearance.theme')} className="grid grid-cols-3 gap-5 py-4!">
        {(['system', 'light', 'dark'] as const).map((mode) => <button
          key={mode}
          type="button"
          aria-label={t(`settings.appearance.theme.${mode}`)}
          aria-pressed={appearance.theme === mode}
          onClick={() => updateAppearance({ theme: mode })}
          className="group/theme flex min-w-0 flex-col items-center gap-2 text-center outline-none"
        >
          <span className={cn('block w-full rounded-[10px] p-[3px] transition-shadow duration-(--duration-fast) group-focus-visible/theme:focus-ring', appearance.theme === mode ? 'shadow-[0_0_0_3px_var(--color-primary)]' : 'shadow-[0_0_0_0.5px_var(--color-border)] group-hover/theme:shadow-[0_0_0_3px_var(--color-fill-strong)]')}>
            <ThemePreview mode={mode} />
          </span>
          <span className={cn('flex items-center gap-1 text-caption', appearance.theme === mode ? 'font-semibold text-foreground' : 'text-foreground/80')}>
            {t(`settings.appearance.theme.${mode}`)}
            {appearance.theme === mode ? <TbCheck className="size-3.5 shrink-0 text-primary" aria-hidden /> : null}
          </span>
        </button>)}
      </div>
      {/* macOS 27 Liquid Glass: preview over a vivid backdrop, then the Clear ↔ Tinted slider. */}
      <div className="mac-group-raw px-3.5! py-3!" aria-hidden>
        <div className="relative h-20 overflow-hidden rounded-[10px] bg-[linear-gradient(115deg,#ff9f0a_0%,#ff375f_32%,#bf5af2_62%,#0a84ff_100%)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgb(255_255_255/0.55),transparent_45%),radial-gradient(circle_at_80%_80%,rgb(0_0_0/0.25),transparent_50%)]" />
          <div className="glass absolute top-1/2 left-1/2 flex h-9 -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-full px-4 text-caption font-semibold text-foreground">
            <span className="size-2 rounded-full bg-primary" />
            {t('settings.appearance.glass')}
            <span className="text-muted-foreground">{appearance.glassTint}%</span>
          </div>
        </div>
      </div>
      <SettingRow label={t('settings.appearance.glass')} desc={t('settings.appearance.glassDesc')}>
        <span className="text-caption text-muted-foreground">{t('settings.appearance.glassClear')}</span>
        <input type="range" min={GLASS_TINT_MIN} max={GLASS_TINT_MAX} step={5} value={appearance.glassTint}
          aria-label={t('settings.appearance.glass')} aria-valuetext={`${appearance.glassTint}%`}
          onChange={(event) => updateAppearance({ glassTint: Number(event.target.value) })}
          className="w-40 accent-[var(--color-sage)]" />
        <span className="text-caption text-muted-foreground">{t('settings.appearance.glassTinted')}</span>
      </SettingRow>
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
