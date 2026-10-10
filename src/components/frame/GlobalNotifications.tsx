import * as React from 'react'
import {
  TbAlertTriangle,
  TbBell,
  TbCheck,
  TbChecks,
  TbDots,
  TbDownload,
  TbExternalLink,
  TbMessageCircleQuestion,
  TbLoader2,
  TbRefresh,
  TbTrash,
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
      <li className="px-3.5 py-2.5">
        <div className="flex items-start gap-2">
          {snapshot.state === 'downloaded'
            ? <TbCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
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
  const Icon = notification.kind === 'completed' ? TbCheck : notification.kind === 'failed' ? TbAlertTriangle : TbMessageCircleQuestion
  return <li data-task-notification-id={notification.id} data-unread={notification.read ? undefined : true}>
    <button type="button" disabled={busy} onClick={onOpen} aria-label={t('notifications.openTask', { kind, name, source })}
      className="relative flex w-full min-w-0 items-start gap-2.5 rounded-[10px] px-2.5 py-2 text-left outline-none transition-colors hover:bg-fill focus-visible:focus-ring disabled:opacity-60">
      {/* Unread is a dot, as in Mail; the word stays for screen readers. */}
      <span aria-hidden className={cn('mt-[7px] size-2 shrink-0 rounded-full', notification.read ? 'bg-transparent' : 'bg-primary')} />
      <span aria-hidden className={cn('flex size-7 shrink-0 items-center justify-center rounded-full',
        notification.kind === 'completed' ? 'bg-success/14 text-success' : notification.kind === 'failed' ? 'bg-destructive/12 text-destructive' : 'bg-warning/14 text-warning')}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline justify-between gap-2">
          <span className={cn('min-w-0 truncate text-caption text-foreground', !notification.read && 'font-semibold')}>{kind}</span>
          <NotificationTime createdAt={notification.createdAt} now={now} />
        </span>
        <span className="mt-0.5 block truncate text-caption text-foreground/85" title={name}>{name}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-micro text-muted-foreground">
          <span className="min-w-0 truncate" title={source}>{source}</span>
          {notification.kind === 'input-required' && notification.resolved ? <span className="shrink-0">· {t('notifications.resolved')}</span> : null}
        </span>
        {!notification.read ? <span className="sr-only">{t('notifications.unread')}</span> : null}
      </span>
    </button>
  </li>
}

/** "Today" and "Earlier", newest first. */
function groupByDay(items: readonly TaskNotification[], now: number) {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  return {
    today: items.filter((item) => item.createdAt >= startOfToday.getTime()),
    earlier: items.filter((item) => item.createdAt < startOfToday.getTime()),
  }
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
  const groups = groupByDay(visibleNotifications, now)

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
              <TbBell className="size-[18px]" aria-hidden />
              {count > 0 ? (
                <span
                  aria-hidden
                  className={cn('absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-4 text-white shadow-[0_0.5px_1.5px_rgb(0_0_0/0.3)]', unread.some((item) => item.kind === 'failed') ? 'bg-destructive' : 'bg-[#ff3b30]')}
                >{count > 99 ? '99+' : count}</span>
              ) : null}
              {updateSnapshot ? <span aria-hidden className={cn('absolute bottom-1 right-1 size-1.5 rounded-full shadow-[0_0_0_1.5px_var(--color-surface)]', updateSnapshot.state === 'error' ? 'bg-destructive' : 'bg-primary')} /> : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">{t('rail.notifications')}</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        className="flex w-[min(340px,calc(100vw-2rem))] max-h-(--radix-popover-content-available-height) flex-col overflow-hidden p-0"
        aria-label={t('rail.notifications')}
      >
        <div className="flex shrink-0 items-center gap-2 px-3.5 pt-3 pb-1.5">
          <h2 className="text-app font-semibold text-foreground">{t('rail.notifications')}</h2>
          {count > 0 ? <span className="text-micro tabular-nums text-muted-foreground">{t('notifications.unreadTotal', { count })}</span> : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" className="ml-auto text-muted-foreground" aria-label={t('notifications.options')} disabled={disabled}><TbDots aria-hidden /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={count === 0} onSelect={() => void run(() => notifications.markRead())}><TbChecks aria-hidden />{t('notifications.markAllRead')}</DropdownMenuItem>
              <DropdownMenuItem disabled={visibleNotifications.length === 0} onSelect={() => void run(() => notifications.clear())}><TbTrash aria-hidden />{t('notifications.clearHistory')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="scroll-slim min-h-0 max-h-[min(32rem,75vh)] overflow-y-auto px-1 pb-1.5">
          {updateSnapshot ? <section className="mx-1 mb-1.5 rounded-[12px] bg-fill" aria-label={t('notifications.applicationUpdate')}><ul><UpdateNotification snapshot={updateSnapshot} onOpenAbout={() => { setOpen(false); onOpenAbout() }} /></ul></section> : null}
          <section aria-label={t('notifications.taskActivity')}>
            {notifications.errorMessage ? <div role="alert" className="mx-1 mb-1.5 space-y-2 rounded-[12px] bg-destructive/8 px-3 py-2"><p className="text-caption text-destructive">{notifications.errorMessage}</p><Button variant="outline" size="xs" disabled={disabled || notifications.loading} onClick={() => void run(notifications.reload)}><TbRefresh aria-hidden />{t('notifications.retry')}</Button></div> : null}
            {openFailed ? <div role="alert" className="mx-1 mb-1.5 space-y-2 rounded-[12px] bg-destructive/8 px-3 py-2"><p className="text-caption text-destructive">{t('notifications.openFailed')}</p><div className="flex flex-wrap gap-1"><Button variant="outline" size="xs" disabled={disabled} onClick={() => void openNotification(openFailed)}>{t('notifications.retry')}</Button><Button variant="ghost" size="xs" disabled={disabled} onClick={() => void run(async () => { const cleared = await notifications.clear(openFailed); if (cleared) setOpenFailed(null); return cleared })}>{t('notifications.localDismiss')}</Button></div></div> : null}
            {notifications.loading && visibleNotifications.length === 0
              ? <p role="status" className="flex items-center gap-2 px-3 py-4 text-caption text-muted-foreground"><TbLoader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />{t('notifications.loading')}</p>
              : visibleNotifications.length === 0
                ? <div className="flex flex-col items-center gap-2 px-3 py-8 text-center"><TbBell className="size-6 text-muted-foreground/50" aria-hidden /><p className="text-caption text-muted-foreground">{t('rail.notifications.empty')}</p></div>
                : (['today', 'earlier'] as const).map((day) => groups[day].length ? <div key={day} data-notification-day={day}>
                  <h3 className="px-3.5 pt-1.5 pb-0.5 text-micro font-semibold text-muted-foreground">{t(day === 'today' ? 'notifications.today' : 'notifications.earlier')}</h3>
                  <ul>{groups[day].map((notification) => <TaskNotificationRow key={notification.id} notification={notification} now={now} busy={disabled} onOpen={() => void openNotification(notification.id)} />)}</ul>
                </div> : null)}
          </section>
        </div>
      </PopoverContent>
    </Popover>
  )
}
