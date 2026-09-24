import * as React from 'react'
import {
  TbAlertTriangle,
  TbBell,
  TbCheck,
  TbDownload,
  TbExternalLink,
  TbMessageCircleQuestion,
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
import { useLocale, useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ApplicationUpdateSnapshot } from '@/shared/application-update'
import { useApplicationUpdate } from '@/store/application-update'
import { useTaskNotifications } from '@/store/task-notifications'
import type { TaskNotification } from '@/shared/task-notifications'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'

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
              <div
                role={snapshot.state === 'error' ? 'alert' : 'status'}
                className={cn(
                  'mt-0.5 text-micro',
                  snapshot.state === 'error' ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                <MarkdownContent markdown={snapshot.state === 'error'
                  ? update.errorMessage ?? t('applicationUpdate.status.error')
                  : isManual
                    ? t(manualDescriptionKey(snapshot.policy.package))
                    : t('applicationUpdate.nativeDescription')} />
              </div>
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

function NotificationTime({ createdAt, now }: { createdAt: number; now: number }) {
  const locale = useLocale()
  const minutes = Math.round((createdAt - now) / 60_000)
  const hours = Math.round(minutes / 60)
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const date = new Date(createdAt)
  const text = Math.abs(minutes) < 60 ? relative.format(Math.min(0, minutes), 'minute')
    : Math.abs(hours) < 24 ? relative.format(hours, 'hour')
      : new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date)
  return <time dateTime={date.toISOString()} title={date.toLocaleString(locale)} className="shrink-0 text-micro tabular-nums text-muted-foreground">{text}</time>
}

function TaskNotificationRow({ notification, now, busy, onOpen }: {
  notification: TaskNotification
  now: number
  busy: boolean
  onOpen(): void
}) {
  const t = useT()
  const name = notification.sessionName ?? t('sidebar.session.untitled')
  const source = notification.scope.kind === 'projectless' ? t('conversation.projectless') : notification.projectName ?? t('notifications.project')
  const kind = t(notification.kind === 'completed' ? 'notifications.kind.completed' : notification.kind === 'failed' ? 'notifications.kind.failed' : 'notifications.kind.inputRequired')
  return <li data-task-notification-id={notification.id} className="border-b border-border/60 last:border-b-0">
    <button type="button" disabled={busy} onClick={onOpen} aria-label={t('notifications.openTask', { kind, name, source })} className={cn('flex w-full min-w-0 items-start gap-2 px-3 py-3 text-left outline-none transition-colors hover:bg-accent focus-visible:focus-ring disabled:opacity-60', !notification.read && 'bg-sage/5')}>
      {notification.kind === 'completed' ? <TbCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : notification.kind === 'failed' ? <TbAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden /> : <TbMessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline justify-between gap-2"><span className="min-w-0 text-caption font-medium text-foreground">{kind}</span><NotificationTime createdAt={notification.createdAt} now={now} /></span>
        <span className="mt-0.5 block truncate text-caption text-foreground" title={name}>{name}</span>
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-micro text-muted-foreground"><span className="min-w-0 truncate" title={source}>{source}</span>{notification.kind === 'input-required' && notification.resolved ? <span>{t('notifications.resolved')}</span> : null}<span className={cn('ml-auto inline-flex shrink-0 items-center gap-1', !notification.read && 'text-foreground')}>{!notification.read ? <span aria-hidden className="size-1.5 rounded-full bg-sage" /> : null}{t(notification.read ? 'notifications.read' : 'notifications.unread')}</span></span>
      </span>
    </button>
  </li>
}

export function GlobalNotifications({ onOpenAbout, onOpenNotification }: {
  onOpenAbout(): void
  onOpenNotification(id: string): Promise<void>
}) {
  const t = useT()
  const notifications = useTaskNotifications()
  const update = useApplicationUpdate()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [openingId, setOpeningId] = React.useState<string | null>(null)
  const [openFailed, setOpenFailed] = React.useState<string | null>(null)
  const [now, setNow] = React.useState(Date.now)
  const busyRef = React.useRef(false)
  const visibleNotifications = [...notifications.snapshot.items].sort((left, right) => right.createdAt - left.createdAt)
  const unread = visibleNotifications.filter((item) => !item.read)
  const updateSnapshot = visibleUpdateSnapshot(update.snapshot, update.dismissedVersion)
  const count = unread.length

  React.useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [open])

  const run = async (operation: () => Promise<boolean>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try { await operation() } finally { busyRef.current = false; setBusy(false) }
  }
  const openNotification = async (id: string) => {
    if (busyRef.current) return
    busyRef.current = true
    setOpeningId(id)
    setOpenFailed(null)
    try {
      await onOpenNotification(id)
      setOpen(false)
    } catch {
      setOpenFailed(id)
    } finally {
      busyRef.current = false
      setOpeningId(null)
    }
  }
  const disabled = busy || openingId !== null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={count > 0
                ? t('notifications.unreadCount', { count })
                : t('rail.notifications')}
              className="relative text-muted-foreground hover:text-foreground"
            >
              <TbBell className="size-4.5" aria-hidden />
              {count > 0 ? (
                <span
                  aria-hidden
                  className={cn('absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold leading-4 text-white ring-2 ring-sidebar', unread.some((item) => item.kind === 'failed') ? 'bg-destructive' : 'bg-sage')}
                >{count > 99 ? '99+' : count}</span>
              ) : null}
              {updateSnapshot ? <span aria-hidden className={cn('absolute bottom-1 right-1 size-1.5 rounded-full ring-2 ring-sidebar', updateSnapshot.state === 'error' ? 'bg-destructive' : 'bg-sage')} /> : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{t('rail.notifications')}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        className="flex w-[min(22rem,calc(100vw-2rem))] max-h-(--radix-popover-content-available-height) flex-col overflow-hidden p-0"
        aria-label={t('rail.notifications')}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <h2 className="text-caption font-medium text-foreground">
            {t('rail.notifications')}
          </h2>
          <span className="text-micro tabular-nums text-muted-foreground">{t('notifications.unreadTotal', { count })}</span>
        </div>
        <div className="scroll-slim min-h-0 max-h-[min(32rem,75vh)] overflow-y-auto">
          {updateSnapshot ? <section className="border-b border-border" aria-label={t('notifications.applicationUpdate')}><h3 className="px-3 pt-2 text-micro font-medium text-muted-foreground">{t('notifications.applicationUpdate')}</h3><ul><UpdateNotification snapshot={updateSnapshot} onOpenAbout={() => { setOpen(false); onOpenAbout() }} /></ul></section> : null}
          <section aria-label={t('notifications.taskActivity')}>
            <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
              <h3 className="mr-auto px-1 text-micro font-medium text-muted-foreground">{t('notifications.taskActivity')}</h3>
              <Button variant="ghost" size="xs" disabled={disabled || count === 0} onClick={() => void run(() => notifications.markRead())}>{t('notifications.markAllRead')}</Button>
              <Button variant="ghost" size="xs" disabled={disabled || visibleNotifications.length === 0} onClick={() => void run(() => notifications.clear())}>{t('notifications.clearHistory')}</Button>
            </div>
            {notifications.errorMessage ? <div role="alert" className="space-y-2 border-b border-border px-3 py-2"><p className="text-caption text-destructive">{notifications.errorMessage}</p><Button variant="outline" size="xs" disabled={disabled || notifications.loading} onClick={() => void run(notifications.reload)}><TbRefresh aria-hidden />{t('notifications.retry')}</Button></div> : null}
            {openFailed ? <div role="alert" className="space-y-2 border-b border-border px-3 py-2"><p className="text-caption text-destructive">{t('notifications.openFailed')}</p><div className="flex flex-wrap gap-1"><Button variant="outline" size="xs" disabled={disabled} onClick={() => void openNotification(openFailed)}>{t('notifications.retry')}</Button><Button variant="ghost" size="xs" disabled={disabled} onClick={() => void run(async () => { const cleared = await notifications.clear(openFailed); if (cleared) setOpenFailed(null); return cleared })}>{t('notifications.localDismiss')}</Button></div></div> : null}
            {notifications.loading && visibleNotifications.length === 0 ? <p role="status" className="flex items-center gap-2 px-3 py-4 text-caption text-muted-foreground"><TbLoader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />{t('notifications.loading')}</p> : visibleNotifications.length === 0 ? <p className="px-3 py-4 text-caption text-muted-foreground">{t('rail.notifications.empty')}</p> : <ul>{visibleNotifications.map((notification) => <TaskNotificationRow key={notification.id} notification={notification} now={now} busy={disabled} onOpen={() => void openNotification(notification.id)} />)}</ul>}
          </section>
        </div>
      </PopoverContent>
    </Popover>
  )
}
