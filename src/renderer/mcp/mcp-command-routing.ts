const MCP_SETTINGS_COMMANDS = new Set([
  '/mcp',
])

export function opensMcpSettings(text: string) {
  return MCP_SETTINGS_COMMANDS.has(text.trim().replace(/\s+/gu, ' ').toLowerCase())
}
