import * as React from 'react'
import { useEditorName } from '@/components/inspector/OpenInEditorButton'
import { useExternalEditors } from '@/renderer/external-editors'
import { TbCpu, TbRefresh } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { SettingRow, SettingSection } from './common'
import { useT } from '@/i18n'
import { primaryShiftShortcut, primaryShortcut } from '@/lib/keyboard-shortcuts'
import { cn } from '@/lib/utils'
import { SUPPORTED_PI_VERSION, type LocalPiRuntimeSnapshot } from '@/shared/local-pi'
import { useSettings, useUpdateSettings } from '@/store/settings'
import { useTaskNotifications } from '@/store/task-notifications'

interface GeneralSettingsProps {
  restartBusy: boolean
  restartMessage: string | null
  restartAvailable: boolean
  runtimeState: LocalPiRuntimeSnapshot['state']
  onRestart(): void
}

/** The app "Open in" uses first; it also changes to whichever one opened a file last. */
function DefaultEditorSelect() {
  const t = useT()
  const { editors, preferred, setPreferred } = useExternalEditors()
  const nameOf = useEditorName()
  const choices = editors.filter((editor) => editor.kind !== 'file-manager')
  return <select className="mac-select" value={preferred?.id ?? ''} aria-label={t('settings.general.defaultEditor')} disabled={!choices.length}
    onChange={(event) => { if (event.target.value) setPreferred(event.target.value) }}>
    {choices.map((editor) => <option key={editor.id} value={editor.id}>{nameOf(editor)}</option>)}
  </select>
}

export function GeneralSettings({ restartBusy, restartMessage, restartAvailable, runtimeState, onRestart }: GeneralSettingsProps) {
  const t = useT()
  const { composer, notifications } = useSettings()
  const taskNotifications = useTaskNotifications()
  const { update } = useUpdateSettings()
  const [confirmRestart, setConfirmRestart] = React.useState(false)
  const notificationHintId = React.useId()
  const runtimeFailed = runtimeState === 'crashed' || runtimeState === 'error'
  const runtimePending = runtimeState === 'starting' || runtimeState === 'replacing'
  return <>
    <SettingSection title={t('settings.general.composer')} desc={t('settings.general.composerDesc')}>
      <SettingRow label={t('settings.general.sendShortcut')} desc={t('settings.general.sendShortcutDesc')}>
        {/* A row-level choice is a pop-up button, as in System Settings. */}
        <select className="mac-select" value={composer.sendShortcut} aria-label={t('settings.general.sendShortcut')} onChange={(event) => {
          const value = event.target.value
          if (value === 'enter' || value === 'mod-enter') update({ composer: { sendShortcut: value } })
        }}>
          <option value="enter">{t('settings.general.sendShortcut.enter')}</option>
          <option value="mod-enter">{t('settings.general.sendShortcut.modEnter', { shortcut: primaryShortcut('Enter') })}</option>
        </select>
      </SettingRow>
      <SettingRow label={t('settings.general.runningSubmit')} desc={t('settings.general.runningSubmitDesc', { shortcut: primaryShiftShortcut('Enter') })}>
        <select className="mac-select" value={composer.runningSubmit} aria-label={t('settings.general.runningSubmit')} onChange={(event) => {
          const value = event.target.value
          if (value === 'queue' || value === 'steer') update({ composer: { runningSubmit: value } })
        }}>
          <option value="queue">{t('settings.general.runningSubmit.queue')}</option>
          <option value="steer">{t('settings.general.runningSubmit.steer')}</option>
        </select>
      </SettingRow>
    </SettingSection>
    <SettingSection title={t('settings.general.editor')} desc={t('settings.general.editorDesc')}>
      <SettingRow label={t('settings.general.defaultEditor')} desc={t('settings.general.defaultEditorDesc')}>
        <DefaultEditorSelect />
      </SettingRow>
    </SettingSection>
    <SettingSection title={t('settings.general.notifications')} desc={t('settings.general.notificationsDesc')}>
      <SettingRow label={t('settings.general.desktopNotifications')} desc={t('settings.general.desktopNotificationsDesc')}>
        <Switch checked={notifications.desktop} onCheckedChange={(desktop) => update({ notifications: { desktop } })} aria-label={t('settings.general.desktopNotifications')} aria-describedby={notificationHintId} />
      </SettingRow>
      <p id={notificationHintId} className="text-caption text-muted-foreground">{t(!taskNotifications.loading && !taskNotifications.snapshot.desktopSupported ? 'settings.general.desktopNotificationsUnavailable' : 'settings.general.desktopNotificationsHint')}</p>
      <SettingRow label={t('notifications.completionSound')} desc={t('notifications.completionSoundDesc')}>
        <Switch checked={notifications.sound} onCheckedChange={(sound) => update({ notifications: { sound } })} aria-label={t('notifications.completionSound')} />
      </SettingRow>
    </SettingSection>
    <SettingSection title={t('settings.general.localPi')} desc={t('settings.general.localPiDesc')}>
      <div className="flex flex-wrap items-center gap-3 py-3">
        <span className="grid size-7 place-items-center rounded-[7px] bg-[#ff9500] bg-[linear-gradient(to_bottom,rgb(255_255_255/0.18),transparent)] shadow-[0_0.5px_1px_rgb(0_0_0/0.15)]" aria-hidden><TbCpu className="size-4 text-white" /></span>
        <span className="text-app font-medium">{t('settings.about.piRuntime')}</span>
        <span className="font-mono text-caption text-muted-foreground">v{SUPPORTED_PI_VERSION}</span>
        <span className="ml-auto flex items-center gap-2 text-caption text-muted-foreground">
          <span className={cn('size-2 rounded-full', runtimeState === 'ready' ? 'bg-success' : runtimeFailed ? 'bg-destructive' : 'bg-muted-foreground')} aria-hidden />
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
