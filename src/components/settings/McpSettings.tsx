import * as React from 'react'
import {
  TbFileCode,
  TbPlus,
  TbRefresh,
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
  definitionFromFormValue,
  formValueFromServer,
  structuredDocumentSupported,
} from './mcp-server-form-model'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { ConfigApplyNotice } from './ConfigApplyNotice'
import { useConfigApplyStatus } from './useConfigApplyStatus'
import { ConfigurationDocumentError, ConfigurationDocumentUnavailable, ConfigurationReloadConfirmation } from './ConfigurationDocumentFeedback'
import { useConfigurationDocument, useMcpConfigurationDocument } from '@/store/configuration-documents'
import type { ConfigurationDocument } from '@/renderer/configuration-documents'
import {
  createMcpConfigAdapter,
  type McpConfigAdapter,
} from '@/renderer/adapters/mcp-config-adapter'
import { displayMcpConfigPath } from '@/renderer/mcp/mcp-path-presentation'
import {
  parseMcpConfigDocument,
  convertMcpConfigToNativeJson,
  removeMcpServer,
  renameMcpServer,
  upsertMcpServer,
} from '@/shared/mcp-config-parser'
import type {
  McpConfigServer,
  McpConfigSnapshot,
  McpConfigTarget,
} from '@/shared/mcp-config'
import type { PiIntegrationScope } from '@/shared/pi-integrations'
import { usePiIntegrations } from '@/store/pi-integrations'
import { useWorkspaceStore } from '@/store/workspace'
import { hasEnabledLegacyMcpAdapter, isNativeMcpCommand } from '@/shared/mcp-config-compatibility'
import {
  usePiRpcActions,
  usePiRuntime,
} from '@/store/pi-rpc'
import {
  McpServerFormDialog,
  type McpServerFormValue,
} from './McpServerFormDialog'
import { McpServerBrowser } from './integrations/McpServerBrowser'

export interface McpSettingsProps {
  scope: PiIntegrationScope
  active?: boolean
  onDirtyChange?(dirty: boolean): void
  onManagePackages?(): void
}

function targetFor(scope: PiIntegrationScope): McpConfigTarget {
  return scope.kind === 'global'
    ? { kind: 'global' }
    : { kind: 'project', workspaceId: scope.workspaceId }
}

function targetKey(target: McpConfigTarget) {
  return target.kind === 'global' ? 'global' : `project:${target.workspaceId}`
}

export function McpSettings({ scope, active = true, onDirtyChange, onManagePackages }: McpSettingsProps) {
  const [, retry] = React.useReducer((value: number) => value + 1, 0)
  const { document, available } = useMcpConfigurationDocument(targetFor(scope))
  return document ? (
    <McpDocumentSettings key={targetKey(targetFor(scope))} scope={scope} active={active} onDirtyChange={onDirtyChange} onManagePackages={onManagePackages} document={document} />
  ) : <ConfigurationDocumentUnavailable capacity={available} retry={retry} />
}

function McpDocumentSettings({ scope, active = true, onDirtyChange, onManagePackages, document }: McpSettingsProps & {
  document: ConfigurationDocument<McpConfigSnapshot>
}) {
  const t = useT()
  const runtime = usePiRuntime()
  const integrations = usePiIntegrations()
  const workspace = useWorkspaceStore()
  const actions = usePiRpcActions()
  const [adapter] = React.useState<McpConfigAdapter | null>(createMcpConfigAdapter)
  const target = React.useMemo(() => targetFor(scope), [scope])
  const { snapshot, draftText, view, dirty, phase, error: documentError, savedApply } = useConfigurationDocument(document, active)
  const [detecting, setDetecting] = React.useState(false)
  const loading = phase === 'loading' || detecting || (!snapshot && !documentError)
  const saving = phase === 'saving'
  const [reloadOpen, setReloadOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<McpConfigServer | null>(null)
  const [removeName, setRemoveName] = React.useState<string | null>(null)
  const requestEpoch = React.useRef(0)
  const diagnosticsId = React.useId()
  const targetKeyValue = targetKey(target)
  const targetKeyRef = React.useRef(targetKeyValue)
  targetKeyRef.current = targetKeyValue
  const snapshotIsCurrent = snapshot !== null &&
    targetKey(snapshot.target) === targetKeyValue
  const readApplySnapshot = React.useCallback(() => adapter!.load(target), [adapter, target])
  const apply = useConfigApplyStatus(
    targetKeyValue,
    snapshotIsCurrent ? snapshot : null,
    adapter ? readApplySnapshot : null,
  )
  const parsed = React.useMemo(() => parseMcpConfigDocument(draftText), [draftText])
  const formSupported = structuredDocumentSupported(parsed)
  const runtimeReady = runtime.runtime?.state === 'ready'
  const mcpCommand = runtimeReady ? runtime.commands.find((command) => command.name === 'mcp') : undefined
  // A project extension can also read the global MCP document. Protect that
  // shared file while restricting project documents to their own runtime.
  const runtimeScopeMatches = scope.kind === 'global' ||
    (workspace.activeScope.kind === 'project' && workspace.activeScope.workspaceId === scope.workspaceId)
  const runtimeOverride = runtimeScopeMatches && mcpCommand && !isNativeMcpCommand(mcpCommand)
  const legacyAdapterEnabled = integrations.snapshot ? hasEnabledLegacyMcpAdapter(integrations.snapshot) : false
  const nativeWritesBlocked = Boolean(runtimeOverride) || legacyAdapterEnabled
  const displayedPath = snapshotIsCurrent
    ? displayMcpConfigPath(snapshot.target, snapshot.path, snapshot.displayPath)
    : t('settings.mcp.loading')

  const updateDraft = document.updateDraft
  const setView = document.setView

  React.useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])

  React.useEffect(() => {
    if (snapshot && view === 'form' && !formSupported) setView('json')
  }, [formSupported, setView, snapshot, view])

  const isCurrentRequest = React.useCallback((epoch: number, expectedTargetKey: string) => (
    epoch === requestEpoch.current && expectedTargetKey === targetKeyRef.current
  ), [])

  const load = React.useCallback(async (confirmDiscard = false) => {
    if (confirmDiscard && dirty) {
      setReloadOpen(true)
      return
    }
    setError(null)
    setStatus(null)
    await document.load(true)
  }, [dirty, document])

  React.useEffect(() => () => {
    requestEpoch.current += 1
  }, [])

  const save = async (restart: boolean) => {
    if (
      !adapter ||
      !snapshot ||
      !snapshotIsCurrent ||
      (!dirty && !restart) ||
      !parsed.valid ||
      loading ||
      saving ||
      nativeWritesBlocked
    ) return
    setError(null)
    setStatus(null)
    await document.save(restart)
  }

  const showRuntimeStatus = async () => {
    if (!adapter || loading || saving) return
    const epoch = ++requestEpoch.current
    const expectedTargetKey = targetKeyValue
    setDetecting(true)
    setError(null)
    try {
      await actions.send('/mcp', 'prompt')
      if (!isCurrentRequest(epoch, expectedTargetKey)) return
      setStatus(t('settings.mcp.runtimeStatusRequested'))
    } catch (caught) {
      if (isCurrentRequest(epoch, expectedTargetKey)) {
        setError(caught instanceof Error ? caught.message : t('settings.mcp.restartFailed'))
      }
    } finally {
      if (isCurrentRequest(epoch, expectedTargetKey)) setDetecting(false)
    }
  }

  const openAdd = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const openEdit = (server: McpConfigServer) => {
    setEditing(server)
    setFormOpen(true)
  }

  const submitForm = (value: McpServerFormValue) => {
    try {
      let next = draftText
      if (editing) {
        const existing = parsed.servers.find((server) => server.name === editing.name)
        const definition = definitionFromFormValue(value, existing)
        if (value.name !== editing.name) {
          next = renameMcpServer(next, editing.name, value.name)
        }
        next = upsertMcpServer(next, value.name, definition)
      } else {
        next = upsertMcpServer(next, value.name, definitionFromFormValue(value))
      }
      if (!updateDraft(next)) return false
      setError(null)
      setFormOpen(false)
      return true
    } catch {
      setError(t('settings.mcp.editFailed'))
      return false
    }
  }

  const toggleServerEnabled = (server: McpConfigServer, enabled: boolean) => {
    try {
      const definition = { ...server.definition }
      if (enabled) delete definition.enabled
      else definition.enabled = false
      updateDraft(upsertMcpServer(draftText, server.name, definition))
      setError(null)
    } catch {
      setError(t('settings.mcp.editFailed'))
    }
  }

  const convertDraft = (content: string) => {
    try {
      if (!updateDraft(convertMcpConfigToNativeJson(content))) return
      setView('json')
      setStatus(t('settings.mcp.migration.review'))
      setError(null)
    } catch {
      setError(t('settings.mcp.migration.failed'))
    }
  }

  return (
    <div className="@container/mcp min-w-0 space-y-4" data-mcp-settings aria-busy={loading || saving}>
      <div className="flex flex-col gap-3 @min-[680px]/mcp:flex-row @min-[680px]/mcp:items-start @min-[680px]/mcp:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-title">{t('settings.mcp.servers')}</h3>
            <Badge variant="secondary">{t(`settings.mcp.scope.${scope.kind}`)}</Badge>
            {dirty ? <span className="text-caption text-warning">{t('settings.document.unsaved')}</span> : null}
          </div>
          <div className="mt-2 flex min-w-0 items-start gap-1.5 text-muted-foreground">
            <TbFileCode className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <p className="min-w-0 break-all font-mono text-micro" title={snapshotIsCurrent ? snapshot.path : undefined}>{displayedPath}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" disabled={loading || saving} aria-label={t('common.refresh')} onClick={() => void load(true)}>
                <TbRefresh className={loading ? 'animate-spin' : ''} aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('common.refresh')}</TooltipContent>
          </Tooltip>
          <Button variant="outline" size="sm" disabled={!dirty || !parsed.valid || loading || saving || nativeWritesBlocked} onClick={() => void save(false)}>
            {t('common.save')}
          </Button>
          <Button size="sm" disabled={!snapshotIsCurrent || apply.status?.state === 'superseded' || !parsed.valid || loading || saving || nativeWritesBlocked} onClick={() => void save(true)}>
            {t(dirty ? 'settings.mcp.saveRestart' : 'settings.configApply.retry')}
          </Button>
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-caption text-muted-foreground">
        <span>{t(nativeWritesBlocked ? 'settings.mcp.extensionOverride' : isNativeMcpCommand(mcpCommand) ? 'settings.mcp.nativeDescription' : 'settings.mcp.nativeConfigured')}</span>
        <Button variant="ghost" size="sm" disabled={!runtimeReady || !mcpCommand || loading || saving} onClick={() => void showRuntimeStatus()}>{t('settings.mcp.runtimeStatus')}</Button>
      </div>
      {nativeWritesBlocked ? <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-caption" role="alert"><p>{t('settings.mcp.extensionMigrationBlocked')}</p>{onManagePackages ? <Button variant="outline" size="sm" onClick={onManagePackages}>{t('settings.mcp.managePackages')}</Button> : null}</div> : null}

      {snapshotIsCurrent && snapshot.legacy ? (
        <div className="space-y-2 rounded-lg border border-border p-3 text-caption">
          <p>{t(snapshot.exists ? 'settings.mcp.migration.existing' : 'settings.mcp.migration.available')}</p>
          <p className="break-all font-mono text-micro text-muted-foreground">{snapshot.legacy.path}</p>
          {!snapshot.exists ? <Button variant="outline" size="sm" disabled={dirty || loading || saving} onClick={() => convertDraft(snapshot.legacy!.content)}>{t('settings.mcp.migration.import')}</Button> : null}
        </div>
      ) : null}
      {snapshotIsCurrent && snapshot.legacyUnavailablePath ? <p className="break-words text-caption text-warning">{t('settings.mcp.migration.unreadable', { path: snapshot.legacyUnavailablePath })}</p> : null}
      {!parsed.valid && snapshotIsCurrent ? <div className="space-y-2 text-caption text-muted-foreground"><p>{t('settings.mcp.migration.conversionHint')}</p><Button variant="outline" size="sm" disabled={loading || saving} onClick={() => convertDraft(draftText)}>{t('settings.mcp.migration.convert')}</Button></div> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md bg-muted p-0.5" role="group" aria-label={t('settings.mcp.editMode')}>
            {(['form', 'json'] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                disabled={candidate === 'form' && !formSupported}
                aria-pressed={view === candidate}
                className="h-7 rounded px-2.5 text-caption text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-background aria-pressed:text-foreground"
                onClick={() => setView(candidate)}
              >
                {t(`settings.mcp.mode.${candidate}`)}
              </button>
            ))}
          </div>
        </div>
        <Button variant="outline" size="sm" disabled={!snapshotIsCurrent || loading || saving || view !== 'form' || !formSupported} onClick={openAdd}>
          <TbPlus aria-hidden />
          {t('settings.mcp.addServer')}
        </Button>
      </div>

      {!formSupported ? <p className="text-caption text-muted-foreground">{t('settings.mcp.formUnavailable')}</p> : null}
      <div className="empty:hidden">
        {(error || status) && (
          <p className={cn('text-caption', error ? 'text-destructive' : 'text-muted-foreground')} role={error ? 'alert' : 'status'}>{error ?? status}</p>
        )}
        <ConfigApplyNotice status={apply.status} readFailed={apply.readFailed} />
        <ConfigurationDocumentError error={documentError} />
        {!snapshot?.applyStatus && savedApply ? <p className="py-2 text-caption text-muted-foreground" role="status">{t(`settings.mcp.apply.${savedApply}`)}</p> : null}
      </div>

      {loading && !snapshot ? (
        <p className="py-12 text-center text-caption text-muted-foreground" role="status">{t('settings.mcp.loading')}</p>
      ) : view === 'form' ? (
        <McpServerBrowser
          servers={parsed.servers}
          disabled={loading || saving || !snapshotIsCurrent}
          onEdit={openEdit}
          onRemove={setRemoveName}
          onToggleEnabled={toggleServerEnabled}
          onOpenJson={() => setView('json')}
        />
      ) : (
        <div className="space-y-3">
          <p className="text-caption text-muted-foreground">{t('settings.integrations.mcp.jsonDescription')}</p>
          <Textarea
            value={draftText}
            onChange={(event) => updateDraft(event.target.value)}
            spellCheck={false}
            aria-invalid={!parsed.valid}
            aria-describedby={parsed.diagnostics.length > 0 ? diagnosticsId : undefined}
            aria-label={t('settings.mcp.mode.json')}
            disabled={loading || saving || !snapshotIsCurrent}
            className="min-h-[28rem] resize-y rounded-lg bg-muted/20 px-4 py-3 font-mono text-caption leading-relaxed"
          />
        </div>
      )}

      {parsed.diagnostics.length > 0 && (
        <div id={diagnosticsId} className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2" role="alert">
          {parsed.diagnostics.slice(0, 5).map((diagnostic, index) => (
            <p key={`${diagnostic.code}:${diagnostic.offset}:${index}`} className="text-micro text-destructive">
              {t('settings.mcp.diagnostic', {
                line: diagnostic.line,
                column: diagnostic.column,
                message: diagnostic.message,
              })}
            </p>
          ))}
        </div>
      )}
      <ConfigurationReloadConfirmation open={reloadOpen} onOpenChange={setReloadOpen} onReload={() => { setReloadOpen(false); void load() }} />

      <McpServerFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        mode={editing ? 'edit' : 'add'}
        initial={editing ? formValueFromServer(editing) : undefined}
        existingNames={parsed.servers.map((server) => server.name)}
        onSubmit={submitForm}
      />

      <AlertDialog open={Boolean(removeName)} onOpenChange={(open) => !open && setRemoveName(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.mcp.removeServer')}</AlertDialogTitle>
            <AlertDialogDescription>{t('settings.mcp.removeConfirm', { name: removeName ?? '' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!removeName) return
                try {
                  updateDraft(removeMcpServer(draftText, removeName))
                  setError(null)
                } catch {
                  setError(t('settings.mcp.editFailed'))
                } finally {
                  setRemoveName(null)
                }
              }}
            >
              {t('settings.mcp.removeServer')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
