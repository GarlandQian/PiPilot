import * as React from 'react'
import {
  TbCheck,
  TbCopy,
  TbEdit,
  TbPlus,
  TbRefresh,
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
  definitionFromFormValue,
  formValueFromServer,
  structuredDocumentSupported,
  structuredSupported,
} from './mcp-server-form-model'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
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

const INSTALL_COMMAND = 'pi install npm:pi-mcp-adapter'

type DraftView = 'form' | 'json'

export interface McpSettingsProps {
  scope: PiIntegrationScope
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


export function McpSettings({ scope, onDirtyChange }: McpSettingsProps) {
  const t = useT()
  const runtime = usePiRuntime()
  const extension = usePiExtensionUi()
  const actions = usePiRpcActions()
  const [adapter] = React.useState<McpConfigAdapter | null>(createMcpConfigAdapter)
  const target = React.useMemo(() => targetFor(scope), [scope])
  const [snapshot, setSnapshot] = React.useState<McpConfigSnapshot | null>(null)
  // Single source of truth for both the Form and JSON views (design §9): one
  // JSONC draft text, initialized from the loaded snapshot. JSON edits set it
  // directly; form edits go through the comment-preserving parser helpers.
  const [draftText, setDraftText] = React.useState('')
  const [view, setView] = React.useState<DraftView>('form')
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<McpConfigServer | null>(null)
  const [removeName, setRemoveName] = React.useState<string | null>(null)
  const requestEpoch = React.useRef(0)
  const draftRevision = React.useRef(0)
  const targetKeyValue = targetKey(target)
  const targetKeyRef = React.useRef(targetKeyValue)
  targetKeyRef.current = targetKeyValue
  const snapshotIsCurrent = snapshot !== null &&
    targetKey(snapshot.target) === targetKeyValue
  const parsed = React.useMemo(() => parseMcpConfigDocument(draftText), [draftText])
  const formSupported = structuredDocumentSupported(parsed)
  const dirty = Boolean(snapshotIsCurrent && draftText !== snapshot.content)
  const available = adapterDetected(runtime.commands)

  const updateDraft = React.useCallback((next: string) => {
    draftRevision.current += 1
    setDraftText(next)
  }, [])

  React.useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])

  React.useEffect(() => {
    if (view === 'form' && !formSupported) setView('json')
  }, [formSupported, view])

  const isCurrentRequest = React.useCallback((epoch: number, expectedTargetKey: string) => (
    epoch === requestEpoch.current && expectedTargetKey === targetKeyRef.current
  ), [])

  const load = React.useCallback(async (confirmDiscard = false) => {
    if (!adapter) return
    if (confirmDiscard && dirty && !window.confirm(t('settings.mcp.discardConfirm'))) return
    const epoch = ++requestEpoch.current
    const expectedTargetKey = targetKeyValue
    const expectedDraftRevision = draftRevision.current
    setLoading(true)
    setError(null)
    setStatus(null)
    try {
      const next = await adapter.load(target)
      if (
        !isCurrentRequest(epoch, expectedTargetKey) ||
        expectedDraftRevision !== draftRevision.current
      ) return
      setSnapshot(next)
      setDraftText(next.content)
      setView(structuredDocumentSupported(next) ? 'form' : 'json')
    } catch (caught) {
      if (isCurrentRequest(epoch, expectedTargetKey)) {
        setError(caught instanceof Error ? caught.message : t('settings.mcp.loadFailed'))
      }
    } finally {
      if (isCurrentRequest(epoch, expectedTargetKey)) setLoading(false)
    }
  }, [adapter, dirty, isCurrentRequest, t, target, targetKeyValue])

  React.useEffect(() => {
    requestEpoch.current += 1
    draftRevision.current += 1
    setSaving(false)
    setSnapshot(null)
    setDraftText('')
    setEditing(null)
    setFormOpen(false)
    setView('form')
    void load()
    // Loading is keyed only by the controlled target. Draft edits must not reload it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  const save = async (restart: boolean) => {
    if (
      !adapter ||
      !snapshot ||
      !snapshotIsCurrent ||
      !dirty ||
      !parsed.valid ||
      loading ||
      saving
    ) return
    const epoch = ++requestEpoch.current
    const expectedTargetKey = targetKeyValue
    const expectedDraftRevision = draftRevision.current
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      const result = await adapter.save(target, draftText, snapshot.fingerprint, restart)
      if (!isCurrentRequest(epoch, expectedTargetKey)) return
      setSnapshot(result.snapshot)
      if (expectedDraftRevision === draftRevision.current) {
        setDraftText(result.snapshot.content)
      }
      setStatus(t(`settings.mcp.apply.${result.apply}`))
      if (restart) await actions.refresh().catch(() => undefined)
    } catch (caught) {
      if (isCurrentRequest(epoch, expectedTargetKey)) {
        setError(caught instanceof Error ? caught.message : t('settings.mcp.saveFailed'))
      }
    } finally {
      if (isCurrentRequest(epoch, expectedTargetKey)) setSaving(false)
    }
  }

  const restartDetection = async () => {
    if (!adapter || loading || saving) return
    const epoch = ++requestEpoch.current
    const expectedTargetKey = targetKeyValue
    setLoading(true)
    setError(null)
    try {
      const result = await adapter.restart()
      if (!isCurrentRequest(epoch, expectedTargetKey)) return
      if (!result.restarted) throw new Error(result.error || t('settings.mcp.restartFailed'))
      await actions.refresh()
      setStatus(t('settings.mcp.restarted'))
    } catch (caught) {
      if (isCurrentRequest(epoch, expectedTargetKey)) {
        setError(caught instanceof Error ? caught.message : t('settings.mcp.restartFailed'))
      }
    } finally {
      if (isCurrentRequest(epoch, expectedTargetKey)) setLoading(false)
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
    <div className="min-w-0">
      <div className="flex flex-col gap-3 border-y border-border py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-title">{t('settings.mcp.servers')}</h3>
            <Badge variant={available ? 'secondary' : 'outline'}>
              {available ? t('settings.mcp.detected') : t('settings.mcp.notDetected')}
            </Badge>
            {extension.statuses.mcp && <span className="truncate text-micro text-muted-foreground">{extension.statuses.mcp}</span>}
          </div>
          <p className="mt-1 break-all font-mono text-micro text-muted-foreground">
            {snapshotIsCurrent
              ? displayMcpConfigPath(snapshot.target, snapshot.path)
              : t('settings.mcp.loading')}
          </p>
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
          <Button size="sm" disabled={!dirty || !parsed.valid || loading || saving} onClick={() => void save(true)}>
            {t('settings.mcp.saveRestart')}
          </Button>
        </div>
      </div>

      {!available && (
        <div className="flex flex-col gap-2 border-b border-border py-3 sm:flex-row sm:items-center sm:justify-between">
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
                  onClick={() => void navigator.clipboard.writeText(INSTALL_COMMAND).then(() => {
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1_500)
                  })}
                >
                  {copied ? <TbCheck aria-hidden /> : <TbCopy aria-hidden />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('settings.mcp.copyInstall')}</TooltipContent>
            </Tooltip>
            <Button variant="outline" size="sm" disabled={loading || saving || runtime.runtime?.state !== 'ready'} onClick={() => void restartDetection()}>
              <TbRefresh aria-hidden />
              {t('settings.mcp.refreshDetection')}
            </Button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
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
          {!formSupported && (
            <span className="text-micro text-muted-foreground">{t('settings.mcp.formUnavailable')}</span>
          )}
        </div>
        <Button variant="outline" size="sm" disabled={view !== 'form' || !formSupported} onClick={openAdd}>
          <TbPlus aria-hidden />
          {t('settings.mcp.addServer')}
        </Button>
      </div>

      {view === 'form'
        ? (
            <div className="mt-3 divide-y divide-border rounded-md border border-border">
              {parsed.servers.map((server) => {
                const enabled = server.definition.disabled !== true
                const editable = structuredSupported(server)
                return (
                  <div key={server.name} className="flex min-w-0 items-center gap-2 px-3 py-2.5">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate text-caption font-medium">{server.name}</span>
                      <Badge variant={server.transport === 'stdio' || server.transport === 'http' ? 'soft-info' : 'soft-warning'}>
                        {t(`settings.mcp.transport.${server.transport}`)}
                      </Badge>
                      <Badge variant="outline">{t(`settings.mcp.scope.${scope.kind}`)}</Badge>
                    </div>
                    <Switch
                      checked={enabled}
                      aria-label={`${server.name}: ${enabled ? t('settings.mcp.enabled') : t('settings.mcp.disabled')}`}
                      onCheckedChange={(checked) => toggleServerEnabled(server, checked)}
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={!editable}
                            aria-label={`${t('settings.mcp.editServer')} ${server.name}`}
                            onClick={() => openEdit(server)}
                          >
                            <TbEdit aria-hidden />
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {editable ? t('settings.mcp.editServer') : t('settings.mcp.unsupportedStructured')}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t('settings.mcp.removeServer')} ${server.name}`}
                          onClick={() => setRemoveName(server.name)}
                        >
                          <TbTrash aria-hidden />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('settings.mcp.removeServer')}</TooltipContent>
                    </Tooltip>
                  </div>
                )
              })}
              {parsed.servers.length === 0 && (
                <div className="grid min-h-44 place-items-center px-6 text-center text-caption text-muted-foreground">
                  {t('settings.mcp.noServers')}
                </div>
              )}
            </div>
          )
        : (
            <Textarea
              value={draftText}
              onChange={(event) => updateDraft(event.target.value)}
              spellCheck={false}
              aria-invalid={!parsed.valid}
              aria-label={t('settings.mcp.mode.json')}
              className="mt-3 min-h-[31rem] resize-y font-mono text-caption"
            />
          )}

      {parsed.diagnostics.length > 0 && (
        <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2" role="alert">
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
      {(error || status) && (
        <p className={cn('pt-2 text-caption', error ? 'text-destructive' : 'text-muted-foreground')} role={error ? 'alert' : 'status'}>
          {error ?? status}
        </p>
      )}

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
