import { describe, expect, it } from 'vitest'
import { parseMcpConfigDocument, upsertMcpServer } from '../../src/shared/mcp-config-parser'
import { mcpServerName, parseCodexMcpToml, parseMcpImport, splitCommandLine } from '../../src/shared/mcp-import'
import { templateForServer, MCP_TEMPLATES } from '../../src/shared/mcp-templates'
import { MASKED_SECRET } from '../../src/components/settings/models/provider-editor-model'
import {
  argsFromLines, maskMcpSecrets, mcpEditorIssues, preparedMcpDefinition, preservedFields, restoreMcpSecrets, uniqueMcpName, withMcpEnabled, withTransport,
} from '../../src/components/settings/mcp/mcp-editor-model'
import { filterServers } from '../../src/components/settings/mcp/McpServerList'

describe('MCP server page model', () => {
  it('keeps comments and every field it does not show when a server is saved', () => {
    const draft = `{
  "mcpServers": {
    "docs": {
      // endpoint comment
      "command": "npx",
      "args": ["serve"],
      "toolExposure": { "delete_*": "hidden" },
      "description": "remark"
    }
  }
}
`
    const server = parseMcpConfigDocument(draft).servers[0]!
    expect(preservedFields(server.definition)).toEqual(['toolExposure'])
    const next = upsertMcpServer(draft, 'docs', preparedMcpDefinition({ ...server.definition, args: argsFromLines('serve\n\n --port \n8080\n') }))
    expect(next).toContain('// endpoint comment')
    expect(parseMcpConfigDocument(next).servers[0]!.definition).toEqual({
      command: 'npx', args: ['serve', '--port', '8080'], toolExposure: { 'delete_*': 'hidden' }, description: 'remark',
    })
  })

  it('switches between a program and a service, and back, without losing either side', () => {
    const stdio = { command: 'npx', args: ['-y', 'pkg'], env: { A: '1' }, type: 'stdio', exposure: 'direct' }
    const toHttp = withTransport(stdio, 'http', {})
    expect(toHttp.definition).toEqual({ url: '', exposure: 'direct' })
    const back = withTransport({ ...toHttp.definition, url: 'https://x.example/mcp' }, 'stdio', toHttp.stash)
    expect(back.definition).toEqual({ command: 'npx', args: ['-y', 'pkg'], env: { A: '1' }, exposure: 'direct' })
    expect(back.stash).toEqual({ url: 'https://x.example/mcp' })
  })

  it('hides literal secrets in the JSON view and keeps them when left masked', () => {
    const definition = { command: 'x', env: { GITHUB_TOKEN: 'ghp_secret', REGION: 'eu', API_KEY: '${API_KEY}' }, headers: { Authorization: 'Bearer abc' } }
    const masked = maskMcpSecrets(definition)
    expect(masked).toEqual({ command: 'x', env: { GITHUB_TOKEN: MASKED_SECRET, REGION: 'eu', API_KEY: '${API_KEY}' }, headers: { Authorization: MASKED_SECRET } })
    expect(restoreMcpSecrets(masked, definition)).toEqual(definition)
    expect(restoreMcpSecrets({ ...masked, env: { ...masked.env as object, GITHUB_TOKEN: 'ghp_new' } }, definition).env).toMatchObject({ GITHUB_TOKEN: 'ghp_new' })
  })

  it('names what is missing, and leaves the rest to what Pi says', () => {
    expect(mcpEditorIssues('', { command: '' }, [], null)).toEqual({ name: 'required', command: 'required' })
    expect(mcpEditorIssues('bad name', { url: 'ftp://x' }, [], null)).toEqual({ name: 'invalid', url: 'invalid' })
    expect(mcpEditorIssues('Docs', { command: 'npx', timeout: 0 }, ['docs'], null)).toEqual({ name: 'taken', timeout: 'invalid' })
    expect(mcpEditorIssues('docs', { command: 'npx' }, [], 'Server args must be an array of strings.')).toEqual({ pi: 'Server args must be an array of strings.' })
    expect(uniqueMcpName('playwright', ['Playwright'])).toBe('playwright-2')
  })

  it('edits project overrides without inventing a transport or losing explicit enablement', () => {
    const override = { enabled: false, exposure: 'deferred', toolExposure: { 'delete_*': 'hidden' } }
    expect(mcpEditorIssues('docs', override, [], null, undefined, 'project')).toEqual({})
    expect(mcpEditorIssues('docs', override, [], null, undefined, 'global')).toEqual({ command: 'required' })
    const enabled = withMcpEnabled(override, true, 'project')
    expect(enabled).toEqual({ ...override, enabled: true })
    expect(override.enabled).toBe(false)
    const draft = JSON.stringify({ mcpServers: { docs: override, own: { command: 'node', args: ['own.js'] } } })
    const saved = upsertMcpServer(draft, 'docs', preparedMcpDefinition(enabled))
    const parsed = parseMcpConfigDocument(saved, 'project')
    expect(parsed.valid).toBe(true)
    expect(parsed.servers[0]).toMatchObject({ name: 'docs', transport: 'override', definition: enabled })
    expect(parsed.servers[1]?.definition).toEqual({ command: 'node', args: ['own.js'] })
    expect(withMcpEnabled({ command: 'node', enabled: false }, true, 'project')).toEqual({ command: 'node' })
  })

  it('preserves native HTTP provider authentication and OAuth metadata during form edits', () => {
    const definition = {
      url: ' https://example.test/mcp ', auth: { provider: 'openai' },
      oauth: { clientName: 'PiPilot', authServerMetadataUrl: 'https://auth.example.test/.well-known/oauth-authorization-server' },
    }
    expect(preparedMcpDefinition(definition)).toEqual({ ...definition, url: 'https://example.test/mcp' })
    expect(preservedFields(definition)).toEqual(['auth', 'oauth'])
  })

  it('searches names, commands and descriptions, never credentials', () => {
    const servers = parseMcpConfigDocument(JSON.stringify({ mcpServers: {
      browser: { command: 'npx', args: ['@playwright/mcp'], env: { TOKEN: 'never-search-this' } },
      docs: { url: 'https://docs.example/mcp', headers: { Authorization: 'never-search-this-either' }, description: 'Company handbook' },
    } })).servers
    expect(filterServers(servers, 'playwright').map((server) => server.name)).toEqual(['browser'])
    expect(filterServers(servers, 'handbook').map((server) => server.name)).toEqual(['docs'])
    expect(filterServers(servers, 'never-search')).toEqual([])
  })

  it('recognises servers made from a template', () => {
    expect(templateForServer({ command: 'npx', args: ['-y', '@playwright/mcp'] })?.key).toBe('playwright')
    expect(templateForServer({ url: 'https://api.githubcopilot.com/mcp/' })?.key).toBe('github')
    expect(templateForServer({ command: 'npx', args: ['-y', 'something-else'] })).toBeNull()
    for (const template of MCP_TEMPLATES) expect(parseMcpConfigDocument(JSON.stringify({ mcpServers: { [template.name]: template.definition } })).valid, template.key).toBe(true)
  })
})

describe('MCP import', () => {
  it('reads Claude, Cursor and bare server maps', () => {
    expect(parseMcpImport('{ "mcpServers": { "fs": { "type": "stdio", "command": "npx", "args": ["-y", "pkg"], "env": {} } } }')).toEqual({
      format: 'mcpServers', servers: [{ name: 'fs', definition: { command: 'npx', args: ['-y', 'pkg'] }, notes: [] }],
    })
    expect(parseMcpImport('{ "remote": { "type": "sse", "url": "https://x.example/sse" } }')?.servers[0]).toEqual({
      name: 'remote', definition: { url: 'https://x.example/sse' }, notes: [{ kind: 'sse' }],
    })
  })

  it('converts VS Code, Gemini, Windsurf and opencode shapes', () => {
    expect(parseMcpImport('{ "servers": { "gh": { "type": "http", "url": "https://api.example/mcp", "headers": { "Authorization": "Bearer ${input:gh-token}" } } }, "inputs": [] }')?.servers[0]).toEqual({
      name: 'gh', definition: { url: 'https://api.example/mcp', headers: { Authorization: 'Bearer ${GH_TOKEN}' } }, notes: [{ kind: 'input-variables' }],
    })
    expect(parseMcpImport('{ "mcpServers": { "g": { "httpUrl": "https://g.example/mcp", "timeout": 30000, "trust": true } } }')?.servers[0]?.definition).toEqual({ url: 'https://g.example/mcp', timeout: 30 })
    expect(parseMcpImport('{ "mcpServers": { "w": { "serverUrl": "https://w.example/mcp" } } }')?.servers[0]?.definition).toEqual({ url: 'https://w.example/mcp' })
    expect(parseMcpImport('{ "mcp": { "local": { "type": "local", "command": ["bunx", "tool", "--key", "{env:KEY}"], "environment": { "A": "{env:A}" }, "enabled": false } } }')?.servers[0]).toEqual({
      name: 'local', definition: { command: 'bunx', args: ['tool', '--key', '${KEY}'], env: { A: '${A}' }, enabled: false }, notes: [],
    })
  })

  it('reads Codex TOML, its sub-tables and its HTTP options', () => {
    const toml = `model = "o3"
[mcp_servers.docs]
command = "npx"
args = [
  "-y", # the package
  "@upstash/context7-mcp",
]
tool_timeout_sec = 45

[mcp_servers.docs.env]
TOKEN = 'abc'

[mcp_servers.remote]
url = "https://remote.example/mcp"
bearer_token_env_var = "REMOTE_TOKEN"
http_headers = { "X-Team" = "blue" }
`
    expect(parseCodexMcpToml(toml)).toMatchObject({ docs: { command: 'npx', env: { TOKEN: 'abc' } } })
    expect(parseMcpImport(toml)?.servers).toEqual([
      { name: 'docs', definition: { command: 'npx', args: ['-y', '@upstash/context7-mcp'], env: { TOKEN: 'abc' }, timeout: 45 }, notes: [] },
      { name: 'remote', definition: { url: 'https://remote.example/mcp', headers: { 'X-Team': 'blue', Authorization: 'Bearer ${REMOTE_TOKEN}' } }, notes: [] },
    ])
  })

  it('turns one command line into a server, CLI add commands included', () => {
    expect(splitCommandLine(`npx -y "@scope/pkg name" 'a b' c\\ d`)).toEqual(['npx', '-y', '@scope/pkg name', 'a b', 'c d'])
    expect(parseMcpImport('npx -y @playwright/mcp@latest')?.servers[0]).toEqual({ name: 'playwright', definition: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] }, notes: [] })
    expect(parseMcpImport('claude mcp add fs -s user -- npx -y @modelcontextprotocol/server-filesystem ~/code')?.servers[0]).toMatchObject({ name: 'fs', definition: { command: 'npx' } })
    expect(parseMcpImport('uvx mcp-server-fetch')?.servers[0]?.name).toBe('fetch')
    expect(parseMcpImport('not { json')).toBeNull()
    expect(mcpServerName('my server.v2')).toBe('my-server-v2')
  })
})
