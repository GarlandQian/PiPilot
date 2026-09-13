import * as React from 'react'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { useT } from '@/i18n'
import type { ConfigurationDocumentExitGuard } from '@/renderer/configuration-document-exit'
import type { ApplicationShutdownEvent } from '@/shared/application-shutdown'

export function ConfigurationExitDialog({ guard }: { guard: ConfigurationDocumentExitGuard }) {
  const t = useT()
  const [request, setRequest] = React.useState<ApplicationShutdownEvent | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [approved, setApproved] = React.useState(false)
  const active = React.useRef<ApplicationShutdownEvent | null>(null)
  const operation = React.useRef(false)
  const subscribeToDocuments = React.useCallback((listener: () => void) => request ? guard.subscribe(listener) : () => undefined, [guard, request])
  const documentsBusy = React.useSyncExternalStore(subscribeToDocuments, guard.isBusy, guard.isBusy)

  const reset = React.useCallback(() => {
    active.current = null
    operation.current = false
    guard.unlock()
    setRequest(null)
    setBusy(false)
    setFailed(false)
    setApproved(false)
  }, [guard])

  const respond = React.useCallback(async (event: ApplicationShutdownEvent, ready: boolean) => {
    if (active.current?.shutdownId !== event.shutdownId) return
    if (!ready) reset()
    try {
      const result = await window.pipilot!.app.respondToShutdown(event.shutdownId, ready ? 'ready' : 'cancel')
      if (active.current?.shutdownId === event.shutdownId && (!ready || !result.accepted)) reset()
    } catch {
      if (active.current?.shutdownId === event.shutdownId) reset()
    }
  }, [reset])

  React.useEffect(() => {
    const api = window.pipilot?.app
    if (!api?.subscribeShutdown) return
    const unsubscribe = api.subscribeShutdown((event) => {
      if (event.phase === 'cancel') {
        if (active.current?.shutdownId === event.shutdownId) reset()
        return
      }
      if (active.current) return
      active.current = event
      void api.respondToShutdown(event.shutdownId, 'pending').then(({ accepted }) => {
        if (!accepted && active.current?.shutdownId === event.shutdownId) reset()
      }).catch(() => {
        if (active.current?.shutdownId === event.shutdownId) reset()
      })
      if (guard.lockIfClean()) {
        void respond(event, true)
      } else {
        setRequest(event)
        setFailed(false)
      }
    })
    return () => {
      unsubscribe()
      const event = active.current
      if (event) void api.respondToShutdown(event.shutdownId, 'cancel').catch(() => undefined)
      guard.unlock()
    }
  }, [guard, reset, respond])

  React.useEffect(() => {
    if (!request || documentsBusy || busy || failed || approved || active.current?.shutdownId !== request.shutdownId) return
    if (guard.lockIfClean()) {
      setApproved(true)
      void respond(request, true)
    }
  }, [approved, busy, documentsBusy, failed, guard, request, respond])

  async function choose(save: boolean) {
    const event = active.current
    if (!event || operation.current) return
    operation.current = true
    setBusy(true)
    setFailed(false)
    let ready = false
    try {
      ready = save ? await guard.saveAndLock() : guard.discardAndLock()
    } catch {
      // An unexpected adapter failure must not strand the app in a busy dialog.
    }
    if (active.current?.shutdownId !== event.shutdownId) {
      return
    }
    if (!ready) {
      operation.current = false
      setBusy(false)
      setFailed(true)
      return
    }
    setApproved(true)
    await respond(event, true)
  }

  return <AlertDialog open={Boolean(request)} onOpenChange={(open) => {
    if (!open && active.current && !approved) void respond(active.current, false)
  }}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{t(request?.intent === 'install-update' ? 'app.shutdown.updateTitle' : 'app.shutdown.quitTitle')}</AlertDialogTitle>
        <AlertDialogDescription>{t('app.shutdown.description')}</AlertDialogDescription>
      </AlertDialogHeader>
      {failed && <p role="alert" className="text-sm text-destructive">{t('app.shutdown.failed')}</p>}
      {(busy || documentsBusy) && <p role="status" className="text-sm text-muted-foreground">{t('app.shutdown.finishing')}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={approved}>{t('app.shutdown.cancel')}</AlertDialogCancel>
        <Button variant="outline" disabled={busy || documentsBusy || approved} onClick={() => { void choose(false) }}>{t('app.shutdown.discard')}</Button>
        <Button disabled={busy || documentsBusy || approved} onClick={() => { void choose(true) }}>{t('app.shutdown.save')}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
