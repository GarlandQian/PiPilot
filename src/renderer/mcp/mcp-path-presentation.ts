import type { McpConfigTarget } from '@/shared/mcp-config'

export function displayMcpConfigPath(
  target: McpConfigTarget,
  resolvedPath: string,
  displayPath?: string,
) {
  return target.kind === 'global'
    ? displayPath ?? resolvedPath
    : resolvedPath
}
