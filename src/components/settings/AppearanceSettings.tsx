import * as React from 'react'
import { TbRefresh } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SettingSection, SettingRow } from './common'
import { useT } from '@/i18n'
import { useSettings, useUpdateSettings } from '@/store/settings'
import {
  MONO_FONT_OPTIONS,
  UI_FONT_OPTIONS,
  resolveMonoFontStack,
  resolveUiFontStack,
  type Density,
  type ThemeMode,
} from '@/types/settings'

const CUSTOM_FONT = '__custom__'

function fontOptionLabel(o: { value: string; labelKey: string }, t: (k: never) => string): string {
  return o.labelKey.startsWith('settings.') ? t(o.labelKey as never) : o.labelKey
}
import { cn } from '@/lib/utils'

function ThemePreview({ mode }: { mode: 'light' | 'dark' }) {
  return (
    <div
      aria-hidden
      className={cn(
        'h-12 w-20 overflow-hidden rounded-md border border-border bg-background p-1',
        mode === 'dark' ? 'dark' : 'light',
      )}
    >
      <div className="flex h-full gap-0.5">
        <div className="w-4 rounded-sm bg-sidebar" />
        <div className="flex-1 space-y-1 py-1">
          <div className="h-1.5 w-3/4 rounded-full bg-muted-foreground/30" />
          <div className="h-1.5 w-1/2 rounded-full bg-muted-foreground/20" />
          <div className="h-1.5 w-2/3 rounded-full bg-sage/40" />
        </div>
      </div>
    </div>
  )
}

export function AppearanceSettings() {
  const t = useT()
  const { appearance } = useSettings()
  const { updateAppearance, resetAppearance } = useUpdateSettings()
  const [confirmReset, setConfirmReset] = React.useState(false)

  const uiValue = UI_FONT_OPTIONS.some((o) => o.value === appearance.uiFontFamily)
    ? appearance.uiFontFamily === '' ? 'system' : appearance.uiFontFamily
    : CUSTOM_FONT
  const monoValue = MONO_FONT_OPTIONS.some((o) => o.value === appearance.monoFontFamily)
    ? appearance.monoFontFamily === '' ? 'system' : appearance.monoFontFamily
    : CUSTOM_FONT

  return (
    <>
      <SettingSection title={t('settings.appearance.title')}>
        <div role="group" aria-label={t('settings.appearance.theme')} className="flex gap-3 px-2 py-1">
          {(['system', 'light', 'dark'] as ThemeMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-label={t(`settings.appearance.theme.${mode}`)}
              aria-pressed={appearance.theme === mode}
              onClick={() => updateAppearance({ theme: mode })}
              className={cn(
                'flex cursor-pointer flex-col items-center gap-1.5 rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              {mode === 'system' ? (
                <div className="flex">
                  <ThemePreview mode="light" />
                  <span className="sr-only">{t('settings.appearance.theme.system')}</span>
                </div>
              ) : (
                <ThemePreview mode={mode} />
              )}
              <span
                className={cn(
                  'text-caption',
                  appearance.theme === mode ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                {mode === 'system'
                  ? t('settings.appearance.theme.system')
                  : mode === 'light'
                    ? t('settings.appearance.theme.light')
                    : t('settings.appearance.theme.dark')}
              </span>
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  appearance.theme === mode ? 'bg-sage' : 'bg-transparent',
                )}
                aria-hidden
              />
            </button>
          ))}
        </div>

        <SettingRow label={t('settings.appearance.uiFont')} desc={t('settings.appearance.uiFontDesc')}>
          <Select
            value={uiValue}
            onValueChange={(v) =>
              updateAppearance({ uiFontFamily: v === CUSTOM_FONT || v === 'system' ? (v === 'system' ? '' : appearance.uiFontFamily) : v })
            }
          >
            <SelectTrigger className="w-44" aria-label={t('settings.appearance.uiFont')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UI_FONT_OPTIONS.map((o) => (
                <SelectItem key={o.value === '' ? 'system' : o.value} value={o.value === '' ? 'system' : o.value}>
                  {fontOptionLabel(o, t)}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM_FONT}>{t('settings.appearance.font.custom')}</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        {uiValue === CUSTOM_FONT && (
          <SettingRow label={t('settings.appearance.customUiFontName')}>
            <Input
              name="custom-ui-font"
              autoComplete="off"
              aria-label={t('settings.appearance.customUiFontName')}
              className="w-44"
              placeholder={t('settings.appearance.customUiPlaceholder')}
              value={appearance.uiFontFamily}
              onChange={(e) => updateAppearance({ uiFontFamily: e.target.value })}
            />
          </SettingRow>
        )}
        <SettingRow label={t('settings.appearance.preview')}>
          <p
            className="w-56 truncate rounded-md border border-border bg-muted/40 px-2 py-1 text-caption text-muted-foreground"
            style={{ fontFamily: resolveUiFontStack(appearance.uiFontFamily) }}
          >
            {t('settings.appearance.previewText')}
          </p>
        </SettingRow>

        <SettingRow label={t('settings.appearance.monoFont')} desc={t('settings.appearance.monoFontDesc')}>
          <Select
            value={monoValue}
            onValueChange={(v) =>
              updateAppearance({ monoFontFamily: v === CUSTOM_FONT || v === 'system' ? (v === 'system' ? '' : appearance.monoFontFamily) : v })
            }
          >
            <SelectTrigger className="w-44" aria-label={t('settings.appearance.monoFont')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONO_FONT_OPTIONS.map((o) => (
                <SelectItem key={o.value === '' ? 'system' : o.value} value={o.value === '' ? 'system' : o.value}>
                  {fontOptionLabel(o, t)}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM_FONT}>{t('settings.appearance.font.custom')}</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        {monoValue === CUSTOM_FONT && (
          <SettingRow label={t('settings.appearance.customMonoFontName')}>
            <Input
              name="custom-mono-font"
              autoComplete="off"
              aria-label={t('settings.appearance.customMonoFontName')}
              className="w-44"
              placeholder={t('settings.appearance.customMonoPlaceholder')}
              value={appearance.monoFontFamily}
              onChange={(e) => updateAppearance({ monoFontFamily: e.target.value })}
            />
          </SettingRow>
        )}
        <SettingRow label={t('settings.appearance.preview')}>
          <p
            className="w-56 truncate rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-caption text-muted-foreground"
            style={{ fontFamily: resolveMonoFontStack(appearance.monoFontFamily) }}
          >
            {t('settings.appearance.previewMonoText')}
          </p>
        </SettingRow>

        <SettingRow label={t('settings.appearance.uiFontSize')} desc={t('settings.appearance.uiFontSizeDesc')}>
          <input
            type="range"
            min={12}
            max={18}
            step={1}
            value={appearance.uiFontSize}
            aria-label={t('settings.appearance.uiFontSize')}
            onChange={(e) => updateAppearance({ uiFontSize: Number(e.target.value) })}
            className="w-36 accent-[var(--color-sage)]"
          />
          <span className="w-12 text-right text-caption tabular-nums text-muted-foreground">
            {t('settings.appearance.fontSizePx', { size: appearance.uiFontSize })}
          </span>
        </SettingRow>
        <SettingRow label={t('settings.appearance.codeFontSize')} desc={t('settings.appearance.codeFontSizeDesc')}>
          <input
            type="range"
            min={11}
            max={18}
            step={1}
            value={appearance.codeFontSize}
            aria-label={t('settings.appearance.codeFontSize')}
            onChange={(e) => updateAppearance({ codeFontSize: Number(e.target.value) })}
            className="w-36 accent-[var(--color-sage)]"
          />
          <span className="w-12 text-right text-caption tabular-nums text-muted-foreground">
            {t('settings.appearance.fontSizePx', { size: appearance.codeFontSize })}
          </span>
        </SettingRow>

        <SettingRow label={t('settings.appearance.density')} desc={t('settings.appearance.densityDesc')}>
          <RadioGroup
            value={appearance.density}
            onValueChange={(v) => updateAppearance({ density: v as Density })}
            className="flex gap-3"
          >
            <label className="flex cursor-pointer items-center gap-1.5 text-caption">
              <RadioGroupItem value="compact" aria-label={t('settings.appearance.density.compact')} />
              {t('settings.appearance.density.compact')}
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-caption">
              <RadioGroupItem value="comfortable" aria-label={t('settings.appearance.density.comfortable')} />
              {t('settings.appearance.density.comfortable')}
            </label>
          </RadioGroup>
        </SettingRow>
      </SettingSection>

      <SettingSection title={t('settings.appearance.codeSection')}>
        <SettingRow label={t('settings.appearance.reducedMotion')} desc={t('settings.appearance.reducedMotionDesc')}>
          <Switch
            checked={appearance.reducedMotion}
            onCheckedChange={(v) => updateAppearance({ reducedMotion: v })}
            aria-label={t('settings.appearance.reducedMotion')}
          />
        </SettingRow>
        <SettingRow label={t('settings.appearance.codeLigatures')} desc={t('settings.appearance.codeLigaturesDesc')}>
          <Switch
            checked={appearance.codeLigatures}
            onCheckedChange={(v) => updateAppearance({ codeLigatures: v })}
            aria-label={t('settings.appearance.codeLigatures')}
          />
        </SettingRow>
        <SettingRow label={t('settings.appearance.wordWrap')} desc={t('settings.appearance.wordWrapDesc')}>
          <Switch
            checked={appearance.wordWrap}
            onCheckedChange={(v) => updateAppearance({ wordWrap: v })}
            aria-label={t('settings.appearance.wordWrap')}
          />
        </SettingRow>
        <SettingRow label={t('settings.appearance.showLineNumbers')} desc={t('settings.appearance.showLineNumbersDesc')}>
          <Switch
            checked={appearance.showLineNumbers}
            onCheckedChange={(v) => updateAppearance({ showLineNumbers: v })}
            aria-label={t('settings.appearance.showLineNumbers')}
          />
        </SettingRow>
        <SettingRow label={t('settings.appearance.compactToolCards')} desc={t('settings.appearance.compactToolCardsDesc')}>
          <Switch
            checked={appearance.compactToolCards}
            onCheckedChange={(v) => updateAppearance({ compactToolCards: v })}
            aria-label={t('settings.appearance.compactToolCards')}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title={t('settings.appearance.reset')} desc={t('settings.appearance.resetDesc')}>
        <div className="flex items-center gap-3 px-2 py-1">
          <Button variant="outline" size="sm" onClick={() => setConfirmReset(true)}>
            <TbRefresh aria-hidden />
            {t('settings.appearance.reset')}
          </Button>
          {confirmReset && (
            <span className="flex items-center gap-2 text-caption text-muted-foreground" role="alert">
              {t('settings.appearance.resetConfirm')}
              <Button
                variant="accent"
                size="xs"
                onClick={() => {
                  resetAppearance()
                  setConfirmReset(false)
                }}
              >
                {t('settings.appearance.resetConfirmYes')}
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setConfirmReset(false)}>
                {t('settings.appearance.resetConfirmNo')}
              </Button>
            </span>
          )}
        </div>
      </SettingSection>
    </>
  )
}
