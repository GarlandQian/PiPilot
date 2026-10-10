import * as React from 'react'
import { TbActivity, TbCopy, TbDots, TbFileCode, TbFileImport, TbLoader2, TbPlus, TbRefresh } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useLocale, useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { ConfigurationDocument } from '@/renderer/configuration-documents'
import { MCP_CONFIG_CONTENT_LIMIT, type McpConfigSnapshot } from '@/shared/mcp-config'
import { convertMcpConfigToNativeJson, parseMcpConfigDocument } from '@/shared/mcp-config-parser'
import { templateForServer, type McpTemplate } from '@/shared/mcp-templates'
import { localizedText } from '@/shared/model-provider-presets'
import type { PiIntegrationScope } from '@/shared/pi-integrations'
import { useMcpConfigurationDocuments } from '@/store/configuration-documents'
import { useWorkspaceStore } from '@/store/workspace'
import { ConfigApplyNotice } from './ConfigApplyNotice'
import { ConfigFileEditor } from './ConfigFileEditor'
import { ConfigurationDocumentError, ConfigurationDocumentUnavailable, ConfigurationReloadConfirmation } from './ConfigurationDocumentFeedback'
import { DiscardChangesDialog } from './editor-page'
import { SettingsPage } from './kit'
import { McpAddSheet, type McpScope } from './mcp/McpAddPage'
import { McpImportSheet } from './mcp/McpImportPage'
import { McpServerEditor, type McpEditorTarget } from './mcp/McpServerEditor'
import { mcpEntryKey, McpServerList, McpServersEmpty, type McpListEntry } from './mcp/McpServerList'
import { uniqueMcpName, withTransport, type McpTransport } from './mcp/mcp-editor-model'
import { useMcpManager, type McpManager } from './mcp/useMcpManager'
import { RuntimeProblemsBanner } from './packages/integration-notices'
import { useSettingsNavigate, useSettingsSubpage } from './settings-subpage'

type Route =
  | { page: 'list' }
  | { page: 'edit'; scope: McpScope; target: McpEditorTarget; nonce: number }
  | { page: 'file'; scope: McpScope; nonce: number }

/** Stands in for the project's mcp.json while no project is open; never loaded. */
const NO_PROJECT = new ConfigurationDocument<McpConfigSnapshot>({ load: () => new Promise(() => undefined), save: () => Promise.reject(new Error('No project is open.')) }, MCP_CONFIG_CONTENT_LIMIT)
const NO_PROJECT_SCOPE: PiIntegrationScope = { kind: 'project', workspaceId: '00000000-0000-4000-8000-000000000000' }

export function McpSettings({ active = true }: { active?: boolean }) {
  const [, retry] = React.useReducer((value: number) => value + 1, 0)
  const workspace = useWorkspaceStore()
  const project = workspace.activeScope.kind === 'project' ? { kind: 'project' as const, workspaceId: workspace.activeScope.workspaceId } : null
  const documents = useMcpConfigurationDocuments(project)
  return documents.global ? <McpServersPage key={project?.workspaceId ?? 'global'} active={active} global={documents.global}
    project={documents.project && project ? { document: documents.project, scope: project } : null} />
    : <ConfigurationDocumentUnavailable capacity={documents.available} retry={retry} />
}

let nonce = 0

function McpServersPage({ active, global, project }: {
  active: boolean
  global: ConfigurationDocument<McpConfigSnapshot>
  project: { document: ConfigurationDocument<McpConfigSnapshot>; scope: PiIntegrationScope } | null
}) {
  const t = useT()
  const locale = useLocale()
  const workspace = useWorkspaceStore()
  const navigateSection = useSettingsNavigate()
  const globalManager = useMcpManager(global, { kind: 'global' }, active)
  const projectManager = useMcpManager(project?.document ?? NO_PROJECT, project?.scope ?? NO_PROJECT_SCOPE, active && project !== null)
  const managers: Record<McpScope, McpManager | null> = { global: globalManager, project: project ? projectManager : null }
  const projectName = project && project.scope.kind === 'project'
    ? workspace.recentProjects.find((candidate) => project.scope.kind === 'project' && candidate.id === project.scope.workspaceId)?.name ?? t('settings.integrations.scope.project')
    : null
  const rootRef = React.useRef<HTMLDivElement>(null)
  // The file page lives in its document's view, so it survives like the draft it edits.
  const [route, setRoute] = React.useState<Route>(() => project?.document.getSnapshot().view === 'json' ? { page: 'file', scope: 'project', nonce: ++nonce }
    : global.getSnapshot().view === 'json' ? { page: 'file', scope: 'global', nonce: ++nonce } : { page: 'list' })
  const [pending, setPending] = React.useState<Route | null>(null)
  const pageDirty = React.useRef(false)
  const onDirtyChange = React.useCallback((dirty: boolean) => { pageDirty.current = dirty }, [])
  const [recent, setRecent] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<{ text: string; error?: boolean } | null>(null)
  const [busyKey, setBusyKey] = React.useState<string | null>(null)
  const [removing, setRemoving] = React.useState<McpListEntry | null>(null)
  const [addOpen, setAddOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
  const [converted, setConverted] = React.useState(false)
  const listScroll = React.useRef(0)

  const editable = (manager: McpManager | null) => Boolean(manager && manager.current && !manager.loading && manager.parsed.valid && !manager.saving && !manager.writesBlocked)
  const anyEditable = editable(globalManager) || editable(managers.project)
  const writesBlocked = globalManager.writesBlocked || Boolean(managers.project?.writesBlocked)
  const names: Record<McpScope, string[]> = {
    global: globalManager.parsed.servers.map((server) => server.name),
    project: managers.project?.parsed.servers.map((server) => server.name) ?? [],
  }
  const entries: McpListEntry[] = [
    ...(managers.project?.parsed.servers ?? []).map((server) => ({ server, scope: 'project' as const, overridden: false, locked: !editable(managers.project) })),
    ...globalManager.parsed.servers.map((server) => ({
      server, scope: 'global' as const, locked: !editable(globalManager),
      // A project entry of the same name replaces it, unless that entry only adjusts a few options.
      overridden: Boolean(managers.project?.parsed.servers.some((candidate) => candidate.name === server.name && candidate.transport !== 'override')),
    })),
  ]

  /* -------------------------- navigation -------------------------- */

  const scroller = () => rootRef.current?.closest<HTMLElement>('[data-settings-section]') ?? null
  const show = (next: Route) => {
    const container = scroller()
    if (route.page === 'list' && container) listScroll.current = container.scrollTop
    pageDirty.current = false
    globalManager.setView(next.page === 'file' && next.scope === 'global' ? 'json' : 'form')
    managers.project?.setView(next.page === 'file' && next.scope === 'project' ? 'json' : 'form')
    setRoute(next)
    requestAnimationFrame(() => {
      const target = scroller()
      if (target) target.scrollTop = next.page === 'list' ? listScroll.current : 0
    })
  }
  const navigate = (next: Route) => {
    if (route.page !== 'list' && pageDirty.current) setPending(next)
    else show(next)
  }
  const back = () => navigate({ page: 'list' })
  const title = (() => {
    switch (route.page) {
      case 'list': return null
      case 'file': return route.scope === 'project' ? t('settings.mcp.page.fileTitleProject') : t('settings.mcp.page.fileTitleGlobal')
      case 'edit': return route.target.previousName ?? (route.target.template ? t('settings.mcp.page.addNamed', { name: localizedText(route.target.template.title, locale) }) : t('settings.mcp.page.addTitle'))
    }
  })()
  useSettingsSubpage('mcp', title === null ? null : { title, back })

  React.useEffect(() => {
    if (!recent) return
    const timer = window.setTimeout(() => setRecent(null), 4_000)
    return () => window.clearTimeout(timer)
  }, [recent])
  React.useEffect(() => { if (!active) { setAddOpen(false); setImportOpen(false) } }, [active])

  const done = (key: string | null, message?: string) => {
    show({ page: 'list' })
    setRecent(key)
    setNotice(message ? { text: message } : null)
  }

  const openTemplate = (template: McpTemplate, scope: McpScope) => {
    setAddOpen(false)
    show({ page: 'edit', scope, nonce: ++nonce, target: { previousName: null, name: uniqueMcpName(template.name, names[scope]), definition: structuredClone(template.definition) as Record<string, unknown>, template } })
  }
  const openBlank = (transport: McpTransport, scope: McpScope) => {
    setAddOpen(false)
    show({ page: 'edit', scope, nonce: ++nonce, target: { previousName: null, name: '', definition: withTransport({}, transport, {}).definition } })
  }
  const edit = (entry: McpListEntry) => show({
    page: 'edit', scope: entry.scope, nonce: ++nonce,
    target: { previousName: entry.server.name, name: entry.server.name, definition: structuredClone(entry.server.definition), template: templateForServer(entry.server.definition) },
  })

  const addMany = async (servers: readonly { name: string; definition: Record<string, unknown> }[], scope: McpScope) => {
    const manager = managers[scope]
    if (!manager) return false
    const added = await manager.addServers(servers)
    if (added) {
      setAddOpen(false)
      setImportOpen(false)
      done(servers[0] ? `${scope}:${servers[0].name}` : null, t('settings.mcp.page.added', { count: servers.length }))
    }
    return added
  }

  const toggle = async (entry: McpListEntry, enabled: boolean) => {
    const manager = managers[entry.scope]
    if (!manager) return
    setBusyKey(mcpEntryKey(entry))
    const saved = await manager.setEnabled(entry.server.name, enabled)
    setBusyKey(null)
    setNotice(saved ? null : { text: t('settings.mcp.saveFailed'), error: true })
  }

  const copy = (value: unknown) => {
    void navigator.clipboard.writeText(`${JSON.stringify(value, null, 2)}\n`)
      .then(() => setNotice({ text: t('settings.mcp.page.copied') }))
      .catch(() => setNotice({ text: t('settings.mcp.page.copyFailed'), error: true }))
  }

  const confirmRemove = async () => {
    const entry = removing
    setRemoving(null)
    const manager = entry ? managers[entry.scope] : null
    if (!entry || !manager) return
    const removed = await manager.removeServer(entry.server.name)
    setNotice(removed ? null : { text: t('settings.mcp.saveFailed'), error: true })
  }

  const convertDraft = (scope: McpScope, content: string) => {
    const manager = managers[scope]
    try {
      if (!manager || !manager.updateDraft(convertMcpConfigToNativeJson(content))) return
      setConverted(true)
      show({ page: 'file', scope, nonce: ++nonce })
    } catch {
      setNotice({ text: t('settings.mcp.migration.failed'), error: true })
    }
  }

  /* ---------------------------- pages ----------------------------- */

  const routeManager = route.page === 'list' ? null : managers[route.scope]
  const blockedNotice = writesBlocked ? <div className="space-y-2 rounded-[12px] bg-warning/10 p-3.5 text-caption" role="alert">
    <p>{t('settings.mcp.extensionMigrationBlocked')}</p>
    <Button variant="outline" size="sm" onClick={() => navigateSection('packages')}>{t('settings.mcp.managePackages')}</Button>
  </div> : null

  const page = (() => {
    if (route.page === 'list' || !routeManager) return null
    if (route.page === 'edit') return <McpServerEditor key={route.nonce} manager={routeManager} target={route.target}
      takenNames={names[route.scope].filter((name) => name !== route.target.previousName)} onDone={({ name }) => done(`${route.scope}:${name}`)} onCancel={back} onDirtyChange={onDirtyChange} />
    const manager = routeManager
    return <ConfigFileEditor key={route.nonce} draftText={manager.draftText} savedText={manager.current ? manager.snapshot!.content : null} onChange={manager.updateDraft} path={manager.path ?? undefined}
      description={t('settings.mcp.page.fileDescription')} label="mcp.json" parse={(text) => parseMcpConfigDocument(text, manager.target.kind)} save={manager.saveDraft} onReload={() => void manager.load(true)}
      disabled={manager.writesBlocked} onDone={() => done(null)} onCancel={back} onDirtyChange={onDirtyChange}
      notice={manager.writesBlocked ? blockedNotice : converted && manager.dirty ? <p className="px-2.5 text-caption text-muted-foreground" role="status">{t('settings.mcp.migration.review')}</p> : null} />
  })()

  const fileProblems = (['project', 'global'] as const).flatMap((scope) => {
    const manager = managers[scope]
    if (!manager || !manager.current) return []
    return [{ scope, manager }]
  })

  return <div ref={rootRef} className="min-w-0" data-mcp-settings data-mcp-page={route.page} aria-busy={globalManager.loading || globalManager.saving}>
    {route.page !== 'list' ? page : <SettingsPage>
      <div className="min-w-0 space-y-2 empty:hidden">
        {blockedNotice}
        <RuntimeProblemsBanner />
        {fileProblems.map(({ scope, manager }) => <React.Fragment key={scope}>
          {manager.snapshot?.legacy ? <div className="settings-group space-y-2 p-3.5 text-caption">
            <p>{t(manager.snapshot.exists ? 'settings.mcp.migration.existing' : 'settings.mcp.migration.available')}</p>
            <p className="break-all font-mono text-micro text-muted-foreground">{manager.snapshot.legacy.path}</p>
            {!manager.snapshot.exists ? <Button variant="outline" size="sm" disabled={manager.dirty || manager.loading || manager.saving} onClick={() => convertDraft(scope, manager.snapshot!.legacy!.content)}>{t('settings.mcp.migration.import')}</Button> : null}
          </div> : null}
          {manager.snapshot?.legacyUnavailablePath ? <p className="break-words px-2.5 text-caption text-warning">{t('settings.mcp.migration.unreadable', { path: manager.snapshot.legacyUnavailablePath })}</p> : null}
          {!manager.parsed.valid ? <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-[12px] bg-destructive/8 px-3.5 py-2.5" role="alert">
            <p className="min-w-0 flex-1 text-caption text-destructive">{t(scope === 'project' ? 'settings.mcp.page.invalidProjectFile' : 'settings.mcp.page.invalidFile')}</p>
            <Button variant="outline" size="sm" disabled={manager.loading || manager.saving} onClick={() => convertDraft(scope, manager.draftText)}>{t('settings.mcp.migration.convert')}</Button>
            <Button variant="outline" size="sm" onClick={() => show({ page: 'file', scope, nonce: ++nonce })}>{t('settings.mcp.page.editFile')}</Button>
          </div> : null}
          <ConfigApplyNotice status={manager.apply.status} readFailed={manager.apply.readFailed} />
          <ConfigurationDocumentError error={manager.documentError} />
          {!manager.snapshot?.applyStatus && manager.savedApply && manager.savedApply !== 'applied' && manager.savedApply !== 'saved' ? <p className="px-2.5 text-caption text-muted-foreground" role="status">{t(`settings.mcp.apply.${manager.savedApply}`)}</p> : null}
        </React.Fragment>)}
        {notice ? <p className={cn('px-2.5 text-caption', notice.error ? 'text-destructive' : 'text-muted-foreground')} role={notice.error ? 'alert' : 'status'}>{notice.text}</p> : null}
      </div>
      <McpServerList title={t('settings.mcp.page.title')} entries={globalManager.loading && !globalManager.snapshot ? [] : entries} busyKey={busyKey} recent={recent}
        empty={globalManager.loading && !globalManager.snapshot ? <div data-settings-row className="flex items-center justify-center gap-2 px-3 py-10 text-caption text-muted-foreground" role="status"><TbLoader2 className="size-4 animate-spin" aria-hidden />{t('settings.mcp.loading')}</div>
          : <McpServersEmpty disabled={!anyEditable} onAdd={() => setAddOpen(true)} onImport={() => setImportOpen(true)} />}
        headerActions={<>
          {globalManager.saving || managers.project?.saving ? <TbLoader2 className="mr-1 size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label={t('settings.models.workspace.saving')} /> : null}
          <Button variant="outline" size="sm" disabled={!anyEditable} onClick={() => setAddOpen(true)}><TbPlus aria-hidden />{t('settings.mcp.page.add')}</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('settings.models.cards.more')}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!anyEditable} onSelect={() => setImportOpen(true)}><TbFileImport aria-hidden />{t('settings.mcp.page.import')}</DropdownMenuItem>
              <DropdownMenuItem disabled={!entries.length} onSelect={() => copy({ mcpServers: Object.fromEntries(entries.filter((entry) => !entry.overridden).map((entry) => [entry.server.name, entry.server.definition])) })}><TbCopy aria-hidden />{t('settings.mcp.page.copyAll')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!globalManager.current} onSelect={() => show({ page: 'file', scope: 'global', nonce: ++nonce })}><TbFileCode aria-hidden />{t('settings.mcp.page.editGlobalFile')}</DropdownMenuItem>
              {managers.project ? <DropdownMenuItem disabled={!managers.project.current} onSelect={() => show({ page: 'file', scope: 'project', nonce: ++nonce })}><TbFileCode aria-hidden />{t('settings.mcp.page.editProjectFile')}</DropdownMenuItem> : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!globalManager.runtimeReady || !globalManager.mcpCommand} onSelect={() => {
                void globalManager.showRuntimeStatus().then(() => setNotice({ text: t('settings.mcp.runtimeStatusRequested') }), () => setNotice({ text: t('settings.mcp.restartFailed'), error: true }))
              }}><TbActivity aria-hidden />{t('settings.mcp.runtimeStatus')}</DropdownMenuItem>
              <DropdownMenuItem disabled={globalManager.loading || globalManager.saving} onSelect={() => { void globalManager.load(true); void managers.project?.load(true) }}><TbRefresh aria-hidden />{t('common.refresh')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>}
        onEdit={edit} onToggle={(entry, enabled) => void toggle(entry, enabled)} onCopy={(entry) => copy({ [entry.server.name]: entry.server.definition })} onRemove={setRemoving} />
      <p className="px-2.5 text-caption leading-snug text-muted-foreground [overflow-wrap:anywhere]">{t(projectName ? 'settings.mcp.page.mergedFooter' : 'settings.mcp.page.globalFooter', { project: projectName ?? '', path: globalManager.path ?? '' })}</p>
    </SettingsPage>}

    <McpAddSheet open={addOpen} onOpenChange={setAddOpen} existing={names} projectName={projectName} disabled={!anyEditable}
      onTemplate={openTemplate} onBlank={openBlank} onAdd={addMany} />
    <McpImportSheet open={importOpen} onOpenChange={setImportOpen} load={() => window.pipilot!.mcpConfig.importSources()} existing={names} projectName={projectName}
      disabled={!anyEditable} onAdd={addMany} />
    {(['global', 'project'] as const).map((scope) => managers[scope] ? <ConfigurationReloadConfirmation key={scope} open={managers[scope]!.reloadOpen} onOpenChange={managers[scope]!.setReloadOpen}
      onReload={() => { managers[scope]!.setReloadOpen(false); void managers[scope]!.load() }} /> : null)}
    <DiscardChangesDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null) }}
      onDiscard={() => { const next = pending; setPending(null); if (route.page === 'file') managers[route.scope]?.revertDraft(); if (next) show(next) }} />
    <AlertDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(removing?.server.transport === 'override' ? 'settings.mcp.page.removeOverrideConfirm' : 'settings.mcp.removeConfirm', { name: removing?.server.name ?? '' })}</AlertDialogTitle>
          <AlertDialogDescription>{t(removing?.server.transport === 'override' ? 'settings.mcp.page.removeOverrideDescription' : 'settings.mcp.page.removeDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void confirmRemove()}>{t(removing?.server.transport === 'override' ? 'settings.mcp.page.removeOverride' : 'settings.mcp.removeServer')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
}
