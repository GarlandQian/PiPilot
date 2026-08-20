import type { McpConfigTarget } from '@/shared/mcp-config'

export const GLOBAL_MCP_CONFIG_DISPLAY_PATH = '~/.pi/agent/mcp.json'

export function displayMcpConfigPath(
  target: McpConfigTarget,
  resolvedPath: string,
) {
  return target.kind === 'global'
    ? GLOBAL_MCP_CONFIG_DISPLAY_PATH
    : resolvedPath
}
