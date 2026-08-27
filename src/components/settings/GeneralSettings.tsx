import { TbRefresh } from 'react-icons/tb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { SettingRow, SettingSection } from './common'
import { useT } from '@/i18n'
import { SUPPORTED_PI_VERSION } from '@/shared/local-pi'
import { useSettings, useUpdateSettings } from '@/store/settings'
import type { ComposerSendShortcut } from '@/shared/settings'

interface GeneralSettingsProps {
  restartBusy: boolean
  restartMessage: string | null
  restartAvailable: boolean
  onRestart(): void
}

export function GeneralSettings({
  restartBusy,
  restartMessage,
  restartAvailable,
  onRestart,
}: GeneralSettingsProps) {
  const t = useT()
  const { composer } = useSettings()
  const { update } = useUpdateSettings()

  return (
    <>
      <SettingSection
        title={t('settings.general.localPi')}
        desc={t('settings.general.localPiDesc')}
      >
        <div className="flex items-center justify-between gap-3 px-2 py-1">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{t('settings.about.piRuntime')}</Badge>
              <span className="font-mono text-caption text-foreground">
                v{SUPPORTED_PI_VERSION}
              </span>
            </div>
            <p className="mt-2 break-all font-mono text-caption text-muted-foreground">
              {t('settings.about.piConfig')}
            </p>
            <p className="mt-1 text-micro text-muted-foreground">
              {t('settings.about.piHint')}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 px-2">
          <p className="text-micro text-muted-foreground">
            {t('settings.general.piRestartDesc')}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={restartBusy || !restartAvailable}
            onClick={onRestart}
          >
            <TbRefresh className={restartBusy ? 'animate-spin' : ''} aria-hidden />
            {restartBusy
              ? t('settings.general.piRestarting')
              : t('settings.general.piRestart')}
          </Button>
        </div>
        {restartMessage && (
          <p className="px-2 text-caption text-muted-foreground" role="status">
            {restartMessage}
          </p>
        )}
      </SettingSection>
      <SettingSection
        title={t('settings.general.composer')}
        desc={t('settings.general.composerDesc')}
      >
        <SettingRow
          label={t('settings.general.sendShortcut')}
          desc={t('settings.general.sendShortcutDesc')}
        >
          <RadioGroup
            value={composer.sendShortcut}
            onValueChange={(value) => update({
              composer: { sendShortcut: value as ComposerSendShortcut },
            })}
            className="flex flex-wrap justify-end gap-3"
          >
            <label className="flex cursor-pointer items-center gap-1.5 text-app">
              <RadioGroupItem
                value="enter"
                aria-label={t('settings.general.sendShortcut.enter')}
              />
              {t('settings.general.sendShortcut.enter')}
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-app">
              <RadioGroupItem
                value="mod-enter"
                aria-label={t('settings.general.sendShortcut.modEnter')}
              />
              {t('settings.general.sendShortcut.modEnter')}
            </label>
          </RadioGroup>
        </SettingRow>
      </SettingSection>
      <SettingSection
        title={t('settings.general.storage')}
        desc={t('settings.general.storageDesc')}
      >
        <p className="text-caption text-muted-foreground">
          {t('settings.general.localStorageNote')}
        </p>
      </SettingSection>
    </>
  )
}
