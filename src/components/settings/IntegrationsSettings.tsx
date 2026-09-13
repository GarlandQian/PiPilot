import * as React from 'react'
import { TbCheck, TbDownload, TbPackage, TbPlus, TbRefresh, TbServer } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { usePiIntegrations } from '@/store/pi-integrations'
import { useWorkspaceStore } from '@/store/workspace'
import { McpSettings } from './McpSettings'
import { EmptyState } from './integrations/CatalogPrimitives'
import { ExternalControlView } from './integrations/ExternalControlView'
import { Overview } from './integrations/Overview'
import { PackagesView } from './integrations/PackagesView'
import { ResourcesView } from './integrations/ResourcesView'
import { piIntegrationScopeKey, type PiResourceKind } from '@/shared/pi-integrations'

export { serializeExternalControlConfiguration } from './integrations/ExternalControlView'

export type IntegrationsTabId =
  | 'overview'
  | 'packages'
  | 'resources'
  | 'mcp'
  | 'external-control'

export interface IntegrationsSettingsProps {
  active?: boolean
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
export function IntegrationsSettings({ tab, onTab, active = true }: IntegrationsSettingsProps) {
  const t = useT()
  const integrations = usePiIntegrations()
  const workspace = useWorkspaceStore()
  const [addOpen, setAddOpen] = React.useState(false)
  const [packageSource, setPackageSource] = React.useState('')
  const pendingInstall = React.useRef<{ scopeKey: string; source: string } | null>(null)
  const [resourceFocus, setResourceFocus] = React.useState<{ packageId: string; kind?: PiResourceKind } | null>(null)
  const projectScope = workspace.activeScope.kind === 'project'
    ? { kind: 'project' as const, workspaceId: workspace.activeScope.workspaceId }
    : null
  const snapshot = integrations.snapshot
  const busy = integrations.status === 'operating'
  const loading = integrations.status === 'checking' || integrations.status === 'loading'
  const selectedScope = integrations.scope
  const scopeKey = piIntegrationScopeKey(selectedScope)
  const projectName = selectedScope.kind === 'project'
    ? workspace.recentProjects.find((project) => project.id === selectedScope.workspaceId)?.name
    : null

  React.useEffect(() => {
    setAddOpen(false)
    setResourceFocus(null)
  }, [scopeKey])
  React.useEffect(() => { if (!active) setAddOpen(false) }, [active])
  React.useEffect(() => {
    const pending = pendingInstall.current
    if (!pending || pending.scopeKey !== scopeKey || integrations.operation?.kind !== 'install' ||
      integrations.operation.phase !== 'succeeded' || integrations.operation.source !== pending.source) return
    setPackageSource((value) => value.trim() === pending.source ? '' : value)
    pendingInstall.current = null
  }, [integrations.operation, scopeKey])

  const installPackage = () => {
    const source = packageSource.trim()
    if (!source || busy || snapshot?.state !== 'ready') return
    pendingInstall.current = { scopeKey, source }
    void integrations.install(source)
    setAddOpen(false)
  }

  const openPackageResources = (packageId: string, kind?: PiResourceKind) => {
    setResourceFocus({ packageId, kind })
    onTab('resources')
  }

  const changeScope = (kind: 'global' | 'project') => {
    if (kind === integrations.scope.kind || (kind === 'project' && !projectScope)) return
    integrations.setScope(kind === 'global' ? { kind: 'global' } : projectScope!)
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => { if (TABS.some((id) => id === value)) onTab(value as IntegrationsTabId) }}
      className="@container/integrations min-w-0 gap-0"
    >
      <TabsList variant="line" className="scroll-slim mb-5 h-11 w-full max-w-full justify-start gap-1 overflow-x-auto overflow-y-hidden border-b border-border p-0" aria-label={t('settings.integrations.title')}>
        {TABS.map((id) => (
          <TabsTrigger key={id} value={id} className="h-full flex-none px-3 text-caption after:bottom-0 after:bg-primary">
            {t(`settings.integrations.tab.${id}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      <header className="flex flex-col gap-3 pb-5" data-integrations-toolbar>
        <div className="flex min-w-0 flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p
              className={cn(
              'text-caption text-muted-foreground',
              tab === 'external-control'
                ? 'max-w-2xl'
                : 'truncate font-mono',
            )}>
              {tab === 'external-control'
                ? t('settings.externalControl.localOnly')
                : snapshot?.executable
                ? `Pi ${snapshot.executable.version}`
                : t(loading ? 'settings.integrations.loading' : 'settings.integrations.executableUnavailable')}
            </p>
            {tab !== 'external-control' && projectName ? <p className="mt-1 truncate text-caption text-foreground" title={projectName}>{projectName}</p> : null}
          </div>
          {tab !== 'external-control' ? <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg bg-muted/60 p-1" role="group" aria-label={t('settings.integrations.scope')}>
              {(['global', 'project'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  disabled={kind === 'project' && !projectScope}
                  aria-pressed={integrations.scope.kind === kind}
                  className="h-8 rounded-md px-3 text-caption text-muted-foreground outline-none hover:text-foreground focus-visible:focus-ring disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
                  onClick={() => changeScope(kind)}
                >
                  {t(`settings.integrations.scope.${kind}`)}
                </button>
              ))}
            </div>
            {tab !== 'mcp' ? <Button variant="ghost" size="icon-sm" aria-label={t('common.refresh')} title={t('common.refresh')} disabled={busy || loading} onClick={() => void integrations.refresh()}><TbRefresh className={loading ? 'animate-spin' : undefined} aria-hidden /></Button> : null}
            {tab === 'packages' ? <Button variant="outline" size="sm" disabled={snapshot?.state !== 'ready' || busy || loading} onClick={() => void integrations.checkUpdates()}>
              <TbDownload aria-hidden />{t('settings.integrations.checkUpdates')}
            </Button> : null}
            {tab !== 'mcp' ? <Button size="sm" disabled={snapshot?.state !== 'ready' || busy || loading} onClick={() => setAddOpen(true)}>
              <TbPlus aria-hidden />
              {t('settings.integrations.addPackage')}
            </Button> : null}
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

        {tab !== 'external-control' && integrations.operation ? (
          ['queued', 'running', 'progress'].includes(integrations.operation.phase) ? (
            <p className="text-caption text-muted-foreground" role="status">
              {integrations.operation.progress?.message ?? t(`settings.integrations.operation.${integrations.operation.kind}`)}
            </p>
          ) : integrations.operation.phase === 'succeeded' ? (
            <p className="flex items-center gap-1.5 text-caption text-success" role="status">
              <TbCheck aria-hidden />
              {t(`settings.integrations.operation.success.${integrations.operation.kind}`)}
            </p>
          ) : null
        ) : null}
        {tab !== 'external-control' && integrations.errorMessage && (
          <div className="flex items-center justify-between gap-3 text-caption text-destructive" role="alert">
            <span>{integrations.errorMessage}</span>
            <Button variant="ghost" size="sm" onClick={() => void integrations.refresh()}>{t('common.retry')}</Button>
          </div>
        )}
      </header>

      {(['overview', 'packages', 'resources'] as const).map((id) => (
        <TabsContent key={id} value={id} forceMount hidden={tab !== id} className="min-w-0">
        {(integrations.status === 'checking' || integrations.status === 'loading') && !snapshot && (
          <EmptyState>{t('settings.integrations.loading')}</EmptyState>
        )}
        {snapshot?.state === 'unavailable' && (
          <div className="border-y border-border px-2 py-5">
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
        {id === 'overview' && snapshot?.state === 'ready' && <Overview key={scopeKey} onTab={onTab} />}
        {id === 'packages' && snapshot?.state === 'ready' && <PackagesView key={scopeKey} active={active && tab === 'packages'} onOpenResources={openPackageResources} />}
        {id === 'resources' && snapshot?.state === 'ready' && <ResourcesView key={scopeKey} focus={resourceFocus} onClearFocus={() => setResourceFocus(null)} />}
        </TabsContent>
      ))}
      <TabsContent value="mcp" forceMount hidden={tab !== 'mcp'} className="min-w-0">
        <McpSettings scope={integrations.scope} active={active && tab === 'mcp'} />
      </TabsContent>
      <TabsContent value="external-control" className="min-w-0"><ExternalControlView active={active && tab === 'external-control'} /></TabsContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.integrations.addPackage')}</DialogTitle>
            <DialogDescription>{t('settings.integrations.addPackageDesc')}</DialogDescription>
          </DialogHeader>
          <p className="rounded-md bg-muted/60 px-3 py-2 text-caption text-muted-foreground">
            {t('settings.integrations.installTarget', { scope: projectName || t(`settings.integrations.scope.${selectedScope.kind}`) })}
          </p>
          <label>
            <span className="mb-1 block text-caption text-muted-foreground">{t('settings.integrations.package.source')}</span>
            <Input
              autoFocus
              value={packageSource}
              maxLength={2048}
              placeholder={t('settings.integrations.addPackagePlaceholder')}
              onChange={(event) => setPackageSource(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                event.preventDefault()
                installPackage()
              }}
            />
          </label>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">{t('common.cancel')}</Button></DialogClose>
            <Button
              disabled={!packageSource.trim() || busy}
              onClick={installPackage}
            >
              <TbPackage aria-hidden />
              {t('settings.integrations.install')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  )
}
