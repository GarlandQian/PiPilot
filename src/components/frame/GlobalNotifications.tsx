import * as React from 'react'
import {
  TbAlertTriangle,
  TbBell,
  TbCheck,
  TbDownload,
  TbExternalLink,
  TbInfoCircle,
  TbLoader2,
  TbRefresh,
  TbX,
} from 'react-icons/tb'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ApplicationUpdateSnapshot } from '@/shared/application-update'
import { useApplicationUpdate } from '@/store/application-update'
import { usePiExtensionUi, usePiRpcActions } from '@/store/pi-rpc'

function manualDescriptionKey(packageName: string) {
  if (packageName === 'macos') return 'applicationUpdate.manualDescription.macos' as const
  if (packageName === 'nsis') return 'applicationUpdate.manualDescription.windows' as const
  if (packageName === 'deb') return 'applicationUpdate.manualDescription.linux' as const
  return 'applicationUpdate.manualDescription' as const
}

function visibleUpdateSnapshot(
  snapshot: ApplicationUpdateSnapshot | null,
  dismissedVersion: string | null,
) {
  if (
    !snapshot ||
    snapshot.state === 'disabled' ||
    snapshot.state === 'idle' ||
    snapshot.state === 'checking' ||
    snapshot.state === 'current'
  ) {
    return null
  }
  const version = 'availableVersion' in snapshot ? snapshot.availableVersion : null
  if (
    version &&
    dismissedVersion === version &&
    snapshot.state !== 'downloading' &&
    snapshot.state !== 'downloaded' &&
    snapshot.state !== 'error'
  ) {
    return null
  }
  return snapshot
}

function UpdateNotification({
  snapshot,
  onOpenAbout,
}: {
  snapshot: Exclude<ApplicationUpdateSnapshot, { state: 'disabled' | 'idle' | 'checking' | 'current' }>
  onOpenAbout(): void
}) {
  const t = useT()
  const update = useApplicationUpdate()
  const [installConfirmation, setInstallConfirmation] = React.useState(false)
  const version = 'availableVersion' in snapshot ? snapshot.availableVersion : null
  const title = snapshot.state === 'downloaded'
    ? t('applicationUpdate.notice.downloaded')
    : snapshot.state === 'downloading'
      ? t('applicationUpdate.notice.downloading')
      : snapshot.state === 'error'
        ? t('applicationUpdate.status.error')
        : t('applicationUpdate.notice.available')
  const isManual = snapshot.policy.capability === 'manual-release'
  const isNative = snapshot.policy.capability === 'native-install'

  return (
    <>
      <li className="border-b border-border/60 px-3 py-2.5 last:border-b-0">
        <div className="flex items-start gap-2">
          {snapshot.state === 'downloaded'
            ? <TbCheck className="mt-0.5 size-3.5 shrink-0 text-sage" aria-hidden />
            : snapshot.state === 'downloading'
              ? <TbLoader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
              : snapshot.state === 'error'
                ? <TbAlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
                : <TbDownload className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-2">
              <p className="min-w-0 flex-1 text-caption font-medium text-foreground">{title}</p>
              {version ? (
                <span className="shrink-0 font-mono text-micro text-muted-foreground">v{version}</span>
              ) : null}
            </div>
            {snapshot.state === 'downloading' ? (
              <Progress
                className="mt-2 h-1.5"
                value={snapshot.progress.percent}
                aria-label={t('applicationUpdate.progress', {
                  percent: Math.round(snapshot.progress.percent),
                })}
              />
            ) : (
              <p
                role={snapshot.state === 'error' ? 'alert' : 'status'}
                className={cn(
                  'mt-0.5 text-micro',
                  snapshot.state === 'error' ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {snapshot.state === 'error'
                  ? update.errorMessage ?? t('applicationUpdate.status.error')
                  : isManual
                    ? t(manualDescriptionKey(snapshot.policy.package))
                    : t('applicationUpdate.nativeDescription')}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {snapshot.state === 'available' && isManual ? (
                <Button variant="ghost" size="xs" onClick={() => void update.openRelease()}>
                  <TbExternalLink aria-hidden />
                  {t('applicationUpdate.openRelease')}
                </Button>
              ) : null}
              <Button variant="ghost" size="xs" onClick={onOpenAbout}>
                {t('applicationUpdate.details')}
              </Button>
              {snapshot.state === 'available' && isNative ? (
                <Button
                  variant="accent"
                  size="xs"
                  disabled={update.busy}
                  onClick={() => void update.download()}
                >
                  <TbDownload aria-hidden />
                  {t('applicationUpdate.download')}
                </Button>
              ) : null}
              {snapshot.state === 'downloaded' ? (
                <Button
                  variant="accent"
                  size="xs"
                  disabled={update.busy}
                  onClick={() => {
                    void update.install(false).then((result) => {
                      if (result?.outcome === 'confirmation-required') {
                        setInstallConfirmation(true)
                      }
                    })
                  }}
                >
                  <TbRefresh aria-hidden />
                  {t('applicationUpdate.restart')}
                </Button>
              ) : null}
            </div>
          </div>
          {snapshot.state !== 'downloading' && snapshot.state !== 'error' ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('applicationUpdate.dismiss')}
              onClick={update.dismissNotice}
              className="-mr-1"
            >
              <TbX aria-hidden />
            </Button>
          ) : null}
        </div>
      </li>
      <AlertDialog open={installConfirmation} onOpenChange={setInstallConfirmation}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('applicationUpdate.confirmRestartTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('applicationUpdate.activeWorkConfirmation')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('applicationUpdate.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="accent"
              onClick={() => {
                setInstallConfirmation(false)
                void update.install(true)
              }}
            >
              {t('applicationUpdate.confirmRestart')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function GlobalNotifications({ onOpenAbout }: { onOpenAbout(): void }) {
  const t = useT()
  const extension = usePiExtensionUi()
  const actions = usePiRpcActions()
  const update = useApplicationUpdate()
  const [open, setOpen] = React.useState(false)
  const updateSnapshot = visibleUpdateSnapshot(update.snapshot, update.dismissedVersion)
  const count = extension.notifications.length + (updateSnapshot ? 1 : 0)
  const pendingReveal = extension.notifications.slice().reverse().find((notification) =>
    notification.autoReveal)
  const severity = updateSnapshot?.state === 'error' ||
    extension.notifications.some((item) => item.type === 'error')
    ? 'error'
    : extension.notifications.some((item) => item.type === 'warning')
      ? 'warning'
      : 'info'

  React.useEffect(() => {
    if (!pendingReveal) return
    setOpen(true)
    actions.markNotificationRevealed(pendingReveal.id)
  }, [actions, pendingReveal])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={count > 0
                ? t('rail.notifications.count', { count })
                : t('rail.notifications')}
              className="relative text-muted-foreground hover:text-foreground"
            >
              <TbBell className="size-4.5" aria-hidden />
              {count > 0 ? (
                <span
                  aria-hidden
                  className={cn(
                    'absolute right-1 top-1 size-1.5 rounded-full ring-2 ring-sidebar',
                    severity === 'error'
                      ? 'bg-destructive'
                      : severity === 'warning'
                        ? 'bg-warning'
                        : 'bg-sage',
                  )}
                />
              ) : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{t('rail.notifications')}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        className="w-80 p-0"
        aria-label={t('rail.notifications')}
      >
        <div className="border-b border-border px-3 py-2">
          <h2 className="text-caption font-medium text-foreground">
            {t('rail.notifications')}
          </h2>
        </div>
        {count === 0 ? (
          <p className="px-3 py-4 text-caption text-muted-foreground">
            {t('rail.notifications.empty')}
          </p>
        ) : (
          <ul className="scroll-slim max-h-80 overflow-y-auto">
            {updateSnapshot ? (
              <UpdateNotification
                snapshot={updateSnapshot}
                onOpenAbout={() => {
                  setOpen(false)
                  onOpenAbout()
                }}
              />
            ) : null}
            {extension.notifications.map((notification) => (
              <li
                key={notification.id}
                className="flex items-start gap-2 border-b border-border/60 px-3 py-2.5 last:border-b-0"
              >
                {notification.type === 'info' ? (
                  <TbInfoCircle
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                ) : (
                  <TbAlertTriangle
                    className={cn(
                      'mt-0.5 size-3.5 shrink-0',
                      notification.type === 'error' ? 'text-destructive' : 'text-warning',
                    )}
                    aria-hidden
                  />
                )}
                <p
                  role={notification.type === 'error' ? 'alert' : 'status'}
                  className="min-w-0 flex-1 break-words text-caption text-foreground"
                >
                  {notification.message}
                </p>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('extension.notification.dismiss')}
                  onClick={() => actions.dismissNotification(notification.id)}
                  className="-mr-1"
                >
                  <TbX aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
