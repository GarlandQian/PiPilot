import * as React from 'react'
import { TbActivity, TbCopy, TbDots, TbFileCode, TbFileImport, TbLoader2, TbPlus, TbRefresh } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useLocale, useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ConfigurationDocument } from '@/renderer/configuration-documents'
import type { McpConfigServer, McpConfigSnapshot } from '@/shared/mcp-config'
import { convertMcpConfigToNativeJson, parseMcpConfigDocument } from '@/shared/mcp-config-parser'
import { templateForServer, type McpTemplate } from '@/shared/mcp-templates'
import { localizedText } from '@/shared/model-provider-presets'
import type { PiIntegrationScope } from '@/shared/pi-integrations'
import { useMcpConfigurationDocument } from '@/store/configuration-documents'
import { ConfigApplyNotice } from './ConfigApplyNotice'
import { ConfigFileEditor } from './ConfigFileEditor'
import { ConfigurationDocumentError, ConfigurationDocumentUnavailable, ConfigurationReloadConfirmation } from './ConfigurationDocumentFeedback'
import { DiscardChangesDialog } from './editor-page'
import { McpAddPage, type McpAddMode } from './mcp/McpAddPage'
import { McpImportPage } from './mcp/McpImportPage'
import { McpServerEditor, type McpEditorTarget } from './mcp/McpServerEditor'
import { McpServerList, McpServersEmpty } from './mcp/McpServerList'
import { uniqueMcpName, withTransport, type McpTransport } from './mcp/mcp-editor-model'
import { mcpTargetFor, mcpTargetKey, useMcpManager, type McpManager } from './mcp/useMcpManager'
import { useSettingsSubpage } from './settings-subpage'

export interface McpSettingsProps {
  scope: PiIntegrationScope
  active?: boolean
  onManagePackages?(): void
  /** A page of its own is open: the Integrations tabs step aside. */
  onSubpageChange?(open: boolean): void
}

type Route =
  | { page: 'list' }
  | { page: 'add'; mode: McpAddMode }
  | { page: 'import' }
  | { page: 'edit'; target: McpEditorTarget; from: 'list' | 'add'; nonce: number }
  | { page: 'file'; nonce: number }

export function McpSettings({ scope, active = true, onManagePackages, onSubpageChange }: McpSettingsProps) {
  const [, retry] = React.useReducer((value: number) => value + 1, 0)
  const { document, available } = useMcpConfigurationDocument(mcpTargetFor(scope))
  return document ? (
    <McpDocumentSettings key={mcpTargetKey(mcpTargetFor(scope))} scope={scope} active={active} onManagePackages={onManagePackages} onSubpageChange={onSubpageChange} document={document} />
  ) : <ConfigurationDocumentUnavailable capacity={available} retry={retry} />
}

let nonce = 0

function McpDocumentSettings({ scope, active = true, onManagePackages, onSubpageChange, document }: McpSettingsProps & {
  document: ConfigurationDocument<McpConfigSnapshot>
}) {
  const t = useT()
  const locale = useLocale()
  const manager = useMcpManager(document, scope, active)
  const rootRef = React.useRef<HTMLDivElement>(null)
  // The file page lives in the document's view, so it survives like the draft it edits.
  const [route, setRoute] = React.useState<Route>(() => document.getSnapshot().view === 'json' ? { page: 'file', nonce: ++nonce } : { page: 'list' })
  const [pending, setPending] = React.useState<Route | null>(null)
  const pageDirty = React.useRef(false)
  const onDirtyChange = React.useCallback((dirty: boolean) => { pageDirty.current = dirty }, [])
  const [recent, setRecent] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<{ text: string; error?: boolean } | null>(null)
  const [busyName, setBusyName] = React.useState<string | null>(null)
  const [removing, setRemoving] = React.useState<McpConfigServer | null>(null)
  /** The file page holds a draft converted from an older format. */
  const [converted, setConverted] = React.useState(false)
  const listScroll = React.useRef(0)
  const { parsed, snapshot } = manager
  const names = parsed.servers.map((server) => server.name)
  const ready = manager.current && !manager.loading
  const editable = ready && parsed.valid && !manager.saving && !manager.writesBlocked

  // A server page fills the pane. The file page edits this target's own draft, so the tabs and the Global/Project switch stay.
  React.useEffect(() => { onSubpageChange?.(route.page !== 'list' && route.page !== 'file') }, [onSubpageChange, route.page])
  React.useEffect(() => () => onSubpageChange?.(false), [onSubpageChange])

  /* -------------------------- navigation -------------------------- */

  const scroller = () => rootRef.current?.closest<HTMLElement>('[data-settings-section]') ?? null
  const show = (next: Route) => {
    const container = scroller()
    if (route.page === 'list' && container) listScroll.current = container.scrollTop
    pageDirty.current = false
    manager.setView(next.page === 'file' ? 'json' : 'form')
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
  const back = () => navigate(route.page === 'edit' && route.from === 'add' ? { page: 'add', mode: 'template' } : { page: 'list' })
  const title = (() => {
    switch (route.page) {
      case 'list': return null
      case 'add': return t('settings.mcp.page.addTitle')
      case 'import': return t('settings.mcp.page.importTitle')
      case 'file': return 'mcp.json'
      case 'edit': return route.target.previousName ?? (route.target.template ? t('settings.mcp.page.addNamed', { name: localizedText(route.target.template.title, locale) }) : t('settings.mcp.page.addTitle'))
    }
  })()
  useSettingsSubpage('integrations', title === null ? null : { title, back })

  React.useEffect(() => {
    if (!recent) return
    const timer = window.setTimeout(() => setRecent(null), 4_000)
    return () => window.clearTimeout(timer)
  }, [recent])

  const done = (name: string | null, message?: string) => {
    show({ page: 'list' })
    setRecent(name)
    setNotice(message ? { text: message } : null)
  }

  const openTemplate = (template: McpTemplate) => show({
    page: 'edit', from: 'add', nonce: ++nonce,
    target: { previousName: null, name: uniqueMcpName(template.name, names), definition: structuredClone(template.definition) as Record<string, unknown>, template },
  })
  const openBlank = (transport: McpTransport) => show({
    page: 'edit', from: 'add', nonce: ++nonce,
    target: { previousName: null, name: '', definition: withTransport({}, transport, {}).definition },
  })
  const edit = (server: McpConfigServer) => show({
    page: 'edit', from: 'list', nonce: ++nonce,
    target: { previousName: server.name, name: server.name, definition: structuredClone(server.definition), template: templateForServer(server.definition) },
  })

  const addMany = async (servers: readonly { name: string; definition: Record<string, unknown> }[]) => {
    const added = await manager.addServers(servers)
    if (added) done(servers[0]?.name ?? null, t('settings.mcp.page.added', { count: servers.length }))
    return added
  }

  const toggle = async (server: McpConfigServer, enabled: boolean) => {
    setBusyName(server.name)
    const saved = await manager.setEnabled(server.name, enabled)
    setBusyName(null)
    setNotice(saved ? null : { text: t('settings.mcp.saveFailed'), error: true })
  }

  const copy = (value: unknown) => {
    void navigator.clipboard.writeText(`${JSON.stringify(value, null, 2)}\n`)
      .then(() => setNotice({ text: t('settings.mcp.page.copied') }))
      .catch(() => setNotice({ text: t('settings.mcp.page.copyFailed'), error: true }))
  }

  const confirmRemove = async () => {
    const server = removing
    setRemoving(null)
    if (!server) return
    const removed = await manager.removeServer(server.name)
    setNotice(removed ? null : { text: t('settings.mcp.saveFailed'), error: true })
  }

  const convertDraft = (content: string) => {
    try {
      if (!manager.updateDraft(convertMcpConfigToNativeJson(content))) return
      setConverted(true)
      show({ page: 'file', nonce: ++nonce })
    } catch {
      setNotice({ text: t('settings.mcp.migration.failed'), error: true })
    }
  }

  /* ---------------------------- pages ----------------------------- */

  const page = (() => {
    switch (route.page) {
      case 'add': return <McpAddPage mode={route.mode} onMode={(mode) => show({ page: 'add', mode })} existing={names} disabled={!editable}
        onTemplate={openTemplate} onBlank={openBlank} onAdd={addMany} onCancel={back} onDirtyChange={onDirtyChange} />
      case 'import': return <McpImportPage load={() => window.pipilot!.mcpConfig.importSources()} existing={names} disabled={!editable} onAdd={addMany} onCancel={back} />
      case 'edit': return <McpServerEditor key={route.nonce} manager={manager} target={route.target}
        takenNames={names.filter((name) => name !== route.target.previousName)} onDone={({ name }) => done(name)} onCancel={back} onDirtyChange={onDirtyChange} />
      case 'file': return <ConfigFileEditor key={route.nonce} draftText={manager.draftText} savedText={manager.current ? snapshot!.content : null} onChange={manager.updateDraft} path={manager.path ?? undefined}
        description={t('settings.mcp.page.fileDescription')} label="mcp.json" parse={parseMcpConfigDocument} save={manager.saveDraft} onReload={() => void manager.load(true)}
        disabled={manager.writesBlocked} onDone={() => done(null)} onCancel={back} onDirtyChange={onDirtyChange}
        notice={manager.writesBlocked ? <div className="space-y-2 rounded-lg bg-warning/10 p-3.5 text-caption" role="alert"><p>{t('settings.mcp.extensionMigrationBlocked')}</p>
          {onManagePackages ? <Button variant="outline" size="sm" onClick={onManagePackages}>{t('settings.mcp.managePackages')}</Button> : null}</div>
          : converted && manager.dirty ? <p className="px-1 text-caption text-muted-foreground" role="status">{t('settings.mcp.migration.review')}</p> : null} />
      case 'list': return null
    }
  })()

  return <div ref={rootRef} className="@container/mcp min-w-0" data-mcp-settings data-mcp-page={route.page} aria-busy={manager.loading || manager.saving}>
    {route.page !== 'list' ? page : <section className="min-w-0" aria-label={t('settings.mcp.servers')}>
      <header className="mb-2 flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2 px-1">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-app font-semibold text-foreground">{t('settings.mcp.page.title')}</h2>
          <p className="mt-0.5 max-w-[72ch] text-caption leading-snug text-muted-foreground">{t(manager.writesBlocked ? 'settings.mcp.extensionOverride' : 'settings.mcp.page.description')}</p>
          <p className="mt-1 break-all font-mono text-micro text-muted-foreground" title={snapshot?.path}>{manager.path ?? t('settings.mcp.loading')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {manager.saving ? <TbLoader2 className="mr-1 size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label={t('settings.models.workspace.saving')} /> : null}
          <Button variant="outline" size="sm" disabled={!editable} onClick={() => navigate({ page: 'add', mode: 'template' })}><TbPlus aria-hidden />{t('settings.mcp.page.add')}</Button>
          <Button variant="outline" size="sm" disabled={!editable} onClick={() => navigate({ page: 'import' })}><TbFileImport aria-hidden />{t('settings.mcp.page.import')}</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('settings.models.cards.more')}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!parsed.servers.length} onSelect={() => copy({ mcpServers: Object.fromEntries(parsed.servers.map((server) => [server.name, server.definition])) })}><TbCopy aria-hidden />{t('settings.mcp.page.copyAll')}</DropdownMenuItem>
              <DropdownMenuItem disabled={!manager.current} onSelect={() => show({ page: 'file', nonce: ++nonce })}><TbFileCode aria-hidden />{t('settings.mcp.page.editFile')}</DropdownMenuItem>
              <DropdownMenuItem disabled={!manager.runtimeReady || !manager.mcpCommand} onSelect={() => {
                void manager.showRuntimeStatus().then(() => setNotice({ text: t('settings.mcp.runtimeStatusRequested') }), () => setNotice({ text: t('settings.mcp.restartFailed'), error: true }))
              }}><TbActivity aria-hidden />{t('settings.mcp.runtimeStatus')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={manager.loading || manager.saving} onSelect={() => void manager.load(true)}><TbRefresh aria-hidden />{t('common.refresh')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div className="min-w-0 space-y-2">
        {manager.writesBlocked ? <div className="space-y-2 rounded-lg bg-warning/10 p-3.5 text-caption" role="alert"><p>{t('settings.mcp.extensionMigrationBlocked')}</p>{onManagePackages ? <Button variant="outline" size="sm" onClick={onManagePackages}>{t('settings.mcp.managePackages')}</Button> : null}</div> : null}
        {manager.current && snapshot?.legacy ? <div className="mac-box space-y-2 p-3.5 text-caption">
          <p>{t(snapshot.exists ? 'settings.mcp.migration.existing' : 'settings.mcp.migration.available')}</p>
          <p className="break-all font-mono text-micro text-muted-foreground">{snapshot.legacy.path}</p>
          {!snapshot.exists ? <Button variant="outline" size="sm" disabled={manager.dirty || manager.loading || manager.saving} onClick={() => convertDraft(snapshot.legacy!.content)}>{t('settings.mcp.migration.import')}</Button> : null}
        </div> : null}
        {manager.current && snapshot?.legacyUnavailablePath ? <p className="break-words px-1 text-caption text-warning">{t('settings.mcp.migration.unreadable', { path: snapshot.legacyUnavailablePath })}</p> : null}
        <ConfigApplyNotice status={manager.apply.status} readFailed={manager.apply.readFailed} />
        <ConfigurationDocumentError error={manager.documentError} />
        {notice ? <p className={cn('px-1 text-caption', notice.error ? 'text-destructive' : 'text-muted-foreground')} role={notice.error ? 'alert' : 'status'}>{notice.text}</p> : null}
        {!snapshot?.applyStatus && manager.savedApply && manager.savedApply !== 'applied' && manager.savedApply !== 'saved' ? <p className="px-1 text-caption text-muted-foreground" role="status">{t(`settings.mcp.apply.${manager.savedApply}`)}</p> : null}
        {manager.loading && !snapshot ? <div className="mac-group"><p className="py-12 text-center text-caption text-muted-foreground" role="status">{t('settings.mcp.loading')}</p></div>
          : manager.current && !parsed.valid ? <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg bg-destructive/8 px-3.5 py-2.5" role="alert">
            <p className="min-w-0 flex-1 text-caption text-destructive">{t('settings.mcp.page.invalidFile')}</p>
            <Button variant="outline" size="sm" disabled={manager.loading || manager.saving} onClick={() => convertDraft(manager.draftText)}>{t('settings.mcp.migration.convert')}</Button>
            <Button variant="outline" size="sm" onClick={() => show({ page: 'file', nonce: ++nonce })}>{t('settings.mcp.page.editFile')}</Button>
          </div>
            : parsed.servers.length === 0 ? <McpServersEmpty disabled={!editable} onAdd={() => navigate({ page: 'add', mode: 'template' })} onImport={() => navigate({ page: 'import' })} />
              : <McpServerList servers={parsed.servers} disabled={!editable} busyName={busyName} recent={recent}
                onEdit={edit} onToggle={(server, enabled) => void toggle(server, enabled)} onCopy={(server) => copy({ [server.name]: server.definition })} onRemove={setRemoving} />}
      </div>
    </section>}

    <ConfigurationReloadConfirmation open={manager.reloadOpen} onOpenChange={manager.setReloadOpen} onReload={() => { manager.setReloadOpen(false); void manager.load() }} />
    <DiscardChangesDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null) }} onDiscard={() => { const next = pending; setPending(null); if (route.page === 'file') manager.revertDraft(); if (next) show(next) }} />
    <RemoveServerDialog server={removing} manager={manager} onOpenChange={(open) => { if (!open) setRemoving(null) }} onConfirm={() => void confirmRemove()} />
  </div>
}

function RemoveServerDialog({ server, manager, onOpenChange, onConfirm }: {
  server: McpConfigServer | null
  manager: McpManager
  onOpenChange(open: boolean): void
  onConfirm(): void
}) {
  const t = useT()
  return <AlertDialog open={server !== null} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{t('settings.mcp.removeConfirm', { name: server?.name ?? '' })}</AlertDialogTitle>
        <AlertDialogDescription>{t('settings.mcp.page.removeDescription')}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
        <AlertDialogAction variant="destructive" disabled={manager.saving} onClick={onConfirm}>{t('settings.mcp.removeServer')}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
