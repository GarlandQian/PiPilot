import * as React from 'react'
import { TbCopy, TbDots, TbDownload, TbLoader2, TbPackage, TbPlus, TbRefresh, TbSearch, TbTrash } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useT, type MessageKey } from '@/i18n'
import type { PiPackageSummary, PiResourceKind } from '@/shared/pi-integrations'
import { usePiIntegrations, type PiPackageTarget } from '@/store/pi-integrations'
import { useWorkspaceStore } from '@/store/workspace'
import { FormActions, SettingsBadge, SettingsField, SettingsGroup, SettingsIdentity, SettingsLinkRow, SettingsListRow, SettingsPage, SettingsRow, SettingsSheet, StatusText } from '../kit'
import { useSettingsNavigate, useSettingsSubpage } from '../settings-subpage'
import { filterIntegrationPackages } from './catalog-model'
import { IntegrationNotices, IntegrationsUnavailable, useRefreshWhenShown } from './integration-notices'
import { requestResourceFocus } from './resource-focus'

const RESOURCE_KINDS: readonly PiResourceKind[] = ['extension', 'skill', 'prompt', 'theme']

export function PackageIcon({ size = 'row' }: { size?: 'row' | 'lg' }) {
  return <span aria-hidden className={size === 'lg'
    ? 'flex size-12 shrink-0 items-center justify-center rounded-[13px] bg-[#34c759] bg-[linear-gradient(to_bottom,rgb(255_255_255/0.2),transparent)] text-white shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08)]'
    : 'flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-[#34c759] bg-[linear-gradient(to_bottom,rgb(255_255_255/0.2),transparent)] text-white shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08)]'}>
    <TbPackage className="size-[58%]" />
  </span>
}

const total = (pkg: PiPackageSummary) => RESOURCE_KINDS.reduce((sum, kind) => sum + pkg.resourceCounts[kind], 0)

interface Entry {
  pkg: PiPackageSummary
  target: PiPackageTarget
  /** A global package the project's own copy replaces. */
  overridden: boolean
}

export function PackagesSettings({ active = true }: { active?: boolean }) {
  const t = useT()
  const integrations = usePiIntegrations()
  const workspace = useWorkspaceStore()
  const navigate = useSettingsNavigate()
  const project = integrations.scope.kind === 'project' ? integrations.scope : null
  const projectName = project ? workspace.recentProjects.find((candidate) => candidate.id === project.workspaceId)?.name ?? null : null
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState<{ id: string; target: PiPackageTarget } | null>(null)
  const [addOpen, setAddOpen] = React.useState(false)
  const [removing, setRemoving] = React.useState<Entry | null>(null)
  useRefreshWhenShown(active)
  const busy = integrations.status === 'operating' || integrations.status === 'loading' || integrations.status === 'checking'
  const ready = integrations.snapshot?.state === 'ready'

  // The project's own packages first, then the global ones; a global one with the same source is overridden.
  const entries = React.useMemo<Entry[]>(() => {
    const own = project ? (integrations.snapshot?.packages ?? []) : []
    const global = (project ? integrations.globalSnapshot : integrations.snapshot)?.packages ?? []
    const projectSources = new Set(own.map((pkg) => pkg.source))
    return [
      ...own.map((pkg) => ({ pkg, target: 'project' as const, overridden: false })),
      ...global.map((pkg) => ({ pkg, target: 'global' as const, overridden: projectSources.has(pkg.source) })),
    ]
  }, [integrations.globalSnapshot, integrations.snapshot, project])
  const matching = new Set(filterIntegrationPackages(entries.map(({ pkg }) => pkg), query))
  const visible = entries.filter(({ pkg }) => matching.has(pkg))
  const detail = selected ? entries.find((entry) => entry.pkg.id === selected.id && entry.target === selected.target) ?? null : null
  React.useEffect(() => { if (selected && !detail) setSelected(null) }, [detail, selected])
  React.useEffect(() => { if (!active) { setAddOpen(false); setRemoving(null) } }, [active])
  const defaults = (project ? integrations.globalSnapshot : integrations.snapshot)?.defaultPackages ?? []
  useSettingsSubpage('packages', detail ? { title: detail.pkg.displayName, back: () => setSelected(null) } : null)

  const openResources = (pkg: PiPackageSummary, kind?: PiResourceKind) => {
    requestResourceFocus({ packageId: pkg.id, packageName: pkg.displayName, kind })
    navigate('resources')
  }

  const menu = (entry: Entry) => <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="text-muted-foreground" disabled={busy} aria-label={t('settings.packages.actions', { name: entry.pkg.displayName })}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem disabled={entry.pkg.pinned} onSelect={() => void integrations.update(entry.pkg.source, entry.target)}><TbDownload aria-hidden />{t(entry.pkg.pinned ? 'settings.integrations.package.pinned' : 'settings.integrations.update')}</DropdownMenuItem>
      <DropdownMenuItem disabled={total(entry.pkg) === 0} onSelect={() => openResources(entry.pkg)}><TbPackage aria-hidden />{t('settings.integrations.package.viewResources')}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(entry.pkg.source)}><TbCopy aria-hidden />{t('settings.packages.copySource')}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(entry)}><TbTrash aria-hidden />{t('settings.integrations.remove')}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>

  const body = detail ? <PackageDetail entry={detail} busy={busy} projectName={projectName}
    onUpdate={() => void integrations.update(detail.pkg.source, detail.target)}
    onRemove={() => setRemoving(detail)} onOpenResources={(kind) => openResources(detail.pkg, kind)} /> : <SettingsPage>
    <IntegrationNotices />
    <IntegrationsUnavailable />
    {ready ? <>
      <SettingsGroup title={t('settings.packages.installed')} info={t('settings.integrations.packages.description')} boxRole={visible.length ? 'list' : undefined}
        actions={<>
          {entries.length > 6 ? <div className="relative w-44">
            <TbSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('settings.packages.search')} aria-label={t('settings.packages.search')}
              className="h-6 rounded-full bg-fill pl-7.5 text-caption shadow-none" />
          </div> : null}
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setAddOpen(true)}><TbPlus aria-hidden />{t('settings.packages.add')}</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('settings.models.cards.more')}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={busy} onSelect={() => void integrations.checkUpdates()}><TbDownload aria-hidden />{t('settings.integrations.checkUpdates')}</DropdownMenuItem>
              <DropdownMenuItem disabled={busy} onSelect={() => void integrations.refresh()}><TbRefresh aria-hidden />{t('common.refresh')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>}
        footer={project && projectName ? t('settings.packages.mergedFooter', { project: projectName }) : undefined}>
        {visible.length === 0 ? <div data-settings-row className="px-3 py-8 text-center text-caption text-muted-foreground">
          {t(entries.length ? 'settings.integrations.packages.empty' : 'settings.packages.none')}
        </div> : visible.map((entry) => <SettingsListRow key={`${entry.target}:${entry.pkg.id}`} data-integration-row={entry.pkg.id} data-package-scope={entry.target}
          icon={<PackageIcon />} title={entry.pkg.displayName} dimmed={entry.overridden}
          badges={<>
            {entry.target === 'project' ? <SettingsBadge tone="accent">{t('settings.packages.project')}</SettingsBadge> : null}
            {entry.pkg.updateAvailable ? <SettingsBadge tone="warning">{t('settings.integrations.package.updateAvailable')}</SettingsBadge> : null}
          </>}
          subtitle={entry.overridden ? t('settings.packages.overridden') : [entry.pkg.installedVersion ? `v${entry.pkg.installedVersion}` : entry.pkg.sourceType, t('settings.integrations.resourceCount', { count: total(entry.pkg) })].join(' · ')}
          onOpen={() => setSelected({ id: entry.pkg.id, target: entry.target })} openLabel={entry.pkg.displayName} menu={menu(entry)} />)}
      </SettingsGroup>
      {defaults.length ? <SettingsGroup title={t('settings.integrations.defaults.title')} info={t('settings.integrations.defaults.description')} boxRole="list">
        {defaults.map((pkg) => <SettingsRow key={pkg.packageName} role="listitem" label={<span className="break-all">{pkg.packageName}</span>}
          icon={<PackageIcon />} style={{ '--settings-row-inset': '54px' } as React.CSSProperties}
          description={<>
            <StatusText tone={pkg.status === 'failed' ? 'danger' : pkg.status === 'installed' || pkg.status === 'existing' ? 'success' : 'neutral'}
              icon={pkg.status === 'installing' ? <TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : undefined}>
              {t(`settings.integrations.defaults.${pkg.status}` as MessageKey)}
            </StatusText>
            {pkg.status === 'failed' && pkg.message ? <span className="block break-words text-destructive" role="alert">{pkg.message}</span> : null}
          </>}>
          {(['pending', 'failed', 'removed'] as const).some((status) => status === pkg.status) ? <Button size="sm" variant="outline" disabled={busy}
            aria-label={`${t(pkg.status === 'failed' ? 'common.retry' : 'settings.integrations.install')} ${pkg.packageName}`}
            onClick={() => void integrations.install(pkg.source, 'global')}>{t(pkg.status === 'failed' ? 'common.retry' : 'settings.integrations.install')}</Button> : null}
        </SettingsRow>)}
      </SettingsGroup> : null}
    </> : null}
  </SettingsPage>

  return <div className="min-w-0" data-packages-settings data-integration-catalog="packages">
    {body}
    <AddPackageSheet open={addOpen} onOpenChange={setAddOpen} projectName={project ? projectName ?? t('settings.integrations.scope.project') : null}
      busy={busy} onInstall={async (source, target) => { setAddOpen(false); await integrations.install(source, target) }} />
    <AlertDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('settings.integrations.removeTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('settings.packages.removeConfirm', { name: removing?.pkg.displayName ?? '', scope: t(removing?.target === 'project' ? 'settings.packages.project' : 'settings.integrations.scope.global') })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={() => {
            const entry = removing
            setRemoving(null)
            setSelected(null)
            if (entry) void integrations.remove(entry.pkg.source, entry.target)
          }}>{t('settings.integrations.remove')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
}

function PackageDetail({ entry, busy, projectName, onUpdate, onRemove, onOpenResources }: {
  entry: Entry
  busy: boolean
  projectName: string | null
  onUpdate(): void
  onRemove(): void
  onOpenResources(kind?: PiResourceKind): void
}) {
  const t = useT()
  const pkg = entry.pkg
  return <SettingsPage data-package-detail={pkg.id}>
    <SettingsIdentity icon={<PackageIcon size="lg" />} title={pkg.displayName}
      subtitle={<span className="break-all font-mono">{pkg.source}</span>}
      actions={<Button variant="outline" size="sm" disabled={busy || pkg.pinned} onClick={onUpdate}><TbDownload aria-hidden />{t(pkg.pinned ? 'settings.integrations.package.pinned' : 'settings.integrations.update')}</Button>}>
      {pkg.updateAvailable ? <div className="mt-1"><SettingsBadge tone="warning">{t('settings.integrations.package.updateAvailable')}</SettingsBadge></div> : null}
    </SettingsIdentity>
    <SettingsGroup title={t('settings.packages.details')}>
      <SettingsRow label={t('settings.integrations.package.scope')}>
        <span className="text-app text-muted-foreground">{entry.target === 'project' ? projectName ?? t('settings.integrations.scope.project') : t('settings.integrations.scope.global')}</span>
      </SettingsRow>
      <SettingsRow label={t('settings.integrations.package.version')}><span className="font-mono text-caption text-muted-foreground">{pkg.installedVersion ?? t('settings.integrations.unknown')}</span></SettingsRow>
      <SettingsField label={t('settings.integrations.package.path')}><p className="break-all py-1 font-mono text-caption text-muted-foreground">{pkg.installedPath ?? t('settings.integrations.unknown')}</p></SettingsField>
      <SettingsRow label={t('settings.integrations.compatibility.title')} info={t(`settings.integrations.compatibility.${pkg.compatibility}.desc` as MessageKey)}>
        <span className="text-app text-muted-foreground">{t(`settings.integrations.compatibility.${pkg.compatibility}` as MessageKey)}</span>
      </SettingsRow>
    </SettingsGroup>
    <SettingsGroup title={t('settings.integrations.package.resources')}>
      {RESOURCE_KINDS.map((kind) => <SettingsLinkRow key={kind} label={t(`settings.integrations.resource.${kind}` as MessageKey)} value={String(pkg.resourceCounts[kind])}
        disabled={pkg.resourceCounts[kind] === 0} onClick={() => onOpenResources(kind)} />)}
    </SettingsGroup>
    <div className="flex justify-end" data-settings-actions>
      <Button variant="outline" className="text-destructive" disabled={busy} onClick={onRemove}><TbTrash aria-hidden />{t('settings.packages.remove')}</Button>
    </div>
  </SettingsPage>
}

function AddPackageSheet({ open, onOpenChange, projectName, busy, onInstall }: {
  open: boolean
  onOpenChange(open: boolean): void
  /** The open project, or null when only Global is possible. */
  projectName: string | null
  busy: boolean
  onInstall(source: string, target: PiPackageTarget): Promise<void>
}) {
  const t = useT()
  const [source, setSource] = React.useState('')
  const [target, setTarget] = React.useState<PiPackageTarget>('global')
  React.useEffect(() => { if (open) { setSource(''); setTarget(projectName ? 'project' : 'global') } }, [open, projectName])
  const submit = () => { if (source.trim()) void onInstall(source.trim(), target) }
  return <SettingsSheet open={open} onOpenChange={onOpenChange} title={t('settings.integrations.addPackage')} description={t('settings.integrations.addPackageDesc')} data-add-package-sheet
    footer={<FormActions onCancel={() => onOpenChange(false)} onSave={submit} canSave={Boolean(source.trim()) && !busy} saveLabel={t('settings.integrations.install')} />}>
    <SettingsGroup>
      <SettingsField label={t('settings.integrations.package.source')} htmlFor="add-package-source">
        <Input id="add-package-source" value={source} autoFocus spellCheck={false} autoComplete="off" className="font-mono" placeholder={t('settings.integrations.addPackagePlaceholder')}
          onChange={(event) => setSource(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit() } }} />
      </SettingsField>
      {projectName ? <SettingsRow label={t('settings.packages.installInto')} htmlFor="add-package-target">
        <select id="add-package-target" className="mac-select" value={target} onChange={(event) => setTarget(event.target.value === 'project' ? 'project' : 'global')}>
          <option value="global">{t('settings.integrations.scope.global')}</option>
          <option value="project">{projectName}</option>
        </select>
      </SettingsRow> : null}
    </SettingsGroup>
  </SettingsSheet>
}
