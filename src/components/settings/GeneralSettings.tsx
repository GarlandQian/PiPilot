import * as React from 'react'
import { useEditorName } from '@/components/inspector/OpenInEditorButton'
import { useExternalEditors } from '@/renderer/external-editors'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { useT } from '@/i18n'
import { primaryShiftShortcut, primaryShortcut } from '@/lib/keyboard-shortcuts'
import { cn } from '@/lib/utils'
import { SUPPORTED_PI_VERSION, type LocalPiRuntimeSnapshot } from '@/shared/local-pi'
import type { PiDirectorySnapshot } from '@/shared/pi-directory'
import { useSettings, useUpdateSettings } from '@/store/settings'
import { useTaskNotifications } from '@/store/task-notifications'
import { SettingsGroup, SettingsPage, SettingsRow, StatusText } from './kit'

interface GeneralSettingsProps {
  restartBusy: boolean
  restartMessage: string | null
  restartAvailable: boolean
  runtimeState: LocalPiRuntimeSnapshot['state']
  onRestart(): void
}

/** The app "Open in" uses first; it also changes to whichever one opened a file last. */
function DefaultEditorSelect({ id }: { id: string }) {
  const t = useT()
  const { editors, preferred, setPreferred } = useExternalEditors()
  const nameOf = useEditorName()
  const choices = editors.filter((editor) => editor.kind !== 'file-manager')
  return <select id={id} className="mac-select" value={preferred?.id ?? ''} aria-label={t('settings.general.defaultEditor')} disabled={!choices.length}
    onChange={(event) => { if (event.target.value) setPreferred(event.target.value) }}>
    {choices.map((editor) => <option key={editor.id} value={editor.id}>{nameOf(editor)}</option>)}
  </select>
}

/** Where Pi keeps models, keys, MCP servers and sessions; a change applies after reopening PiPilot. */
function PiDirectoryRow() {
  const t = useT()
  const [snapshot, setSnapshot] = React.useState<PiDirectorySnapshot | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const api = window.pipilot?.settings
  const load = React.useCallback(() => {
    if (!api?.getPiDirectory) { setFailed(true); return }
    setFailed(false)
    void api.getPiDirectory().then(setSnapshot).catch(() => setFailed(true))
  }, [api])
  React.useEffect(load, [load])
  const change = async (reset: boolean) => {
    if (!api || busy) return
    setBusy(true)
    setFailed(false)
    try { setSnapshot(await (reset ? api.resetPiDirectory() : api.choosePiDirectory())) }
    catch { setFailed(true) }
    finally { setBusy(false) }
  }
  const path = snapshot ? snapshot.selectedDirectory ?? snapshot.defaultDirectory : null
  return <SettingsRow label={t('settings.piDirectory.title')} info={t('settings.piDirectory.description')} data-pi-directory
    description={<>
      {path ? <span className="block break-all font-mono text-micro">{path}</span> : null}
      {snapshot?.restartRequired ? <span className="mt-1 block text-warning" role="status">{t('settings.piDirectory.restart', { path: snapshot.activeDirectory })}</span> : null}
      {failed ? <span className="mt-1 block text-destructive" role="alert">{t('settings.piDirectory.error')}</span> : null}
    </>}>
    {snapshot ? <>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void change(false)}>{t('settings.piDirectory.choose')}</Button>
      <Button variant="ghost" size="sm" disabled={busy || snapshot.selectedDirectory === null} onClick={() => void change(true)}>{t('settings.piDirectory.reset')}</Button>
    </> : failed ? <Button variant="outline" size="sm" onClick={load}>{t('settings.piDirectory.retry')}</Button> : null}
  </SettingsRow>
}

export function GeneralSettings({ restartBusy, restartMessage, restartAvailable, runtimeState, onRestart }: GeneralSettingsProps) {
  const t = useT()
  const { composer, notifications, locale } = useSettings()
  const taskNotifications = useTaskNotifications()
  const { update } = useUpdateSettings()
  const [confirmRestart, setConfirmRestart] = React.useState(false)
  const runtimeFailed = runtimeState === 'crashed' || runtimeState === 'error'
  const runtimePending = runtimeState === 'starting' || runtimeState === 'replacing'
  const desktopUnavailable = !taskNotifications.loading && !taskNotifications.snapshot.desktopSupported

  return <SettingsPage data-general-settings>
    <SettingsGroup title={t('settings.general.composer')}>
      <SettingsRow label={t('settings.general.sendShortcut')} info={t('settings.general.sendShortcutDesc')} htmlFor="general-send-shortcut">
        <select id="general-send-shortcut" className="mac-select" value={composer.sendShortcut} aria-label={t('settings.general.sendShortcut')} onChange={(event) => {
          const value = event.target.value
          if (value === 'enter' || value === 'mod-enter') update({ composer: { sendShortcut: value } })
        }}>
          <option value="enter">{t('settings.general.sendShortcut.enter')}</option>
          <option value="mod-enter">{t('settings.general.sendShortcut.modEnter', { shortcut: primaryShortcut('Enter') })}</option>
        </select>
      </SettingsRow>
      <SettingsRow label={t('settings.general.runningSubmit')} info={t('settings.general.runningSubmitDesc', { shortcut: primaryShiftShortcut('Enter') })} htmlFor="general-running-submit">
        <select id="general-running-submit" className="mac-select" value={composer.runningSubmit} aria-label={t('settings.general.runningSubmit')} onChange={(event) => {
          const value = event.target.value
          if (value === 'queue' || value === 'steer') update({ composer: { runningSubmit: value } })
        }}>
          <option value="queue">{t('settings.general.runningSubmit.queue')}</option>
          <option value="steer">{t('settings.general.runningSubmit.steer')}</option>
        </select>
      </SettingsRow>
    </SettingsGroup>

    <SettingsGroup title={t('settings.language.title')}>
      <SettingsRow label={t('settings.language.ui')} info={t('settings.language.note')} htmlFor="general-language">
        <select id="general-language" className="mac-select" value={locale} aria-label={t('settings.language.ui')} onChange={(event) => {
          const value = event.target.value
          if (value === 'system' || value === 'zh-CN' || value === 'en-US') update({ locale: value })
        }}>
          <option value="system">{t('settings.language.system')}</option>
          <option value="zh-CN">{t('settings.language.zh')}</option>
          <option value="en-US">{t('settings.language.en')}</option>
        </select>
      </SettingsRow>
    </SettingsGroup>

    <SettingsGroup title={t('settings.general.editor')}>
      <SettingsRow label={t('settings.general.defaultEditor')} info={t('settings.general.defaultEditorDesc')} htmlFor="general-default-editor">
        <DefaultEditorSelect id="general-default-editor" />
      </SettingsRow>
    </SettingsGroup>

    <SettingsGroup title={t('settings.general.notifications')}>
      <SettingsRow label={t('settings.general.desktopNotifications')} info={t('settings.general.desktopNotificationsHint')}
        description={desktopUnavailable ? <span className="text-warning">{t('settings.general.desktopNotificationsUnavailable')}</span> : undefined}>
        <Switch checked={notifications.desktop} onCheckedChange={(desktop) => update({ notifications: { desktop } })} aria-label={t('settings.general.desktopNotifications')} />
      </SettingsRow>
      <SettingsRow label={t('notifications.completionSound')} info={t('notifications.completionSoundDesc')}>
        <Switch checked={notifications.sound} onCheckedChange={(sound) => update({ notifications: { sound } })} aria-label={t('notifications.completionSound')} />
      </SettingsRow>
    </SettingsGroup>

    <SettingsGroup title={t('settings.general.localPi')} info={t('settings.general.localPiDesc')} footer={t('settings.general.localStorageNote')}>
      <SettingsRow label={t('settings.about.piRuntime')}>
        <span className="font-mono text-caption text-muted-foreground">v{SUPPORTED_PI_VERSION}</span>
        <StatusText tone={runtimeState === 'ready' ? 'success' : runtimeFailed ? 'danger' : 'neutral'}
          icon={<span className={cn('size-2 rounded-full', runtimeState === 'ready' ? 'bg-success' : runtimeFailed ? 'bg-destructive' : 'bg-muted-foreground')} aria-hidden />}>
          {t(runtimeFailed ? 'settings.redesign.runtimeError' : runtimePending ? 'settings.general.piRestarting' : runtimeState === 'ready' ? 'settings.redesign.runtimeActive' : 'settings.redesign.runtimeInactive')}
        </StatusText>
      </SettingsRow>
      <PiDirectoryRow />
      <SettingsRow label={t('settings.general.piRestart')} info={t('settings.general.piRestartDesc')}
        description={restartMessage ? <span role="status">{restartMessage}</span> : undefined}>
        <Button variant="outline" size="sm" disabled={restartBusy || !restartAvailable} onClick={() => setConfirmRestart(true)}>
          {t(restartBusy ? 'settings.general.piRestarting' : 'settings.general.piRestartAction')}
        </Button>
      </SettingsRow>
    </SettingsGroup>

    <AlertDialog open={confirmRestart} onOpenChange={setConfirmRestart}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{t('settings.general.piRestart')}</AlertDialogTitle><AlertDialogDescription>{t('settings.redesign.restartConfirm')}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>{t('settings.appearance.resetConfirmNo')}</AlertDialogCancel><AlertDialogAction onClick={onRestart}>{t('settings.general.piRestart')}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </SettingsPage>
}
