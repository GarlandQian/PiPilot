import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mcpImportCandidates, readMcpImportSources } from '../../src/main/mcp/mcp-import-sources'

let home: string | null = null
afterEach(async () => { if (home) await rm(home, { recursive: true, force: true }) })

describe('other apps’ MCP servers', () => {
  it('finds each app’s file for the platform', () => {
    const paths = (platform: NodeJS.Platform, environment: NodeJS.ProcessEnv = {}) => mcpImportCandidates(platform, '/home/u', environment).map((candidate) => candidate.path)
    expect(paths('darwin')).toContain('/home/u/Library/Application Support/Claude/claude_desktop_config.json')
    expect(paths('linux', { XDG_CONFIG_HOME: '/cfg' })).toContain('/cfg/Code/User/mcp.json')
    expect(paths('linux', { CODEX_HOME: '/codex' })).toContain('/codex/config.toml')
  })

  it('reads what exists, skips what does not, and reports what it cannot read', async () => {
    home = await mkdtemp(join(tmpdir(), 'pipilot-mcp-import-'))
    await mkdir(join(home, '.cursor'), { recursive: true })
    await mkdir(join(home, '.codex'), { recursive: true })
    await mkdir(join(home, '.gemini'), { recursive: true })
    await writeFile(join(home, '.cursor', 'mcp.json'), '{ "mcpServers": { "browser": { "command": "npx", "args": ["@playwright/mcp"] } } }')
    await writeFile(join(home, '.codex', 'config.toml'), '[mcp_servers.docs]\ncommand = "uvx"\nargs = ["mcp-server-fetch"]\n')
    await writeFile(join(home, '.claude.json'), '{ broken')
    // A settings file without servers is not listed.
    await writeFile(join(home, '.gemini', 'settings.json'), '{ "theme": "dark" }')
    const { sources } = await readMcpImportSources(mcpImportCandidates('linux', home, {}))
    expect(sources.map((source) => [source.app, source.servers.map((server) => server.name), source.error])).toEqual([
      ['claude-code', [], 'unreadable'],
      ['codex', ['docs'], undefined],
      ['cursor', ['browser'], undefined],
    ])
  })
})
