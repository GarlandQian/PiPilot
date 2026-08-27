import { describe, expect, it } from 'vitest'
import {
  parseMcpConfigDocument,
  removeMcpServer,
  renameMcpServer,
  upsertMcpServer,
} from '../../src/shared/mcp-config-parser'
import { opensMcpSettings } from '../../src/renderer/mcp/mcp-command-routing'

describe('MCP JSONC document parsing and edits', () => {
  it('projects stdio, HTTP, and socket servers while preserving open fields', () => {
    const parsed = parseMcpConfigDocument(`{
      // shared configuration
      "settings": { "future": true },
      "mcpServers": {
        "stdio": { "command": "npx", "args": ["server"], "future": 1 },
        "remote": { "url": "https://example.test/mcp", "headers": { "Authorization": "\${TOKEN}" } },
        "socket": { "socket": "~/.mcp/example.sock" }
      }
    }`)

    expect(parsed.valid).toBe(true)
    expect(parsed.servers.map(({ name, transport }) => ({ name, transport }))).toEqual([
      { name: 'stdio', transport: 'stdio' },
      { name: 'remote', transport: 'http' },
      { name: 'socket', transport: 'socket' },
    ])
    expect(parsed.servers[0]?.definition.future).toBe(1)
  })

  it('rejects duplicate keys, malformed transports, and typed common fields', () => {
    const parsed = parseMcpConfigDocument(`{
      "mcpServers": {
        "same": { "command": "one" },
        "same": { "url": "https://example.test", "command": "two", "args": [1] }
      }
    }`)

    expect(parsed.valid).toBe(false)
    expect(parsed.diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        'MCP_DUPLICATE_KEY',
        'MCP_TRANSPORT_INVALID',
        'MCP_ARGS_INVALID',
      ]),
    )
  })

  it('rejects empty or wrongly typed transport selectors even beside one valid selector', () => {
    const parsed = parseMcpConfigDocument(`{
      "mcpServers": {
        "typed": { "url": "https://example.test/mcp", "command": 42 },
        "empty": { "socket": "./server.sock", "url": "  " }
      }
    }`)

    expect(parsed.valid).toBe(false)
    expect(parsed.servers.map(({ name, transport }) => ({ name, transport }))).toEqual([
      { name: 'typed', transport: 'http' },
      { name: 'empty', transport: 'socket' },
    ])
    expect(parsed.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'MCP_TRANSPORT_VALUE_INVALID',
        path: 'mcpServers.typed.command',
      }),
      expect.objectContaining({
        code: 'MCP_TRANSPORT_VALUE_INVALID',
        path: 'mcpServers.empty.url',
      }),
    ]))
  })

  it('keeps one blank selector attached to its transport without a duplicate server error', () => {
    const parsed = parseMcpConfigDocument(`{
      "mcpServers": {
        "remote": {
          "url": ""
        }
      }
    }`)

    expect(parsed.valid).toBe(false)
    expect(parsed.servers).toEqual([
      expect.objectContaining({ name: 'remote', transport: 'http' }),
    ])
    expect(parsed.diagnostics).toEqual([
      expect.objectContaining({
        code: 'MCP_TRANSPORT_VALUE_INVALID',
        line: 4,
        path: 'mcpServers.remote.url',
      }),
    ])
  })

  it('keeps comments and unknown document/server fields through structured edits', () => {
    const source = `{
  // keep this comment
  "settings": { "future": true },
  "mcpServers": {
    "docs": {
      // keep this server comment
      "command": "old",
      "future": {
        // keep this nested comment
        "enabled": true
      }
    }
  }
}\n`
    const updated = upsertMcpServer(source, 'docs', {
      command: 'new',
      future: { enabled: true },
    })
    const renamed = renameMcpServer(updated, 'docs', 'documentation')
    const removed = removeMcpServer(renamed, 'documentation')

    expect(updated).toContain('// keep this comment')
    expect(updated).toContain('// keep this server comment')
    expect(updated).toContain('// keep this nested comment')
    expect(updated).toContain('"settings": { "future": true }')
    expect(parseMcpConfigDocument(updated).servers[0]?.definition).toMatchObject({
      command: 'new',
      future: { enabled: true },
    })
    expect(renamed).toContain('// keep this server comment')
    expect(renamed).toContain('// keep this nested comment')
    expect(parseMcpConfigDocument(renamed).servers[0]?.name).toBe('documentation')
    expect(parseMcpConfigDocument(removed)).toMatchObject({ valid: true, servers: [] })
  })

  it('bounds diagnostics for very noisy but size-limited JSONC', () => {
    const entries = Array.from({ length: 2_100 }, (_, index) =>
      `"duplicate": { "command": "node-${index}" }`).join(',\n')
    const parsed = parseMcpConfigDocument(`{ "mcpServers": {\n${entries}\n} }`)

    expect(parsed.valid).toBe(false)
    expect(parsed.diagnostics).toHaveLength(2_000)
  })
})

describe('MCP command routing', () => {
  it('routes only RPC-incompatible panel commands to Settings', () => {
    expect(opensMcpSettings('/mcp')).toBe(true)
    expect(opensMcpSettings(' /MCP   setup ')).toBe(true)
    expect(opensMcpSettings('/mcp status')).toBe(true)
    expect(opensMcpSettings('/mcp-auth')).toBe(true)
    expect(opensMcpSettings('/mcp tools')).toBe(false)
    expect(opensMcpSettings('/mcp reconnect docs')).toBe(false)
    expect(opensMcpSettings('/mcp-auth docs')).toBe(false)
  })
})
