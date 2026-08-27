import * as React from 'react'
import { TbRefresh } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useT } from '@/i18n'
import {
  resolveTerminalFontStack,
  TERMINAL_FONT_OPTIONS,
} from '@/lib/terminal-fonts'
import {
  TERMINAL_FONT_FAMILY_LIMIT,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
} from '@/shared/settings'
import { useSettings, useUpdateSettings } from '@/store/settings'
import { SettingRow, SettingSection } from './common'

const RECOMMENDED_FONT = '__recommended__'
const CUSTOM_FONT = '__custom__'

export function TerminalSettings() {
  const t = useT()
  const { terminal } = useSettings()
  const { resetTerminal, updateTerminal } = useUpdateSettings()
  const [modeOverride, setModeOverride] = React.useState<typeof CUSTOM_FONT | null>(null)

  const knownFont = TERMINAL_FONT_OPTIONS.some((font) => font === terminal.fontFamily)
  const selectedFont = modeOverride ?? (
    terminal.fontFamily === ''
      ? RECOMMENDED_FONT
      : knownFont
        ? terminal.fontFamily
        : CUSTOM_FONT
  )
  const effectiveStack = resolveTerminalFontStack(terminal.fontFamily)

  return (
    <>
      <SettingSection
        title={t('settings.terminal.title')}
        desc={t('settings.terminal.description')}
      >
        <SettingRow
          label={t('settings.terminal.fontFamily')}
          desc={t('settings.terminal.fontFamilyDesc')}
        >
          <Select
            value={selectedFont}
            onValueChange={(value) => {
              if (value === CUSTOM_FONT) {
                setModeOverride(CUSTOM_FONT)
                return
              }
              setModeOverride(null)
              updateTerminal({
                fontFamily: value === RECOMMENDED_FONT ? '' : value,
              })
            }}
          >
            <SelectTrigger
              className="w-52"
              aria-label={t('settings.terminal.fontFamily')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={RECOMMENDED_FONT}>
                {t('settings.terminal.fontRecommended')}
              </SelectItem>
              {TERMINAL_FONT_OPTIONS.filter(Boolean).map((font) => (
                <SelectItem key={font} value={font}>{font}</SelectItem>
              ))}
              <SelectItem value={CUSTOM_FONT}>
                {t('settings.terminal.fontCustom')}
              </SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        {selectedFont === CUSTOM_FONT && (
          <SettingRow
            label={t('settings.terminal.customFont')}
            desc={t('settings.terminal.customFontDesc')}
          >
            <Input
              name="custom-terminal-font"
              autoComplete="off"
              aria-label={t('settings.terminal.customFont')}
              className="w-52"
              maxLength={TERMINAL_FONT_FAMILY_LIMIT}
              placeholder={t('settings.terminal.customFontPlaceholder')}
              value={terminal.fontFamily}
              onChange={(event) => updateTerminal({ fontFamily: event.target.value })}
            />
          </SettingRow>
        )}

        <SettingRow
          label={t('settings.terminal.fontSize')}
          desc={t('settings.terminal.fontSizeDesc')}
        >
          <input
            type="range"
            min={TERMINAL_FONT_SIZE_MIN}
            max={TERMINAL_FONT_SIZE_MAX}
            step={1}
            value={terminal.fontSize}
            aria-label={t('settings.terminal.fontSize')}
            onChange={(event) => updateTerminal({ fontSize: Number(event.target.value) })}
            className="w-36 accent-[var(--color-sage)]"
          />
          <span className="w-12 text-right text-caption tabular-nums text-muted-foreground">
            {t('settings.terminal.fontSizePx', { size: terminal.fontSize })}
          </span>
        </SettingRow>

        <SettingRow label={t('settings.terminal.preview')} className="items-start py-1.5">
          <div
            className="w-80 max-w-full overflow-hidden rounded-md border border-border bg-sidebar px-3 py-2"
            data-terminal-font-preview
            data-terminal-font-family={terminal.fontFamily || 'system'}
            data-terminal-effective-font-family={effectiveStack}
          >
            <p
              className="whitespace-nowrap text-foreground"
              style={{ fontFamily: effectiveStack, fontSize: terminal.fontSize }}
            >
              {t('settings.terminal.previewText')}
            </p>
            <code
              className="mt-1 block break-all text-micro leading-4 text-muted-foreground"
              title={effectiveStack}
            >
              {effectiveStack}
            </code>
          </div>
        </SettingRow>
      </SettingSection>

      <SettingSection
        title={t('settings.terminal.reset')}
        desc={t('settings.terminal.resetDesc')}
      >
        <div className="px-2 py-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setModeOverride(null)
              resetTerminal()
            }}
          >
            <TbRefresh aria-hidden />
            {t('settings.terminal.resetButton')}
          </Button>
        </div>
      </SettingSection>
    </>
  )
}
