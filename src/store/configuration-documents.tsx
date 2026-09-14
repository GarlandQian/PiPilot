import * as React from 'react'
import { ConfigurationExitDialog } from '@/components/settings/ConfigurationExitDialog'
import { ConfigurationDocumentExitGuard } from '@/renderer/configuration-document-exit'
import { ConfigurationEditTransactions, type ConfigurationEditTransaction } from '@/renderer/configuration-edit-transactions'
import { createMcpConfigAdapter } from '@/renderer/adapters/mcp-config-adapter'
import { createModelsConfigAdapter } from '@/renderer/adapters/models-config-adapter'
import {
  ConfigurationDocumentRegistry,
  isConfigDocumentDirty,
  type ConfigurationDocument,
  type ConfigDocumentSnapshot,
} from '@/renderer/configuration-documents'
import { MCP_CONFIG_CONTENT_LIMIT, mcpConfigTargetSchema, type McpConfigSnapshot, type McpConfigTarget } from '@/shared/mcp-config'
import { MODELS_CONFIG_CONTENT_LIMIT, type ModelsConfigSnapshot } from '@/shared/models-config'

function createConfigurationDocuments() {
  return {
    mcpAdapter: createMcpConfigAdapter(),
    modelsAdapter: createModelsConfigAdapter(),
    mcp: new ConfigurationDocumentRegistry<McpConfigSnapshot>(8, MCP_CONFIG_CONTENT_LIMIT),
    models: new ConfigurationDocumentRegistry<ModelsConfigSnapshot>(1, MODELS_CONFIG_CONTENT_LIMIT),
    edits: new ConfigurationEditTransactions(),
  }
}

const ConfigurationDocumentsContext = React.createContext<ReturnType<typeof createConfigurationDocuments> | null>(null)

export function ConfigurationDocumentsProvider({ children }: { children: React.ReactNode }) {
  const [documents] = React.useState(createConfigurationDocuments)
  const [exitGuard] = React.useState(() => new ConfigurationDocumentExitGuard([documents.mcp, documents.models], documents.edits))
  return <ConfigurationDocumentsContext.Provider value={documents}>
    {children}
    <ConfigurationExitDialog guard={exitGuard} />
  </ConfigurationDocumentsContext.Provider>
}

/** Keep open, unsubmitted form fields within the same explicit Quit transaction. */
export function useConfigurationEditTransaction(open: boolean, transaction: ConfigurationEditTransaction) {
  const context = React.useContext(ConfigurationDocumentsContext)
  const registry = context?.edits
  const [owner] = React.useState(() => ({}))
  const current = React.useRef(transaction)
  current.current = transaction
  React.useLayoutEffect(() => {
    registry?.update(owner, open ? {
      dirty: transaction.dirty,
      revision: transaction.revision,
      commit: () => current.current.commit(),
    } : null)
  }, [open, owner, registry, transaction.dirty, transaction.revision])
  React.useLayoutEffect(() => () => registry?.update(owner, null), [owner, registry])
  return React.useSyncExternalStore(
    registry?.subscribe ?? (() => () => undefined),
    registry?.isLocked ?? (() => false),
    () => false,
  )
}

function useDocuments() {
  const documents = React.useContext(ConfigurationDocumentsContext)
  if (!documents) throw new Error('Configuration document views require ConfigurationDocumentsProvider')
  return documents
}

export function useModelsConfigurationDocument() {
  const documents = useDocuments()
  const adapter = documents.modelsAdapter
  const document = adapter ? documents.models.get('global', {
    load: () => adapter.load({ kind: 'global' }),
    save: (content, fingerprint, apply) => apply
      ? adapter.saveAndRestart({ kind: 'global' }, content, fingerprint)
      : adapter.save({ kind: 'global' }, content, fingerprint),
  }) : null
  return { document, available: Boolean(adapter) }
}

export function useMcpConfigurationDocument(target: McpConfigTarget) {
  const documents = useDocuments()
  const adapter = documents.mcpAdapter
  const validated = mcpConfigTargetSchema.parse(target)
  const key = validated.kind === 'global' ? 'global' : `project:${validated.workspaceId}`
  const document = adapter ? documents.mcp.get(key, {
    load: () => adapter.load(validated),
    save: (content, fingerprint, apply) => adapter.save(validated, content, fingerprint, apply),
  }) : null
  return { document, available: Boolean(adapter) }
}

export function useConfigurationDocument<TSnapshot extends ConfigDocumentSnapshot>(
  document: ConfigurationDocument<TSnapshot>,
  active: boolean,
) {
  const state = React.useSyncExternalStore(document.subscribe, document.getSnapshot, document.getSnapshot)
  React.useEffect(() => {
    if (active) void document.load()
  }, [active, document])
  return { ...state, dirty: isConfigDocumentDirty(state), document }
}
