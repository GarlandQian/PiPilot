import * as React from 'react'
import {
  TbCheck,
  TbArrowLeft,
  TbChevronRight,
  TbCopy,
  TbDownload,
  TbPackage,
  TbPlugConnected,
  TbPlus,
  TbRefresh,
  TbSearch,
  TbServer,
  TbTrash,
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLocale, useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type {
  PiCompatibilityLabel,
  PiPackageSummary,
  PiIntegrationOperationResult,
  PiResourceKind,
  PiResourceSummary,
} from '@/shared/pi-integrations'
import { usePiIntegrations } from '@/store/pi-integrations'
import { useExternalControl } from '@/store/external-control'
import { usePiExtensionUi } from '@/store/pi-rpc'
import { useWorkspaceStore } from '@/store/workspace'
import { McpSettings } from './McpSettings'

export type IntegrationsTabId =
  | 'overview'
  | 'packages'
  | 'resources'
  | 'mcp'
  | 'external-control'

export interface IntegrationsSettingsProps {
  tab: IntegrationsTabId
  onTab(tab: IntegrationsTabId): void
}

const TABS: IntegrationsTabId[] = [
  'overview',
  'packages',
  'resources',
  'mcp',
  'external-control',
]
const RESOURCE_KINDS: Array<'all' | PiResourceKind> = [
  'all',
  'extension',
  'skill',
  'prompt',
  'theme',
]
const OVERVIEW_RESOURCE_KINDS: PiResourceKind[] = ['extension', 'skill', 'prompt']
function totalResources(pkg: PiPackageSummary) {
  return Object.values(pkg.resourceCounts).reduce((total, count) => total + count, 0)
}

function CompatibilityBadge({ value }: { value: PiCompatibilityLabel }) {
  const t = useT()
  return (
    <Badge variant={value === 'rich-adapter' ? 'secondary' : 'outline'}>
      {t(`settings.integrations.compatibility.${value}`)}
    </Badge>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-44 place-items-center px-6 text-center text-caption text-muted-foreground">
      {children}
    </div>
  )
}

export function serializeExternalControlConfiguration(configuration: {
  command: string
  args: string[]
  env?: Record<string, string>
}) {
  return `${JSON.stringify({
    command: configuration.command,
    args: configuration.args,
    ...(configuration.env ? { env: configuration.env } : {}),
  }, null, 2)}\n`
}

function ExternalControlView() {
  const t = useT()
  const locale = useLocale()
  const externalControl = useExternalControl()
  const snapshot = externalControl.snapshot
  const [confirmDisable, setConfirmDisable] = React.useState(false)
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle')
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
  }, [])

  const configurationText = React.useMemo(
    () => snapshot?.configuration
      ? serializeExternalControlConfiguration(snapshot.configuration)
      : '',
    [snapshot?.configuration],
  )
  const formatTimestamp = React.useMemo(() => new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }), [locale])

  if (!snapshot) {
    return (
      <EmptyState>
        <div
          className="flex flex-col items-center gap-2"
          role={externalControl.errorMessage ? 'alert' : 'status'}
        >
          <span>
            {externalControl.errorMessage
              ? t('settings.externalControl.loadError')
              : t('settings.externalControl.loading')}
          </span>
          {externalControl.errorMessage ? (
            <Button variant="ghost" size="sm" onClick={() => void externalControl.retry()}>
              <TbRefresh aria-hidden />
              {t('common.retry')}
            </Button>
          ) : null}
        </div>
      </EmptyState>
    )
  }

  const transitioning = snapshot.state === 'enabling' || snapshot.state === 'disabling'
  const unavailable = snapshot.state === 'unavailable'
  const statusVariant = snapshot.state === 'ready'
    ? 'soft-success' as const
    : snapshot.state === 'error'
      ? 'soft-danger' as const
      : transitioning
        ? 'soft-warning' as const
        : 'outline' as const
  const toggle = (enabled: boolean) => {
    if (!enabled && snapshot.connectedClients > 0) {
      setConfirmDisable(true)
      return
    }
    void externalControl.setEnabled(enabled)
  }
  const copyConfiguration = async () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
    try {
      await navigator.clipboard.writeText(configurationText)
      setCopyState('copied')
      copyTimer.current = setTimeout(() => {
        setCopyState('idle')
        copyTimer.current = null
      }, 1_200)
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <>
      <div className="divide-y divide-border border-y border-border">
        <section className="py-4" aria-labelledby="external-control-title">
          <div className="flex min-w-0 items-start gap-3">
            <TbPlugConnected className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h3 id="external-control-title" className="text-title">
                  {t('settings.externalControl.title')}
                </h3>
                <Badge variant={statusVariant}>
                  {t(`settings.externalControl.state.${snapshot.state}`)}
                </Badge>
              </div>
              <p className="mt-1 max-w-2xl text-caption text-muted-foreground">
                {t('settings.externalControl.description')}
              </p>
            </div>
            <Switch
              id="external-control-enabled"
              checked={snapshot.enabled}
              disabled={transitioning || (unavailable && !snapshot.enabled)}
              aria-label={t('settings.externalControl.enableLabel')}
              onCheckedChange={toggle}
            />
          </div>

          <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-2 pl-8" aria-live="polite">
            <p className={cn(
              'min-w-0 text-caption text-muted-foreground',
              snapshot.state === 'error' && 'text-destructive',
            )}>
              {t(`settings.externalControl.state.${snapshot.state}.desc`, {
                count: snapshot.connectedClients,
              })}
            </p>
            {snapshot.state === 'error' || externalControl.errorMessage ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={transitioning}
                onClick={() => void externalControl.retry()}
              >
                <TbRefresh aria-hidden />
                {t('common.retry')}
              </Button>
            ) : null}
          </div>
        </section>

        {snapshot.state === 'ready' && snapshot.configuration ? (
          <section className="py-4" aria-labelledby="external-control-configuration-title">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 id="external-control-configuration-title" className="text-caption font-medium text-foreground">
                  {t('settings.externalControl.configuration')}
                </h3>
                <p className="mt-1 text-micro text-muted-foreground">
                  {t('settings.externalControl.configurationDesc')}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void copyConfiguration()}>
                {copyState === 'copied'
                  ? <TbCheck className="text-sage" aria-hidden />
                  : <TbCopy aria-hidden />}
                {copyState === 'copied'
                  ? t('settings.externalControl.copied')
                  : t('settings.externalControl.copy')}
              </Button>
            </div>
            <pre className="scroll-slim mt-3 max-h-44 max-w-full overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-micro text-foreground">
              <code>{configurationText}</code>
            </pre>
            {copyState === 'failed' ? (
              <p className="mt-2 text-micro text-destructive" role="alert">
                {t('settings.externalControl.copyFailed')}
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="py-4" aria-labelledby="external-control-recent-title">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
            <h3 id="external-control-recent-title" className="text-caption font-medium text-foreground">
              {t('settings.externalControl.recent')}
            </h3>
            {snapshot.state === 'ready' ? (
              <span className="text-micro tabular-nums text-muted-foreground">
                {t(snapshot.connectedClients === 1
                  ? 'settings.externalControl.client'
                  : 'settings.externalControl.clients', {
                  count: snapshot.connectedClients,
                })}
              </span>
            ) : null}
          </div>
          {snapshot.recentOperations.length === 0 ? (
            <p className="py-8 text-center text-caption text-muted-foreground">
              {t('settings.externalControl.recentEmpty')}
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border" aria-label={t('settings.externalControl.recent')}>
              {snapshot.recentOperations.map((operation) => (
                <li
                  key={operation.presentationId}
                  className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2"
                >
                  <div className="min-w-40 flex-1">
                    <p className="truncate text-caption text-foreground" title={operation.conversationLabel}>
                      {operation.conversationLabel ?? t('settings.externalControl.conversation')}
                    </p>
                    <p className="mt-0.5 text-micro text-muted-foreground">
                      {t(`settings.externalControl.action.${operation.action}`)}
                    </p>
                  </div>
                  <Badge variant={operation.status === 'completed'
                    ? 'soft-success'
                    : operation.status === 'failed' || operation.status === 'runtime_replaced'
                      ? 'soft-danger'
                      : 'outline'}>
                    {t(`settings.externalControl.operation.${operation.status}`)}
                  </Badge>
                  <time
                    dateTime={operation.timestamp}
                    className="w-32 text-right text-micro tabular-nums text-muted-foreground"
                  >
                    {formatTimestamp.format(new Date(operation.timestamp))}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <AlertDialog open={confirmDisable} onOpenChange={setConfirmDisable}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.externalControl.disableTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.externalControl.disableDesc', {
                count: snapshot.connectedClients,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmDisable(false)
                void externalControl.setEnabled(false)
              }}
            >
              {t('settings.externalControl.disableAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function SearchField({
  value,
  onChange,
}: {
  value: string
  onChange(value: string): void
}) {
  const t = useT()
  return (
    <label className="relative block min-w-0 flex-1">
      <TbSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <span className="sr-only">{t('settings.integrations.search')}</span>
      <Input
        className="pl-8"
        value={value}
        placeholder={t('settings.integrations.search')}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function PackageDetail({
  pkg,
  busy,
  onBack,
  onRemove,
  onUpdate,
}: {
  pkg: PiPackageSummary
  busy: boolean
  onBack(): void
  onRemove(): void
  onUpdate(): void
}) {
  const t = useT()
  const fields = [
    [t('settings.integrations.package.source'), pkg.source],
    [t('settings.integrations.package.scope'), t(`settings.integrations.scope.${pkg.scope}`)],
    [t('settings.integrations.package.version'), pkg.installedVersion ?? t('settings.integrations.unknown')],
    [t('settings.integrations.package.path'), pkg.installedPath ?? t('settings.integrations.unknown')],
  ] as const

  return (
    <div className="min-w-0 p-4">
      <div className="flex min-w-0 items-start gap-2">
        <Button className="lg:hidden" variant="ghost" size="icon-sm" aria-label={t('common.back')} onClick={onBack}>
          <TbArrowLeft aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-title">{pkg.displayName}</h3>
          <p className="mt-0.5 truncate font-mono text-micro text-muted-foreground">{pkg.source}</p>
        </div>
        <CompatibilityBadge value={pkg.compatibility} />
      </div>

      <dl className="mt-5 grid gap-3 border-y border-border py-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
        {fields.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="text-caption text-muted-foreground">{label}</dt>
            <dd className="break-all text-caption text-foreground">{value}</dd>
          </React.Fragment>
        ))}
        <dt className="text-caption text-muted-foreground">{t('settings.integrations.package.resources')}</dt>
        <dd className="flex flex-wrap gap-1.5">
          {(['extension', 'skill', 'prompt', 'theme'] as const).map((kind) => (
            <Badge key={kind} variant="outline">
              {t(`settings.integrations.resource.${kind}`)} {pkg.resourceCounts[kind]}
            </Badge>
          ))}
        </dd>
      </dl>

      <div className="mt-4">
        <p className="text-caption font-medium text-foreground">
          {t('settings.integrations.compatibility.title')}
        </p>
        <p className="mt-1 text-caption text-muted-foreground">
          {t(`settings.integrations.compatibility.${pkg.compatibility}.desc`)}
        </p>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy || pkg.pinned} onClick={onUpdate}>
          <TbDownload aria-hidden />
          {pkg.pinned ? t('settings.integrations.package.pinned') : t('settings.integrations.update')}
        </Button>
        <Button variant="destructive" size="sm" disabled={busy} onClick={onRemove}>
          <TbTrash aria-hidden />
          {t('settings.integrations.remove')}
        </Button>
      </div>
    </div>
  )
}

function PackagesView() {
  const t = useT()
  const integrations = usePiIntegrations()
  const packages = integrations.snapshot?.packages ?? []
  const [query, setQuery] = React.useState('')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [removeCandidate, setRemoveCandidate] = React.useState<PiPackageSummary | null>(null)
  const filtered = React.useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return packages
    return packages.filter((pkg) =>
      `${pkg.displayName}\n${pkg.source}`.toLocaleLowerCase().includes(needle))
  }, [packages, query])
  const selected = packages.find((pkg) => pkg.id === selectedId) ?? null
  const busy = integrations.status === 'operating'

  React.useEffect(() => {
    if (selectedId && !packages.some((pkg) => pkg.id === selectedId)) setSelectedId(null)
  }, [packages, selectedId])

  return (
    <>
      <div className="grid min-h-[31rem] overflow-hidden rounded-md border border-border lg:grid-cols-[minmax(16rem,0.38fr)_minmax(0,1fr)]">
        <div className={cn('min-w-0 border-border lg:border-r', selected && 'max-lg:hidden')}>
          <div className="flex items-center gap-2 border-b border-border p-2">
            <SearchField value={query} onChange={setQuery} />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={t('common.refresh')} onClick={() => void integrations.refresh()}>
                  <TbRefresh aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('common.refresh')}</TooltipContent>
            </Tooltip>
          </div>
          <div className="scroll-slim max-h-[36rem] overflow-y-auto p-1.5">
            {filtered.map((pkg) => (
              <button
                key={pkg.id}
                type="button"
                aria-current={selected?.id === pkg.id ? 'true' : undefined}
                className={cn(
                  'grid h-16 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/40',
                  selected?.id === pkg.id && 'bg-accent',
                )}
                onClick={() => setSelectedId(pkg.id)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-caption font-medium text-foreground">{pkg.displayName}</span>
                  <span className="mt-1 block truncate font-mono text-micro text-muted-foreground">{pkg.source}</span>
                </span>
                <span className="text-right text-micro text-muted-foreground">
                  <span className="block">{pkg.installedVersion ?? pkg.sourceType}</span>
                  <span className="block">{t('settings.integrations.resourceCount', { count: totalResources(pkg) })}</span>
                </span>
              </button>
            ))}
            {filtered.length === 0 && <EmptyState>{t('settings.integrations.packages.empty')}</EmptyState>}
          </div>
        </div>
        <div className={cn('min-w-0', !selected && 'max-lg:hidden')}>
          {selected
            ? (
                <PackageDetail
                  pkg={selected}
                  busy={busy}
                  onBack={() => setSelectedId(null)}
                  onUpdate={() => void integrations.update(selected.source)}
                  onRemove={() => setRemoveCandidate(selected)}
                />
              )
            : <EmptyState>{t('settings.integrations.packages.select')}</EmptyState>}
        </div>
      </div>

      <AlertDialog open={Boolean(removeCandidate)} onOpenChange={(open) => !open && setRemoveCandidate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.integrations.removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.integrations.removeConfirm', { name: removeCandidate?.displayName ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (removeCandidate) void integrations.remove(removeCandidate.source)
                setRemoveCandidate(null)
              }}
            >
              {t('settings.integrations.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function ResourceDetail({ resource, onBack }: { resource: PiResourceSummary; onBack(): void }) {
  const t = useT()
  return (
    <div className="min-w-0 p-4">
      <div className="flex min-w-0 items-start gap-2">
        <Button className="lg:hidden" variant="ghost" size="icon-sm" aria-label={t('common.back')} onClick={onBack}>
          <TbArrowLeft aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-title">{resource.label}</h3>
          <p className="mt-0.5 break-all font-mono text-micro text-muted-foreground">{resource.path}</p>
        </div>
        <Badge variant="outline">{t(`settings.integrations.resource.${resource.kind}`)}</Badge>
      </div>
      {resource.description && <p className="mt-4 text-caption text-muted-foreground">{resource.description}</p>}
      <dl className="mt-5 grid gap-3 border-y border-border py-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <dt className="text-caption text-muted-foreground">{t('settings.integrations.package.source')}</dt>
        <dd className="break-all text-caption">{resource.source}</dd>
        <dt className="text-caption text-muted-foreground">{t('settings.integrations.package.scope')}</dt>
        <dd className="text-caption">{t(`settings.integrations.scope.${resource.scope}`)}</dd>
        <dt className="text-caption text-muted-foreground">{t('settings.integrations.resource.state')}</dt>
        <dd className="text-caption">{t(`settings.integrations.resource.state.${resource.effectiveState}`)}</dd>
        {resource.invocation && (
          <>
            <dt className="text-caption text-muted-foreground">{t('settings.integrations.resource.invocation')}</dt>
            <dd className="break-all font-mono text-caption">{resource.invocation}</dd>
          </>
        )}
      </dl>
      <div className="mt-4">
        <CompatibilityBadge value={resource.compatibility} />
        <p className="mt-2 text-caption text-muted-foreground">
          {resource.kind === 'theme'
            ? t('settings.integrations.resources.themeBoundary')
            : t('settings.integrations.resources.readOnly')}
        </p>
        {resource.diagnostic && <p className="mt-2 text-caption text-warning">{resource.diagnostic}</p>}
      </div>
    </div>
  )
}

function ResourcesView() {
  const t = useT()
  const integrations = usePiIntegrations()
  const resources = integrations.snapshot?.resources ?? []
  const [query, setQuery] = React.useState('')
  const [kind, setKind] = React.useState<'all' | PiResourceKind>('all')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const filtered = React.useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return resources.filter((resource) =>
      (kind === 'all' || resource.kind === kind) &&
      (!needle || `${resource.label}\n${resource.source}\n${resource.description ?? ''}`.toLocaleLowerCase().includes(needle)))
  }, [kind, query, resources])
  const selected = resources.find((resource) => resource.id === selectedId) ?? null

  React.useEffect(() => {
    if (selectedId && !resources.some((resource) => resource.id === selectedId)) setSelectedId(null)
  }, [resources, selectedId])

  return (
    <div className="grid min-h-[31rem] overflow-hidden rounded-md border border-border lg:grid-cols-[minmax(16rem,0.38fr)_minmax(0,1fr)]">
      <div className={cn('min-w-0 border-border lg:border-r', selected && 'max-lg:hidden')}>
        <div className="border-b border-border p-2">
          <SearchField value={query} onChange={setQuery} />
          <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={t('settings.integrations.resources.filter')}>
            {RESOURCE_KINDS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-pressed={kind === candidate}
                className="h-7 rounded px-2 text-micro text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                onClick={() => setKind(candidate)}
              >
                {t(`settings.integrations.resource.${candidate}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="scroll-slim max-h-[36rem] overflow-y-auto p-1.5">
          {filtered.map((resource) => (
            <button
              key={resource.id}
              type="button"
              aria-current={selected?.id === resource.id ? 'true' : undefined}
              className={cn(
                'grid h-16 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/40',
                selected?.id === resource.id && 'bg-accent',
              )}
              onClick={() => setSelectedId(resource.id)}
            >
              <span className="min-w-0">
                <span className="block truncate text-caption font-medium">{resource.label}</span>
                <span className="mt-1 block truncate text-micro text-muted-foreground">{resource.source}</span>
              </span>
              <Badge variant="outline">{t(`settings.integrations.resource.${resource.kind}`)}</Badge>
            </button>
          ))}
          {filtered.length === 0 && <EmptyState>{t('settings.integrations.resources.empty')}</EmptyState>}
        </div>
      </div>
      <div className={cn('min-w-0', !selected && 'max-lg:hidden')}>
        {selected
          ? <ResourceDetail resource={selected} onBack={() => setSelectedId(null)} />
          : <EmptyState>{t('settings.integrations.resources.select')}</EmptyState>}
      </div>
    </div>
  )
}

function Overview({ onTab }: { onTab(tab: IntegrationsTabId): void }) {
  const t = useT()
  const integrations = usePiIntegrations()
  const snapshot = integrations.snapshot
  const retry = snapshot?.retry
  const [retrySave, setRetrySave] = React.useState<{
    state: PiIntegrationOperationResult['runtimeSync'] | 'persistence-failed'
    runtimeError?: string
  } | null>(null)
  const totals = React.useMemo(() => {
    const result: Record<PiResourceKind, number> = {
      extension: 0,
      skill: 0,
      prompt: 0,
      theme: 0,
    }
    for (const resource of snapshot?.resources ?? []) result[resource.kind] += 1
    return result
  }, [snapshot?.resources])
  const visibleResourceKinds = OVERVIEW_RESOURCE_KINDS.filter((kind) => totals[kind] > 0)
  const totalResolvedResources = Object.values(totals)
    .reduce((total, count) => total + count, 0)
  const extension = usePiExtensionUi()
  const runtimeProblems = React.useMemo(() => [
    ...extension.unsupportedMethods.map((method) =>
      t('settings.integrations.runtimeSupport.unsupportedMethod', { method })),
    ...(snapshot?.diagnostics ?? [])
      .filter((diagnostic) => diagnostic.severity !== 'info')
      .map((diagnostic) => diagnostic.message),
  ].slice(0, 8), [extension.unsupportedMethods, snapshot?.diagnostics, t])

  React.useEffect(() => {
    setRetrySave(null)
  }, [integrations.scope])

  const changeGlobalRetry = async (enabled: boolean) => {
    setRetrySave(null)
    const result = await integrations.setRetryEnabled(enabled)
    setRetrySave(result
      ? { state: result.runtimeSync, runtimeError: result.runtimeError }
      : { state: 'persistence-failed' })
  }

  return (
    <div
      className="divide-y divide-border border-y border-border"
      role="region"
      aria-label={t('settings.integrations.tab.overview')}
    >
      <section className="py-5">
        <div className="grid overflow-hidden rounded-md border border-border sm:grid-cols-2 sm:divide-x sm:divide-border">
          <button
            type="button"
            className="group flex min-w-0 items-center justify-between gap-4 px-3 py-3 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-accent/40 focus-visible:focus-ring"
            onClick={() => onTab('packages')}
          >
            <span className="truncate text-caption font-medium text-foreground">
              {t('settings.integrations.overview.packages')}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 tabular-nums text-title text-foreground">
              {snapshot?.packages.length ?? 0}
              <TbChevronRight
                className="size-3.5 text-muted-foreground transition-transform duration-(--duration-fast) group-hover:translate-x-0.5"
                aria-hidden
              />
            </span>
          </button>
          <button
            type="button"
            className="group flex min-w-0 items-center justify-between gap-4 border-t border-border px-3 py-3 text-left outline-none transition-colors duration-(--duration-fast) hover:bg-accent/40 focus-visible:focus-ring sm:border-t-0"
            onClick={() => onTab('resources')}
          >
            <span className="truncate text-caption font-medium text-foreground">
              {t('settings.integrations.overview.resources')}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 tabular-nums text-title text-foreground">
              {totalResolvedResources}
              <TbChevronRight
                className="size-3.5 text-muted-foreground transition-transform duration-(--duration-fast) group-hover:translate-x-0.5"
                aria-hidden
              />
            </span>
          </button>
        </div>

        {(visibleResourceKinds.length > 0 || totals.theme > 0) && (
          <div className="mt-3 px-1">
            {visibleResourceKinds.length > 0 && (
              <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-caption">
                {visibleResourceKinds.map((kind) => (
                  <div key={kind} className="flex items-baseline gap-1.5">
                    <dt className="order-2 text-muted-foreground">
                      {t(`settings.integrations.resource.${kind}`)}
                    </dt>
                    <dd className="order-1 font-medium tabular-nums text-foreground">
                      {totals[kind]}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {totals.theme > 0 && (
              <p className="mt-2 border-t border-border/70 pt-2 text-micro text-muted-foreground">
                <span className="font-medium tabular-nums text-foreground">
                  {totals.theme} {t('settings.integrations.resource.theme')}
                </span>
                {' · '}
                {t('settings.integrations.resources.themeBoundary')}
              </p>
            )}
          </div>
        )}
      </section>

      <section
        className="py-5"
        role="region"
        aria-labelledby="pi-runtime-support-title"
      >
        <h3 id="pi-runtime-support-title" className="text-title">
          {t('settings.integrations.runtimeSupport.title')}
        </h3>
        {runtimeProblems.length === 0 ? (
          <p className="mt-1 text-caption text-muted-foreground">
            {t('settings.integrations.runtimeSupport.ok')}
          </p>
        ) : (
          <>
            <p className="mt-1 text-caption text-muted-foreground">
              {t('settings.integrations.runtimeSupport.problems', { count: runtimeProblems.length })}
            </p>
            <ul className="mt-3 space-y-1.5 border-y border-border py-2.5 text-micro text-muted-foreground">
              {runtimeProblems.map((message, index) => (
                <li key={`${message}-${index}`} className="break-words">
                  {message}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {retry && (
        <section className="py-5" aria-labelledby="pi-retry-settings-title">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.48fr)]">
            <div className="min-w-0">
              <h3 id="pi-retry-settings-title" className="text-title">
                {t('settings.integrations.retry.title')}
              </h3>
              <p className="mt-1 text-caption text-muted-foreground">
                {t('settings.integrations.retry.globalDesc')}
              </p>
              <label className="mt-4 flex max-w-xl items-center justify-between gap-4 border-y border-border py-3">
                <span className="min-w-0">
                  <span className="block text-caption font-medium">
                    {t('settings.integrations.retry.globalLabel')}
                  </span>
                  <span className="mt-0.5 block text-micro text-muted-foreground">
                    {retry.globalEnabled
                      ? t('settings.integrations.retry.enabled')
                      : t('settings.integrations.retry.disabled')}
                  </span>
                </span>
                <Switch
                  checked={retry.globalEnabled}
                  disabled={integrations.status === 'operating'}
                  aria-label={t('settings.integrations.retry.globalLabel')}
                  onCheckedChange={(checked) => void changeGlobalRetry(checked)}
                />
              </label>
              {retrySave?.state === 'synchronized' && (
                <p className="mt-3 text-caption text-success" role="status">
                  {t('settings.integrations.retry.synchronized')}
                </p>
              )}
              {retrySave?.state === 'persisted-only' && (
                <div className="mt-3 text-caption text-warning" role="status">
                  <p>{t('settings.integrations.retry.persistedOnly')}</p>
                  {retrySave.runtimeError && <p className="mt-1 break-words text-micro">{retrySave.runtimeError}</p>}
                </div>
              )}
              {retrySave?.state === 'persistence-failed' && (
                <p className="mt-3 text-caption text-destructive" role="alert">
                  {t('settings.integrations.retry.persistenceFailed')}
                </p>
              )}
            </div>
            <div className="min-w-0 border-l border-border pl-4">
              <h4 className="text-caption font-medium">
                {t('settings.integrations.retry.effectiveTitle', {
                  scope: t(`settings.integrations.scope.${integrations.scope.kind}`),
                })}
              </h4>
              <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-5 gap-y-2 text-caption">
                <dt className="text-muted-foreground">{t('settings.integrations.retry.state')}</dt>
                <dd>{retry.effective.enabled
                  ? t('settings.integrations.retry.enabled')
                  : t('settings.integrations.retry.disabled')}</dd>
                <dt className="text-muted-foreground">{t('settings.integrations.retry.maxRetries')}</dt>
                <dd>{retry.effective.maxRetries}</dd>
                <dt className="text-muted-foreground">{t('settings.integrations.retry.baseDelay')}</dt>
                <dd>{t('settings.integrations.retry.milliseconds', { value: retry.effective.baseDelayMs })}</dd>
              </dl>
              {retry.globalEnabled !== retry.effective.enabled && (
                <p className="mt-3 text-micro text-muted-foreground">
                  {t('settings.integrations.retry.overrideNotice')}
                </p>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

export function IntegrationsSettings({ tab, onTab }: IntegrationsSettingsProps) {
  const t = useT()
  const integrations = usePiIntegrations()
  const workspace = useWorkspaceStore()
  const [mcpDirty, setMcpDirty] = React.useState(false)
  const [addOpen, setAddOpen] = React.useState(false)
  const [packageSource, setPackageSource] = React.useState('')
  const projectScope = workspace.activeScope.kind === 'project'
    ? { kind: 'project' as const, workspaceId: workspace.activeScope.workspaceId }
    : null
  const snapshot = integrations.snapshot
  const busy = integrations.status === 'operating'

  const changeScope = (kind: 'global' | 'project') => {
    if (kind === integrations.scope.kind || (kind === 'project' && !projectScope)) return
    if (mcpDirty && !window.confirm(t('settings.mcp.discardConfirm'))) return
    integrations.setScope(kind === 'global' ? { kind: 'global' } : projectScope!)
  }

  return (
    <div className="min-w-0 px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3 border-b border-border pb-4">
        <div className="flex min-w-0 flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-title">{t('settings.integrations.title')}</h2>
            <p className={cn(
              'mt-1 text-micro text-muted-foreground',
              tab === 'external-control'
                ? 'max-w-2xl'
                : 'break-all font-mono',
            )}>
              {tab === 'external-control'
                ? t('settings.externalControl.localOnly')
                : snapshot?.executable
                ? `Pi ${snapshot.executable.version} · ${snapshot.executable.path}`
                : t('settings.integrations.executableUnavailable')}
            </p>
          </div>
          {tab !== 'external-control' ? <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md bg-muted p-0.5" role="group" aria-label={t('settings.integrations.scope')}>
              {(['global', 'project'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  disabled={kind === 'project' && !projectScope}
                  aria-pressed={integrations.scope.kind === kind}
                  className="h-7 rounded px-2.5 text-caption text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-background aria-pressed:text-foreground"
                  onClick={() => changeScope(kind)}
                >
                  {t(`settings.integrations.scope.${kind}`)}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" disabled={snapshot?.state !== 'ready' || busy} onClick={() => setAddOpen(true)}>
              <TbPlus aria-hidden />
              {t('settings.integrations.addPackage')}
            </Button>
          </div> : null}
        </div>

        {tab !== 'external-control' && snapshot?.restartRequired && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2" role="status">
            <span className="text-caption text-foreground">{t('settings.integrations.restartRequired')}</span>
            <Button size="sm" disabled={busy} onClick={() => void integrations.restart()}>
              <TbRefresh className={busy ? 'animate-spin' : ''} aria-hidden />
              {t('settings.integrations.restart')}
            </Button>
          </div>
        )}

        {tab !== 'external-control' && integrations.operation && ['queued', 'running', 'progress'].includes(integrations.operation.phase) && (
          <p className="text-caption text-muted-foreground" role="status">
            {integrations.operation.progress?.message ?? t(`settings.integrations.operation.${integrations.operation.kind}`)}
          </p>
        )}
        {tab !== 'external-control' && integrations.errorMessage && (
          <div className="flex items-center justify-between gap-3 text-caption text-destructive" role="alert">
            <span>{integrations.errorMessage}</span>
            <Button variant="ghost" size="sm" onClick={() => void integrations.refresh()}>{t('common.retry')}</Button>
          </div>
        )}
      </header>

      <div className="scroll-slim mt-3 overflow-x-auto">
        <div className="flex min-w-max gap-1" role="tablist" aria-label={t('settings.integrations.title')}>
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className="h-8 rounded-md px-2 text-caption text-muted-foreground outline-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 aria-selected:bg-accent aria-selected:font-medium aria-selected:text-accent-foreground"
              onClick={() => onTab(id)}
            >
              {t(`settings.integrations.tab.${id}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {tab !== 'mcp' && tab !== 'external-control' && integrations.status === 'checking' && (
          <EmptyState>{t('settings.integrations.loading')}</EmptyState>
        )}
        {tab !== 'mcp' && tab !== 'external-control' && snapshot?.state === 'unavailable' && (
          <div className="rounded-md border border-border px-4 py-5">
            <div className="flex items-start gap-3">
              <TbServer className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
              <div>
                <h3 className="text-title">{t('settings.integrations.unavailable')}</h3>
                <p className="mt-1 text-caption text-muted-foreground">{t('settings.integrations.unavailableDesc')}</p>
                {snapshot.diagnostics.map((diagnostic) => (
                  <p key={`${diagnostic.code}:${diagnostic.source ?? ''}`} className="mt-2 text-micro text-muted-foreground">
                    {diagnostic.message}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}
        {tab === 'overview' && snapshot?.state === 'ready' && <Overview onTab={onTab} />}
        {tab === 'packages' && snapshot?.state === 'ready' && <PackagesView />}
        {tab === 'resources' && snapshot?.state === 'ready' && <ResourcesView />}
        <div hidden={tab !== 'mcp'}>
          <McpSettings scope={integrations.scope} onDirtyChange={setMcpDirty} />
        </div>
        {tab === 'external-control' && <ExternalControlView />}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.integrations.addPackage')}</DialogTitle>
            <DialogDescription>{t('settings.integrations.addPackageDesc')}</DialogDescription>
          </DialogHeader>
          <label>
            <span className="mb-1 block text-caption text-muted-foreground">{t('settings.integrations.package.source')}</span>
            <Input
              autoFocus
              value={packageSource}
              maxLength={2048}
              placeholder={t('settings.integrations.addPackagePlaceholder')}
              onChange={(event) => setPackageSource(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || !packageSource.trim() || busy) return
                void integrations.install(packageSource.trim())
                setPackageSource('')
                setAddOpen(false)
              }}
            />
          </label>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">{t('common.cancel')}</Button></DialogClose>
            <Button
              disabled={!packageSource.trim() || busy}
              onClick={() => {
                void integrations.install(packageSource.trim())
                setPackageSource('')
                setAddOpen(false)
              }}
            >
              <TbPackage aria-hidden />
              {t('settings.integrations.install')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
