import { describe, expect, it } from 'vitest'
import {
  displayMcpConfigPath,
} from '../../src/renderer/mcp/mcp-path-presentation'

describe('MCP config path presentation', () => {
  it('uses the stable home-relative path for the global config', () => {
    expect(displayMcpConfigPath(
      { kind: 'global' },
      '/Users/example/.pi/agent/mcp.json',
      '~/.pi/agent/mcp.json',
    )).toBe('~/.pi/agent/mcp.json')
  })

  it('never invents a default location for an overridden Agent directory', () => {
    const path = '/custom/pi-agent/mcp.json'
    expect(displayMcpConfigPath({ kind: 'global' }, path)).toBe(path)
    expect(displayMcpConfigPath({ kind: 'global' }, path, path)).toBe(path)
  })

  it('keeps the resolved absolute path for a project config', () => {
    const resolvedPath = '/Volumes/Workspace/PiPilot/.mcp.json'

    expect(displayMcpConfigPath({
      kind: 'project',
      workspaceId: 'd9428888-122b-11e1-b85c-61cd3cbb3210',
    }, resolvedPath)).toBe(resolvedPath)
  })
})
