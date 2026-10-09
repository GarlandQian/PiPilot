import * as React from 'react'
import { createMcpConfigAdapter, type McpConfigAdapter } from '@/renderer/adapters/mcp-config-adapter'
import { displayMcpConfigPath } from '@/renderer/mcp/mcp-path-presentation'
import type { ConfigurationDocument } from '@/renderer/configuration-documents'
import type { McpConfigSnapshot, McpConfigTarget } from '@/shared/mcp-config'
import { parseMcpConfigDocument, removeMcpServer, renameMcpServer, upsertMcpServer } from '@/shared/mcp-config-parser'
import { hasEnabledLegacyMcpAdapter, isNativeMcpCommand } from '@/shared/mcp-config-compatibility'
import type { PiIntegrationScope } from '@/shared/pi-integrations'
import { useConfigurationDocument } from '@/store/configuration-documents'
import { usePiIntegrations } from '@/store/pi-integrations'
import { usePiRpcActions, usePiRuntime } from '@/store/pi-rpc'
import { useWorkspaceStore } from '@/store/workspace'
import { useConfigApplyStatus } from '../useConfigApplyStatus'
import type { JsonRecord } from '../models/provider-editor-model'

export function mcpTargetFor(scope: PiIntegrationScope): McpConfigTarget {
  return scope.kind === 'global' ? { kind: 'global' } : { kind: 'project', workspaceId: scope.workspaceId }
}

export function mcpTargetKey(target: McpConfigTarget) {
  return target.kind === 'global' ? 'global' : `project:${target.workspaceId}`
}

export function useMcpManager(document: ConfigurationDocument<McpConfigSnapshot>, scope: PiIntegrationScope, active: boolean) {
  const runtime = usePiRuntime()
  const integrations = usePiIntegrations()
  const workspace = useWorkspaceStore()
  const actions = usePiRpcActions()
  const [adapter] = React.useState<McpConfigAdapter | null>(createMcpConfigAdapter)
  const target = React.useMemo(() => mcpTargetFor(scope), [scope])
  const { snapshot, draftText, dirty, phase, error: documentError, savedApply } = useConfigurationDocument(document, active)
  const targetKey = mcpTargetKey(target)
  const current = snapshot !== null && mcpTargetKey(snapshot.target) === targetKey
  const readApplySnapshot = React.useCallback(() => adapter!.load(target), [adapter, target])
  const apply = useConfigApplyStatus(targetKey, current ? snapshot : null, adapter ? readApplySnapshot : null)
  const loading = phase === 'loading' || (!snapshot && !documentError)
  const saving = phase === 'saving'
  const parsed = React.useMemo(() => parseMcpConfigDocument(draftText), [draftText])
  const [reloadOpen, setReloadOpen] = React.useState(false)
  const runtimeReady = runtime.runtime?.state === 'ready'
  const mcpCommand = runtimeReady ? runtime.commands.find((command) => command.name === 'mcp') : undefined
  // A project extension can also read the global MCP document. Protect that
  // shared file while restricting project documents to their own runtime.
  const runtimeScopeMatches = scope.kind === 'global' ||
    (workspace.activeScope.kind === 'project' && workspace.activeScope.workspaceId === scope.workspaceId)
  const runtimeOverride = runtimeScopeMatches && mcpCommand && !isNativeMcpCommand(mcpCommand)
  const legacyAdapterEnabled = integrations.snapshot ? hasEnabledLegacyMcpAdapter(integrations.snapshot) : false
  const writesBlocked = Boolean(runtimeOverride) || legacyAdapterEnabled
  const path = current ? displayMcpConfigPath(snapshot.target, snapshot.path, snapshot.displayPath) : null

  const load = React.useCallback(async (confirmDiscard = false) => {
    if (confirmDiscard && dirty) {
      setReloadOpen(true)
      return
    }
    await document.load(true)
  }, [dirty, document])

  /** Write the whole file and apply it (busy sessions pick it up when idle). */
  const persistText = async (next: string) => {
    if (!adapter || !current || writesBlocked || document.getSnapshot().phase !== 'idle') return false
    if (!document.updateDraft(next)) return false
    return await document.save(true) !== null
  }

  /** Save the draft as it is (the file page) and apply it. */
  const saveDraft = async () => {
    if (!adapter || !current || writesBlocked || document.getSnapshot().phase !== 'idle') return false
    return await document.save(true) !== null
  }

  const draftWithServer = (previousName: string | null, name: string, definition: JsonRecord, base = document.getSnapshot().draftText) => {
    let next = base
    if (previousName && previousName !== name) next = renameMcpServer(next, previousName, name)
    return upsertMcpServer(next, name, definition)
  }

  const saveServer = async (previousName: string | null, name: string, definition: JsonRecord) => {
    try {
      return await persistText(draftWithServer(previousName, name, definition))
    } catch {
      return false
    }
  }

  /** Several servers at once (pasted or imported); `replace` overwrites ones with the same name. */
  const addServers = async (servers: readonly { name: string; definition: JsonRecord }[]) => {
    try {
      let next = document.getSnapshot().draftText
      for (const server of servers) next = upsertMcpServer(next, server.name, server.definition)
      return await persistText(next)
    } catch {
      return false
    }
  }

  const removeServer = async (name: string) => {
    try {
      return await persistText(removeMcpServer(document.getSnapshot().draftText, name))
    } catch {
      return false
    }
  }

  const setEnabled = (name: string, enabled: boolean) => {
    const server = parsed.servers.find((candidate) => candidate.name === name)
    if (!server) return Promise.resolve(false)
    const definition = { ...server.definition }
    if (enabled) delete definition.enabled
    else definition.enabled = false
    return saveServer(name, name, definition)
  }

  /** Ask the running session to report its MCP connections. */
  const showRuntimeStatus = () => actions.send('/mcp', 'prompt')

  return {
    adapter, snapshot, draftText, dirty, phase, documentError, savedApply, apply, parsed, current, loading, saving,
    reloadOpen, setReloadOpen, writesBlocked, mcpCommand, runtimeReady, path, target,
    load, persistText, saveDraft, draftWithServer, saveServer, addServers, removeServer, setEnabled, showRuntimeStatus,
    updateDraft: document.updateDraft, view: document.getSnapshot().view, setView: document.setView,
    revertDraft: () => { const saved = document.getSnapshot().snapshot; if (saved) document.updateDraft(saved.content) },
  }
}

export type McpManager = ReturnType<typeof useMcpManager>
