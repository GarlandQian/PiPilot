import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { startPiSdkFixture } from './pi-sdk-fixture'

test('adds MCP servers from a template, pasted configuration and other apps, and manages them in place', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const home = testInfo.outputPath('home')
  await Promise.all([mkdir(userData, { recursive: true }), mkdir(join(home, '.cursor'), { recursive: true }), mkdir(join(home, '.codex'), { recursive: true })])
  const cursorConfig = JSON.stringify({ mcpServers: { browser: { command: 'npx', args: ['@browser/mcp'] }, legacy: { type: 'sse', url: 'https://legacy.example/sse' } } })
  const codexConfig = '[mcp_servers.docs]\ncommand = "uvx"\nargs = ["docs-mcp"]\n'
  await writeFile(join(home, '.cursor', 'mcp.json'), cursorConfig)
  await writeFile(join(home, '.codex', 'config.toml'), codexConfig)
  await writeFile(join(userData, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US', appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true } },
  }))
  const fixture = await startPiSdkFixture({ agentDir })
  const mcpPath = join(agentDir, 'mcp.json')
  await writeFile(mcpPath, '{ "mcpServers": {} }\n')
  const app = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, ...fixture.env, HOME: home, USERPROFILE: home, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' },
  })
  const servers = async () => JSON.parse(await readFile(mcpPath, 'utf8')).mcpServers as Record<string, Record<string, unknown>>
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1280, height: 860 })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('[data-context-panel-nav-id="integrations"]').click()
    const settings = page.getByRole('main', { name: 'Integrations', exact: true })
    await settings.getByRole('tab', { name: 'MCP', exact: true }).click()
    const panel = settings.getByRole('tabpanel', { name: 'MCP', exact: true })
    await expect(panel.locator('[data-mcp-empty]')).toBeVisible()
    const header = panel.locator('[data-mcp-settings] > section > header')
    const footer = panel.locator('[data-models-editor-footer]')

    // A template fills in the command; saving writes it and applies it.
    await header.getByRole('button', { name: 'Add Server…', exact: true }).click()
    await panel.locator('[data-mcp-template="playwright"]').click()
    const editor = panel.locator('[data-mcp-server-editor="new"]')
    await expect(editor.getByRole('textbox', { name: 'Server name', exact: true })).toHaveValue('playwright')
    await expect(editor.getByRole('textbox', { name: 'Arguments', exact: true })).toHaveValue('-y\n@playwright/mcp@latest')
    await footer.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(panel.locator('[data-mcp-server="playwright"]')).toBeVisible()
    expect((await servers()).playwright).toEqual({ command: 'npx', args: ['-y', '@playwright/mcp@latest'] })

    // The switch saves at once.
    await panel.getByRole('switch', { name: 'Use playwright', exact: true }).click()
    await expect.poll(async () => (await servers()).playwright?.enabled).toBe(false)
    await expect(panel.locator('[data-mcp-server="playwright"]')).toContainText('Disabled')

    // Pasted configuration: a server with a name already used is kept as it is.
    await header.getByRole('button', { name: 'Add Server…', exact: true }).click()
    await panel.getByRole('radio', { name: 'Paste Configuration', exact: true }).click()
    await panel.getByRole('textbox', { name: 'Configuration to paste', exact: true }).fill(JSON.stringify({ mcpServers: {
      playwright: { command: 'npx', args: ['other'] },
      fetch: { type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] },
    } }))
    await expect(panel.getByRole('status').filter({ hasText: 'Found 2 servers' })).toBeVisible()
    await expect(panel.locator('[data-mcp-import-candidate="playwright"]')).toContainText('Exists, kept')
    await footer.getByRole('button', { name: 'Add 1 Servers', exact: true }).click()
    await expect(panel.locator('[data-mcp-server="fetch"]')).toBeVisible()
    expect(await servers()).toMatchObject({ playwright: { args: ['-y', '@playwright/mcp@latest'], enabled: false }, fetch: { command: 'uvx', args: ['mcp-server-fetch'] } })

    // Other apps' servers are read, never changed; SSE ones Pi cannot use start unchosen.
    await header.getByRole('button', { name: 'Import from Other Apps…', exact: true }).click()
    const imports = panel.locator('[data-mcp-import-page]')
    await expect(imports.locator('[data-mcp-import-source="cursor"]')).toBeVisible()
    await expect(imports.locator('[data-mcp-import-source="codex"]')).toBeVisible()
    await expect(imports.locator('[data-mcp-import-candidate="legacy"]')).toContainText('Uses SSE')
    await expect(imports.getByRole('checkbox', { name: 'legacy', exact: true })).not.toBeChecked()
    await footer.getByRole('button', { name: 'Import 2 Servers', exact: true }).click()
    await expect(panel.locator('[data-mcp-server="docs"]')).toBeVisible()
    expect(await servers()).toMatchObject({ browser: { command: 'npx', args: ['@browser/mcp'] }, docs: { command: 'uvx', args: ['docs-mcp'] } })
    expect((await servers()).legacy).toBeUndefined()
    expect(await readFile(join(home, '.cursor', 'mcp.json'), 'utf8')).toBe(cursorConfig)
    expect(await readFile(join(home, '.codex', 'config.toml'), 'utf8')).toBe(codexConfig)

    // A secret typed into a server is masked in its JSON view and saved as typed.
    await panel.getByRole('button', { name: 'Edit browser', exact: true }).click()
    const browser = panel.locator('[data-mcp-server-editor="browser"]')
    await browser.getByRole('button', { name: 'Add row', exact: true }).first().click()
    await browser.getByRole('textbox', { name: 'Variable name', exact: true }).fill('BROWSER_TOKEN')
    await browser.getByLabel('Value', { exact: true }).fill('token-value')
    await browser.getByRole('button', { name: /^Config JSON/u }).click()
    await expect(browser.getByRole('textbox', { name: 'Config JSON', exact: true })).toHaveValue(/"BROWSER_TOKEN": "•+"/u)
    await footer.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(async () => (await servers()).browser?.env).toEqual({ BROWSER_TOKEN: 'token-value' })

    await panel.getByRole('button', { name: 'Actions for fetch', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Remove server', exact: true }).click()
    await page.getByRole('alertdialog', { name: 'Remove server fetch?', exact: true }).getByRole('button', { name: 'Remove server', exact: true }).click()
    await expect(panel.locator('[data-mcp-server="fetch"]')).toHaveCount(0)
    await expect.poll(async () => Object.keys(await servers()).sort()).toEqual(['browser', 'docs', 'playwright'])

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
