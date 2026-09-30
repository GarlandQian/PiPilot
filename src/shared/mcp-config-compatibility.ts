import type { LocalPiSlashCommand } from './local-pi'
import type { PiIntegrationSnapshot } from './pi-integrations'

export function isNativeMcpCommand(command: LocalPiSlashCommand | undefined) {
  return command?.name === 'mcp' && command.sourceInfo.path === 'builtin:mcp'
}

export function hasEnabledLegacyMcpAdapter(snapshot: Pick<PiIntegrationSnapshot, 'packages' | 'resources'>) {
  const packages = new Set(snapshot.packages
    .filter((entry) => entry.displayName === 'pi-mcp-adapter' || /^npm:pi-mcp-adapter(?:@|$)/.test(entry.source))
    .map((entry) => entry.id))
  return snapshot.resources.some((resource) => resource.kind === 'extension' && resource.effectiveState !== 'disabled' && (
    (resource.packageId !== undefined && packages.has(resource.packageId)) ||
    /^npm:pi-mcp-adapter(?:@|$)/.test(resource.source)
  ))
}
