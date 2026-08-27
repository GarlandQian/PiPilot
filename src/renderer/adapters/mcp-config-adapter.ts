import type { PiPilotApi } from '@/shared/pipilot-api'

export type McpConfigAdapter = PiPilotApi['mcpConfig']

export function createMcpConfigAdapter(): McpConfigAdapter | null {
  return typeof window !== 'undefined' && window.pipilot
    ? window.pipilot.mcpConfig
    : null
}
