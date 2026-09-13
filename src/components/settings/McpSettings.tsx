import * as React from 'react'
import {
  TbCheck,
  TbCopy,
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
import {
  usePiExtensionUi,
  usePiRpcActions,
  usePiRuntime,
} from '@/store/pi-rpc'
import {
  McpServerFormDialog,
  type McpServerFormValue,
} from './McpServerFormDialog'
import { McpServerBrowser } from './integrations/McpServerBrowser'

const INSTALL_COMMAND = 'pi install npm:pi-mcp-adapter'

export interface McpSettingsProps {
  scope: PiIntegrationScope
  active?: boolean
  onDirtyChange?(dirty: boolean): void
}

function targetFor(scope: PiIntegrationScope): McpConfigTarget {
  return scope.kind === 'global'
    ? { kind: 'global' }
    : { kind: 'project', workspaceId: scope.workspaceId }
}

function targetKey(target: McpConfigTarget) {
  return target.kind === 'global' ? 'global' : `project:${target.workspaceId}`
}

function adapterDetected(commands: readonly { name: string }[]) {
  return commands.some((command) => command.name.replace(/^\//u, '') === 'mcp')
}


export function McpSettings({ scope, active = true, onDirtyChange }: McpSettingsProps) {
  const [, retry] = React.useReducer((value: number) => value + 1, 0)
  const { document, available } = useMcpConfigurationDocument(targetFor(scope))
  return document ? (
    <McpDocumentSettings key={targetKey(targetFor(scope))} scope={scope} active={active} onDirtyChange={onDirtyChange} document={document} />
  ) : <ConfigurationDocumentUnavailable capacity={available} retry={retry} />
}

function McpDocumentSettings({ scope, active = true, onDirtyChange, document }: McpSettingsProps & {
  document: ConfigurationDocument<McpConfigSnapshot>
}) {
  const t = useT()
  const runtime = usePiRuntime()
  const extension = usePiExtensionUi()
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
  const [copied, setCopied] = React.useState(false)
  const [copyFailed, setCopyFailed] = React.useState(false)
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
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
  const available = adapterDetected(runtime.commands)
  const runtimeReady = runtime.runtime?.state === 'ready'
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
    if (copyTimer.current) clearTimeout(copyTimer.current)
  }, [])

  const copyInstallCommand = async () => {
    const epoch = requestEpoch.current
    if (copyTimer.current) clearTimeout(copyTimer.current)
    setCopyFailed(false)
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND)
      if (!isCurrentRequest(epoch, targetKeyValue)) return
      setCopied(true)
      copyTimer.current = setTimeout(() => { setCopied(false); copyTimer.current = null }, 1_500)
    } catch {
      if (isCurrentRequest(epoch, targetKeyValue)) {
        setCopied(false)
        setCopyFailed(true)
      }
    }
  }

  const save = async (restart: boolean) => {
    if (
      !adapter ||
      !snapshot ||
      !snapshotIsCurrent ||
      (!dirty && !restart) ||
      !parsed.valid ||
      loading ||
      saving
    ) return
    setError(null)
    setStatus(null)
    await document.save(restart)
  }

  const restartDetection = async () => {
    if (!adapter || loading || saving) return
    const epoch = ++requestEpoch.current
    const expectedTargetKey = targetKeyValue
    setDetecting(true)
    setError(null)
    try {
      const result = await adapter.restart()
      if (!isCurrentRequest(epoch, expectedTargetKey)) return
      if (!result.applied && !result.restarted) throw new Error(result.error || t('settings.mcp.restartFailed'))
      await actions.refresh()
      setStatus(t(result.applied ? 'settings.mcp.apply.applied' : 'settings.mcp.restarted'))
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
      updateDraft(next)
      setError(null)
      setFormOpen(false)
    } catch {
      setError(t('settings.mcp.editFailed'))
    }
  }

  const toggleServerEnabled = (server: McpConfigServer, enabled: boolean) => {
    try {
      const definition = { ...server.definition }
      if (enabled) delete definition.disabled
      else definition.disabled = true
      updateDraft(upsertMcpServer(draftText, server.name, definition))
      setError(null)
    } catch {
      setError(t('settings.mcp.editFailed'))
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
          <Button variant="outline" size="sm" disabled={!dirty || !parsed.valid || loading || saving} onClick={() => void save(false)}>
            {t('common.save')}
          </Button>
          <Button size="sm" disabled={!snapshotIsCurrent || apply.status?.state === 'superseded' || !parsed.valid || loading || saving} onClick={() => void save(true)}>
            {t(dirty ? 'settings.mcp.saveRestart' : 'settings.configApply.retry')}
          </Button>
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-caption text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className={cn('size-1.5 rounded-full', runtimeReady && available ? 'bg-success' : 'bg-muted-foreground/60')} aria-hidden />
          {t(!runtimeReady ? 'settings.integrations.mcp.runtimeNotReady' : available ? 'settings.mcp.detected' : 'settings.mcp.notDetected')}
        </span>
        {runtimeReady && extension.statuses.mcp ? <span className="min-w-0 break-words">{extension.statuses.mcp}</span> : null}
      </div>

      {runtimeReady && !available && (
        <div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3 @min-[680px]/mcp:flex-row @min-[680px]/mcp:items-center @min-[680px]/mcp:justify-between">
          <div>
            <p className="text-caption text-foreground">{t('settings.mcp.optionalOnly')}</p>
            <code className="mt-1 block font-mono text-micro text-muted-foreground">{INSTALL_COMMAND}</code>
          </div>
          <div className="flex gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={t('settings.mcp.copyInstall')}
                  onClick={() => void copyInstallCommand()}
                >
                  {copied ? <TbCheck aria-hidden /> : <TbCopy aria-hidden />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('settings.mcp.copyInstall')}</TooltipContent>
            </Tooltip>
            <Button variant="outline" size="sm" disabled={loading || saving || !runtimeReady} onClick={() => void restartDetection()}>
              <TbRefresh aria-hidden />
              {t('settings.mcp.refreshDetection')}
            </Button>
          </div>
        </div>
      )}
      {copyFailed ? <p className="text-caption text-destructive" role="alert">{t('md.copyFailed')}</p> : null}

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
