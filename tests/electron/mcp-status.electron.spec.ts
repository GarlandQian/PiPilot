import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { startPiSdkFixture } from './pi-sdk-fixture'

// A minimal stdio MCP server: newline-delimited JSON-RPC with two tools.
const SERVER = `
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    const message = JSON.parse(line)
    if (message.id === undefined) continue
    const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
    if (message.method === 'initialize') reply({ protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'status-fixture', version: '1.0.0' } })
    else if (message.method === 'tools/list') reply({ tools: [
      { name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: {} } },
      { name: 'ping', description: 'Ping', inputSchema: { type: 'object', properties: {} } },
    ] })
    else if (message.method === 'ping') reply({})
    else process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } }) + '\\n')
  }
})
process.stderr.write('status fixture ready\\n')
`

test('shows each MCP server of the conversation with its tools or why it failed', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  await mkdir(userData, { recursive: true })
  await writeFile(join(userData, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US', notifications: { desktop: false, sound: false } },
  }))
  const fixture = await startPiSdkFixture({ agentDir })
  const serverPath = testInfo.outputPath('status-server.mjs')
  await writeFile(serverPath, SERVER)
  await writeFile(join(agentDir, 'mcp.json'), JSON.stringify({ mcpServers: {
    docs: { command: process.execPath, args: [serverPath], env: { ELECTRON_RUN_AS_NODE: '1' } },
    broken: { command: join(agentDir, 'missing-mcp-server') },
    paused: { command: process.execPath, args: [serverPath], enabled: false },
  } }, null, 2))
  const app = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' },
  })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1280, height: 820 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    const trigger = page.locator('[data-mcp-status-trigger]')
    await expect(trigger).toHaveText('1/2', { timeout: 20_000 })
    await expect(trigger).toHaveAttribute('data-mcp-status-trigger', 'problem')
    await trigger.click()
    const panel = page.locator('[data-mcp-status-panel]')
    await expect(panel.locator('[data-mcp-status-server="docs"]')).toContainText('Connected · 2 tools')
    await expect(panel.locator('[data-mcp-status-server="broken"]')).toHaveAttribute('data-mcp-state', 'failed')
    await expect(panel.locator('[data-mcp-status-server="paused"]')).toContainText('Disabled')
    await panel.locator('[data-mcp-status-server="broken"]').getByRole('button', { name: 'Error details' }).click()
    await expect(panel.locator('[data-mcp-status-server="broken"] pre')).toContainText(/ENOENT|not found|spawn/iu)
    // Reconnect runs Pi's /mcp command; the broken server stays failed.
    await panel.locator('[data-mcp-status-server="broken"]').getByRole('button', { name: 'Reconnect', exact: true }).click()
    await expect(panel.locator('[data-mcp-status-server="broken"]')).toHaveAttribute('data-mcp-state', 'failed')
    await page.keyboard.press('Escape')

    // Settings › MCP shows what the open conversation saw.
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('[data-context-panel-nav-id="mcp"]').click()
    await expect(page.locator('[data-mcp-server="docs"] [data-mcp-live-state="connected"]')).toContainText('Connected · 2 tools')
    await expect(page.locator('[data-mcp-server="broken"] [data-mcp-live-state="failed"]')).toBeVisible()
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
