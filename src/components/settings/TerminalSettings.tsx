import * as React from 'react'
import { TbRefresh, TbTerminal2 } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
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
import { TerminalProfilesSettings } from './TerminalProfilesSettings'

const RECOMMENDED_FONT = '__recommended__'
const CUSTOM_FONT = '__custom__'

export function TerminalSettings() {
  const t = useT()
  const { terminal } = useSettings()
  const { resetTerminal, updateTerminal } = useUpdateSettings()
  const [modeOverride, setModeOverride] = React.useState<typeof CUSTOM_FONT | null>(null)
  const [confirmReset, setConfirmReset] = React.useState(false)

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
      {/* Codex: terminals open under the conversation or as side panel tabs. */}
      <SettingSection title={t('settings.terminal.location')} desc={t('settings.terminal.locationDesc')}>
        <SettingRow label={t('settings.terminal.location')}>
          <select aria-label={t('settings.terminal.location')} className="mac-select w-full sm:w-56" value={terminal.location}
            onChange={(event) => updateTerminal({ location: event.target.value === 'panel' ? 'panel' : 'bottom' })}>
            <option value="bottom">{t('settings.terminal.location.bottom')}</option>
            <option value="panel">{t('settings.terminal.location.panel')}</option>
          </select>
        </SettingRow>
      </SettingSection>
      <TerminalProfilesSettings />
      <SettingSection
        title={t('settings.terminal.title')}
        desc={t('settings.terminal.description')}
      >
        {/* Terminal.app-style preview window */}
        <figure className="mac-group-raw min-w-0 p-3.5!" data-terminal-font-preview data-terminal-font-family={terminal.fontFamily || 'system'} data-terminal-effective-font-family={effectiveStack}>
          <div className="overflow-hidden rounded-[10px] bg-sidebar shadow-[0_0_0_0.5px_var(--color-border),0_4px_14px_-4px_rgb(0_0_0/0.18)]">
          <figcaption className="relative flex h-7 items-center justify-center border-b border-border/70 text-micro font-medium text-muted-foreground">
            <span className="absolute left-2.5 hidden gap-1.5 mac:flex" aria-hidden><span className="size-2.5 rounded-full bg-[#ff5f57]" /><span className="size-2.5 rounded-full bg-[#febc2e]" /><span className="size-2.5 rounded-full bg-[#28c840]" /></span>
            <span className="flex items-center gap-1.5"><TbTerminal2 className="size-3.5" aria-hidden />{t('settings.terminal.preview')}</span>
          </figcaption>
          <div className="px-4 py-4" style={{ fontFamily: effectiveStack, fontSize: terminal.fontSize }}>
            <p className="break-words leading-relaxed text-foreground">{t('settings.terminal.previewText')}</p>
            <p className="mt-2 flex items-center gap-2 text-success" aria-hidden><span>$</span><span className="h-4 w-2 bg-foreground/60" /></p>
          </div>
          </div>
        </figure>
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

        <details className="text-caption text-muted-foreground"><summary className="w-fit rounded-sm text-primary focus-visible:focus-ring">{t('settings.redesign.effectiveFonts')}</summary><code className="mt-3 block break-words text-micro leading-relaxed">{effectiveStack}</code></details>
      </SettingSection>

      <SettingSection
        title={t('settings.terminal.reset')}
        desc={t('settings.terminal.resetDesc')}
      >
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmReset(true)}
          >
            <TbRefresh aria-hidden />
            {t('settings.terminal.resetButton')}
          </Button>
        </div>
      </SettingSection>
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t('settings.terminal.reset')}</AlertDialogTitle><AlertDialogDescription>{t('settings.terminal.resetDesc')}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{t('settings.appearance.resetConfirmNo')}</AlertDialogCancel><AlertDialogAction onClick={() => { setModeOverride(null); resetTerminal() }}>{t('settings.appearance.resetConfirmYes')}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
