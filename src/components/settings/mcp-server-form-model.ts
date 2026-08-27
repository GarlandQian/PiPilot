import type { KeyValueRow } from '@/components/ui/form'
import type {
  McpConfigDiagnostic,
  McpConfigDocument,
  McpConfigServer,
} from '@/shared/mcp-config'
import type { McpServerFormValue } from './McpServerFormDialog'

/*
 * Pure form <-> JSONC-definition mapping helpers for the MCP single-draft
 * flow (design §9). The surface keeps one JSONC `draftText`; these helpers
 * convert between the structured form value and the contract definition so
 * the parser's comment-preserving transforms can produce the next draft.
 */

export function stringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
}

export function structuredSupported(server: McpConfigServer) {
  if (server.transport !== 'stdio' && server.transport !== 'http') return false
  const definition = server.definition
  const selectors = ['command', 'url', 'socket'] as const
  const presentSelectors = selectors.filter((field) =>
    Object.prototype.hasOwnProperty.call(definition, field))
  const expectedSelector = server.transport === 'stdio' ? 'command' : 'url'
  if (
    presentSelectors.length !== 1 ||
    presentSelectors[0] !== expectedSelector ||
    typeof definition[expectedSelector] !== 'string'
  ) return false
  if (definition.disabled !== undefined && typeof definition.disabled !== 'boolean') return false
  if (server.transport === 'stdio') {
    if (definition.args !== undefined && (!Array.isArray(definition.args) || definition.args.some((value) => typeof value !== 'string'))) return false
    if (definition.env !== undefined && !stringRecord(definition.env)) return false
    if (definition.cwd !== undefined && typeof definition.cwd !== 'string') return false
  }
  if (server.transport === 'http' && definition.headers !== undefined && !stringRecord(definition.headers)) return false
  return true
}

export function recoverableEndpointDiagnostic(
  server: McpConfigServer,
  diagnostic: McpConfigDiagnostic,
) {
  if (diagnostic.code !== 'MCP_TRANSPORT_VALUE_INVALID') return false
  if (server.transport !== 'stdio' && server.transport !== 'http') return false
  const endpointField = server.transport === 'stdio' ? 'command' : 'url'
  return diagnostic.path === `mcpServers.${server.name}.${endpointField}` &&
    typeof server.definition[endpointField] === 'string' &&
    server.definition[endpointField].trim().length === 0
}

export function structuredDocumentSupported(document: McpConfigDocument) {
  if (document.valid) return true
  if (document.servers.length === 0 || !document.servers.every(structuredSupported)) return false
  return document.diagnostics.every((diagnostic) =>
    document.servers.some((server) => recoverableEndpointDiagnostic(server, diagnostic)))
}

export function rowsToRecord(rows: readonly KeyValueRow[]) {
  const record: Record<string, string> = {}
  for (const row of rows) record[row.key] = row.value
  return record
}

export function recordToRows(value: unknown): KeyValueRow[] {
  if (!stringRecord(value)) return []
  return Object.entries(value).map(([key, entry]) => ({ key, value: entry }))
}

export function formValueFromServer(server: McpConfigServer): McpServerFormValue {
  const definition = server.definition
  return {
    name: server.name,
    transport: server.transport === 'http' ? 'http' : 'stdio',
    command: typeof definition.command === 'string' ? definition.command : '',
    args: Array.isArray(definition.args)
      ? definition.args.filter((value): value is string => typeof value === 'string')
      : [],
    env: recordToRows(definition.env),
    cwd: typeof definition.cwd === 'string' ? definition.cwd : '',
    url: typeof definition.url === 'string' ? definition.url : '',
    headers: recordToRows(definition.headers),
    enabled: definition.disabled !== true,
    description: typeof definition.description === 'string' ? definition.description : '',
  }
}

/**
 * Map a submitted form value onto the contract definition shape (design §9).
 * When editing, start from the existing definition so unknown fields survive
 * the form round-trip; only the fields the form owns are rewritten.
 */
export function definitionFromFormValue(
  value: McpServerFormValue,
  existing?: McpConfigServer,
): Record<string, unknown> {
  const definition: Record<string, unknown> = existing ? { ...existing.definition } : {}
  for (const field of ['command', 'url', 'socket', 'args', 'env', 'cwd', 'headers', 'disabled', 'description']) {
    delete definition[field]
  }
  if (value.transport === 'stdio') {
    definition.command = value.command
    if (value.args.length > 0) definition.args = value.args
    const env = rowsToRecord(value.env)
    if (Object.keys(env).length > 0) definition.env = env
    if (value.cwd.length > 0) definition.cwd = value.cwd
  } else {
    definition.url = value.url
    const headers = rowsToRecord(value.headers)
    if (Object.keys(headers).length > 0) definition.headers = headers
  }
  if (!value.enabled) definition.disabled = true
  if (value.description.length > 0) definition.description = value.description
  return definition
}
