import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useT } from '@/i18n'
import { resolveTerminalFontStack, TERMINAL_FONT_OPTIONS } from '@/lib/terminal-fonts'
import { TERMINAL_FONT_FAMILY_LIMIT, TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN } from '@/shared/settings'
import { useSettings, useUpdateSettings } from '@/store/settings'
import { SettingsGroup, SettingsPage, SettingsRow } from './kit'
import { TerminalProfilesSettings } from './TerminalProfilesSettings'
import { ExternalTerminalSettings } from './ExternalTerminalSettings'

const RECOMMENDED_FONT = '__recommended__'
const CUSTOM_FONT = '__custom__'

export function TerminalSettings() {
  const t = useT()
  const { terminal } = useSettings()
  const { resetTerminal, updateTerminal } = useUpdateSettings()
  const [modeOverride, setModeOverride] = React.useState<typeof CUSTOM_FONT | null>(null)
  const [confirmReset, setConfirmReset] = React.useState(false)

  const knownFont = TERMINAL_FONT_OPTIONS.some((font) => font === terminal.fontFamily)
  const selectedFont = modeOverride ?? (terminal.fontFamily === '' ? RECOMMENDED_FONT : knownFont ? terminal.fontFamily : CUSTOM_FONT)
  const effectiveStack = resolveTerminalFontStack(terminal.fontFamily)

  return <SettingsPage data-terminal-settings>
    {/* Codex: terminals open under the conversation or as side panel tabs. */}
    <SettingsGroup>
      <SettingsRow label={t('settings.terminal.location')} info={t('settings.terminal.locationDesc')} htmlFor="terminal-location">
        <select id="terminal-location" className="mac-select" value={terminal.location}
          onChange={(event) => updateTerminal({ location: event.target.value === 'panel' ? 'panel' : 'bottom' })}>
          <option value="bottom">{t('settings.terminal.location.bottom')}</option>
          <option value="panel">{t('settings.terminal.location.panel')}</option>
        </select>
      </SettingsRow>
    </SettingsGroup>

    <SettingsGroup title={t('settings.terminal.title')} info={t('settings.terminal.description')}>
      <SettingsRow label={t('settings.terminal.fontFamily')} info={t('settings.terminal.fontFamilyDesc')}>
        <Select value={selectedFont} onValueChange={(value) => {
          if (value === CUSTOM_FONT) {
            setModeOverride(CUSTOM_FONT)
            return
          }
          setModeOverride(null)
          updateTerminal({ fontFamily: value === RECOMMENDED_FONT ? '' : value })
        }}>
          <SelectTrigger className="w-60 max-w-full" aria-label={t('settings.terminal.fontFamily')}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={RECOMMENDED_FONT}>{t('settings.terminal.fontRecommended')}</SelectItem>
            {TERMINAL_FONT_OPTIONS.filter(Boolean).map((font) => <SelectItem key={font} value={font}>{font}</SelectItem>)}
            <SelectItem value={CUSTOM_FONT}>{t('settings.terminal.fontCustom')}</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
      {selectedFont === CUSTOM_FONT ? <SettingsRow label={t('settings.terminal.customFont')} info={t('settings.terminal.customFontDesc')}>
        <Input name="custom-terminal-font" autoComplete="off" aria-label={t('settings.terminal.customFont')} className="w-52 max-w-full" maxLength={TERMINAL_FONT_FAMILY_LIMIT}
          placeholder={t('settings.terminal.customFontPlaceholder')} value={terminal.fontFamily} onChange={(event) => updateTerminal({ fontFamily: event.target.value })} />
      </SettingsRow> : null}
      <SettingsRow label={t('settings.terminal.fontSize')} info={t('settings.terminal.fontSizeDesc')} htmlFor="terminal-font-size">
        <input id="terminal-font-size" type="range" min={TERMINAL_FONT_SIZE_MIN} max={TERMINAL_FONT_SIZE_MAX} step={1} value={terminal.fontSize}
          aria-label={t('settings.terminal.fontSize')} onChange={(event) => updateTerminal({ fontSize: Number(event.target.value) })} className="w-36 accent-[var(--color-primary)]" />
        <span className="w-11 text-right text-caption tabular-nums text-muted-foreground">{t('settings.terminal.fontSizePx', { size: terminal.fontSize })}</span>
      </SettingsRow>
      {/* One line in the chosen font, and the stack it resolves to. */}
      <figure data-settings-row className="min-w-0 px-3 py-2.5" aria-label={t('settings.terminal.preview')}
        data-terminal-font-preview data-terminal-font-family={terminal.fontFamily || 'system'} data-terminal-effective-font-family={effectiveStack}>
        <div className="min-w-0 overflow-x-auto rounded-[8px] bg-surface-inset px-3 py-2 shadow-[inset_0_0_0_0.5px_var(--color-border)] dark:bg-black/25"
          style={{ fontFamily: effectiveStack, fontSize: terminal.fontSize }}>
          <p className="whitespace-nowrap text-foreground"><span className="text-success" aria-hidden>$ </span>{t('settings.terminal.previewText')}</p>
        </div>
        <figcaption className="mt-1.5 truncate font-mono text-micro text-muted-foreground" title={effectiveStack}>{t('settings.redesign.effectiveFonts')}: {effectiveStack}</figcaption>
      </figure>
      <SettingsRow label={t('settings.terminal.reset')} info={t('settings.terminal.resetDesc')}>
        <Button variant="outline" size="sm" onClick={() => setConfirmReset(true)}>{t('settings.terminal.resetButton')}</Button>
      </SettingsRow>
    </SettingsGroup>

    <TerminalProfilesSettings />
    <ExternalTerminalSettings />

    <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t('settings.terminal.reset')}</AlertDialogTitle><AlertDialogDescription>{t('settings.terminal.resetDesc')}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{t('settings.appearance.resetConfirmNo')}</AlertDialogCancel><AlertDialogAction onClick={() => { setModeOverride(null); resetTerminal() }}>{t('settings.appearance.resetConfirmYes')}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </SettingsPage>
}
