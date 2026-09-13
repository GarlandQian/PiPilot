import { describe, expect, it } from 'vitest'
import {
  parseMcpConfigDocument,
  renameMcpServer,
  upsertMcpServer,
} from '../../src/shared/mcp-config-parser'
import {
  definitionFromFormValue,
  formValueFromServer,
  getMcpFormErrors,
  rowsToRecord,
  structuredDocumentSupported,
} from '../../src/components/settings/mcp-server-form-model'
import type { McpServerFormValue } from '../../src/components/settings/McpServerFormDialog'

const STDIO_VALUE: McpServerFormValue = {
  name: 'docs',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@example/mcp-docs'],
  env: [{ key: 'TOKEN', value: '${TOKEN}' }],
  cwd: '/srv/docs',
  url: '',
  headers: [],
  enabled: true,
  description: '',
}

describe('MCP form <-> draft sync', () => {
  it('validates only fields belonging to the active transport', () => {
    expect(getMcpFormErrors({ ...STDIO_VALUE, headers: [{ key: '', value: '' }] }, [])).toEqual({})
    expect(getMcpFormErrors({ ...STDIO_VALUE, transport: 'http', command: '', env: [{ key: '', value: '' }], url: 'https://example.test/mcp' }, [])).toEqual({})
  })

  it('reports empty and duplicate keys without silently overwriting rows', () => {
    expect(getMcpFormErrors({ ...STDIO_VALUE, env: [{ key: ' TOKEN ', value: 'a' }, { key: 'TOKEN', value: 'b' }] }, [])).toEqual({ env: 'settings.integrations.mcp.form.duplicateKey' })
    expect(getMcpFormErrors({ ...STDIO_VALUE, transport: 'http', url: 'https://example.test', headers: [{ key: 'Authorization', value: 'a' }, { key: 'authorization', value: 'b' }] }, [])).toEqual({ headers: 'settings.integrations.mcp.form.duplicateKey' })
    expect(getMcpFormErrors({ ...STDIO_VALUE, env: [{ key: ' ', value: 'a' }] }, [])).toEqual({ env: 'mcp.form.kv.emptyKey' })
  })

  it('checks the endpoint and excludes only the edited server from duplicate names', () => {
    expect(getMcpFormErrors({ ...STDIO_VALUE, name: ' DOCS ' }, ['docs'], 'docs')).toEqual({})
    expect(getMcpFormErrors({ ...STDIO_VALUE, name: ' DOCS ' }, ['docs'])).toEqual({ name: 'mcp.form.name.duplicate' })
    expect(getMcpFormErrors({ ...STDIO_VALUE, name: '', command: '' }, [])).toEqual({ name: 'mcp.form.name.required', command: 'mcp.form.command.required' })
    expect(getMcpFormErrors({ ...STDIO_VALUE, transport: 'http', url: 'file:///fixture' }, [])).toEqual({ url: 'mcp.form.url.invalid' })
  })

  it('preserves literal arguments and safely represents environment keys', () => {
    const args = ['--message', ' padded text ', '']
    expect(definitionFromFormValue({ ...STDIO_VALUE, args }).args).toEqual(args)
    const env = rowsToRecord([{ key: '__proto__', value: 'literal' }])
    expect(Object.getPrototypeOf(env)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(env, '__proto__')).toBe(true)
    expect(JSON.stringify(env)).toBe('{"__proto__":"literal"}')
  })

  it('round-trips a form add through JSONC preserving comments and unknown fields', () => {
    const draft = `{
  // keep this comment
  "mcpServers": {
    "existing": { "command": "uvx", "args": ["serve"], "timeout": 30 }
  }
}
`
    const next = upsertMcpServer(draft, STDIO_VALUE.name, definitionFromFormValue(STDIO_VALUE))

    expect(next).toContain('// keep this comment')
    const parsed = parseMcpConfigDocument(next)
    expect(parsed.valid).toBe(true)
    expect(structuredDocumentSupported(parsed)).toBe(true)

    const existing = parsed.servers.find((server) => server.name === 'existing')
    expect(existing?.definition.timeout).toBe(30)

    const added = parsed.servers.find((server) => server.name === 'docs')
    expect(added).toBeDefined()
    // form -> JSON -> form must reproduce the same structured value
    expect(added && formValueFromServer(added)).toEqual(STDIO_VALUE)
  })

  it('keeps unknown fields and comments when editing through the form', () => {
    const draft = `{
  "mcpServers": {
    "docs": {
      // endpoint comment
      "command": "npx",
      "args": ["serve"],
      "timeout": 45,
      "description": "remark"
    }
  }
}
`
    const parsed = parseMcpConfigDocument(draft)
    const server = parsed.servers.find((candidate) => candidate.name === 'docs')
    expect(server).toBeDefined()
    if (!server) return

    const value = formValueFromServer(server)
    const edited: McpServerFormValue = { ...value, args: ['serve', '--port', '8080'] }
    const next = upsertMcpServer(draft, 'docs', definitionFromFormValue(edited, server))

    expect(next).toContain('// endpoint comment')
    const reparsed = parseMcpConfigDocument(next)
    const updated = reparsed.servers.find((candidate) => candidate.name === 'docs')
    expect(updated?.definition.args).toEqual(['serve', '--port', '8080'])
    expect(updated?.definition.timeout).toBe(45)
    expect(updated?.definition.description).toBe('remark')
  })

  it('omits description and disabled unless the form sets them', () => {
    const bare = definitionFromFormValue(STDIO_VALUE)
    expect(bare.description).toBeUndefined()
    expect(bare.disabled).toBeUndefined()

    const described = definitionFromFormValue({
      ...STDIO_VALUE,
      enabled: false,
      description: 'local only',
    })
    expect(described.description).toBe('local only')
    expect(described.disabled).toBe(true)
  })

  it('renames a server in place, keeping position and comments', () => {
    const draft = `{
  "mcpServers": {
    // first server
    "alpha": { "command": "a" },
    "beta": { "command": "b" }
  }
}
`
    const renamed = renameMcpServer(draft, 'alpha', 'gamma')
    expect(renamed).toContain('// first server')
    expect(renamed.indexOf('"gamma"')).toBeLessThan(renamed.indexOf('"beta"'))
    expect(renamed).not.toContain('"alpha"')

    const parsed = parseMcpConfigDocument(renamed)
    expect(parsed.valid).toBe(true)
    expect(parsed.servers.map((server) => server.name)).toEqual(['gamma', 'beta'])
  })

  it('reports line/column for invalid JSONC and never mutates the draft', () => {
    const draft = `{
  "mcpServers": {
    "docs": { "command": "npx", }
  }
`
    const parsed = parseMcpConfigDocument(draft)
    expect(parsed.valid).toBe(false)
    expect(parsed.diagnostics.length).toBeGreaterThan(0)
    for (const diagnostic of parsed.diagnostics) {
      expect(diagnostic.line).toBeGreaterThanOrEqual(1)
      expect(diagnostic.column).toBeGreaterThanOrEqual(1)
    }
    // save is blocked by the caller via !parsed.valid; structured edits must
    // refuse rather than rewrite the user's draft
    expect(() => upsertMcpServer(draft, 'docs', { command: 'npx' })).toThrow()
    expect(draft).toContain('"docs"')
    expect(structuredDocumentSupported(parsed)).toBe(false)
  })
})
