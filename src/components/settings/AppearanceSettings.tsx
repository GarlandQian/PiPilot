import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { type MessageKey, useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { useSettings, useUpdateSettings } from '@/store/settings'
import { MONO_FONT_OPTIONS, UI_FONT_OPTIONS, type ThemeMode } from '@/types/settings'
import { GLASS_TINT_MAX, GLASS_TINT_MIN } from '@/shared/settings'
import { SettingsGroup, SettingsPage, SettingsRow } from './kit'

const CUSTOM_FONT = '__custom__'

/** A tiny window in the given theme; "system" shows light and dark side by side. */
function ThemeThumbnail({ mode }: { mode: ThemeMode }) {
  const panels = mode === 'system' ? ['light', 'dark'] : [mode]
  return <span className="flex h-[44px] w-[66px] overflow-hidden rounded-[6px]" aria-hidden>
    {panels.map((theme) => <span key={theme} className={cn(theme, 'flex min-w-0 flex-1 gap-1 bg-background p-1')}>
      {mode !== 'system' || theme === 'light' ? <span className="w-1/4 shrink-0 rounded-[2px] bg-sidebar" /> : null}
      <span className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <span className="ml-auto h-1.5 w-3/5 rounded-[2px] bg-selected" />
        <span className="space-y-0.5"><span className="block h-0.5 w-4/5 rounded-full bg-muted-foreground/40" /><span className="block h-0.5 w-3/5 rounded-full bg-muted-foreground/25" /></span>
        <span className="h-1.5 rounded-[2px] border-[0.5px] border-border bg-composer" />
      </span>
    </span>)}
  </span>
}

/** A font picker row; "Custom…" adds a row for typing any installed font's name. */
function FontRows({ label, info, customLabel, placeholder, value, options, onChange }: {
  label: string
  info: string
  customLabel: string
  placeholder: string
  value: string
  options: readonly { value: string; label: string }[]
  onChange(value: string): void
}) {
  const t = useT()
  const [customMode, setCustomMode] = React.useState(false)
  const isPreset = options.some((option) => option.value === value)
  const selectedValue = customMode || !isPreset ? CUSTOM_FONT : value || 'system'
  return <>
    <SettingsRow label={label} info={info}>
      <Select value={selectedValue} onValueChange={(next) => {
        setCustomMode(next === CUSTOM_FONT)
        if (next !== CUSTOM_FONT) onChange(next === 'system' ? '' : next)
      }}>
        <SelectTrigger className="w-[248px] max-w-full" aria-label={label}><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.value || 'system'} value={option.value || 'system'}>{option.label}</SelectItem>)}
          <SelectItem value={CUSTOM_FONT}>{t('settings.appearance.font.custom')}</SelectItem>
        </SelectContent>
      </Select>
    </SettingsRow>
    {selectedValue === CUSTOM_FONT ? <SettingsRow label={customLabel}>
      <Input autoComplete="off" aria-label={customLabel} className="w-52 max-w-full" maxLength={120} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
    </SettingsRow> : null}
  </>
}

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

  return <SettingsPage data-appearance-settings>
    <SettingsGroup>
      {/* System Settings › Appearance: small window thumbnails, the chosen one ringed in the accent color. */}
      <SettingsRow label={t('settings.appearance.theme')} labelId="appearance-theme-label">
        <div role="radiogroup" aria-labelledby="appearance-theme-label" className="flex items-start gap-3 py-1" data-appearance-theme>
          {(['system', 'light', 'dark'] as const).map((mode) => {
            const selected = appearance.theme === mode
            return <button key={mode} type="button" role="radio" aria-checked={selected} aria-label={t(`settings.appearance.theme.${mode}`)}
              onClick={() => updateAppearance({ theme: mode })} className="group/theme flex w-[86px] min-w-0 flex-col items-center gap-1 text-center outline-none">
              <span className={cn('block rounded-[8px] p-[2px] transition-shadow duration-(--duration-fast) group-focus-visible/theme:focus-ring',
                selected ? 'shadow-[0_0_0_2.5px_var(--color-primary)]' : 'shadow-[0_0_0_0.5px_var(--color-border)] group-hover/theme:shadow-[0_0_0_2.5px_var(--color-fill-strong)]')}>
                <ThemeThumbnail mode={mode} />
              </span>
              <span className={cn('max-w-full text-caption leading-tight', selected ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{t(`settings.appearance.theme.${mode}`)}</span>
            </button>
          })}
        </div>
      </SettingsRow>
      <SettingsRow label={t('settings.appearance.glass')} info={t('settings.appearance.glassDesc')} htmlFor="appearance-glass">
        <span className="text-caption text-muted-foreground">{t('settings.appearance.glassClear')}</span>
        <input id="appearance-glass" type="range" min={GLASS_TINT_MIN} max={GLASS_TINT_MAX} step={5} value={appearance.glassTint}
          aria-label={t('settings.appearance.glass')} aria-valuetext={`${appearance.glassTint}%`}
          onChange={(event) => updateAppearance({ glassTint: Number(event.target.value) })}
          className="w-36 accent-[var(--color-primary)]" />
        <span className="text-caption text-muted-foreground">{t('settings.appearance.glassTinted')}</span>
      </SettingsRow>
    </SettingsGroup>

    <SettingsGroup title={t('settings.redesign.typography')}>
      <FontRows key={`ui-${fontRevision}`}
        label={t('settings.appearance.uiFont')} info={t('settings.appearance.uiFontDesc')}
        customLabel={t('settings.appearance.customUiFontName')} placeholder={t('settings.appearance.customUiPlaceholder')}
        value={appearance.uiFontFamily} options={fontOptions(UI_FONT_OPTIONS)} onChange={(uiFontFamily) => updateAppearance({ uiFontFamily })} />
      <FontRows key={`mono-${fontRevision}`}
        label={t('settings.appearance.monoFont')} info={t('settings.appearance.monoFontDesc')}
        customLabel={t('settings.appearance.customMonoFontName')} placeholder={t('settings.appearance.customMonoPlaceholder')}
        value={appearance.monoFontFamily} options={fontOptions(MONO_FONT_OPTIONS)} onChange={(monoFontFamily) => updateAppearance({ monoFontFamily })} />
      {([
        ['uiFontSize', 12, 18],
        ['codeFontSize', 11, 18],
      ] as const).map(([field, min, max]) => <SettingsRow key={field} label={t(`settings.appearance.${field}`)} info={t(`settings.appearance.${field}Desc`)} htmlFor={`appearance-${field}`}>
        <input id={`appearance-${field}`} type="range" min={min} max={max} step={1} value={appearance[field]} aria-label={t(`settings.appearance.${field}`)}
          onChange={(event) => updateAppearance({ [field]: Number(event.target.value) })} className="w-36 accent-[var(--color-primary)]" />
        <span className="w-11 text-right text-caption tabular-nums text-muted-foreground">{t('settings.appearance.fontSizePx', { size: appearance[field] })}</span>
      </SettingsRow>)}
    </SettingsGroup>

    <SettingsGroup title={t('settings.redesign.reading')}>
      <SettingsRow label={t('settings.appearance.density')} info={t('settings.appearance.densityDesc')} htmlFor="appearance-density">
        <select id="appearance-density" className="mac-select" value={appearance.density} onChange={(event) => {
          const value = event.target.value
          if (value === 'compact' || value === 'comfortable') updateAppearance({ density: value })
        }}>
          {(['comfortable', 'compact'] as const).map((value) => <option key={value} value={value}>{t(`settings.appearance.density.${value}`)}</option>)}
        </select>
      </SettingsRow>
      {(['reducedMotion', 'codeLigatures', 'wordWrap', 'showLineNumbers', 'compactToolCards'] as const).map((field) => <SettingsRow key={field}
        label={t(`settings.appearance.${field}`)} info={t(`settings.appearance.${field}Desc`)} htmlFor={`appearance-${field}`}>
        <Switch id={`appearance-${field}`} checked={appearance[field]} onCheckedChange={(value) => updateAppearance({ [field]: value })} />
      </SettingsRow>)}
    </SettingsGroup>

    <SettingsGroup>
      <SettingsRow label={t('settings.appearance.reset')} info={t('settings.appearance.resetDesc')}>
        <Button variant="outline" size="sm" onClick={() => setConfirmReset(true)}>{t('settings.appearance.reset.button')}</Button>
      </SettingsRow>
    </SettingsGroup>

    <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t('settings.appearance.resetConfirm')}</AlertDialogTitle><AlertDialogDescription>{t('settings.appearance.resetDesc')}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('settings.appearance.resetConfirmNo')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => { resetAppearance(); setFontRevision((revision) => revision + 1) }}>{t('settings.appearance.resetConfirmYes')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </SettingsPage>
}
