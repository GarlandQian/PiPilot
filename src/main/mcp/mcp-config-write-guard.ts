import type { ConversationScope } from '../../shared/conversation-scope'
import type { LocalPiRuntimeSnapshot } from '../../shared/local-pi'
import type { McpConfigTarget } from '../../shared/mcp-config'
import { hasEnabledLegacyMcpAdapter, isNativeMcpCommand } from '../../shared/mcp-config-compatibility'
import type { PiIntegrationScope, PiIntegrationSnapshot } from '../../shared/pi-integrations'
import { McpConfigError } from './mcp-config-service'

interface McpWriteGuardSources {
  loadIntegrations(scope: PiIntegrationScope): Promise<PiIntegrationSnapshot>
  getRuntime(): { scope: ConversationScope; snapshot: Pick<LocalPiRuntimeSnapshot, 'state' | 'commands'> } | undefined
}

/** Check current package state without starting a conversation or loading extensions. */
export function createMcpConfigWriteGuard(sources: McpWriteGuardSources) {
  return async (target: McpConfigTarget) => {
    const integrations = await sources.loadIntegrations(target)
    if (integrations.state !== 'ready') {
      throw new McpConfigError('MCP_CONFIG_RUNTIME_UNAVAILABLE', 'Pi package state could not be checked. Refresh Integrations before saving native MCP configuration.')
    }
    const runtime = sources.getRuntime()
    const relevantRuntime = runtime && (target.kind === 'global' ||
      (runtime.scope.kind === 'project' && runtime.scope.workspaceId === target.workspaceId))
    const command = relevantRuntime && runtime.snapshot.state === 'ready'
      ? runtime.snapshot.commands.find((entry) => entry.name === 'mcp') : undefined
    if (hasEnabledLegacyMcpAdapter(integrations) || (command && !isNativeMcpCommand(command))) {
      throw new McpConfigError('MCP_CONFIG_EXTENSION_OVERRIDE', 'An enabled extension replaces native MCP. Disable or uninstall it in Packages and reload Pi before saving native MCP configuration. Your draft has not been written.')
    }
  }
}
