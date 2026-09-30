import { describe, expect, it } from 'vitest'
import {
  parseMcpConfigDocument,
  removeMcpServer,
  renameMcpServer,
  upsertMcpServer,
  convertMcpConfigToNativeJson,
  validateMcpServerDefinition,
} from '../../src/shared/mcp-config-parser'
import { opensMcpSettings } from '../../src/renderer/mcp/mcp-command-routing'

describe('MCP JSONC document parsing and edits', () => {
  it('projects native transports and retains unsupported legacy entries for correction', () => {
    const parsed = parseMcpConfigDocument(`{
      // shared configuration
      "settings": { "future": true },
      "mcpServers": {
        "stdio": { "command": "npx", "args": ["server"], "future": 1 },
        "remote": { "url": "https://example.test/mcp", "headers": { "Authorization": "\${TOKEN}" } },
        "socket": { "socket": "~/.mcp/example.sock" }
      }
    }`)

    expect(parsed.valid).toBe(false)
    expect(parsed.servers.map(({ name, transport }) => ({ name, transport }))).toEqual([
      { name: 'stdio', transport: 'stdio' },
      { name: 'remote', transport: 'http' },
      { name: 'socket', transport: 'invalid' },
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
      { name: 'empty', transport: 'invalid' },
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
    expect(parseMcpConfigDocument(removed)).toMatchObject({ valid: false, servers: [] })
    expect(parseMcpConfigDocument(convertMcpConfigToNativeJson(removed))).toMatchObject({ valid: true, servers: [] })
  })

  it('bounds diagnostics for very noisy but size-limited JSONC', () => {
    const entries = Array.from({ length: 2_100 }, (_, index) =>
      `"duplicate": { "command": "node-${index}" }`).join(',\n')
    const parsed = parseMcpConfigDocument(`{ "mcpServers": {\n${entries}\n} }`)

    expect(parsed.valid).toBe(false)
    expect(parsed.diagnostics).toHaveLength(2_000)
  })
})

describe('native MCP configuration', () => {
  it('keeps supported field validation aligned with the installed Pi SDK', async () => {
    const entry = import.meta.resolve('@earendil-works/pi-coding-agent')
    const source = new URL('./core/mcp-servers.js', entry).href
    const sdk = await import(/* @vite-ignore */ source) as { validateMcpServerConfig(name: string, value: unknown): unknown }
    const cases = [
      { command: 'node', args: ['server.js'], env: { TOKEN: '${TOKEN}' }, cwd: '~/project', enabled: false },
      { url: 'https://example.test/mcp', type: 'streamable-http', headers: { Authorization: '!credential-command' }, exposure: 'direct' },
      { command: 'node', exposure: 'codemode-deferred', timeout: 0.5, toolExposure: { 'read_*': 'hidden' } },
      { url: 'https://example.test/mcp', oauth: { clientId: 'test', clientSecret: '${SECRET}', scope: 'read', callbackUrl: 'http://[::1]:8080/callback', callbackPort: 8080 } },
      { command: 'node', args: [false] },
      { command: 'node', enabled: 'false' },
      { command: 'node', timeout: 0 },
      { command: 'node', exposure: 'not-supported' },
      { url: 'file:///tmp/mcp' },
      { url: 'https://example.test/mcp', type: 'sse' },
      { url: 'https://example.test/mcp', oauth: { callbackUrl: 'http://127.0.0.1:8080/callback', callbackPort: 9090 } },
      { url: 'https://example.test/mcp', oauth: { callbackUrl: 'http://127.0.0.1/callback?unsafe=1' } },
    ]
    for (const value of cases) {
      expect(validateMcpServerDefinition('docs', value) === null).toBe(typeof sdk.validateMcpServerConfig('docs', value) !== 'string')
    }
  })

  it('converts only an explicit draft without dropping unsupported fields or unknown data', () => {
    const legacy = '// old config\n{"mcpServers":{"docs":{"command":"node","disabled":true,"future":42,},"unix":{"socket":"x"}}}'
    const converted = convertMcpConfigToNativeJson(legacy)
    expect(JSON.parse(converted)).toEqual({ mcpServers: { docs: { command: 'node', enabled: false, future: 42 }, unix: { socket: 'x' } } })
    expect(legacy).toContain('// old config')
    expect(parseMcpConfigDocument(converted).valid).toBe(false)
    expect(() => convertMcpConfigToNativeJson('{"a":1,"a":2}')).toThrow()
    const conflict = convertMcpConfigToNativeJson('{"mcpServers":{"docs":{"command":"node","disabled":true,"enabled":true}}}')
    expect(JSON.parse(conflict).mcpServers.docs.disabled).toBe(true)
    expect(parseMcpConfigDocument(conflict).valid).toBe(false)
  })

  it('validates native exposure, OAuth, names, timeout, and strict JSON syntax', () => {
    expect(validateMcpServerDefinition('docs', { url: 'https://example.test/mcp', enabled: false, exposure: 'deferred', toolExposure: { 'read_*': 'direct' }, oauth: { clientId: 'x', callbackUrl: 'http://127.0.0.1:8765/callback', callbackPort: 8765 } })).toBeNull()
    for (const definition of [{ command: 'x', type: 'sse' }, { socket: '/tmp/x' }, { command: 'x', enabled: 'false' }, { command: 'x', timeout: 0 }, { command: 'x', exposure: 'other' }, { command: 'x', toolExposure: { read: 'other' } }, { url: 'file:///tmp/x' }, { url: 'https://example.test', oauth: { callbackUrl: 'https://example.test/callback' } }, { url: 'https://example.test', oauth: { callbackPort: 70000 } }]) {
      expect(validateMcpServerDefinition('docs', definition)).not.toBeNull()
    }
    expect(validateMcpServerDefinition('has space', { command: 'x' })).not.toBeNull()
    expect(parseMcpConfigDocument('{"mcpServers":{},}').valid).toBe(false)
    expect(parseMcpConfigDocument('// comment\n{"mcpServers":{}}').valid).toBe(false)
    expect(parseMcpConfigDocument('{"autoEnableCodemode":"false"}').valid).toBe(false)
  })
})

describe('MCP command routing', () => {
  it('routes only RPC-incompatible panel commands to Settings', () => {
    expect(opensMcpSettings('/mcp')).toBe(true)
    expect(opensMcpSettings(' /MCP ')).toBe(true)
    expect(opensMcpSettings('/mcp setup')).toBe(false)
    expect(opensMcpSettings('/mcp status')).toBe(false)
    expect(opensMcpSettings('/mcp-auth')).toBe(false)
    expect(opensMcpSettings('/mcp login docs')).toBe(false)
    expect(opensMcpSettings('/mcp logout docs')).toBe(false)
    expect(opensMcpSettings('/mcp tools')).toBe(false)
    expect(opensMcpSettings('/mcp reconnect docs')).toBe(false)
    expect(opensMcpSettings('/mcp-auth docs')).toBe(false)
  })
})
