import * as React from 'react'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import type { PiDirectorySnapshot } from '@/shared/pi-directory'

export function PiDirectorySettings() {
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
  return <div className="space-y-2 py-3">
    <p className="text-app font-medium">{t('settings.piDirectory.title')}</p>
    <p className="text-caption text-muted-foreground">{t('settings.piDirectory.description')}</p>
    {snapshot ? <>
      <p className="break-all font-mono text-caption">{snapshot.selectedDirectory ?? snapshot.defaultDirectory}</p>
      {snapshot.restartRequired ? <p role="status" className="text-caption text-muted-foreground">{t('settings.piDirectory.restart', { path: snapshot.activeDirectory })}</p> : null}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void change(false)}>{t('settings.piDirectory.choose')}</Button>
        <Button variant="outline" size="sm" disabled={busy || snapshot.selectedDirectory === null} onClick={() => void change(true)}>{t('settings.piDirectory.reset')}</Button>
      </div>
    </> : null}
    {failed ? <div role="alert" className="text-caption text-destructive">
      {t('settings.piDirectory.error')}
      {!snapshot ? <Button variant="outline" size="sm" onClick={load}>{t('settings.piDirectory.retry')}</Button> : null}
    </div> : null}
  </div>
}
