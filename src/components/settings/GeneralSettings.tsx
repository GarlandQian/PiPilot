import * as React from 'react'
import { TbCpu, TbRefresh } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { SettingRow, SettingSection } from './common'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { SUPPORTED_PI_VERSION, type LocalPiRuntimeSnapshot } from '@/shared/local-pi'
import { useSettings, useUpdateSettings } from '@/store/settings'

interface GeneralSettingsProps {
  restartBusy: boolean
  restartMessage: string | null
  restartAvailable: boolean
  runtimeState: LocalPiRuntimeSnapshot['state']
  onRestart(): void
}

export function GeneralSettings({ restartBusy, restartMessage, restartAvailable, runtimeState, onRestart }: GeneralSettingsProps) {
  const t = useT()
  const { composer } = useSettings()
  const { update } = useUpdateSettings()
  const [confirmRestart, setConfirmRestart] = React.useState(false)
  const runtimeFailed = runtimeState === 'crashed' || runtimeState === 'error'
  const runtimePending = runtimeState === 'starting' || runtimeState === 'replacing'
  const choiceClass = 'flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-caption has-[[data-state=checked]]:border-ring/60 has-[[data-state=checked]]:bg-accent/50'
  return <>
    <SettingSection title={t('settings.general.composer')} desc={t('settings.general.composerDesc')}>
      <SettingRow label={t('settings.general.sendShortcut')} desc={t('settings.general.sendShortcutDesc')}>
        <RadioGroup value={composer.sendShortcut} aria-label={t('settings.general.sendShortcut')} onValueChange={(value) => {
          if (value === 'enter' || value === 'mod-enter') update({ composer: { sendShortcut: value } })
        }} className="flex flex-wrap gap-2">
          {(['enter', 'mod-enter'] as const).map((value) => {
            const label = t(value === 'enter' ? 'settings.general.sendShortcut.enter' : 'settings.general.sendShortcut.modEnter')
            return <label key={value} className={choiceClass}><RadioGroupItem value={value} aria-label={label} /><span>{label}</span></label>
          })}
        </RadioGroup>
      </SettingRow>
      <SettingRow label={t('settings.general.runningSubmit')} desc={t('settings.general.runningSubmitDesc')}>
        <span className="text-caption text-muted-foreground">{t('composer.defaultQueueHint')}</span>
      </SettingRow>
    </SettingSection>
    <SettingSection title={t('settings.general.localPi')} desc={t('settings.general.localPiDesc')}>
      <div className="flex flex-wrap items-center gap-3 py-3">
        <TbCpu className="size-5 text-muted-foreground" aria-hidden />
        <span className="text-app font-medium">{t('settings.about.piRuntime')}</span>
        <span className="font-mono text-caption text-muted-foreground">v{SUPPORTED_PI_VERSION}</span>
        <span className="ml-auto flex items-center gap-2 text-caption text-muted-foreground">
          <span className={cn('size-1.5 rounded-full', runtimeState === 'ready' ? 'bg-success' : runtimeFailed ? 'bg-destructive' : 'bg-muted-foreground')} aria-hidden />
          {t(runtimeFailed ? 'settings.redesign.runtimeError' : runtimePending ? 'settings.general.piRestarting' : runtimeState === 'ready' ? 'settings.redesign.runtimeActive' : 'settings.redesign.runtimeInactive')}
        </span>
      </div>
      <p className="font-mono text-caption text-muted-foreground">{t('settings.about.piConfig')}</p>
      <SettingRow label={t('settings.general.piRestart')} desc={t('settings.general.piRestartDesc')}>
        <Button variant="outline" size="sm" disabled={restartBusy || !restartAvailable} onClick={() => setConfirmRestart(true)}>
          <TbRefresh className={restartBusy ? 'animate-spin' : ''} aria-hidden />{t(restartBusy ? 'settings.general.piRestarting' : 'settings.general.piRestart')}
        </Button>
      </SettingRow>
      {restartMessage ? <p className="text-caption text-muted-foreground" role="status">{restartMessage}</p> : null}
    </SettingSection>
    <SettingSection title={t('settings.general.storage')} desc={t('settings.general.storageDesc')}>
      <p className="text-caption text-muted-foreground">{t('settings.general.localStorageNote')}</p>
    </SettingSection>
    <AlertDialog open={confirmRestart} onOpenChange={setConfirmRestart}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t('settings.general.piRestart')}</AlertDialogTitle><AlertDialogDescription>{t('settings.redesign.restartConfirm')}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{t('settings.appearance.resetConfirmNo')}</AlertDialogCancel><AlertDialogAction onClick={onRestart}>{t('settings.general.piRestart')}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}
