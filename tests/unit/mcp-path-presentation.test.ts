import { describe, expect, it } from 'vitest'
import {
  displayMcpConfigPath,
  GLOBAL_MCP_CONFIG_DISPLAY_PATH,
} from '../../src/renderer/mcp/mcp-path-presentation'

describe('MCP config path presentation', () => {
  it('uses the stable home-relative path for the global config', () => {
    expect(displayMcpConfigPath(
      { kind: 'global' },
      '/Users/example/.pi/agent/mcp.json',
    )).toBe(GLOBAL_MCP_CONFIG_DISPLAY_PATH)
  })

  it('keeps the resolved absolute path for a project config', () => {
    const resolvedPath = '/Volumes/Workspace/PiPilot/.mcp.json'

    expect(displayMcpConfigPath({
      kind: 'project',
      workspaceId: 'd9428888-122b-11e1-b85c-61cd3cbb3210',
    }, resolvedPath)).toBe(resolvedPath)
  })
})
