import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { McpServerBrowser, filterMcpServers } from '../../src/components/settings/integrations/McpServerBrowser'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import { parseMcpConfigDocument } from '../../src/shared/mcp-config-parser'

vi.mock('@/i18n', () => ({ useT: () => (key: string) => key }))

const document = `{
  "mcpServers": {
    "docs": { "command": "node", "args": ["server.js"], "env": { "TOKEN": "hidden-token-value" }, "description": "Project documentation", "future": { "keep": true } },
    "remote": { "url": "https://example.test/tools", "headers": { "Authorization": "hidden-header-value" }, "disabled": true },
    "mux": { "socket": "/fixture/mcp.sock" }
  }
}`
const servers = parseMcpConfigDocument(document).servers

function renderBrowser() {
  return renderToStaticMarkup(createElement(TooltipProvider, null, createElement(McpServerBrowser, {
    servers,
    onEdit: () => undefined,
    onRemove: () => undefined,
    onToggleEnabled: () => undefined,
    onOpenJson: () => undefined,
  })))
}

describe('MCP server browser', () => {
  it.each([
    [' DOCS ', ['docs']],
    ['NODE', ['docs']],
    ['documentation', ['docs']],
    ['example.test', ['remote']],
    ['http', ['remote']],
    ['socket', ['mux']],
    ['missing', []],
  ])('finds servers by readable metadata: %s', (query, expected) => {
    const result = filterMcpServers(servers, query)
    expect(result.map((server) => server.name)).toEqual(expected)
    for (const server of result) expect(servers).toContain(server)
  })

  it('preserves authoritative definitions and does not search credential values', () => {
    expect(filterMcpServers(servers, '')).toBe(servers)
    expect(filterMcpServers(servers, 'hidden-token-value')).toEqual([])
    expect(filterMcpServers(servers, 'hidden-header-value')).toEqual([])
    expect(servers[0]?.definition.future).toEqual({ keep: true })
    expect(servers[0]?.definition.env).toEqual({ TOKEN: 'hidden-token-value' })
  })

  it('keeps server controls discoverable and routes unsupported transports to JSON', () => {
    const markup = renderBrowser()
    const buttons = [...markup.matchAll(/<button\b[^>]*>/gu)].map((match) => match[0])
    const docsEdit = buttons.find((button) => button.includes('aria-label="settings.mcp.editServer docs"'))
    const muxEdit = buttons.find((button) => button.includes('aria-label="settings.mcp.editServer mux"'))

    expect(docsEdit).toBeDefined()
    expect(docsEdit).not.toContain('disabled=')
    expect(muxEdit).toContain('disabled=""')
    expect(markup).toContain('aria-label="settings.mcp.removeServer mux"')
    expect(markup).toContain('aria-label="remote: settings.mcp.disabled"')
    expect(markup).toContain('data-mcp-server-detail="docs"')
    expect(markup).toContain('server.js')
    expect(markup).toContain('TOKEN')
    expect(markup).not.toContain('hidden-token-value')
    expect(markup).not.toContain('hidden-header-value')
    expect(markup).toContain('settings.integrations.mcp.openJson')
    expect(markup).toContain('type="search"')
  })
})
